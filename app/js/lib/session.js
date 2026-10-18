// Building and summarising a workout session. Pure functions; the views save the results.
// A session holds its exercise list; every set is its own record (so sync can never lose one).
import { targetFor } from './targets.js';
import { weekColumn } from './programme.js';
import { effectiveKg } from './exercise-types.js';
import { newId, newKey, defaultSets } from './routines.js';
import { warmupSets } from './plates.js';
import { activeBridge } from './history.js';
import { confirmedKg } from './progression.js';
import { lighterTarget, lighterKg, shortReps } from './readiness.js';

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
 */
export function buildSession({ routine, meta, programmeRoutines = [], lib, history, today, now = Date.now(), smallestPlate = 1.25, gym = null, warmupSteps, sameRoutine = false, bodyweightKg = null, progress = [], lighter = null }) {
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
    const last = history.last(re.name);
    const lastHeaviest = last?.heaviest ? { ...last.heaviest, date: last.date } : null;
    const entry = {
      key: newKey(), exerciseId: re.exerciseId, name: re.name, type: ex.type || 'weight_reps', capClass: ex.capClass ?? null,
      barKg: ex.barKg ?? null, restSeconds: re.restSeconds ?? ex.restSeconds ?? null, notes: re.notes || '', role: re.role ?? null,
      supersetId: re.supersetId ?? null, target: null,
    };
    let planned = [];
    const pe = re.plan ? planExerciseFor(programmeRoutines, re.plan) : null;
    const easy = !!lighter && (lighter.all || (lighter.names || []).includes(re.name));
    if (pe) {
      const tAt = (w) => targetFor({ plan: pe, week: w, last: lastHeaviest, barKg: ex.barKg ?? null, smallestPlate, progressKg: w > 4 ? confirmedKg(progress, routine.dayType, w, pe.name)?.kg ?? null : null });
      let t = tAt(week);
      if (easy) {
        const l = lighterTarget({ week, targetAt: tAt, params: lighter.params, barKg: ex.barKg ?? null, smallestPlate });
        t = { ...t, kg: t.bodyweight ? t.kg : l.kg ?? t.kg, reps: l.reps, why: `${l.why}${t.kg != null && !t.bodyweight ? ` (planned ${t.kg})` : ''}`, lighter: true };
      }
      entry.target = t;
      entry.capClass = pe.capClass ?? entry.capClass;
      planned = Array.from({ length: t.sets }, () => ({ type: 'normal', kg: t.bodyweight ? null : t.kg, reps: null, target: { kg: t.kg, reps: t.reps } }));
    } else {
      const base = re.sets?.length ? re.sets : defaultSets(entry.type);
      // P11: weights follow the last session (decision 10), set by set, unless the routine is switched to its own weights.
      const follow = routine?.followLast !== false;
      const prev = follow ? history.previous(re.name, sameRoutine && routine ? { routineId: routine.id, dayType: routine.dayType } : null) : null;
      const seen = { warmup: 0, working: 0, hold: 0 };
      planned = base.map((s) => {
        const kind = kindOf(s);
        const fromLast = prev ? prev[kind]?.[seen[kind]]?.kg ?? null : null;
        seen[kind]++;
        const fallback = kind === 'working' ? lastHeaviest?.kg ?? null : null;
        let kgGuess = follow ? fromLast ?? s.kg ?? fallback : s.kg ?? fallback;
        let reps = Array.isArray(s.reps) ? s.reps : s.reps ? [s.reps, s.reps] : null;
        if (easy && kind === 'working') {
          kgGuess = lighterKg(kgGuess, { params: lighter.params, barKg: ex.barKg ?? null, smallestPlate });
          reps = shortReps(reps, lighter.params?.repsShort ?? 2);
        }
        return { type: s.type, kg: kgGuess, reps: null, durationS: s.type === 'hold' ? s.durationS ?? 30 : s.durationS ?? null, target: { kg: kgGuess, reps } };
      });
      if (lastHeaviest && !re.sets?.length) entry.target = { kg: lastHeaviest.kg, reps: null, why: `last load (${lastHeaviest.kg})` };
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
    session.exercises.push(entry);
    for (const p of planned) {
      sets.push({ id: newSetId(), sessionId: id, exKey: entry.key, order: order++, done: false, doneAt: null, rpe: null, note: '', ...p });
    }
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
  let volume = 0; let done = 0; let total = 0;
  for (const s of sets) {
    if (s.type === 'warmup' || s.type === 'hold') continue;
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
export function setTimerView({ startedAt, targetS, readyUntil = 0 }, now = Date.now()) {
  const mmss = (x) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  if (readyUntil && now < readyUntil) return { elapsedS: 0, targetS, reached: false, ready: true, text: `GET READY ${Math.ceil((readyUntil - now) / 1000)}` };
  const elapsedS = Math.max(0, Math.floor((now - Math.max(startedAt, readyUntil || 0)) / 1000));
  const reached = targetS > 0 && elapsedS >= targetS;
  return { elapsedS, targetS, reached, ready: false, text: targetS > 0 ? `${mmss(elapsedS)} / ${mmss(targetS)}` : mmss(elapsedS) };
}

/** Seconds to fill when a set timer is stopped: at least 1, counted from the end of GET READY; null during it. */
export const setTimerResult = ({ startedAt, readyUntil = 0 }, now = Date.now()) => (readyUntil && now < readyUntil ? null : Math.max(1, Math.round((now - Math.max(startedAt, readyUntil || 0)) / 1000)));
