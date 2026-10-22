// Finishing a session: records, the "update routine?" check, and turning a session into a routine.
import { heaviestOf } from './history.js';
import { isoDate, formatDay } from './time.js';
import { newId, newKey } from './routines.js';
import { sessionPoints, setRecordKinds } from './records.js';
import { setValueText } from './calendar.js';
import { SET_TYPES } from './exercise-types.js';

/** The comeback's first day: the earliest first session in the programme data (synced from the Mac), or null. */
export const comebackStartOf = (meta) => Object.entries(meta?.firstSessions || {})
  .filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(String(v))).map(([, v]) => v).sort()[0] ?? null;
const since = (start) => (e) => !start || e.date >= start;

/**
 * Bests in this session against the sessions before it (heaviest working set). "Comeback best" = above everything
 * since the comeback started; "all-time" = above everything ever, claimed only with the full history imported
 * (fullHistory). A session from before the comeback can only have all-time bests. Never on a first-ever session.
 */
export function sessionBests(session, sets, history, { comebackStart = null, fullHistory = false, tz } = {}) {
  const out = [];
  const day = isoDate(new Date(session.startedAt), tz);
  for (const ex of session.exercises) {
    const mine = sets.filter((s) => s.exKey === ex.key && s.done).map((s) => ({ ...s, hold: s.type === 'hold' }));
    const best = heaviestOf(mine);
    const past = history.all(ex.name).filter((e) => e.sessionId !== session.id && (e.at != null ? e.at < session.startedAt : e.date < day));
    if (!best?.kg || !past.length) continue;
    const top = (list) => list.reduce((m, e) => Math.max(m, e.heaviest?.kg ?? 0), 0);
    const prevAll = top(past);
    const allTime = fullHistory && best.kg > prevAll;
    if (!comebackStart || day >= comebackStart) {
      const prevComeback = top(past.filter(since(comebackStart)));
      if (allTime || (prevComeback > 0 && best.kg > prevComeback)) out.push({ name: ex.name, kg: best.kg, reps: best.reps, kind: allTime ? 'all-time' : 'comeback', previous: (allTime ? prevAll : prevComeback) || null });
    } else if (allTime) {
      out.push({ name: ex.name, kg: best.kg, reps: best.reps, kind: 'all-time', previous: prevAll || null });
    }
  }
  return out;
}

/**
 * Records held by this session's sets (workout detail, Tue 10/20): for each record kind an exercise type has (Weight,
 * 1RM, Volume for weight × reps; Reps, Time, Pace for the others), the set that beat every session before this one.
 * Same scope as sessionBests: since the comeback started, or all-time with the full history imported; a session from
 * before the comeback only gets all-time records, and an exercise's first-ever session none. Exercises listed twice
 * in a session (his bench, then the bench holds) count together. Warm-ups and holds never hold a record.
 * @returns {Map<string, Array<{key:string, label:string, allTime:boolean}>>} set id -> its records
 */
export function sessionSetRecords(session, sets, history, { comebackStart = null, fullHistory = false, tz } = {}) {
  const out = new Map();
  const day = isoDate(new Date(session.startedAt), tz);
  const inComeback = !comebackStart || day >= comebackStart;
  const byName = new Map();
  for (const ex of session.exercises) {
    const mine = sets.filter((s) => s.exKey === ex.key && s.done);
    if (!byName.has(ex.name)) byName.set(ex.name, { type: ex.type, sets: [] });
    byName.get(ex.name).sets.push(...mine);
  }
  for (const [name, { type, sets: mine }] of byName) {
    const [now] = sessionPoints([{ date: day, sets: mine.sort((a, b) => a.order - b.order), bodyweightKg: session.bodyweightKg ?? null }], type);
    if (!now) continue;
    const past = sessionPoints(history.all(name).filter((e) => e.sessionId !== session.id && (e.at != null ? e.at < session.startedAt : e.date < day)), type);
    const pastComeback = past.filter(since(comebackStart));
    for (const { key, label, setKey, better } of setRecordKinds(type)) {
      const v = now[key];
      if (v == null || (better === 'max' && v <= 0) || !now[setKey]?.id) continue;
      const beatsAll = (list) => list.some((p) => p[key] != null) && list.every((p) => p[key] == null || (better === 'min' ? v < p[key] : v > p[key]));
      const allTime = fullHistory && beatsAll(past);
      if (!allTime && !(inComeback && beatsAll(pastComeback))) continue;
      const id = now[setKey].id;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ key, label, allTime });
    }
  }
  return out;
}

