import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awakeAt, dayFraction, coachVoice, coachReminder, nudgeCandidates, nudgeDue, pickNudge, QUIET_AFTER_MIN,
} from '../app/js/lib/nudges.js';
import { withSleepLog, currentBodyweight } from '../app/js/lib/health.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const D = '2026-01-20';
const legsDay = { today: { kind: 'train', dayType: 'legs' } };
const fixed = () => 0; // pickLine's first choice
const keys = (c) => c.map((x) => x.key);

test('waking hours and how far through his eating day it is', () => {
  assert.equal(awakeAt(at(D, '04:39'), TZ, '04:40', '18:00'), false);
  assert.equal(awakeAt(at(D, '04:40'), TZ, '04:40', '18:00'), true);
  assert.equal(awakeAt(at(D, '18:00'), TZ, '04:40', '18:00'), false);
  assert.equal(awakeAt(at(D, '01:00'), TZ, '07:00', '02:00'), true, 'a bedtime after midnight');
  assert.equal(dayFraction(at(D, '04:40'), TZ, '04:40', '18:00'), 0);
  assert.equal(dayFraction(at(D, '16:00'), TZ, '04:40', '18:00'), 1, 'eating day ends 2 hours before bed');
  assert.ok(Math.abs(dayFraction(at(D, '10:20'), TZ, '04:40', '18:00') - 0.5) < 0.01);
});

test('every notification is the coach\'s: facts first, one line in his moods; calm kinds plain', () => {
  const v = coachVoice('Supplements: 3 still open.', { rng: fixed });
  assert.equal(v.title, 'Coach');
  assert.equal(v.body, 'Supplements: 3 still open. Get it done.');
  const bank = { moods: { hype: { nudge: [[3, 'Come on, move!']] } } };
  assert.equal(coachVoice('Eat.', { bank, rng: fixed, intensity: 3 }).body, 'Eat. Come on, move!');
  assert.equal(coachVoice('Eat.', { bank, rng: fixed, intensity: 2 }).body, 'Eat. Get it done.', 'nothing above his intensity');
  assert.equal(coachReminder({ kind: 'session', title: 'Legs at 4:30 AM', body: 'Week 3 column.' }, { rng: fixed }).body, 'Legs at 4:30 AM. Week 3 column. Get it done.');
  assert.equal(coachReminder({ kind: 'readiness', title: 'Sore, or good to go?', body: 'Check in.' }, { rng: fixed }).body, 'Sore, or good to go? Check in. Get it done.');
  assert.equal(coachReminder({ kind: 'sauna', title: 'Sauna: time is up', body: 'Get out now.' }, { rng: fixed }).body, 'Sauna: time is up. Get out now.', 'sauna stays calm');
});

test('nudges: the morning sleep question, the session and the Evolt, food behind pace, fresh steps only', () => {
  const base = { tz: TZ, wakeHm: '04:40', bedHm: '18:00', rot: legsDay, targets: { kcal: 3174, protein: 242.5 }, eaten: { kcal: 0, protein: 0 } };
  // 5:30 AM, no sleep logged, no session time: sleep first, then the session with the Evolt.
  let c = nudgeCandidates({ ...base, now: at(D, '05:30'), sleepLogged: false });
  assert.deepEqual(keys(c), ['sleep', 'session']);
  assert.match(c[0].text, /your schedule: 6:00 PM to 4:40 AM/);
  assert.match(c[1].text, /^Legs today and no time set\. When are you going\? Evolt first/);
  // Session time 6:00 AM: an hour before it says the time; after it, that it's waiting.
  c = nudgeCandidates({ ...base, now: at(D, '05:15'), sessionHm: '06:00' });
  assert.match(c.find((x) => x.key === 'session').text, /^Legs at 6:00 AM\. Evolt first when you get there/);
  c = nudgeCandidates({ ...base, now: at(D, '06:40'), sessionHm: '06:00' });
  assert.match(c.find((x) => x.key === 'session').text, /^Legs was due at 6:00 AM\. Go now, or tell me the new time/);
  // Trained (the rotation now says done): the Evolt number.
  assert.deepEqual(keys(nudgeCandidates({ ...base, rot: { today: { kind: 'done', dayType: 'pull' } }, now: at(D, '13:00'), session: { started: true, done: true }, eaten: { kcal: 2500, protein: 200 } })), ['evolt']);
  // Trained, no weigh-in: the Evolt number.
  c = nudgeCandidates({ ...base, now: at(D, '08:00'), session: { started: true, done: true }, eaten: { kcal: 900, protein: 80 } });
  assert.deepEqual(keys(c), ['evolt']);
  assert.equal(nudgeCandidates({ ...base, now: at(D, '08:00'), session: { started: true, done: true }, weighedToday: true, eaten: { kcal: 900, protein: 80 } }).length, 0);
  // Food: 2:00 PM with 900 kcal is far behind (near 2,600 expected).
  c = nudgeCandidates({ ...base, now: at(D, '14:00'), session: { done: true }, weighedToday: true, eaten: { kcal: 900, protein: 70 } });
  assert.deepEqual(keys(c), ['food']);
  assert.equal(c[0].text, 'Food: 900 of 3,174 kcal and 70 of 242.5 g protein at 2:00 PM. You should be near 2,600 kcal by now. Eat.');
  // Rest day: no session or Evolt nudges.
  assert.deepEqual(keys(nudgeCandidates({ ...base, now: at(D, '09:00'), rot: { today: { kind: 'rest' } }, eaten: { kcal: 1000, protein: 80 } })), []);
  // Steps: only when Apple Health's numbers are under 3 hours old.
  const steps = { steps: 1200, asOf: at(D, '12:00') };
  const s1 = nudgeCandidates({ ...base, rot: null, now: at(D, '13:00'), stepGoal: 8000, steps, eaten: { kcal: 2500, protein: 200 } });
  assert.deepEqual(keys(s1), ['steps']);
  assert.equal(s1[0].text, 'Steps: 1,200 by 12:00 PM, goal 8,000. Walk 15 minutes.');
  assert.equal(nudgeCandidates({ ...base, rot: null, now: at(D, '16:00'), stepGoal: 8000, steps, eaten: { kcal: 3000, protein: 230 } }).length, 0);
});

