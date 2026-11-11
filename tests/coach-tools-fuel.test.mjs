// Thu 11/5, his words: "What else cant u do? Figure it out and let the mac give U the tools". The fuel tools: his
// supplement list (only on his words), old supplement answers, moving and copying meals, presets, his own foods, his
// meal times and his targets, written as his screens write them.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { FUEL_TOOLS } from '../server/coach/tools-fuel.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { statusOn, scheduledOn } from '../app/js/lib/supplements.js';
import { myFoods } from '../app/js/lib/foods.js';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 22, 13, 0); // Thursday 1/22, 1:00 PM
const TODAY = '2026-01-22';
let dir; let store; let actions;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-fuel-'));
  store = openStore(join(dir, 'db.sqlite'));
  actions = [];
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('supplements', 'supp.creatine', { id: 'supp.creatine', kind: 'supplement', name: 'Creatine', short: 'creatine', dose: '5 g', doseRest: null, time: '08:00', withFood: 'either', days: { type: 'daily' }, status: 'active', history: [{ on: '2026-01-01', status: 'active' }], stock: { servings: 30, countedAt: Date.UTC(2026, 0, 15) }, perTake: { train: 1, rest: 1 }, note: '', order: 0, changes: [] });
  w('supplements', 'supp.mag', { id: 'supp.mag', kind: 'supplement', name: 'Magnesium', short: 'mag', dose: '2 caps', days: { type: 'daily' }, status: 'removed', history: [{ on: '2026-01-01', status: 'active' }, { on: '2026-01-10', status: 'removed' }], stock: null, order: 1, changes: [] });
  w('supp-log', '2026-01-20.supp.creatine', { id: '2026-01-20.supp.creatine', date: '2026-01-20', suppId: 'supp.creatine', status: 'taken', reason: '', at: Date.UTC(2026, 0, 20, 8, 5), dose: '5 g', dayKind: 'train', servings: 1 });
  w('supp-log', '2026-01-05.supp.mag', { id: '2026-01-05.supp.mag', date: '2026-01-05', suppId: 'supp.mag', status: 'skipped', reason: 'Forgot it', at: Date.UTC(2026, 0, 5, 21), dose: '2 caps', dayKind: 'rest', servings: 0 });
  w('supp-considering', 'c1', { id: 'c1', name: 'Vitamin D', note: '', addedOn: '2026-01-02', status: 'considering' });
  w('fuel', 'plan', { kind: 'plan', kcal: 2500, proteinG: 180, foods: [{ name: 'Eggs', gramsPerDay: 120, fdcId: 171287, unit: { grams: 60, label: 'egg', plural: 'eggs' } }], changes: [] });
  w('fuel', 'presets', { kind: 'presets', presets: [
    { id: 'preset.first-meal', name: 'First meal', items: [{ name: 'Eggs', grams: 120, kcal: 172, protein: 15.1, unsure: false, fdcId: 171287, source: 'usda' }, { name: 'Rice', grams: 200, kcal: 260, protein: 5.4, unsure: false, source: 'typed' }], savedAt: 1 },
    { id: 'preset.dinner', name: 'Dinner', items: [{ name: 'Rice', grams: 300, kcal: 390, protein: 8.1, unsure: false, source: 'typed' }], savedAt: 1 },
  ] });
  w('meals', 'm1', { id: 'm1', date: '2026-01-21', at: Date.UTC(2026, 0, 21, 12, 30), name: 'Lunch', source: 'manual', tz: 'UTC', before: { photoId: null, at: Date.UTC(2026, 0, 21, 12, 30), scaleG: null, items: [{ name: 'Eggs', grams: 120, kcal: 172, protein: 15.1, unsure: false, fdcId: 171287, source: 'usda' }], confirmedAt: Date.UTC(2026, 0, 21, 12, 31) }, after: null, hint: '', round: 0, note: '' });
  w('settings', 'main', { fuel: { visionModel: 'fast', mealTimes: [{ name: 'First meal', time: '12:00', latest: '13:00' }, { name: 'Dinner', time: '18:00', cookMin: 30 }] } });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => NOW, action: (a) => actions.push(a) });
const call = (name, args = {}) => [...FUEL_TOOLS, ...WRITE_TOOLS].find((t) => t.name === name).run(args, ctx());
const rec = (col, id) => store.getRecord(col, id);
const data = (col, id) => rec(col, id)?.data;
const supps = () => store.listRecords('supplements').map((r) => r.data).filter(Boolean);

