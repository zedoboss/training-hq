// Tue 11/10, his words: "Getting the start cooking message immediately after [Upper A]... it doesn't make sense. I'm
// literally about to go to the gym". At 12:30 PM, the same second: "Upper A at 12:30 PM... Come on, let's go!" and
// "Start cooking: last meal at 1:00 PM". He wants: with a session set for that time or running, no cooking or meal-time
// prompts until the workout is done and his shower after it (about 20 minutes), then one ask about the next meal; never
// two messages for opposite things at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mealReminders } from '../app/js/lib/fuel-reminders.js';
import { dueNow } from '../app/js/lib/reminders.js';
import { nudgeCandidates, heldPlanText } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { startNotifier, gymSpans, afterGymHold, GYM_HOLD } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const Y = '2026-03-16';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const mealTimes = [{ name: 'First meal', time: '09:30', latest: '10:30', cookMin: 15 }, { name: 'Last meal', time: '13:00', latest: '14:00', cookMin: 30 }];
const breakfast = { id: 'b', date: D, at: at('09:56'), name: 'Breakfast' };
const st = { activity: {}, areas: [], rounds: {}, scans: [], scanPlan: null, photoScanIds: [], holdoffs: [] };
const session = (hm, due = true) => ({ id: `session:${D}`, kind: 'session', at: at(hm), due, fixed: true, tag: `session-${D}` });
const items = (o = {}) => [...(o.session === null ? [] : [o.session || session('12:30')]), ...mealReminders({ date: D, tz: TZ, meals: o.meals || [breakfast], mealTimes })];
const workout = (from, to) => ({ id: 'w', kind: 'workout', status: to ? 'done' : 'active', startedAt: at(from), ...(to ? { endedAt: at(to) } : {}) });
// What goes out at `now` about food (the planner's view).
const food = (now, o = {}) => {
  const list = items(o);
  return dueNow(afterGymHold(list, gymSpans(list, o.sessions || [], st, now, TZ), now), now).filter((i) => /^meal/.test(i.id));
};

test('his 12:30 PM: session at 12:30 PM, not started: no "start cooking", nothing about food', () => {
  assert.deepEqual(dueNow(items({ session: null }), at('12:30')).map((i) => i.id), [`meal-cook:${D}:1300`], 'without a session: start cooking at 12:30 PM');
  for (const hm of ['12:00', '12:29', '12:30', '12:31', '12:45', '13:00', '13:20', '13:59']) assert.deepEqual(food(at(hm)).map((i) => i.id), [], hm);
});

test('then the workout: started 12:40 PM, nothing while it runs; done 1:40 PM, one meal ask at 2:00 PM after his shower', () => {
  for (const hm of ['12:40', '13:00', '13:30']) assert.deepEqual(food(at(hm), { sessions: [workout('12:40')] }), [], hm);
  const done = { sessions: [workout('12:40', '13:40')] };
  for (const hm of ['13:40', '13:45', '13:59']) assert.deepEqual(food(at(hm), done), [], hm);
  const out = food(at('14:00'), done);
  assert.deepEqual(out.map((i) => i.id), [`meal:${D}:1300`], 'the meal ask alone, not start cooking too');
  assert.equal(out[0].gym, 'after');
  // Said as what to do now, no passed times.
  assert.equal(heldPlanText(out, { now: at('14:00'), tz: TZ }), "Eat your last meal now, or tell me you're skipping it.");
  // Its check-ins come after it, none in the gym time; nothing more at 2:01 PM once it's sent.
  const sent = { [out[0].id]: at('14:00') };
  assert.deepEqual(food(at('14:05'), done).filter((i) => !sent[i.id]), []);
  const list = items();
  const later = afterGymHold(list, gymSpans(list, done.sessions, st, at('14:30'), TZ), at('14:30')).filter((i) => i.group && i.due).map((i) => hmOf(i.at));
  assert.deepEqual(later, ['3:00 PM'], 'the 1:20 PM check-in fell in the gym time, the 2:00 PM one would sit on the ask: only 3:00 PM stays');
});

