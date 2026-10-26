// Sat 10/24 (his words: "technically it's past 12 a.m. ... but for the bar it does because I still haven't slept"):
// food and supplements after midnight, before he has slept, count toward the day he woke up on.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS, contextLine } from '../server/coach/tools.mjs';
import { wakingDay, wakingDayAt } from '../app/js/lib/waking-day.js';
import { newMeal, mealFromPreset, defaultMealName } from '../app/js/lib/meals.js';

const TZ = 'UTC';
const t = (iso, hm) => Date.parse(`${iso}T${hm}:00Z`);
// Friday 3/20: up at 10:30 AM (to bed 3:30 AM), a meal at 4:59 PM. Saturday 3/21, 2:43 AM: still up, he eats again.
const FRI = '2026-03-20'; const SAT = '2026-03-21';
const NIGHT = t(SAT, '02:43');

test('the rule: after midnight with no sign of sleep it is still the day before; from 6:00 AM the calendar date', () => {
  assert.equal(wakingDay(NIGHT, { tz: TZ }), FRI);
  assert.equal(wakingDay(t(SAT, '00:01'), { tz: TZ }), FRI);
  assert.equal(wakingDay(t(SAT, '05:59'), { tz: TZ }), FRI);
  assert.equal(wakingDay(t(SAT, '06:00'), { tz: TZ }), SAT);
  assert.equal(wakingDay(t(FRI, '23:59'), { tz: TZ }), FRI);
  assert.equal(wakingDay(t(FRI, '12:00'), { tz: TZ }), FRI);
});

test('slept and up since midnight: the new day, whichever says so (sleep he told, Apple Health, a workout)', () => {
  const sleepLog = { id: SAT, date: SAT, bed: t(SAT, '00:30'), wake: t(SAT, '04:00') };
  assert.equal(wakingDay(t(SAT, '04:30'), { tz: TZ, sleepLog }), SAT, 'up at 4:00 AM for an early session');
  assert.equal(wakingDay(t(SAT, '03:00'), { tz: TZ, sleepLog }), FRI, 'eaten before he went to sleep, logged the next morning');
  assert.equal(wakingDay(t(SAT, '04:30'), { tz: TZ, health: { date: SAT, sleep: { wake: t(SAT, '04:10') } } }), SAT);
  assert.equal(wakingDay(t(SAT, '02:00'), { tz: TZ, health: { date: SAT, sleep: { wake: t(FRI, '20:00') } } }), FRI, 'an evening nap is not the night');
  const workout = { id: 's1', kind: 'workout', startedAt: t(SAT, '03:30') };
  assert.equal(wakingDay(t(SAT, '05:00'), { tz: TZ, sessions: [workout] }), SAT, 'a workout started: he is up');
  assert.equal(wakingDay(t(SAT, '05:00'), { tz: TZ, sessions: [{ ...workout, kind: 'holds' }] }), FRI, 'a holds round before bed is not getting up');
  assert.equal(wakingDay(t(SAT, '03:00'), { tz: TZ, sessions: [workout] }), FRI, 'not before the workout started');
});

test('on the phone: from its local copy; a new meal takes the day it is given', async () => {
  const docs = { 'sleep-log': {}, health: {}, sessions: [] };
  const repo = { get: async (col, id) => docs[col][id] ?? null, list: async (col) => docs[col] };
  assert.equal(await wakingDayAt(repo, NIGHT, TZ), FRI);
  docs['sleep-log'][SAT] = { id: SAT, date: SAT, wake: t(SAT, '02:00') };
  assert.equal(await wakingDayAt(repo, NIGHT, TZ), SAT);
  assert.equal(newMeal({ id: 'm', at: NIGHT, name: 'Dinner', tz: TZ, date: FRI }).date, FRI);
  assert.equal(newMeal({ id: 'm', at: NIGHT, name: 'Dinner', tz: TZ }).date, SAT, 'no day given: the calendar date, as before');
  assert.equal(mealFromPreset({ id: 'm', at: NIGHT, preset: { id: 'p', name: 'Second meal', items: [] }, tz: TZ, date: FRI }).date, FRI);
  // Named for the night it belongs to, not "Breakfast" by the clock: his last meal time, else Dinner.
  const times = [{ name: 'Second meal', time: '18:00' }, { name: 'First meal', time: '12:30' }];
  assert.equal(defaultMealName(NIGHT, times, TZ), 'Breakfast');
  assert.equal(defaultMealName(NIGHT, times, TZ, { night: true }), 'Second meal');
  assert.equal(defaultMealName(NIGHT, [], TZ, { night: true }), 'Dinner');
});

