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
import { morningStep, morningBodyText, lastWorkoutPain, nudgeCandidates, pickNudge, heldPlanText, MORNING_UP_TEXT } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate, morningContext, noteAppOpen, GREET } from '../server/notify.mjs';
import { createApp } from '../server/app.mjs';
import { APP_DIR } from '../server/config.mjs';

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

test('the morning steps: up, then sleep, then body; one at a time; quiet until he is up', () => {
  const wakeAt = T('10:00');
  const step = (o) => morningStep({ wakeAt, bodyText: 'BODY?', ...o });
  // Before his wake time: nothing (the wake-time rules hold things already).
  assert.deepEqual(step({ now: T('09:30') }), { hold: false, open: false, ask: null });
  // No sign he's up: "Are you up?" once, then quiet, and the day waits.
  assert.deepEqual(step({ now: T('10:00') }).ask, { key: 'up', text: MORNING_UP_TEXT });
  assert.deepEqual(step({ now: T('11:00'), state: { up: T('10:00') } }), { hold: true, open: false, ask: null });
  // Sat 10/24: still nothing 4 hours, or all day, after his wake time: still quiet, still waiting for him.
  for (const hm of ['14:00', '18:00', '23:59']) assert.deepEqual(step({ now: T(hm), state: { up: T('10:00') } }), { hold: true, open: false, ask: null }, hm);
  // Up but leaving the questions 4 hours: the day goes on (never stuck once he's there).
  assert.deepEqual(step({ now: T('14:00'), upAt: T('10:05'), lastUserAt: T('10:05'), state: { up: T('10:00'), sleep: T('10:08'), body: T('10:38') } }), { hold: false, open: true, ask: null });
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

// Sat 10/24, his words (his Friday rule again): "Morning. Are you up?" at 10:00 AM, no answer, and from 2:00 PM the
// plan, the walk, the scan checklist and the coach's holds talk went out anyway. Now no answer means quiet until he
// messages or opens the app; then sleep, his back, the plan.
test('no answer to "Are you up?": quiet all day; he opens the app at 2:30 PM, then sleep, his back, the plan', async () => {
  const f = friday();
  try {
    await f.run('09:58', '14:29');
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['10:00 AM', 'Morning. Are you up?']]);
    for (const hm of ['14:00', '14:29']) assert.equal(morningGate(f.store, T(hm), TZ).hold, true, hm);
    // He opens the app at 2:30 PM (its zone report): the sleep question, not the plan.
    f.store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T('14:30') });
    await f.run('14:30', '14:31');
    assert.deepEqual(f.sent.slice(1).map((m) => [hmOf(m.at), m.body]), [['2:30 PM', 'How did you sleep? When did you go to bed and when did you wake up?']]);
    f.say('14:32', 'bed 3:30, up 2:15');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: T('03:30'), wake: T('14:15'), source: 'coach', at: T('14:33') });
    await f.run('14:32', '14:36');
    assert.equal(f.sent.length, 3);
    assert.match(f.sent[2].body, /^How's your lower back today\?/);
    f.say('14:37', 'back is a 1');
    await f.run('14:37', '14:41');
    const plan = f.sent.find((m) => m.tag === 'morning-plan');
    assert.ok(plan && plan.at >= T('14:40'), JSON.stringify(f.sent.map((m) => [hmOf(m.at), m.body.slice(0, 40)])));
    assert.match(plan.body, /^Morning holds now \(Knees: Toes Wall Squat Hold\)\. Then eat your first meal now, or tell me you're skipping it\./);
  } finally { f.done(); }
});

test('no sign of him at all: only "Are you up?" all day, nothing until midnight', async () => {
  const f = friday();
  try {
    await f.run('09:58', '23:59');
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['10:00 AM', 'Morning. Are you up?']]);
  } finally { f.done(); }
});

