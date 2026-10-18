// A12: vitamins and minerals from logged food (USDA values, cooking factors), supplements by label stoichiometry,
// against a reference table (made-up references here; his own live in the private folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexFoods } from '../app/js/lib/foods.js';
import { foodNutrients, suppNutrients, dayMicro, weekMicro, plannedMicro, microRows, eatenItems } from '../app/js/lib/micro.js';
import { newMeal } from '../app/js/lib/meals.js';

const db = indexFoods(JSON.parse(readFileSync(new URL('../app/data/usda-foods.json', import.meta.url), 'utf8')));
const micro = {
  energyBasisMJ: 10,
  references: [
    { key: 'vitA', name: 'Vitamin A', unit: 'mcg', ref: 750, refNote: 'r', ul: 3000, ulNote: 'u', group: 'vitamins' },
    { key: 'thiamin', name: 'Thiamin', unit: 'mg', perMJ: 0.1, refNote: 'per MJ', ul: null, ulNote: 'n/e', group: 'vitamins' },
    { key: 'magnesium', name: 'Magnesium', unit: 'mg', ref: 350, refNote: 'AI', ul: 500, ulNote: 'supplemental', ulSupplementalOnly: true, group: 'minerals' },
    { key: 'zinc', name: 'Zinc', unit: 'mg', ref: 10, refNote: 'r', ul: 2, ulNote: 'u', group: 'minerals' },
    { key: 'iron', name: 'Iron', unit: 'mg', ref: 10, refNote: 'r', ul: 1, ulNote: 'u', group: 'minerals' },
    { key: 'chloride', name: 'Chloride', unit: 'mg', ref: 3100, refNote: 'x1.543', fromSodium: 1.543, group: 'minerals' },
    { key: 'epaDha', name: 'EPA + DHA', unit: 'mg', ref: [250, 500], refNote: 'r', ul: 5000, ulNote: 'u', sumOf: ['epa', 'dha'], group: 'fatty' },
    { key: 'carnitine', name: 'L-carnitine', unit: 'mg', ref: [1000, 2000], refNote: 'r', dietMg: 350, group: 'other' },
  ],
  accepted: { zinc: 'his own choice' },
  retention: { foods: [171287], factors: { vitA: 0.9, thiamin: 0.8 } },
  supplements: { 'supp.mg': { perTablet: { magnesium: 125 }, tablets: { train: 1, rest: 2 } }, 'supp.fish': { perDay: { epa: 1800, dha: 1350 } }, 'supp.carn': { perDay: { carnitine: 1365 } } },
  plannedSupplements: { magnesium: 156 },
};
const plan = { foods: [{ name: 'Beef', fdcId: 174770, gramsPerDay: 500 }, { name: 'Eggs', fdcId: 171287, gramsPerDay: 500 }, { name: 'Salt', fdcId: 746775, gramsPerDay: 5.7, per100Override: { iodine: 3000 } }] };

test('food: USDA values per grams; cooking factors on the raw entries named; overrides; small amounts never incomplete', () => {
  const t = foodNutrients(db, [{ name: 'Eggs', fdcId: 171287, grams: 100 }, { name: 'Salt', fdcId: 746775, grams: 5.7 }, { name: 'Mystery', grams: 50 }], { micro, plan });
  assert.equal(Math.round(t.raw.vitA), 160); // egg 160 mcg per 100 g
  assert.equal(Math.round(t.eaten.vitA), 144); // x 0.9
  assert.equal(Math.round(t.raw.iodine), 171); // his salt at 30 mg/kg, not USDA's
  assert.ok(!(t.missing.vitA || []).includes('Salt'), 'salt (5.7 g) does not make vitamin A incomplete');
  assert.deepEqual(t.notCounted, ['Mystery']);
  // Carnitine from his beef, as his analysis counts it: 350 mg per 500 g.
  assert.equal(Math.round(foodNutrients(db, [{ name: 'Beef', fdcId: 174770, grams: 250 }], { micro, plan }).eaten.carnitine), 175);
});

test('supplements: by label stoichiometry on the days ticked taken; tablets follow the day kind', () => {
  const supplements = [{ id: 'supp.mg', name: 'Mg' }, { id: 'supp.fish', name: 'Fish oil' }];
  const log = [{ date: '2026-10-20', suppId: 'supp.mg', status: 'taken' }, { date: '2026-10-20', suppId: 'supp.fish', status: 'skipped' }];
  assert.deepEqual(suppNutrients(micro, { supplements, log, date: '2026-10-20', dayKind: 'rest' }).amounts, { magnesium: 250 });
  assert.deepEqual(suppNutrients(micro, { supplements, log, date: '2026-10-20', dayKind: 'train' }).amounts, { magnesium: 125 });
  assert.deepEqual(suppNutrients(micro, { supplements, log, date: '2026-10-21' }).amounts, {});
});