let dir; let store; let clock;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-waking-'));
  store = openStore(join(dir, 'db.sqlite'));
  clock = NIGHT;
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('fuel', 'plan', { kind: 'plan', kcal: 3000, proteinG: 200 });
  w('settings', 'main', { fuel: { mealTimes: [{ name: 'First meal', time: '12:30' }, { name: 'Second meal', time: '18:00' }] } });
  w('supplements', 'supp.col', { id: 'supp.col', kind: 'supplement', name: 'Collagen', short: 'collagen', dose: '10 g', days: { type: 'daily' }, status: 'active', order: 1 });
  w('sleep-log', FRI, { id: FRI, date: FRI, bed: t(FRI, '03:30'), wake: t(FRI, '10:30'), inBedMin: 420, asleepMin: 420, source: 'coach' });
  w('meals', 'm1', { id: 'm1', date: FRI, at: t(FRI, '16:59'), name: 'First meal', before: { items: [{ name: 'Udon', grams: 375, kcal: 1000, protein: 80 }], confirmedAt: t(FRI, '17:00') } });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => clock, action: () => {} });
const call = (name, args = {}) => TOOLS.find((x) => x.name === name).run(args, ctx());
const meals = () => store.listRecords('meals').map((r) => r.data);

test('his night: the meal and collagen at 2:43 AM go on Friday at their real time, and Friday is what the coach sees', async () => {
  const r = await call('log_meal', { items: [{ name: 'Beef', grams: 375, kcal: 600, protein: 100 }] });
  assert.match(r.text, /^Logged [A-Za-z ]+, 2:43 AM \(counts for Friday 3\/20, his waking day\)/);
  assert.match(r.text, /\nFriday 3\/20: 1,600 kcal, 180 g protein/);
  const m = meals().find((x) => x.id !== 'm1');
  assert.deepEqual([m.date, m.at], [FRI, NIGHT], 'the day he woke up on, the time he ate');
  const s = await call('supplement', { names: ['collagen'], status: 'taken' });
  assert.match(s.text, /^Friday 3\/20: collagen 10 g taken/);
  assert.equal(store.getRecord('supp-log', store.listRecords('supp-log')[0].id).data.date, FRI);
  const c = contextLine({ store, tz: TZ, now: clock });
  assert.match(c, /Supplements today \(his waking day, Friday 3\/20: past midnight and he hasn't slept yet[^)]*\): 1 of 1 taken/);
  assert.match(c, /Meals today \(his waking day, Friday 3\/20[^)]*\): First meal 4:59 PM \(Udon 375 g\); Second meal 2:43 AM \(Beef 375 g\)\. Every meal time is done/);
  assert.match((await call('today')).text, /Food today \(his waking day, Friday 3\/20[^)]*\): 1,600 kcal of 3,000, 180 g protein of 200 g \(2 meals\)/);
});

test('a time after midnight named for Friday is the night after it; a correction keeps it there', async () => {
  const r = await call('log_meal', { items: [{ name: 'Eggs', grams: 120, kcal: 170, protein: 15 }], date: FRI, time: '02:40' });
  assert.equal(r.wrote, true, r.text);
  const m = meals().find((x) => x.id !== 'm1');
  assert.deepEqual([m.date, m.at], [FRI, t(SAT, '02:40')]);
  await call('correct_meal', { meal: m.id, time: '02:30' });
  const c = meals().find((x) => x.id === m.id);
  assert.deepEqual([c.date, c.at], [FRI, t(SAT, '02:30')]);
  // A Friday time from the evening stays on Friday evening.
  await call('log_meal', { items: [{ name: 'Rice', grams: 100, kcal: 130, protein: 3 }], date: FRI, time: '21:00' });
  assert.ok(meals().some((x) => x.date === FRI && x.at === t(FRI, '21:00')));
});

