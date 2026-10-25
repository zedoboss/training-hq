// Mon 10/26, 2:32 AM (his words: "why aren't the egg sizes mentioned they weigh in total 680 grams so add that"): the
// coach listed his "First meal" preset as "10 eggs" with no weight, because the presets line gave only the count.
// Now eggs are listed with both weights wherever they are listed: "10 eggs (680 g with shells, about 600 g of egg)".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itemAmount, amountsLine } from '../app/js/lib/foods.js';
import { openStore } from '../server/store.mjs';
import { TOOLS, contextLine } from '../server/coach/tools.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { timelineText } from '../server/coach/memory.mjs';

const EGGS = { name: 'Eggs', fdcId: 171287, gramsPerDay: 600, unit: { grams: 60, label: 'egg', plural: 'eggs', shellGrams: 68 }, usual: { count: 10 } };
const ALMONDS = { name: 'Almonds (salted roasted)', fdcId: 170567, pack: { grams: 200, label: '200 g pack' } };
const BUTTER = { name: 'Butter', fdcId: 173410 };
const FOODS = [EGGS, ALMONDS, BUTTER];

test('itemAmount: eggs by count with the shell weight and the egg weight', () => {
  assert.equal(itemAmount({ name: 'Eggs', grams: 600, portion: '10 eggs', fdcId: 171287 }, FOODS), '10 eggs (680 g with shells, about 600 g of egg)');
  assert.equal(itemAmount({ name: 'Egg, whole, cooked, fried', grams: 180 }, FOODS), '3 eggs (204 g with shells, about 180 g of egg)', 'a photo item, no portion');
  assert.equal(itemAmount({ name: 'Fried eggs', grams: 60 }, FOODS), '1 egg (68 g with shell, about 60 g of egg)');
  assert.equal(itemAmount({ name: 'Eggs', grams: 170 }, FOODS), '170 g of egg (about 193 g with shells)', 'not a whole count');
  // Not eggs: unchanged.
  assert.equal(itemAmount({ name: 'Butter (cooking the beef and eggs)', grams: 10 }, FOODS), '10 g');
  assert.equal(itemAmount({ name: 'Egg whites', grams: 100 }, FOODS), '100 g');
  assert.equal(itemAmount({ name: 'Eggplant', grams: 200 }, FOODS), '200 g');
  assert.equal(itemAmount({ name: 'Almonds (salted roasted)', grams: 100, portion: '½ pack' }, FOODS), '½ pack (100 g)');
  // Eggs whose shell weight isn't stored: USDA's 12% shell.
  assert.equal(itemAmount({ name: 'Eggs', grams: 600, portion: '10 eggs' }, [{ name: 'Eggs', unit: { grams: 60, label: 'egg', plural: 'eggs' } }]), '10 eggs (680 g with shells, about 600 g of egg)');
  assert.match(amountsLine({ foods: FOODS }), /Eggs, 1 egg = 60 g \(68 g with shell\)/);
});

test('the coach sees the eggs\' weight in his presets, his next meal, the meals list, the log and the timeline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-egg-weight-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    const TZ = 'UTC';
    const now = Date.UTC(2026, 0, 20, 2, 31);
    store.writeLocal('fuel', 'plan', { kind: 'plan', kcal: 3000, proteinG: 240, foods: FOODS });
    const items = [
      { name: 'Eggs', grams: 600, kcal: 858, protein: 75.4, fdcId: 171287, source: 'usda', portion: '10 eggs' },
      { name: 'Butter', grams: 10, kcal: 73, protein: 0.1, fdcId: 173410, source: 'usda' },
      { name: 'Almonds (salted roasted)', grams: 60, kcal: 365, protein: 12.7, fdcId: 170567, source: 'usda' },
    ];
    store.writeLocal('fuel', 'presets', { kind: 'presets', presets: [{ id: 'preset.first-meal', name: 'First meal', items }] });
    store.writeLocal('settings', 'main', { fuel: { mealTimes: [{ time: '04:00', name: 'First meal' }, { time: '12:00', name: 'Second meal' }] } });
    const ctx = { store, tz: TZ, now: () => now, action: () => {} };
    const call = (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, ctx);
    const W = /Eggs 10 eggs \(680 g with shells, about 600 g of egg\)/;

    assert.match((await call('meals')).text, new RegExp(`His presets .*First meal: ${W.source}, Butter 10 g, Almonds \\(salted roasted\\) 60 g`));
    assert.match(contextLine({ store, tz: TZ, now }), new RegExp(`What he usually eats then \\(his preset "First meal"\\): ${W.source}, Butter 10 g`));

    const logged = await call('log_meal', { preset: 'First meal', time: '02:31' });
    assert.match(logged.text, new RegExp(`Logged First meal .*: ${W.source}, Butter 10 g`));
    assert.match((await call('meals')).text, new RegExp(`- First meal 2:31 AM .*: ${W.source}, Butter 10 g`));
    assert.match(contextLine({ store, tz: TZ, now }), new RegExp(`Meals today.*First meal 2:31 AM \\(${W.source}, Butter 10 g`));
    assert.match(timelineText(snapshot(store, { tz: TZ, now }), { date: '2026-01-20' }), new RegExp(`Meal: First meal: ${W.source}, Butter 10 g`));

    // What's still open from his planned day lists eggs with their weight too.
    store.writeLocal('fuel', 'plan', { kind: 'plan', kcal: 3000, proteinG: 240, foods: [{ ...EGGS, gramsPerDay: 840 }, ALMONDS, BUTTER] });
    assert.match((await call('log_meal', { items: [{ name: 'almonds', grams: 30 }], time: '02:40' })).text, /Not logged yet today from his planned day: Eggs 4 eggs \(272 g with shells, about 240 g of egg\)/);
    const id = logged.text.match(/\[id ([^\]]+)\]/)[1];
    assert.match((await call('meal_preset', { meal: id, name: 'First meal' })).text, new RegExp(`^Preset "First meal" replaced: ${W.source}, Butter 10 g`));
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});
