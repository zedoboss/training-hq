// Calendar (3.7, P43, P44): what happened on each local date, month and year grids, the week streak, rest days
// since the last session and sessions per week. Imported Hevy and Strong sessions are ordinary sessions, so the
// calendar reaches back through every imported year. Later steps add their own day markers through `extra`.
import { isoDate, daysBetween, zoneOf } from './time.js';
import { addDays, weekStartOf, addMonths } from './stats.js';
import { SET_TYPES } from './exercise-types.js';
import { kg as fmtKg } from './loads.js';

export const DAY_TYPES = ['pull', 'push', 'legs', 'neck'];
export const SOURCE_LABEL = { hevy: 'Hevy', strong: 'Strong', 'training-hq': 'Training HQ' };
export const sourceOf = (s) => s.source || 'training-hq';

/**
 * Markers per local date: Map('YYYY-MM-DD' -> {workouts, holds, extra}).
 * workouts: finished sessions that aren't hold rounds, oldest first: {id, title, dayType, source, startedAt}.
 * holds: hold rounds, plus workouts with ticked hold sets in them: {id, title, area?}.
 * extra: [{date, kind, label}] from later steps: squat-depth runs (kind 'squat', lib/squat-log.js squatMarks), then
 * meals, supplements, body scan, sauna.
 */
export function dayMarks({ sessions = [], sets = [], extra = [], tz } = {}) {
  const withHolds = new Set();
  for (const x of sets) if (x.done && x.type === 'hold') withHolds.add(x.sessionId);
  const out = new Map();
  const at = (d) => {
    if (!out.has(d)) out.set(d, { workouts: [], holds: [], extra: [] });
    return out.get(d);
  };
  for (const s of [...sessions].filter((x) => x.status === 'done').sort((a, b) => a.startedAt - b.startedAt)) {
    const d = isoDate(new Date(s.startedAt), zoneOf(s, tz));
    if (s.kind === 'holds') { at(d).holds.push({ id: s.id, title: s.title, area: s.area ?? null }); continue; }
    at(d).workouts.push({ id: s.id, title: s.title, dayType: s.dayType ?? null, source: sourceOf(s), startedAt: s.startedAt, tz: s.tz ?? null });
    if (withHolds.has(s.id)) at(d).holds.push({ id: s.id, title: `Holds in ${s.title}`, area: null });
  }
  for (const e of extra) at(e.date).extra.push(e);
  return out;
}

/** Sorted local dates with at least one workout. */
export const workoutDates = (marks) => [...marks].filter(([, m]) => m.workouts.length).map(([d]) => d).sort();

/**
 * Weeks in a row with at least one workout, counted back from this week. A week that hasn't got one yet doesn't
 * break the streak until it is over (the count then starts from last week). best: the longest run ever.
 */
export function weekStreak(dates, today, firstDay = 1) {
  const weeks = new Set(dates.filter((d) => d <= today).map((d) => weekStartOf(d, firstDay)));
  const thisWeek = weekStartOf(today, firstDay);
  let w = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let current = 0;
  while (weeks.has(w)) { current += 1; w = addDays(w, -7); }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const x of [...weeks].sort()) {
    run = prev && addDays(prev, 7) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best, thisWeek: weeks.has(thisWeek) };
}

/** Whole days since the last workout on or before today: 0 when it was today, null when there is none. */
export function restDaysSince(dates, today) {
  const last = dates.filter((d) => d <= today).at(-1);
  return last ? { days: daysBetween(last, today), last } : { days: null, last: null };
}

/** Workouts this week, and the average over the `weeks` full weeks before it. */
export function sessionsPerWeek(marks, today, { firstDay = 1, weeks = 4 } = {}) {
  const start = weekStartOf(today, firstDay);
  const count = (from, to) => [...marks].reduce((n, [d, m]) => n + (d >= from && d < to ? m.workouts.length : 0), 0);
  const before = count(addDays(start, -7 * weeks), start);
  return { thisWeek: count(start, addDays(start, 7)), average: Math.round((before / weeks) * 10) / 10, weeks };
}

