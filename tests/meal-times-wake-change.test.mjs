// Tue 11/10, his words: "Why would my first meal by the moment i wake up??". His day went from 4:00 AM - 6:00 PM to
// 6:30 AM - 8:30 PM; his meal times (first 6:30 AM, latest 8:00 AM; last 1:00 PM, latest 2:00 PM) stayed where they
// were, nothing called the 6:30 AM first meal out, and the coach passed them on as "the app moved your meal times to fit
// the new hours". Now: his meal times never move by themselves, the nudges tool tells the coach to ask him (its pick:
// the same gap from waking as before), and a meal under an hour after he wakes doesn't fit his day anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { contextLine } from '../server/coach/tools-read.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { mealFitIssues, MEAL_WAKE_GAP_MIN } from '../app/js/lib/fuel-reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const TUE = '2026-03-17';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const AGREED = [{ name: 'First meal', time: '06:30', latest: '08:00', cookMin: 30 }, { name: 'Last meal', time: '13:00', latest: '14:00', cookMin: 30 }];

function day({ wakeHm = '04:00', bedHm = '18:00', mealTimes = AGREED } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-meal-wake-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { notify: { wakeHm, bedHm, movingDay: false, nudgeEveryMin: 20 }, fuel: { mealTimes } });
  const tool = (name, args, t) => TOOLS.find((x) => x.name === name).run(args, { store, tz: TZ, now: () => t });
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, tool, done };
}