test('the next morning, once his sleep is in, Saturday starts empty; the night meal stays on Friday', async () => {
  await call('log_meal', { items: [{ name: 'Beef', grams: 375, kcal: 600, protein: 100 }] });
  clock = t(SAT, '10:45');
  await call('log_sleep', { bed: '03:15', wake: '10:30' });
  assert.match((await call('today')).text, /Food today: 0 kcal of 3,000, 0 g protein of 200 g \(0 meals\)/);
  const r = await call('log_meal', { items: [{ name: 'Banana', grams: 120, kcal: 105, protein: 1 }], name: 'Snack' });
  assert.match(r.text, /^Logged Snack, 10:45 AM \[id meal-/);
  assert.equal(meals().filter((x) => x.date === FRI).length, 2);
  assert.equal(meals().filter((x) => x.date === SAT).length, 1);
});

test('the app on his night: the 2:43 AM meal is Friday\'s second meal (collagen ask), not Saturday\'s first; food counts Friday', async () => {
  const { dishesTick, nudgeInputs } = await import('../server/notify.mjs');
  store.writeLocal('settings', 'main', { notify: { wakeHm: '10:00', bedHm: '00:00' }, fuel: { mealTimes: [{ name: 'First meal', time: '12:30' }, { name: 'Second meal', time: '18:00' }] } });
  store.writeLocal('supplements', 'supp.col', { id: 'supp.col', kind: 'supplement', name: 'Collagen', short: 'collagen', days: { type: 'daily' }, status: 'active', order: 1, afterMeal: 'second', perTake: { train: 1, rest: 1 } });
  store.writeLocal('supplements', 'supp.d3', { id: 'supp.d3', kind: 'supplement', name: 'D3', short: 'D3', days: { type: 'daily' }, status: 'active', order: 2, afterMeal: true, perTake: { train: 1, rest: 1 } });
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
  await dishesTick({ store, push, now: t(SAT, '02:00'), tz: TZ });
  sent.length = 0;
  clock = NIGHT;
  await call('log_meal', { items: [{ name: 'Beef', grams: 375, kcal: 600, protein: 100 }] });
  const r = await dishesTick({ store, push, now: NIGHT + 10000, tz: TZ });
  assert.equal(r?.key, 'supps-after-meal-2');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /^Second meal done\. Get up and take your collagen now\./);
  assert.doesNotMatch(sent.map((m) => m.body).join(' '), /D3/, 'no "first meal logged, take your supplements" for Saturday');
  const n = nudgeInputs(store, NIGHT + 60000, TZ);
  assert.deepEqual([n.args.eaten.kcal, n.args.eaten.protein], [1600, 180], 'the food nudges count Friday');
});

// Tue 10/27: up all night (Talk at 1:46 and 5:19 AM, collagen ticked for the day before at 5:19 AM), a meal at 6:31 AM
// went on the new day: the 6:00 AM cutoff flipped it though he hadn't slept. Now to noon, still up from the night
// (his stretch awake began before 3:00 AM, no 4 hours without a sign of him since) is still the day before.
const UP_ALL_NIGHT = [t(FRI, '22:45'), t(SAT, '01:41'), t(SAT, '01:46'), t(SAT, '05:19')];

