// Sat 11/7 (the nightly review of Fri 11/6, his words: "Pull today and no time set. When are you going? Your plan:
// 5:00 AM to 5:30 AM. Do it now, future you will love you for it!"): in bed from about 7:10 PM, "Morning. Are you up?"
// at his 4:00 AM wake time, no answer. A step count came in from Apple Health at 4:03 AM (10 steps), so the Mac read him
// as "still up from the night" and let the held day go: the plan at 4:10 AM, Pull at 4:31 AM, neck at 5:00 AM, cooking,
// meals and walks; "How did you sleep?" only at 7:37 AM when he opened the app. He wants: after an unanswered "Are you
// up?", wait for him; then sleep, then his body, and only then the plan, session, meals or walks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const Y = '2026-03-19';
const D = '2026-03-20';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const hmOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

function day({ lastSign = at(Y, '19:07') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-steps-up-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { movingDay: false, wakeHm: '04:00', bedHm: '18:00', nudgeEveryMin: 30, holdsMorning: '04:30', holdsEvening: '17:00' },
    fuel: { mealTimes: [{ name: 'First meal', time: '06:30', latest: '08:00', cookMin: 30 }, { name: 'Last meal', time: '13:00', latest: '14:00', cookMin: 30 }] },
  });
  store.writeLocal('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', where: 'home' }], loadsArea: { exercises: [] } });
  store.writeLocal('sessions', 'legs1', {
    id: 'legs1', dayType: 'legs', status: 'done', startedAt: at(Y, '10:00'), endedAt: at(Y, '11:30'),
    exercises: [{ key: 'dc', name: 'Decline Crunch', notes: 'Lower back hurts' }],
  });
  store.writeLocal('coach-messages', 'u0', { id: 'u0', role: 'user', text: 'going to bed', at: lastSign });
  const sent = [];
  let now = T('03:00');
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  // The Shortcut's sends, as on his Friday: yesterday's last at 7:10 PM, then the new day's first ones.
  const steps = (date, n, t) => store.writeLocal('health', date, { id: date, date, steps: n, fileAt: t });
  const say = (hm, text) => { const t = T(hm); store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t }); };
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, steps, say, done };
}

/** His Friday's steps; run up to each send, then write it, as the phone did. */
async function fridaySteps(f, to = '07:36') {
  f.steps(Y, 10778, at(Y, '19:10'));
  await f.run('03:00', '03:59');
  f.sent.length = 0; // yesterday's walk wrap-up, not this morning
  await f.run('04:00', '04:02');
  f.steps(D, 10, T('04:03'));
  await f.run('04:03', '04:44');
  f.steps(D, 23, T('04:45'));
  await f.run('04:45', '07:13');
  f.steps(D, 40, T('07:14'));
  await f.run('07:14', to);
}

test('his Friday: steps at 4:03, 4:45 and 7:14 AM are no answer to "Are you up?": nothing else till he shows up', async () => {
  const f = day();
  try {
    await fridaySteps(f);
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['4:00 AM', 'Morning. Are you up?']]);
    for (const hm of ['04:05', '04:10', '04:31', '05:00', '06:00', '06:30', '07:30', '07:36']) {
      const g = morningGate(f.store, T(hm), TZ);
      assert.equal(g.hold, true, `${hm}: the day waits`);
      assert.equal(g.ask, null, `${hm}: "Are you up?" once`);
    }
  } finally { f.done(); }
});

test('then he opens the app at 7:37 AM: sleep, then his back, and only then the plan', async () => {
  const f = day();
  try {
    await fridaySteps(f);
    f.store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T('07:37') });
    await f.run('07:37', '07:38');
    assert.deepEqual(f.sent.slice(1).map((m) => [hmOf(m.at), m.body]), [['7:37 AM', 'How did you sleep? When did you go to bed and when did you wake up?']]);
    f.say('07:40', 'bed 7:15, up 4:00');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '19:15'), wake: T('04:00'), source: 'coach', at: T('07:41') });
    await f.run('07:40', '07:44');
    assert.equal(f.sent.length, 3, f.sent.map((m) => m.body).join(' | '));
    assert.match(f.sent[2].body, /^How's your lower back today\?/);
    assert.equal(morningGate(f.store, T('07:44'), TZ).hold, true, 'the plan waits for his answer');
    f.say('07:45', 'back is a 1');
    await f.run('07:45', '07:50');
    const after = f.sent.slice(3);
    assert.ok(after.length >= 1, 'the plan comes once he answered');
    assert.ok(after.every((m) => m.at >= T('07:48')), after.map((m) => `${hmOf(m.at)} ${m.body}`).join(' | '));
    assert.equal(morningGate(f.store, T('07:50'), TZ).hold, false);
  } finally { f.done(); }
});

test('a step count just before his wake time, after a night\'s quiet: the day still waits', async () => {
  const f = day();
  try {
    f.steps(Y, 10778, at(Y, '19:10'));
    await f.run('03:00', '03:49');
    f.sent.length = 0;
    f.steps(D, 12, T('03:50'));
    await f.run('03:50', '06:00');
    // "Are you up?" itself waits for 4 quiet hours after any sign (Sat 10/31); nothing else goes out either.
    assert.deepEqual(f.sent.filter((m) => m.body !== 'Morning. Are you up?').map((m) => `${hmOf(m.at)} ${m.body}`), []);
    assert.equal(morningGate(f.store, T('06:00'), TZ).hold, true);
  } finally { f.done(); }
});

test('really up all night (signs through to 2:30 AM, steps rising after): no "Are you up?", nothing held', async () => {
  const f = day({ lastSign: T('02:30') });
  try {
    f.steps(Y, 10778, at(Y, '23:50'));
    f.steps(D, 300, T('03:40'));
    await f.run('03:00', '04:05');
    f.steps(D, 500, T('04:06'));
    await f.run('04:06', '04:20');
    assert.equal(f.sent.some((m) => /Are you up|How did you sleep/.test(m.body)), false);
    assert.equal(morningGate(f.store, T('04:20'), TZ).hold, false);
  } finally { f.done(); }
});

test('he answers "Are you up?" at 4:05 AM (before 5:00 AM): sleep at once, then his back, then the plan', async () => {
  const f = day();
  try {
    f.steps(Y, 10778, at(Y, '19:10'));
    await f.run('03:00', '03:59');
    f.sent.length = 0;
    await f.run('04:00', '04:04');
    f.say('04:05', 'yeah up');
    await f.run('04:05', '04:09');
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['4:00 AM', 'Morning. Are you up?'], ['4:08 AM', 'How did you sleep? When did you go to bed and when did you wake up?']]);
    assert.equal(morningGate(f.store, T('04:09'), TZ).hold, true);
    f.say('04:10', 'bed 7:15, up 4');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '19:15'), wake: T('04:00'), source: 'coach', at: T('04:10') });
    await f.run('04:10', '04:14');
    assert.match(f.sent[2]?.body || '', /^How's your lower back today\?/);
    assert.equal(f.sent.length, 3);
  } finally { f.done(); }
});
