// Per-exercise charts and records (3.9, P36, P37, P45, P47) over the full history: Training HQ sessions plus the
// imported Hevy and Strong ones. Input: the newest-first entries of history.all(name) (lib/history.js).
// Warm-ups and holds never count. Estimated 1RM: Epley, weight × (1 + reps / 30), for 1 to 12 reps (a single is
// the weight itself); higher-rep sets give no estimate because the formula drifts there. Same formula for all history.
import { effectiveKg } from './exercise-types.js';

export const E1RM_MAX_REPS = 12;
export const e1rm = (kg, reps) => (kg > 0 && reps >= 1 && reps <= E1RM_MAX_REPS ? (reps === 1 ? kg : kg * (1 + reps / 30)) : null);

const working = (s) => !s.hold && s.type !== 'warmup' && s.type !== 'hold';
const r1 = (n) => Math.round(n * 10) / 10;

/** Which family an exercise type belongs to for charts and records. */
export function family(type) {
  if (type === 'weighted_bodyweight') return 'weighted_bw';
  if (type === 'reps_only' || type === 'assisted_bodyweight') return 'bodyweight';
  if (type === 'duration') return 'duration';
  if (type === 'weight_duration') return 'weight_duration';
  if (type === 'distance_duration') return 'cardio';
  if (type === 'weight_distance') return 'weight_distance';
  return 'weight';
}

/** Chart metrics per family: [{key, label, unit}]. Units: 'kg', 'reps', 's', 'km', 'pace' (seconds per km). */
export const METRICS = {
  weight: [
    { key: 'heaviest', label: 'Heaviest weight', unit: 'kg' }, { key: 'e1rm', label: 'Best 1RM (est.)', unit: 'kg' },
    { key: 'bestSet', label: 'Best set volume', unit: 'kg' }, { key: 'volume', label: 'Session volume', unit: 'kg' },
    { key: 'reps', label: 'Total reps', unit: 'reps' },
  ],
  weighted_bw: [
    { key: 'heaviest', label: 'Most added weight', unit: 'kg' }, { key: 'mostReps', label: 'Most reps', unit: 'reps' },
    { key: 'reps', label: 'Session reps', unit: 'reps' }, { key: 'volume', label: 'Session volume', unit: 'kg' },
  ],
  bodyweight: [{ key: 'mostReps', label: 'Most reps', unit: 'reps' }, { key: 'reps', label: 'Session reps', unit: 'reps' }],
  duration: [{ key: 'longest', label: 'Best time', unit: 's' }, { key: 'time', label: 'Session time', unit: 's' }],
  weight_duration: [{ key: 'heaviest', label: 'Heaviest weight', unit: 'kg' }, { key: 'longest', label: 'Best time', unit: 's' }],
  cardio: [{ key: 'distance', label: 'Distance', unit: 'km' }, { key: 'time', label: 'Time', unit: 's' }, { key: 'pace', label: 'Best pace', unit: 'pace' }],
  weight_distance: [{ key: 'heaviest', label: 'Heaviest weight', unit: 'kg' }, { key: 'distance', label: 'Distance', unit: 'km' }],
};
export const metricsFor = (type) => METRICS[family(type)];

/**
 * One point per session that has working sets, oldest first.
 * {date, at, sessionId, source, title, heaviest, heaviestSet, e1rm, e1rmSet, bestSet, bestSetSet, volume, reps,
 *  mostReps, longest, time, distance (km), pace (s per km, lower is better)}
 */
