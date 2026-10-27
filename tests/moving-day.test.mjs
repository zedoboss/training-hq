// Tue 10/27, his words: "Why would i be up at 10am?... I slept from like 8 a.m. till 4.50 maybe... a constant moving
// schedule... I fall asleep by 1-2 hours later every day on average... If I log that I just ate a meal, I'm not going to
// go to sleep immediately... wait at least an hour. And if I'm gone, then the coach can assume that I'm asleep until my
// next message... calculate the sleep automatically"; then "resume the moving schedule and send notifications
// accordingly... if I do have a consistent schedule... the moving schedule can be turned off, like in a setting".
// "Morning. Are you up?" went out at his 10:00 AM wake setting while he slept; at 5:54 PM "Morning holds now" before
// "Morning." (the 5:18 AM questions, asked before he slept, counted as answered). lib/moving-day.js, server/notify.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate, noteAppOpen, clockOf, foodDayOf, plan, morningContext, hoursNow } from '../server/notify.mjs';
import { dayClock, bodyClock, realTimes, usualSleepMin, bedAfter, movingDayOf, MOVING } from '../app/js/lib/moving-day.js';
import { wakingDay } from '../app/js/lib/waking-day.js';
import { withDefaults } from '../app/js/lib/settings.js';
import { TOOLS } from '../server/coach/tools.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const MON = '2026-03-16';
const TUE = '2026-03-17';
const WED = '2026-03-18';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const H = 3600000;

// ---- the rules, pure ----

test('his sleep length: the median of his last 5 nights, 4 to 14 hours; none = 8 h 30 min', () => {
  const n = (bed, wake) => ({ bed: at(MON, bed), wake: at(MON, wake) });
  assert.equal(usualSleepMin([n('00:00', '08:50'), n('00:00', '08:40'), n('00:00', '09:30'), n('00:00', '07:00'), n('00:00', '09:00')]), 530);
  assert.equal(usualSleepMin([n('00:00', '01:00')]), MOVING.sleepMin, 'an hour is not a night');
  assert.equal(usualSleepMin([]), 510);
});

test('after a meal he stays up at least an hour: asleep from his last sign, or the meal + 1 hour if later', () => {
  assert.equal(bedAfter(at(TUE, '06:54'), [at(TUE, '06:45')]), at(TUE, '07:45'));
  assert.equal(bedAfter(at(TUE, '09:00'), [at(TUE, '06:45')]), at(TUE, '09:00'));
  assert.equal(bedAfter(at(TUE, '06:54'), [at(TUE, '06:45')], at(TUE, '07:30')), at(TUE, '07:30'), 'never past his wake');
});

test('his day: bed 1 h 30 min later than the last; gone quiet near it, an hour past his meal = asleep; next sign = woke', () => {
  const sleeps = [{ bed: at(MON, '04:00'), wake: at(MON, '12:40') }];
  const signs = [at(MON, '13:00'), at(MON, '18:00'), at(MON, '22:45'), at(TUE, '01:46'), at(TUE, '05:19'), at(TUE, '06:45'), at(TUE, '06:54')];
  const meals = [at(MON, '22:45'), at(TUE, '06:45')];
  const up = dayClock({ now: at(TUE, '07:20'), signs, mealTimes: meals, sleeps });
  assert.equal(up.wokeAt, at(MON, '12:40'), 'the wake he told, before his first sign');
  assert.equal(up.bedAt, at(TUE, '05:30'), 'Monday 4:00 AM + 25 h 30 min');
  assert.equal(up.asleep, false, '26 minutes quiet, 35 minutes after his meal: still up');
  assert.equal(dayClock({ now: at(TUE, '07:50'), signs, mealTimes: meals, sleeps }).asleep, false, 'an hour past his meal, 56 minutes quiet');
  const later = dayClock({ now: at(TUE, '07:55'), signs, mealTimes: meals, sleeps });
  assert.equal(later.asleep, true);
  assert.equal(later.asleepSince, at(TUE, '07:45'), 'his meal at 6:45 AM + 1 hour, not his 6:54 AM message');
  const woke = dayClock({ now: at(TUE, '17:55'), signs: [...signs, at(TUE, '17:54')], mealTimes: meals, sleeps });
  assert.equal(woke.asleep, false);
  assert.equal(woke.wokeAt, at(TUE, '17:54'));
  assert.equal(woke.nightBed, at(TUE, '07:45'));
  assert.equal(woke.gap, true);
  assert.equal(woke.bedAt, at(WED, '09:15'), 'Tuesday 7:45 AM + 25 h 30 min');
});