test('nudges: a body scan planned today comes first, with the on-the-day checklist', () => {
  const c = nudgeCandidates({ tz: TZ, now: at(D, '09:30'), rot: { today: { kind: 'train', dayType: 'push' } }, wakeHm: '09:00', bedHm: '00:00',
    scanToday: { items: ['Nothing eaten before the scan', 'Bathroom first', 'Barefoot'] } });
  assert.equal(c[0].key, 'scan');
  assert.equal(c[0].text, 'Body scan today, before you train: Nothing eaten before the scan; Bathroom first; Barefoot. Then tell me the numbers.');
});

test('nudges: supplements with no time set, once the morning is over', () => {
  const suppsUntimed = { total: 8, open: ['Vitamin C', 'D3 + K2', 'Omega-3', 'Creatine', 'Magnesium', 'Carnitine'] };
  const base = { tz: TZ, rot: null, wakeHm: '04:40', bedHm: '18:00', eaten: { kcal: 3000, protein: 230 }, targets: { kcal: 3174, protein: 242.5 } };
  assert.equal(nudgeCandidates({ ...base, now: at(D, '06:00'), suppsUntimed }).length, 0);
  const c = nudgeCandidates({ ...base, now: at(D, '09:00'), suppsUntimed });
  assert.deepEqual(keys(c), ['supps-untimed']);
  assert.equal(c[0].text, 'Supplements: 2 of 8 taken today. Still open: Vitamin C, D3 + K2, Omega-3, Creatine and 2 more. Take them and tell me.');
  assert.equal(nudgeCandidates({ ...base, now: at(D, '09:00'), suppsUntimed: { total: 8, open: [] } }).length, 0);
});

test('nudges: planned reminders that went out and are still open come back; done or future ones do not', () => {
  const reminders = [
    { id: 'supps-a', kind: 'supps', tag: 'supps-morning', at: at(D, '07:00'), due: true, title: 'Morning supplements', body: 'Vitamin C, D3 + K2.', url: '#/supps' },
    { id: 'holds-m', kind: 'holds', tag: 'holds-morning', at: at(D, '07:30'), due: false, title: 'Morning holds', body: '' },
    { id: 'rec', kind: 'recovery', tag: 'recovery-checkin', at: at(D, '20:15'), due: true, title: 'Recovery', body: 'Weekly check-in.' },
  ];
  const c = nudgeCandidates({ tz: TZ, now: at(D, '09:00'), reminders, rot: null, wakeHm: '04:40', bedHm: '18:00' });
  assert.deepEqual(keys(c), ['supps:supps-morning']);
  assert.equal(c[0].text, 'Morning supplements. Vitamin C, D3 + K2.');
  assert.equal(c[0].url, '#/supps');
});