test('his 5:30 PM change, wake 6:30 AM and bed 8:30 PM: meals not moved, never passed on, the coach asks with the same gap from waking as its pick', async () => {
  const f = day();
  try {
    const now = at(TUE, '17:30');
    const r = await f.tool('nudges', { wakeHm: '06:30', bedHm: '20:30' }, now);
    assert.match(r.text, /His meal times did NOT move: Settings still has First meal 6:30 AM \(latest 8:00 AM\), Last meal 1:00 PM \(latest 2:00 PM\), and they don't fit this day: First meal 6:30 AM is right at wake-up \(6:30 AM\), too soon after waking\./);
    assert.match(r.text, /Never say the app moved or fitted them, and never pass these on as his new times\. Ask him in one short question/);
    // 2 h 30 min after waking, as before: 9:00 AM (latest 10:30 AM), 3:30 PM (latest 4:30 PM).
    assert.match(r.text, /Your pick: the same gap from waking as before: First meal 9:00 AM \(latest 10:30 AM\), Last meal 3:30 PM \(latest 4:30 PM\)\./);
    assert.doesNotMatch(r.text, /Meal times from now/);
    // Nothing was written to his meal times.
    assert.deepEqual(f.store.getRecord('settings', 'main').data.fuel.mealTimes, AGREED);
    // Every message after it: the coach sees they don't fit until he gives new ones.
    assert.match(contextLine({ store: f.store, tz: TZ, now: at(TUE, '17:31') }), /MEAL TIMES DON'T FIT HIS DAY: First meal 6:30 AM is right at wake-up/);
    // His answer ("8:30am first meal maybe and then after gym whenever im back after 2pm"): fits, nothing called out.
    const ok = await f.tool('fuel_settings', { action: 'meal_times', times: [{ name: 'First meal', time: '08:30', latest: '10:00', cook_min: 30 }, { name: 'Last meal', time: '14:00', latest: '15:00', cook_min: 30 }], said: '8:30am first meal maybe and then after gym whenever im back after 2pm' }, now);
    assert.doesNotMatch(ok.text, /fit/);
    assert.doesNotMatch(contextLine({ store: f.store, tz: TZ, now: at(TUE, '17:33') }), /DON'T FIT/);
  } finally { f.done(); }
});

test('only his bedtime changes: still asked, never passed on; the pick is to keep them when they fit', async () => {
  const f = day();
  try {
    const r = await f.tool('nudges', { bedHm: '20:30' }, at(TUE, '17:30'));
    assert.match(r.text, /His meal times did NOT move: Settings still has First meal 6:30 AM \(latest 8:00 AM\), Last meal 1:00 PM \(latest 2:00 PM\)\. Never say/);
    assert.match(r.text, /His wake time didn't change; the pick is to keep them as they are\./);
    // The same wake and bed again: nothing changed, the times are just said (no question).
    const same = await f.tool('nudges', { wakeHm: '04:00', bedHm: '20:30' }, at(TUE, '17:35'));
    assert.match(same.text, /Meal times from now: First meal 6:30 AM \(latest 8:00 AM\), Last meal 1:00 PM \(latest 2:00 PM\)\.$/);
  } finally { f.done(); }
});

test('the same gap from waking would run into bed: said, and the coach picks times that fit', async () => {
  const f = day({ wakeHm: '04:00', bedHm: '18:00' });
  try {
    // Wake 3 hours later, bed unchanged: the last meal kept at its gap (4:00 PM, latest 5:00 PM) is 1 h before bed.
    const r = await f.tool('nudges', { wakeHm: '07:00' }, at(TUE, '17:30'));
    assert.match(r.text, /The same gap from waking \(First meal 9:30 AM \(latest 11:00 AM\), Last meal 4:00 PM \(latest 5:00 PM\)\) doesn't fit either: Last meal 4:00 PM \(latest 5:00 PM\) is only 1 h before bedtime \(6:00 PM\), too close to bed; pick times that fit\./);
    assert.doesNotMatch(r.text, /Your pick: the same gap/);
  } finally { f.done(); }
});

test('an earlier wake and a day across midnight: the gap is kept the short way round', async () => {
  const f = day({ wakeHm: '10:00', bedHm: '00:00', mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00' }, { name: 'Last meal', time: '16:30', latest: '17:00' }] });
  try {
    const earlier = await f.tool('nudges', { wakeHm: '08:00', bedHm: '22:00' }, at(TUE, '09:00'));
    assert.match(earlier.text, /Your pick: the same gap from waking as before: First meal 10:30 AM \(latest 12:00 PM\), Last meal 2:30 PM \(latest 3:00 PM\)\./);
    const late = await f.tool('nudges', { wakeHm: '23:00', bedHm: '13:00' }, at(TUE, '09:05'));
    // 8:00 AM to 11:00 PM: 9 h earlier, not 15 h later; his meals (still 12:30 PM and 4:30 PM) keep 4 h 30 min and 8 h 30 min.
    assert.match(late.text, /Your pick: the same gap from waking as before: First meal 3:30 AM \(latest 5:00 AM\), Last meal 7:30 AM \(latest 8:00 AM\)\./);
  } finally { f.done(); }
});

test('mealFitIssues: a meal under an hour after he wakes does not fit; an hour or more does', () => {
  assert.equal(MEAL_WAKE_GAP_MIN, 60);
  const day630 = (times) => mealFitIssues(times, '06:30', '20:30');
  assert.match(day630([{ name: 'First meal', time: '06:30' }])[0], /First meal 6:30 AM is right at wake-up \(6:30 AM\), too soon after waking/);
  assert.match(day630([{ name: 'First meal', time: '07:00' }])[0], /only 30 min after wake-up \(6:30 AM\)/);
  assert.deepEqual(day630([{ name: 'First meal', time: '07:30' }]), [], 'an hour after waking fits');
  assert.deepEqual(day630([{ name: 'First meal', time: '08:30', latest: '10:00' }, { name: 'Last meal', time: '14:00', latest: '15:00' }]), []);
  // Across midnight: wake 11:00 PM, a 11:30 PM meal is too soon; 12:30 AM fits.
  assert.match(mealFitIssues([{ name: 'A', time: '23:30' }], '23:00', '13:00')[0], /only 30 min after wake-up/);
  assert.deepEqual(mealFitIssues([{ name: 'A', time: '00:30' }], '23:00', '13:00'), []);
});
