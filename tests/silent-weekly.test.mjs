// Thu 11/5, from his list of missing features: gone quiet for days = one catch-up a day, not the same asks over and
// over (lib/silent.js); and a weekly report (lib/weekly.js, server/weekly.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAnswerAt, silentNow, openLabels, catchUpText, SILENT } from '../app/js/lib/silent.js';
import { weeklyReport, weekDays } from '../app/js/lib/weekly.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);

test('silent: his last answer counts messages, meals, meal answers, ticks, workouts, sets and walk answers, not the coach', () => {
  const now = at('2026-03-20', '12:00');
  assert.equal(lastAnswerAt({}, now), 0);
  assert.equal(lastAnswerAt({ messages: [{ role: 'assistant', at: at('2026-03-20', '09:00') }, { role: 'user', at: at('2026-03-18', '21:00') }] }, now), at('2026-03-18', '21:00'));
  assert.equal(lastAnswerAt({ meals: [{ at: at('2026-03-19', '08:00') }], sets: [{ done: false, doneAt: at('2026-03-20', '08:00') }] }, now), at('2026-03-19', '08:00'), 'an open set is not him');
  assert.equal(lastAnswerAt({ sessions: [{ status: 'discarded', startedAt: at('2026-03-20', '05:00') }] }, now), 0);
  assert.equal(lastAnswerAt({ walks: [{ plan: { by: 'coach', setAt: at('2026-03-20', '08:00') } }] }, now), 0, 'a walk the coach planned is not his answer');
  assert.equal(lastAnswerAt({ walks: [{ skips: [{ at: at('2026-03-20', '08:00') }] }] }, now), at('2026-03-20', '08:00'));
  assert.equal(lastAnswerAt({ days: [{ date: '2026-03-20', sessionTime: '05:00', timeSetAt: at('2026-03-19', '22:00') }] }, now), at('2026-03-19', '22:00'), 'setting a session time is an answer');
});

test('silent: after two days with no answer; never before he has answered anything', () => {
  const last = at('2026-03-19', '10:00');
  assert.equal(silentNow(last, last + (SILENT.afterH * 3600000) - 60000), null);
  assert.deepEqual(silentNow(last, last + SILENT.afterH * 3600000), { since: last, hours: SILENT.afterH });
  assert.equal(SILENT.afterH, 48, 'two days');
  assert.equal(silentNow(0, at('2026-03-20', '10:00')), null);
});

test('silent: the catch-up says since when and what is open, once a label, his workout first', () => {
  assert.deepEqual(openLabels(['meals', 'cook', 'supps', 'holds', 'evening', 'meals'], ['Legs', 'walk']), ['Legs', 'walk', 'food', 'supplements', 'holds']);
  assert.equal(catchUpText({ since: at('2026-10-28', '21:57'), open: ['Legs', 'food'], tz: TZ }),
    'No answer from you since Wednesday 10/28, 9:57 PM. Still open today: Legs, food. One message a day till you\'re back: answer anything and I pick up from there.');
  assert.doesNotMatch(catchUpText({ since: at('2026-10-28', '21:57'), open: [], tz: TZ }), /Still open/);
});

async function mac(fn) {
  const { openStore } = await import('../server/store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-silent-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try { await fn(store); } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
}

test('silent, on the Mac: a quiet day sends one catch-up, no meal chases, walk or nudges; his own reminder still on time; his answer ends it', async () => {
  const { startNotifier } = await import('../server/notify.mjs');
  await mac(async (store) => {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '07:00', bedHm: '23:00' }, fuel: { mealTimes: [{ name: 'Breakfast', time: '09:00' }] } });
    store.writeLocal('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'ok', at: at('2026-03-17', '21:00'), tz: TZ });
    store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: at('2026-03-20', '07:05') });
    // His morning questions held off (as on a day the morning gate is through): the day's own asks are what's left.
    store.writeLocal('coach-holds', 'h', { id: 'h', areas: ['sleep'], until: at('2026-04-01', '00:00'), at: at('2026-03-17', '21:00') });
    store.writeLocal('coach-reminders', 'r1', { id: 'r1', text: 'Call the dentist', at: at('2026-03-20', '15:00'), createdAt: at('2026-03-17', '21:00') });
    let now = at('2026-03-20', '07:00');
    const sent = [];
    const push = { list: () => [{ deviceId: 'a1b2c3d4e5f6' }], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
    const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
    n.stop();
    for (let t = at('2026-03-20', '07:00'); t <= at('2026-03-20', '22:00'); t += 5 * 60000) { now = t; await n.tick(); }
    const bodies = sent.map((m) => m.body);
    const catchUps = bodies.filter((b) => /^No answer from you since Tuesday 3\/17, 9:00 PM\./.test(b));
    assert.equal(catchUps.length, 1, `one catch-up: ${JSON.stringify(bodies)}`);
    assert.ok(bodies.some((b) => /Call the dentist/.test(b)), 'his own reminder still goes out');
    assert.ok(!bodies.some((b) => /haven't heard from you|Still nothing|Last check/i.test(b)), `no chases: ${JSON.stringify(bodies)}`);
    const rest = bodies.filter((b) => !/^No answer from you|Call the dentist|^Morning\.|sleep|bed|body feel|back|knees/i.test(b));
    assert.deepEqual(rest, [], 'nothing else: no meal, walk, holds, supplements or nudges one by one');
    assert.ok(store.listRecords('coach-messages').some((r) => r.data?.ref === 'silent:2026-03-20'), 'in Talk too');
    // Next day: one more catch-up, not two.
    sent.length = 0;
    for (let t = at('2026-03-21', '07:00'); t <= at('2026-03-21', '12:00'); t += 10 * 60000) { now = t; await n.tick(); }
    assert.equal(sent.filter((m) => /^No answer from you/.test(m.body)).length, 1);
    // He answers: the app's own asks are back.
    store.writeLocal('coach-messages', 'u2', { id: 'u2', role: 'user', text: 'back', at: at('2026-03-21', '12:05'), tz: TZ });
    const { silentOf } = await import('../server/notify.mjs');
    assert.equal(silentOf(store, at('2026-03-21', '12:10')), null);
  });
});