/**
 * The workout detail (Tue 10/20, like Hevy's): every exercise in the session's order with its note and every ticked
 * set in the order logged. Set labels follow the logging screen: working sets numbered, W, D and F in place of the
 * number; holds numbered on their own (H1, H2, H3). Exercises with nothing ticked are listed apart as skipped.
 * records: from sessionSetRecords.
 * @returns {{exercises: Array<{key, exerciseId, name, importedName, notes, type, holdsOnly:boolean,
 *   rows: Array<{id, type, label, text, note, records}>}>, skipped: string[], holds: number}}
 */
export function workoutDetail(session, sets, records = new Map()) {
  const done = sets.filter((s) => s.done).sort((a, b) => a.order - b.order);
  const exercises = []; const skipped = [];
  let holds = 0;
  for (const ex of session.exercises || []) {
    const mine = done.filter((s) => s.exKey === ex.key);
    if (!mine.length) { skipped.push(ex.skipped?.reason ? `${ex.name} (skipped: ${ex.skipped.reason})` : ex.name); continue; }
    let working = 0; let held = 0;
    const rows = mine.map((s) => {
      if (s.type === 'hold') held++;
      else if (s.type !== 'warmup') working++;
      const label = s.type === 'hold' ? `H${held}` : s.type === 'normal' || !SET_TYPES[s.type] ? String(working) : SET_TYPES[s.type].short;
      return { id: s.id, type: s.type, label, text: setValueText(s, ex.type), note: s.note || '', records: records.get(s.id) || [] };
    });
    holds += held;
    exercises.push({ key: ex.key, exerciseId: ex.exerciseId ?? null, name: ex.name, importedName: ex.importedName ?? null, notes: ex.notes || '', type: ex.type, holdsOnly: held === mine.length, rows });
  }
  return { exercises, skipped, holds };
}

/**
 * The records a ticked set makes (P27; Thu 10/22, his words: "Add the PR features from Hevy too, not just new comeback
 * set record: weight, volume, and I believe 1RM"): Hevy's set records for the exercise's type (Weight, 1RM, Volume for
 * weight and reps; Reps, Time, Pace for the others), against every session before this one and the sets already
 * ticked today. A record is ALL-TIME when the full Hevy and Strong history is in (fullHistory) and nothing ever beat
 * it, else since the comeback started. Never on an exercise's first-ever session, never for warm-ups or holds, and a
 * value already reached earlier today is no new record.
 * @returns {null | {kg, reps, previous, kinds: Array<{key, label, value, previous, allTime}>}} previous: the weight
 *   record's old value (kept for the older callers).
 */
export function setRecord({ set, name, type = 'weight_reps', sessionId, otherSets = [], history, comebackStart = null, fullHistory = false, bodyweightKg = null }) {
  if (!set?.done || set.type === 'warmup' || set.type === 'hold') return null;
  const past = history.all(name).filter((e) => e.sessionId !== sessionId);
  if (!past.length) return null;
  const pts = sessionPoints(past, type);
  const ptsComeback = pts.filter(since(comebackStart));
  const point = (sets) => sessionPoints([{ date: '9999-12-31', sets, bodyweightKg }], type)[0] || null;
  const mine = point([set]);
  if (!mine) return null;
  const today = point(otherSets.filter((x) => x.done && x.id !== set.id));
  const kinds = [];
  for (const { key, label, better } of setRecordKinds(type)) {
    const v = mine[key];
    if (v == null || (better === 'max' && v <= 0)) continue;
    const pick = (a, b) => (a == null ? b : b == null ? a : better === 'min' ? Math.min(a, b) : Math.max(a, b));
    const bestOf = (list) => list.reduce((m, p) => pick(m, p[key] ?? null), null);
    const beats = (prior) => prior != null && (better === 'min' ? v < prior : v > prior);
    const all = bestOf(pts); const comeback = bestOf(ptsComeback); const t = today?.[key] ?? null;
    const allTime = fullHistory && beats(pick(all, all == null ? null : t));
    if (allTime) { kinds.push({ key, label, value: v, previous: pick(all, t), allTime: true }); continue; }
    if (beats(pick(comeback, comeback == null ? null : t))) kinds.push({ key, label, value: v, previous: pick(comeback, t), allTime: false });
  }
  if (!kinds.length) return null;
  return { kg: set.kg ?? null, reps: set.reps ?? null, previous: kinds.find((x) => x.key === 'heaviest')?.previous ?? null, kinds };
}

/** True when the logged structure differs from the routine: exercises added, removed, reordered, or set counts changed. */
export function structureChanged(session, sets, routine) {
  if (!routine) return false;
  const ids = session.exercises.map((e) => e.exerciseId);
  const rIds = routine.exercises.map((e) => e.exerciseId);
  if (ids.join('|') !== rIds.join('|')) return true;
  // A skipped exercise (nothing ticked) is not a change to the routine.
  return session.exercises.some((e, i) => {
    const re = routine.exercises[i];
    if (re.plan) return false;
    // Warm-ups made by the routine's "warm-up sets" option are not part of its structure.
    const done = sets.filter((s) => s.exKey === e.key && s.done && !(re.warmup && s.type === 'warmup')).length;
    return done > 0 && done !== (re.sets?.length ?? 0);
  });
}

