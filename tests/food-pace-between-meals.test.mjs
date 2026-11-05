// Fri 11/6 (his Thursday 11/5): breakfast eaten at 6:55 AM, last meal set for 1:00 PM (latest 2:00 PM) at 8:02 AM, and
// still "You should be near 1,300 kcal by now. Eat." at 8:56 AM, "Still behind on food... What's your next meal, and
// when?" at 10:57 AM and "Get a big meal in" at 12:57 PM, 3 minutes before the 1:00 PM meal reminder. His wish: between
// meals, no "behind" or "should be near X kcal" before his next set meal time, and never ask when a meal is once its
// time is set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { mealReminders } from '../app/js/lib/fuel-reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-01-22';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const targets = { kcal: 3174, protein: 242.5 };
const legsDay = { today: { kind: 'done', dayType: 'legs' } };
const food = (c) => c.filter((x) => x.key.startsWith('food:'));
const mealTimes = [{ name: 'First meal', time: '06:30', latest: '08:00', cookMin: 30 }, { name: 'Last meal', time: '13:00', latest: '14:00', cookMin: 30 }];
const breakfast = { id: 'm1', date: D, at: at('06:55'), kcal: 887, protein: 73.5 };
const cands = (now, { meals = [breakfast], checks = [], eaten = { kcal: 887, protein: 73.5 }, sent = {}, times = mealTimes } = {}) =>
  nudgeCandidates({ now, tz: TZ, reminders: mealReminders({ date: D, tz: TZ, meals, mealTimes: times, checks }), rot: legsDay,
    wakeHm: '04:00', bedHm: '18:00', targets, eaten, lastMealAt: meals.at(-1)?.at, sleepLogged: true, sent });

test('his Thursday: breakfast in, 1:00 PM meal ahead: no food pace nudge at 8:56, 10:57 or 12:57', () => {
  for (const t of ['08:56', '10:57', '12:57']) assert.deepEqual(food(cands(at(t))), [], t);
});

test('every minute from breakfast to his 1:00 PM meal time: no "behind", no "should be near", no "when?"', () => {
  // As if the earlier check-ins had gone out too: none of the later ones comes either.
  const sent = { [`food:${D}:${breakfast.at}-0`]: at('08:56'), [`food:${D}:${breakfast.at}-1`]: at('10:57') };
  for (let m = 7 * 60; m < 13 * 60; m++) {
    for (const s of [{}, sent]) {
      const c = cands(at(hm(m)), { sent: s });
      assert.deepEqual(food(c), [], hm(m));
      assert.ok(!c.some((x) => /should be near|behind on food|next meal, and when/i.test(x.text)), hm(m));
    }
  }
});

test('a snack between meals and still behind: quiet until the next meal time', () => {
  const snack = { id: 'm2', date: D, at: at('10:00'), kcal: 150, protein: 5 };
  for (const t of ['10:30', '11:45', '12:59']) assert.deepEqual(food(cands(at(t), { meals: [breakfast, snack], eaten: { kcal: 1037, protein: 78.5 } })), [], t);
});

test('three meal times: quiet before the second and before the third', () => {
  const three = [{ name: 'First meal', time: '06:30', latest: '08:00' }, { name: 'Second meal', time: '10:00', latest: '11:00' }, { name: 'Last meal', time: '14:00', latest: '15:00' }];
  const second = { id: 'm2', date: D, at: at('10:10'), kcal: 600, protein: 50 };
  assert.deepEqual(food(cands(at('09:30'), { times: three })), []);
  assert.deepEqual(food(cands(at('12:30'), { times: three, meals: [breakfast, second], eaten: { kcal: 1487, protein: 123.5 } })), []);
});

test('once his last meal time has passed and he answered it, behind speaks again, and never asks "when?" before a set meal', () => {
  // Last meal eaten at 1:20 PM, still well behind at 3:00 PM: nothing set ahead, so the pace may speak.
  const last = { id: 'm2', date: D, at: at('13:20'), kcal: 700, protein: 60 };
  const c = food(cands(at('15:00'), { meals: [breakfast, last], eaten: { kcal: 1587, protein: 133.5 } }));
  assert.equal(c.length, 1);
  assert.match(c[0].text, /^Food: 1,587 of 3,174 kcal/);
  // Skipped the last meal at its ask: no meal time left, the pace may speak too.
  const skipped = food(cands(at('14:30'), { checks: [{ id: `${D}.1300`, answer: 'skipped', at: at('13:05') }] }));
  assert.equal(skipped.length, 1);
});

test('tomorrow\'s first meal time doesn\'t silence this afternoon', () => {
  // The waking-day bound: a meal time past bedtime isn't "his next meal" today.
  const late = food(nudgeCandidates({ now: at('15:00'), tz: TZ, reminders: mealReminders({ date: '2026-01-23', tz: TZ, meals: [], mealTimes }), rot: legsDay,
    wakeHm: '04:00', bedHm: '18:00', targets, eaten: { kcal: 887, protein: 73.5 }, lastMealAt: breakfast.at, sleepLogged: true }));
  assert.equal(late.length, 1);
});