// Wed 10/28, his words: "how the fuck did you assume that I went to bed again after waking up?... I cannot sleep from
// 8 a.m. till 4.50 and then go back to bed at 6.20 p.m.... Obviously, I haven't been on my phone": off his phone 6:21 PM
// to 12:30 AM was "Sleep logged from your activity: 6:21 PM to 12:30 AM" and "Morning." at 12:30 AM.
test('hours off his phone in the middle of his day are not sleep: asleep only near his bedtime', () => {
  const sleeps = [{ bed: at(TUE, '08:00'), wake: at(TUE, '16:50'), source: 'coach' }];
  const signs = [at(TUE, '17:54'), at(TUE, '18:19'), at(TUE, '18:21')];
  const quiet = dayClock({ now: at(WED, '00:29'), signs, sleeps });
  assert.equal(quiet.asleep, false, '6 h 08 min quiet, 9 hours before his bedtime');
  assert.equal(quiet.bedAt, at(WED, '09:30'));
  assert.equal(quiet.sleepFrom, at(WED, '05:30'), 'the earliest he is taken as asleep: 4 hours before it');
  const back = dayClock({ now: at(WED, '00:31'), signs: [...signs, at(WED, '00:30')], sleeps });
  assert.equal(back.wokeAt, at(TUE, '16:50'), 'still his Tuesday, up since 4:50 PM');
  assert.deepEqual(back.nights, []);
  assert.equal(movingDayOf(at(WED, '00:31'), { signs: [...signs, at(WED, '00:30')], sleeps, wakeHm: '10:00', tz: TZ }), TUE);
  // Quiet on into the morning: asleep from 5:30 AM, not from 6:21 PM; up at 2:00 PM: that night, 5:30 AM to 2:00 PM.
  const late = dayClock({ now: at(WED, '05:31'), signs, sleeps });
  assert.equal(late.asleep, true);
  assert.equal(late.asleepSince, at(WED, '05:30'));
  const woke = dayClock({ now: at(WED, '14:05'), signs: [...signs, at(WED, '14:00')], sleeps });
  assert.deepEqual(woke.nights, [{ bed: at(WED, '05:30'), wake: at(WED, '14:00') }]);
  assert.equal(woke.wokeAt, at(WED, '14:00'));
  // A gap that only just reaches his bedtime window (back at 7:00 AM, 1 h 30 min into it): not a night.
  assert.deepEqual(dayClock({ now: at(WED, '07:05'), signs: [...signs, at(WED, '07:00')], sleeps }).nights, []);
});

test('never asleep sooner than 8 hours after he woke, whatever his last bedtime says', () => {
  // Slept 10:00 PM Monday to 4:50 PM Tuesday: bed again about 11:30 PM by the drift, but he only just got up.
  const sleeps = [{ bed: at(MON, '22:00'), wake: at(TUE, '16:50'), source: 'coach' }];
  const signs = [at(TUE, '17:00'), at(TUE, '18:00')];
  const c = dayClock({ now: at(TUE, '23:00'), signs, sleeps });
  assert.equal(c.sleepFrom, at(WED, '00:50'));
  assert.equal(c.asleep, false);
  assert.equal(dayClock({ now: at(WED, '01:00'), signs, sleeps }).asleep, true);
});

test('his last sign a meal: not asleep within the hour, even in his bedtime window', () => {
  const sleeps = [{ bed: at(TUE, '08:00'), wake: at(TUE, '16:50'), source: 'coach' }];
  const signs = [at(TUE, '17:54'), at(WED, '06:00')];
  const meals = [at(WED, '06:00')];
  assert.equal(dayClock({ now: at(WED, '06:59'), signs, mealTimes: meals, sleeps }).asleep, false);
  assert.equal(dayClock({ now: at(WED, '07:01'), signs, mealTimes: meals, sleeps }).asleepSince, at(WED, '07:00'));
});

