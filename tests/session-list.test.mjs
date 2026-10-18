import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionRows, filterRows, byMonth, sourceCounts } from '../app/js/lib/session-list.js';
import { buildHistory, activeBridge } from '../app/js/lib/history.js';
import { roundsByDate } from '../app/js/lib/holds.js';
import { typicalDurationMs } from '../app/js/lib/session.js';
import { previousSame } from '../app/js/lib/finish.js';
import { isoDate } from '../app/js/lib/time.js';

const TZ = 'Asia/Bangkok';
const at = (iso, hm = '12:00') => Date.parse(`${iso}T${hm}:00+07:00`);
const ex = (key, name, extra = {}) => ({ key, name, type: 'weight_reps', ...extra });
const s = (id, iso, extra = {}) => ({ id, status: 'done', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at(iso), endedAt: at(iso) + 60 * 60000, pausedMs: 0, exercises: [], ...extra });

const sessions = [
  s('h1', '2023-10-10', { source: 'hevy', title: 'Pull+', dayType: 'pull', exercises: [ex('a', 'Pull Up (Weighted)', { type: 'weighted_bodyweight' }), ex('b', 'Squat (Smith Machine)', { importedName: 'Smith Machine Squat' })] }),
  s('s1', '2022-11-09', { source: 'strong', title: 'Upper 1', dayType: null, exercises: [ex('a', 'Bench Press (Barbell)')] }),
  s('t1', '2026-10-17', { exercises: [ex('a', 'Squat (Smith Machine)'), ex('b', 'Leg Extension (Machine)')] }),
  s('t2', '2026-10-18', { status: 'active' }),
  s('hold', '2026-10-17', { kind: 'holds', title: 'Knees holds' }),
];
const sets = [
  { sessionId: 'h1', exKey: 'a', type: 'normal', kg: 0, reps: 8, done: true },
  { sessionId: 'h1', exKey: 'b', type: 'normal', kg: 40, reps: 10, done: true },
  { sessionId: 's1', exKey: 'a', type: 'normal', kg: 60, reps: 5, done: true },
  { sessionId: 't1', exKey: 'a', type: 'warmup', kg: 20, reps: 10, done: true },
  { sessionId: 't1', exKey: 'a', type: 'normal', kg: 50, reps: 8, done: true },
  { sessionId: 't1', exKey: 'b', type: 'normal', kg: 30, reps: 12, done: false },
];

test('session rows: finished workouts newest first, with source, sets, volume and only exercises with ticked sets', () => {
  const rows = sessionRows({ sessions, sets, tz: TZ });
  assert.deepEqual(rows.map((r) => r.id), ['t1', 'h1', 's1']);
  const t1 = rows[0];
  assert.equal(t1.source, 'training-hq');
  assert.equal(t1.date, '2026-10-17');
  assert.equal(t1.sets, 1, 'warm-ups and unticked sets are not counted');
  assert.equal(t1.volume, 400);
  assert.equal(t1.durationMs, 3600000);
  assert.deepEqual(t1.exercises, ['Squat (Smith Machine)'], 'leg extension had no ticked set');
  assert.deepEqual(rows[1].also, ['Smith Machine Squat']);
  assert.deepEqual(sourceCounts(rows), { all: 3, 'training-hq': 1, hevy: 1, strong: 1 });
});

test('search by exercise matches every word, in the Training HQ name or the imported name', () => {
  const rows = sessionRows({ sessions, sets, tz: TZ });
  assert.deepEqual(filterRows(rows, { q: 'squat' }).map((r) => r.id), ['t1', 'h1']);
  assert.deepEqual(filterRows(rows, { q: 'SMITH squat' }).map((r) => r.hits), [['Squat (Smith Machine)'], ['Squat (Smith Machine)', 'Smith Machine Squat']]);
  assert.deepEqual(filterRows(rows, { q: 'machine smith squat' }).map((r) => r.id), ['t1', 'h1']);
  assert.deepEqual(filterRows(rows, { q: 'squat', source: 'hevy' }).map((r) => r.id), ['h1']);
  assert.deepEqual(filterRows(rows, { q: 'deadlift' }), []);
  assert.equal(filterRows(rows, {}).length, 3);
  assert.equal(filterRows(rows, { q: '  ' })[0].hits, undefined);
});

