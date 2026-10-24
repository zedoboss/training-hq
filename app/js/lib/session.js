// Building and summarising a workout session. Pure functions; the views save the results.
// A session holds its exercise list; every set is its own record (so sync can never lose one).
import { targetFor, stepFor, repNotes, loadable, jumpFrom, dayOf } from './targets.js';
import { weekColumn } from './programme.js';
import { effectiveKg } from './exercise-types.js';
import { newId, newKey, defaultSets } from './routines.js';
import { warmupSets } from './plates.js';
import { activeBridge } from './history.js';
import { confirmedKg } from './progression.js';
import { lighterTarget, lighterKg, shortReps } from './readiness.js';
import { kg as kgText } from './loads.js';

export const newSetId = () => newId('set');

function planExerciseFor(programmeRoutines, plan) {
  const r = programmeRoutines.find((x) => x.id === plan.routine);
  return r?.exercises.find((e) => e.comebackName === plan.name) ?? null;
}

const kindOf = (s) => (s.type === 'hold' ? 'hold' : s.type === 'warmup' ? 'warmup' : 'working');

/**
 * Build a session (and its sets) from a routine.
 * @param {object} o
 * @param {object|null} o.routine  null for an empty session
 * @param {object|null} o.meta     programme meta
 * @param {Array} o.programmeRoutines programme routine docs
 * @param {Map|object} o.lib       exercise id -> library entry
 * @param {ReturnType<import('./history.js').buildHistory>} o.history
 * @param {string} o.today         YYYY-MM-DD
 * @param {number} o.now
 * @param {number} [o.smallestPlate] smallest plate he has (Settings), for rounding bar loads
 * @param {string|null} [o.gym]   gym tag for the session (Settings)
 * @param {Array} [o.warmupSteps] warm-up steps (Settings) for exercises marked "warm-up sets" in the routine
 * @param {boolean} [o.sameRoutine] previous values only from the same routine (Settings: previous column)
 * @param {number|null} [o.bodyweightKg] bodyweight for bodyweight exercises (Settings now, Apple Health in step 7)
 * @param {Array} [o.progress]    confirmed week 5+ numbers (collection 'progression', decision 8)
 * @param {{all:boolean, names:string[], params:object, rule:number}|null} [o.lighter]  today's check-in said "go lighter"
 * @param {Map|null} [o.holdRounds] his one-arm tendon holds, name -> rounds (oneArmHoldRounds)
 */
