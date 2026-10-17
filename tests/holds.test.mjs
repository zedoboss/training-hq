import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundsByDate, areaStatus, painOk } from '../app/js/lib/holds.js';

const areas = [
  { id: 'knees', phase: 'heal', holds: [{ exercise: 'Leg Extension (Machine)' }, { exercise: 'Toes Wall Squat Hold' }] },
  { id: 'shoulder', phase: 'fix', holds: [{ exercise: 'Lateral Raise (Cable)' }] },
  { id: 'wrist', phase: 'unknown', holds: [{ exercise: 'Cupping' }] },
];
const at = (iso) => Date.parse(iso);

test('rounds come from hold sessions and from hold sets inside workouts', () => {
  const sessions = [
    { id: 'h1', kind: 'holds', area: 'knees', status: 'done', startedAt: at('2026-10-17T00:30:00Z') },
    { id: 'w1', kind: 'workout', status: 'done', startedAt: at('2026-10-17T22:00:00Z'), exercises: [{ key: 'a', name: 'Leg Extension (Machine)' }, { key: 'b', name: 'Squat (Smith Machine)' }] },
    { id: 'w2', kind: 'workout', status: 'done', startedAt: at('2026-10-12T04:00:00Z'), exercises: [{ key: 'c', name: 'Lateral Raise (Cable)' }] },
    { id: 'h2', kind: 'holds', area: 'knees', status: 'active', startedAt: at('2026-10-17T10:00:00Z') },
  ];
  const sets = [
    { sessionId: 'w1', exKey: 'a', done: true, type: 'hold' },
    { sessionId: 'w1', exKey: 'a', done: true, type: 'normal' },
    { sessionId: 'w2', exKey: 'c', done: true, type: 'hold' },
  ];
  const r = roundsByDate(areas, sessions, sets);
  const days = Object.values(r.knees).reduce((a, b) => a + b, 0);
  assert.equal(days, 2, 'one hold session + one workout with leg extension holds; the active one does not count');
  assert.equal(Object.values(r.shoulder).reduce((a, b) => a + b, 0), 1);
});

test('due: heal twice a day; fix 3-4 a week; unknown phase is not scheduled', () => {
  assert.deepEqual(
    (({ done, target, due }) => ({ done, target, due }))(areaStatus(areas[0], { '2026-10-17': 1 }, '2026-10-17')),
    { done: 1, target: 2, due: true },
  );
  assert.equal(areaStatus(areas[0], { '2026-10-17': 2 }, '2026-10-17').due, false);
  const sh = areaStatus(areas[1], { '2026-10-12': 1, '2026-10-06': 1, '2026-10-17': 1 }, '2026-10-17');
  assert.equal(sh.done, 2, 'only the last 7 days: 10/12 and 10/17');
  assert.equal(sh.due, true);
  assert.equal(areaStatus(areas[2], {}, '2026-10-17').kind, 'unscheduled');
});

test('pain rule', () => {
  assert.equal(painOk(4), true);
  assert.equal(painOk(5), false);
  assert.equal(painOk(null), true);
});

test('Hevy holds count, mapped through the hold and load lists', () => {
  const a2 = [{ id: 'shoulder', phase: 'fix', holds: [{ exercise: 'Lateral Raise (Cable)' }], loadsArea: { exercises: ['Bench Press (Smith Machine)'] } }];
  const bridge = { exercises: {
    'Lateral Raise (Cable)': [{ date: '2026-10-12', sets: [{ hold: true }] }, { date: '2026-10-06', sets: [{ hold: true }] }],
    'Bench Press (Smith Machine)': [{ date: '2026-10-12', sets: [{ hold: false }, { hold: true }] }, { date: '2026-10-01', sets: [{ hold: false }] }],
  } };
  const r = roundsByDate(a2, [], [], bridge);
  assert.deepEqual(r.shoulder, { '2026-10-12': 1, '2026-10-06': 1 }, 'one round per area per day from Hevy');
});

test('holds due after a workout come from the tendon data ("after Push" in timing or when)', async () => {
  const { holdsAfter } = await import('../app/js/lib/holds.js');
  const areas = [
    { label: 'Shoulder', holds: [{ exercise: 'Bench Press (Smith Machine)', timing: ['after Push'] }, { exercise: 'Lateral Raise (Cable)', timing: ['after Push', 'rest days'], sets: 3, seconds: 30 }] },
    { label: 'Knees', holds: [{ exercise: 'Leg Extension (Machine)', when: 'after Legs' }, { exercise: 'Toes Wall Squat Hold', when: 'the second session on Legs days' }] },
  ];
  assert.deepEqual(holdsAfter(areas, 'push').map((h) => h.exercise), ['Bench Press (Smith Machine)', 'Lateral Raise (Cable)']);
  assert.deepEqual(holdsAfter(areas, 'legs').map((h) => h.exercise), ['Leg Extension (Machine)']);
  assert.deepEqual(holdsAfter(areas, 'pull'), []);
  assert.deepEqual(holdsAfter(areas, null), []);
});
