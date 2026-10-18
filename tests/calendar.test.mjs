import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayMarks, workoutDates, weekStreak, restDaysSince, sessionsPerWeek, monthGrid, yearMonths, yearsList, dayColour, setText, dayDetail,
} from '../app/js/lib/calendar.js';

const TZ = 'Asia/Bangkok';
// 4:30 AM local = 21:30 UTC the day before: the local date must win.
const at = (iso, hm = '04:30') => Date.parse(`${iso}T${hm}:00+07:00`);
const s = (id, iso, extra = {}) => ({ id, status: 'done', kind: 'workout', startedAt: at(iso), endedAt: at(iso) + 3600000, title: 'Pull', dayType: 'pull', exercises: [], ...extra });

const sessions = [
  s('a', '2026-10-12', { title: 'Push', dayType: 'push', source: 'hevy' }),
  s('b', '2026-10-17', { title: 'Legs', dayType: 'legs' }),
  s('c', '2026-10-17', { title: 'Upper 1', dayType: null, source: 'strong', startedAt: at('2026-10-17', '18:00') }),
  s('h', '2026-10-17', { kind: 'holds', area: 'knees', title: 'Knees holds', startedAt: at('2026-10-17', '20:00') }),
  { ...s('x', '2026-10-16'), status: 'discarded' },
  { ...s('y', '2026-10-15'), status: 'active' },
];
const sets = [{ sessionId: 'a', type: 'hold', done: true }, { sessionId: 'b', type: 'hold', done: false }];

test('day markers use the local date and keep hold rounds apart from workouts', () => {
  const m = dayMarks({ sessions, sets, tz: TZ });
  assert.deepEqual([...m.keys()].sort(), ['2026-10-12', '2026-10-17']);
  const d = m.get('2026-10-17');
  assert.deepEqual(d.workouts.map((w) => w.id), ['b', 'c'], 'oldest first, holds and unfinished left out');
  assert.equal(d.workouts[0].source, 'training-hq');
  assert.equal(d.workouts[1].source, 'strong');
  assert.deepEqual(d.holds.map((h) => h.id), ['h'], 'an unticked hold set does not count');
  assert.deepEqual(m.get('2026-10-12').holds.map((h) => h.id), ['a'], 'hold sets inside a workout mark the day');
  assert.equal(dayColour(d), 'legs');
  assert.equal(dayColour({ workouts: [{ dayType: null }], holds: [], extra: [] }), 'other');
  assert.equal(dayColour({ workouts: [], holds: [{}], extra: [] }), null);
  assert.deepEqual(workoutDates(m), ['2026-10-12', '2026-10-17']);
});

test('extra markers from later steps land on their date', () => {
  const m = dayMarks({ sessions: [], extra: [{ date: '2026-10-18', kind: 'meal', label: 'Breakfast' }] });
  assert.deepEqual(m.get('2026-10-18').extra.map((e) => e.kind), ['meal']);
  assert.equal(yearsList(m)[0].year, '2026');
});