export function buildSession({ routine, meta, programmeRoutines = [], lib, history, today, now = Date.now(), smallestPlate = 1.25, gym = null, warmupSteps, sameRoutine = false, bodyweightKg = null, progress = [], lighter = null, holdRounds = null }) {
  const id = newId('session');
  const week = routine?.dayType && meta?.firstSessions?.[routine.dayType] ? weekColumn(meta.firstSessions[routine.dayType], today) : null;
  const session = {
    id, kind: 'workout', title: routine?.title ?? 'Workout', routineId: routine?.id ?? null, dayType: routine?.dayType ?? null, week,
    startedAt: now, endedAt: null, pausedMs: 0, pausedAt: null, status: 'active', note: '', photos: [], gym: gym || null, bodyweightKg: bodyweightKg ?? null, source: 'training-hq',
    exercises: [],
    ...(lighter ? { lighter: { all: !!lighter.all, names: lighter.names || [], rule: lighter.rule ?? null } } : {}),
  };
  const sets = [];
  let order = 0;
  for (const re of routine?.exercises || []) {
    const ex = (lib.get ? lib.get(re.exerciseId) : lib[re.exerciseId]) || { id: re.exerciseId, name: re.name, type: 'weight_reps' };
    // Sat 10/24: the last session with a working weight (a hold-only session in between doesn't count).
    const last = history.lastLifted(re.name);
    const latest = history.last(re.name);
    const lastHeaviest = last?.heaviest ? { ...last.heaviest, date: last.date } : null;
    // Thu 10/22: pain written down last time, or skipped last time (routineFromLast), changes today's number.
    const notes = repNotes(history, re.name, { skipped: re.skippedLast || null });
    const entry = {
      key: newKey(), exerciseId: re.exerciseId, name: re.name, type: ex.type || 'weight_reps', capClass: ex.capClass ?? null,
      barKg: ex.barKg ?? null, restSeconds: re.restSeconds ?? ex.restSeconds ?? null, notes: re.notes || '', role: re.role ?? null,
      supersetId: re.supersetId ?? null, target: null,
    };
    let planned = [];
    const pe = re.plan ? planExerciseFor(programmeRoutines, re.plan) : null;
    const easy = !!lighter && (lighter.all || (lighter.names || []).includes(re.name));
    if (pe) {
      const tAt = (w) => targetFor({ plan: pe, week: w, last: lastHeaviest, notes, barKg: ex.barKg ?? null, smallestPlate, equipment: ex.equipment ?? null, name: re.name, progressKg: w > 4 ? confirmedKg(progress, routine.dayType, w, pe.name)?.kg ?? null : null });
      let t = tAt(week);
      if (easy) {
        const l = lighterTarget({ week, targetAt: tAt, params: lighter.params, barKg: ex.barKg ?? null, smallestPlate });
        t = { ...t, kg: t.bodyweight ? t.kg : l.kg ?? t.kg, reps: l.reps, why: `${l.why}${t.kg != null && !t.bodyweight ? ` (planned ${t.kg})` : ''}`, lighter: true };
      }
      if (last && latest && latest !== last && latest.sets.some((x) => x.hold || x.type === 'hold') && t.kg != null && !t.bodyweight && !t.painLast) t = { ...t, why: `${dayOf(latest.date)} was holds only, so from your rep sets: ${t.why.replace(/\b[Ll]ast time\b/, dayOf(last.date))}`, holdsLast: true };
      entry.target = t;
      entry.capClass = pe.capClass ?? entry.capClass;
      planned = Array.from({ length: t.sets }, () => ({ type: 'normal', kg: t.bodyweight ? null : t.kg, reps: null, target: { kg: t.kg, reps: t.reps } }));
      // Thu 10/22, a copy of his last workout (routineFromLast): its warm-ups, drop sets and set count stay, never
      // fewer sets than the table's; the working weight is still the table's (under the 30% cap).
      if (re.sets?.length) {
        const work = re.sets.filter((x) => x.type !== 'warmup' && x.type !== 'hold');
        const warm = re.sets.filter((x) => x.type === 'warmup');
        const rows = Array.from({ length: Math.max(t.sets, work.length) }, (_, i) => {
          const type = work[i]?.type === 'dropset' || work[i]?.type === 'failure' ? work[i].type : 'normal';
          const kg = type === 'dropset' ? work[i].kg ?? null : t.bodyweight ? null : t.kg;
          return { type, kg, reps: null, target: { kg: type === 'dropset' ? kg : t.kg, reps: t.reps } };
        });
        planned = [...(re.warmup ? [] : warm.map((w) => ({ type: 'warmup', kg: w.kg ?? null, reps: null, target: { kg: w.kg ?? null, reps: w.reps } }))), ...rows];
      }
    } else {
      const base = re.sets?.length ? re.sets : defaultSets(entry.type);
      // P11: weights follow the last session (decision 10), set by set, unless the routine is switched to its own weights.
      const follow = routine?.followLast !== false;
      const prev = follow ? history.previous(re.name, sameRoutine && routine ? { routineId: routine.id, dayType: routine.dayType } : null) : null;
      const seen = { warmup: 0, working: 0, hold: 0 };
      planned = base.map((s) => {
        const kind = kindOf(s);
        const prevSet = prev ? prev[kind]?.[seen[kind]] ?? null : null;
        const fromLast = prevSet?.kg ?? null;
        seen[kind]++;
        const fallback = kind === 'working' ? lastHeaviest?.kg ?? null : null;
        let reps = Array.isArray(s.reps) ? s.reps : s.reps ? [s.reps, s.reps] : null;
        // Decision 33 (Thu 10/22): a working set goes one step over the same set last time when its reps were reached.
        const step = stepFor({ barKg: ex.barKg ?? null, equipment: ex.equipment ?? null, name: re.name, smallestPlate });
        // Holds never step up (his knee hold is the full stack; the load comes from his tendon note).
        const timed = /\bhold\b/i.test(re.name) || /duration/.test(entry.type);
        const up = follow && !timed && fromLast != null && (s.type === 'normal' || s.type === 'failure') && (prevSet?.reps ?? 0) >= (reps?.[0] ?? 0) && !notes.pain && !notes.skipped ? step : 0;
        let kgGuess = follow ? (fromLast != null ? Math.round((fromLast + up) * 100) / 100 : s.kg ?? fallback) : s.kg ?? fallback;
        // Hurt last time after a jump: the last load that didn't hurt, plus a step (his example: 51 -> 61 hurt -> 54).
        const good = notes.pain?.prevGood?.kg;
        if (kind === 'working' && notes.pain && kgGuess != null && good != null && kgGuess > good + step + 1e-9) kgGuess = Math.round((good + step) * 100) / 100;
        // Sat 10/24: a jump last time (over 30% on the weeks before, lib/targets.js jumpOf) isn't the new start.
        const j = !notes.pain && !notes.skipped ? jumpFrom(notes.jump, step) : null;
        if (kind === 'working' && j && kgGuess != null && kgGuess > j.limit + 1e-9) kgGuess = Math.max(j.base.kg, Math.min(Math.round((j.base.kg + step) * 100) / 100, loadable(j.limit, { barKg: ex.barKg ?? null, smallestPlate })));
        if (easy && kind === 'working') {
          kgGuess = lighterKg(kgGuess, { params: lighter.params, barKg: ex.barKg ?? null, smallestPlate });
          reps = shortReps(reps, lighter.params?.repsShort ?? 2);
        }
        return { type: s.type, kg: kgGuess, reps: null, durationS: s.type === 'hold' ? s.durationS ?? 30 : s.durationS ?? null, target: { kg: kgGuess, reps } };
      });
      if (lastHeaviest && !re.sets?.length) entry.target = { kg: lastHeaviest.kg, reps: null, why: `last load (${lastHeaviest.kg})` };
      if (notes.pain) entry.target = { ...(entry.target || {}), kg: planned.find((x) => x.type === 'normal')?.kg ?? entry.target?.kg ?? null, why: `Last time ${notes.pain.kg} kg hurt ("${notes.pain.note.slice(0, 70)}"). Only if it doesn't hurt today; if it does, skip it`, painLast: true };
      else if (notes.skipped) entry.target = { ...(entry.target || {}), kg: planned.find((x) => x.type === 'normal')?.kg ?? entry.target?.kg ?? null, why: `Skipped last time${notes.skipped.reason ? ` (${notes.skipped.reason})` : ''}: same as before`, skippedLast: true };
      if (easy) entry.target = { ...(entry.target || {}), kg: planned.find((p) => p.type === 'normal')?.kg ?? entry.target?.kg ?? null, why: `lighter (check-in): ${lighter.params?.week1Pct ?? 20}% under`, lighter: true };
    }
    // P5: calculated warm-up sets from today's first working weight (Settings steps), loadable on the bar and plates.
    // They take the place of any plain warm-up rows the routine has.
    if (re.warmup) {
      planned = planned.filter((p) => p.type !== 'warmup');
      const work = planned.find((p) => p.type !== 'hold' && p.kg != null);
      const ws = work ? warmupSets(work.kg, { barKg: entry.barKg, steps: warmupSteps, smallestPlate }) : [];
      planned = [...ws.map((w) => ({ type: 'warmup', kg: w.kg, reps: null, target: { kg: w.kg, reps: [w.reps, w.reps] } })), ...planned];
    }
    // Sat 10/24: one arm per set (his notes, or a tendon hold he does one arm at a time): rounds of right then left.
    const holdsOnly = planned.some((p) => p.type === 'hold') && planned.every((p) => p.type === 'hold' || p.type === 'warmup');
    if (oneArmIn(history, re.name, [re.notes]) || (holdsOnly && holdRounds?.get(re.name))) entry.oneArm = true;
    session.exercises.push(entry);
    let mine = planned.map((p, i) => ({ id: newSetId(), sessionId: id, exKey: entry.key, order: i, done: false, doneAt: null, rpe: null, note: '', ...p }));
    if (entry.oneArm) mine = [...mine, ...pairUpRows(mine, { rounds: entry.target?.sets ?? null, holdRounds: holdRounds?.get(re.name) ?? null })].sort((a, b) => a.order - b.order);
    for (const x of mine) sets.push({ ...x, order: order++ });
  }
  return { session, sets };
}