test('the cases around it', () => {
  // A session at 5:00 PM: lunch is nowhere near it, start cooking at 12:30 PM as before.
  assert.deepEqual(food(at('12:30'), { session: session('17:00') }).map((i) => i.id), [`meal-cook:${D}:1300`]);
  // The hold starts beforeMin before the session time: a 1:00 PM session holds the 12:30 PM start cooking...
  assert.deepEqual(food(at('12:30'), { session: session('13:00') }), []);
  // ...a 1:15 PM one doesn't (12:30 PM is 45 minutes before it).
  assert.equal(GYM_HOLD.beforeMin, 30);
  assert.deepEqual(food(at('12:30'), { session: session('13:15') }).map((i) => i.id), [`meal-cook:${D}:1300`]);
  // Already trained today at another time (the session reminder is off): nothing held.
  assert.deepEqual(food(at('12:30'), { session: session('12:30', false) }).map((i) => i.id), [`meal-cook:${D}:1300`]);
  // Never started: the hold ends lateMaxMin after the session time, then one ask.
  assert.deepEqual(food(at('13:59')), []);
  assert.deepEqual(food(at('14:00')).map((i) => i.id), [`meal:${D}:1300`]);
  // A workout with no session time set: held from its start, one ask 20 minutes after it.
  const free = { session: null, sessions: [workout('12:10', '13:30')] };
  assert.deepEqual(food(at('12:30'), free), []);
  assert.deepEqual(food(at('13:49'), free), []);
  assert.deepEqual(food(at('13:50'), free).map((i) => i.id), [`meal:${D}:1300`]);
  // He logs the meal: nothing to ask.
  assert.deepEqual(food(at('14:00'), { meals: [breakfast, { id: 'l', date: D, at: at('13:55') }], sessions: [workout('12:40', '13:40')] }), []);
  // Holds, supplements and the session reminder itself keep their time.
  const other = [session('12:30'), { id: `supps:${D}:1230`, kind: 'supps', at: at('12:30'), due: true, tag: 's' }];
  assert.deepEqual(dueNow(afterGymHold(other, gymSpans(other, [], st, at('12:30'), TZ), at('12:30')), at('12:30')).map((i) => i.id), [`session:${D}`, `supps:${D}:1230`]);
});

test('the after-workout meal nudge hands over to the held ask: one message, not two', () => {
  // Start cooking held from 12:30 PM, the meal ask itself later than the release (a 2:30 PM meal): only the held one speaks.
  const list = [session('12:30'), { id: `meal-cook:${D}:1430`, kind: 'cook', at: at('12:30'), due: true, tag: 't', meal: 'Last meal', title: 'Start cooking: last meal at 2:30 PM', body: '' },
    { id: `meal:${D}:1430`, kind: 'meals', at: at('14:30'), due: true, tag: 't' }];
  const sessions = [workout('12:40', '13:40')];
  const now = at('14:00');
  const reminders = afterGymHold(list, gymSpans(list, sessions, st, now, TZ), now);
  assert.equal(reminders.find((i) => i.gym === 'after')?.at, now);
  const base = { tz: TZ, now, wakeHm: '08:00', bedHm: '23:00', sleepLogged: true, workoutEndedAt: at('13:40'), lastMealAt: at('09:56') };
  assert.ok(nudgeCandidates({ ...base, reminders: list }).some((c) => c.key.startsWith('meal-after:')), 'the old way: the nudge too');
  assert.deepEqual(nudgeCandidates({ ...base, reminders }).filter((c) => c.key.startsWith('meal-after:')), []);
});

test('his Tuesday replayed on the notifier: session 12:30 PM, Pull 12:40 to 1:40 PM: one food message, at 2:00 PM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-gym-meals-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { fuel: { mealTimes }, notify: { movingDay: false, wakeHm: '08:00', bedHm: '23:00', kinds: { walk: false, scan: false, holds: false, supps: false, readiness: false } } });
    store.setMeta('morning:state', { date: D, open: at('08:00') });
    store.writeLocal('sessions', 'push', { id: 'push', kind: 'workout', dayType: 'push', status: 'done', startedAt: at('10:00', Y), endedAt: at('11:00', Y), exercises: [] });
    store.writeLocal('meals', 'b', { ...breakfast, before: { items: [{ name: 'Ribs', grams: 200 }] } });
    store.writeLocal('days', D, { date: D, sessionTime: '12:30' });
    let now = at('12:00');
    const sent = [];
    const push = { list: () => [{ deviceId: 'a1b2c3d4e5f6' }], notify: async (m) => { sent.push({ at: now, tag: m.tag || '', body: m.body }); return { sent: 1, failed: 0, dropped: 0 }; } };
    const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
    n.stop();
    for (; now <= at('14:30'); now += 60000) {
      if (now === at('12:20')) store.writeLocal('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'I will go at 12:30', at: now });
      if (now === at('12:40')) store.writeLocal('sessions', 'pull', { id: 'pull', kind: 'workout', dayType: 'pull', status: 'active', startedAt: now, exercises: [] });
      if (now === at('13:40')) store.writeLocal('sessions', 'pull', { id: 'pull', kind: 'workout', dayType: 'pull', status: 'done', startedAt: at('12:40'), endedAt: now, exercises: [] });
      await n.tick();
    }
    const txt = sent.map((m) => `${hmOf(m.at)} [${m.tag}] ${m.body}`).join(' | ');
    if (process.env.SHOW) console.log(txt);
    assert.ok(sent.some((m) => m.tag === `session-${D}` && hmOf(m.at) === '12:30 PM'), `the session reminder at 12:30 PM: ${txt}`);
    const eat = sent.filter((m) => /cook|meal|eat/i.test(m.body) || /^meal-/.test(m.tag));
    assert.deepEqual(eat.map((m) => hmOf(m.at)), ['2:00 PM'], txt);
    assert.match(eat[0].body, /^Eat your last meal now, or tell me you're skipping it\./, 'said as what to do now, no passed times');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
