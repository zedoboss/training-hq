// Wed 11/11, 4:14 PM (his words: "When u respond back like this logging a meal i should also see carbs fats and the
// total for the end too"): after the KFC meal the coach said only kcal and protein for the meal and the day, because
// log_meal and the day line gave it nothing else. Now every meal-logging answer (log_meal, correct_meal, meal_edit copy)
// gives the meal's carbs and fat, and the day line gives all four against his targets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { itemMacros } from '../server/foods.mjs';

const FOODS = [
  { name: 'Lean beef (shank)', fdcId: 169441, gramsPerDay: 500 },
  { name: 'Eggs', fdcId: 171287, gramsPerDay: 600 },
  { name: 'Rice (cooked weight)', fdcId: 169757, gramsPerDay: 300 },
  { name: 'Greek yogurt', fdcId: 170894, label: { perGrams: 100, kcal: 55, protein: 8.3, fat: 0.2, carbs: 4.9 } },
  { name: 'Hydrolysed bovine collagen peptides', label: { perGrams: 10, kcal: 40, protein: 9 } },
];
const PLAN = { kind: 'plan', kcal: 3174, proteinG: 242.5, fatG: 153, carbsG: 216, foods: FOODS };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-meal-macros-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('fuel', 'plan', PLAN);
  store.writeLocal('settings', 'main', { fuel: { mealTimes: [{ time: '08:00', name: 'First meal' }, { time: '16:00', name: 'Second meal' }] } });
  let now = Date.UTC(2026, 0, 20, 9, 0);
  const ctx = { store, tz: 'UTC', now: () => now, action: () => {} };
  const call = (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, ctx);
  return { store, call, at: (h, m) => { now = Date.UTC(2026, 0, 20, h, m); }, done: () => { store.close?.(); rmSync(dir, { recursive: true, force: true }); } };
}

test('itemMacros: USDA by fdcId and grams, his pack label first, label without them = 0 when protein explains the kcal, typed = unknown', () => {
  const mine = FOODS;
  // Eggs 600 g: 0.72 and 9.51 per 100 g; rice 300 g: 28.17 and 0.28; his yogurt label 200 g: 4.9 and 0.2.
  const m = itemMacros([
    { name: 'Eggs', grams: 600, fdcId: 171287, source: 'usda' },
    { name: 'Rice (cooked weight)', grams: 300, fdcId: 169757, source: 'usda' },
    { name: 'Greek yogurt', grams: 200, fdcId: 170894, source: 'label' },
  ], { mine });
  assert.deepEqual(m, { carbs: 98.6, fat: 58.3, missing: [], none: false });
  assert.deepEqual(itemMacros([{ name: 'Hydrolysed bovine collagen peptides', grams: 10, source: 'label' }], { mine }), { carbs: 0, fat: 0, missing: [], none: false });
  // A label with kcal its protein doesn't explain, and no carbs or fat: unknown, named, never guessed.
  assert.deepEqual(itemMacros([{ name: 'Bar', grams: 50, source: 'label' }], { mine: [{ name: 'Bar', label: { perGrams: 50, kcal: 200, protein: 20 } }] }), { carbs: 0, fat: 0, missing: ['Bar'], none: true });
  assert.deepEqual(itemMacros([{ name: 'Sundae', grams: 115, kcal: 290, protein: 6, source: 'typed' }], { mine }), { carbs: 0, fat: 0, missing: ['Sundae'], none: true });
});

test('log_meal answers with the meal\'s carbs and fat and the day\'s four totals against his targets', async () => {
  const { call, at, done } = setup();
  try {
    at(9, 0);
    const first = (await call('log_meal', { items: [{ name: 'Eggs', grams: 600 }, { name: 'Rice (cooked weight)', grams: 300 }, { name: 'Greek yogurt', grams: 200 }] })).text;
    assert.match(first, /kcal, [\d.]+ g protein, 98\.6 g carbs, 58\.3 g fat/, first);
    assert.match(first, /\n.*kcal, [\d.]+ g protein, 98\.6 g carbs, 58\.3 g fat \(targets 3,174 kcal, 242\.5 g protein, 216 g carbs, 153 g fat/, first);

    // A second meal: the day line adds both up. Beef 400 g: 0 carbs, 15.4 g fat; collagen adds none; his typed sundae
    // has no carbs/fat value, so it's named, not counted.
    at(16, 10);
    const second = (await call('log_meal', { items: [{ name: 'Lean beef (shank)', grams: 400 }, { name: 'collagen', grams: 10 }, { name: 'Chocolate sundae', grams: 115, kcal: 290, protein: 6 }] })).text;
    assert.match(second, /g protein, 0 g carbs, 15\.4 g fat \(no carbs\/fat value for Chocolate sundae\)/, second);
    assert.match(second, /\n.*g protein, 98\.6 g carbs, 73\.7 g fat \(no carbs\/fat value for Chocolate sundae\) \(targets 3,174 kcal, 242\.5 g protein, 216 g carbs, 153 g fat/, second);

    // The meals tool: each meal and the day with carbs and fat.
    const meals = (await call('meals')).text;
    assert.match(meals, /^.*98\.6 g carbs, 73\.7 g fat.*\(targets .*216 g carbs, 153 g fat/);
    assert.match(meals, /- [^\n]+? 9:00 AM .*; \d+ kcal, [\d.]+ g protein, 98\.6 g carbs, 58\.3 g fat/);

    // correct_meal: the new meal totals and the day line, all four.
    const id = meals.match(/- [^\n]+? 4:10 PM \[id ([^\]]+)\]/)[1];
    const fixed = (await call('correct_meal', { meal: id, items: [{ name: 'Lean beef (shank)', grams: 400 }, { name: 'collagen', grams: 10 }] })).text;
    assert.match(fixed, /g protein, 0 g carbs, 15\.4 g fat on the plate/, fixed);
    assert.match(fixed, /\n.*g protein, 98\.6 g carbs, 73\.7 g fat \(targets 3,174 kcal, 242\.5 g protein, 216 g carbs, 153 g fat/, fixed);
    assert.doesNotMatch(fixed, /no carbs\/fat value/);

    // meal_edit copy: carbs and fat too.
    const copied = (await call('meal_edit', { action: 'copy', meal: id, date: '2026-01-19' })).text;
    assert.match(copied, /g protein, 0 g carbs, 15\.4 g fat/, copied);
  } finally { done(); }
});

test('without fat or carbs targets the day line still gives the totals, with only the targets he has', async () => {
  const { store, call, done } = setup();
  try {
    store.writeLocal('fuel', 'plan', { ...PLAN, fatG: undefined, carbsG: undefined });
    const out = (await call('log_meal', { items: [{ name: 'Eggs', grams: 600 }] })).text;
    assert.match(out, /4\.3 g carbs, 57\.1 g fat \(targets 3,174 kcal, 242\.5 g protein; his September plan\)/, out);
  } finally { done(); }
});

test('the coach\'s rule asks for all four on every meal-logging reply, numbers from the tool', () => {
  const src = readFileSync(new URL('../server/coach/prompt.mjs', import.meta.url), 'utf8');
  assert.match(src, /Every meal-logging reply .*kcal, protein, carbs and fat.*day's totals of all four against his targets/);
});
