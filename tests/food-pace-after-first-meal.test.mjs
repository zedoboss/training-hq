// Thu 11/5, his words: "Food: 0 of 3,174 kcal and 0 of 242.5 g protein at 7:52 AM. You should be near 500 kcal by now.
// Eat." (Wed 11/4), 18 minutes before his 8:10 AM first meal time, right after the 7:40 AM "Start cooking". No food pace
// nudge before his first meal time has come.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { mealReminders } from '../app/js/lib/fuel-reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-01-21';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const targets = { kcal: 3174, protein: 242.5 };
const legsDay = { today: { kind: 'train', dayType: 'legs' } };
const food = (c) => c.filter((x) => x.key.startsWith('food:'));
const cands = (now, reminders, more = {}) => nudgeCandidates({ now, tz: TZ, reminders, rot: legsDay, wakeHm: '05:00', bedHm: '19:00', targets, sleepLogged: true, ...more });

test('his Wednesday: no "you should be near X kcal" before his 8:10 AM first meal time', () => {
  const mealTimes = [{ name: 'First meal', time: '08:10', latest: '09:40', cookMin: 30 }, { name: 'Last meal', time: '12:10', latest: '12:40', cookMin: 30 }];
  const reminders = mealReminders({ date: D, tz: TZ, meals: [], mealTimes });
  for (const hm of ['07:00', '07:39', '07:41', '07:52', '08:09']) assert.deepEqual(food(cands(at(hm), reminders)), [], hm);
  // Even with a snack in: still before his first meal time.
  assert.deepEqual(food(cands(at('07:52'), reminders, { eaten: { kcal: 100, protein: 5 } })), []);
});

test('once his meal times have come and he answered them, the pace nudge speaks as before', () => {
  const mealTimes = [{ name: 'First meal', time: '08:10', latest: '09:40', cookMin: 30 }, { name: 'Last meal', time: '12:10', latest: '12:40', cookMin: 30 }];
  // Skipped the first meal: its questions stop; his 12:10 PM meal time is still ahead, so no pace nudge before it
  // (Fri 11/6: not between meals either).
  const skipped = [{ id: `${D}.0810`, answer: 'skipped', at: at('08:15') }];
  assert.deepEqual(food(cands(at('09:00'), mealReminders({ date: D, tz: TZ, meals: [], mealTimes, checks: skipped }))), []);
  // Both skipped, no meal time left today: behind speaks.
  const both = [...skipped, { id: `${D}.1210`, answer: 'skipped', at: at('12:15') }];
  const after = food(cands(at('13:00'), mealReminders({ date: D, tz: TZ, meals: [], mealTimes, checks: both })));
  assert.equal(after.length, 1);
  assert.match(after[0].text, /^Food: 0 of 3,174 kcal/);
});

test('a first meal with no latest time: quiet until its ask, 45 minutes after the meal time', () => {
  const mealTimes = [{ name: 'First meal', time: '08:00' }, { name: 'Last meal', time: '13:00' }];
  const reminders = mealReminders({ date: D, tz: TZ, meals: [], mealTimes });
  for (const hm of ['07:30', '08:00', '08:44']) assert.deepEqual(food(cands(at(hm), reminders)), [], hm);
});

test('no meal times set: the pace nudge is as before', () => {
  assert.equal(food(cands(at('09:00'), [])).length, 1);
});

test('past midnight, still yesterday\'s waking day: tomorrow\'s meal times don\'t silence it', () => {
  const mealTimes = [{ name: 'First meal', time: '11:00', latest: '12:00', cookMin: 30 }, { name: 'Last meal', time: '20:00', latest: '21:00', cookMin: 30 }];
  // Bed at 3:00 AM, up at 10:00 AM; at 12:30 AM the reminders list already holds the new date's 11:00 AM first meal.
  const reminders = mealReminders({ date: D, tz: TZ, meals: [], mealTimes, checks: [] });
  const c = nudgeCandidates({ now: at('00:30'), tz: TZ, reminders: reminders.filter((r) => !String(r.id).startsWith('meal:') || r.at > at('00:30')), rot: legsDay, wakeHm: '10:00', bedHm: '03:00', targets, sleepLogged: true });
  // Not silenced by the gate (the eating day ended 2 hours before bed, so the pace may or may not speak; the gate isn't why).
  const gated = nudgeCandidates({ now: at('20:00', '2026-01-20'), tz: TZ, reminders: [], rot: legsDay, wakeHm: '10:00', bedHm: '03:00', targets, sleepLogged: true });
  assert.equal(food(gated).length, 1, 'control: behind in the evening speaks');
  assert.equal(food(c).length, 1, 'after midnight, tomorrow\'s first meal ahead does not silence today\'s pace');
});
