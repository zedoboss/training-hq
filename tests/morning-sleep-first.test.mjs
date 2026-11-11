// Thu 11/12 (the nightly review of a Wednesday, his words: "How does your body feel today? Knees, legs, back: 0 to
// 3."): "How did you sleep?" went out at 9:20 AM, the body question at 9:50 AM with sleep still unanswered; he answered
// the body one at 11:11 AM, the coach tacked the sleep question onto its reply, he wrote about breakfast at 11:13 AM,
// and the walk plan (11:17 AM) and the day's plan (11:20 AM) went out with sleep never answered. He wants: one question
// at a time; no body question, walk plan or day plan while the sleep question is still unanswered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate, morningContext, noteAppOpen } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const Y = '2026-03-17';
const D = '2026-03-18';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const hmOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

function wednesday() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-sleep-first-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '06:30', bedHm: '20:30', nudgeEveryMin: 20, kinds: { walk: false } } });
  // A rest day after three training days: nothing at the gym today.
  store.writeLocal('sessions', 'push', { id: 'push', kind: 'workout', dayType: 'push', status: 'done', startedAt: at(Y, '10:00'), endedAt: at(Y, '11:00'), exercises: [] });
  const sent = [];
  let now = T('05:00');
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  const say = (hm, text) => { const t = T(hm); store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t }); };
  const coach = (hm, text) => { const t = T(hm) + 20000; store.writeLocal('coach-messages', `c${t}`, { id: `c${t}`, role: 'assistant', text, at: t }); };
  const opens = (hm) => { store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T(hm) }); noteAppOpen(store, T(hm), TZ); };
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant').sort((a, b) => a.at - b.at);
  const said = () => [...sent.map((m) => `${hmOf(m.at)} ${m.body}`), ...talk().map((m) => `${hmOf(m.at)} ${m.text}`)];
  const logSleep = (hm) => store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '21:00'), wake: T('09:00'), source: 'coach', at: T(hm) });
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, say, coach, opens, said, logSleep, done };
}

const BODY = /How does your body feel today\?|How's your/;

test('his Wednesday replayed: no body question, no plan while sleep is unanswered; his other messages are no answer to it', async () => {
  const f = wednesday();
  try {
    await f.run('06:30', '06:30');
    f.opens('09:17');
    await f.run('09:17', '09:20');
    assert.ok(f.said().some((t) => /How did you sleep\?/.test(t)), f.said().join(' | '));
    // 9:50 AM and on: nothing else, the day held.
    let before = f.said().length;
    await f.run('09:21', '11:10');
    assert.deepEqual(f.said().slice(before), [], 'nothing while the sleep question waits');
    assert.equal(morningGate(f.store, T('11:10'), TZ).hold, true);
    assert.match(morningContext(f.store, T('11:10'), TZ), /How he slept is still unanswered \(not logged\).*log_sleep/);
    // He writes about his calves (no sleep times); the coach answers and asks sleep at the end; he writes about breakfast.
    f.say('11:11', 'No pain only calfs a bit sore when squeezed');
    f.coach('11:11', 'Good, nothing in the knees or back. When did you go to bed last night, and when did you wake up?');
    f.say('11:13', 'I ate banh mi and 2 boiled eggs');
    f.coach('11:13', 'Logged your breakfast: 823 kcal.');
    before = f.said().length;
    await f.run('11:11', '12:30');
    assert.deepEqual(f.said().slice(before).filter((t) => !/^\d+:\d+ [AP]M (Good, nothing|Logged your)/.test(t)), [], 'no body question, walk or plan');
    assert.equal(morningGate(f.store, T('12:30'), TZ).hold, true, 'still held: sleep unanswered');
    // He gives his sleep at 12:31 PM (the coach logs it): 3 minutes later the body question, nothing else.
    f.say('12:31', 'bed 9, up 9');
    f.logSleep('12:31');
    before = f.sent.length;
    await f.run('12:31', '12:40');
    const next = f.sent.slice(before);
    assert.equal(next.length, 1, f.said().join(' | '));
    assert.equal(hmOf(next[0].at), '12:34 PM');
    assert.match(next[0].body, BODY);
    assert.equal(morningGate(f.store, T('12:40'), TZ).hold, true, 'the body question waits for his reply');
    // He answers it: the day goes on.
    f.say('12:41', 'all 0');
    await f.run('12:41', '12:45');
    assert.equal(morningGate(f.store, T('12:45'), TZ).hold, false);
  } finally { f.done(); }
});

test('sleep never given but he keeps talking: the day goes on 4 hours after he got up, never held all day', async () => {
  const f = wednesday();
  try {
    f.opens('09:17');
    await f.run('09:17', '09:20');
    f.say('10:00', 'what is on today');
    await f.run('10:00', '13:16');
    assert.equal(f.said().some((t) => BODY.test(t)), false);
    assert.equal(morningGate(f.store, T('13:16'), TZ).hold, true);
    await f.run('13:17', '13:20');
    assert.equal(morningGate(f.store, T('13:20'), TZ).hold, false, 'past the morning, after his message');
    assert.equal(f.said().some((t) => BODY.test(t)), false, 'no body question past the morning');
  } finally { f.done(); }
});

test('no message at all after the sleep question: held, as before (he replies first)', async () => {
  const f = wednesday();
  try {
    f.opens('09:17');
    await f.run('09:17', '09:20');
    await f.run('09:21', '15:00');
    assert.equal(f.said().some((t) => BODY.test(t)), false);
    assert.equal(morningGate(f.store, T('15:00'), TZ).hold, true);
  } finally { f.done(); }
});