/** Sets for an exercise added during a session. */
export function setsForAdded(sessionId, entry, lastHeaviest, startOrder) {
  return defaultSets(entry.type).map((s, i) => ({
    id: newSetId(), sessionId, exKey: entry.key, order: startOrder + i, done: false, doneAt: null, rpe: null, note: '',
    type: s.type, kg: lastHeaviest?.kg ?? null, reps: null, durationS: s.durationS ?? null, target: { kg: lastHeaviest?.kg ?? null, reps: s.reps ?? null },
  }));
}

/** Elapsed ms, not counting paused time. */
export function elapsedMs(session, now = Date.now()) {
  const end = session.endedAt ?? now;
  const paused = session.pausedMs + (session.pausedAt ? end - session.pausedAt : 0);
  return Math.max(0, end - session.startedAt - paused);
}

export function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Volume and set counts. Warm-ups and holds don't count toward volume or the set count. Bodyweight: the session's. */
export function summarize(session, sets, bodyweightKg = session.bodyweightKg ?? null) {
  const types = new Map(session.exercises.map((e) => [e.key, e.type]));
  const skipped = new Set(session.exercises.filter((e) => e.skipped).map((e) => e.key));
  let volume = 0; let done = 0; let total = 0;
  for (const s of sets) {
    if (s.type === 'warmup' || s.type === 'hold') continue;
    // Thu 10/22: a skipped exercise's sets aren't owed today.
    if (skipped.has(s.exKey) && !s.done) continue;
    total++;
    if (!s.done) continue;
    done++;
    volume += effectiveKg(types.get(s.exKey), s.kg, bodyweightKg) * (s.reps ?? 0);
  }
  return { volume: Math.round(volume), done, total };
}