test('his body clock: his wake reads as his wake time in Settings; the day he woke on, across midnight', () => {
  const b = bodyClock(at(TUE, '16:50'), '10:00', TZ);
  assert.equal(b.zone, '+00:10');
  assert.equal(b.shiftMin, 410);
  assert.equal(b.date, TUE);
  // Woke 1:20 AM Sunday after 11:50 PM Friday: Saturday's and Friday's days, in order.
  assert.equal(bodyClock(at('2026-03-22', '01:20'), '10:00', TZ).date, '2026-03-21');
  assert.equal(bodyClock(at('2026-03-20', '23:50'), '10:00', TZ).date, '2026-03-20');
  assert.equal(realTimes('First meal at 12:30 PM; 2:00 PM at the latest.', 410), 'First meal at 7:20 PM; 8:50 PM at the latest.');
  // Food at 2:00 AM Wednesday, up since 4:50 PM Tuesday: Tuesday.
  assert.equal(movingDayOf(at(WED, '02:00'), { signs: [at(TUE, '16:50'), at(WED, '01:00')], wakeHm: '10:00', tz: TZ }), TUE);
  assert.equal(wakingDay(at(WED, '11:00'), { tz: TZ, signs: [at(TUE, '16:50'), at(TUE, '22:00'), at(WED, '02:00'), at(WED, '06:00'), at(WED, '09:00')], moving: { wakeHm: '10:00' } }), TUE, 'still up at 11:00 AM: not noon-capped');
});

test('the moving schedule is on by default, a setting turns it off', () => {
  assert.equal(withDefaults({}).notify.movingDay, true);
  assert.equal(withDefaults({}).notify.driftMin, 90);
});

// ---- his Tuesday, through the Mac's clock ----

function day({ moving = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-moving-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 20, kinds: { walk: false, dishes: false }, ...(moving ? {} : { movingDay: false }) },
    fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }, { name: 'Last meal', time: '16:30', latest: '17:00', cookMin: 30 }] },
  });
  const sent = [];
  let now = at(MON, '12:00');
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = from; t <= to; t += 60000) { now = t; await n.tick(); } };
  const say = (t, text = 'hi') => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t });
  const opens = (t) => { store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: t }); noteAppOpen(store, t, TZ); };
  const meal = (id, t, date) => store.writeLocal('meals', id, { id, date, at: t, name: 'Dinner', source: 'manual', before: { items: [{ name: 'Ribs', grams: 200, kcal: 700, protein: 50 }] } });
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant');
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  // His Monday and the night: up 12:40 PM (slept from 4:00 AM), dinner 10:45 PM, Talk to 1:46 AM, collagen 5:19 AM,
  // ribs at 6:45 AM, his last message 6:54 AM.
  store.writeLocal('sleep-log', MON, { id: MON, date: MON, bed: at(MON, '04:00'), wake: at(MON, '12:40'), inBedMin: 520, asleepMin: 520, source: 'coach' });
  const night = () => {
    for (const hm of ['13:00', '15:00', '17:00', '19:00', '21:00']) say(at(MON, hm));
    meal('m0', at(MON, '22:45'), MON);
    for (const hm of ['01:41', '01:45', '01:46', '05:19', '06:46', '06:52', '06:54']) say(at(TUE, hm));
    meal('m1', at(TUE, '06:45'), MON);
  };
  return { store, sent, run, say, opens, meal, talk, night, done, get now() { return now; } };
}

test('his Tuesday replayed: asleep after his 6:45 AM ribs, nothing at 10:00 AM or all day, sleep worked out at 5:54 PM', async () => {
  const f = day();
  try {
    f.night();
    await f.run(at(TUE, '06:55'), at(TUE, '17:53'));
    assert.deepEqual(f.sent.filter((m) => m.at >= at(TUE, '07:55')).map((m) => m.body), [], 'no "Are you up?", no reminders while he sleeps');
    assert.equal(morningGate(f.store, at(TUE, '10:00'), TZ).asleep, true);
    assert.equal(clockOf(f.store, at(TUE, '10:00'), TZ).asleepSince, at(TUE, '07:45'));
    assert.equal(foodDayOf(f.store, at(TUE, '07:30'), TZ), MON, 'his ribs at 6:45 AM: Monday');
    f.opens(at(TUE, '17:54'));
    await f.run(at(TUE, '17:54'), at(TUE, '17:54'));
    const sleep = f.store.getRecord('sleep-log', TUE).data;
    assert.equal(sleep.source, 'auto');
    assert.equal(sleep.bed, at(TUE, '07:45'));
    assert.equal(sleep.wake, at(TUE, '17:54'));
    assert.equal(sleep.inBedMin, 609);
    const greet = f.talk().at(-1).text;
    assert.match(greet, /^Morning\. Sleep logged from your activity: 7:45 AM to 5:54 PM, 10 h 09 min\. Off\? Tell me the real times\. How does your body feel today\?/);
    assert.doesNotMatch(greet, /How did you sleep/);
    assert.equal(f.sent.filter((m) => m.at >= at(TUE, '07:55')).length, 0, 'he is in the app: no notification');
    assert.equal(foodDayOf(f.store, at(TUE, '18:30'), TZ), TUE);
    assert.equal(foodDayOf(f.store, at(TUE, '18:30'), TZ), TUE);
  } finally { f.done(); }
});

