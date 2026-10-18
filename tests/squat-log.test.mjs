import { test } from 'node:test';
import assert from 'node:assert/strict';
import SquatCore from '../app/js/lib/squat-core.js';
import { startRun, addRepEvent, resetReps, summarizeRun, finishRun, fillChoices, fillSet, depthText, runText, squatMarks, isSquatExercise } from '../app/js/lib/squat-log.js';

const TZ = 'Asia/Ho_Chi_Minh';
const AT = Date.UTC(2026, 9, 18, 22, 10); // Monday 10/19, 5:10 AM in Ho Chi Minh City

/** The real rep logic, fed a squat sequence, events recorded the way the screen does it. */
function runThrough(bottoms, target = 75) {
  const m = new SquatCore.RepMachine({ targetDeg: target, anticipate: false });
  const r = startRun({ startedAt: AT, targetDeg: target, standDeg: 160 });
  let t = 0;
  const step = (a) => { t += 33; const ev = m.update(a, 0, t, 33); if (ev) addRepEvent(r, ev, AT + t); };
  for (let i = 0; i < 12; i++) step(172);
  for (const b of bottoms) {
    for (let a = 172; a > b; a -= 6) step(a);
    for (let i = 0; i < 3; i++) step(b);
    for (let a = b; a < 172; a += 6) step(a);
    for (let i = 0; i < 5; i++) step(172);
  }
  return { r, m };
}

test('a run records each rep with its lowest angle: good ones and shallow ones, counts match the machine', () => {
  const { r, m } = runThrough([70, 72, 100, 68]);
  assert.deepEqual(r.reps.map((x) => [x.good, x.minDeg]), [[true, 70], [true, 72], [false, 100], [true, 68]]);
  const s = summarizeRun(r);
  assert.equal(s.good, m.good);
  assert.equal(s.shallow, m.shallow);
  assert.deepEqual({ good: s.good, shallow: s.shallow, lowDeg: s.lowDeg, highDeg: s.highDeg, targetDeg: s.targetDeg }, { good: 3, shallow: 1, lowDeg: 68, highDeg: 72, targetDeg: 75 });
});

test('the late ding flag goes with the rep it belongs to; reset starts the count again', () => {
  const r = startRun({ targetDeg: 75 });
  addRepEvent(r, { type: 'depth', late: true });
  addRepEvent(r, { type: 'rep', minAngle: 66.04, anticipated: false });
  addRepEvent(r, { type: 'depth', late: false, anticipated: true });
  addRepEvent(r, { type: 'rep', minAngle: 73.96, anticipated: true });
  addRepEvent(r, { type: 'armed' });
  assert.deepEqual(r.reps.map((x) => [x.minDeg, x.late, x.early]), [[66, true, false], [74, false, true]]);
  resetReps(r);
  assert.equal(r.reps.length, 0);
});

test('finishRun keeps nothing when no rep was counted, and the summary when there was one', () => {
  assert.equal(finishRun(startRun({ targetDeg: 75 })), null);
  const { r } = runThrough([70]);
  const doc = finishRun(r, AT + 60000);
  assert.equal(doc.good, 1);
  assert.equal(doc.lowDeg, 70);
  assert.equal(doc.endedAt, AT + 60000);
  assert.ok(!('pendingLate' in doc));
});

test('only squats logged with reps can use the camera (the wall squat hold is a hold)', () => {
  assert.ok(isSquatExercise({ name: 'Squat (Smith Machine)' }));
  assert.ok(isSquatExercise({ name: 'Smith Machine Squat', type: 'weight_reps' }));
  assert.ok(!isSquatExercise({ name: 'Toes Wall Squat Hold', type: 'duration' }));
  assert.ok(!isSquatExercise({ name: 'Leg Extension (Machine)' }));
  assert.ok(!isSquatExercise(null));
});

const session = {
  id: 'sess-1', title: 'Legs', status: 'active',
  exercises: [
    { key: 'k-squat', name: 'Squat (Smith Machine)', type: 'weight_reps' },
    { key: 'k-curl', name: 'Seated Leg Curl (Machine)', type: 'weight_reps' },
    { key: 'k-wall', name: 'Toes Wall Squat Hold', type: 'duration' },
  ],
};
const set = (id, exKey, order, extra = {}) => ({ id, sessionId: 'sess-1', exKey, order, type: 'normal', done: false, kg: 56.3, reps: null, ...extra });
const sets = [
  set('w1', 'k-squat', 0, { type: 'warmup', kg: 23.8, done: true }),
  set('s1', 'k-squat', 1, { done: true, reps: 8 }),
  set('s2', 'k-squat', 2),
  set('c1', 'k-curl', 3),
  set('h1', 'k-squat', 4, { type: 'hold', kg: null }),
];

test('fill choices: the squat sets of the session (no holds, no other lifts); default = first set not ticked', () => {
  const { choices, defaultId } = fillChoices(session, sets, { exKey: 'k-squat' });
  assert.deepEqual(choices.map((c) => [c.setId, c.label, c.kg, c.done]), [['w1', 'W', 23.8, true], ['s1', '1', 56.3, true], ['s2', '2', 56.3, false]]);
  assert.equal(defaultId, 's2');
  // Everything ticked: the last set (he ticked before walking back to the phone).
  const allDone = sets.map((s) => ({ ...s, done: true }));
  assert.equal(fillChoices(session, allDone).defaultId, 's2');
  assert.deepEqual(fillChoices(null, sets), { choices: [], defaultId: null });
  assert.equal(fillChoices({ ...session, exercises: [session.exercises[1]] }, sets).choices.length, 0);
});

test('filling a set: reps = good reps (or with the shallow ones), depth kept on the set, nothing else changed', () => {
  const summary = { good: 8, shallow: 1, lowDeg: 66, highDeg: 74, targetDeg: 75 };
  const s2 = sets[2];
  const filled = fillSet(s2, summary, { runId: 'squat-x' });
  assert.equal(filled.reps, 8);
  assert.deepEqual(filled.depth, { good: 8, shallow: 1, lowDeg: 66, highDeg: 74, targetDeg: 75, runId: 'squat-x' });
  assert.equal(filled.kg, 56.3);
  assert.equal(filled.done, false);
  assert.equal(fillSet(s2, summary, { withShallow: true }).reps, 9);
  assert.equal(depthText(filled.depth), 'DEPTH 8 GOOD · LOW 66° · 1 SHALLOW');
  assert.equal(depthText({ good: 5, shallow: 0, lowDeg: 70.4 }), 'DEPTH 5 GOOD · LOW 70°');
});

test('calendar markers: one per run with a rep, on the local date, with the time and the result', () => {
  const { r } = runThrough([70, 100]);
  const doc = { ...finishRun(r), exerciseName: 'Squat (Smith Machine)' };
  const marks = squatMarks([doc, { ...doc, id: 'empty', reps: [] }], TZ);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].date, '2026-10-19');
  assert.equal(marks[0].kind, 'squat');
  assert.equal(marks[0].label, 'Squat Depth 5:10 AM · 1 good · 1 shallow · lowest 70° · Squat (Smith Machine)');
  assert.equal(runText({ good: 3, shallow: 0, lowDeg: 69.6 }), '3 good · lowest 70°');
});