/** Routine whose exercises and sets follow this session (programme links kept where the exercise is unchanged). */
export function routineFromSession(session, sets, routine = null) {
  return {
    id: routine?.id ?? newId('routine'),
    title: routine?.title ?? session.title,
    folderId: routine?.folderId ?? null,
    order: routine?.order ?? 99,
    dayType: session.dayType ?? routine?.dayType ?? null,
    notes: routine?.notes ?? '',
    exercises: session.exercises.map((e) => {
      const re = routine?.exercises.find((x) => x.exerciseId === e.exerciseId);
      const mine = sets.filter((s) => s.exKey === e.key && s.done && !(re?.warmup && s.type === 'warmup')).sort((a, b) => a.order - b.order);
      return {
        key: re?.key ?? newKey(), exerciseId: e.exerciseId, name: e.name, restSeconds: e.restSeconds ?? null, notes: re?.notes ?? e.notes ?? '',
        plan: re?.plan ?? null, role: re?.role ?? e.role ?? null, supersetId: e.supersetId ?? null, warmup: re?.warmup ?? false,
        sets: re?.plan ? [] : !mine.length && re ? re.sets
          : mine.map((s) => ({ type: s.type, kg: s.kg ?? null, reps: s.reps != null ? [s.reps, s.reps] : null, durationS: s.durationS ?? null })),
      };
    }),
    updatedAt: Date.now(),
  };
}

/**
 * A new workout as a copy of his last one of its kind (Thu 10/22, his words: "when I start a new workout, whether that
 * being pull, push, or legs, it should copy the last workout I did. And if I wanted to copy the default template for
 * each workout, then I can specify so"). The last workout's exercises in its order, each with the sets he ticked
 * (type, count, kg); programme lifts keep their table targets, with at least as many sets as last time (buildSession);
 * an entry of only holds stays holds (his leg extension holds after Legs); an exercise he skipped comes with the
 * template's sets. Id, title and settings stay the template's, so the rotation and "update routine?" still work.
 */
export function routineFromLast(routine, last, lastSets) {
  const used = new Set();
  const exercises = (last.exercises || []).map((e) => {
    const mine = lastSets.filter((s) => s.exKey === e.key && s.done).sort((a, b) => a.order - b.order);
    const holdsOnly = mine.length > 0 && mine.every((s) => s.type === 'hold');
    const re = holdsOnly ? null : (routine?.exercises || []).find((x) => !used.has(x.key) && (x.exerciseId === e.exerciseId || x.name === e.name));
    if (re) used.add(re.key);
    const copied = mine.filter((s) => !(re?.warmup && s.type === 'warmup'))
      .map((s) => ({ type: s.type, kg: s.kg ?? null, reps: s.reps != null ? [s.reps, s.reps] : null, durationS: s.durationS ?? null }));
    // Skipped last time with a reason (Thu 10/22, his words: "skipped this workout, do it next time, because of X"):
    // it comes back, with the reason on the card.
    const why = e.skipped && !mine.length ? `Skipped last time${last.startedAt ? ` (${formatDay(new Date(last.startedAt))})` : ''}${e.skipped.reason ? `: ${e.skipped.reason}` : ''}.` : '';
    return {
      key: newKey(), exerciseId: e.exerciseId, name: re?.name ?? e.name, restSeconds: re?.restSeconds ?? e.restSeconds ?? null,
      notes: [re?.notes ?? e.notes ?? '', why].filter(Boolean).join('\n'), plan: re?.plan ?? null, role: re?.role ?? e.role ?? null, supersetId: e.supersetId ?? null,
      warmup: re?.warmup ?? false, sets: copied.length ? copied : re?.sets ?? [],
      ...(e.skipped && !mine.length ? { skippedLast: { reason: e.skipped.reason || '', date: last.startedAt ? isoDate(new Date(last.startedAt)) : null } } : {}),
    };
  });
  return { ...routine, exercises, copiedFrom: last.id };
}

/** The last finished workout before this one of the same kind: same day type, else same routine, else same title. */
export function previousSame(session, sessions) {
  const same = session.dayType ? (s) => s.dayType === session.dayType
    : session.routineId ? (s) => s.routineId === session.routineId
      : (s) => s.title === session.title;
  return sessions.filter((s) => s.id !== session.id && s.status === 'done' && s.kind !== 'holds' && s.startedAt < session.startedAt && same(s))
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}