test('weekly: workouts per day type, top sets against the week before, food and protein, sleep, scans, pain in his words', () => {
  const s = (id, date, dayType, exercises, extra = {}) => ({ id, kind: 'workout', status: 'done', dayType, startedAt: at(date, '05:00'), exercises, ...extra });
  const sessions = [
    s('a', '2026-03-10', 'legs', [{ key: 'k1', name: 'Seated Leg Curl (Machine)' }]),
    s('b', '2026-03-17', 'legs', [{ key: 'k1', name: 'Seated Leg Curl (Machine)' }, { key: 'k2', name: 'Squat (Smith Machine)', skipped: { reason: 'Lower back pain' } }]),
    s('c', '2026-03-19', 'pull', [{ key: 'k3', name: 'Lat Pulldown (Cable)' }]),
    { id: 'h', kind: 'holds', status: 'done', startedAt: at('2026-03-18', '09:00'), exercises: [] },
  ];
  const sets = [
    { sessionId: 'a', exKey: 'k1', done: true, kg: 36, reps: 12, type: 'normal' },
    { sessionId: 'b', exKey: 'k1', done: true, kg: 36, reps: 12, type: 'normal' },
    { sessionId: 'b', exKey: 'k1', done: true, kg: 20, reps: 8, type: 'warmup' },
    { sessionId: 'c', exKey: 'k3', done: true, kg: 50, reps: 10, type: 'normal', note: 'elbow hurts a bit' },
  ];
  const meals = [{ date: '2026-03-17', at: at('2026-03-17', '09:00'), items: [{ kcal: 1000, protein: 80 }] }];
  const r = weeklyReport({ end: '2026-03-22', tz: TZ, sessions, sets, meals, targets: { kcal: 3174, proteinG: 242.5 },
    sleeps: [{ date: '2026-03-18', asleepMin: 480 }, { date: '2026-03-19', asleepMin: 420 }],
    scans: [{ date: '2026-03-17', status: 'done', metrics: [{ key: 'weightKg', value: 75.1 }] }, { date: '2026-03-10', status: 'done', metrics: [{ key: 'weightKg', value: 74.5 }] }] });
  assert.deepEqual(weekDays('2026-03-22'), ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22']);
  assert.match(r.text, /^Week Monday 3\/16 to Sunday 3\/22\./);
  assert.match(r.text, /Workouts: 2 \(Legs 1, Pull 1\); the week before: 1\./, 'holds rounds are not workouts');
  assert.match(r.text, /- Seated Leg Curl \(Machine\): 36 kg × 12 \(same as the week before\)/);
  assert.match(r.text, /- Lat Pulldown \(Cable\): 50 kg × 10 \(not done the week before\)/);
  assert.match(r.text, /Food: 1 of 7 days logged, average [\d,]+ of 3,174 kcal and [\d.]+ of 242.5 g protein a logged day\./);
  assert.match(r.text, /Sleep: 2 nights logged, average 7 h 30 min\./);
  assert.match(r.text, /Body scans: 1, average weight 75.1 kg \(\+0.6 kg\) against the week before\./);
  assert.match(r.text, /Pain written down: 2\./);
  assert.match(r.text, /Squat \(Smith Machine\): "Lower back pain"/);
  assert.doesNotMatch(r.text, /should|try to|recommend|consider/i, 'no advice');
  assert.match(r.short, /^Your week: 2 workouts, food 1 of 7 days logged, sleep 2 nights logged\. The full report is in Talk\.$/);
});

test('weekly, on the Mac: Sunday from 7:00 PM, once, into Talk; not on another day; off with its switch', async () => {
  const { weeklyTick } = await import('../server/weekly.mjs');
  await mac(async (store) => {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '07:00', bedHm: '23:00' } });
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1 }; } };
    // 2026-03-22 is a Sunday.
    assert.equal(await weeklyTick({ store, push, now: at('2026-03-22', '18:59'), tz: TZ }), null);
    assert.equal(await weeklyTick({ store, push, now: at('2026-03-21', '19:30'), tz: TZ }), null, 'Saturday');
    const r = await weeklyTick({ store, push, now: at('2026-03-22', '19:00'), tz: TZ });
    assert.equal(r.key, 'weekly:2026-03-22');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].tag, 'weekly');
    assert.ok(store.listRecords('coach-messages').some((x) => x.data?.kind === 'weekly' && /^Week Monday 3\/16 to Sunday 3\/22\./.test(x.data.text)));
    assert.equal(await weeklyTick({ store, push, now: at('2026-03-22', '20:00'), tz: TZ }), null, 'once');
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '07:00', bedHm: '23:00', kinds: { weekly: false } } });
    assert.equal(await weeklyTick({ store, push, now: at('2026-03-29', '19:30'), tz: TZ }), null, 'off');
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '07:00', bedHm: '23:00', weekly: { weekday: 1, hm: '08:00' } } });
    assert.equal((await weeklyTick({ store, push, now: at('2026-03-30', '08:05'), tz: TZ }))?.key, 'weekly:2026-03-30', 'his own day and time');
  });
});
