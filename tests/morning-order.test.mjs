// Fri 10/23, his words: "you should have asked me if I'm awake... Since I haven't messaged you... you shouldn't keep on
// messaging me... my sore back from yesterday's workout... you should have started with that. That's way more important
// than morning hold or the body scan, which you said twice." His morning, as it went: holds at 10:01 AM, the scan
// checklist at 10:19, 10:51, 11:39 AM and 12:10 PM, the walk at 11:08 AM, "How did you sleep?" at 11:18 AM, nothing
// about his back. Now: are you up, then sleep, then his back, then the plan; one question at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { morningStep, morningBodyText, lastWorkoutPain, nudgeCandidates, pickNudge, MORNING_UP_TEXT } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate, morningContext } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-20';
const Y = '2026-03-19';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);

const legsWithBackPain = {
  id: 'legs1', dayType: 'legs', status: 'done', startedAt: at(Y, '10:00'), endedAt: at(Y, '11:35'),
  exercises: [
    { key: 'sq', name: 'Squat (Smith Machine)', notes: 'Lower back pain during set and after too just staying there hurts when bending' },
    { key: 'ht', name: 'Hip Thrust (Machine)', skipped: { at: at(Y, '11:28'), reason: 'Lower back pain from squats' } },
    { key: 'lc', name: 'Seated Leg Curl (Machine)' },
  ],
};

