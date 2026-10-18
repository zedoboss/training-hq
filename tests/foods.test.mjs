// A5: USDA FoodData Central per-100 g values, bundled; kcal and protein of meal items computed from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexFoods, searchFoods, matchFood, withUsda, foodItem, valuesFor, tokens, shortName, per100 } from '../app/js/lib/foods.js';
import { cleanItems, regram, newMeal } from '../app/js/lib/meals.js';
import { openStore } from '../server/store.mjs';
import { openMealVision } from '../server/meal-vision.mjs';

const db = indexFoods(JSON.parse(readFileSync(new URL('../app/data/usda-foods.json', import.meta.url), 'utf8')));

test('the bundle: SR Legacy and Foundation Foods, per 100 g, public domain, with the source named', () => {
  assert.equal(db.source.name, 'USDA FoodData Central');
  assert.deepEqual(db.source.datasets.map((d) => d.name), ['SR Legacy', 'Foundation Foods']);
  assert.ok(db.foods.length > 8000);
  for (const k of ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'vitC', 'magnesium', 'selenium', 'epa', 'dha']) assert.ok(db.keys.includes(k), k);
  // Values as USDA publishes them (SR Legacy 169757, the rice in his diet analysis: 450 g = 585 kcal, 12.1 g protein).
  const rice = db.byId.get(169757);
  assert.equal(per100(db, rice, 'kcal'), 130);
  assert.equal(per100(db, rice, 'protein'), 2.69);
  const v = valuesFor(db, rice, 450);
  assert.equal(Math.round(v.kcal), 585);
  assert.equal(Math.round(v.protein * 10) / 10, 12.1);
  assert.deepEqual(foodItem(db, rice, 450, { name: 'Rice (cooked weight)' }), { name: 'Rice (cooked weight)', grams: 450, kcal: 585, protein: 12.1, unsure: false, fdcId: 169757, source: 'usda' });
});

test('search: his words, USDA words, plural and spelling, his own foods first', () => {
  assert.deepEqual(tokens('Eggs, whole'), ['egg', 'whole']);
  assert.deepEqual(tokens('iodised salt'), ['iodized', 'salt']);
  assert.equal(searchFoods(db, 'eggs')[0].food.id, 171287);
  assert.equal(searchFoods(db, 'broccoli')[0].food.name, 'Broccoli, raw');
  assert.equal(searchFoods(db, 'fried egg')[0].food.id, 173423);
  assert.equal(matchFood(db, 'Rice, white, long-grain, regular, unenriched, cooked without salt').id, 169757);
  assert.equal(matchFood(db, 'Beef, bottom sirloin, tri-tip roast, separable lean only, trimmed to 0" fat, all grades, raw').id, 174770);
  assert.equal(matchFood(db, 'iodised salt').id, 746775);
  assert.equal(matchFood(db, 'collagen peptides'), null);
  // Two USDA entries share a name (SR Legacy and Foundation Foods): his own one wins.
  assert.equal(searchFoods(db, 'greek yogurt whole milk', { prefer: [2259794] })[0].food.id, 2259794);
  assert.equal(shortName('Rice, white, long-grain, regular, unenriched, cooked without salt'), 'Rice, white, cooked without salt');
});

test('items: USDA values where the food matches, the estimate kept (and marked) where not, his typed numbers kept', () => {
  const items = withUsda(db, cleanItems([
    { name: 'Lean beef', usda: 'Beef, bottom sirloin, tri-tip roast, separable lean only, trimmed to 0" fat, all grades, raw', grams: 250, kcal: 999, protein: 1 },
    { name: 'Rice', fdcId: 169757, grams: 200, kcal: 1, protein: 1 },
    { name: 'Mystery sauce', usda: 'Sauce, house special', grams: 30, kcal: 40, protein: 1 },
    { name: 'My shake', grams: 300, kcal: 250, protein: 30, source: 'typed' },
  ]), { prefer: [{ fdcId: 174770, name: 'Lean beef (bottom sirloin tri-tip)' }] });
  assert.deepEqual(items[0], { name: 'Lean beef (bottom sirloin tri-tip)', grams: 250, kcal: 355, protein: 53.2, unsure: false, fdcId: 174770, source: 'usda' });
  assert.deepEqual(items[1], { name: 'Rice', grams: 200, kcal: 260, protein: 5.4, unsure: false, fdcId: 169757, source: 'usda' });
  assert.equal(items[2].source, 'estimate'); assert.equal(items[2].kcal, 40); assert.equal(items[2].usda, undefined);
  assert.equal(items[3].source, 'typed'); assert.equal(items[3].kcal, 250);
  // Changing grams keeps the USDA id and its values per gram.
  const half = regram(items[0], 125);
  assert.equal(half.fdcId, 174770); assert.equal(half.kcal, 178); assert.equal(half.protein, 26.6);
});

test('a meal photo: Claude names the USDA entry, the Mac computes kcal and protein from it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-foods-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('fuel', 'plan', { foods: [{ name: 'Lean beef (bottom sirloin tri-tip)', fdcId: 174770 }] });
    store.writeLocal('meal-photos', 'p1', { id: 'p1', mealId: 'm1', kind: 'before', dataUrl: 'data:image/jpeg;base64,/9j/AAAA', at: 1 });
    store.writeLocal('meals', 'm1', newMeal({ id: 'm1', at: 1, photoId: 'p1', name: 'Lunch', tz: 'UTC' }));
    const answer = { scaleGrams: null, notes: '', items: [
      { name: 'Lean beef (bottom sirloin tri-tip)', fdcId: 174770, usda: 'Beef, bottom sirloin, tri-tip roast, separable lean only, trimmed to 0" fat, all grades, raw', grams: 250, kcal: 400, protein: 50, unsure: false },
      { name: 'Rice', fdcId: null, usda: 'Rice, white, long-grain, regular, unenriched, cooked without salt', grams: 300, kcal: 400, protein: 8, unsure: false },
      { name: 'Nuoc cham', fdcId: null, usda: 'Sauce, nuoc cham, Vietnamese dipping', grams: 20, kcal: 15, protein: 0.3, unsure: true },
    ] };
    const calls = [];
    const v = openMealVision({ store, now: () => 10, run: async (q) => { calls.push(q); return { text: JSON.stringify(answer), ms: 3 }; } });
    await v.kick();
    assert.match(calls[0].content[1].text, /Lean beef \(bottom sirloin tri-tip\) \[fdcId 174770\]/);
    const e = store.getRecord('meal-estimates', 'm1.before').data;
    assert.deepEqual(e.items.map((x) => [x.name, x.grams, x.kcal, x.protein, x.source, x.fdcId ?? null]), [
      ['Lean beef (bottom sirloin tri-tip)', 250, 355, 53.2, 'usda', 174770],
      ['Rice', 300, 390, 8.1, 'usda', 169757],
      ['Nuoc cham', 20, 15, 0.3, 'estimate', null],
    ]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
