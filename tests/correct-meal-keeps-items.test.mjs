// Tue 11/17, 1:24 PM (his words: "Yeah i had potatoo too rn and kimchi small as well"): the coach copied an eaten-out
// meal logged weeks before with his numbers and tried correct_meal to add sweet potato tempura and kimchi. correct_meal
// re-matched every item against USDA, refused the ones already in the meal ("No USDA match for Udon noodles (large),
// ... Cheese surimi croquette"), and the add-ons went in as a separate Snack. Now items already in the meal keep their
// values, and add puts foods on top, so one meal stays one meal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS } from '../server/coach/tools.mjs';

const PLAN = { kind: 'plan', kcal: 3174, proteinG: 242.5, fatG: 153, carbsG: 216, foods: [{ name: 'Eggs', fdcId: 171287, gramsPerDay: 600 }, { name: 'Rice (cooked weight)', fdcId: 169757, gramsPerDay: 300 }] };
// The eaten-out meal as he gave it: no USDA match for these names, so his numbers.
const OUT = [
  { name: 'Udon noodles (large)', grams: 375, kcal: 390, protein: 9.8 },
  { name: 'Simmered thin-sliced beef', grams: 90, kcal: 230, protein: 15 },
  { name: 'Cheese surimi croquette', grams: 90, kcal: 210, protein: 8 },
  { name: 'Japanese-style chicken skewer', grams: 100, kcal: 180, protein: 20 },
];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-correct-keep-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('fuel', 'plan', PLAN);
  store.writeLocal('settings', 'main', { fuel: { mealTimes: [{ time: '08:00', name: 'First meal' }, { time: '16:00', name: 'Second meal' }] } });
  let now = Date.UTC(2026, 0, 6, 12, 0);
  const ctx = { store, tz: 'UTC', now: () => now, action: () => {} };
  const call = (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, ctx);
  const meal = (id) => store.listRecords('meals').map((r) => r.data).find((m) => m?.id === id);
  const meals = () => store.listRecords('meals').filter((r) => !r.deleted && r.data).map((r) => r.data);
  const idOf = (text) => text.match(/\[id (meal-[^\]]+)\]/)[1];
  return { call, meal, meals, idOf, at: (d, h, m) => { now = Date.UTC(2026, 0, d, h, m); }, done: () => { store.close?.(); rmSync(dir, { recursive: true, force: true }); } };
}

async function copied(t) {
  t.at(6, 12, 0);
  const old = t.idOf((await t.call('log_meal', { items: OUT, away: true })).text);
  t.at(20, 13, 24);
  const r = await t.call('meal_edit', { action: 'copy', meal: old, away: true });
  return t.idOf(r.text);
}
const byName = (m) => Object.fromEntries(m.before.items.map((x) => [x.name, x]));

test('his Tuesday replayed: correct_meal with the copied items by name plus the add-ons keeps one meal, old values kept', async () => {
  const t = setup();
  try {
    const id = await copied(t);
    const r = await t.call('correct_meal', { meal: id, items: [
      ...OUT.map(({ name, grams }) => ({ name, grams })),
      { name: 'Sweet potato tempura', grams: 70, kcal: 140, protein: 1 },
      { name: 'Rice (cooked weight)', grams: 100 },
    ] });
    assert.ok(r.wrote, r.text);
    const m = t.meal(id);
    assert.equal(m.before.items.length, 6);
    const items = byName(m);
    for (const x of OUT) { assert.equal(items[x.name].kcal, x.kcal); assert.equal(items[x.name].protein, x.protein); assert.equal(items[x.name].source, 'typed'); }
    assert.equal(items['Sweet potato tempura'].kcal, 140);
    assert.equal(items['Rice (cooked weight)'].source, 'usda');
    assert.equal(t.meals().length, 2, 'the old meal and the copy, no extra Snack');
  } finally { t.done(); }
});

test('add puts only the new foods on top; the items there stay exactly as they were', async () => {
  const t = setup();
  try {
    const id = await copied(t);
    const before = t.meal(id).before.items;
    const r = await t.call('correct_meal', { meal: id, add: [{ name: 'Kimchi (small)', grams: 50, kcal: 12, protein: 1 }] });
    assert.ok(r.wrote, r.text);
    const after = t.meal(id).before.items;
    assert.deepEqual(after.slice(0, before.length), before);
    assert.equal(after.at(-1).name, 'Kimchi (small)');
    assert.match(r.text, /1022 kcal/);
  } finally { t.done(); }
});

