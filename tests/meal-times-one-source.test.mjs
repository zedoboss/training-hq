// Thu 11/5, his words: "see if something doesn't update accordingly instantly whenever I talk with you here in the
// chat" / "Dig even further" / "not 4:30pm i go to bed at 6pm new schedule is wake up 4am too". On the moving schedule
// the reminders moved his meal times to when he woke (first meal 6:30 AM, last meal 10:30 AM) while the coach's context,
// the today tool and Fuel still said Settings' 12:30 PM and 4:30 PM; then his day became 4:00 AM to 6:00 PM and the
// 4:30 PM last meal stood right before bed. One meal time per meal now, everywhere, and one that doesn't fit his day is
// said at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, noteAppOpen, plan, publishDayClock, DAY_CLOCK } from '../server/notify.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { mealTimesLine, mealsNowLine, contextLine, todayText } from '../server/coach/tools-read.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { mealFitIssues, mealTimesOf } from '../app/js/lib/fuel-reminders.js';
import { phoneMealTimes } from '../app/js/lib/moving-day.js';

const TZ = 'Asia/Ho_Chi_Minh';
const MON = '2026-03-16';
const TUE = '2026-03-17';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const USUAL = [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }, { name: 'Last meal', time: '16:30', latest: '17:00', cookMin: 30 }];

function day({ moving = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-meal-one-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 20, kinds: { walk: false, dishes: false }, ...(moving ? {} : { movingDay: false }) },
    fuel: { mealTimes: USUAL },
  });
  let now = at(MON, '12:00');
  const push = { list: () => [{}], notify: async () => ({ sent: 1, failed: 0 }) };
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = from; t <= to; t += 60000) { now = t; await n.tick(); } };
  const say = (t, text = 'hi') => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t });
  // Slept Monday 4:00 AM to 12:40 PM, up through the night, last sign 6:54 AM Tuesday; up again at 5:54 PM Tuesday.
  store.writeLocal('sleep-log', MON, { id: MON, date: MON, bed: at(MON, '04:00'), wake: at(MON, '12:40'), inBedMin: 520, asleepMin: 520, source: 'coach' });
  for (const hm of ['13:00', '17:00', '21:00']) say(at(MON, hm));
  for (const hm of ['01:46', '05:19', '06:54']) say(at(TUE, hm));
  const tool = (name, args, t) => TOOLS.find((x) => x.name === name).run(args, { store, tz: TZ, now: () => t });
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, run, say, tool, done };
}

test('the moving schedule: the coach, the today tool, the next meal and Fuel say the times the reminders use', async () => {
  const f = day();
  try {
    f.store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: at(TUE, '17:54') });
    noteAppOpen(f.store, at(TUE, '17:54'), TZ);
    f.say(at(TUE, '17:55'), 'up');
    await f.run(at(TUE, '17:54'), at(TUE, '18:10'));
    f.say(at(TUE, '18:10'), 'all good, 0');
    const now = at(TUE, '18:30');
    // The reminders: woke 5:54 PM = his 10:00 AM, so 12:30 PM is 8:25 PM (cook 7:55 PM), 4:30 PM is 12:25 AM.
    const items = plan(f.store, now, TZ);
    const cook = items.find((i) => i.id === `meal-cook:${TUE}:1230`);
    assert.equal(cook.at, at(TUE, '19:55'));
    const s = snapshot(f.store, { tz: TZ, now });
    const line = mealTimesLine(s);
    assert.match(line, /^His meal times TODAY .*First meal 8:25 PM \(9:55 PM at the latest\), start cooking 7:55 PM; Last meal 12:25 AM \(12:55 AM at the latest\)/);
    assert.match(line, /never quote those as today's/);
    assert.equal(s.mealTimes().slots[0].at, cook.at + 30 * 60000, 'the same instant as the reminder');
    assert.match(todayText(s), /His meal times TODAY [^\n]*\): First meal 8:25 PM/);
    assert.match(mealsNowLine(s), /Next meal: First meal \(8:25 PM, 9:55 PM at the latest\)/);
    assert.match(contextLine({ store: f.store, tz: TZ, now }), /Now: Meals today[^\n]*Next meal: First meal \(8:25 PM/);
    // His phone gets the same: the day clock the Mac publishes moves Fuel's meal times the same way.
    publishDayClock(f.store, now, TZ);
    const clock = f.store.getRecord(DAY_CLOCK.col, DAY_CLOCK.id).data;
    assert.equal(clock.moving, true);
    assert.deepEqual(phoneMealTimes(mealTimesOf(USUAL), clock, now).map((t) => [t.time, t.latest, t.slot]), [['20:25', '21:55', '12:30'], ['00:25', '00:55', '16:30']]);
    assert.deepEqual(phoneMealTimes(mealTimesOf(USUAL), clock, now + 25 * 3600000).map((t) => t.time), ['12:30', '16:30'], 'a clock a day old: Settings as they are');
    assert.deepEqual(phoneMealTimes(mealTimesOf(USUAL), { ...clock, asleep: true }, now).map((t) => t.time), ['12:30', '16:30']);
    // "Cooking" by talking lands on the meal the reminders ask about, with the reminders' id (Settings slot, his day).
    const r = await f.tool('meal_check', { answer: 'cooking' }, at(TUE, '20:05'));
    assert.match(r.text, /^First meal: cooking/);
    assert.ok(f.store.getRecord('meal-checks', `${TUE}.1230`), 'the id the phone and the reminders use');
    // A meal logged by the coach at 12:30 AM is named by the moved times: the last meal, not a "Snack".
    f.say(at(TUE, '23:50'));
    const logged = await f.tool('log_meal', { items: [{ name: 'Beef, shank crosscuts, separable lean only, trimmed to 1/4" fat, choice, raw', grams: 500 }], said: 'ate the beef' }, at(TUE, '23:55'));
    const meal = f.store.listRecords('meals').map((x) => x.data).find((m) => m.at === at(TUE, '23:55'));
    assert.ok(meal, logged.text);
    assert.equal(meal.name, 'Last meal', logged.text);
  } finally { f.done(); }
});

