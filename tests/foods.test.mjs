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

test('planned day (A6): his foods with USDA ids or a pack label, summed; label foods match by name', async () => {
  const { planItems, myFoods, withUsda: wu } = await import('../app/js/lib/foods.js');
  const plan = { foods: [
    { name: 'Rice (cooked weight)', gramsPerDay: 450, fdcId: 169757 },
    { name: 'Collagen peptides', gramsPerDay: 10, label: { perGrams: 10, kcal: 40, protein: 9 } },
    { name: 'Something', gramsPerDay: 20 },
  ] };
  const p = planItems(db, plan);
  assert.deepEqual(p.items.map((x) => [x.kcal, x.protein, x.source]), [[585, 12.1, 'usda'], [40, 9, 'label'], [0, 0, 'estimate']]);
  assert.equal(p.kcal, 625); assert.equal(p.protein, 21.1);
  const mine = myFoods(plan);
  assert.deepEqual(mine.map((m) => m.name), ['Rice (cooked weight)', 'Collagen peptides']);
  const [c] = wu(db, [{ name: 'collagen', grams: 20, kcal: 0, protein: 0 }], { prefer: mine });
  assert.deepEqual(c, { name: 'Collagen peptides', grams: 20, kcal: 80, protein: 18, unsure: false, source: 'label' });
});

test('Diet.html lines to confirm (A6): open until answered; use changes the supplement with a dated note', async () => {
  const { reviewOpen, applyReview, answerReview } = await import('../app/js/lib/supplements.js');
  const supps = [{ id: 'supp.a', name: 'A', dose: '1 g', perTake: { train: 1, rest: 1 }, changes: [] }, { id: 'supp.b', name: 'B', status: 'removed' }];
  const review = { items: [{ suppId: 'supp.a', brief: '1 g', diet: '2 tablets', set: { dose: '2 tablets', perTake: { train: 2, rest: 2 } } }, { suppId: 'supp.b', brief: 'x', diet: 'y', set: {} }], answers: {} };
  assert.deepEqual(reviewOpen(review, supps).map((x) => x.suppId), ['supp.a']);
  const a = applyReview(supps[0], review.items[0], '2026-10-18');
  assert.equal(a.dose, '2 tablets'); assert.deepEqual(a.perTake, { train: 2, rest: 2 });
  assert.match(a.changes[0].text, /Diet\.html \(he confirmed\): 2 tablets/);
  assert.deepEqual(reviewOpen(answerReview(review, 'supp.a', 'keep', '2026-10-18'), supps), []);
});

test('no scale (A7): packs, counts and usual amounts to grams and words; the photo prompt carries them', async () => {
  const { gramsFor, amountText, amountChoices, amountsLine, myFoods, withUsda: wu } = await import('../app/js/lib/foods.js');
  const { promptText, SYSTEM_BEFORE } = await import('../server/meal-vision.mjs');
  const plan = { foods: [
    { name: 'Nuts', fdcId: 170567, pack: { grams: 200, label: '200 g pack' }, usual: { packs: 0.5, text: 'half a pack a day' } },
    { name: 'Eggs', fdcId: 171287, unit: { grams: 50, label: 'egg', plural: 'eggs' }, usual: { count: 10 } },
    { name: 'Rice', fdcId: 169757, usual: { grams: 450, short: '450 g cooked' } },
  ] };
  const [nuts, eggs, rice] = myFoods(plan);
  assert.equal(gramsFor(nuts, { packs: 0.5 }), 100);
  assert.equal(gramsFor(eggs, { count: 3 }), 150);
  assert.equal(gramsFor(rice, { usual: true }), 450);
  assert.equal(gramsFor(rice, { packs: 1 }), null);
  assert.equal(amountText(nuts, { packs: 0.5 }), '½ pack');
  assert.equal(amountText(nuts, { packs: 2 }), '2 packs');
  assert.equal(amountText(eggs, { count: 1 }), '1 egg');
  assert.deepEqual(amountChoices(nuts).map((c) => c.label), ['¼ pack · 50 g', '½ pack · 100 g', '1 pack · 200 g', '2 packs · 400 g']);
  assert.equal(amountChoices(eggs).at(-1).label, 'usual day: 10 eggs · 500 g');
  assert.deepEqual(amountChoices(rice).map((c) => c.label), ['usual day: 450 g cooked · 450 g']);
  assert.match(amountsLine(plan), /^Nuts, pack 200 g, usually half a pack a day; Eggs, 1 egg = 50 g, usually 10 eggs; Rice, usually 450 g$/);
  const [x] = wu(db, [{ name: 'Nuts', fdcId: 170567, grams: 100, portion: '½ pack' }]);
  assert.equal(x.portion, '½ pack'); assert.equal(x.kcal, 579);
  assert.match(promptText({ kind: 'before', meal: { hint: '' }, plan }), /His packs, counts and usual amounts \(no kitchen scale\): Nuts, pack 200 g/);
  assert.doesNotMatch(SYSTEM_BEFORE, /scaleGrams|kitchen scale is visible/);
});

test('an id that does not fit the USDA words given with it: the words win, and his name only when it fits', () => {
  const prefer = [{ fdcId: 169757, name: 'Rice (cooked weight)' }];
  const [brown, white, plain] = withUsda(db, [
    { name: 'Brown rice (cooked weight)', fdcId: 169757, usda: 'Rice, brown, long-grain, cooked', grams: 150 },
    { name: 'Rice', fdcId: 169757, usda: 'Rice, white, long-grain, regular, unenriched, cooked without salt', grams: 200 },
    { name: 'rice', grams: 100 },
  ], { prefer });
  assert.equal(brown.fdcId, 169704); assert.equal(brown.name, 'Brown rice (cooked weight)');
  assert.equal(white.fdcId, 169757); assert.equal(white.name, 'Rice (cooked weight)');
  assert.equal(plain.fdcId, 169757, 'plain "rice": his rice');
  const [named] = withUsda(db, [{ name: 'Rice (cooked weight)', fdcId: 169757, usda: 'Rice, brown, long-grain, cooked', grams: 150 }], { prefer });
  assert.equal(named.fdcId, 169704); assert.equal(named.name, 'Rice, brown, long-grain, cooked');
});
