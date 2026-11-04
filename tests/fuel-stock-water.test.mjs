// Thu 11/5, his list of missing features: "4 supplements have been out of stock... no restock list or reminder to
// order", "No food stock list (beef, eggs, almonds and so on) or shopping list", "No water tracking".
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { STOCK_TOOLS } from '../server/coach/tools-stock.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { waterEntry, waterTotal, waterTarget, mlText } from '../app/js/lib/water.js';
import { dailyUse, pantryStatus, shoppingList, amountOf, gramsPerUnit } from '../app/js/lib/pantry.js';
import { restockList, restockAsk, planReminders } from '../app/js/lib/fuel-reminders.js';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 22, 13, 0); // Thursday 1/22, 1:00 PM
const TODAY = '2026-01-22';
const day = (d, h = 12) => Date.UTC(2026, 0, d, h);
const PLAN = { foods: [
  { name: 'Lean beef (shank)', gramsPerDay: 500, fdcId: 1001, pack: { grams: 250, label: '250 g pack' } },
  { name: 'Eggs', gramsPerDay: 600, fdcId: 1002, unit: { grams: 60, label: 'egg', plural: 'eggs' } },
] };
const meal = (id, d, items, h = 12) => ({ id, date: `2026-01-${String(d).padStart(2, '0')}`, at: day(d, h), name: 'Lunch', before: { at: day(d, h), items } });

// ---- water ----------------------------------------------------------------------------------------------------------

test('water: entries, the day total, and a daily amount only when he set one', () => {
  assert.equal(waterEntry({ id: 'w', ml: 0, date: TODAY }), null);
  assert.equal(waterEntry({ id: 'w', ml: 5000, date: TODAY }), null);
  const log = [waterEntry({ id: 'a', ml: 250, at: day(22, 8), date: TODAY }), waterEntry({ id: 'b', ml: 500, at: day(22, 9), date: TODAY }), waterEntry({ id: 'c', ml: 500, at: day(21, 9), date: '2026-01-21' })];
  assert.deepEqual({ ml: waterTotal(log, TODAY).ml, count: waterTotal(log, TODAY).count, last: waterTotal(log, TODAY).last.id }, { ml: 750, count: 2, last: 'b' });
  assert.equal(waterTarget({ fuel: {} }), null, 'no amount unless he sets one');
  assert.equal(waterTarget({ fuel: { waterMl: 3000 } }), 3000);
  assert.equal(mlText(1250), '1,250 ml');
  assert.equal(mlText(3000), '3 L');
});

// ---- food stock -------------------------------------------------------------------------------------------------------

test('food stock: daily use from his number, else his logged meals, else his planned day', () => {
  const beef = { id: 'pantry.beef', name: 'beef', amount: 1000, unit: 'g', countedAt: day(21, 20), countedOn: '2026-01-21' };
  assert.deepEqual(dailyUse(beef, { plan: PLAN, meals: [], today: TODAY }), { perDay: 500, from: 'plan' });
  const meals = [15, 16, 17].map((d) => meal(`m${d}`, d, [{ name: 'Beef, shank', fdcId: 1001, grams: 400 }]));
  assert.deepEqual(dailyUse(beef, { plan: PLAN, meals, today: TODAY }), { perDay: 400, from: 'meals' });
  assert.deepEqual(dailyUse({ ...beef, perDay: 300 }, { plan: PLAN, meals, today: TODAY }), { perDay: 300, from: 'his' });
  const almonds = { id: 'pantry.almonds', name: 'almonds', amount: 500, unit: 'g', countedAt: day(21) };
  assert.deepEqual(dailyUse(almonds, { plan: PLAN, meals: [], today: TODAY }), { perDay: null, from: null }, 'no data: he sets it');
  assert.equal(gramsPerUnit({ name: 'eggs', unit: 'count' }, PLAN), 60);
  assert.equal(gramsPerUnit({ name: 'beef', unit: 'pack' }, PLAN), 250);
});

