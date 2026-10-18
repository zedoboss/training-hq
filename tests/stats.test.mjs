import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, weekStartOf, addMonths, setRows, muscleSets, weeklyMuscleSets, weeklyVolume, periodRange, totals, distribution, changePct, monthReport,
} from '../app/js/lib/stats.js';

const TZ = 'Asia/Ho_Chi_Minh';
const lib = new Map([
  ['bench', { primary: 'chest', secondary: ['triceps', 'shoulders'] }],
  ['curl', { primary: 'biceps', secondary: [] }],
  ['pullup', { primary: 'lats', secondary: ['biceps'] }],
]);
// 4:30 AM local on the given date = 21:30 UTC the day before.
const at = (iso) => Date.parse(`${iso}T04:30:00+07:00`);
const session = (id, iso, exercises, extra = {}) => ({ id, status: 'done', kind: 'workout', startedAt: at(iso), endedAt: at(iso) + 3600000, pausedMs: 0, title: 'Push', dayType: 'push', exercises, ...extra });
const set = (sessionId, exKey, kg, reps, type = 'normal', done = true) => ({ sessionId, exKey, kg, reps, type, done });

const sessions = [
  session('a', '2026-10-12', [{ key: 'b', exerciseId: 'bench', name: 'Bench', type: 'weight_reps' }, { key: 'c', exerciseId: 'curl', name: 'Curl', type: 'weight_reps' }]),
  session('b', '2026-10-17', [{ key: 'b', exerciseId: 'bench', name: 'Bench', type: 'weight_reps' }, { key: 'p', exerciseId: 'pullup', name: 'Pull Up', type: 'weighted_bodyweight' }], { dayType: 'pull' }),
  session('c', '2026-09-20', [{ key: 'b', exerciseId: 'bench', name: 'Bench', type: 'weight_reps' }]),
  { ...session('x', '2026-10-16', [{ key: 'b', exerciseId: 'bench', name: 'Bench' }]), status: 'discarded' },
  { ...session('h', '2026-10-16', [{ key: 'b', exerciseId: 'bench', name: 'Bench' }]), kind: 'holds' },
];
const sets = [
  set('a', 'b', 20, 10, 'warmup'), set('a', 'b', 50, 8), set('a', 'b', 50, 8), set('a', 'c', 15, 12), set('a', 'c', 15, 12, 'normal', false),
  set('a', 'b', 30, 10, 'hold'),
  set('b', 'b', 55, 8), set('b', 'p', 0, 10), set('b', 'p', 5, 6),
  set('c', 'b', 45, 10),
  set('x', 'b', 99, 1), set('h', 'b', 31, 1),
];