/** Days of a month with the number of blank cells before the 1st: {lead, days: ['YYYY-MM-01', ...]}. */
export function monthGrid(ym, firstDay = 1) {
  const from = `${ym}-01`;
  const to = `${addMonths(ym, 1)}-01`;
  const lead = (new Date(`${from}T12:00:00Z`).getUTCDay() - firstDay + 7) % 7;
  const days = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  return { lead, days };
}

/** Workouts per month of a year: [{month: 'YYYY-MM', workouts, byType: {pull: n, ...}}], January first. */
export function yearMonths(marks, year) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, workouts: 0, byType: {} }));
  for (const [d, m] of marks) {
    if (!d.startsWith(`${year}-`)) continue;
    const row = months[Number(d.slice(5, 7)) - 1];
    for (const w of m.workouts) {
      row.workouts += 1;
      const t = w.dayType || 'other';
      row.byType[t] = (row.byType[t] || 0) + 1;
    }
  }
  return months;
}

/** Every year with something in it, newest first: [{year, workouts, days, months}]. */
export function yearsList(marks) {
  const years = new Set([...marks].filter(([, m]) => m.workouts.length || m.holds.length || m.extra.length).map(([d]) => d.slice(0, 4)));
  return [...years].sort().reverse().map((year) => {
    const months = yearMonths(marks, year);
    const days = [...marks].filter(([d, m]) => d.startsWith(`${year}-`) && m.workouts.length).length;
    return { year, workouts: months.reduce((n, x) => n + x.workouts, 0), days, months };
  });
}

/** The day type that colours a day: the first workout's, 'other' for a workout without one, null for none. */
export const dayColour = (mark) => (mark?.workouts.length ? (mark.workouts[0].dayType || 'other') : null);

/** One set in words: "W 20 kg × 10", "42.5 kg × 12", "H 30 kg · 30 s", "BW × 8", "+5 kg × 6". */
export function setText(set, exType = 'weight_reps') {
  const tag = SET_TYPES[set.type]?.short;
  const parts = [];
  const added = exType === 'weighted_bodyweight';
  const assisted = exType === 'assisted_bodyweight';
  if (set.kg != null && (set.kg !== 0 || !(added || assisted))) parts.push(`${added ? '+' : assisted ? '-' : ''}${fmtKg(set.kg)} kg`);
  else if (added || assisted || exType === 'reps_only') parts.push('BW');
  if (set.distanceM != null) parts.push(set.distanceM >= 1000 ? `${fmtKg(set.distanceM / 1000)} km` : `${fmtKg(set.distanceM)} m`);
  let text = parts.join(' · ');
  if (set.reps != null) text = text ? `${text} × ${set.reps}` : `${set.reps} reps`;
  if (set.durationS != null) text = text ? `${text} · ${set.durationS} s` : `${set.durationS} s`;
  if (set.type === 'hold' && set.durationS == null && set.importedAs) text = `${text ? `${text} ` : ''}(logged as "${set.importedAs}")`;
  if (set.rpe != null) text += ` @${set.rpe}`;
  if (set.depth?.lowDeg != null) text += ` · depth ${Math.round(set.depth.lowDeg)}°`; // Squat Depth filled it (5.3)
  return `${tag ? `${tag} ` : ''}${text || '-'}`;
}

/**
 * A day's sessions in full, set by set: [{session, source, exercises: [{name, sets: [text]}], sets, volume}].
 * Only ticked sets, in logged order.
 */
export function dayDetail(mark, sessionsById, setsBySession) {
  if (!mark) return [];
  const ids = [...mark.workouts.map((w) => w.id), ...mark.holds.filter((h) => !mark.workouts.some((w) => w.id === h.id)).map((h) => h.id)];
  return ids.map((id) => sessionsById.get(id)).filter(Boolean).map((s) => {
    const ss = (setsBySession.get(s.id) || []).filter((x) => x.done).sort((a, b) => a.order - b.order);
    const exercises = (s.exercises || []).map((ex) => ({
      name: ex.name, importedName: ex.importedName ?? null, note: ex.notes || '',
      sets: ss.filter((x) => x.exKey === ex.key).map((x) => setText(x, ex.type)),
    })).filter((e) => e.sets.length);
    return { session: s, source: sourceOf(s), exercises, sets: ss.length };
  });
}