/** Bodyweight exercises: the load the 30% guard compares (bodyweight + added, or bodyweight - assistance). */
export const BODYWEIGHT_TYPES = ['weighted_bodyweight', 'assisted_bodyweight', 'reps_only'];
export function guardLoad(type, kg, bodyweightKg) {
  if (!BODYWEIGHT_TYPES.includes(type) || bodyweightKg == null || kg == null) return kg;
  return Math.round(effectiveKg(type, kg, bodyweightKg) * 100) / 100;
}

/** Previous value for a set: same kind, same position among that kind. */
export function previousFor(prev, sets, set) {
  const kind = kindOf(set);
  const sameKind = sets.filter((s) => s.exKey === set.exKey && kindOf(s) === kind).sort((a, b) => a.order - b.order);
  const i = sameKind.findIndex((s) => s.id === set.id);
  return prev?.[kind]?.[i] ?? null;
}

/**
 * One tap on the "previous" column copies last time's numbers into a set, but never into a set already ticked (Thu
 * 10/22, his words: "fix it so a logged set is never overwritten": at 10:38 AM, on leg curls, a tap on the squat card's
 * previous column put last time's 51.8 kg x 8 over the 61.3 kg x 8 he had ticked at 10:27 AM). Returns the set with
 * the copy, or null when nothing may change. A ticked set changes only when he types into it.
 */
export function copyPrevious(set, previous) {
  if (!set || set.done || !previous) return null;
  return { ...set, kg: previous.kg ?? set.kg, reps: previous.reps ?? set.reps, durationS: previous.durationS ?? set.durationS };
}

/**
 * The sets a load from the plate calculator goes into: the next set not ticked (all: every set not ticked, holds and
 * warm-ups aside). Never a ticked set: with every set ticked, nothing (the calculator is then only a calculator).
 */
