// Thu 10/22: asked to remind him to start cooking his last meal, the coach added the eggs' butter step, though the eggs
// were his first meal and already logged. Every message now says what he ate and which meal is next, with its preset.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { mealsNowLine, contextLine } from '../server/coach/tools-read.mjs';

const TZ = 'UTC';
const at = (hm) => Date.parse(`2026-03-19T${hm}:00Z`);
let dir; let store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-meals-now-'));
  store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }, { name: 'Last meal', time: '16:30', latest: '17:00', cookMin: 30 }] } });
  store.writeLocal('fuel', 'presets', { kind: 'presets', presets: [
    { id: 'p1', name: 'First meal', items: [{ name: 'Eggs', grams: 600 }, { name: 'Butter', grams: 10 }] },
    { id: 'p2', name: 'Second meal', items: [{ name: 'Beef', grams: 500 }, { name: 'Rice', grams: 400 }] },
  ] });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const meal = (id, name, hm, items) => store.writeLocal('meals', id, { id, date: '2026-03-19', at: at(hm), name, before: { items } });
const line = (hm) => mealsNowLine(snapshot(store, { tz: TZ, now: at(hm) }));

test('before any meal: the first meal is next, with its preset', () => {
  meal('m0', 'Snack', '09:20', [{ name: 'Banana', grams: 236 }]);
  assert.match(line('11:00'), /^Meals today: Snack 9:20 AM \(Banana 236 g\)\. Next meal: First meal \(12:30 PM, 2:00 PM at the latest\)\. What he usually eats then \(his preset "First meal"\): Eggs 600 g, Butter 10 g\./);
});

test('eggs eaten at the first meal: the last meal is next and it is the beef, so no egg tip goes with it', () => {
  meal('m0', 'Snack', '09:20', [{ name: 'Banana', grams: 236 }]);
  meal('m1', 'Breakfast', '13:15', [{ name: 'Eggs', grams: 600 }]);
  const l = line('16:36');
  assert.match(l, /Breakfast 1:15 PM \(Eggs 600 g\)\. Next meal: Last meal \(4:30 PM, 5:00 PM at the latest\)\. What he usually eats then \(his preset "Second meal"\): Beef 500 g, Rice 400 g\./);
  assert.match(l, /goes only with the meal that has that food and only while it isn't logged today/);
  assert.match(contextLine({ store, tz: TZ, now: at('16:36') }), /Now: Meals today: .*Next meal: Last meal/);
});

test('a skipped first meal moves the next one on; both done: no meal left', () => {
  store.writeLocal('meal-checks', '2026-03-19.1230', { id: '2026-03-19.1230', date: '2026-03-19', slot: '12:30', answer: 'skipped' });
  assert.match(line('15:00'), /Next meal: Last meal .*preset "Second meal"/);
  meal('m2', 'Dinner', '16:50', [{ name: 'Beef', grams: 500 }]);
  assert.match(line('17:30'), /Every meal time is done for today\.$/);
});