test('a fixed day: Settings\' times every day, the same on Fuel; nothing moves', () => {
  const f = day({ moving: false });
  try {
    const now = at(TUE, '11:00');
    const s = snapshot(f.store, { tz: TZ, now });
    assert.match(mealTimesLine(s), /^His meal times, every day: First meal 12:30 PM \(2:00 PM at the latest\)/);
    publishDayClock(f.store, now, TZ);
    const clock = f.store.getRecord(DAY_CLOCK.col, DAY_CLOCK.id).data;
    assert.equal(clock.moving, false);
    assert.deepEqual(phoneMealTimes(mealTimesOf(USUAL), clock, now).map((t) => t.time), ['12:30', '16:30']);
  } finally { f.done(); }
});

test('his new day, 4:00 AM to 6:00 PM: a 4:30 PM last meal is called out at once, by the nudges tool, fuel_settings and the context', async () => {
  const f = day();
  try {
    const now = at(TUE, '07:59');
    const r = await f.tool('nudges', { wakeHm: '04:00', bedHm: '18:00', movingDay: false }, now);
    assert.match(r.text, /Meal times from now: First meal 12:30 PM \(latest 2:00 PM\), Last meal 4:30 PM \(latest 5:00 PM\)\./);
    assert.match(r.text, /They don't fit this day: Last meal 4:30 PM \(latest 5:00 PM\) is only 1 h before bedtime \(6:00 PM\), too close to bed\. Ask him/);
    assert.doesNotMatch(r.text, /First meal 12:30 PM[^;.]*too close/);
    // The coach sees it with every message until the times fit.
    assert.match(contextLine({ store: f.store, tz: TZ, now }), /MEAL TIMES DON'T FIT HIS DAY: Last meal 4:30 PM/);
    // His "bare minimum 4pm but even then its too late": 4:00 PM is still called out.
    const four = await f.tool('fuel_settings', { action: 'meal_time', meal: 'Last meal', time: '16:00', latest: '', said: 'bare minimum 4pm' }, now);
    assert.match(four.text, /don't fit his day \(4:00 AM to 6:00 PM\): Last meal 4:00 PM is only 2 h before bedtime/);
    // The times he agreed (6:30 AM, latest 8:00 AM; 1:00 PM, latest 2:00 PM): they fit, nothing called out.
    const ok = await f.tool('fuel_settings', { action: 'meal_times', times: [{ name: 'First meal', time: '06:30', latest: '08:00', cook_min: 30 }, { name: 'Last meal', time: '13:00', latest: '14:00', cook_min: 30 }], said: 'yeah' }, now);
    assert.doesNotMatch(ok.text, /fit/);
    const s = snapshot(f.store, { tz: TZ, now: at(TUE, '08:05') });
    assert.match(mealTimesLine(s), /^His meal times, every day: First meal 6:30 AM \(8:00 AM at the latest\), start cooking 6:00 AM; Last meal 1:00 PM \(2:00 PM at the latest\), start cooking 12:30 PM\. Guide him by these: when to cook, when to eat, and say it plainly when one is late\.$/);
    assert.doesNotMatch(contextLine({ store: f.store, tz: TZ, now: at(TUE, '08:05') }), /DON'T FIT/);
    // And the reminders use the same ones the moment they're set.
    const items = plan(f.store, at(TUE, '08:05'), TZ);
    assert.equal(items.find((i) => i.id === `meal-cook:${TUE}:1300`)?.at, at(TUE, '12:30'));
    assert.ok(!items.some((i) => /:1630$/.test(i.id)), 'no 4:30 PM meal left anywhere');
  } finally { f.done(); }
});

test('mealFitIssues: before bed by more than 2 hours fits; outside the day or past bed never does', () => {
  const day4to6 = (times) => mealFitIssues(times, '04:00', '18:00');
  assert.deepEqual(day4to6([{ name: 'A', time: '06:30', latest: '08:00' }, { name: 'B', time: '13:00', latest: '14:00' }]), []);
  assert.deepEqual(day4to6([{ name: 'B', time: '15:30' }]), [], '2 h 30 min before bed fits');
  assert.match(day4to6([{ name: 'B', time: '16:00' }])[0], /only 2 h before bedtime/);
  assert.match(day4to6([{ name: 'B', time: '15:00', latest: '17:30' }])[0], /only 30 min before bedtime/);
  assert.match(day4to6([{ name: 'B', time: '19:00' }])[0], /outside the day \(4:00 AM to 6:00 PM\)/);
  assert.match(day4to6([{ name: 'A', time: '03:00' }])[0], /outside the day/);
  // A day across midnight (10:00 AM to 12:00 AM): 4:30 PM fits.
  assert.deepEqual(mealFitIssues(USUAL, '10:00', '00:00'), []);
  assert.match(mealFitIssues([{ name: 'L', time: '23:00' }], '10:00', '00:00')[0], /only 1 h before bedtime \(12:00 AM\)/);
  assert.deepEqual(mealFitIssues(USUAL, null, '18:00'), [], 'no day set: nothing to say');
});
