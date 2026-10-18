// Squat Depth runs (5.3, 5.4): what one camera run did, rep by rep, and how it fills the squat set being logged.
// A run is stored in the synced collection 'squats':
//   {id, startedAt, endedAt, mode: 'camera', targetDeg, standDeg, reps: [{at, minDeg, good, late, early}],
//    good, shallow, lowDeg, highDeg, sessionId, exKey, setId, exerciseName}
// lowDeg is the deepest point of the run (the smallest knee angle, any rep); highDeg the shallowest good rep.
// A set filled from a run keeps set.depth = {good, shallow, lowDeg, highDeg, targetDeg, runId}.
import { setFields } from './exercise-types.js';
import { isoDate, formatTime } from './time.js';

const round1 = (x) => Math.round(x * 10) / 10;
const rand = () => Math.random().toString(36).slice(2, 8);
export const newRunId = (now = Date.now()) => `squat-${now.toString(36)}-${rand()}`;

/** Squat Depth's own settings live on the device (as in the original app); the target is shown elsewhere too. */
export const SETTINGS_KEY = 'thq.squat-depth-settings-v2';
export function savedTargetDeg(fallback = 75) {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')?.targetDeg;
    return Number.isFinite(v) ? v : fallback;
  } catch { return fallback; }
}

/** Exercises the camera can measure: a squat by name, logged with reps (the wall squat hold is a hold). */
export const isSquatExercise = (ex) => !!ex && /squat/i.test(ex.name || '') && setFields(ex.type, 'normal').includes('reps');

/** A new run. link: {sessionId, exKey, setId, exerciseName} when started from a set, else null. */
export function startRun({ startedAt = Date.now(), mode = 'camera', targetDeg, standDeg, link = null } = {}) {
  return {
    id: newRunId(startedAt), startedAt, endedAt: null, mode, targetDeg, standDeg, reps: [],
    sessionId: link?.sessionId ?? null, exKey: link?.exKey ?? null, setId: link?.setId ?? null, exerciseName: link?.exerciseName ?? null,
    pendingLate: false,
  };
}

/** Record a RepMachine event. 'depth' marks how the coming rep's ding fired; 'rep' and 'shallow' end a rep. */
export function addRepEvent(run, ev, at = Date.now()) {
  if (!run || !ev) return run;
  if (ev.type === 'depth') { run.pendingLate = !!ev.late; return run; }
  if (ev.type === 'rep') run.reps.push({ at, minDeg: round1(ev.minAngle), good: true, late: run.pendingLate, early: !!ev.anticipated });
  else if (ev.type === 'shallow') run.reps.push({ at, minDeg: round1(ev.minAngle), good: false, late: false, early: false });
  else return run;
  run.pendingLate = false;
  return run;
}

/** Start counting again (Reset counts, replay of a video). */
export function resetReps(run) { if (run) { run.reps = []; run.pendingLate = false; } return run; }

export function summarizeRun(run) {
  const reps = run?.reps || [];
  const good = reps.filter((r) => r.good);
  return {
    good: good.length,
    shallow: reps.length - good.length,
    total: reps.length,
    lowDeg: reps.length ? Math.min(...reps.map((r) => r.minDeg)) : null,
    highDeg: good.length ? Math.max(...good.map((r) => r.minDeg)) : null,
    targetDeg: run?.targetDeg ?? null,
  };
}

/** The record to keep when the run ends, or null when nothing was counted (no rep, no shallow rep). */
export function finishRun(run, endedAt = Date.now()) {
  if (!run || !run.reps.length) return null;
  const { pendingLate, ...rest } = run;
  const s = summarizeRun(run);
  return { ...rest, endedAt, good: s.good, shallow: s.shallow, lowDeg: s.lowDeg, highDeg: s.highDeg };
}

/**
 * Sets the result can go into: every set of the squat exercises in the session except holds, in order, with the
 * default one: the linked exercise's (or the first squat exercise's) first set not ticked yet, else its last set.
 * Returns {choices: [{setId, exKey, name, label, kg, done}], defaultId} (choices empty when there is nothing to fill).
 */
export function fillChoices(session, sets, { exKey = null } = {}) {
  if (!session) return { choices: [], defaultId: null };
  const squatEx = (session.exercises || []).filter(isSquatExercise);
  const choices = [];
  for (const ex of squatEx) {
    const mine = sets.filter((s) => s.sessionId === session.id && s.exKey === ex.key && s.type !== 'hold').sort((a, b) => a.order - b.order);
    let n = 0;
    for (const s of mine) {
      if (s.type !== 'warmup') n += 1;
      choices.push({ setId: s.id, exKey: ex.key, name: ex.name, label: s.type === 'warmup' ? 'W' : s.type === 'normal' ? String(n) : `${n}${s.type === 'failure' ? 'F' : s.type === 'dropset' ? 'D' : ''}`, kg: s.kg ?? s.target?.kg ?? null, done: !!s.done });
    }
  }
  const key = exKey && choices.some((c) => c.exKey === exKey) ? exKey : choices[0]?.exKey;
  const forEx = choices.filter((c) => c.exKey === key);
  const def = forEx.find((c) => !c.done) || forEx[forEx.length - 1];
  return { choices, defaultId: def?.setId ?? null };
}

/** The set with the run's result in it. withShallow: count shallow reps as reps too. */
export function fillSet(set, summary, { runId = null, withShallow = false } = {}) {
  return {
    ...set,
    reps: summary.good + (withShallow ? summary.shallow : 0),
    depth: { good: summary.good, shallow: summary.shallow, lowDeg: summary.lowDeg, highDeg: summary.highDeg, targetDeg: summary.targetDeg, runId },
  };
}

const deg = (x) => `${Math.round(x)}°`;

/** "DEPTH 8 GOOD · LOW 68°" (+ " · 1 SHALLOW"), for the set row and history. */
export function depthText(d) {
  if (!d) return '';
  return `DEPTH ${d.good} GOOD${d.lowDeg != null ? ` · LOW ${deg(d.lowDeg)}` : ''}${d.shallow ? ` · ${d.shallow} SHALLOW` : ''}`;
}

/** "8 good · 1 shallow · lowest 68°" */
export function runText(r) {
  const s = r.good != null ? r : summarizeRun(r);
  return `${s.good} good${s.shallow ? ` · ${s.shallow} shallow` : ''}${s.lowDeg != null ? ` · lowest ${deg(s.lowDeg)}` : ''}`;
}

/** Calendar markers (dayMarks extra) for squat-depth runs: {date, kind: 'squat', id, label}. */
export function squatMarks(runs = [], tz) {
  return [...runs].filter((r) => r && r.startedAt && r.reps?.length).sort((a, b) => a.startedAt - b.startedAt).map((r) => ({
    date: isoDate(new Date(r.startedAt), tz),
    kind: 'squat',
    id: r.id,
    label: `Squat Depth ${formatTime(new Date(r.startedAt), tz)} · ${runText(r)}${r.exerciseName ? ` · ${r.exerciseName}` : ''}`,
  }));
}