test('food stock: left = his count minus logged meals since; a day with no meal logged counts at the pace', () => {
  const eggs = { id: 'pantry.eggs', name: 'Eggs', amount: 30, unit: 'count', countedAt: day(19, 20), countedOn: '2026-01-19' };
  // 1/20: 600 g of egg logged (10 eggs); 1/21: nothing logged at all (pace: 10); 1/22 so far: 240 g (4).
  const meals = [meal('a', 20, [{ name: 'Egg, whole', fdcId: 1002, grams: 600 }]), meal('b', 22, [{ name: 'Eggs', grams: 240 }], 9)];
  const st = pantryStatus(eggs, { plan: PLAN, meals, today: TODAY });
  assert.equal(st.left, 6);
  assert.equal(st.about, true);
  assert.equal(st.perDay, 10);
  assert.equal(st.days, 0);
  assert.equal(amountOf(eggs, 6, PLAN), '6 eggs');
  // The shopping list: gone or within his days, soonest first; one he put on himself too.
  const beef = { id: 'pantry.beef', name: 'beef', amount: 5000, unit: 'g', countedAt: day(22, 6), countedOn: TODAY };
  const salt = { id: 'pantry.salt', name: 'salt', amount: 500, unit: 'g', countedAt: day(22, 6), onList: true };
  const list = shoppingList([eggs, beef, salt], { plan: PLAN, meals, today: TODAY }, { within: 3 });
  assert.deepEqual(list.map((x) => [x.item.name, x.why]), [['Eggs', 'soon'], ['salt', 'his']]);
  assert.deepEqual(shoppingList([beef], { plan: PLAN, meals, today: TODAY }, { within: 10 }).map((x) => x.why), ['soon'], '10 days of beef at 500 g');
});

// ---- the restock list ---------------------------------------------------------------------------------------------------

const supp = (id, name, extra = {}) => ({ id, name, short: name.toLowerCase(), dose: '1', days: { type: 'daily' }, status: 'active', history: [{ on: '2026-01-01', status: 'active' }], perTake: { train: 1, rest: 1 }, ...extra });
const ranOut = (id, d) => ({ id: `2026-01-${d}.${id}`, date: `2026-01-${d}`, suppId: id, status: 'skipped', reason: 'Ran out', at: day(Number(d), 9) });

test('restock list: out of stock and running low together; ordered silences the order reminder until it is back', () => {
  const supps = [supp('c', 'Creatine'), supp('mg', 'Magnesium'), supp('o', 'Omega', { stock: { servings: 4, countedAt: day(20) } }), supp('d', 'D3', { stock: { servings: 60, countedAt: day(20) } })];
  const log = [ranOut('c', '18'), ranOut('mg', '18')];
  const list = restockList({ supps, log, answers: [], date: TODAY });
  assert.deepEqual(list.map((r) => [r.supp.id, r.state, r.ordered]), [['c', 'out', null], ['mg', 'out', null], ['o', 'low', null]]);
  assert.ok(restockAsk({ date: '2026-01-22', supps, log }), 'not ordered: asked (every second day from running out)');
  const answers = [{ kind: 'out', suppId: 'c', answer: 'ordered', arrives: null, at: day(20, 10), date: '2026-01-20' }, { kind: 'out', suppId: 'mg', answer: 'ordered', arrives: null, at: day(20, 10), date: '2026-01-20' }];
  assert.equal(restockAsk({ date: '2026-01-22', supps, log, answers }), null, 'ordered, no date: no more asks');
  assert.equal(restockAsk({ date: '2026-01-24', supps, log, answers }), null);
  assert.deepEqual(restockList({ supps, log, answers, date: TODAY }).filter((r) => r.ordered).map((r) => r.supp.id), ['c', 'mg']);
  // Ordered a low one: its "running low" reminder is answered.
  const low = [{ kind: 'low', suppId: 'o', countedAt: day(20), answer: 'ordered', at: day(21), date: '2026-01-21' }];
  const rem = planReminders({ date: TODAY, tz: TZ, supps, log, answers: low });
  assert.equal(rem.find((r) => r.id.startsWith('supps-low:o')).due, false);
  // Back in stock (Restocked): off the list.
  const back = supps.map((x) => (x.id === 'c' ? { ...x, restockedAt: day(22, 10) } : x));
  assert.deepEqual(restockList({ supps: back, log, answers, date: TODAY }).map((r) => r.supp.id), ['mg', 'o']);
});

// ---- the coach's tools --------------------------------------------------------------------------------------------------

