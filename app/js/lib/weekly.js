// The weekly report (Thu 11/5, from his list of missing features: "No weekly report sent to you"). Once a week (Settings
// notify.weekly: weekday and time, Sunday 7:00 PM by default; off with notify.kinds.weekly false) the Mac sends one
// notification and the whole report into Talk: the 7 days ending that day against the 7 before. Only his own data, no
// advice: workouts per day type, top loads against the week before, food and protein against his targets, sleep,
// body scans, pain written down. Pure; server/weekly.mjs reads the records and sends.
import { dayTotals } from './meals.js';
import { addDays } from './rotation.js';
import { isoDate, formatDay } from './time.js';
import { painIn } from './targets.js';
import { metricValue } from './scans.js';

export const WEEKLY = { weekday: 0, hm: '19:00' };

const r1 = (n) => Math.round(n * 10) / 10;
const kgText = (n) => `${r1(n)} kg`;
const hoursText = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00Z`), 'UTC');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sign = (n, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${r1(Math.abs(n))}${unit}`;

/** The 7 days ending `end` (YYYY-MM-DD), oldest first. */
export const weekDays = (end) => Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));

/**
 * @param {object} o
 * @param {string} o.end  last day of the week (YYYY-MM-DD)
 * @param {string} o.tz
 * @param {Array} o.sessions  'sessions'
 * @param {Array} o.sets      'sets'
 * @param {Array} o.meals     'meals' (empty ones left out)
 * @param {Array} [o.estimates] 'meal-estimates'
 * @param {{kcal:number, proteinG:number}|null} [o.targets]  his fuel plan
 * @param {Array} [o.sleeps]  [{date, inBedMin|asleepMin|bed,wake}] one a night
 * @param {Array} [o.scans]   'body-scans'
 * @returns {{text:string, short:string, weekDays:string[]}}
 */