test('his moving day: the first meal comes 2 h 30 min after he woke, on the real clock; nothing before his morning', async () => {
  const f = day();
  try {
    f.night();
    f.opens(at(TUE, '17:54'));
    f.say(at(TUE, '17:55'), 'Why would i be up at 10am?');
    await f.run(at(TUE, '17:54'), at(TUE, '20:40'));
    const first = f.sent.find((m) => /meal/i.test(`${m.title} ${m.body}`));
    assert.ok(first, 'a meal reminder went out');
    // 12:00 PM (cook for 12:30 PM) on his body clock, woke 5:54 PM = 10:00 AM: 7:55 PM, 8:25 PM on the plate.
    assert.equal(first.at, at(TUE, '19:55'));
    assert.match(first.body, /8:25 PM/);
    assert.doesNotMatch(`${first.title} ${first.body}`, /12:30 PM|2:00 PM/);
    const items = plan(f.store, at(TUE, '20:40'), TZ).filter((i) => i.kind === 'meals' || i.kind === 'cook');
    assert.ok(items.length && items.every((i) => i.at >= at(TUE, '17:54')), 'none before he woke');
    assert.ok(items.some((i) => i.id.startsWith(`meal:${TUE}:`)), 'Tuesday\'s, his day');
    // After midnight he's still in Tuesday: the last meal (4:30 PM on his body clock) at 12:25 AM Wednesday.
    f.say(at(TUE, '23:30'));
    assert.ok(plan(f.store, at(WED, '00:10'), TZ).some((i) => i.id === `meal-cook:${TUE}:1630` && i.at === at(WED, '00:25') - 30 * 60000));
    assert.equal(hoursNow(f.store, at(WED, '00:10'), TZ).asleep, false);
  } finally { f.done(); }
});

test('the questions asked before he slept are not this morning\'s: nothing goes out ahead of "Morning."', async () => {
  const f = day();
  try {
    f.night();
    f.store.setMeta('morning:state', { date: TUE, from: at(TUE, '05:18'), sleep: at(TUE, '05:18'), body: at(TUE, '05:23') });
    f.opens(at(TUE, '17:54'));
    await f.run(at(TUE, '17:54'), at(TUE, '17:54'));
    assert.match(f.talk().at(-1).text, /^Morning\./);
    assert.equal(morningGate(f.store, at(TUE, '17:55'), TZ).hold, true, 'his morning is on: the day waits');
  } finally { f.done(); }
});