test('every tool: an action enum, a closed schema, and "only on his words" in its description', () => {
  assert.deepEqual(FUEL_TOOLS.map((t) => t.name), ['supplement_list', 'meal_edit', 'my_food', 'fuel_settings']);
  for (const t of FUEL_TOOLS) {
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.inputSchema.properties.action.enum.length > 1, t.name);
    assert.match(t.description, /only when he tells you to|ONLY when he tells you to/i, t.name);
  }
  assert.match(FUEL_TOOLS[0].description, /never suggest a supplement, a dose or a change/);
});

test('supplement_list add: only with his words; what he said, nothing more; off the considering list', async () => {
  assert.match((await call('supplement_list', { action: 'add', name: 'Vitamin D', said: '' })).text, /^said: his words/);
  assert.equal(supps().length, 2, 'nothing added without his words');
  const r = await call('supplement_list', { action: 'add', name: 'Vitamin D', dose: '1 cap', days: 'per_week', per_week: 6, off_day: 'Sunday', said: 'add vitamin d, 1 cap, 6 days a week, Sundays off' });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Added to his list: Vitamin D: 1 cap, no time set, 6 days a week · Sunday off\. On his checklist from Thursday 1\/22\..*Not set: time, with food or not; ask him, never suggest one\./);
  const d = supps().find((x) => x.name === 'Vitamin D');
  assert.deepEqual([d.kind, d.status, d.days, d.history, d.perTake, d.stock, d.order], ['supplement', 'active', { type: 'perWeek', count: 6, offDay: 0 }, [{ on: TODAY, status: 'active' }], { train: 1, rest: 1 }, null, 2]);
  assert.match(d.changes[0].text, /^Added \(coach, his words: "add vitamin d/);
  assert.equal(scheduledOn(d, TODAY), true);
  assert.equal(scheduledOn(d, '2026-01-25'), false, 'Sunday off');
  assert.equal(data('supp-considering', 'c1').status, 'added');
  assert.equal(data('supp-considering', 'c1').suppId, d.id);
  assert.match((await call('supplement_list', { action: 'add', name: 'creatine', said: 'add creatine' })).text, /^Creatine is already on his list \(active\)\. To change it: action change/);
  // A removed one comes back, its history kept.
  const back = await call('supplement_list', { action: 'add', name: 'Magnesium', said: 'put magnesium back on' });
  assert.match(back.text, /^Back on his list: Magnesium: 2 caps/);
  assert.deepEqual(data('supplements', 'supp.mag').history.map((h) => h.status), ['active', 'removed', 'active']);
  assert.equal(statusOn(data('supplements', 'supp.mag'), TODAY), 'active');
});

test('supplement_list change, remove, pause, resume: dated, in his words, as the supplement screen saves them', async () => {
  const c = await call('supplement_list', { action: 'change', supplement: 'creatine', dose: '3 g', days: 'weekdays', weekdays: ['Monday', 'Wednesday', 'Friday'], servings: 60, per_tick: 2, said: 'creatine 3 g, Mon Wed Fri, new tub of 60' });
  assert.match(c.text, /^Creatine: dose 3 g, Mon, Wed, Fri, 60 servings left, servings per tick 2 \(training day\) \/ 2 \(rest day\)\. Now 3 g, 8:00 AM, with or without food, Mon, Wed, Fri, 60 servings left, 2 per tick/);
  const cr = data('supplements', 'supp.creatine');
  assert.deepEqual([cr.dose, cr.days, cr.stock, cr.perTake], ['3 g', { type: 'weekdays', weekdays: [1, 3, 5] }, { servings: 60, countedAt: NOW }, { train: 2, rest: 2 }]);
  assert.match(cr.changes.at(-1).text, /^Changed: dose 3 g, .*\(coach, his words: "creatine 3 g/);
  assert.match((await call('supplement_list', { action: 'change', supplement: 'creatine', dose: '3 g', said: 'x' })).text, /^Nothing to change on Creatine/);
  assert.match((await call('supplement_list', { action: 'change', supplement: 'creatine', days: 'weekdays', weekdays: [], said: 'x' })).text, /^weekdays: which days/);
  assert.match((await call('supplement_list', { action: 'pause', supplement: 'creatine', said: 'pause creatine' })).text, /^Paused Creatine from Thursday 1\/22/);
  assert.equal(statusOn(data('supplements', 'supp.creatine'), TODAY), 'paused');
  assert.match((await call('supplement_list', { action: 'resume', supplement: 'creatine', said: 'creatine again' })).text, /^Creatine is back on his checklist/);
  const rm = await call('supplement_list', { action: 'remove', supplement: 'creatine', said: 'remove creatine from my list' });
  assert.match(rm.text, /^Removed Creatine from his list from Thursday 1\/22; its history stays\./);
  const after = data('supplements', 'supp.creatine');
  assert.equal(statusOn(after, TODAY), 'removed');
  assert.equal(statusOn(after, '2026-01-20'), 'active', 'its past stays');
  assert.deepEqual(after.history.filter((h) => h.on === TODAY).length, 1, 'one change a day, the last wins');
  assert.match((await call('supplement_list', { action: 'change', supplement: 'creatine', dose: '1 g', said: 'x' })).text, /^Creatine was removed from his list\. To take it again: action add/);
});

test('supplement_list delete_answer: any past day, also for one no longer on his list; nothing to delete is said', async () => {
  const r = await call('supplement_list', { action: 'delete_answer', supplement: 'magnesium', date: '2026-01-05', said: 'delete that old magnesium skip' });
  assert.match(r.text, /^Deleted his skipped answer for Magnesium on Monday 1\/5 \(9:00 PM, "Forgot it"\)\. That day shows it open again\./);
  assert.equal(rec('supp-log', '2026-01-05.supp.mag').deleted, true);
  assert.match((await call('supplement_list', { action: 'delete_answer', supplement: 'magnesium', date: '2026-01-05', said: 'x' })).text, /^No answer for Magnesium on Monday 1\/5: nothing to delete\./);
  const t = await call('supplement_list', { action: 'delete_answer', supplement: 'creatine', date: '2026-01-20', said: 'I did not take creatine Tuesday' });
  assert.match(t.text, /^Deleted his taken answer for Creatine on Tuesday 1\/20 .* Its 1 serving back on the count\./);
  assert.match((await call('supplement_list', { action: 'delete_answer', supplement: 'creatine', date: '2026-01-30', said: 'x' })).text, /still to come/);
});

test('meal_edit move: to another day at the same clock time, or at his time; never into the future', async () => {
  const r = await call('meal_edit', { action: 'move', meal: 'm1', date: '2026-01-20' });
  assert.match(r.text, /^Moved Lunch \[id m1\] from Wednesday 1\/21 to Tuesday 1\/20, 12:30 PM\.\nTuesday 1\/20: 172 kcal, 15\.1 g protein/);
  assert.deepEqual([data('meals', 'm1').date, data('meals', 'm1').at], ['2026-01-20', Date.UTC(2026, 0, 20, 12, 30)]);
  await call('meal_edit', { action: 'move', meal: 'm1', date: TODAY, time: '11:15' });
  assert.deepEqual([data('meals', 'm1').date, data('meals', 'm1').at], [TODAY, Date.UTC(2026, 0, 22, 11, 15)]);
  assert.match((await call('meal_edit', { action: 'move', meal: 'm1', date: TODAY, time: '20:00' })).text, /still to come/);
  assert.match((await call('meal_edit', { action: 'move', meal: 'm1', date: '2026-01-23' })).text, /still to come/);
  assert.match((await call('meal_edit', { action: 'move', meal: 'nope', date: TODAY })).text, /^No meal with id nope/);
});

test('meal_edit copy: what he ate that day, logged again now or on the day he names', async () => {
  const r = await call('meal_edit', { action: 'copy', meal: 'm1' });
  const id = r.text.match(/\[id ([^\]]+)\]/)[1];
  assert.match(r.text, /^Copied Lunch of Wednesday 1\/21 to Thursday 1\/22, 1:00 PM as Lunch \[id .+\]: Eggs 2 eggs \(136 g with shells, about 120 g of egg\); 172 kcal, 15\.1 g protein, 0\.9 g carbs, 11\.4 g fat\./);
  const m = data('meals', id);
  assert.deepEqual([m.date, m.at, m.by, m.copiedFrom, m.before.confirmedAt, m.before.items.length, m.tz], [TODAY, NOW, 'coach', 'm1', NOW, 1, 'UTC']);
  assert.equal(data('meals', 'm1').date, '2026-01-21', 'the original stays');
  const past = await call('meal_edit', { action: 'copy', meal: 'm1', date: '2026-01-19', name: 'Dinner' });
  assert.match(past.text, /to Monday 1\/19, 12:30 PM as Dinner/);
});

test('meal_edit presets: rename, edit items (drop, add, replace), delete only on his words', async () => {
  assert.match((await call('meal_edit', { action: 'rename_preset', preset: 'first meal', name: 'Dinner' })).text, /^He already has a preset "Dinner"/);
  assert.match((await call('meal_edit', { action: 'rename_preset', preset: 'first meal', name: 'Breakfast classic' })).text, /^Preset "First meal" is now "Breakfast classic"\./);
  const p = () => data('fuel', 'presets').presets;
  assert.deepEqual(p().map((x) => [x.id, x.name]), [['preset.first-meal', 'Breakfast classic'], ['preset.dinner', 'Dinner']]);
  const e = await call('meal_edit', { action: 'preset_items', preset: 'Breakfast classic', drop: ['rice'], add: [{ name: 'Eggs', count: 2 }] });
  assert.match(e.text, /^Preset "Breakfast classic" now: Eggs 2 eggs .*, Eggs 2 eggs .*; \d+ kcal/);
  assert.deepEqual(p()[0].items.map((x) => [x.name, x.grams]), [['Eggs', 120], ['Eggs', 120]]);
  assert.match((await call('meal_edit', { action: 'preset_items', preset: 'Breakfast classic', drop: ['beef'] })).text, /^Not in "Breakfast classic": "beef"/);
  await call('meal_edit', { action: 'preset_items', preset: 'dinner', items: [{ name: 'Rice', grams: 250, kcal: 325, protein: 6 }] });
  assert.deepEqual(p()[1].items.map((x) => [x.name, x.grams, x.kcal, x.source]), [['Rice', 250, 325, 'typed']]);
  assert.match((await call('meal_edit', { action: 'preset_items', preset: 'dinner', drop: ['rice'] })).text, /leaves "Dinner" empty/);
  assert.match((await call('meal_edit', { action: 'preset_items', preset: 'dinner', add: [{ name: 'zzqx paste', grams: 10 }] })).text, /^No USDA match for "zzqx paste".*my_food/);
  assert.match((await call('meal_edit', { action: 'delete_preset', preset: 'dinner' })).text, /^said: his words asking to delete it/);
  assert.match((await call('meal_edit', { action: 'delete_preset', preset: 'dinner', said: 'delete the dinner preset' })).text, /^Deleted his preset "Dinner"\. .* Presets left: Breakfast classic\./);
  assert.match((await call('meal_edit', { action: 'rename_preset', preset: 'lunch', name: 'x' })).text, /^No preset "lunch"\. His presets: Breakfast classic\./);
});

test('my_food: his own numbers for a food USDA has no match for; log_meal logs it by count; his planned day untouched', async () => {
  assert.match((await call('log_meal', { items: [{ name: 'Zqx protein bar', count: 1 }] })).text, /^No grams/);
  assert.match((await call('my_food', { action: 'save', name: 'Zqx protein bar', kcal: 220 })).text, /^kcal and protein: his numbers/);
  assert.match((await call('my_food', { action: 'save', name: 'Zqx protein bar', kcal: 900, protein: 20, per_grams: 60 })).text, /more than 60 g of food can hold/);
  assert.match((await call('my_food', { action: 'save', name: 'Eggs', kcal: 140, protein: 12 })).text, /already a food of his planned day/);
  const r = await call('my_food', { action: 'save', name: 'Zqx protein bar', kcal: 220, protein: 20, carbs: 18, fat: 7, per_grams: 60, unit_grams: 60, unit_label: 'bar', said: 'save my protein bar, 220 kcal 20 g protein per 60 g bar' });
  assert.match(r.text, /^Saved his food Zqx protein bar: per 60 g: 220 kcal, 20 g protein, 18 g carbs, 7 g fat; 1 bar = 60 g\. log_meal now logs it by name with grams or count \(1 bar = 60 g\)/);
  const plan = data('fuel', 'plan');
  assert.equal(plan.foods.length, 1, 'his planned day is untouched');
  assert.deepEqual(plan.ownFoods[0].label, { perGrams: 60, kcal: 220, protein: 20, carbs: 18, fat: 7 });
  assert.ok(myFoods(plan).some((f) => f.name === 'Zqx protein bar' && f.unit.grams === 60));
  const logged = await call('log_meal', { items: [{ name: 'Zqx protein bar', count: 2 }], name: 'Snack' });
  assert.match(logged.text, /Zqx protein bar 2 bars \(120 g\) \(his pack label\); 440 kcal, 40 g protein/);
  assert.match((await call('my_food', { action: 'list' })).text, /^His own foods \(his numbers\): Zqx protein bar: per 60 g/);
  // Saved again: updated, not doubled.
  await call('my_food', { action: 'save', name: 'Zqx protein bar', kcal: 230, protein: 21, per_grams: 60 });
  assert.equal(data('fuel', 'plan').ownFoods.length, 1);
  assert.equal(data('fuel', 'plan').ownFoods[0].unit.grams, 60, 'its piece size kept');
  assert.match((await call('my_food', { action: 'remove', name: 'Zqx protein bar' })).text, /^said: his words/);
  assert.match((await call('my_food', { action: 'remove', name: 'eggs', said: 'remove eggs' })).text, /planned day .* not removed/);
  assert.match((await call('my_food', { action: 'remove', name: 'zqx protein bar', said: 'remove the bar' })).text, /^Removed his food "Zqx protein bar"/);
  assert.deepEqual(data('fuel', 'plan').ownFoods, []);
});

test('fuel_settings meal times: change one, its latest and cooking lead, add, remove, the whole list; checked as the editor checks', async () => {
  const r = await call('fuel_settings', { action: 'meal_time', meal: 'first meal', time: '12:30', latest: '14:00' });
  assert.match(r.text, /^Meal times now: First meal 12:30 PM \(latest 2:00 PM\); Dinner 6:00 PM, start cooking 5:30 PM \(30 min before\)\./);
  const times = () => data('settings', 'main').fuel.mealTimes;
  assert.deepEqual(times(), [{ name: 'First meal', time: '12:30', latest: '14:00' }, { name: 'Dinner', time: '18:00', cookMin: 30 }]);
  assert.equal(data('settings', 'main').fuel.visionModel, 'fast', 'other settings stay');
  await call('fuel_settings', { action: 'meal_time', meal: '18:00', cook_min: 45, name: 'Last meal' });
  assert.deepEqual(times()[1], { name: 'Last meal', time: '18:00', cookMin: 45 });
  await call('fuel_settings', { action: 'meal_time', meal: 'last meal', cook_min: 0, latest: '' });
  assert.deepEqual(times()[1], { name: 'Last meal', time: '18:00' });
  assert.match((await call('fuel_settings', { action: 'meal_time', meal: 'first meal', latest: '12:00' })).text, /^A latest time has to be after the meal time/);
  assert.match((await call('fuel_settings', { action: 'meal_time', meal: 'brunch', time: '10:00' })).text, /^No meal time "brunch"/);
  assert.match((await call('fuel_settings', { action: 'meal_time', name: 'Snack', time: '15:00' })).text, /First meal 12:30 PM .*; Snack 3:00 PM; Last meal 6:00 PM/);
  assert.match((await call('fuel_settings', { action: 'meal_time', name: 'snack', time: '16:00' })).text, /same name/);
  await call('fuel_settings', { action: 'meal_time', meal: 'snack', remove: true });
  assert.deepEqual(times().map((t) => t.name), ['First meal', 'Last meal']);
  assert.match((await call('fuel_settings', { action: 'meal_times', times: [] })).text, /^Meal times now: none: no meal-time reminders\./);
  assert.deepEqual(times(), []);
});

test('fuel_settings targets: his numbers, in range, dated in his plan; Fuel reads kcal and protein', async () => {
  const r = await call('fuel_settings', { action: 'targets', kcal: 2600, protein: 190, fat: 80, said: '2600 kcal, 190 protein, 80 fat' });
  assert.match(r.text, /^Daily targets: 2,600 kcal \(was 2,500 kcal\), 190 g protein \(was 180 g protein\), 80 g fat \(was none\)\. Now 2,600 kcal, 190 g protein, 80 g fat a day, on Fuel from now\. Fat and carbs targets are kept in his plan/);
  const plan = data('fuel', 'plan');
  assert.deepEqual([plan.kcal, plan.proteinG, plan.fatG, plan.foods.length], [2600, 190, 80, 1]);
  assert.match(plan.changes.at(-1).text, /^Changed by the coach on his words \("2600 kcal/);
  assert.equal(plan.changes.at(-1).on, TODAY);
  assert.match((await call('fuel_settings', { action: 'targets', kcal: 300 })).text, /^Kcal: 800 to 8,000/);
  assert.match((await call('fuel_settings', { action: 'targets', protein: 190 })).text, /already his targets/);
  assert.match((await call('fuel_settings', { action: 'targets' })).text, /^Which target/);
});