test('week streak counts weeks with a workout; an unfinished week without one does not break it', () => {
  // Monday weeks: 9/28, 10/5, 10/12 have workouts; 9/21 does not.
  const dates = ['2026-09-30', '2026-10-06', '2026-10-12', '2026-10-13'];
  assert.deepEqual(weekStreak(dates, '2026-10-14', 1), { current: 3, best: 3, thisWeek: true });
  assert.deepEqual(weekStreak(dates, '2026-10-19', 1), { current: 3, best: 3, thisWeek: false }, 'Monday 10/19, nothing yet this week');
  assert.equal(weekStreak(dates, '2026-10-26', 1).current, 0, 'a whole week missed');
  assert.equal(weekStreak(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', ...dates], '2026-10-14').best, 4);
  assert.equal(weekStreak([], '2026-10-14').current, 0);
  // Sunday-first weeks: Sunday 10/11 starts a week, so 10/12 and 10/13 are the same week as it.
  assert.equal(weekStreak(['2026-10-10', '2026-10-11'], '2026-10-12', 0).current, 2);
  assert.equal(weekStreak(['2026-10-11', '2026-10-12'], '2026-10-12', 1).current, 2, 'Monday-first: two weeks');
});

test('rest days since the last workout, and sessions per week', () => {
  assert.deepEqual(restDaysSince(['2026-10-12', '2026-10-17'], '2026-10-18'), { days: 1, last: '2026-10-17' });
  assert.deepEqual(restDaysSince(['2026-10-18'], '2026-10-18'), { days: 0, last: '2026-10-18' });
  assert.deepEqual(restDaysSince([], '2026-10-18'), { days: null, last: null });
  const m = dayMarks({ sessions: [s('1', '2026-09-21'), s('2', '2026-09-28'), s('3', '2026-10-01'), s('4', '2026-10-05'), s('5', '2026-10-12'), s('6', '2026-10-13')], tz: TZ });
  // Week of Monday 10/12: 2. The 4 weeks before (9/14 - 10/11): 9/21, 9/28, 10/1, 10/5 = 4 -> 1 a week.
  assert.deepEqual(sessionsPerWeek(m, '2026-10-14', { firstDay: 1 }), { thisWeek: 2, average: 1, weeks: 4 });
});

test('month grid starts on the Settings first day', () => {
  const g = monthGrid('2026-10', 1);
  assert.equal(g.lead, 3, 'October 1 2026 is a Thursday');
  assert.equal(g.days.length, 31);
  assert.equal(monthGrid('2026-10', 0).lead, 4);
  assert.equal(monthGrid('2026-02', 1).days.length, 28);
  assert.equal(monthGrid('2028-02', 1).days.length, 29);
});

test('year and all-years summaries count workouts by day type', () => {
  const m = dayMarks({ sessions, sets, tz: TZ });
  const oct = yearMonths(m, '2026')[9];
  assert.deepEqual(oct, { month: '2026-10', workouts: 3, byType: { push: 1, legs: 1, other: 1 } });
  const ys = yearsList(dayMarks({ sessions: [...sessions, s('old', '2023-10-10')], tz: TZ }));
  assert.deepEqual(ys.map((y) => [y.year, y.workouts, y.days]), [['2026', 3, 2], ['2023', 1, 1]]);
});

test('sets in words', () => {
  assert.equal(setText({ type: 'normal', kg: 42.5, reps: 12 }), '42.5 kg × 12');
  assert.equal(setText({ type: 'warmup', kg: 20, reps: 10 }), 'W 20 kg × 10');
  assert.equal(setText({ type: 'dropset', kg: 9, reps: 12, rpe: 9 }), 'D 9 kg × 12 @9');
  assert.equal(setText({ type: 'hold', kg: 30, durationS: 30 }, 'weight_reps'), 'H 30 kg · 30 s');
  assert.equal(setText({ type: 'hold', kg: 100, reps: null, durationS: null, importedAs: 'x 1' }), 'H 100 kg (logged as "x 1")');
  assert.equal(setText({ type: 'normal', kg: 0, reps: 8 }, 'weighted_bodyweight'), 'BW × 8');
  assert.equal(setText({ type: 'normal', kg: 5, reps: 6 }, 'weighted_bodyweight'), '+5 kg × 6');
  assert.equal(setText({ type: 'normal', kg: 20, reps: 8 }, 'assisted_bodyweight'), '-20 kg × 8');
  assert.equal(setText({ type: 'normal', reps: 15 }, 'reps_only'), 'BW × 15');
  assert.equal(setText({ type: 'normal', durationS: 45 }, 'duration'), '45 s');
  assert.equal(setText({ type: 'normal', distanceM: 2500, durationS: 900 }, 'distance_duration'), '2.5 km · 900 s');
  assert.equal(setText({ type: 'failure', reps: 10 }, 'weight_reps'), 'F 10 reps');
});

test('a day in full: each session with its ticked sets by exercise', () => {
  const sess = [
    { ...s('w', '2026-10-17'), exercises: [{ key: 'k1', name: 'Squat (Smith Machine)', type: 'weight_reps' }, { key: 'k2', name: 'Leg Extension (Machine)', type: 'weight_reps' }, { key: 'k3', name: 'Skipped', type: 'weight_reps' }] },
    { ...s('h', '2026-10-17', { kind: 'holds', area: 'knees', title: 'Knees holds' }), startedAt: at('2026-10-17', '20:00'), exercises: [{ key: 'h1', name: 'Toes Wall Squat Hold', type: 'duration' }] },
  ];
  const st = [
    { sessionId: 'w', exKey: 'k1', order: 2, type: 'normal', kg: 60, reps: 8, done: true },
    { sessionId: 'w', exKey: 'k1', order: 1, type: 'warmup', kg: 40, reps: 8, done: true },
    { sessionId: 'w', exKey: 'k2', order: 3, type: 'hold', kg: 100, done: true, importedAs: 'x 1' },
    { sessionId: 'w', exKey: 'k3', order: 4, type: 'normal', kg: 10, reps: 5, done: false },
    { sessionId: 'h', exKey: 'h1', order: 1, type: 'hold', durationS: 31, done: true },
  ];
  const m = dayMarks({ sessions: sess, sets: st, tz: TZ }).get('2026-10-17');
  const bySession = new Map();
  for (const x of st) bySession.set(x.sessionId, [...(bySession.get(x.sessionId) || []), x]);
  const d = dayDetail(m, new Map(sess.map((x) => [x.id, x])), bySession);
  assert.deepEqual(d.map((x) => x.session.id), ['w', 'h'], 'the workout once, then the hold round');
  assert.deepEqual(d[0].exercises.map((e) => [e.name, e.sets]), [
    ['Squat (Smith Machine)', ['W 40 kg × 8', '60 kg × 8']],
    ['Leg Extension (Machine)', ['H 100 kg (logged as "x 1")']],
  ]);
  assert.equal(d[0].sets, 3);
  assert.deepEqual(d[1].exercises[0].sets, ['H 31 s']);
  assert.deepEqual(dayDetail(undefined, new Map(), new Map()), []);
});