test('past 6:00 AM: still up from the night is the day before, to noon; a sleep gap, sleep logged or noon is the new day', () => {
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: UP_ALL_NIGHT }), FRI, 'his Tuesday: up all night');
  assert.equal(wakingDay(t(SAT, '11:59'), { tz: TZ, signs: [...UP_ALL_NIGHT, t(SAT, '08:30'), t(SAT, '11:00')] }), FRI, 'still up at 11:59 AM');
  assert.equal(wakingDay(t(SAT, '12:00'), { tz: TZ, signs: [...UP_ALL_NIGHT, t(SAT, '08:30'), t(SAT, '11:00')] }), SAT, 'noon: the new day whatever');
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: () => UP_ALL_NIGHT }), FRI, 'signs as a function');
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ }), SAT, 'no signs: the calendar date, as before');
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: [t(FRI, '22:45'), t(SAT, '01:46')] }), SAT, 'quiet 1:46 to 6:31 AM: he slept');
  assert.equal(wakingDay(t(SAT, '09:00'), { tz: TZ, signs: [t(FRI, '22:45'), t(SAT, '01:46'), t(SAT, '06:00'), t(SAT, '08:00')] }), SAT, 'slept 1:46 to 6:00 AM, up since');
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: [t(FRI, '23:00'), t(SAT, '03:30'), t(SAT, '06:00')] }), SAT, 'a sleep gap ending 3:30 AM is a night');
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: [...UP_ALL_NIGHT, t(SAT, '07:00')] }), FRI, 'a sign after the meal time changes nothing');
  const sleepLog = { id: SAT, date: SAT, bed: t(SAT, '05:30'), wake: t(SAT, '06:20') };
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: UP_ALL_NIGHT, sleepLog }), SAT, 'sleep he told: the new day');
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: UP_ALL_NIGHT, health: { date: SAT, sleep: { wake: t(SAT, '06:10') } } }), SAT);
  assert.equal(wakingDay(t(SAT, '06:31'), { tz: TZ, signs: UP_ALL_NIGHT, sessions: [{ id: 's', kind: 'workout', startedAt: t(SAT, '06:05') }] }), SAT, 'a workout started');
  assert.equal(wakingDay(t(SAT, '05:00'), { tz: TZ, signs: [t(SAT, '04:50')] }), FRI, 'before 6:00 AM: as before');
});

test('on the phone past 6:00 AM: from its local messages, meals and ticks', async () => {
  const docs = { 'sleep-log': {}, health: {}, sessions: [], meals: [], 'meal-checks': [], 'supp-log': [{ at: t(SAT, '05:19') }],
    'coach-messages': UP_ALL_NIGHT.map((at) => ({ role: 'user', at })).concat([{ role: 'assistant', at: t(SAT, '03:30') }]) };
  const repo = { get: async (col, id) => docs[col][id] ?? null, list: async (col) => docs[col] };
  assert.equal(await wakingDayAt(repo, t(SAT, '06:45'), TZ), FRI);
  assert.equal(await wakingDayAt(repo, t(SAT, '12:01'), TZ), SAT);
  docs['coach-messages'] = [{ role: 'user', at: t(SAT, '01:46') }, { role: 'assistant', at: t(SAT, '04:00') }];
  docs['supp-log'] = [];
  assert.equal(await wakingDayAt(repo, t(SAT, '06:45'), TZ), SAT, 'only the coach wrote in the night: he slept');
});

test('his Tuesday: up all night, the meal at 6:31 AM and a tick at 6:45 AM go on the day before by themselves', async () => {
  UP_ALL_NIGHT.forEach((at, i) => store.writeLocal('coach-messages', `cm${i}`, { id: `cm${i}`, role: 'user', at, text: 'hi' }));
  clock = t(SAT, '06:45');
  const r = await call('log_meal', { items: [{ name: 'Pork ribs', grams: 200, kcal: 580, protein: 50 }], time: '06:31' });
  assert.match(r.text, /^Logged [A-Za-z ]+, 6:31 AM \(counts for Friday 3\/20, his waking day\)/, r.text);
  const m = meals().find((x) => x.id !== 'm1');
  assert.deepEqual([m.date, m.at], [FRI, t(SAT, '06:31')]);
  const s = await call('supplement', { names: ['collagen'], status: 'taken' });
  assert.match(s.text, /^Friday 3\/20: collagen 10 g taken/);
  assert.match(contextLine({ store, tz: TZ, now: clock }), /Meals today \(his waking day, Friday 3\/20/);
  const { foodDayOf } = await import('../server/notify.mjs');
  assert.equal(foodDayOf(store, clock, TZ), FRI, 'the app\'s nudges count Friday too');
  clock = t(SAT, '12:05');
  assert.equal(foodDayOf(store, clock, TZ), SAT, 'noon: Saturday');
});

test('slept in the night (no sign 1:46 to 6:31 AM): the 6:31 AM meal is the new day\'s', async () => {
  store.writeLocal('coach-messages', 'cm1', { id: 'cm1', role: 'user', at: t(SAT, '01:46'), text: 'night' });
  clock = t(SAT, '06:45');
  const r = await call('log_meal', { items: [{ name: 'Pork ribs', grams: 200, kcal: 580, protein: 50 }], time: '06:31' });
  assert.equal(meals().find((x) => x.id !== 'm1').date, SAT, r.text);
});