export function plateTargets(sets, { all = false } = {}) {
  const open = sets.filter((s) => !s.done);
  if (all) return open.filter((s) => s.type !== 'hold' && s.type !== 'warmup');
  const next = open.find((s) => s.type !== 'hold' && s.type !== 'warmup') || open[0];
  return next ? [next] : [];
}

/** What to fill when a set is ticked with empty fields: previous values, then the target. */
export function fillForTick(set, previous) {
  const out = {};
  if (set.type === 'hold') { if (set.durationS == null) out.durationS = previous?.durationS ?? 30; return out; }
  if (set.reps == null) out.reps = previous?.reps ?? set.target?.reps?.[0] ?? null;
  if (set.kg == null && previous?.kg != null) out.kg = previous.kg;
  return out;
}

/**
 * Typical length of this kind of session: median of the last 3 of the same day type
 * (Training HQ sessions and the Hevy bridge), in ms. Null when there is nothing to go on.
 */
export function typicalDurationMs(dayType, { sessions = [], bridge: rawBridge = null, now = Date.now() } = {}) {
  if (!dayType) return null;
  const bridge = activeBridge(rawBridge, sessions);
  const own = sessions.filter((s) => s.status === 'done' && s.dayType === dayType && s.endedAt)
    .map((s) => ({ at: s.startedAt, ms: s.endedAt - s.startedAt - (s.pausedMs || 0) }));
  const hevy = (bridge?.lastSessions || []).filter((s) => s.dayType === dayType && s.start && s.end)
    .map((s) => ({ at: Date.parse(s.start), ms: Date.parse(s.end) - Date.parse(s.start) }));
  const recent = [...own, ...hevy].filter((x) => x.ms > 10 * 60000 && x.ms < 3 * 3600000 && x.at < now)
    .sort((a, b) => b.at - a.at).slice(0, 3).map((x) => x.ms).sort((a, b) => a - b);
  if (!recent.length) return null;
  return recent[Math.floor(recent.length / 2)];
}

/**
 * Expected finish. Before 3 sets are ticked: from the typical length of this session type (or 2.5 min a set).
 * After that: today's pace (time per ticked set) times the sets left. Every set counts, warm-ups and holds too.
 * @returns {{at:number, basis:'pace'|'history'|'estimate', leftMs:number}|null}
 */
export function expectedFinish({ session, sets, typicalMs = null, now = Date.now() }) {
  const total = sets.length;
  const done = sets.filter((s) => s.done).length;
  const elapsed = elapsedMs(session, now);
  const left = total - done;
  if (!total) return typicalMs ? { at: now + Math.max(0, typicalMs - elapsed), basis: 'history', leftMs: Math.max(0, typicalMs - elapsed) } : null;
  if (left === 0) return { at: now, basis: 'pace', leftMs: 0 };
  let leftMs;
  let basis;
  if (done >= 3) { leftMs = left * (elapsed / done); basis = 'pace'; }
  else if (typicalMs) { leftMs = Math.max(typicalMs - elapsed, left * (typicalMs / total)); basis = 'history'; }
  else { leftMs = left * 150000; basis = 'estimate'; }
  return { at: now + leftMs, basis, leftMs };
}

/** A new active session repeating a past one: same exercises and supersets, sets prefilled with what was done. */
export function copySession(past, pastSets, now = Date.now()) {
  const id = newId('session');
  const keyMap = new Map();
  const did = new Set(pastSets.filter((x) => x.done).map((x) => x.exKey));
  const exercises = past.exercises.filter((e) => did.has(e.key)).map((e) => { const key = newKey(); keyMap.set(e.key, key); return { ...e, key }; });
  const sets = pastSets.filter((x) => x.done && keyMap.has(x.exKey)).sort((a, b) => a.order - b.order).map((x, i) => ({
    id: newSetId(), sessionId: id, exKey: keyMap.get(x.exKey), order: i, done: false, doneAt: null, rpe: null, note: '',
    type: x.type, kg: x.kg ?? null, reps: null, durationS: x.durationS ?? null, distanceM: x.distanceM ?? null,
    target: { kg: x.kg ?? null, reps: x.reps != null ? [x.reps, x.reps] : null },
  }));
  return {
    session: { ...past, id, exercises, startedAt: now, endedAt: null, pausedMs: 0, pausedAt: null, status: 'active', note: '', photos: [], copiedFrom: past.id },
    sets,
  };
}

