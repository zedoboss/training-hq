// Fri 10/30, 5:49 AM (the nightly review, his words: "Morning. How did you sleep? When did you go to bed and when did you
// wake up?"): Push ended at 3:07 AM and his steps kept rising; he hadn't slept. The phone had been cut off from the Mac
// since Wednesday, so Thursday read as one long night and the start of Push as him waking. He wants no sleep or morning
// ask until 4 quiet hours have passed with no workout, steps or app use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { morningGate, morningTick, noteAppOpen, nudgeInputs, clockOf, noQuietYet } from '../server/notify.mjs';
import { morningStep, nudgeCandidates } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const WED = '2026-03-18';
const THU = '2026-03-19';
const FRI = '2026-03-20';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);

function fixture(movingDay = true, morning = null) {
  const dir = mkdtempSync(join(tmpdir(), 'no-morning-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { notify: { movingDay, wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 20, morning } });
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push(m.body); return { sent: 1 }; } };
  const say = (t) => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text: 'hi', at: t });
  const steps = (date, n, t) => store.writeLocal('health', date, { id: date, date, steps: n, fileAt: t });
  const trained = (start, end, id = 'push', kind = 'workout') => {
    store.writeLocal('sessions', id, { id, kind, dayType: 'push', status: 'done', startedAt: start, endedAt: end, exercises: [] });
    store.writeLocal('sets', `${id}.1`, { id: `${id}.1`, sessionId: id, exKey: 'a', done: true, doneAt: end - 60000 });
  };
  const tick = (now) => morningTick({ store, push, now, tz: TZ });
  const open = (now) => { noteAppOpen(store, now, TZ); return tick(now); };
  return { store, sent, say, steps, trained, tick, open, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** His real Friday, as the Mac saw it at 5:49 AM: nothing from the phone since Wednesday, his steps on Thursday evening, Push synced late. */
function friday(f) {
  f.say(at(WED, '12:00'));
  f.say(at(WED, '23:13'));
  f.steps(THU, 216, at(THU, '19:12'));
  f.steps(THU, 971, at(THU, '20:24'));
  f.trained(at(FRI, '02:05'), at(FRI, '03:07'));
}

test('his Friday: the app opens at 5:49 AM, 2 h 42 min after Push: no morning, no sleep question, nothing held', async () => {
  const f = fixture();
  try {
    friday(f);
    assert.equal(clockOf(f.store, at(FRI, '05:49'), TZ).wokeAt, at(FRI, '02:05'), 'the clock reads the workout as his wake (the moment he hit)');
    assert.equal(await f.open(at(FRI, '05:49')), null);
    assert.deepEqual(f.sent, []);
    for (const hm of ['03:30', '05:49', '05:53', '06:04', '06:06', '07:06', '07:08', '09:00']) {
      const g = morningGate(f.store, at(FRI, hm), TZ);
      assert.equal(g.ask, null, hm);
      assert.equal(g.hold, false, `${hm}: the day isn't held up for a question that won't come`);
      assert.equal(await f.tick(at(FRI, hm)), null, hm);
    }
    assert.deepEqual(f.store.listRecords('coach-messages').filter((r) => r.data.kind === 'nudge').map((r) => r.data.text), []);
  } finally { f.done(); }
});

test('later opens of the same stretch get no "Morning." either', async () => {
  const f = fixture();
  try {
    friday(f);
    f.steps(FRI, 4159, at(FRI, '06:47'));
    f.steps(FRI, 6473, at(FRI, '07:56'));
    for (const hm of ['06:30', '08:12', '09:30']) assert.equal(await f.open(at(FRI, hm)), null, hm);
    assert.deepEqual(f.sent, []);
  } finally { f.done(); }
});

test('no workout at all: phone signs apart, steps rising in between: no ask', async () => {
  const f = fixture();
  try {
    f.say(at(WED, '12:00'));
    f.say(at(WED, '20:00'));
    for (const [hm, n] of [['21:30', 100], ['00:30', 300]]) f.steps(WED, n, at(hm < '12' ? THU : WED, hm));
    for (const [hm, n] of [['02:30', 50], ['05:00', 200], ['07:30', 400]]) f.steps(THU, n, at(THU, hm));
    assert.equal(noQuietYet(f.store, at(THU, '08:00')), true);
    assert.equal(await f.open(at(THU, '08:00')), null);
    assert.deepEqual(f.sent, []);
  } finally { f.done(); }
});

test('a real night still gets his morning: 4 quiet hours, then the app; steps on the way to it count as him waking', async () => {
  const f = fixture();
  try {
    f.say(at(WED, '12:00'));
    f.say(at(WED, '22:00'));
    f.steps(WED, 3000, at(WED, '22:10'));
    f.steps(THU, 120, at(THU, '10:50'));
    const now = at(THU, '11:00');
    assert.equal(noQuietYet(f.store, now), false);
    const out = await f.open(now);
    assert.match(out.body, /^Morning\./);
  } finally { f.done(); }
});

test('after a real sleep behind the workout: the morning comes once 4 quiet hours have passed', async () => {
  const f = fixture();
  try {
    friday(f);
    assert.equal(noQuietYet(f.store, at(FRI, '07:06')), true);
    assert.equal(noQuietYet(f.store, at(FRI, '07:08')), false, 'nothing since 3:07 AM');
    f.store.writeLocal('coach-messages', 'back', { id: 'back', role: 'user', text: 'hi', at: at(FRI, '15:00') });
    assert.equal(noQuietYet(f.store, at(FRI, '15:02')), false, 'back after a long quiet');
  } finally { f.done(); }
});

test('he wakes, then walks: steps right after waking do not take the question away', async () => {
  const f = fixture();
  try {
    f.say(at(WED, '12:00'));
    f.say(at(WED, '22:00'));
    f.say(at(THU, '11:00'));
    f.steps(THU, 300, at(THU, '11:10'));
    f.steps(THU, 900, at(THU, '11:30'));
    assert.equal(noQuietYet(f.store, at(THU, '11:40')), false);
    assert.equal(noQuietYet(f.store, at(THU, '14:30')), false, 'under the 4 hours the morning lasts');
  } finally { f.done(); }
});

test('a holds round after waking is not a workout: the questions still come', async () => {
  const f = fixture(false);
  try {
    f.say(at(THU, '11:00'));
    f.trained(at(THU, '11:02'), at(THU, '11:06'), 'knees', 'holds');
    assert.equal(noQuietYet(f.store, at(THU, '11:10')), false);
    assert.equal(morningGate(f.store, at(THU, '11:10'), TZ).ask?.key, 'sleep');
  } finally { f.done(); }
});

test('a Shortcut send with old steps while he sleeps does not wake him on his day clock', () => {
  const f = fixture();
  try {
    f.say(at(WED, '12:00'));
    f.say(at(WED, '23:30'));
    f.steps(WED, 3000, at(WED, '23:40'));
    const before = clockOf(f.store, at(THU, '09:00'), TZ);
    f.steps(THU, 40, at(THU, '10:30'));
    const after = clockOf(f.store, at(THU, '10:45'), TZ);
    assert.equal(after.asleep, true);
    assert.equal(after.wokeAt, before.wokeAt);
    assert.equal(morningGate(f.store, at(THU, '10:45'), TZ).ask, null);
  } finally { f.done(); }
});

test('moving schedule off, same rule: no "Are you up?", sleep question or "Morning:" routine after a night workout', () => {
  const f = fixture(false, { text: 'Banana, then sunlight', gymAfterMin: [60, 90] });
  try {
    f.trained(at(FRI, '05:30'), at(FRI, '07:30'));
    const now = at(FRI, '10:30');
    assert.equal(morningGate(f.store, now, TZ).ask, null, 'upAt from the workout, 3 hours after it');
    const i = nudgeInputs(f.store, now, TZ);
    assert.equal(i.args.sleepLogged, true);
    assert.equal(i.args.morning.text, null);
    assert.deepEqual(i.args.morning.gymAfterMin, [60, 90], 'the gym hours stay');
    assert.deepEqual(nudgeCandidates(i.args).filter((c) => c.key === 'sleep' || c.key === 'morning').map((c) => c.key), []);
  } finally { f.done(); }
});

test('moving schedule off, his steps rose 3 hours before his wake time: no "Are you up?" until 4 quiet hours', () => {
  const f = fixture(false);
  try {
    f.steps(FRI, 200, at(FRI, '07:00'));
    const hm = (t) => morningGate(f.store, at(FRI, t), TZ);
    assert.equal(hm('10:00').ask, null);
    assert.equal(hm('10:00').hold, true, 'the day still waits for his morning');
    assert.equal(hm('11:01').ask?.key, 'up', 'the 4 quiet hours are up');
  } finally { f.done(); }
});

test('morningStep: no quiet hours: no ask, the day goes on', () => {
  const T = (hm) => at(FRI, hm);
  const step = (o) => morningStep({ wakeAt: T('02:05'), upAt: T('02:05'), lastUserAt: 0, lastCoachAt: 0, bodyText: 'BODY?', ...o });
  assert.deepEqual(step({ now: T('05:49'), noQuiet: true }), { hold: false, open: true, ask: null });
  assert.equal(step({ now: T('05:49') }).ask.key, 'sleep', 'the same moment without the rule');
});
