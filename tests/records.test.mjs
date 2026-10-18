import { test } from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, family, metricsFor, sessionPoints, inRange, records, repRecords, clockText } from '../app/js/lib/records.js';

const set = (kg, reps, type = 'normal', extra = {}) => ({ type, kg, reps, durationS: null, distanceM: null, hold: type === 'hold', ...extra });
const entry = (date, sets, extra = {}) => ({ date, at: Date.parse(`${date}T05:00:00+07:00`), sessionId: `s-${date}`, source: 'training-hq', title: 'Legs', sets, ...extra });
// Newest first, as history.all() gives them.
const entries = [
  entry('2026-10-10', [set(20, 10, 'warmup'), set(45, 8), set(45, 8), set(100, 1, 'hold')]),
  entry('2026-10-02', [set(40, 12), set(40, 12)]),
  entry('2024-05-01', [set(100, 3), set(90, 8), set(70, 12, 'dropset')], { source: 'hevy' }),
  entry('2023-01-15', [set(80, 8)], { source: 'strong' }),
  entry('2022-12-01', [set(20, 10, 'warmup')]),
];

test('Epley 1RM for 1 to 12 reps only', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(90, 8), 114);
  assert.equal(e1rm(60, 12), 84);
  assert.equal(e1rm(60, 13), null);
  assert.equal(e1rm(0, 5), null);
});

test('exercise types map to their chart family', () => {
  assert.equal(family('weight_reps'), 'weight');
  assert.equal(family(undefined), 'weight');
  assert.equal(family('weighted_bodyweight'), 'weighted_bw');
  assert.equal(family('assisted_bodyweight'), 'bodyweight');
  assert.equal(family('distance_duration'), 'cardio');
  assert.deepEqual(metricsFor('reps_only').map((m) => m.key), ['mostReps', 'reps']);
});

test('one point per session with working sets, oldest first; warm-ups and holds never count', () => {
  const p = sessionPoints(entries);
  assert.deepEqual(p.map((x) => x.date), ['2023-01-15', '2024-05-01', '2026-10-02', '2026-10-10']);
  const old = p[1];
  assert.equal(old.heaviest, 100);
  assert.equal(old.e1rm, 114, '90 × 8 beats 100 × 3 (110)');
  assert.deepEqual([old.e1rmSet.kg, old.e1rmSet.reps], [90, 8]);
  assert.equal(old.bestSet, 840);
  assert.equal(old.volume, 300 + 720 + 840);
  assert.equal(old.reps, 23);
  assert.equal(old.source, 'hevy');
  const last = p[3];
  assert.equal(last.heaviest, 45, 'the 100 kg hold is not the heaviest');
  assert.equal(last.volume, 720);
  assert.equal(last.e1rm, 57);
});

test('bodyweight volume adds the session bodyweight when it is known', () => {
  const pu = [entry('2026-10-04', [set(0, 8), set(5, 6)], { bodyweightKg: 80 }), entry('2023-10-10', [set(0, 10)])];
  const p = sessionPoints(pu, 'weighted_bodyweight');
  assert.equal(p[0].volume, 0, 'no bodyweight on record: added weight only');
  assert.equal(p[1].volume, 80 * 8 + 85 * 6);
  assert.equal(p[1].mostReps, 8);
  assert.equal(p[1].heaviest, 5);
});

test('ranges end today', () => {
  const p = sessionPoints(entries);
  assert.deepEqual(inRange(p, '3m', '2026-10-18').map((x) => x.date), ['2026-10-02', '2026-10-10']);
  assert.deepEqual(inRange(p, '1y', '2026-10-18').map((x) => x.date), ['2026-10-02', '2026-10-10']);
  assert.equal(inRange(p, 'all', '2026-10-18').length, 4);
  assert.deepEqual(inRange(p, '3m', '2024-06-01').map((x) => x.date), ['2024-05-01']);
});

