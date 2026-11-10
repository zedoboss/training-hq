// Wed 11/11, his words: "Workout done at 1:56 PM. Time for your first meal: 78 of 242.5 g protein so far today. Tell me
// what you eat." (Tuesday 2:21 PM; his breakfast was logged and eaten at 9:56 AM, and the message counts its 78 g).
// With a meal already logged today, the meal after the gym is his second meal (third after two); a snack or an empty
// meal doesn't count; "first meal" only when nothing came before the workout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { nudgeInputs } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, rot: { today: { kind: 'done', dayType: 'push' } }, wakeHm: '06:30', bedHm: '20:30', session: { started: true, done: true },
  targets: { kcal: 3000, protein: 242.5 }, eaten: { kcal: 700, protein: 78 }, workoutEndedAt: at('13:56') };
const ask = (o) => nudgeCandidates({ ...base, now: at('14:21'), ...o }).find((c) => c.key === `meal-after:${at('13:56')}:0`)?.text;

test('his Tuesday: breakfast at 9:56 AM, so the meal after the 1:56 PM workout is his second meal', () => {
  assert.equal(ask({ mealsAt: [at('09:56')], lastMealAt: at('09:56') }),
    'Workout done at 1:56 PM. Time for your second meal: 78 of 242.5 g protein so far today. Tell me what you eat.');
});

test('nothing eaten before the gym: first meal; two before it: third; a meal after the workout started still counts', () => {
  assert.match(ask({ mealsAt: [], eaten: { kcal: 0, protein: 0 } }), /Time for your first meal: 0 of 242\.5 g/);
  assert.match(ask({}), /Time for your first meal/, 'no meals passed: first');
  assert.match(ask({ mealsAt: [at('07:00'), at('10:30')], lastMealAt: at('10:30') }), /Time for your third meal/);
  assert.match(ask({ mealsAt: [at('13:30')], lastMealAt: at('13:30') }), /Time for your second meal/, 'eaten during the session, before its end');
  assert.match(ask({ mealsAt: [1, 2, 3, 4, 5, 6].map((h) => at(`0${h}:00`)), lastMealAt: at('06:00') }), /Time for your next meal/);
});

test('the Mac passes today\'s meals: breakfast counts, a snack and an empty meal don\'t, yesterday\'s don\'t', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meal-ordinal-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { wakeHm: '06:30', bedHm: '20:30', nudgeEveryMin: 20 } });
    store.writeLocal('sleep-log', D, { id: D, date: D, bed: at('21:00', '2026-03-16'), wake: at('06:30') });
    store.writeLocal('sessions', 'w', { id: 'w', kind: 'workout', dayType: 'push', status: 'done', startedAt: at('12:30'), endedAt: at('13:56'), exercises: [] });
    store.writeLocal('sets', 'w.1', { id: 'w.1', sessionId: 'w', exKey: 'a', done: true, doneAt: at('13:55') });
    const meal = (id, name, hm, items = [{ name: 'Eggs', grams: 200, kcal: 300, protein: 26 }], d = D) =>
      store.writeLocal('meals', id, { id, date: d, at: at(hm, d), name, before: { items } });
    meal('b', 'Breakfast', '09:56');
    meal('s', 'Snack', '11:00');
    meal('e', 'Lunch', '11:30', []);
    meal('y', 'Dinner', '18:00', undefined, '2026-03-16');
    const i = nudgeInputs(store, at('14:21'), TZ);
    assert.deepEqual(i.args.mealsAt, [at('09:56')]);
    assert.equal(i.args.workoutEndedAt, at('13:56'));
    const c = nudgeCandidates(i.args).find((x) => x.key.startsWith('meal-after:'));
    assert.match(c?.text || '', /^Workout done at 1:56 PM. Time for your second meal/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
