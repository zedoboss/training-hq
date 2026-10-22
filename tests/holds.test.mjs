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

test('hold plan for the day (decisions 17 and 18)', async () => {
  const { holdSlots, slotHolds } = await import('../app/js/lib/holds.js');
  const areas = [
    { id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Gym Hold', when: 'after Legs', where: 'gym' }, { exercise: 'Home Hold', where: 'home', when: 'the second session on Legs days; both sessions on every other day' }] },
    { id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Press Hold', timing: ['after Push'] }, { exercise: 'Raise Hold', timing: ['after Push', 'rest days'] }] },
    { id: 'wrist', label: 'Wrist', phase: 'fix', holds: [{ exercise: 'Grip Hold', timing: ['after Pull', 'after Legs'] }] },
    { id: 'arms', label: 'Arms', phase: 'none', holds: [] },
  ];
  const key = (s) => `${s.area}:${s.slot}:${s.exercise}${s.done ? ':done' : ''}`;
  // Legs day: the gym hold counts as one of the two knee rounds; wrist after Legs.
  assert.deepEqual(holdSlots({ areas, dayKind: 'train', dayType: 'legs' }).map(key), ['knees:after:Gym Hold', 'wrist:after:Grip Hold', 'knees:evening:Home Hold']);
  // Push day: shoulder after Push; knees at home morning and evening.
  const push = holdSlots({ areas, dayKind: 'done', dayType: 'push', roundsToday: { knees: 1 } });
  assert.deepEqual(push.map(key), ['knees:morning:Home Hold:done', 'shoulder:after:Press Hold', 'knees:evening:Home Hold']);
  assert.equal(push[0].time, '07:30');
  assert.deepEqual(push[1].also, ['Raise Hold']);
  assert.equal(push[2].time, '19:30');
  // Rest day: shoulder's rest-day hold, knees twice, no wrist.
  const rest = holdSlots({ areas, dayKind: 'rest', dayType: null, times: { morning: '08:00', evening: '20:00' } });
  assert.deepEqual(rest.map(key), ['knees:morning:Home Hold', 'shoulder:rest:Raise Hold', 'knees:evening:Home Hold']);
  assert.equal(rest[1].time, '08:00');
  assert.deepEqual(slotHolds(areas[1], 'after', 'push').map((x) => x.h.exercise), ['Press Hold', 'Raise Hold']);
  assert.deepEqual(slotHolds(areas[1], 'rest').map((x) => x.h.exercise), ['Raise Hold']);
});

test('rest-day hold (A2): asked each rest day; gym, his own hold or skip; the last gym/other answer stands until he answers', async () => {
  const { holdSlots, restChoices, withRestChoice, restChoiceText, restAskAreas, openSlots } = await import('../app/js/lib/holds.js');
  const areas = [
    { id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Gym Hold', when: 'after Legs', where: 'gym' }, { exercise: 'Home Hold', where: 'home' }] },
    { id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Press Hold', timing: ['after Push'] }, { exercise: 'Raise Hold', timing: ['after Push', 'rest days'] }] },
  ];
  assert.deepEqual(restAskAreas(areas).map((a) => a.id), ['shoulder']);
  const slotOf = (days, date, rounds = {}) => holdSlots({ areas, dayKind: 'rest', dayType: null, roundsToday: rounds, restChoices: restChoices(days, date) }).find((x) => x.area === 'shoulder');
  // Never answered: asked, the data's hold planned.
  let x = slotOf({}, '2026-10-22');
  assert.equal(x.ask, true); assert.equal(x.exercise, 'Raise Hold'); assert.equal(x.restHold, 'Raise Hold'); assert.equal(x.last, null);
  // He names his own hold today.
  let days = { '2026-10-22': withRestChoice(null, '2026-10-22', 'shoulder', { choice: 'other', holdName: ' Band hold ' }, 'app', 1) };
  x = slotOf(days, '2026-10-22');
  assert.equal(x.ask, false); assert.equal(x.holdIndex, 'other'); assert.equal(x.exercise, 'Band hold'); assert.deepEqual(x.also, []);
  // Next rest day: asked again, his hold stands meanwhile, last answer shown.
  x = slotOf(days, '2026-10-26');
  assert.equal(x.ask, true); assert.equal(x.exercise, 'Band hold'); assert.equal(x.last.date, '2026-10-22');
  assert.equal(restChoiceText(x.last, areas[1]), 'his own hold: Band hold');
  // A skip counts for its day only: next time the last gym/other answer stands.
  days['2026-10-26'] = withRestChoice(days['2026-10-26'], '2026-10-26', 'shoulder', { choice: 'skip' });
  x = slotOf(days, '2026-10-26');
  assert.equal(x.skipped, true);
  assert.deepEqual(openSlots([x]), []);
  x = slotOf(days, '2026-10-30');
  assert.equal(x.ask, true); assert.equal(x.skipped, false); assert.equal(x.exercise, 'Band hold'); assert.equal(restChoiceText(x.last, areas[1]), 'skipped');
  // Gym: the data's hold.
  days['2026-10-30'] = withRestChoice({ date: '2026-10-30', sessionTime: '04:30' }, '2026-10-30', 'shoulder', { choice: 'gym' });
  assert.equal(days['2026-10-30'].sessionTime, '04:30');
  x = slotOf(days, '2026-10-30');
  assert.equal(x.exercise, 'Raise Hold'); assert.equal(x.holdIndex, 1); assert.equal(restChoiceText(days['2026-10-30'].restHolds.shoulder, areas[1]), 'the gym for the Raise Hold hold');
  // Done without answering: no longer asked.
  x = slotOf({}, '2026-11-03', { shoulder: 1 });
  assert.equal(x.done, true); assert.equal(x.ask, false);
  // Training days are untouched.
  assert.equal(holdSlots({ areas, dayKind: 'train', dayType: 'push', restChoices: restChoices(days, '2026-10-30') }).find((y) => y.area === 'shoulder').ask, undefined);
});

test('a round on the hold timer: every hold with its GET READY, rest between holds', async () => {
  const { roundSeconds, roundLength } = await import('../app/js/lib/holds.js');
  assert.equal(roundSeconds(), 375, '3 × (15 + 30) + 2 × 120 = 6:15');
  assert.equal(roundSeconds({ getReadyS: 0 }), 330, 'his count: 3 × 30 s with 2:00 between = 5:30');
  assert.equal(roundLength(375), 'about 6 min');
});

test('his knee hold logged with the hold exercise counts (Thu 10/22): "Leg Extension Hold (Machine)", timed sets', async () => {
  const { roundsByDate, holdBase, isHoldSet } = await import('../app/js/lib/holds.js');
  assert.equal(holdBase('Leg Extension Hold (Machine)'), 'Leg Extension (Machine)');
  assert.equal(holdBase('Cupping Hold'), 'Cupping');
  const areas = [{ kind: 'area', id: 'knees', holds: [{ exercise: 'Leg Extension (Machine)', where: 'gym' }] }, { kind: 'area', id: 'wrist', holds: [{ exercise: 'Cupping' }] }];
  const s = { id: 's', status: 'done', startedAt: Date.parse('2026-10-22T03:16:00Z'), exercises: [{ key: 'h', name: 'Leg Extension Hold (Machine)' }, { key: 'e', name: 'Leg Extension (Machine)' }] };
  const sets = [1, 2, 3].map((i) => ({ sessionId: 's', exKey: 'h', type: 'normal', kg: 104, durationS: 30, done: true }))
    .concat([{ sessionId: 's', exKey: 'e', type: 'normal', kg: 50, reps: 12, done: true }]);
  const r = roundsByDate(areas, [s], sets);
  assert.deepEqual(Object.values(r.knees), [1]);
  assert.deepEqual(r.wrist, {}, 'cupping still open');
  assert.equal(isHoldSet({ type: 'normal', kg: 50, reps: 12, done: true }, { name: 'Leg Extension (Machine)' }), false, 'a working set is not a hold');
});
