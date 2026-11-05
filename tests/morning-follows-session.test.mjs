// Thu 11/5 (his words: "Dig even further"): the session time was set to 4:15 AM at 4:02 AM and Legs started at 4:35 AM,
// yet the 4:32 AM morning nudge said "Banana, bathroom, then stretch and get some sunlight... Gym 5:01 AM to 5:31 AM": it
// planned from his wake time and ignored the session time. He wants: a session time he sets (or a session he starts)
// changes the morning plan at once, the gym time comes from it, and once he's at the gym or training, no morning nudge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, noteAppOpen } from '../server/notify.mjs';
import { nudgeCandidates } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const Y = '2026-03-17';
const D = '2026-03-18';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const ROUTINE = 'Banana, bathroom, then stretch and get some sunlight';
const base = { tz: TZ, rot: { today: { kind: 'train', dayType: 'legs' } }, wakeHm: '04:00', bedHm: '20:00', sleepLogged: true, wokeAt: T('04:01'),
  morning: { text: ROUTINE, gymAfterMin: [60, 90] } };
const morning = (o) => nudgeCandidates({ ...base, ...o }).find((c) => c.key === 'morning')?.text ?? null;

test('a session time he set is the gym time in the morning plan, not the window from his wake time', () => {
  assert.equal(morning({ now: T('04:05') }), `Morning: ${ROUTINE}. Gym 5:01 AM to 5:31 AM.`, 'no time set: the window as before');
  assert.equal(morning({ now: T('04:05'), sessionHm: '04:15' }), `Morning: ${ROUTINE}. Legs at 4:15 AM.`);
  // A time later than the window: that time too.
  assert.equal(morning({ now: T('04:05'), sessionHm: '06:00' }), `Morning: ${ROUTINE}. Legs at 6:00 AM.`);
  // A rest day: no gym in it, whatever the day record says.
  assert.equal(morning({ now: T('04:05'), sessionHm: '04:15', rot: { today: { kind: 'rest' } } }), `Morning: ${ROUTINE}.`);
});

test('his 4:32 AM: the session time has come, he started, or he is at the gym: no morning nudge', () => {
  assert.equal(morning({ now: T('04:32'), sessionHm: '04:15' }), null, 'past 4:15 AM: the session nudge speaks, not the routine');
  assert.equal(morning({ now: T('04:15'), sessionHm: '04:15' }), null);
  assert.equal(morning({ now: T('04:14'), sessionHm: '04:15' }), `Morning: ${ROUTINE}. Legs at 4:15 AM.`);
  // The session nudge still says it's due.
  assert.match(nudgeCandidates({ ...base, now: T('04:32'), sessionHm: '04:15' }).find((c) => c.key === 'session').text, /^Legs was due at 4:15 AM\./);
  // Training (no time set, or before it): nothing.
  assert.equal(morning({ now: T('04:20'), session: { started: true, done: true } }), null);
  assert.equal(morning({ now: T('04:20'), sessionHm: '05:00', session: { started: true, done: true } }), null);
  // At the gym (his arrival Shortcut), not started yet: nothing.
  assert.equal(morning({ now: T('04:20'), arrivedAt: T('04:18') }), null);
  // An arrival from before he woke (yesterday's evening, a stale record) doesn't count; one in the future neither.
  assert.equal(morning({ now: T('04:20'), arrivedAt: T('03:00') }), `Morning: ${ROUTINE}. Gym 5:01 AM to 5:31 AM.`);
  assert.equal(morning({ now: T('04:20'), arrivedAt: T('04:30') }), `Morning: ${ROUTINE}. Gym 5:01 AM to 5:31 AM.`);
});

function thursday() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-morning-session-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { movingDay: false, wakeHm: '04:00', bedHm: '20:00', nudgeEveryMin: 20, kinds: { walk: false, scan: false }, morning: { text: ROUTINE, gymAfterMin: [60, 90] } },
  });
  store.writeLocal('sessions', 'push', { id: 'push', kind: 'workout', dayType: 'push', status: 'done', startedAt: at(Y, '04:00'), endedAt: at(Y, '05:00'), exercises: [] });
  store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '19:00'), wake: T('04:01'), source: 'coach', at: T('04:01') });
  const sent = [];
  let now = T('04:00');
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  const say = (hm, text) => { const t = T(hm); store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t }); };
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant').map((m) => m.text);
  const said = () => [...sent.map((m) => m.body), ...talk()];
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T('04:01') }); noteAppOpen(store, T('04:01'), TZ);
  return { store, sent, run, say, said, done };
}

test('his Thursday replayed on the Mac: 4:15 AM set at 4:02 AM: no "Gym 5:01 AM to 5:31 AM", no routine once 4:15 AM has come', async () => {
  const f = thursday();
  try {
    f.say('04:01', 'Good morning coach');
    f.store.writeLocal('days', D, { date: D, sessionTime: '04:15' });
    await f.run('04:01', '04:10');
    f.say('04:11', 'all 0, good');
    await f.run('04:11', '04:34');
    const said = f.said();
    assert.equal(said.filter((t) => /Morning: Banana/.test(t)).length, 0, said.join(' | '));
    assert.ok(said.every((t) => !/5:01 AM|5:31 AM/.test(t)), said.join(' | '));
  } finally { f.done(); }
});

test('replayed: a later session time set at 4:02 AM is the gym time in the plan', async () => {
  const f = thursday();
  try {
    f.say('04:01', 'Good morning coach');
    f.store.writeLocal('days', D, { date: D, sessionTime: '05:15' });
    await f.run('04:01', '04:10');
    f.say('04:11', 'all 0, good');
    await f.run('04:11', '05:14');
    const plans = f.sent.map((m) => m.body).filter((t) => /Morning: Banana/.test(t));
    assert.equal(plans.length, 1, f.said().join(' | '));
    assert.match(plans[0], /Legs at 5:15 AM\./);
    assert.doesNotMatch(plans[0], /5:01 AM|5:31 AM/);
  } finally { f.done(); }
});

test('replayed: he arrives at the gym before his window: no morning plan after that', async () => {
  const f = thursday();
  try {
    f.say('04:01', 'Good morning coach');
    f.store.writeLocal('days', D, { date: D, arrivedAt: T('04:05') });
    f.say('04:06', 'all 0');
    await f.run('04:06', '05:30');
    assert.deepEqual(f.said().filter((t) => /Morning: Banana/.test(t)), []);
  } finally { f.done(); }
});

test('a day begun the evening before: a session time after midnight is still ahead, not past', () => {
  const o = { ...base, wokeAt: at(Y, '21:00'), now: at(Y, '21:10'), sessionHm: '01:00' };
  assert.equal(nudgeCandidates(o).find((c) => c.key === 'morning')?.text, `Morning: ${ROUTINE}. Legs at 1:00 AM.`);
  // A time set before he woke on a normal morning stays past: no routine.
  assert.equal(morning({ now: T('04:20'), sessionHm: '03:00' }), null);
});
