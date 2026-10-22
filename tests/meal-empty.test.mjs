// Thu 10/22, 6:21 PM (his words: "I clicked 'Log without the photo'... 30 seconds later, I got a notification... Did it
// actually log it? How does it know?"): the tap saved an empty meal at once, it synced while he was still typing, and
// the Mac took it for his second meal ("Dinner done. Get up and take your collagen now"). An empty meal now counts as
// no meal on the Mac, the phone saves a meal only with what he ate, and his presets are one tap away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEmptyMeal, presetsFor, mealFromPreset } from '../app/js/lib/meals.js';
import { openStore } from '../server/store.mjs';
import { dishesTick, recordsOf } from '../server/notify.mjs';
import { mealsNowLine } from '../server/coach/tools-read.mjs';
import { snapshot } from '../server/coach/shared.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-19';
const at = (hm) => Date.parse(`${D}T${hm}:00+07:00`);
const RICE = [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }];
const empty = (id, hm, name = 'Dinner') => ({ id, date: D, at: at(hm), name, source: 'manual', before: { photoId: null, at: at(hm), items: [], confirmedAt: null }, after: null });

test('an empty meal is one with no photo and no items', () => {
  assert.equal(isEmptyMeal(empty('m', '18:21')), true);
  assert.equal(isEmptyMeal({ ...empty('m', '18:21'), before: { items: RICE } }), false);
  assert.equal(isEmptyMeal({ ...empty('m', '18:21'), before: { photoId: 'p1', items: [] } }), false, 'a photo being read is a meal');
  assert.equal(isEmptyMeal(null), false);
});

test('on the Mac an empty meal is no meal: no collagen "Dinner done", no supplements, no dishes; a real one still is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-empty-meal-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { wakeHm: '08:00', bedHm: '00:00' } });
    store.writeLocal('supplements', 'supp.co', { id: 'supp.co', kind: 'supplement', name: 'Collagen peptides', short: 'collagen', days: { type: 'daily' }, status: 'active', order: 1, afterMeal: 'second', perTake: { train: 1, rest: 1 } });
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
    await dishesTick({ store, push, now: at('11:00'), tz: TZ });
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('13:15'), name: 'Breakfast', source: 'manual', before: { items: RICE } });
    await dishesTick({ store, push, now: at('13:15'), tz: TZ });
    await dishesTick({ store, push, now: at('13:17'), tz: TZ });
    sent.length = 0;
    // 6:21 PM: "Log it without a photo" from an old app version: an empty meal syncs while he types.
    store.writeLocal('meals', 'm2', empty('m2', '18:21'));
    assert.equal(await dishesTick({ store, push, now: at('18:21') + 15000, tz: TZ }), null);
    assert.equal(await dishesTick({ store, push, now: at('18:25'), tz: TZ }), null);
    assert.deepEqual(sent, [], 'no "Dinner done. Get up and take your collagen now" from an empty meal');
    assert.deepEqual(recordsOf(store, 'meals').map((m) => m.id), ['m1']);
    // He saves what he ate (his preset): now it's his second meal, and the collagen prompt comes.
    store.writeLocal('meals', 'm2', mealFromPreset({ id: 'm2', at: at('18:26'), preset: { id: 'preset.second-meal', name: 'Second meal', items: RICE } }));
    const r = await dishesTick({ store, push, now: at('18:26') + 10000, tz: TZ });
    assert.equal(r?.key, 'supps-after-meal-2');
    assert.match(sent[0].body, /^Second meal done\. Get up and take your collagen now\./);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('his presets in the order that suits the meal time: the last meal\'s preset first at 6:21 PM, the first meal\'s at noon', () => {
  const presets = [{ id: 'p1', name: 'First meal', items: RICE }, { id: 'p2', name: 'Second meal', items: RICE }];
  const slots = [{ name: 'First meal', time: '12:30' }, { name: 'Last meal', time: '16:30' }];
  assert.deepEqual(presetsFor(presets, slots, '18:21').map((p) => p.name), ['Second meal', 'First meal'], 'the last meal time is nearest: its place matches the second preset');
  assert.deepEqual(presetsFor(presets, slots, '12:05').map((p) => p.name), ['First meal', 'Second meal']);
  assert.deepEqual(presetsFor([{ id: 'x', name: 'Last meal', items: RICE }, ...presets], slots, '17:00').map((p) => p.name)[0], 'Last meal', 'a preset named like the meal time wins');
  assert.deepEqual(presetsFor(presets, [], '18:00'), presets, 'no meal times: as saved');
  assert.deepEqual(presetsFor([], slots, '18:00'), []);
});

test('the coach\'s "Meals today" leaves an empty meal out, so his last meal still shows as next', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-empty-meal2-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { fuel: { mealTimes: [{ name: 'First meal', time: '12:30' }, { name: 'Last meal', time: '16:30' }] } });
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('13:15'), name: 'Breakfast', before: { items: RICE } });
    store.writeLocal('meals', 'm2', empty('m2', '18:21'));
    const line = mealsNowLine(snapshot(store, { tz: TZ, now: at('18:30') }));
    assert.doesNotMatch(line, /Dinner/);
    assert.match(line, /Next meal: Last meal/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