test('a day and a week from meals; rows against the references: % of ref, ranges, limits, accepted, over', () => {
  const m1 = { ...newMeal({ id: 'm1', at: Date.parse('2026-10-20T05:00:00Z'), name: 'Lunch', tz: 'UTC' }), date: '2026-10-20' };
  m1.before = { ...m1.before, items: [{ name: 'Eggs', fdcId: 171287, grams: 200, kcal: 286, protein: 25, source: 'usda' }], confirmedAt: 1 };
  const m2 = { ...newMeal({ id: 'm2', at: Date.parse('2026-10-18T05:00:00Z'), name: 'Lunch', tz: 'UTC' }), date: '2026-10-18' };
  m2.before = { ...m2.before, items: [{ name: 'Eggs', fdcId: 171287, grams: 400, kcal: 572, protein: 50, source: 'usda' }], confirmedAt: 1 };
  assert.equal(eatenItems([m1, m2], [], '2026-10-20').length, 1);
  const supplements = [{ id: 'supp.mg', name: 'Mg' }, { id: 'supp.fish', name: 'Fish oil' }];
  const suppLog = [{ date: '2026-10-20', suppId: 'supp.mg', status: 'taken' }, { date: '2026-10-20', suppId: 'supp.fish', status: 'taken' }];
  const o = { meals: [m1, m2], estimates: [], plan, micro, supplements, suppLog, date: '2026-10-20', dayKind: 'rest' };
  const day = dayMicro(db, o);
  assert.equal(Math.round(day.eaten.vitA), 288);
  const rows = Object.fromEntries(microRows(micro, day, plannedMicro(db, { plan, micro })).map((r) => [r.key, r]));
  assert.equal(rows.vitA.pct, 38); // 288 of 750
  assert.equal(rows.thiamin.ref, 1); // 0.1 mg/MJ x 10 MJ
  assert.equal(rows.magnesium.supp, 250);
  assert.equal(rows.magnesium.limitUsed, 50); // supplemental 250 of 500
  assert.equal(rows.zinc.over, false, 'above the limit but accepted: not flagged');
  assert.ok(rows.zinc.limitUsed > 100);
  assert.equal(rows.iron.over, true);
  assert.equal(rows.epaDha.within, 'above'); assert.equal(rows.epaDha.total >= 3150, true);
  assert.equal(Math.round(rows.chloride.total), Math.round(rows.chloride.total)); // derived from sodium x 1.543
  assert.ok(rows.chloride.total > 0);
  assert.equal(rows.carnitine.within, 'below');
  assert.equal(rows.magnesium.planned > 0, true);
  // The week: averaged over the days with food logged (two of seven).
  const wk = weekMicro(db, { ...o, dayKindOf: () => 'rest' });
  assert.equal(wk.days, 2);
  assert.equal(Math.round(wk.eaten.vitA), 432); // (288 + 576) / 2
  assert.equal(wk.supp.magnesium, 125); // 250 on one of the two days
});

test('accepted points apply only where he accepted them: thiamin near reference, "above" ones when above', () => {
  const m = { energyBasisMJ: 10, references: [{ key: 'thiamin', name: 'Thiamin', unit: 'mg', ref: 1, refNote: 'r', group: 'vitamins' }, { key: 'zinc', name: 'Zinc', unit: 'mg', ref: 10, ul: 20, ulNote: 'u', refNote: 'r', group: 'minerals' }],
    accepted: { thiamin: { text: 'about 95-97%', minPct: 94 }, zinc: { text: 'intentionally above', above: true } } };
  const rows = (th, zn) => Object.fromEntries(microRows(m, { eaten: { thiamin: th, zinc: zn }, raw: {}, supp: {}, missing: {} }).map((r) => [r.key, r]));
  assert.equal(rows(0.96, 5).thiamin.accepted, 'about 95-97%');
  assert.equal(rows(0.34, 5).thiamin.accepted, null);
  assert.equal(rows(1, 5).zinc.accepted, null);
  assert.equal(rows(1, 30).zinc.accepted, 'intentionally above');
  assert.equal(rows(1, 30).zinc.over, false);
});
