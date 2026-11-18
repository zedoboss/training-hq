// Thu 11/19, his words: "Why are you asking me at what time I went to bed when that's obvious? I clearly told you
// yesterday, so what the fuck? And woke up 6:30". Wed 11/18 11:01 PM he wrote "I took magnesium, two of them, and now I'm
// going to sleep. Good night."; Thu 6:30 AM "Morning. Are you up?", 6:41 AM "Yeah", and the coach asked "What time did
// you go to bed and wake up?". Now his good night is his bedtime: the app's question and the coach's context ask only
// how he slept and when he woke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, noteAppOpen, morningGate, morningContext } from '../server/notify.mjs';
import { contextLine } from '../server/coach/tools-read.mjs';
import { saysGoodnight, saidBedtime, morningStep, nudgeCandidates, SLEEP_TEXT, SLEEP_TEXT_BED_KNOWN, MORNING_UP_TEXT } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-26';
const Y = '2026-03-25';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const ASKS_BED = /\b(bed|went to sleep|fell asleep)\b[^.!?]*\?/i;
const GOODNIGHT = "I took magnesium, two of them, and now I'm going to sleep. Good night.";

test('what counts as him going to sleep', () => {
  for (const t of [GOODNIGHT, 'gn', 'Good night bro', 'Going to bed', 'Ok going to sleep now', 'heading to bed', 'night night', 'im in bed', 'Took magnesium before bed, good night'])
    assert.equal(saysGoodnight(t), true, t);
  for (const t of ['remind me before I go to sleep', "I can't sleep", 'are you going to sleep?', 'what time should I go to bed?', 'I slept badly', 'I took collagen', 'I need to go to sleep earlier'])
    assert.equal(saysGoodnight(t), false, t);
});

test('his bedtime: his last message before the night, when it is a good night', () => {
  const u = (iso, hm, text) => ({ role: 'user', text, at: at(iso, hm) });
  const wed = [u(Y, '17:39', 'remind me about collagen'), u(Y, '19:23', 'I took collagen'), u(Y, '23:01', GOODNIGHT), { role: 'assistant', text: 'Have a good night', at: at(Y, '23:02') }];
  // At 6:30 AM, and still at 6:41 AM after his "Yeah".
  assert.equal(saidBedtime(wed, T('06:30')), at(Y, '23:01'));
  assert.equal(saidBedtime([...wed, u(D, '06:41', 'Yeah')], T('06:42')), at(Y, '23:01'));
  // Not yet slept (right after it): no bedtime from last night's message yet.
  assert.equal(saidBedtime(wed, at(Y, '23:30')), null);
  // He wrote again after it, then the night: that last message isn't a good night, so the bedtime isn't known.
  assert.equal(saidBedtime([...wed, u(Y, '23:40', 'actually one more thing, what is tomorrow?')], T('06:30')), null);
  assert.equal(saidBedtime([...wed, u(D, '01:10', "I can't sleep")], T('06:30')), null);
  // Good night then a quick "gn" a few minutes later: the last one is the bedtime.
  assert.equal(saidBedtime([...wed, u(Y, '23:05', 'gn')], T('06:30')), at(Y, '23:05'));
  // No good night: unknown. A good night more than 20 hours back: not last night's.
  assert.equal(saidBedtime(wed.slice(0, 2), T('06:30')), null);
  assert.equal(saidBedtime([u('2026-03-24', '23:01', GOODNIGHT)], T('06:30')), null);
});

test('morningStep and the nudge ask only how he slept and when he woke once his bedtime is known', () => {
  const base = { now: T('06:45'), wakeAt: T('06:30'), upAt: T('06:41'), lastUserAt: T('06:41'), lastCoachAt: T('06:30'), state: { up: T('06:30') }, bodyText: 'BODY?' };
  assert.equal(morningStep(base).ask.text, SLEEP_TEXT);
  assert.equal(morningStep({ ...base, bedSaid: at(Y, '23:01') }).ask.text, SLEEP_TEXT_BED_KNOWN);
  assert.doesNotMatch(SLEEP_TEXT_BED_KNOWN, ASKS_BED);
  const nudge = (o) => nudgeCandidates({ now: T('06:45'), tz: TZ, sleepLogged: false, wakeHm: '06:30', bedHm: '20:30', ...o }).find((c) => c.key === 'sleep');
  assert.match(nudge({}).text, /went to bed/);
  assert.equal(nudge({ bedSaidAt: at(Y, '23:01') }).text, SLEEP_TEXT_BED_KNOWN);
});