test('pain from his last workout comes first in the body question', () => {
  const pain = lastWorkoutPain({ sessions: [legsWithBackPain], sets: [], today: D, tz: TZ });
  assert.deepEqual(pain, { label: 'Legs', date: Y, parts: ['lower back'], exercise: 'Squat (Smith Machine)' });
  assert.equal(morningBodyText(pain, D, TZ), "How's your lower back today? It hurt on squat yesterday (Legs). 0 to 3, and does it still hurt when you bend or move?");
  // A pain score on a set counts too; an older workout says its day.
  const knee = { id: 'p', dayType: 'push', status: 'done', startedAt: at('2026-03-18', '10:00'), exercises: [{ key: 'b', name: 'Bench Press' }] };
  const p2 = lastWorkoutPain({ sessions: [knee], sets: [{ sessionId: 'p', exKey: 'b', done: true, pain: 4 }], today: D, tz: TZ });
  assert.equal(p2.exercise, 'Bench Press');
  assert.match(morningBodyText(p2, D, TZ), /^How's your body today\? It hurt on bench press on Wednesday 3\/18 \(Push\)\./);
  // No pain, or nothing in the last 2 days: the plain question.
  assert.equal(lastWorkoutPain({ sessions: [{ ...legsWithBackPain, exercises: [{ key: 'x', name: 'Squat' }] }], sets: [], today: D, tz: TZ }), null);
  assert.equal(lastWorkoutPain({ sessions: [{ ...legsWithBackPain, startedAt: at('2026-03-16', '10:00') }], sets: [], today: D, tz: TZ }), null);
  assert.equal(morningBodyText(null, D, TZ), 'How does your body feel today? Knees, legs, back: 0 to 3.');
});

test('the morning steps: up, then sleep, then body; one at a time; never a silent day', () => {
  const wakeAt = T('10:00');
  const step = (o) => morningStep({ wakeAt, bodyText: 'BODY?', ...o });
  // Before his wake time: nothing (the wake-time rules hold things already).
  assert.deepEqual(step({ now: T('09:30') }), { hold: false, open: false, ask: null });
  // No sign he's up: "Are you up?" once, then quiet, and the day waits.
  assert.deepEqual(step({ now: T('10:00') }).ask, { key: 'up', text: MORNING_UP_TEXT });
  assert.deepEqual(step({ now: T('11:00'), state: { up: T('10:00') } }), { hold: true, open: false, ask: null });
  // Still nothing 4 hours after his wake time: the day goes on.
  assert.deepEqual(step({ now: T('14:00'), state: { up: T('10:00') } }), { hold: false, open: true, ask: null });
  // He writes at 11:40 AM: 3 minutes later, sleep.
  const up = { upAt: T('11:40'), lastUserAt: T('11:40'), state: { up: T('10:00') } };
  assert.equal(step({ ...up, now: T('11:41') }).ask, null, 'not on top of his message');
  assert.equal(step({ ...up, now: T('11:43') }).ask.key, 'sleep');
  // Asked; he hasn't answered: nothing else for 30 minutes.
  const asked = { ...up, state: { ...up.state, sleep: T('11:43') }, lastCoachAt: T('11:43') };
  assert.deepEqual(step({ ...asked, now: T('12:00') }), { hold: true, open: false, ask: null });
  // He answers: the body question next, then the day opens once he answers that.
  const slept = { ...asked, lastUserAt: T('11:45'), sleepKnown: true };
  assert.deepEqual(step({ ...slept, now: T('11:48') }).ask, { key: 'body', text: 'BODY?' });
  const body = { ...slept, state: { ...slept.state, body: T('11:48') }, lastCoachAt: T('11:48') };
  assert.equal(step({ ...body, now: T('11:55') }).hold, true);
  assert.equal(step({ ...body, now: T('11:53'), lastUserAt: T('11:52') }).hold, true, 'not on top of his answer');
  assert.deepEqual(step({ ...body, now: T('11:55'), lastUserAt: T('11:52') }), { hold: false, open: true, ask: null });
  // The coach asked it itself in its reply: not asked again.
  assert.equal(step({ ...up, now: T('11:50'), coachAsked: { sleep: T('11:41') }, lastCoachAt: T('11:41') }).ask, null);
  // Up before his wake time with sleep and check-in known: nothing to ask, nothing held.
  assert.deepEqual(step({ now: T('09:30'), upAt: T('09:00'), sleepKnown: true, bodyKnown: true }), { hold: false, open: true, ask: null });
});

test('the scan checklist and the sleep question are said once a day, the scan after the sleep question', () => {
  const o = { tz: TZ, rot: { today: { kind: 'train', dayType: 'pull' } }, wakeHm: '10:00', bedHm: '00:00', sleepLogged: false, scanToday: { items: ['Barefoot'] } };
  const c = nudgeCandidates({ ...o, now: T('10:20') });
  assert.deepEqual(c.slice(0, 2).map((x) => x.key), ['sleep', 'scan']);
  const sent = { sleep: T('10:20'), scan: T('10:50') };
  for (const hm of ['11:20', '11:50', '12:20', '15:00', '20:00']) assert.equal(pickNudge(nudgeCandidates({ ...o, now: T(hm), sleepLogged: true }), sent, T(hm))?.key === 'scan', false, hm);
});

/** His Friday: settings, yesterday's Legs with back pain, knee holds at 9:30 AM, first meal 12:30 PM (cook 30 min). */
function friday() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-morning-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 30, holdsMorning: '09:30', holdsEvening: '21:30', kinds: { walk: false } },
    fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }] },
  });
  store.writeLocal('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', where: 'home' }], loadsArea: { exercises: [] } });
  store.writeLocal('sessions', 'legs1', legsWithBackPain);
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  let now = T('09:00');
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  const say = (hm, text) => { const t = T(hm); store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t }); };
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, say, done, set: (t) => { now = t; } };
}
const hmOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