test('a workout before 5:00 AM counts as up: no "Are you up?", the day goes on', async () => {
  const f = friday();
  try {
    f.store.writeLocal('sessions', 'pull1', { id: 'pull1', dayType: 'pull', status: 'done', startedAt: T('04:00'), endedAt: T('05:20'), exercises: [] });
    await f.run('09:58', '10:05');
    assert.equal(f.sent.some((m) => /Are you up/.test(m.body)), false);
    assert.match(f.sent[0]?.body || '', /How did you sleep/);
    // He never answers it: 30 minutes later the day goes on (his body is known, he trained).
    await f.run('10:06', '10:40');
    assert.equal(morningGate(f.store, T('10:40'), TZ).hold, false);
  } finally { f.done(); }
});

// Sat 10/24, his words: "Auto greet when i open the app Too by the coach speaking pls". He opened the app at 2:23 PM and
// the coach said nothing until he spoke. Now his first open of the day gets "Morning." with the morning's next
// question, in Talk (said out loud there, lib/voice.js), no notification; once a day.
const talkOf = (store) => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant').sort((a, b) => a.at - b.at);
const opens = (f, hm) => { f.store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T(hm) }); noteAppOpen(f.store, T(hm), TZ); };

test('he opens the app at 2:30 PM, no answer to "Are you up?": "Morning." and the sleep question, in Talk, once', async () => {
  const f = friday();
  try {
    await f.run('09:58', '14:29');
    opens(f, '14:30');
    await f.run('14:30', '14:30');
    const greet = talkOf(f.store).at(-1);
    assert.equal(greet.text, 'Morning. How did you sleep? When did you go to bed and when did you wake up?');
    assert.equal(greet.ref, 'morning:greet:sleep');
    assert.equal(hmOf(greet.at), '2:30 PM');
    assert.deepEqual(f.sent.map((m) => m.body), ['Morning. Are you up?'], 'no notification: he is in the app');
    // The sleep question isn't asked again; his answer leads to his back, as before.
    await f.run('14:31', '14:40');
    assert.equal(talkOf(f.store).filter((m) => /How did you sleep/.test(m.text)).length, 1);
    f.say('14:41', 'bed 3:30, up 2:15');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: T('03:30'), wake: T('14:15'), source: 'coach', at: T('14:42') });
    await f.run('14:41', '14:45');
    assert.match(f.sent.at(-1).body, /^How's your lower back today\?/);
    // He opens it again later: no second greeting.
    opens(f, '16:00');
    await f.run('16:00', '16:05');
    assert.equal(talkOf(f.store).filter((m) => /^morning:greet/.test(m.ref || '')).length, 1);
  } finally { f.done(); }
});

test('opening before his wake time: the greeting, and no "Are you up?" later', async () => {
  const f = friday();
  try {
    opens(f, '08:00');
    await f.run('08:00', '10:30');
    assert.equal(talkOf(f.store)[0].text, 'Morning. How did you sleep? When did you go to bed and when did you wake up?');
    assert.equal(talkOf(f.store).some((m) => /Are you up/.test(m.text)), false);
  } finally { f.done(); }
});

test('sleep and his body known already: "Morning." alone, then the day', async () => {
  const f = friday();
  try {
    f.store.writeLocal('sleep-log', D, { id: D, date: D, wake: T('08:20'), source: 'coach', at: T('08:21') });
    f.store.writeLocal('days', D, { date: D, readiness: { at: T('08:22') } });
    opens(f, '08:30');
    await f.run('08:30', '08:31');
    assert.equal(talkOf(f.store)[0].text, GREET.text);
    assert.equal(talkOf(f.store)[0].ref, 'morning:greet');
  } finally { f.done(); }
});