/** His Wednesday night and Thursday morning: wake 6:30 AM by Settings, good night at 11:01 PM. */
function thursday(lastWords = GOODNIGHT) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-bedsaid-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '06:30', bedHm: '20:30', nudgeEveryMin: 20, kinds: { walk: false } } });
  const say = (t, text) => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t });
  const coach = (t, text) => store.writeLocal('coach-messages', `c${t}`, { id: `c${t}`, role: 'assistant', text, at: t });
  say(at(Y, '19:23'), 'I took collagen');
  coach(at(Y, '19:23') + 5000, "I've logged your collagen.");
  say(at(Y, '23:01'), lastWords);
  coach(at(Y, '23:02'), "I've logged your magnesium. Have a good night, catch you in the morning.");
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
  let now = T('06:00');
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant' && m.at >= T('06:00')).sort((a, b) => a.at - b.at);
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, say, run, talk, done };
}

test('his Thursday replayed: "Yeah" at 6:41 AM; the coach is told his bedtime and the app never asks it', async () => {
  const f = thursday();
  try {
    await f.run('06:00', '06:40');
    assert.deepEqual(f.talk().map((m) => m.text), [MORNING_UP_TEXT]);
    f.say(T('06:41'), 'Yeah');
    const ctx = contextLine({ store: f.store, tz: TZ, now: T('06:41') + 5000 });
    assert.match(ctx, /He said he was going to sleep at 11:01 PM last night: that is his bedtime\. Don't ask when he went to bed; ask only how he slept and when he woke, and save bed 23:01 with log_sleep\./);
    assert.doesNotMatch(ctx, /he has no watch: ask/);
    assert.match(morningContext(f.store, T('06:41') + 5000, TZ), /He said he was going to sleep at 11:01 PM/);
    assert.equal(morningGate(f.store, T('06:41') + 5000, TZ).bedSaid, at(Y, '23:01'));
    // No reply from the coach: the app asks the sleep question itself, without the bedtime.
    await f.run('06:41', '07:30');
    const asks = f.talk().filter((m) => /sleep/i.test(m.text));
    assert.ok(asks.length >= 1, 'the sleep question still goes out');
    for (const m of asks) assert.doesNotMatch(m.text, ASKS_BED, m.text);
    assert.equal(asks[0].text.endsWith(SLEEP_TEXT_BED_KNOWN), true, asks[0].text);
  } finally { f.done(); }
});

test('no good night last night: the bed and wake question stays as it was', async () => {
  const f = thursday('I took magnesium, two of them.');
  try {
    await f.run('06:00', '06:40');
    f.say(T('06:41'), 'Yeah');
    const ctx = contextLine({ store: f.store, tz: TZ, now: T('06:41') + 5000 });
    assert.match(ctx, /not logged \(he has no watch: ask, save with log_sleep\)/);
    assert.doesNotMatch(ctx, /He said he was going to sleep/);
    await f.run('06:41', '07:30');
    const asks = f.talk().filter((m) => /sleep/i.test(m.text));
    assert.ok(asks.some((m) => m.text.endsWith(SLEEP_TEXT)), JSON.stringify(asks.map((m) => m.text)));
  } finally { f.done(); }
});

test('sleep already logged: nothing about his bedtime in the context', async () => {
  const f = thursday();
  try {
    f.store.writeLocal('sleep-log', D, { date: D, bed: at(Y, '23:01'), wake: T('06:30') });
    f.say(T('06:42'), 'woke up 6:30');
    const ctx = contextLine({ store: f.store, tz: TZ, now: T('06:43') });
    assert.doesNotMatch(ctx, /He said he was going to sleep/);
    assert.match(ctx, /last night's sleep known/);
  } finally { f.done(); }
});
