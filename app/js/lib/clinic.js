// A one-page summary for his clinic checkup (Thu 11/5, missing feature 12: "No one-page recovery summary to show the
// clinic at your checkup"). Built only from what he logged: his recovery record and check-in answers, his
// tendon areas and the holds he did, the pain he wrote down in workouts (notes and skip reasons), his main lifts since
// the comeback and his body scans. No advice, no reading of it: the clinic reads it. Pure; views/body-clinic.js draws it.
import { isoDate, daysBetween } from './time.js';
import { addDays } from './rotation.js';
import { painIn } from './targets.js';
import { buildHistory } from './history.js';
import { roundsByDate } from './holds.js';
import { checkIns, endsOn, sinceText } from './recovery.js';
import { METRICS } from './scans.js';

const PHASE = { heal: 'Heal', fix: 'Fix', maintenance: 'Maintenance', maintain: 'Maintenance' };
const MAIN_SCAN = ['weightKg', 'fatPercent', 'fatMassKg', 'leanMassKg', 'muscleMassKg', 'visceralFat'];
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * @param {object} o
 * @param {string} o.today       YYYY-MM-DD
 * @param {string} [o.tz]
 * @param {object|null} [o.recPlan]  'recovery' 'main'
 * @param {object|null} [o.recState] 'recovery' 'state'
 * @param {Array} [o.notes]      'coach-notes' (his recovery check-ins)
 * @param {Array} [o.tendons]    'tendons' docs (areas)
 * @param {Array} [o.sessions]   'sessions'
 * @param {Array} [o.sets]       'sets'
 * @param {object|null} [o.bridge] 'bridge' 'last-loads'
 * @param {Array} [o.exercises]  'exercises' (library: which lifts are main lifts)
 * @param {Array} [o.scans]      'body-scans'
 * @param {string|null} [o.comebackStart]  first comeback session (finish.js comebackStartOf)
 * @param {number} [o.holdDays]  days of hold history shown (default 28)
 */
export function clinicSummary({ today, tz, recPlan = null, recState = null, notes = [], tendons = [], sessions = [], sets = [], bridge = null, exercises = [], scans = [], comebackStart = null, holdDays = 28 }) {
  const from = comebackStart || addDays(today, -84);
  const dateOf = (ms) => isoDate(new Date(ms), tz);

  // His recovery record and his own check-in answers.
  const qs = recPlan?.checkIn?.questions || [];
  const recovery = recPlan ? {
    title: recPlan.title || 'Recovery', since: recPlan.since || null, sinceText: sinceText(recPlan, today), checkup: endsOn(recPlan, recState),
    checkIns: checkIns(notes).map((n) => ({ date: n.date, answers: qs.filter((q) => n.answers[q.key] != null && String(n.answers[q.key]).trim() !== '').map((q) => ({ label: q.label, value: String(n.answers[q.key]) })) })).filter((c) => c.answers.length),
  } : null;

  // Tendon areas with a phase and holds: holds logged in the last holdDays days.
  const areas = tendons.filter((d) => d?.kind === 'area');
  const rounds = roundsByDate(areas, sessions, sets, bridge);
  const start = addDays(today, -(holdDays - 1));
  const tendonRows = areas.filter((a) => a.phase && a.phase !== 'none').map((a) => {
    const days = Object.entries(rounds[a.id] || {}).filter(([d, n]) => d >= start && d <= today && n > 0);
    return { label: a.label, phase: PHASE[a.phase] || a.phase, holds: (a.holds || []).map((h) => h.exercise).filter(Boolean), rounds: days.reduce((t, [, n]) => t + n, 0), days: days.length, of: holdDays };
  });

  // Pain he wrote down in workouts since the comeback: exercise notes, set notes, session notes and skip reasons.
  const pain = [];
  const setNotes = new Map();
  for (const x of sets) if (x.note) { const k = `${x.sessionId}|${x.exKey}`; setNotes.set(k, [...(setNotes.get(k) || []), x.note]); }
  for (const s of sessions) {
    if (s.status !== 'done' || !s.startedAt) continue;
    const date = dateOf(s.startedAt);
    if (date < from || date > today) continue;
    if (painIn(s.note)) pain.push({ date, exercise: null, text: String(s.note).trim(), skipped: false });
    for (const ex of s.exercises || []) {
      const said = [ex.notes, ...(setNotes.get(`${s.id}|${ex.key}`) || [])].filter((t) => painIn(t));
      for (const t of said) pain.push({ date, exercise: ex.name, text: String(t).trim(), skipped: false });
      if (ex.skipped?.reason && painIn(ex.skipped.reason)) pain.push({ date, exercise: ex.name, text: ex.skipped.reason.trim(), skipped: true });
    }
  }
  pain.sort((a, b) => a.date.localeCompare(b.date));

  // Main lifts: the heaviest working set of his first and latest session since the comeback.
  const history = buildHistory({ sessions, sets, bridge });
  const lifts = [];
  for (const ex of exercises) {
    if (ex?.capClass !== 'main' || !ex.name) continue;
    const list = history.lifted(ex.name).filter((e) => e.date >= from && e.date <= today && e.heaviest?.kg != null);
    if (!list.length) continue;
    const first = list[list.length - 1]; const last = list[0];
    lifts.push({ name: ex.name, sessions: list.length, first: { date: first.date, kg: first.heaviest.kg, reps: first.heaviest.reps ?? null }, last: { date: last.date, kg: last.heaviest.kg, reps: last.heaviest.reps ?? null }, changeKg: r1(last.heaviest.kg - first.heaviest.kg) });
  }
  lifts.sort((a, b) => a.name.localeCompare(b.name));

  // Body scans with results: the first and the latest, the main numbers side by side.
  const done = scans.filter((x) => x?.status === 'done' && Array.isArray(x.metrics) && x.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let scanRows = null;
  if (done.length) {
    const a = done[0]; const b = done[done.length - 1];
    const val = (s, key) => s.metrics.find((m) => m.key === key && m.value != null)?.value ?? null;
    scanRows = { first: a.date, last: b.date, count: done.length, rows: MAIN_SCAN.map((key) => {
      const m = METRICS.find((x) => x.key === key);
      const f = val(a, key); const l = val(b, key);
      return f == null && l == null ? null : { label: m.label, unit: m.unit, first: f, last: l, change: f != null && l != null && a !== b ? r1(l - f) : null };
    }).filter(Boolean) };
  }

  return { today, from, days: daysBetween(from, today), recovery, tendons: tendonRows, pain, lifts, scans: scanRows };
}