test('records per type, held by the first session to reach them', () => {
  const p = sessionPoints([entry('2026-01-01', [set(100, 3)]), ...entries]);
  const r = Object.fromEntries(records(p).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(r), ['heaviest', 'e1rm', 'bestSet', 'volume']);
  assert.equal(r.heaviest.value, 100);
  assert.equal(r.heaviest.date, '2024-05-01', 'the 2026 tie does not take it');
  assert.equal(r.e1rm.value, 114);
  assert.deepEqual([r.bestSet.set.kg, r.bestSet.set.reps], [70, 12], 'a drop set is a working set');
  assert.equal(r.volume.value, 1860);
  assert.equal(r.volume.sessionId, 's-2024-05-01');
  assert.deepEqual(records([], 'weight_reps'), []);
});

test('cardio records: best pace is the lowest', () => {
  const runs = [entry('2026-10-01', [set(null, null, 'normal', { distanceM: 5000, durationS: 1500 })]), entry('2026-09-01', [set(null, null, 'normal', { distanceM: 3000, durationS: 840 })])];
  const p = sessionPoints(runs, 'distance_duration');
  assert.deepEqual(p.map((x) => [x.distance, x.pace]), [[3, 280], [5, 300]]);
  const r = Object.fromEntries(records(p, 'distance_duration').map((x) => [x.key, x.value]));
  assert.deepEqual(r, { distance: 5, time: 1500, pace: 280 });
  assert.equal(clockText(280), '4:40');
});

test('best weight for each rep count, as logged', () => {
  const r = repRecords(entries);
  assert.deepEqual(r.map((x) => [x.reps, x.kg, x.date]), [[3, 100, '2024-05-01'], [8, 90, '2024-05-01'], [12, 70, '2024-05-01']]);
});

test('session bests: only sessions before this one count; comeback and all-time', async () => {
  const { sessionBests } = await import('../app/js/lib/finish.js');
  const { buildHistory } = await import('../app/js/lib/history.js');
  const at = (iso) => Date.parse(`${iso}T05:00:00+07:00`);
  const ses = (id, iso, source = 'training-hq') => ({ id, status: 'done', kind: 'workout', title: 'Legs', startedAt: at(iso), endedAt: at(iso) + 3600000, source, exercises: [{ key: 'k', name: 'Squat', type: 'weight_reps' }] });
  const sessions = [ses('old', '2024-01-10', 'hevy'), ses('old2', '2024-02-10', 'hevy'), ses('c1', '2026-10-02'), ses('c2', '2026-10-10'), ses('c3', '2026-10-14')];
  const sets = [
    { sessionId: 'old', exKey: 'k', kg: 100, reps: 8, type: 'normal', done: true, order: 1 },
    { sessionId: 'old2', exKey: 'k', kg: 105, reps: 6, type: 'normal', done: true, order: 1 },
    { sessionId: 'c1', exKey: 'k', kg: 40, reps: 12, type: 'normal', done: true, order: 1 },
    { sessionId: 'c2', exKey: 'k', kg: 45, reps: 8, type: 'normal', done: true, order: 1 },
    { sessionId: 'c3', exKey: 'k', kg: 50, reps: 8, type: 'normal', done: true, order: 1 },
  ];
  const h = buildHistory({ sessions, sets });
  const of = (id, o) => sessionBests(sessions.find((s) => s.id === id), sets.filter((x) => x.sessionId === id), h, { comebackStart: '2026-09-20', tz: 'Asia/Bangkok', ...o });
  assert.deepEqual(of('c2', { fullHistory: true }).map((b) => [b.kg, b.kind, b.previous]), [[45, 'comeback', 40]], 'the later 50 kg does not count');
  assert.deepEqual(of('c1', { fullHistory: true }), [], 'first comeback session: nothing since the comeback to beat, and below the 2024 numbers');
  assert.deepEqual(of('old2', { fullHistory: true }).map((b) => [b.kg, b.kind, b.previous]), [[105, 'all-time', 100]]);
  assert.deepEqual(of('old2', { fullHistory: false }), [], 'no all-time claim without the full history');
  assert.deepEqual(of('old', { fullHistory: true }), [], 'first-ever session');
});

test('the comeback start comes from the programme data, not the code', async () => {
  const { comebackStartOf } = await import('../app/js/lib/finish.js');
  assert.equal(comebackStartOf({ firstSessions: { pull: '2026-03-05', push: '2026-03-07', legs: '2026-03-08', source: 'a note' } }), '2026-03-05');
  assert.equal(comebackStartOf(null), null);
  assert.equal(comebackStartOf({ firstSessions: { source: 'x' } }), null);
});