test('an item given with other grams keeps its values per gram; a name close to his (other order, fewer words) is the same food', async () => {
  const t = setup();
  try {
    const id = await copied(t);
    const r = await t.call('correct_meal', { meal: id, items: [
      { name: 'udon noodles (large)' }, { name: 'Thin-sliced beef simmered', grams: 90 }, { name: 'Cheese surimi croquette', grams: 90 },
      { name: 'Japanese-style chicken skewer', grams: 50 },
    ] });
    assert.ok(r.wrote, r.text);
    const items = byName(t.meal(id));
    assert.equal(items['Udon noodles (large)'].kcal, 390);
    assert.equal(items['Simmered thin-sliced beef'].kcal, 230);
    assert.equal(items['Japanese-style chicken skewer'].grams, 50);
    assert.equal(items['Japanese-style chicken skewer'].kcal, 90);
    assert.equal(items['Japanese-style chicken skewer'].protein, 10);
  } finally { t.done(); }
});

test('a really new food is still matched afresh: a name with a word the stored one lacks, new numbers, or no match at all', async () => {
  const t = setup();
  try {
    t.at(20, 9, 0);
    const id = t.idOf((await t.call('log_meal', { items: [{ name: 'Rice (cooked weight)', grams: 200 }, { name: 'Udon noodles (large)', grams: 375, kcal: 390, protein: 9.8 }] })).text);
    // His numbers given again: they win.
    await t.call('correct_meal', { meal: id, items: [{ name: 'Rice (cooked weight)', grams: 200 }, { name: 'Udon noodles (large)', grams: 375, kcal: 400, protein: 10 }] });
    assert.equal(byName(t.meal(id))['Udon noodles (large)'].kcal, 400);
    // A food that isn't in the meal and has no match: refused, nothing changed.
    const r = await t.call('correct_meal', { meal: id, items: [{ name: 'Rice (cooked weight)', grams: 200 }, { name: 'Zzqx mystery fritter', grams: 80 }] });
    assert.ok(!r.wrote);
    assert.match(r.text, /Zzqx mystery fritter/);
    assert.doesNotMatch(r.text, /Rice/);
    assert.equal(t.meal(id).before.items.length, 2);
    // Brown rice is not his rice: matched against USDA, not kept with the stored rice's values.
    const k = byName(t.meal(id))['Rice (cooked weight)'].kcal;
    await t.call('correct_meal', { meal: id, items: [{ name: 'Brown rice cooked', grams: 200, usda: 'Rice, brown, long-grain, cooked' }] });
    const brown = t.meal(id).before.items[0];
    assert.notEqual(brown.kcal, k);
  } finally { t.done(); }
});

test('preset_items: the preset\'s own items given by name keep their values', async () => {
  const t = setup();
  try {
    t.at(20, 9, 0);
    const id = t.idOf((await t.call('log_meal', { items: OUT })).text);
    await t.call('meal_preset', { meal: id, name: 'Marukame' });
    const r = await t.call('meal_edit', { action: 'preset_items', preset: 'Marukame', items: [...OUT.map(({ name, grams }) => ({ name, grams })), { name: 'Eggs', grams: 60 }] });
    assert.ok(r.wrote, r.text);
    assert.match(r.text, /Udon noodles \(large\) 375 g \(his numbers\)/);
  } finally { t.done(); }
});

test('his real case: items matched to USDA by the coach\'s USDA words, given again by name only, keep their USDA values', async () => {
  const t = setup();
  try {
    t.at(20, 13, 25);
    const id = t.idOf((await t.call('log_meal', { items: [{ name: 'Zzq udon bowl (large)', grams: 375, usda: 'Rice, brown, long-grain, cooked' }] })).text);
    const was = t.meal(id).before.items[0];
    assert.equal(was.source, 'usda');
    const r = await t.call('correct_meal', { meal: id, items: [{ name: 'Zzq udon bowl (large)', grams: 375 }, { name: 'Rice (cooked weight)', grams: 100 }] });
    assert.ok(r.wrote, r.text);
    assert.deepEqual(t.meal(id).before.items[0], was);
    assert.equal(t.meal(id).before.items.length, 2);
  } finally { t.done(); }
});