test('the coach is told his day moves, when he woke, his bedtime; and how to switch it off', async () => {
  const f = day();
  try {
    f.night();
    f.opens(at(TUE, '17:54'));
    await f.run(at(TUE, '17:54'), at(TUE, '17:54'));
    const line = morningContext(f.store, at(TUE, '18:00'), TZ);
    assert.match(line, /His day moves/);
    assert.match(line, /Up since 5:54 PM; his sleep before: 7:45 AM to 5:54 PM \(worked out by the app/);
    assert.match(line, /expected bedtime about 9:15 AM/);
    assert.match(line, /movingDay false/);
    assert.doesNotMatch(line, /is he up, how he slept/);
  } finally { f.done(); }
});

test('he tells the coach his schedule is steady: moving off, back to the wake time ("Are you up?" at 10:00 AM)', async () => {
  const f = day();
  try {
    const nudges = (args) => TOOLS.find((t) => t.name === 'nudges').run(args, { store: f.store, tz: TZ, now: () => at(TUE, '07:00') });
    f.night();
    const off = await nudges({ movingDay: false });
    assert.match(off.text, /moving schedule off/i);
    assert.equal(f.store.getRecord('settings', 'main').data.notify.movingDay, false);
    await f.run(at(TUE, '09:59'), at(TUE, '10:00'));
    assert.deepEqual(f.sent.map((m) => m.body), ['Morning. Are you up?']);
    const on = await nudges({ movingDay: true });
    assert.match(on.text, /moving schedule on/i);
  } finally { f.done(); }
});

test('on the phone: a meal at 2:00 AM, up since 4:50 PM, counts for the day he woke (no noon cap)', async () => {
  const { wakingDayAt } = await import('../app/js/lib/waking-day.js');
  const docs = { settings: { main: { notify: { wakeHm: '10:00', bedHm: '00:00' } } }, 'sleep-log': {}, health: {}, sessions: [], meals: [], 'meal-checks': [], 'supp-log': [],
    'coach-messages': [at(TUE, '16:50'), at(TUE, '20:00'), at(WED, '00:30'), at(WED, '05:00'), at(WED, '10:00')].map((t) => ({ role: 'user', at: t })) };
  const repo = { get: async (col, id) => docs[col]?.[id] ?? null, list: async (col) => (Array.isArray(docs[col]) ? docs[col] : Object.values(docs[col] || {})) };
  assert.equal(await wakingDayAt(repo, at(WED, '02:00'), TZ), TUE);
  assert.equal(await wakingDayAt(repo, at(WED, '12:30'), TZ), TUE, 'still up past noon: still Tuesday');
  docs.settings.main.notify.movingDay = false;
  assert.equal(await wakingDayAt(repo, at(WED, '12:30'), TZ), WED, 'moving off: noon caps it');
});

test('his Tuesday evening replayed: up at 4:50 PM, off his phone 6:21 PM to 12:30 AM: no sleep logged, no "Morning."', async () => {
  const f = day();
  try {
    f.store.writeLocal('sleep-log', TUE, { id: TUE, date: TUE, bed: at(TUE, '08:00'), wake: at(TUE, '16:50'), inBedMin: 530, asleepMin: 530, source: 'coach' });
    f.opens(at(TUE, '17:54'));
    for (const hm of ['17:55', '17:57', '18:18', '18:19', '18:21']) f.say(at(TUE, hm));
    await f.run(at(TUE, '18:22'), at(WED, '00:29'));
    assert.equal(hoursNow(f.store, at(TUE, '23:00'), TZ).asleep, false, 'off his phone, not asleep');
    f.opens(at(WED, '00:30'));
    await f.run(at(WED, '00:30'), at(WED, '00:32'));
    assert.ok(!f.store.getRecord('sleep-log', WED), 'no night logged');
    assert.equal(f.store.getRecord('sleep-log', TUE).data.source, 'coach');
    assert.ok(!f.talk().some((m) => m.at >= at(WED, '00:00') && /^Morning|Sleep logged/.test(m.text)), 'no "Morning." at 12:30 AM');
    assert.equal(clockOf(f.store, at(WED, '00:32'), TZ).wokeAt, at(TUE, '16:50'));
    assert.equal(foodDayOf(f.store, at(WED, '00:32'), TZ), TUE, 'food still counts to Tuesday');
  } finally { f.done(); }
});

test('a sleep the app worked out that the rule no longer sees is removed; what he told is kept', async () => {
  const f = day();
  try {
    f.store.writeLocal('sleep-log', TUE, { id: TUE, date: TUE, bed: at(TUE, '08:00'), wake: at(TUE, '16:50'), inBedMin: 530, asleepMin: 530, source: 'coach' });
    for (const hm of ['17:55', '18:21']) f.say(at(TUE, hm));
    f.opens(at(WED, '00:30'));
    f.store.writeLocal('sleep-log', WED, { id: WED, date: WED, bed: at(TUE, '18:21'), wake: at(WED, '00:30'), inBedMin: 369, asleepMin: 369, source: 'auto' });
    await f.run(at(WED, '00:40'), at(WED, '00:40'));
    assert.equal(f.store.getRecord('sleep-log', WED).deleted, true, 'the wrong 6:21 PM to 12:30 AM night is gone');
    assert.equal(f.store.getRecord('sleep-log', TUE).deleted, false);
    // His real night later is still logged by itself, on the same date.
    f.say(at(WED, '03:00'));
    await f.run(at(WED, '14:00'), at(WED, '14:00'));
    f.opens(at(WED, '14:00'));
    await f.run(at(WED, '14:01'), at(WED, '14:01'));
    const night = f.store.getRecord('sleep-log', WED);
    assert.equal(night.deleted, false);
    assert.equal(night.data.source, 'auto');
    assert.equal(night.data.bed, at(WED, '05:30'), 'from his bedtime window, not his 3:00 AM message');
    assert.equal(night.data.wake, at(WED, '14:00'));
  } finally { f.done(); }
});