test('when to nudge: his interval, waking hours, quiet during a session, after a notification or while talking', () => {
  const now = at(D, '10:00');
  const ok = { now, everyMin: 20, awake: true, lastNudgeAt: now - 21 * 60000, lastNoticeAt: 0, lastUserAt: 0, busy: false };
  assert.equal(nudgeDue(ok), true);
  assert.equal(nudgeDue({ ...ok, lastNudgeAt: now - 19 * 60000 }), false);
  assert.equal(nudgeDue({ ...ok, everyMin: 0 }), false, 'off');
  assert.equal(nudgeDue({ ...ok, awake: false }), false);
  assert.equal(nudgeDue({ ...ok, busy: true }), false, 'a session or sauna is running');
  assert.equal(nudgeDue({ ...ok, lastNoticeAt: now - (QUIET_AFTER_MIN - 1) * 60000 }), false);
  assert.equal(nudgeDue({ ...ok, lastUserAt: now - 5 * 60000 }), false);
  assert.equal(nudgeDue({ ...ok, pausedUntil: now + 60000 }), false, 'he said stop for a while');
  assert.equal(nudgeDue({ ...ok, pausedUntil: now - 1 }), true);
  // The same thing waits for its own gap; the next most important goes instead.
  const cands = [{ key: 'session', priority: 80, gapMin: 30 }, { key: 'food', priority: 55, gapMin: 60 }];
  assert.equal(pickNudge(cands, { session: now - 20 * 60000 }, now).key, 'food');
  assert.equal(pickNudge(cands, { session: now - 31 * 60000 }, now).key, 'session');
  assert.equal(pickNudge(cands, { session: now - 1, food: now - 1 }, now), null);
});