test('his Friday replayed: "Are you up?" alone until he answers, then sleep, then his back, then the plan', async () => {
  const f = friday();
  try {
    // 9:00 AM to 11:39 AM, no word from him: one message, at his wake time.
    await f.run('09:00', '11:39');
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['10:00 AM', 'Morning. Are you up?']]);
    assert.equal(morningGate(f.store, T('11:39'), TZ).hold, true);
    assert.match(morningContext(f.store, T('11:39'), TZ), /one question at a time.*lower back.*"Are you up\?" at 10:00 AM/);
    // He answers at 11:40 AM. 3 minutes later the sleep question, nothing else.
    f.say('11:40', 'yeah I am up');
    await f.run('11:40', '11:44');
    assert.deepEqual(f.sent.slice(1).map((m) => [hmOf(m.at), m.body]), [['11:43 AM', 'How did you sleep? When did you go to bed and when did you wake up?']]);
    // His sleep at 11:45 AM (the coach logs it): his back next, naming yesterday's pain.
    f.say('11:45', 'bed at 1, up at 11:30');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '23:59') + 3660000, wake: T('11:30'), source: 'coach', at: T('11:46') });
    await f.run('11:45', '11:51');
    assert.equal(f.sent.length, 3);
    assert.equal(hmOf(f.sent[2].at), '11:48 AM');
    assert.match(f.sent[2].body, /^How's your lower back today\? It hurt on squat yesterday \(Legs\)\./);
    // He answers at 11:52 AM: 3 minutes later the morning holds that waited since 10:00 AM (once), then cooking at 12:00 PM.
    f.say('11:52', 'back is a 2, still hurts bending');
    await f.run('11:52', '12:05');
    const after = f.sent.slice(3);
    assert.ok(after.length >= 2, after.map((m) => m.body).join(' | '));
    assert.equal(hmOf(after[0].at), '11:55 AM');
    assert.match(after[0].body, /^Morning holds\. Knees: Toes Wall Squat Hold/);
    assert.ok(after.some((m) => hmOf(m.at) === '12:00 PM' && /^Start cooking/.test(m.body)));
    assert.equal(f.sent.filter((m) => /Morning holds/.test(m.body)).length, 1, 'holds said once');
    assert.equal(f.sent.filter((m) => /Are you up|How did you sleep/.test(m.body)).length, 2, 'each morning question once');
  } finally { f.done(); }
});

test('the coach asks the next morning question in its reply: the app does not ask it again', async () => {
  const f = friday();
  try {
    await f.run('09:58', '10:01');
    f.say('10:20', 'up');
    f.store.writeLocal('coach-messages', 'c1', { id: 'c1', role: 'assistant', text: 'Good. How did you sleep, and when did you get up?', at: T('10:20') + 5000 });
    await f.run('10:20', '10:40');
    assert.equal(f.sent.filter((m) => /How did you sleep/.test(m.body)).length, 0);
    assert.equal(morningGate(f.store, T('10:40'), TZ).hold, true, 'waiting for his answer');
    // He never answers it: 30 minutes after the coach asked (10:20:05 AM), his back.
    await f.run('10:41', '10:52');
    assert.ok(f.sent.some((m) => hmOf(m.at) === '10:51 AM' && /lower back/.test(m.body)));
  } finally { f.done(); }
});

test('up and talking before his wake time, sleep and check-in known: no morning questions, nothing held', async () => {
  const f = friday();
  try {
    f.say('08:30', 'morning');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, wake: T('08:20'), source: 'coach', at: T('08:31') });
    f.store.writeLocal('days', D, { date: D, readiness: { at: T('08:35') } });
    await f.run('08:40', '10:05');
    assert.equal(f.sent.some((m) => /Are you up|How did you sleep|lower back/.test(m.body)), false);
    assert.equal(morningGate(f.store, T('10:05'), TZ).hold, false);
  } finally { f.done(); }
});

test('no answer at all: the day goes on 4 hours after his wake time, what waited in one message', async () => {
  const f = friday();
  try {
    await f.run('09:58', '14:01');
    const bodies = f.sent.map((m) => [hmOf(m.at), m.body.slice(0, 40)]);
    assert.equal(bodies[0][1], 'Morning. Are you up?');
    assert.ok(f.sent.slice(1).every((m) => m.at >= T('14:00')), JSON.stringify(bodies));
    const plan = f.sent.find((m) => m.tag === 'morning-plan');
    assert.ok(plan, JSON.stringify(bodies));
    assert.match(plan.body, /^Your plan now: Morning holds\..* Then: Start cooking/);
  } finally { f.done(); }
});