test('no greeting: he wrote first, a workout runs, nudges are off, the Mac saw the open too late, or he hasn\'t slept yet', async () => {
  const greeted = (f) => talkOf(f.store).some((m) => /^morning:greet/.test(m.ref || ''));
  // He wrote before the open was seen: the coach answers him; no greeting on top.
  let f = friday();
  try { f.say('11:00', 'yo'); opens(f, '11:01'); await f.run('11:01', '11:10'); assert.equal(greeted(f), false, 'wrote first'); } finally { f.done(); }
  // Mid-workout.
  f = friday();
  try {
    f.store.writeLocal('sessions', 'pull1', { id: 'pull1', dayType: 'pull', status: 'active', startedAt: T('10:30'), exercises: [] });
    opens(f, '11:00'); await f.run('11:00', '11:20');
    assert.equal(greeted(f), false, 'workout');
  } finally { f.done(); }
  // Nudges off: no morning, no greeting.
  f = friday();
  try {
    f.store.writeLocal('settings', 'main', { notify: { wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 0 } });
    opens(f, '11:00'); await f.run('11:00', '11:05');
    assert.equal(greeted(f), false, 'nudges off');
  } finally { f.done(); }
  // The Mac first looks 15 minutes after the open (asleep): old news.
  f = friday();
  try { opens(f, '11:00'); f.set(T('11:15')); await f.run('11:15', '11:15'); assert.equal(greeted(f), false, 'late'); } finally { f.done(); }
  // 5:30 AM, up all night, not slept: that's still his day before; the greeting comes when he opens it after sleeping.
  f = friday();
  try {
    opens(f, '05:30'); await f.run('05:30', '05:40');
    assert.equal(greeted(f), false, 'not slept yet');
    opens(f, '13:00'); await f.run('13:00', '13:00');
    assert.match(talkOf(f.store).at(-1).text, /^Morning\./);
  } finally { f.done(); }
});

test('POST /api/app/opened: the phone\'s open reaches the Mac; another device\'s doesn\'t', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-opened-'));
  const store = openStore(join(dir, 'db.sqlite'));
  const seen = [];
  const server = createApp({ store, appDir: APP_DIR, onOpened: async (o) => { seen.push(o); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const { code } = store.createPairingCode();
    const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceId: 'a1b2c3d4e5f6', name: 'iPhone' }) })).json();
    assert.ok(token);
    const call = (body, t = token) => fetch(`${base}/api/app/opened`, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) });
    assert.equal((await call({ phone: true }, 'made-up')).status, 401);
    assert.equal((await call({ phone: true })).status, 200);
    assert.equal((await call({ phone: false })).status, 200);
    assert.equal(seen.length, 1);
  } finally { server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

// Mon 10/26, his words on Sunday's 1:58 PM notification ("Your plan now: Morning holds... Then: Start cooking: first meal
// at 12:30 PM... Then: First meal time. 12:30 PM, nothing logged yet today... Then: Still nothing..."): four overdue
// reminders read back, past times and all, far over 150 characters. Wants one short current ask, no passed times.
test('his Sunday replayed: what waited for his morning comes as one short ask of what to do now, no passed times', async () => {
  const f = friday();
  try {
    await f.run('09:58', '13:44');
    f.store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T('13:45') });
    await f.run('13:45', '13:46');
    f.say('13:47', 'slept 4 to 12:40');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: T('04:00'), wake: T('12:40'), source: 'coach', at: T('13:47') });
    await f.run('13:47', '13:51');
    f.say('13:52', 'back is fine, 0');
    await f.run('13:52', '13:59');
    const plan = f.sent.filter((m) => m.tag === 'morning-plan');
    assert.equal(plan.length, 1, JSON.stringify(f.sent.map((m) => [hmOf(m.at), m.body])));
    assert.equal(hmOf(plan[0].at), '1:55 PM');
    assert.match(plan[0].body, /^Morning holds now \(Knees: Toes Wall Squat Hold\)\. Then eat your first meal by 2:00 PM, or tell me you're skipping it\./);
    assert.ok(plan[0].body.length <= 150, plan[0].body);
    assert.doesNotMatch(plan[0].body, /12:30|9:30|Then:|Your plan now|Still nothing|Start cooking/);
    // Nothing else came out with it: the meal's cook, ask and check-ins were in that one line.
    assert.deepEqual(f.sent.filter((m) => m.at === plan[0].at).length, 1);
  } finally { f.done(); }
});

test('only his meal waited for his morning: one ask, not its 12:00 PM cooking and 12:30 PM times read back', async () => {
  const f = friday();
  try {
    f.store.writeLocal('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [], loadsArea: { exercises: [] } });
    await f.run('09:58', '11:59');
    f.store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T('12:00') });
    await f.run('12:00', '12:01');
    f.say('12:02', 'slept fine');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: T('03:00'), wake: T('11:50'), source: 'coach', at: T('12:02') });
    await f.run('12:02', '12:06');
    f.say('12:40', 'back is 0');
    await f.run('12:07', '12:44');
    const out = f.sent.filter((m) => m.at >= T('12:40'));
    assert.ok(out.length >= 1, JSON.stringify(f.sent.map((m) => [hmOf(m.at), m.body])));
    assert.doesNotMatch(out.map((m) => m.body).join(' | '), /12:30|12:00/);
    assert.match(out[0].body, /^Eat your first meal by 2:00 PM, or tell me you're skipping it\./);
  } finally { f.done(); }
});

