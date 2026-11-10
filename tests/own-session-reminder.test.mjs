// Tue 11/10, his words at 11:20 AM: "I will go at 12:30 only remind me 10m before". The coach promised "one message at
// 12:20 PM" and set it. He got two training messages at 12:20 PM (his "Heading out?" and the check-in held till then),
// the session's own reminder at 12:30 PM, and at 12:50 PM a check-in still saying "at 12:30 PM". He wants: when he asks
// for one reminder before a session, exactly that one; the check-in waits till he says he's leaving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, ownSessionReminder, coveredSessionAsks, waitsForOwnSession, OWN_SESSION_LATE_MIN } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const Y = '2026-03-16';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const OFF = { walk: false, scan: false, holds: false, supps: false, meals: false, evening: false, neck: false, dishes: false, flex: false, combat: false, recovery: false, weekly: false, sauna: false };

/** His day: session 12:30 PM set at 11:20 AM; `own` = his reminder text at 12:20 PM (null: none); `say` = his messages. */
async function replay({ own = 'Upper A at 12:30 PM, 10 minutes. Heading out?', ownAt = '12:20', hold = true, say = {}, start = null, to = '13:45' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-own-session-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '08:00', bedHm: '23:00', nudgeEveryMin: 20, kinds: OFF } });
    store.setMeta('morning:state', { date: D, open: at('08:00') });
    store.writeLocal('sessions', 'push', { id: 'push', kind: 'workout', dayType: 'push', status: 'done', startedAt: at('10:00', Y), endedAt: at('11:00', Y), exercises: [] });
    store.writeLocal('days', D, { date: D, sessionTime: '12:30', timeSetAt: at('11:20') });
    if (own) store.writeLocal('coach-reminders', 'r1', { id: 'r1', at: at(ownAt), date: D, hm: ownAt, text: own, createdAt: at('11:20'), by: 'coach' });
    if (hold) store.writeLocal('coach-holds', 'h1', { id: 'h1', areas: ['training'], until: at(ownAt), reason: 'I will go at 12:30 only remind me 10m before', at: at('11:20') });
    let now = at('11:20');
    const sent = [];
    const push = { list: () => [{ deviceId: 'a1b2c3d4e5f6' }], notify: async (m) => { sent.push({ at: now, tag: m.tag || '', body: m.body }); return { sent: 1, failed: 0, dropped: 0 }; } };
    const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
    n.stop();
    for (; now <= at(to); now += 60000) {
      for (const [hm, text] of Object.entries(say)) if (now === at(hm)) store.writeLocal('coach-messages', `u${hm}`, { id: `u${hm}`, role: 'user', text, at: now });
      if (start && now === at(start)) store.writeLocal('sessions', 'w', { id: 'w', kind: 'workout', dayType: 'pull', status: 'active', startedAt: now, exercises: [] });
      await n.tick();
    }
    const training = sent.filter((m) => /^(coach-r1|readiness-|session-|nudge-(checkin|session))/.test(m.tag));
    return { sent, training, txt: sent.map((m) => `${hmOf(m.at)} [${m.tag}] ${m.body}`).join(' | ') };
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('his Tuesday, never answering: one message, his, at 12:20 PM; nothing more till an hour past the session time', async () => {
  const r = await replay({ to: '13:29' });
  assert.deepEqual(r.training.map((m) => `${hmOf(m.at)} ${m.tag}`), ['12:20 PM coach-r1'], r.txt);
  assert.match(r.training[0].body, /Heading out\?/);
});

test('he says he is leaving at 12:22 PM: the check-in follows (then its usual 20-minute follow-ups), never naming a passed time', async () => {
  const r = await replay({ say: { '12:22': 'Heading out now' }, to: '12:59' });
  const checks = r.training.filter((m) => m.tag !== 'coach-r1');
  assert.equal(r.training[0].tag, 'coach-r1');
  assert.equal(checks.length, 1, r.txt);
  assert.equal(checks[0].tag, 'nudge-checkin');
  assert.ok(checks[0].at > at('12:22'), r.txt);
  assert.match(checks[0].body, /^Sore, or good to go\?/);
  assert.doesNotMatch(checks[0].body, /at 12:30 PM/, 'past 12:30 PM it says "now"');
  assert.match(checks[0].body, /now/);
});

