// Mon 11/16 (the nightly review of Sunday 11/15; his words: "How did you sleep? When did you go to bed and when did you
// wake up?"): "Morning. Are you up?" at 6:30 AM, he opened the app at 6:37 AM and the sleep question went out that same
// second; at 6:38 AM he answered "Yeah" and the coach asked the bed and wake question again. Now, once "Are you up?" is
// asked, opening the app gives him 5 minutes (MORNING.replyMin) to answer it first. He answers: the coach's reply asks
// the sleep question, the app doesn't. He doesn't: the app asks it then, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, noteAppOpen, morningGate } from '../server/notify.mjs';
import { morningStep, MORNING, MORNING_UP_TEXT } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-22';
const Y = '2026-03-21';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const hmOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const SLEEPQ = /\b(sleep|slept|bed)\b[^.!?]*\?/i;

/** His Sunday: wake 6:30 AM by Settings, in bed from about 8:30 PM, quiet all night. */
function sunday() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-upreply-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { movingDay: false, wakeHm: '06:30', bedHm: '20:30', nudgeEveryMin: 20, kinds: { walk: false } },
  });
  store.writeLocal('coach-messages', 'u0', { id: 'u0', role: 'user', text: 'night', at: at(Y, '20:10') });
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  let now = T('06:00');
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const tickAt = async (t) => { now = t; await n.tick(); };
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) await tickAt(t); };
  const opens = (t) => { store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: t }); noteAppOpen(store, t, TZ); };
  const say = (t, text) => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t });
  const coach = (t, text) => store.writeLocal('coach-messages', `c${t}`, { id: `c${t}`, role: 'assistant', text, at: t });
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant').sort((a, b) => a.at - b.at);
  const sleepAsks = () => talk().filter((m) => m.at >= T('06:31') && SLEEPQ.test(m.text));
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, tickAt, opens, say, coach, talk, sleepAsks, done };
}
const list = (xs) => JSON.stringify(xs.map((m) => [hmOf(m.at), m.body ?? m.text]));

test('his Sunday replayed: he opens the app at 6:37 AM and answers "Yeah": the sleep question once, from the coach', async () => {
  const f = sunday();
  try {
    await f.run('06:00', '06:36');
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['6:30 AM', MORNING_UP_TEXT]]);
    // The open at 6:37:58 AM runs a tick at once (as the server does), then every minute.
    const open = T('06:37') + 58000;
    f.opens(open);
    await f.tickAt(open + 1);
    assert.equal(f.sleepAsks().length, 0, `nothing on top of his open: ${list(f.talk())}`);
    assert.equal(morningGate(f.store, open + 1, TZ).hold, true, 'the day still waits');
    await f.run('06:38', '06:38');
    f.say(T('06:38') + 2744, 'Yeah');
    f.coach(T('06:38') + 8690, 'Good. When did you go to bed and when did you wake up?');
    await f.run('06:39', '08:00');
    assert.deepEqual(f.sleepAsks().map((m) => m.text), ['Good. When did you go to bed and when did you wake up?'], list(f.talk()));
    assert.equal(f.sent.length, 1, `no notification after "Are you up?": ${list(f.sent)}`);
  } finally { f.done(); }
});

test('he opens the app and doesn\'t write: the sleep question 5 minutes later, in Talk, once', async () => {
  const f = sunday();
  try {
    await f.run('06:00', '06:36');
    f.opens(T('06:37'));
    await f.run('06:37', '06:41');
    assert.equal(f.sleepAsks().length, 0, list(f.talk()));
    await f.run('06:42', '07:30');
    const asks = f.sleepAsks();
    assert.equal(asks.length, 1, list(f.talk()));
    assert.equal(hmOf(asks[0].at), '6:42 AM');
    assert.equal(asks[0].text, 'How did you sleep? When did you go to bed and when did you wake up?', 'no second "Morning."');
    assert.equal(f.sent.length, 1, 'no notification: he is in the app');
  } finally { f.done(); }
});

test('he answers "Are you up?" but the coach\'s reply doesn\'t ask about sleep: the app asks it once, 3 minutes after', async () => {
  const f = sunday();
  try {
    await f.run('06:00', '06:36');
    f.opens(T('06:37'));
    await f.run('06:37', '06:39');
    f.say(T('06:40'), 'yeah up');
    f.coach(T('06:40') + 6000, 'Good.');
    await f.run('06:40', '07:30');
    const asks = f.sleepAsks();
    assert.equal(asks.length, 1, list(f.talk()));
    assert.equal(hmOf(asks[0].at), '6:44 AM', '3 minutes after the coach\'s 6:40 AM reply');
  } finally { f.done(); }
});

test('he logs his sleep or starts a workout within the 5 minutes: no sleep question at all', async () => {
  for (const what of ['sleep', 'workout']) {
    const f = sunday();
    try {
      await f.run('06:00', '06:36');
      f.opens(T('06:37'));
      await f.run('06:37', '06:38');
      if (what === 'sleep') f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '20:40'), wake: T('06:25'), source: 'app', at: T('06:39') });
      else f.store.writeLocal('sessions', 'w1', { id: 'w1', dayType: 'push', status: 'active', startedAt: T('06:39'), exercises: [] });
      await f.run('06:39', '07:30');
      assert.equal(f.sleepAsks().length, 0, `${what}: ${list(f.talk())}`);
    } finally { f.done(); }
  }
});

test('he writes first, no open before it: as before, the coach asks; the app does not ask it again', async () => {
  const f = sunday();
  try {
    await f.run('06:00', '06:44');
    f.say(T('06:45'), 'Yeah');
    f.coach(T('06:45') + 6000, 'Good. When did you go to bed and when did you wake up?');
    await f.run('06:45', '08:00');
    assert.equal(f.sleepAsks().length, 1, list(f.talk()));
  } finally { f.done(); }
});

test('morningStep: after "Are you up?" an open waits replyMin for his reply; a reply, sleep or check-in logged, or a workout end the wait', () => {
  assert.equal(MORNING.replyMin, 5);
  const base = { wakeAt: T('06:30'), upAt: T('06:37'), state: { up: T('06:30') }, lastCoachAt: T('06:30'), bodyText: 'BODY?' };
  const step = (o) => morningStep({ ...base, ...o });
  for (const hm of ['06:37', '06:39', '06:41']) assert.deepEqual(step({ now: T(hm) }), { hold: true, open: false, ask: null, waitUp: true }, hm);
  assert.equal(step({ now: T('06:42') }).ask.key, 'sleep');
  // His reply: no wait; the next question only after quietMin (the coach's reply asks it first, coachAsked).
  assert.equal(step({ now: T('06:39'), lastUserAt: T('06:38') }).waitUp, undefined);
  assert.equal(step({ now: T('06:41'), lastUserAt: T('06:38') }).ask.key, 'sleep');
  assert.equal(step({ now: T('06:41'), lastUserAt: T('06:38'), coachAsked: { sleep: T('06:38') }, lastCoachAt: T('06:38') }).ask, null);
  // Sleep logged: the body question, no wait.
  assert.equal(step({ now: T('06:39'), sleepKnown: true }).ask.key, 'body');
  // A workout started: no wait (the sleep question waits for the workout to end: notify.mjs busy).
  assert.equal(step({ now: T('06:39'), workoutAt: T('06:38'), bodyKnown: true }).waitUp, undefined);
  // No "Are you up?" asked (he opened before it went out): no wait.
  assert.equal(step({ now: T('06:37'), state: {} }).ask.key, 'sleep');
});
