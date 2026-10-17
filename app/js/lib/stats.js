// Statistics (2.18) over finished Training HQ sessions; the imported Hevy and Strong history joins in step 3.
// Sets per muscle: the primary muscle counts 1, each secondary muscle 0.5. Holds never count. Warm-ups count as sets
// only when Settings says so, and never toward volume. Dates are the session's local date (YYYY-MM-DD).
import { effectiveKg } from './exercise-types.js';
import { isoDate } from './time.js';

const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);

/** First day of the week containing `iso`. firstDay: 0 Sunday, 1 Monday, 6 Saturday. */
export function weekStartOf(iso, firstDay = 1) {
  const dow = new Date(utc(iso)).getUTCDay();
  return addDays(iso, -((dow - firstDay + 7) % 7));
}

export const monthOf = (iso) => iso.slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

const finished = (sessions) => sessions.filter((s) => s.status === 'done' && s.kind !== 'holds');

/**
 * One row per ticked set of a finished workout session.
 * @param {{sessions:Array, sets:Array, lib:Map, countWarmups?:boolean, tz?:string}} o
 */
export function setRows({ sessions, sets, lib, countWarmups = false, tz }) {
  const byId = new Map(finished(sessions).map((s) => [s.id, s]));
  const rows = [];
  for (const x of sets) {
    const s = x.done && byId.get(x.sessionId);
    if (!s || x.type === 'hold' || (x.type === 'warmup' && !countWarmups)) continue;
    const ex = s.exercises.find((e) => e.key === x.exKey);
    if (!ex) continue;
    const info = lib.get(ex.exerciseId) || {};
    const warmup = x.type === 'warmup';
    rows.push({
      sessionId: s.id, date: isoDate(new Date(s.startedAt), tz), name: ex.name, exerciseId: ex.exerciseId,
      primary: info.primary || 'other', secondary: info.secondary || [], warmup, kg: x.kg ?? null, reps: x.reps ?? null,
      volume: warmup ? 0 : effectiveKg(ex.type, x.kg, null) * (x.reps ?? 0),
    });
  }
  return rows;
}

const inRange = (iso, from, to) => iso >= from && iso < to;

/** {muscle: sets} with primary 1, secondary 0.5. */
export function muscleSets(rows) {
  const out = {};
  for (const r of rows) {
    out[r.primary] = (out[r.primary] || 0) + 1;
    for (const m of r.secondary) out[m] = (out[m] || 0) + 0.5;
  }
  return out;
}

/** The last `weeks` weeks up to today's week: [{start, muscles:{m: sets}}], oldest first. */
export function weeklyMuscleSets(rows, { weeks = 8, today, firstDay = 1 }) {
  const last = weekStartOf(today, firstDay);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(last, -7 * (weeks - 1 - i));
    return { start, muscles: muscleSets(rows.filter((r) => inRange(r.date, start, addDays(start, 7)))) };
  });
}

/** Weekly volume and set counts, oldest first. */
export function weeklyVolume(rows, { weeks = 12, today, firstDay = 1 }) {
  const last = weekStartOf(today, firstDay);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(last, -7 * (weeks - 1 - i));
    const r = rows.filter((x) => inRange(x.date, start, addDays(start, 7)));
    return { start, volume: Math.round(r.reduce((a, x) => a + x.volume, 0)), sets: r.length };
  });
}

export const PERIODS = { '4w': { days: 28, label: '4 weeks' }, '3m': { days: 91, label: '3 months' }, '12m': { days: 364, label: '12 months' } };

/** Date range ending today (inclusive) and the same length just before it. `to` is exclusive. */
export function periodRange(key, today) {
  const days = PERIODS[key]?.days ?? 28;
  const to = addDays(today, 1);
  const from = addDays(to, -days);
  return { from, to, prevFrom: addDays(from, -days), prevTo: from, days };
}

/** Sessions, time, volume and sets in [from, to). */
export function totals(sessions, rows, from, to, tz) {
  const ss = finished(sessions).filter((s) => inRange(isoDate(new Date(s.startedAt), tz), from, to));
  const r = rows.filter((x) => inRange(x.date, from, to));
  return {
    sessions: ss.length,
    durationMs: ss.reduce((a, s) => a + Math.max(0, (s.endedAt ?? s.startedAt) - s.startedAt - (s.pausedMs || 0)), 0),
    volume: Math.round(r.reduce((a, x) => a + x.volume, 0)),
    sets: r.length,
  };
}

/** Sets per muscle now and in the previous period, biggest first. */
export function distribution(rows, { from, to, prevFrom, prevTo }) {
  const now = muscleSets(rows.filter((r) => inRange(r.date, from, to)));
  const before = muscleSets(rows.filter((r) => inRange(r.date, prevFrom, prevTo)));
  return [...new Set([...Object.keys(now), ...Object.keys(before)])]
    .map((muscle) => ({ muscle, now: now[muscle] || 0, before: before[muscle] || 0 }))
    .sort((a, b) => b.now - a.now || b.before - a.before || a.muscle.localeCompare(b.muscle));
}

/** Change against the previous value: +12 (%), or null when there is nothing to compare with. */
export const changePct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/**
 * Monthly report: sessions, totals against last month, top exercises, muscle split against last month, and bests
 * (heaviest set of the month above everything logged before it; exercises done for the first time don't count).
 */
export function monthReport({ sessions, rows, month, tz }) {
  const from = `${month}-01`;
  const to = `${addMonths(month, 1)}-01`;
  const prevFrom = `${addMonths(month, -1)}-01`;
  const list = finished(sessions).filter((s) => inRange(isoDate(new Date(s.startedAt), tz), from, to))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({ id: s.id, date: isoDate(new Date(s.startedAt), tz), title: s.title, dayType: s.dayType ?? null }));
  const mine = rows.filter((r) => inRange(r.date, from, to));
  const counts = new Map();
  for (const r of mine) counts.set(r.name, (counts.get(r.name) || 0) + 1);
  const bests = [];
  for (const name of counts.keys()) {
    const heavy = (rs) => rs.filter((r) => r.name === name && !r.warmup && r.kg != null).reduce((m, r) => Math.max(m, r.kg), -Infinity);
    const nowKg = heavy(mine);
    const beforeKg = heavy(rows.filter((r) => r.date < from));
    if (Number.isFinite(nowKg) && Number.isFinite(beforeKg) && nowKg > beforeKg) bests.push({ name, kg: nowKg, previous: beforeKg });
  }
  return {
    month, from, to,
    sessions: list,
    totals: totals(sessions, rows, from, to, tz),
    previous: totals(sessions, rows, prevFrom, from, tz),
    topExercises: [...counts].map(([name, sets]) => ({ name, sets })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)).slice(0, 5),
    muscles: distribution(rows, { from, to, prevFrom, prevTo: from }),
    bests: bests.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