test('his real 12:30 PM ("about to go to the gym"): only then the check-in, saying now, not "at 12:30 PM"', async () => {
  const r = await replay({ say: { '12:30': "I'm literally about to go to the gym" }, to: '12:59' });
  assert.deepEqual(r.training.map((m) => m.tag), ['coach-r1', 'nudge-checkin'], r.txt);
  assert.ok(r.training[1].at > at('12:30'), r.txt);
  assert.doesNotMatch(r.training[1].body, /12:30/);
  assert.match(r.training[1].body, /^Sore, or good to go\? \w+ now\./);
});

test('he starts the workout without answering: nothing more about the session', async () => {
  const r = await replay({ start: '12:40', to: '14:00' });
  assert.deepEqual(r.training.map((m) => m.tag), ['coach-r1'], r.txt);
});

test('no hold-off from the coach, only his reminder: the 12:00 PM check-in waits for him too', async () => {
  const r = await replay({ hold: false, to: '13:29' });
  assert.deepEqual(r.training.map((m) => `${hmOf(m.at)} ${m.tag}`), ['12:20 PM coach-r1'], r.txt);
});

test('the cases around it: no reminder of his, or one about something else, keep the usual check-in and session reminder', async () => {
  const planned = (r) => r.training.filter((m) => !m.tag.startsWith('nudge-'));
  const none = await replay({ own: null, hold: false, to: '12:35' });
  assert.deepEqual(planned(none).map((m) => `${hmOf(m.at)} ${m.tag}`), ['12:00 PM readiness-2026-03-17', '12:30 PM session-2026-03-17'], none.txt);
  assert.ok(none.training.some((m) => m.tag === 'nudge-session'), 'and the usual session nudge before it');
  const other = await replay({ own: 'Take the trash out', hold: false, to: '12:35' });
  assert.deepEqual(planned(other).map((m) => m.tag), ['readiness-2026-03-17', 'coach-r1', 'session-2026-03-17'], other.txt);
  // One for the evening, long after the session: not the reminder before it.
  const late = await replay({ own: 'Gym bag in the wash', ownAt: '19:00', hold: false, to: '12:35' });
  assert.deepEqual(planned(late).map((m) => m.tag), ['readiness-2026-03-17', 'session-2026-03-17'], late.txt);
});

test('the pieces', () => {
  const items = [
    { id: `readiness:${D}`, kind: 'readiness', at: at('12:00'), sessionAt: at('12:30'), due: true },
    { id: `session:${D}`, kind: 'session', at: at('12:30'), due: true },
    { id: 'coach:r1', kind: 'coach', at: at('12:20'), body: 'Upper A at 12:30 PM, 10 minutes. Heading out?', due: true },
  ];
  const own = ownSessionReminder(items, D, {});
  assert.deepEqual(own, { id: 'coach:r1', at: at('12:20'), sentAt: null, sessionAt: at('12:30') });
  assert.equal(ownSessionReminder(items.map((i) => (i.kind === 'coach' ? { ...i, due: false } : i)), D), null, 'cancelled: no longer his');
  assert.equal(ownSessionReminder(items.map((i) => (i.kind === 'coach' ? { ...i, trigger: 'session-start' } : i)), D), null, 'a reminder for when he starts: not one before it');
  assert.equal(ownSessionReminder(items.map((i) => (i.kind === 'coach' ? { ...i, at: at('10:00') } : i)), D), null, 'more than 2 hours before: not the one before it');
  assert.deepEqual([...coveredSessionAsks(items.slice(0, 2), items).keys()], [`readiness:${D}`, `session:${D}`]);
  const sentOwn = { ...own, sentAt: at('12:20') };
  assert.equal(waitsForOwnSession(`checkin:readiness-${D}`, own, { now: at('12:10') }), true, 'his reminder not out yet');
  assert.equal(waitsForOwnSession(`checkin:readiness-${D}`, sentOwn, { now: at('12:40'), lastUserAt: at('11:20') }), true, 'out, no answer since');
  assert.equal(waitsForOwnSession(`checkin:readiness-${D}`, sentOwn, { now: at('12:40'), lastUserAt: at('12:22') }), false, 'he answered');
  assert.equal(waitsForOwnSession('session', sentOwn, { now: at('12:30') + (OWN_SESSION_LATE_MIN - 1) * 60000 }), true);
  assert.equal(waitsForOwnSession('session', sentOwn, { now: at('12:30') + OWN_SESSION_LATE_MIN * 60000 }), false, 'an hour late: the usual "was due at"');
  assert.equal(waitsForOwnSession('food', sentOwn, { now: at('12:40') }), false, 'nothing else waits');
  assert.equal(waitsForOwnSession('session', null, { now: at('12:40') }), false);
});