test('held reminders as one ask: the latest of each thing, passed times dropped, whole asks that fit', () => {
  const H = (id, kind, tag, title, body, hm, more = {}) => ({ id, kind, tag, title, body, heldAt: T(hm), at: T('13:58'), ...more });
  const holds = H(`holds-morning:${D}`, 'holds', `holds-${D}-morning`, 'Morning holds', 'Knees: Toes Wall Squat Hold. 3 × 30 s each, about 6 min a round.', '09:30');
  const check = H(`holds-check:${D}:morning:1`, 'holds', `holds-${D}-morning`, 'Holds: one round now', 'Knees: one round.', '10:30');
  const meal = { meal: 'First meal', latestAt: T('14:00') };
  const cook = H(`meal-cook:${D}:1230`, 'cook', `meal-${D}-1230`, 'Start cooking: first meal at 12:30 PM', '30 minutes to get it on the plate; 2:00 PM at the latest.', '12:00', meal);
  const ask = H(`meal:${D}:1230`, 'meals', `meal-${D}-1230`, 'First meal', '12:30 PM, nothing logged yet today. 2:00 PM at the latest. Eaten, cooking, or skipping?', '12:30', meal);
  const again = H(`meal-again:${D}:1230:2`, 'meals', `meal-${D}-1230`, 'Still nothing on your first meal', '2:00 PM is the latest you set.', '13:30', meal);
  const supps = H(`supps:${D}:1000`, 'supps', `supps-${D}-1000`, 'Morning supplements', 'Creatine 5 g, Vitamin C 500 mg, Omega-3 3 softgels. Tap to tick them off.', '10:00');
  const said = (items, hm) => heldPlanText(items, { now: T(hm), tz: TZ });
  // (A check-in the latest of the holds: plain "Holds", what they are from the holds reminder.)
  assert.equal(said([holds, check, cook, ask, again], '13:58'), "Holds now (Knees: Toes Wall Squat Hold). Then eat your first meal by 2:00 PM, or tell me you're skipping it.");
  assert.equal(said([holds, cook, ask, again], '13:58'), "Morning holds now (Knees: Toes Wall Squat Hold). Then eat your first meal by 2:00 PM, or tell me you're skipping it.");
  // Past his latest time: eat now, no time at all.
  assert.equal(said([holds, cook, ask], '14:20'), "Morning holds now (Knees: Toes Wall Squat Hold). Then eat your first meal now, or tell me you're skipping it.");
  // More than fits: shorter asks, still every thing, still at most 150 characters.
  const three = said([holds, supps, cook, ask, again], '13:58');
  assert.equal(three, "Morning holds now. Then morning supplements. Then eat your first meal by 2:00 PM, or tell me you're skipping it.");
  assert.ok(three.length <= 150);
  // A reminder whose title has a time: the time goes, the rest stays.
  assert.equal(said([H('x', 'neck', 'neck-x', 'Neck at 10:00 AM', '', '10:00'), cook], '13:58'), "Neck. Then eat your first meal by 2:00 PM, or tell me you're skipping it.");
  // A question stays a question.
  assert.equal(said([H('q', 'supps', 'q', 'Supplements: planning to get anything?', 'Tap to answer.', '10:00'), cook], '13:58'), "Supplements: planning to get anything? Then eat your first meal by 2:00 PM, or tell me you're skipping it.");
  // Many things: the ones that fit, the rest left to the app.
  const many = Array.from({ length: 8 }, (_, k) => H(`s${k}`, 'supps', `supps-${k}`, `Supplement group number ${k} still open`, '', '10:00'));
  const cut = said(many, '13:58');
  assert.ok(cut.length <= 150, cut);
  assert.match(cut, /\d more open in the app\.$/);
});
