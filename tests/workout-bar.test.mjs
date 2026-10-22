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