test('the Mac sends a nudge from the coach, writes it into Talk, and keeps quiet when it should', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const { nudgeTick } = await import('../server/notify.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-nudge-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { nudgeEveryMin: 20, wakeHm: '04:40', bedHm: '18:00' } });
    store.writeLocal('fuel', 'plan', { kcal: 3174, proteinG: 242.5 });
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
    let r = await nudgeTick({ store, push, now: at(D, '14:00'), tz: TZ });
    assert.ok(r, 'something is open');
    assert.equal(sent[0].title, 'Coach');
    const talk = store.listRecords('coach-messages').map((x) => x.data);
    assert.equal(talk.length, 1);
    assert.equal(talk[0].role, 'assistant');
    assert.equal(talk[0].kind, 'nudge');
    assert.equal(talk[0].text, sent[0].body);
    // 10 minutes later: not yet. After he writes to the coach: quiet for 10 minutes.
    assert.equal(await nudgeTick({ store, push, now: at(D, '14:10'), tz: TZ }), null);
    store.writeLocal('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'eating now', at: at(D, '14:25') });
    assert.equal(await nudgeTick({ store, push, now: at(D, '14:30'), tz: TZ }), null);
    // After bedtime: nothing.
    assert.equal(await nudgeTick({ store, push, now: at(D, '19:00'), tz: TZ }), null);
    // A session running: nothing.
    store.writeLocal('sessions', 's1', { id: 's1', status: 'active', startedAt: at(D, '15:00') });
    assert.equal(await nudgeTick({ store, push, now: at(D, '15:30'), tz: TZ }), null);
    r = null;
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sleep he told the coach fills nights Apple Health has none for; Evolt weigh-ins set his bodyweight', () => {
  const docs = [{ date: '2026-01-19', steps: 5000 }, { date: '2026-01-20', sleep: { asleepMin: 400 } }];
  const logs = [{ date: '2026-01-19', bed: 1, wake: 2, inBedMin: 600, asleepMin: 580 }, { date: '2026-01-20', inBedMin: 300 }, { date: '2026-01-21', inBedMin: 610, asleepMin: 610 }];
  const out = withSleepLog(docs, logs);
  assert.deepEqual(out.map((d) => [d.date, d.sleep?.asleepMin ?? null, d.sleep?.told ?? false, d.steps ?? null]),
    [['2026-01-19', 580, true, 5000], ['2026-01-20', 400, false, null], ['2026-01-21', 610, true, null]]);
  const now = at(D, '12:00');
  const healthDocs = [{ date: '2026-01-10', weights: [{ at: at('2026-01-10', '07:00'), kg: 79 }] }];
  const measurements = [{ date: D, at: at(D, '05:10'), weightKg: 80.4, source: 'evolt' }];
  assert.deepEqual(currentBodyweight({ healthDocs, measurements, now }), { kg: 80.4, at: at(D, '05:10'), from: 'evolt' });
  assert.equal(currentBodyweight({ healthDocs, now }).kg, 79);
});

test('his morning (Tue 10/20): the routine once after he wakes, the gym window from when he actually woke', () => {
  const base = { tz: TZ, rot: { today: { kind: 'train', dayType: 'push' } }, wakeHm: '10:00', bedHm: '00:00', sleepLogged: true,
    morning: { text: 'Banana, bathroom, stretch, sunlight', gymAfterMin: [60, 90] } };
  // Woke at 9:40 (his sleep log): routine nudge, gym 10:40 to 11:10.
  let c = nudgeCandidates({ ...base, now: at(D, '09:50'), wokeAt: at(D, '09:40') });
  const m = c.find((x) => x.key === 'morning');
  assert.equal(m.text, 'Morning: Banana, bathroom, stretch, sunlight. Gym 10:40 AM to 11:10 AM.');
  assert.equal(m.gapMin, 18 * 60, 'once a day');
  assert.match(c.find((x) => x.key === 'session').text, /no time set\. When are you going\? Your plan: 10:40 AM to 11:10 AM\. Evolt first/);
  // No sleep log yet: from his usual wake time.
  c = nudgeCandidates({ ...base, now: at(D, '10:20') });
  assert.match(c.find((x) => x.key === 'morning').text, /Gym 11:00 AM to 11:30 AM\.$/);
  // Two hours after waking: no routine nudge; a rest day: no gym in it.
  assert.equal(nudgeCandidates({ ...base, now: at(D, '12:00') }).some((x) => x.key === 'morning'), false);
  assert.equal(nudgeCandidates({ ...base, rot: { today: { kind: 'rest' } }, now: at(D, '10:10') }).find((x) => x.key === 'morning').text, 'Morning: Banana, bathroom, stretch, sunlight.');
  // Without a routine set: nothing new.
  assert.equal(nudgeCandidates({ ...base, morning: null, now: at(D, '10:10') }).some((x) => x.key === 'morning'), false);
});

test('after the workout (Tue 10/20): 20 minutes of quiet, then the first meal before anything else', () => {
  const base = { tz: TZ, rot: { today: { kind: 'done', dayType: 'push' } }, wakeHm: '10:00', bedHm: '00:00', session: { started: true, done: true },
    targets: { kcal: 3000, protein: 240 }, eaten: { kcal: 105, protein: 1 }, suppsUntimed: { total: 8, open: ['Creatine'] }, workoutEndedAt: at(D, '12:30') };
  assert.deepEqual(nudgeCandidates({ ...base, now: at(D, '12:45') }), [], 'shower time');
  const c = nudgeCandidates({ ...base, now: at(D, '12:51') });
  assert.equal(c[0].key, 'meal-after');
  assert.equal(c[0].text, 'Workout done at 12:30 PM. Time for your first meal: 1 of 240 g protein so far today. Tell me what you eat.');
  const later = nudgeCandidates({ ...base, now: at(D, '13:40') });
  assert.ok(later.findIndex((x) => x.key === 'supps-untimed') > later.findIndex((x) => x.key === 'meal-after'), 'supplements after the meal');
  assert.equal(nudgeCandidates({ ...base, now: at(D, '13:10'), lastMealAt: at(D, '13:00') }).some((x) => x.key === 'meal-after'), false, 'ate: done');
});

test('the dishes (Tue 10/20): 2 minutes after a meal is logged, or after its after photo; once; never for old meals', async () => {
  const { dishesDue, DISHES_TEXT } = await import('../app/js/lib/nudges.js');
  const now = at(D, '13:00');
  const seen = { a: now - 60000, b: now - 3 * 60000, c: now - 10 * 60000, d: now - 30 * 60000, e: now - 3 * 60000 };
  const meals = [
    { id: 'a', at: now - 60000, source: 'manual' },                                   // logged 1 min ago: not yet
    { id: 'b', at: now - 20 * 60000, source: 'manual' },                              // logged 3 min ago: due
    { id: 'c', at: now - 10 * 60000, source: 'photo', before: { photoId: 'p' } },     // photo before eating, 10 min: eating
    { id: 'd', at: now - 30 * 60000, source: 'photo', before: { photoId: 'p' } },     // 30 min, no after photo: due
    { id: 'e', at: now - 5 * 3600000, source: 'manual' },                             // added now for 5 hours ago: never
  ];
  assert.deepEqual(dishesDue({ meals, seen, sent: {}, now }).map((m) => m.id), ['d', 'b']);
  assert.deepEqual(dishesDue({ meals, seen, sent: { b: now, d: now }, now }).map((m) => m.id), [], 'once each');
  // An after photo: 2 minutes after it.
  const c2 = { ...meals[2], after: { at: now - 60000 } };
  assert.deepEqual(dishesDue({ meals: [c2], seen, sent: {}, now }).map((m) => m.id), []);
  assert.deepEqual(dishesDue({ meals: [c2], seen, sent: {}, now: now + 70000 }).map((m) => m.id), ['c']);
  assert.match(DISHES_TEXT, /dishes won't clean themselves\. Get up now, walk around for a minute or two/);
});