test('week starts follow the Settings first day', () => {
  assert.equal(weekStartOf('2026-10-17', 1), '2026-10-12', 'Saturday -> Monday');
  assert.equal(weekStartOf('2026-10-17', 0), '2026-10-11', 'Saturday -> Sunday');
  assert.equal(weekStartOf('2026-10-17', 6), '2026-10-17', 'Saturday starts the week');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('set rows: only ticked sets of finished workouts; holds never, warm-ups only when asked; local dates', () => {
  const rows = setRows({ sessions, sets, lib, tz: TZ });
  assert.equal(rows.length, 7);
  assert.equal(rows[0].date, '2026-10-12', 'the local date, not the UTC one');
  assert.equal(setRows({ sessions, sets, lib, tz: TZ, countWarmups: true }).length, 8);
  assert.equal(setRows({ sessions, sets, lib, tz: TZ, countWarmups: true }).find((r) => r.warmup).volume, 0, 'warm-ups never add volume');
});

test('sets per muscle: primary 1, secondary 0.5', () => {
  const rows = setRows({ sessions, sets, lib, tz: TZ });
  assert.deepEqual(muscleSets(rows.filter((r) => r.sessionId === 'a')), { chest: 2, triceps: 1, shoulders: 1, biceps: 1 });
  const weeks = weeklyMuscleSets(rows, { weeks: 2, today: '2026-10-17', firstDay: 1 });
  assert.deepEqual(weeks.map((w) => w.start), ['2026-10-05', '2026-10-12']);
  assert.deepEqual(weeks[1].muscles, { chest: 3, triceps: 1.5, shoulders: 1.5, biceps: 2, lats: 2 });
  assert.deepEqual(weeks[0].muscles, {});
});

test('volume: weight x reps; weighted pull-ups count the added load until bodyweight comes from Apple Health', () => {
  const rows = setRows({ sessions, sets, lib, tz: TZ });
  const v = weeklyVolume(rows, { weeks: 6, today: '2026-10-17', firstDay: 1 });
  assert.equal(v.at(-1).volume, 50 * 8 * 2 + 15 * 12 + 55 * 8 + 0 * 10 + 5 * 6);
  assert.equal(v.find((w) => w.start === '2026-09-14').volume, 450);
});

test('periods, totals and distribution against the previous period', () => {
  const rows = setRows({ sessions, sets, lib, tz: TZ });
  const p = periodRange('4w', '2026-10-17');
  assert.deepEqual(p, { from: '2026-09-20', to: '2026-10-18', prevFrom: '2026-08-23', prevTo: '2026-09-20', days: 28 });
  const t = totals(sessions, rows, p.from, p.to, TZ);
  assert.deepEqual(t, { sessions: 3, durationMs: 3 * 3600000, volume: 800 + 180 + 440 + 30 + 450, sets: 7 });
  const d = distribution(rows, periodRange('4w', '2026-10-15'));
  assert.equal(d[0].muscle, 'chest');
  assert.deepEqual(distribution(rows, { from: '2026-10-12', to: '2026-10-19', prevFrom: '2026-09-14', prevTo: '2026-10-12' }).find((x) => x.muscle === 'chest'), { muscle: 'chest', now: 3, before: 1 });
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(5, 0), null);
});

test('monthly report: sessions, totals vs last month, top exercises, bests above everything before', () => {
  const rows = setRows({ sessions, sets, lib, tz: TZ });
  const m = monthReport({ sessions, rows, month: '2026-10', tz: TZ });
  assert.deepEqual(m.sessions.map((s) => [s.date, s.dayType]), [['2026-10-12', 'push'], ['2026-10-17', 'pull']]);
  assert.equal(m.totals.sessions, 2);
  assert.equal(m.previous.sessions, 1);
  assert.deepEqual(m.topExercises[0], { name: 'Bench', sets: 3 });
  assert.deepEqual(m.bests, [{ name: 'Bench', kg: 55, previous: 45 }], 'curl and pull-up were new this month: not bests');
});

test('most-logged exercises in a period', async () => {
  const { topExercises } = await import('../app/js/lib/stats.js');
  const rows = [
    { date: '2026-10-12', name: 'Bench', exerciseId: 'bench', sessionId: 'a' }, { date: '2026-10-12', name: 'Bench', exerciseId: 'bench', sessionId: 'a' },
    { date: '2026-10-17', name: 'Bench', exerciseId: 'bench', sessionId: 'b' }, { date: '2026-10-17', name: 'Curl', exerciseId: 'curl', sessionId: 'b' },
    { date: '2026-09-01', name: 'Curl', exerciseId: 'curl', sessionId: 'c' }, { date: '2026-09-01', name: 'Curl', exerciseId: 'curl', sessionId: 'c' },
  ];
  assert.deepEqual(topExercises(rows, '2026-10-01', '2026-10-19'), [{ name: 'Bench', exerciseId: 'bench', sets: 3, sessions: 2 }, { name: 'Curl', exerciseId: 'curl', sets: 1, sessions: 1 }]);
  assert.deepEqual(topExercises(rows, '2026-08-01', '2026-10-19', 1).map((x) => x.name), ['Bench']);
});