/** Superset groups in session order: supersetId -> {letter, keys[]} */
export function supersetGroups(exercises) {
  const groups = new Map();
  for (const e of exercises) {
    if (!e.supersetId) continue;
    if (!groups.has(e.supersetId)) groups.set(e.supersetId, { letter: String.fromCharCode(65 + groups.size), keys: [] });
    groups.get(e.supersetId).keys.push(e.key);
  }
  return groups;
}

/** In a superset the rest timer starts after the last exercise of the group; otherwise after every set. */
export function restAfter(exercises, key) {
  const ex = exercises.find((e) => e.key === key);
  if (!ex?.supersetId) return true;
  const keys = exercises.filter((e) => e.supersetId === ex.supersetId).map((e) => e.key);
  return keys[keys.length - 1] === key;
}

/** RPE choices with the reps-in-reserve hint. */
export const RPE = [[10, 'nothing left'], [9.5, 'maybe 1 more'], [9, '1 more'], [8.5, '1-2 more'], [8, '2 more'], [7.5, '2-3 more'], [7, '3 more'], [6, '4+ more']];

/**
 * Timer for a time-based set (P24). It counts up from Start; the target is a cue (a beep), not a stop, because a hold
 * may go past it ("30 seconds or more"). Stop fills the seconds with the time actually done.
 * A14: a hold set starts with GET READY until `readyUntil`; its seconds count from there.
 * @returns {{elapsedS:number, targetS:number, reached:boolean, ready:boolean, text:string}}
 */
// Tue 10/20, his hold at the gym: "it went past 30, it kept on going and going". A set with a target counts DOWN to 0
// (leftS) and ends there; one without a target counts up. readyS: GET READY seconds left.
export function setTimerView({ startedAt, targetS, readyUntil = 0 }, now = Date.now()) {
  const mmss = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  if (readyUntil && now < readyUntil) {
    const readyS = Math.ceil((readyUntil - now) / 1000);
    return { elapsedS: 0, targetS, leftS: targetS > 0 ? targetS : null, readyS, reached: false, ready: true, text: `GET READY ${readyS}` };
  }
  const elapsedS = Math.max(0, Math.floor((now - Math.max(startedAt, readyUntil || 0)) / 1000));
  const reached = targetS > 0 && elapsedS >= targetS;
  const leftS = targetS > 0 ? Math.max(0, Math.ceil(targetS - (now - Math.max(startedAt, readyUntil || 0)) / 1000)) : null;
  return { elapsedS, targetS, leftS, readyS: 0, reached, ready: false, text: targetS > 0 ? `${mmss(leftS)} left` : mmss(elapsedS) };
}

/** Seconds to fill when a set timer is stopped: at least 1, counted from the end of GET READY, at most the target
 *  (it ends at 0); null during GET READY. */
export function setTimerResult({ startedAt, targetS = 0, readyUntil = 0 }, now = Date.now()) {
  if (readyUntil && now < readyUntil) return null;
  const s = Math.max(1, Math.round((now - Math.max(startedAt, readyUntil || 0)) / 1000));
  return targetS > 0 ? Math.min(targetS, s) : s;
}