export function sessionPoints(entries, type = 'weight_reps') {
  const out = [];
  for (const e of entries) {
    const sets = (e.sets || []).filter(working);
    if (!sets.length) continue;
    const p = { date: e.date, at: e.at ?? null, sessionId: e.sessionId ?? null, source: e.source, title: e.title ?? '' };
    let volume = 0; let reps = 0; let time = 0; let dist = 0;
    for (const s of sets) {
      const kg = s.kg ?? null;
      if (kg != null && (p.heaviest == null || kg > p.heaviest || (kg === p.heaviest && (s.reps ?? 0) > (p.heaviestSet.reps ?? 0)))) { p.heaviest = kg; p.heaviestSet = s; }
      const est = kg != null && s.reps ? e1rm(kg, s.reps) : null;
      if (est != null && (p.e1rm == null || est > p.e1rm)) { p.e1rm = r1(est); p.e1rmSet = s; }
      const sv = kg != null && s.reps ? kg * s.reps : null;
      if (sv != null && (p.bestSet == null || sv > p.bestSet)) { p.bestSet = r1(sv); p.bestSetSet = s; }
      if (s.reps != null && (p.mostReps == null || s.reps > p.mostReps)) { p.mostReps = s.reps; p.mostRepsSet = s; }
      if (s.durationS != null && (p.longest == null || s.durationS > p.longest)) { p.longest = s.durationS; p.longestSet = s; }
      if (s.distanceM != null && s.durationS > 0 && s.distanceM > 0) {
        const pace = s.durationS / (s.distanceM / 1000);
        if (p.pace == null || pace < p.pace) { p.pace = Math.round(pace); p.paceSet = s; }
      }
      volume += effectiveKg(type, kg, e.bodyweightKg ?? null) * (s.reps ?? 0);
      reps += s.reps ?? 0;
      time += s.durationS ?? 0;
      dist += s.distanceM ?? 0;
    }
    p.volume = Math.round(volume);
    p.reps = reps;
    p.time = time;
    p.distance = Math.round(dist / 10) / 100;
    out.push(p);
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.date.localeCompare(b.date));
}

/** Points in a range ending today: '3m', '1y' or 'all'. */
export function inRange(points, range, today) {
  if (range === 'all') return points;
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(Date.UTC(range === '1y' ? y - 1 : y, range === '1y' ? m - 1 : m - 4, d)).toISOString().slice(0, 10);
  return points.filter((p) => p.date > from && p.date <= today);
}

// Records per family (P45). better: 'max' or 'min'. set: the point field holding the set behind it.
const RECORDS = {
  weight: [['heaviest', 'Heaviest weight', 'heaviestSet'], ['e1rm', 'Best 1RM (est.)', 'e1rmSet'], ['bestSet', 'Best set volume', 'bestSetSet'], ['volume', 'Best session volume', null]],
  weighted_bw: [['heaviest', 'Most added weight', 'heaviestSet'], ['mostReps', 'Most reps', 'mostRepsSet'], ['reps', 'Most session reps', null]],
  bodyweight: [['mostReps', 'Most reps', 'mostRepsSet'], ['reps', 'Most session reps', null]],
  duration: [['longest', 'Best time', 'longestSet'], ['time', 'Best session time', null]],
  weight_duration: [['heaviest', 'Heaviest weight', 'heaviestSet'], ['longest', 'Best time', 'longestSet']],
  cardio: [['distance', 'Longest distance', null], ['time', 'Longest time', null], ['pace', 'Best pace', 'paceSet', 'min']],
  weight_distance: [['heaviest', 'Heaviest weight', 'heaviestSet'], ['distance', 'Longest distance', null]],
};

/**
 * Records for the exercise: [{key, label, unit, value, set, date, sessionId, source}]. The first session to reach
 * the best value holds the record (a later tie doesn't take it).
 */
export function records(points, type = 'weight_reps') {
  const fam = family(type);
  const units = Object.fromEntries(METRICS[fam].map((m) => [m.key, m.unit]));
  const out = [];
  for (const [key, label, setKey, better = 'max'] of RECORDS[fam]) {
    let best = null;
    for (const p of points) {
      const v = p[key];
      if (v == null || (key !== 'pace' && v <= 0)) continue;
      if (!best || (better === 'max' ? v > best.value : v < best.value)) best = { value: v, p };
    }
    if (best) out.push({ key, label, unit: units[key] ?? (key === 'volume' ? 'kg' : 'reps'), value: best.value, set: setKey ? best.p[setKey] : null, date: best.p.date, sessionId: best.p.sessionId, source: best.p.source });
  }
  return out;
}

/**
 * Best weight for each rep count (P37): [{reps, kg, date, sessionId, source}], 1 rep first, by the exact reps
 * logged. The first session to lift the weight holds it. Sets without a weight are left out.
 */
export function repRecords(entries, maxReps = 20) {
  const best = new Map();
  const ordered = [...entries].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.date.localeCompare(b.date));
  for (const e of ordered) {
    for (const s of (e.sets || []).filter(working)) {
      if (s.kg == null || s.kg <= 0 || !s.reps || s.reps > maxReps) continue;
      const cur = best.get(s.reps);
      if (!cur || s.kg > cur.kg) best.set(s.reps, { reps: s.reps, kg: s.kg, date: e.date, sessionId: e.sessionId ?? null, source: e.source });
    }
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}

/** "1:23" for seconds, "5:12 /km" for pace. */
export const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