export function weeklyReport({ end, tz, sessions = [], sets = [], meals = [], estimates = [], targets = null, sleeps = [], scans = [] }) {
  const days = weekDays(end);
  const prevDays = weekDays(addDays(end, -7));
  const dayOf = (t) => isoDate(new Date(t), tz);
  const lifted = (x) => x && x.kind !== 'holds' && x.status === 'done' && Number.isFinite(x.startedAt);
  const inWeek = (list) => (x) => list.includes(dayOf(x.startedAt));
  const thisWeek = sessions.filter(lifted).filter(inWeek(days));
  const lastWeek = sessions.filter(lifted).filter(inWeek(prevDays));
  const lines = [`Week ${dayName(days[0])} to ${dayName(end)}.`];

  // Workouts per day type.
  const byType = new Map();
  for (const x of thisWeek) { const k = x.dayType || x.title || 'workout'; byType.set(k, (byType.get(k) || 0) + 1); }
  lines.push(thisWeek.length
    ? `Workouts: ${thisWeek.length} (${[...byType].map(([k, n]) => `${cap(k)} ${n}`).join(', ')}); the week before: ${lastWeek.length}.`
    : `Workouts: none; the week before: ${lastWeek.length}.`);

  // Top loads: the heaviest working set of each exercise this week, against the week before.
  const tops = (list) => {
    const ids = new Map(list.map((x) => [x.id, x]));
    const out = new Map();
    for (const s of sets) {
      const x = ids.get(s.sessionId);
      if (!x || !s.done || s.kg == null || !(s.kg > 0) || s.type === 'warmup' || s.type === 'hold') continue;
      const name = x.exercises?.find((e) => e.key === s.exKey)?.name;
      if (!name) continue;
      const b = out.get(name);
      if (!b || s.kg > b.kg || (s.kg === b.kg && (s.reps ?? 0) > (b.reps ?? 0))) out.set(name, { kg: s.kg, reps: s.reps ?? null });
    }
    return out;
  };
  const now = tops(thisWeek); const before = tops(lastWeek);
  const loadLines = [...now].map(([name, b]) => {
    const p = before.get(name);
    return `- ${name}: ${kgText(b.kg)}${b.reps != null ? ` × ${b.reps}` : ''}${p ? (p.kg === b.kg ? ' (same as the week before)' : ` (${sign(b.kg - p.kg, ' kg')} on ${kgText(p.kg)})`) : ' (not done the week before)'}`;
  });
  if (loadLines.length) lines.push('Top sets:', ...loadLines.slice(0, 12), ...(loadLines.length > 12 ? [`- and ${loadLines.length - 12} more`] : []));

  // Food: days with meals logged, their average against his targets.
  const food = days.map((d) => ({ d, t: dayTotals(meals, estimates, d) })).filter((x) => x.t.meals > 0);
  if (food.length) {
    const kcal = Math.round(food.reduce((n, x) => n + x.t.kcal, 0) / food.length);
    const prot = r1(food.reduce((n, x) => n + x.t.protein, 0) / food.length);
    lines.push(`Food: ${food.length} of 7 days logged, average ${kcal.toLocaleString('en-US')}${targets?.kcal ? ` of ${Number(targets.kcal).toLocaleString('en-US')}` : ''} kcal and ${prot}${targets?.proteinG ? ` of ${targets.proteinG}` : ''} g protein a logged day.`);
  } else lines.push('Food: nothing logged.');

  // Sleep: nights logged, the average.
  const nights = sleeps.filter((s) => s && days.includes(s.date)).map((s) => s.asleepMin ?? s.inBedMin ?? (Number.isFinite(s.bed) && Number.isFinite(s.wake) ? (s.wake - s.bed) / 60000 : null)).filter((m) => Number.isFinite(m) && m > 0);
  lines.push(nights.length ? `Sleep: ${nights.length} nights logged, average ${hoursText(nights.reduce((a, b) => a + b, 0) / nights.length)}.` : 'Sleep: none logged.');

  // Body scans: this week's average weight and body fat against the week before (weekly averages, not day to day).
  const scanAvg = (list, key) => { const v = scans.filter((s) => s?.status === 'done' && list.includes(s.date)).map((s) => metricValue(s, key)).filter((n) => n != null); return v.length ? { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length } : null; };
  const w = scanAvg(days, 'weightKg'); const wp = scanAvg(prevDays, 'weightKg');
  const f = scanAvg(days, 'fatPercent'); const fp = scanAvg(prevDays, 'fatPercent');
  if (w || f) {
    const parts = [w && `weight ${kgText(w.avg)}${wp ? ` (${sign(w.avg - wp.avg, ' kg')})` : ''}`, f && `body fat ${r1(f.avg)}%${fp ? ` (${sign(f.avg - fp.avg, ' points')})` : ''}`].filter(Boolean);
    lines.push(`Body scans: ${w?.n ?? f?.n}, average ${parts.join(', ')}${wp || fp ? ' against the week before' : ''}.`);
  } else lines.push('Body scans: none this week.');

  // Pain he wrote down: set notes, skip reasons, workout notes (his words, counted and quoted short).
  const pains = [];
  for (const x of sessions.filter((s) => s && s.status !== 'discarded' && Number.isFinite(s.startedAt) && days.includes(dayOf(s.startedAt)))) {
    const add = (name, note) => { const p = painIn(note); if (p) pains.push(`${dayName(dayOf(x.startedAt)).split(' ')[0]}${name ? `, ${name}` : ''}: "${p.slice(0, 60)}"`); };
    add(null, x.note);
    for (const e of x.exercises || []) if (e.skipped?.reason) add(e.name, e.skipped.reason);
    for (const s of sets.filter((s) => s.sessionId === x.id && s.note)) add(x.exercises?.find((e) => e.key === s.exKey)?.name, s.note);
  }
  lines.push(pains.length ? `Pain written down: ${pains.length}.` : 'Pain written down: none.', ...pains.slice(0, 5).map((p) => `- ${p}`));

  const short = `Your week: ${thisWeek.length} workout${thisWeek.length === 1 ? '' : 's'}, food ${food.length} of 7 days logged, sleep ${nights.length} nights logged. The full report is in Talk.`;
  return { text: lines.join('\n'), short, weekDays: days };
}
