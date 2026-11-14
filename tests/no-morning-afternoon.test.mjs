// Sat 11/14 (the nightly review of Fri 11/13; his words: "Morning."): "Morning. Are you up?" at 7:05 AM, no answer, no
// sign of him all day; at 3:57 PM the phone opened the app and out came, within 3 minutes, "Morning holds. Knees...", a
// second "Morning.", the walk ask and two overnight messages (then his 4:00 PM run reminder). Now no "Morning." past
// midday and never a second one in a day; his morning held past midday goes out as one short current ask, the walk ask
// and the nudges wait 20 minutes after it, and the night's messages go into Talk without a notification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, noteAppOpen, LATE_HELD } from '../server/notify.mjs';
import { openNightly, DIARY } from '../server/coach/nightly.mjs';
import { pastMidday } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-20';
const Y = '2026-03-19';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const hmOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** His Friday: up at 7:05 AM by Settings, knee holds at 9:30 AM, walks on (steps well under goal), nudges every 20 min. */
function friday({ walk = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-noon-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { movingDay: false, wakeHm: '07:05', bedHm: '20:30', nudgeEveryMin: 20, holdsMorning: '09:30', holdsEvening: '21:30', kinds: { walk } },
    body: { stepGoal: 8000 },
  });
  store.writeLocal('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', where: 'home' }], loadsArea: { exercises: [] } });
  // His night before: quiet from 9:00 PM.
  store.writeLocal('coach-messages', 'u0', { id: 'u0', role: 'user', text: 'night', at: at(Y, '21:00') });
  store.writeLocal('health', D, { id: D, date: D, steps: 1414, sleep: null, weights: [], workouts: [], updatedAt: T('13:48') });
  const sent = [];
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  let now = T('06:00');
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  const opens = (hm) => { store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T(hm) }); noteAppOpen(store, T(hm), TZ); };
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant').sort((a, b) => a.at - b.at);
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, opens, talk, done };
}
const list = (xs) => JSON.stringify(xs.map((m) => [hmOf(m.at), m.body ?? m.text]));

test('midday: from 12:00 PM his day is past its morning', () => {
  assert.equal(pastMidday(T('11:59'), TZ), false);
  assert.equal(pastMidday(T('12:00'), TZ), true);
  assert.equal(pastMidday(T('15:57'), TZ), true);
  assert.equal(pastMidday(T('00:30'), TZ), false);
});

test('his Friday replayed: no answer all day, the app opens at 3:57 PM: no "Morning.", one current ask, the walk 20 minutes later', async () => {
  const f = friday();
  try {
    await f.run('07:00', '15:56');
    assert.deepEqual(f.sent.map((m) => [hmOf(m.at), m.body]), [['7:05 AM', 'Morning. Are you up?']], 'held all day');
    // Sleep known (Health), his check-in done: nothing left to ask once he shows up.
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '21:30'), wake: T('06:50'), source: 'coach', at: T('15:00') });
    f.store.writeLocal('days', D, { date: D, readiness: { at: T('15:00') } });
    f.opens('15:57');
    await f.run('15:57', '16:16');
    const late = f.sent.filter((m) => m.at >= T('15:57'));
    assert.equal(late.length, 1, list(late));
    assert.equal(late[0].tag, 'morning-plan');
    assert.equal(hmOf(late[0].at), '3:57 PM');
    assert.match(late[0].body, /^Holds now \(Knees: Toes Wall Squat Hold\)\./);
    // No "Morning." after the 7:05 AM one: not in a notification, not in Talk.
    assert.equal(f.talk().filter((m) => /^Morning\b/.test(m.text)).length, 1, list(f.talk()));
    assert.equal(f.sent.filter((m) => /^Morning\b/.test(m.body)).length, 1);
    // The walk ask comes 20 minutes after the one ask, alone.
    await f.run('16:17', '16:40');
    const walk = f.sent.filter((m) => m.tag === 'walk');
    assert.ok(walk.length >= 1, list(f.sent));
    assert.ok(walk[0].at >= T('15:57') + LATE_HELD.quietMin * 60000, hmOf(walk[0].at));
    assert.ok(f.sent.filter((m) => m.at >= T('15:57') && m.at < T('16:17')).length === 1);
  } finally { f.done(); }
});

test('opened at 11:00 AM after "Morning. Are you up?": the sleep question alone, no second "Morning."', async () => {
  const f = friday({ walk: false });
  try {
    await f.run('07:00', '10:59');
    f.opens('11:00');
    await f.run('11:00', '11:01');
    const greet = f.talk().filter((m) => /^morning:greet/.test(m.ref || ''));
    assert.equal(greet.length, 1);
    assert.equal(greet[0].text, 'How did you sleep? When did you go to bed and when did you wake up?');
  } finally { f.done(); }
});

test('opened at 3:57 PM with nothing to ask: no greeting said at all, and no second one on the next open', async () => {
  const f = friday({ walk: false });
  try {
    await f.run('07:00', '15:56');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '21:30'), wake: T('06:50'), source: 'coach', at: T('15:00') });
    f.store.writeLocal('days', D, { date: D, readiness: { at: T('15:00') } });
    f.opens('15:57');
    await f.run('15:57', '15:58');
    assert.equal(f.talk().some((m) => /^morning:greet/.test(m.ref || '')), false, list(f.talk()));
    f.opens('17:00');
    await f.run('17:00', '17:01');
    assert.equal(f.talk().some((m) => /^Morning\b/.test(m.text) && m.at > T('08:00')), false);
  } finally { f.done(); }
});

test('first open of the day before midday, nothing asked yet: "Morning." as before', async () => {
  const f = friday({ walk: false });
  try {
    f.opens('06:40');
    await f.run('06:40', '06:41');
    assert.match(f.talk()[0].text, /^Morning\. How did you sleep\?/);
  } finally { f.done(); }
});

test('the night\'s message held past midday goes into Talk without a notification; before midday it notifies', async () => {
  for (const [hm, pushed] of [['10:00', 2], ['15:59', 0]]) {
    const dir = mkdtempSync(join(tmpdir(), 'thq-noon-n-'));
    const store = openStore(join(dir, 'db.sqlite'));
    try {
      store.writeLocal('settings', 'main', { notify: { movingDay: false } });
      store.writeLocal('coach-changes', 'chg.a', { id: 'chg.a', at: at(Y, '23:00'), said: 'x', status: 'done', doneAt: T('02:00'), answer: 'Done: the walk ask says its time once.', by: 'nightly' });
      store.writeLocal(DIARY, Y, { id: Y, date: Y, status: 'done', at: T('02:00'), morning: 'Two knee rounds today close the week.', fixes: ['chg.a'] });
      store.writeLocal('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'yo', at: T(hm) - 60000 });
      const sent = [];
      const n = openNightly({ store, privateDir: dir, since: '2026-01-01', profile: () => '', tz: () => TZ, now: () => T(hm),
        push: { list: () => [{}], notify: async (x) => { sent.push(x); return { sent: 1 }; } }, run: async () => ({ text: '{}' }) });
      await n.morning(T(hm));
      const said = store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.kind === 'nightly');
      assert.equal(said.length, 2, `${hm}: both in Talk`);
      assert.equal(sent.length, pushed, `${hm}: ${JSON.stringify(sent)}`);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});
