// Thu 10/22: the workout in progress on every other screen: what's next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSetText } from '../app/js/lib/session.js';

test('the bar names the next set: exercise, which set, weight and reps; a hold by its seconds; nothing when all are ticked', () => {
  const session = { exercises: [{ key: 'a', name: 'Squat (Smith Machine)' }, { key: 'b', name: 'Leg Extension (Machine)' }] };
  const sets = [
    { exKey: 'a', order: 0, type: 'warmup', kg: 31.3, done: true, target: { reps: [8, 8] } },
    { exKey: 'a', order: 1, type: 'normal', kg: null, done: false, target: { kg: 66.3, reps: [6, 8] } },
    { exKey: 'b', order: 2, type: 'hold', kg: 104, durationS: 30, done: false },
  ];
  assert.equal(nextSetText(session, sets), 'Squat (Smith Machine) · set 2 of 2 · 66.3 kg × 6-8');
  sets[1].done = true;
  assert.equal(nextSetText(session, sets), 'Leg Extension (Machine) · hold 1 of 1 · hold 30 s');
  sets[2].done = true;
  assert.equal(nextSetText(session, sets), '');
});

test('a skipped exercise (Thu 10/22): passed over by next set, not owed in the count, back next time with its reason', async () => {
  const { summarize } = await import('../app/js/lib/session.js');
  const { routineFromLast } = await import('../app/js/lib/finish.js');
  const { currentExercise } = await import('../server/coach/tools-read.mjs');
  const session = { id: 's', startedAt: Date.parse('2026-10-22T03:16:00Z'), exercises: [{ key: 'a', exerciseId: 'hip-thrust-machine', name: 'Hip Thrust (Machine)', skipped: { at: 1, reason: 'lower back pain' } }, { key: 'b', exerciseId: 'decline-crunch-weighted', name: 'Decline Crunch (Weighted)' }] };
  const sets = [{ exKey: 'a', order: 0, type: 'normal', kg: 36, done: false, target: { reps: [8, 12] } }, { exKey: 'b', order: 1, type: 'normal', kg: 5, done: false, target: { reps: [15, 15] } }];
  assert.equal(nextSetText(session, sets), 'Decline Crunch (Weighted) · set 1 of 1 · 5 kg × 15');
  assert.equal(currentExercise(session, sets).name, 'Decline Crunch (Weighted)');
  assert.deepEqual(summarize(session, sets), { volume: 0, done: 0, total: 1 });
  const next = routineFromLast({ id: 'legs-gbi', exercises: [{ key: 'r', exerciseId: 'hip-thrust-machine', name: 'Hip Thrust (Machine)', plan: { routine: 'legs-gbi', name: 'Hip Thrust (Smith Machine)' }, notes: '', sets: [] }] }, session, sets);
  assert.equal(next.exercises[0].name, 'Hip Thrust (Machine)');
  assert.match(next.exercises[0].notes, /^Skipped last time \(Thursday 10\/22\): lower back pain\.$/);
  assert.ok(next.exercises[0].plan, 'still the programme lift');
});
