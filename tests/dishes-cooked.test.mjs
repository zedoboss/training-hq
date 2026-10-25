// Sun 10/25, 7:34 PM (his words: "no reason to get dishes noti when i ate lays thats a snack not me. Cooking a meal
// only then it should be active so no takeout either like the pizza i had earlier"): the dishes reminder came 3
// minutes after he logged a Snack (Lay's 90 g). Now it follows only a meal he cooked at home: never a Snack, a meal
// eaten out, or takeout (cooked: false).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leavesDishes } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { dishesTick } from '../server/notify.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-22';
const at = (hm) => Date.parse(`${D}T${hm}:00+07:00`);
const meal = (id, hm, name, extra = {}) => ({ id, date: D, at: at(hm), name, source: 'manual', before: { items: [{ name: 'Food', grams: 100, kcal: 300, protein: 10 }] }, ...extra });

test('leavesDishes: only a meal he cooked at home', () => {
  assert.equal(leavesDishes(meal('a', '19:30', 'Snack')), false, 'a snack');
  assert.equal(leavesDishes(meal('a', '19:30', 'snack 2')), false);
  assert.equal(leavesDishes(meal('b', '16:30', 'Lunch', { away: true })), false, 'eaten out');
  assert.equal(leavesDishes(meal('c', '20:00', 'Dinner', { cooked: false })), false, 'takeout at home');
  assert.equal(leavesDishes(meal('d', '20:00', 'Dinner')), true, 'cooked at home');
  assert.equal(leavesDishes(meal('e', '20:00', 'Second meal', { cooked: true })), true);
  assert.equal(leavesDishes(null), false);
});

test('Sunday replayed: pizza out, Lay\'s snack, takeout: no dishes; his cooked dinner: dishes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-dishes-cooked-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { wakeHm: '08:00', bedHm: '00:00' } });
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
    const run = async (hm, to) => { for (let t = at(hm); t <= at(to); t += 60000) await dishesTick({ store, push, now: t, tz: TZ }); };
    const dishes = () => sent.filter((m) => m.tag === 'dishes');
    await run('12:00', '12:00');
    store.writeLocal('meals', 'm1', meal('m1', '16:30', 'Lunch', { away: true }));
    await run('16:31', '16:50');
    store.writeLocal('meals', 'm2', meal('m2', '19:30', 'Snack'));
    await run('19:30', '19:50');
    store.writeLocal('meals', 'm3', meal('m3', '20:30', 'Dinner', { cooked: false }));
    await run('20:30', '20:50');
    assert.deepEqual(dishes(), [], 'nothing after the pizza out, the chips or the takeout');
    store.writeLocal('meals', 'm4', meal('m4', '22:00', 'Dinner'));
    await run('22:00', '22:10');
    assert.equal(dishes().length, 1, 'once, after the meal he cooked');
    assert.match(dishes()[0].body, /dishes won't clean themselves/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