const rangeText = (r) => (Array.isArray(r) ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`) : r ?? '');

/** The next set to do: "Hip Thrust (Machine) · set 2 of 2 · 45 kg × 10-12", or '' when every set is ticked. */
export function nextSetText(session, sets) {
  // Thu 10/22: an exercise he skipped today is passed over.
  const skipped = new Set((session.exercises || []).filter((e) => e.skipped).map((e) => e.key));
  const ordered = [...sets].filter((s) => !skipped.has(s.exKey)).sort((a, b) => a.order - b.order);
  const next = ordered.find((s) => !s.done);
  if (!next) return '';
  const ex = (session.exercises || []).find((e) => e.key === next.exKey);
  const mine = ordered.filter((s) => s.exKey === next.exKey);
  const kg = next.kg ?? next.target?.kg;
  const reps = rangeText(next.target?.reps);
  const what = next.type === 'hold' ? `hold ${next.durationS ?? 30} s` : [kg != null ? `${kg} kg` : '', reps ? `× ${reps}` : ''].filter(Boolean).join(' ');
  const kind = next.type === 'warmup' ? 'warm-up' : next.type === 'hold' ? 'hold' : 'set';
  // Sat 10/24: a one-arm exercise counts rounds, "round 2 of 3 · left arm".
  const arm = ex?.oneArm ? armOf(mine, next) : null;
  const work = mine.filter((x) => x.type !== 'warmup' && (x.type === 'hold') === (next.type === 'hold'));
  const where = arm ? `${next.type === 'hold' ? 'hold round' : 'round'} ${arm.round} of ${Math.ceil(work.length / 2)} · ${arm.arm} arm` : `${kind} ${mine.indexOf(next) + 1} of ${mine.length}`;
  return [ex?.name || 'Next', where, what].filter(Boolean).join(' · ');
}

// Sat 10/24: an exercise his notes call one-arm ("single arm", "desna pa leva" = right then left) is logged one arm per
// set, right then left straight after; each pair is one round (the coach's tools read it the same way).
export const ONE_ARM = /\b(?:single|one)[ -]?arm\b|\bdesna\s+pa\s+leva\b|\bright\s+(?:arm\s+)?(?:then|and then|,)\s*left\b|\bunilateral\b/i;

const YEAR_MS = 365 * 86400000;
/**
 * True when his notes on this exercise (today's, or a past session's in `history` from the year before its latest)
 * say he logs one arm per set, or a past session of it was marked one-arm. Older notes don't count: a 2024 bench note
 * "then one arm 100 kg" isn't how he benches now.
 */
export function oneArmIn(history, name, notes = []) {
  if (notes.some((n) => ONE_ARM.test(n || ''))) return true;
  const all = history?.all(name) || [];
  const since = Math.max(0, ...all.map((e) => e.at || 0)) - YEAR_MS;
  return all.some((e) => e.oneArm || ((e.at || 0) >= since && ONE_ARM.test(e.note || '')));
}

/** His tendon holds done one arm at a time (sides "Right arm", "Left arm"): exercise name -> rounds (its sets). */
export function oneArmHoldRounds(tendonDocs = []) {
  const out = new Map();
  for (const a of tendonDocs || []) for (const h of a?.holds || []) if (h?.exercise && (h.sides?.length ?? 0) > 1 && h.sets) out.set(h.exercise, h.sets);
  return out;
}

/**
 * Sat 10/24, his words at the gym: "My feature didnt get built??? 2 sets per round two arms". On a one-arm exercise a
 * round is two sets, right then left: the rep sets and the holds each come in pairs, at least `rounds` x 2 rep sets (the
 * table's sets are rounds) and `holdRounds` x 2 holds (his cupping hold, 3 x 30 s = 6 sets). The rows to add, each a
 * copy of the same arm's row a round earlier; a kind he has none of, or has ticked every set of, gets none.
 * @param {Array} mine this exercise's sets
 * @returns {Array} new sets (ids, orders after that kind's last row)
 */
export function pairUpRows(mine, { rounds = null, holdRounds = null } = {}) {
  const out = [];
  const sorted = [...mine].sort((a, b) => a.order - b.order);
  for (const hold of [false, true]) {
    const rows = sorted.filter((x) => x.type !== 'warmup' && (x.type === 'hold') === hold);
    if (!rows.length || rows.every((x) => x.done)) continue;
    const want = (hold ? holdRounds : rounds) || 0;
    let need = Math.max(rows.length, want * 2);
    need += need % 2;
    const last = rows.at(-1);
    for (let i = rows.length; i < need; i++) {
      const src = [...rows, ...out.filter((x) => (x.type === 'hold') === hold)][i - 2] || last;
      out.push({ id: newSetId(), sessionId: src.sessionId, exKey: src.exKey, order: last.order + (i - rows.length + 1) / 100, done: false, doneAt: null, rpe: null, note: '',
        type: src.type, kg: src.kg ?? null, reps: null, durationS: src.durationS ?? null, target: src.target ?? null });
    }
  }
  return out;
}

/** "1R", "1L", "H2R": a one-arm set's row label, round and arm (its type letter first). */
export function armLabel(sets, x, short = null) {
  const a = armOf(sets, x);
  return a ? `${short || ''}${a.round}${a.arm === 'left' ? 'L' : 'R'}` : null;
}

/** For a set of a one-arm exercise: { round, arm } from its place among the working sets, or among the holds for a
 *  hold (a hold's own arm wins). */
export function armOf(sets, x) {
  if (x.type === 'warmup') return null;
  const i = sets.filter((y) => y.exKey === x.exKey && y.type !== 'warmup' && (y.type === 'hold') === (x.type === 'hold')).sort((a, b) => a.order - b.order).findIndex((y) => y === x || (x.id != null && y.id === x.id));
  return i < 0 ? null : { round: Math.floor(i / 2) + 1, arm: x.arm || (i % 2 ? 'left' : 'right') };
}

// Sat 10/24, his words at the gym: "The set is over and cupping is next. But clearly it's not... My next one is
// crunches." The rest after his last cupping round said "Rest over. Cupping: next set.": it named the exercise just
// ticked, never what came next. What a rest leads to: this exercise's next set while it has sets left, else the next
// exercise on the card with sets left, else one left earlier; an exercise skipped today never.
export function nextAfter(exercises, sets, fromKey) {
  const order = (exercises || []).filter((e) => !e.skipped).map((e) => e.key);
  const i = order.indexOf(fromKey);
  const keys = i < 0 ? order : [...order.slice(i), ...order.slice(0, i)];
  for (const key of keys) {
    const set = sets.filter((x) => x.exKey === key).sort((a, b) => a.order - b.order).find((x) => !x.done);
    if (set) return { ex: exercises.find((e) => e.key === key), set };
  }
  return null;
}

/**
 * The next set in words, for "Rest over" and the rest bar: "Crunch (Machine): set 1, 23 kg × 10-15", on a one-arm
 * exercise "Cupping: round 2, left arm, 9 kg × 15"; when every set is ticked, "Every set ticked: finish the workout".
 * @param {{ex: object, set: object}|null} n from nextAfter
 * @param {Array} sets the session's sets
 * @param {boolean} oneArm his notes call this exercise one-arm (oneArmIn)
 */
export function nextAfterText(n, sets, oneArm = false) {
  if (!n) return 'Every set ticked: finish the workout';
  const { ex, set } = n;
  const mine = sets.filter((x) => x.exKey === ex.key).sort((a, b) => a.order - b.order);
  const t = set.target || {};
  const arm = oneArm ? armOf(mine, set) : null;
  const no = mine.filter((x) => x.type !== 'warmup' && x.type !== 'hold').indexOf(set) + 1;
  const hold = `hold ${set.durationS ?? t.durationS ?? 30} s`;
  const word = set.type === 'warmup' ? 'warm-up' : arm ? `round ${arm.round}, ${arm.arm} arm${set.type === 'hold' ? `, ${hold}` : ''}` : set.type === 'hold' ? hold : set.type === 'dropset' ? 'drop set' : `set ${no}${set.type === 'failure' ? ' (to failure)' : ''}`;
  const kgv = set.kg ?? t.kg ?? null;
  const reps = set.type === 'hold' ? '' : rangeText(set.reps ?? t.reps);
  const bw = Boolean(t.bodyweight) || BODYWEIGHT_TYPES.includes(ex.type);
  const load = bw ? (ex.type === 'weighted_bodyweight' && kgv > 0 ? `bodyweight +${kgText(kgv)} kg` : 'bodyweight') : kgv != null ? `${kgText(kgv)} kg` : '';
  const what = [load, reps ? `× ${reps}` : ''].filter(Boolean).join(' ');
  return `${ex.name}: ${[word, what].filter(Boolean).join(', ')}`;
}