let dir; let store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-stock-'));
  store = openStore(join(dir, 'db.sqlite'));
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('fuel', 'plan', { kind: 'plan', kcal: 2500, proteinG: 180, ...PLAN });
  w('supplements', 'c', supp('c', 'Creatine'));
  w('supplements', 'o', supp('o', 'Omega', { stock: { servings: 4, countedAt: day(20) } }));
  w('supp-log', 'x', ranOut('c', '18'));
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ store, tz: TZ, now: () => NOW, action: () => {} });
const call = (name, args = {}) => [...STOCK_TOOLS, ...WRITE_TOOLS].find((t) => t.name === name).run(args, ctx());
const list = (col) => store.listRecords(col).filter((r) => !r.deleted).map((r) => r.data);

test('the tools are on the coach, each only on his words, and the rules name them', async () => {
  const { RULES } = await import('../server/coach/prompt.mjs');
  for (const name of ['water', 'food_stock']) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name);
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.match(t.description, /Only when he tells you to/);
    assert.ok(RULES.includes(name), name);
  }
  assert.match(RULES, /supplement_plan \(kind ordered, list\)/);
});

test('water tool: log, total, take back, his own amount (never proposed)', async () => {
  let r = await call('water', { action: 'log', ml: 500 });
  assert.match(r.text, /Logged 500 ml water/);
  await call('water', { action: 'log', liters: 0.25 });
  r = await call('water', { action: 'today' });
  assert.match(r.text, /750 ml water \(2 logged/);
  r = await call('water', { action: 'undo_last' });
  assert.match(r.text, /Took back 250 ml/);
  assert.equal(list('water').length, 1);
  assert.match((await call('water', { action: 'log' })).text, /How much/);
  assert.match((await call('water', { action: 'target', ml: 100 })).text, /250 to 10,000/);
  await call('water', { action: 'target', liters: 3 });
  assert.equal(store.getRecord('settings', 'main').data.fuel.waterMl, 3000);
  assert.match((await call('water', { action: 'today' })).text, /of his 3 L/);
});

test('food_stock tool: count, bought on top, his daily number, the shopping list, remove only on his words', async () => {
  let r = await call('food_stock', { action: 'count', item: 'eggs', amount: 12, unit: 'count' });
  assert.match(r.text, /Added: eggs: 12 eggs left, lasts 1 day \(10 eggs a day, your planned day\)/);
  r = await call('food_stock', { action: 'shopping' });
  assert.match(r.text, /Shopping list .*eggs/);
  r = await call('food_stock', { action: 'bought', item: 'eggs', amount: 30 });
  assert.match(r.text, /42 eggs left, lasts 4 days/);
  r = await call('food_stock', { action: 'per_day', item: 'eggs', per_day: 6 });
  assert.match(r.text, /lasts 7 days \(6 eggs a day, your number\)/);
  await call('food_stock', { action: 'count', item: 'almonds', amount: 400, unit: 'g' });
  r = await call('food_stock', { action: 'list' });
  assert.match(r.text, /almonds: 400 g left, daily use unknown/);
  assert.match((await call('food_stock', { action: 'on_list', item: 'almonds' })).text, /Shopping list .*almonds/);
  assert.match((await call('food_stock', { action: 'remove', item: 'almonds' })).text, /explicit words/);
  await call('food_stock', { action: 'remove', item: 'almonds', said: 'take almonds off' });
  assert.ok(!(await call('food_stock', { action: 'list' })).text.includes('almonds'));
});

test('supplement_plan: his restock list, and "I ordered them" for out-of-stock and low ones', async () => {
  let r = await call('supplement_plan', { kind: 'list' });
  assert.match(r.text, /Restock list: Creatine \(out since Sunday 1\/18, not ordered\); Omega \(4 servings left, 4 days, not ordered\)/);
  r = await call('supplement_plan', { kind: 'ordered', supplement: 'all' });
  assert.match(r.text, /creatine, omega: ordered; no more order reminders/);
  const answers = list('supp-answers');
  assert.deepEqual(answers.map((a) => [a.suppId, a.kind, a.answer]).sort(), [['c', 'out', 'ordered'], ['o', 'low', 'ordered']]);
  assert.equal(answers.find((a) => a.suppId === 'o').countedAt, day(20));
  r = await call('supplement_plan', { kind: 'list' });
  assert.match(r.text, /Creatine \(out since Sunday 1\/18, ordered Thursday 1\/22\)/);
  r = await call('supplement_plan', { kind: 'out', supplement: 'creatine', answer: 'ordered' });
  assert.match(r.text, /No more order reminders until it's back/);
});