test('rows are grouped by month in order', () => {
  const g = byMonth(sessionRows({ sessions, sets, tz: TZ }));
  assert.deepEqual(g.map((x) => [x.month, x.rows.length]), [['2026-10', 1], ['2023-10', 1], ['2022-11', 1]]);
});

test('the Hevy bridge steps aside once Hevy history is imported', () => {
  const bridge = { sessionCount: 361, lastSessions: [{ dayType: 'legs', start: '2026-10-10T04:53:00+07:00', end: '2026-10-10T06:07:00+07:00' }], exercises: { 'Squat (Smith Machine)': [{ date: '2026-10-10', start: '2026-10-10T04:53:00+07:00', sets: [{ type: 'normal', kg: 45, reps: 8 }], heaviest: { kg: 45, reps: 8 } }] } };
  const own = sessions.filter((x) => x.source !== 'hevy');
  assert.equal(activeBridge(bridge, own), bridge);
  assert.equal(activeBridge(bridge, sessions), null);
  assert.equal(activeBridge(bridge, [{ ...sessions[0], status: 'deleted' }]), bridge, 'an undone import brings it back');
  const withBridge = buildHistory({ sessions: own, sets, bridge });
  assert.equal(withBridge.all('Squat (Smith Machine)').length, 2);
  const imported = buildHistory({ sessions, sets, bridge });
  // History dates are in the test machine's own time zone, so compare them through the same function.
  assert.deepEqual(imported.all('Squat (Smith Machine)').map((e) => [e.date, e.source]), [[isoDate(new Date(at('2026-10-17'))), 'training-hq'], [isoDate(new Date(at('2023-10-10'))), 'hevy']]);
  // Hold rounds and typical length don't count the bridge on top of the imported sessions.
  const areas = [{ id: 'knees', holds: [{ exercise: 'Leg Extension (Machine)' }] }];
  const holdBridge = { exercises: { 'Leg Extension (Machine)': [{ date: '2023-10-10', sets: [{ hold: true }] }] } };
  assert.deepEqual(roundsByDate(areas, own, [], holdBridge).knees, { '2023-10-10': 1 });
  assert.deepEqual(roundsByDate(areas, sessions, [], holdBridge).knees, {});
  assert.equal(typicalDurationMs('legs', { sessions: [], bridge, now: at('2026-10-18') }), 74 * 60000);
  assert.equal(typicalDurationMs('legs', { sessions: [...sessions], bridge, now: at('2026-10-18') }), 60 * 60000);
});

test('the last session of the same kind: day type, else routine, else title', () => {
  const list = [
    s('a', '2026-10-02'), s('b', '2026-10-10'), s('c', '2026-10-14', { dayType: 'push', title: 'Push' }),
    s('r1', '2026-10-05', { dayType: null, routineId: 'r', title: 'Neck A' }), s('r2', '2026-10-12', { dayType: null, routineId: 'r', title: 'Neck B' }),
    s('e1', '2026-10-06', { dayType: null, title: 'Workout' }), s('e2', '2026-10-13', { dayType: null, title: 'Workout' }),
    s('x', '2026-10-09', { status: 'discarded' }),
  ];
  assert.equal(previousSame(s('now', '2026-10-17'), list).id, 'b');
  assert.equal(previousSame(list[1], list).id, 'a', 'only earlier sessions');
  assert.equal(previousSame(list[4], list).id, 'r1');
  assert.equal(previousSame(list[6], list).id, 'e1');
  assert.equal(previousSame(list[0], list), null);
});
