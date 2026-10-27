// Tue 10/27, his words: "why did you prompt me right now? How did you sleep?... under which assumption did you assume that
// I went to bed when I messaged you at 1:46 AM and when I'm messaging you now? Isn't it more obvious to assume that I
// haven't slept". He was on the app until 2:16 AM, opened it again at 5:18 AM, and "How did you sleep?" went out: the
// open was the first sign from 5:00 AM. Now a sign counts as him waking only after a real sleep gap (SLEEP: 4 hours with
// no sign of him, ending from 3:00 AM); up through the night, no sleep question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate, noteAppOpen, upAtToday, wakeHmToday, SLEEP } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-20';
const Y = '2026-03-19';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const SLEEPQ = /How did you sleep|Are you up/;

function night() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-slept-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 30, kinds: { walk: false } } });
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  let now = T('00:00');
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to, day = D) => { for (let t = at(day, from); t <= at(day, to); t += 60000) { now = t; await n.tick(); } };
  const say = (t, text = 'hi') => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t });
  const opens = (t) => { store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: t }); noteAppOpen(store, t, TZ); };
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant');
  const asked = () => [...sent.map((m) => m.body), ...talk().map((m) => m.text)].filter((x) => SLEEPQ.test(x));
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, say, opens, asked, done };
}

/** His Monday night as it went: dinner 10:45 PM, Talk at 1:41 to 1:46 AM, the app last at 2:16 AM. */
function hisNight(f) {
  f.say(at(Y, '22:45'), 'I just ate this');
  for (const hm of ['01:39', '01:40', '01:42', '02:16']) f.opens(T(hm));
  for (const hm of ['01:41', '01:45', '01:46']) f.say(T(hm));
  f.store.writeLocal('health', D, { date: D, fileAt: T('02:16') });
}

test('his night replayed: the app opened at 5:18 AM, 3 hours after 2:16 AM: no sleep question, nothing held', async () => {
  const f = night();
  try {
    hisNight(f);
    await f.run('02:17', '05:17');
    f.opens(T('05:18'));
    await f.run('05:18', '05:18');
    f.say(T('05:19'), 'took collagen like 20 minutes ago');
    f.store.writeLocal('supp-log', 'c1', { id: 'c1', suppId: 'collagen', date: Y, status: 'taken', at: T('05:19') });
    await f.run('05:19', '05:40');
    assert.deepEqual(f.asked(), []);
    assert.equal(upAtToday(f.store, T('05:40'), TZ), null);
    assert.equal(morningGate(f.store, T('05:40'), TZ).hold, false);
    assert.equal(wakeHmToday(f.store, T('05:40'), TZ, '10:00'), '10:00', 'his 5:19 AM message is not him waking');
  } finally { f.done(); }
});

test('still up past his wake time and active: no "Are you up?", no sleep question, the day is not held', async () => {
  const f = night();
  try {
    hisNight(f);
    f.opens(T('05:18'));
    for (const hm of ['05:19', '07:10', '09:05', '10:40', '11:55']) f.say(T(hm));
    await f.run('05:18', '12:30');
    assert.deepEqual(f.asked(), []);
    assert.equal(morningGate(f.store, T('12:30'), TZ).hold, false);
  } finally { f.done(); }
});

test('then he sleeps: the sleep question comes when he is back after hours away, not before', async () => {
  const f = night();
  try {
    hisNight(f);
    f.opens(T('05:18'));
    f.say(T('06:30'));
    // Asleep from about 6:30 AM. Past his wake time with no sign of him for 2 hours: "Are you up?", as on any morning.
    await f.run('06:31', '09:59');
    assert.deepEqual(f.asked(), []);
    await f.run('10:00', '14:59');
    assert.deepEqual(f.sent.filter((m) => SLEEPQ.test(m.body)).map((m) => m.body), ['Morning. Are you up?']);
    // He opens the app at 3:00 PM, 8.5 hours later: "Morning." and the sleep question, in Talk.
    f.opens(T('15:00'));
    await f.run('15:00', '15:01');
    assert.equal(upAtToday(f.store, T('15:01'), TZ), T('15:00'));
    assert.deepEqual(f.asked().filter((x) => /sleep/.test(x)), ['Morning. How did you sleep? When did you go to bed and when did you wake up?']);
  } finally { f.done(); }
});

test('a real night: quiet from 1:46 AM, he writes at 9:40 AM: the sleep question 3 minutes later', async () => {
  const f = night();
  try {
    hisNight(f);
    f.say(T('09:40'), 'morning');
    await f.run('09:40', '09:45');
    assert.equal(upAtToday(f.store, T('09:45'), TZ), T('09:40'));
    assert.deepEqual(f.sent.map((m) => m.body), ['How did you sleep? When did you go to bed and when did you wake up?']);
    assert.equal(wakeHmToday(f.store, T('09:45'), TZ, '10:00'), '09:40');
  } finally { f.done(); }
});

test('the gap: 4 hours with no sign of him is sleep, under 4 is not; a quiet evening is not a night', () => {
  const f = night();
  try {
    assert.equal(SLEEP.gapH, 4);
    // Quiet from 1:17 AM to 5:18 AM (4 h 1 min): he slept, up at 5:18 AM.
    f.say(T('01:17'));
    f.opens(T('05:18'));
    assert.equal(upAtToday(f.store, T('05:20'), TZ), T('05:18'));
    // A sign at 1:20 AM makes it 3 h 58 min: not slept.
    f.say(T('01:20'));
    assert.equal(upAtToday(f.store, T('05:20'), TZ), null);
  } finally { f.done(); }
  const g = night();
  try {
    // Out all evening (nothing from 6:00 PM to 12:30 AM), then on the app all night: not slept.
    g.say(at(Y, '18:00'));
    for (const hm of ['00:30', '01:40', '02:50', '04:00', '05:10']) g.say(T(hm));
    assert.equal(upAtToday(g.store, T('05:20'), TZ), null);
  } finally { g.done(); }
  const h = night();
  try {
    // Asleep 11:00 PM to 4:30 AM, up early: up from his first sign after 5:00 AM.
    h.say(at(Y, '23:00'));
    h.opens(T('04:30'));
    h.say(T('05:05'));
    assert.equal(upAtToday(h.store, T('05:20'), TZ), T('05:05'));
  } finally { h.done(); }
});

test('his sleep log or a workout still count as up whatever came before', () => {
  const f = night();
  try {
    hisNight(f);
    f.say(T('05:19'));
    f.store.writeLocal('sessions', 'p1', { id: 'p1', dayType: 'push', status: 'active', startedAt: T('05:40'), exercises: [] });
    assert.equal(upAtToday(f.store, T('05:45'), TZ), T('05:40'));
  } finally { f.done(); }
});

test('an Apple Health send on its 10:30 AM timer while he sleeps is not him up: the sleep question waits for him', async () => {
  const f = night();
  try {
    hisNight(f);
    f.say(T('04:00'));
    // Asleep from 4:00 AM; the Shortcut's timer sends Health at 10:30 AM.
    f.store.writeLocal('health', D, { date: D, steps: 120, fileAt: T('10:30') });
    await f.run('10:30', '12:39');
    assert.equal(upAtToday(f.store, T('12:39'), TZ), null);
    assert.deepEqual(f.asked().filter((x) => /sleep/.test(x)), []);
    f.opens(T('12:40'));
    await f.run('12:40', '12:41');
    assert.equal(upAtToday(f.store, T('12:41'), TZ), T('12:40'));
    assert.deepEqual(f.asked().filter((x) => /sleep/.test(x)).length, 1);
  } finally { f.done(); }
});
