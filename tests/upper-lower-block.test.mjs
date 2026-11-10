// Tue 11/10, his words: "Upper A upper B. One working set for two weeks starting today. With tendons and everything
// planned, neck, whatever. Even on rest day... make the hold for tendons, names of the exercises make sense... They
// should in the name have like dot hold... do not remove push-pull legs or anything... just add up upper lower".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotationDay, lastRotationSession, useBlock, sessionTomorrow, afterRestDay, inRotation, LABEL, blockLine } from '../app/js/lib/rotation.js';
import { projectRotation } from '../app/js/lib/scans.js';
import { buildSession, capWorkingSets, oneArmHoldRounds } from '../app/js/lib/session.js';
import { buildHistory } from '../app/js/lib/history.js';
import { holdsAfter, holdSlots, holdBase, holdName, roundsByDate } from '../app/js/lib/holds.js';
import { routineFromLast } from '../app/js/lib/finish.js';
import { neckToday, neckTodayText } from '../app/js/lib/neck.js';
import { movePath } from '../app/js/lib/hold-path.js';
import { renameHolds } from '../server/seed.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm = '04:30') => new Date(`${iso}T${hm}:00+07:00`).getTime();
const done = (id, dayType, iso) => ({ id, kind: 'workout', status: 'done', dayType, startedAt: at(iso) });
const BLOCK = { kind: 'block', name: 'Upper/Lower', from: '2026-11-10', to: '2026-11-23', order: ['upper-a', 'lower', 'upper-b', 'lower'], then: 'pull', workingSets: 1 };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (iso) => DOW[new Date(`${iso}T12:00:00Z`).getUTCDay()];

test('the block runs Upper A, Lower, rest, Upper B, Lower, rest from Tuesday 11/10; today is Upper A, not Pull', () => {
  // His last sessions: Pull Saturday 11/7, Legs Monday 11/9.
  const sessions = [done('s1', 'pull', '2026-11-07'), done('s2', 'legs', '2026-11-09')];
  const last = lastRotationSession(sessions, null, TZ);
  assert.equal(rotationDay({ last, today: '2026-11-10', block: null }).today.dayType, 'pull', 'without the block: Pull');
  assert.deepEqual(rotationDay({ last, today: '2026-11-10', block: BLOCK }).today, { kind: 'train', dayType: 'upper-a', reason: null, block: true });
  // Each day trained as planned, through the two weeks and out the other side.
  const plan = projectRotation({ last, from: '2026-11-10', n: 16, days: {} });
  useBlock(BLOCK);
  const withBlock = projectRotation({ last, from: '2026-11-10', n: 16, days: {} });
  useBlock(null);
  assert.equal(plan[0].dayType, 'pull');
  assert.deepEqual(withBlock.map((d) => `${dow(d.date)} ${d.kind === 'rest' ? 'rest' : LABEL[d.dayType]}`), [
    'Tue Upper A', 'Wed Lower', 'Thu rest', 'Fri Upper B', 'Sat Lower', 'Sun rest',
    'Mon Upper A', 'Tue Lower', 'Wed rest', 'Thu Upper B', 'Fri Lower', 'Sat rest',
    'Sun Upper A', 'Mon Lower', 'Tue rest', 'Wed Pull',
  ]);
});

test('in the block: a missed day carries the same type over; uppers alternate from his real sessions; after it Pull, Push, Legs come back', () => {
  const s = [done('s1', 'legs', '2026-11-09'), done('s2', 'upper-a', '2026-11-10'), done('s3', 'lower', '2026-11-11')];
  const last = lastRotationSession(s, null, TZ);
  assert.equal(last.lastUpper, 'upper-a');
  assert.deepEqual(rotationDay({ last, today: '2026-11-12', block: BLOCK }).today, { kind: 'rest', dayType: null, reason: 'rotation', block: true });
  assert.equal(rotationDay({ last, today: '2026-11-13', block: BLOCK }).today.dayType, 'upper-b');
  // He skips Friday: Saturday is still Upper B.
  assert.equal(rotationDay({ last, today: '2026-11-14', block: BLOCK }).today.dayType, 'upper-b');
  // Trained Lower on the last day, Monday 11/23: Tuesday rests, Wednesday is Pull (the day that was next before it).
  const end = lastRotationSession([...s, done('s4', 'upper-b', '2026-11-22'), done('s5', 'lower', '2026-11-23')], null, TZ);
  const r = rotationDay({ last: end, today: '2026-11-23', block: BLOCK });
  assert.deepEqual([r.today.kind, r.next.date, r.next.dayType], ['done', '2026-11-25', 'pull']);
  // He kept it 2 more weeks: Upper A after that Lower.
  assert.equal(rotationDay({ last: end, today: '2026-11-25', block: { ...BLOCK, to: '2026-12-07' } }).today.dayType, 'upper-a');
  // Upper/Lower types are rotation types (a session of them moves the rotation; the coach can choose one next).
  assert.ok(inRotation('upper-b') && inRotation('lower') && !inRotation('neck'));
  assert.equal(rotationDay({ last, today: '2026-11-13', block: BLOCK, days: { '2026-11-13': { date: '2026-11-13', nextType: { dayType: 'lower' } } } }).today.dayType, 'lower');
});

test('rest days in the block still ask for the shoulder hold, even with an upper day tomorrow; the day after rest carries over', () => {
  const last = { dayType: 'lower', date: '2026-11-11', streak: 2, lastUpper: 'upper-a' };
  const rot = rotationDay({ last, today: '2026-11-12', block: BLOCK });
  assert.equal(sessionTomorrow(rot, '2026-11-12'), null);
  assert.equal(sessionTomorrow(rotationDay({ last: { dayType: 'legs', date: '2026-10-11', streak: 3 }, today: '2026-10-12', block: null }), '2026-10-12'), 'pull', 'PPL as before');
  const shoulder = { id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [
    { exercise: 'Bench Press (Smith Machine) · Hold', timing: ['after Push'] }, { exercise: 'Lateral Raise (Cable) · Hold', timing: ['after Push', 'rest days'], where: 'gym' }] };
  const slots = holdSlots({ areas: [shoulder], dayKind: 'rest', nextSession: sessionTomorrow(rot, '2026-11-12') });
  assert.deepEqual(slots.map((x) => [x.slot, x.exercise, x.ask]), [['rest', 'Lateral Raise (Cable) · Hold', true]]);
  useBlock(BLOCK);
  const fri = rotationDay({ last, today: '2026-11-13' });
  assert.equal(afterRestDay(fri, '2026-11-13', {}), '2026-11-12');
  useBlock(null);
});

test('holds after an upper day are the Push and Pull ones, after Lower the Legs ones; the knee heal round counts on Lower', () => {
  const areas = [
    { id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Bench Press (Smith Machine) · Hold', timing: ['after Push'] }, { exercise: 'Lateral Raise (Cable) · Hold', timing: ['after Push', 'rest days'] }] },
    { id: 'wrist', label: 'Wrist', phase: 'fix', holds: [{ exercise: 'Cupping · Hold', timing: ['after Pull', 'after Legs'] }] },
    { id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Leg Extension (Machine) · Hold', when: 'after Legs', where: 'gym' }, { exercise: 'Toes Wall Squat Hold', where: 'home', timing: ['rest days'] }] },
  ];
  const names = (t) => holdsAfter(areas, t).map((h) => h.exercise);
  assert.deepEqual(names('upper-a'), ['Bench Press (Smith Machine) · Hold', 'Lateral Raise (Cable) · Hold', 'Cupping · Hold']);
  assert.deepEqual(names('upper-b'), names('upper-a'));
  assert.deepEqual(names('lower'), ['Cupping · Hold', 'Leg Extension (Machine) · Hold']);
  assert.deepEqual(names('push'), ['Bench Press (Smith Machine) · Hold', 'Lateral Raise (Cable) · Hold'], 'Push as before');
  const lower = holdSlots({ areas, dayKind: 'train', dayType: 'lower' });
  assert.deepEqual(lower.filter((x) => x.area === 'knees').map((x) => [x.slot, x.exercise]), [['after', 'Leg Extension (Machine) · Hold'], ['evening', 'Toes Wall Squat Hold']]);
  const upper = holdSlots({ areas, dayKind: 'train', dayType: 'upper-b' });
  assert.deepEqual(upper.filter((x) => x.slot === 'after').map((x) => [x.area, x.exercise, x.also]), [['shoulder', 'Bench Press (Smith Machine) · Hold', ['Lateral Raise (Cable) · Hold']], ['wrist', 'Cupping · Hold', []]]);
});

test('neck goes after both upper days (his plan: after Push), not after Lower; Train says which day', () => {
  const neck = { planned: true, place: 'after-push' };
  assert.equal(neckToday(neck, 'train', 'upper-a'), true);
  assert.equal(neckToday(neck, 'done', 'upper-b'), true);
  assert.equal(neckToday(neck, 'train', 'lower'), false);
  assert.equal(neckToday(neck, 'rest', null), false);
  assert.equal(neckToday(neck, 'train', 'pull'), false, 'Pull as before');
  assert.equal(neckTodayText('after-push', null, 'upper-b'), 'Neck after Upper B today');
  assert.equal(neckTodayText('after-push', null, 'push'), 'Neck after Push today');
});

// ---- sessions: one working set, week columns of their own lifts, holds with their own names ------------------------

const meta = { firstSessions: { push: '2026-09-27', pull: '2026-09-24' } };
const cell = (kg, reps, sets) => ({ load: { type: 'total', kg }, reps, sets });
const programmeRoutines = [
  { id: 'push-gbi', dayType: 'push', exercises: [{ comebackName: 'Bench Press (Smith Machine)', capClass: 'main', weeks: [cell(35, [10, 12], { firstSession: 1, after: 2 }), cell(45, [8, 10], { count: 2 }), cell(57.5, [6, 8], { count: 2 }), cell(70, [6, 8], { count: 2 })] }] },
  { id: 'pull-gbi', dayType: 'pull', exercises: [{ comebackName: 'Front Wrist Curl', capClass: 'light', weeks: [cell(10, [20, 30], { count: 2 }), cell(10, [20, 30], { count: 2 }), cell(12, [20, 30], { count: 2 }), cell(12, [20, 30], { count: 2 })] }] },
];
const upperA = {
  id: 'upper-a', title: 'Upper A', dayType: 'upper-a', workingSets: 1, workingSetsUntil: '2026-11-23', exercises: [
    { key: 'a1', exerciseId: 'bench-press-smith-machine', name: 'Bench Press (Smith Machine)', plan: { routine: 'push-gbi', name: 'Bench Press (Smith Machine)' }, sets: [] },
    { key: 'a2', exerciseId: 'front-wrist-curl', name: 'Front Wrist Curl', plan: { routine: 'pull-gbi', name: 'Front Wrist Curl' }, sets: [{ type: 'warmup', kg: 5 }, { type: 'normal' }, { type: 'dropset', kg: 6 }] },
    { key: 'a3', exerciseId: 'hip-abduction-machine', name: 'Hip Abduction (Machine)', plan: null, sets: [{ type: 'normal', kg: 29, reps: [15, 15] }, { type: 'normal', kg: 29, reps: [15, 15] }] },
    { key: 'a4', exerciseId: 'cupping', name: 'Cupping · Hold', plan: null, role: 'tendon-hold', sets: [1, 2, 3].map(() => ({ type: 'hold', kg: 9, durationS: 30 })) },
  ],
};
const lib = new Map([['bench-press-smith-machine', { id: 'bench-press-smith-machine', type: 'weight_reps', barKg: 11.3, capClass: 'main' }]]);
const lifted = (name, kg, reps, date) => ({ id: `s-${name}-${date}`, kind: 'workout', status: 'done', dayType: 'push', startedAt: at(date), exercises: [{ key: 'x', name }] });

test('Upper A: 1 working set per exercise (warm-ups and holds stay, drop sets go); each lift on its own week column; back to normal after Monday 11/23', () => {
  const sessions = [lifted('Bench Press (Smith Machine)', 50, 8, '2026-11-01')];
  const sets = [{ sessionId: sessions[0].id, exKey: 'x', done: true, type: 'normal', kg: 51.3, reps: 8, order: 0 }];
  const history = buildHistory({ sessions, sets });
  const { session, sets: rows } = buildSession({ routine: upperA, meta, programmeRoutines, lib, history, today: '2026-11-10' });
  const of = (key) => rows.filter((r) => r.exKey === session.exercises.find((e) => e.exerciseId === key).key).map((r) => r.type[0]).join('');
  assert.equal(session.dayType, 'upper-a');
  assert.equal(of('bench-press-smith-machine'), 'n');
  assert.equal(of('front-wrist-curl'), 'wn');
  assert.equal(of('hip-abduction-machine'), 'n');
  assert.equal(of('cupping'), 'hhh');
  const bench = session.exercises.find((e) => e.exerciseId === 'bench-press-smith-machine');
  assert.equal(bench.target.week, 4, 'Push week column (week 7 uses week 4 cells)');
  assert.equal(bench.target.sets, 1);
  // After the block the same routine has its normal sets again.
  const later = buildSession({ routine: upperA, meta, programmeRoutines, lib, history, today: '2026-11-24' });
  const benchLater = later.session.exercises.find((e) => e.exerciseId === 'bench-press-smith-machine');
  assert.equal(later.sets.filter((r) => r.exKey === benchLater.key).length, 2);
  // Pull, Push and Legs routines (no workingSets) are untouched.
  assert.deepEqual(capWorkingSets([{ type: 'warmup' }, { type: 'normal' }, { type: 'normal' }, { type: 'dropset' }], { id: 'push-gbi' }, '2026-11-10').map((r) => r.type), ['warmup', 'normal', 'normal', 'dropset']);
});

test('hold names: "<lift> · Hold"; the older forms are the same hold; their history moves with them', () => {
  assert.equal(holdName('Cupping'), 'Cupping · Hold');
  assert.equal(holdName('Bench Press (Smith Machine)'), 'Bench Press (Smith Machine) · Hold');
  assert.equal(holdName('Leg Extension Hold (Machine)'), 'Leg Extension (Machine) · Hold');
  assert.equal(holdName('Toes Wall Squat Hold'), 'Toes Wall Squat Hold');
  assert.equal(holdName('Cupping · Hold'), 'Cupping · Hold');
  assert.equal(holdBase('Cupping · Hold'), 'Cupping');
  assert.equal(holdBase('Leg Extension (Machine) · Hold'), 'Leg Extension (Machine)');
  // Saturday 11/7: Cupping as reps, then the 30 s hold under the same name. The hold's history shows under its own name;
  // the lift's weights still come from its rep sets.
  const s = { id: 's1', kind: 'workout', status: 'done', dayType: 'pull', startedAt: at('2026-11-07'), exercises: [{ key: 'c1', name: 'Cupping' }, { key: 'c2', name: 'Cupping' }, { key: 'l1', name: 'Leg Extension Hold (Machine)' }] };
  const sets = [
    { sessionId: 's1', exKey: 'c1', done: true, type: 'normal', kg: 12, reps: 12, order: 0 },
    { sessionId: 's1', exKey: 'c2', done: true, type: 'hold', kg: 9, durationS: 30, order: 1 },
    { sessionId: 's1', exKey: 'l1', done: true, type: 'normal', kg: 104, durationS: 30, order: 2 },
  ];
  const h = buildHistory({ sessions: [s], sets });
  assert.deepEqual(h.all('Cupping · Hold').map((e) => e.sets.map((x) => [x.type, x.kg])), [[['hold', 9]]]);
  assert.equal(h.lastLifted('Cupping').heaviest.kg, 12);
  assert.equal(h.previous('Cupping · Hold').hold[0].kg, 9);
  assert.equal(h.all('Leg Extension (Machine) · Hold')[0].sets[0].kg, 104);
  // A round of the new name counts for its area, like the old one.
  const wrist = { id: 'wrist', label: 'Wrist', phase: 'fix', holds: [{ exercise: 'Cupping · Hold', timing: ['after Pull'] }], loadsArea: { exercises: ['Cupping'] } };
  const round = { id: 'r1', kind: 'holds', status: 'done', area: 'wrist', startedAt: at('2026-11-10', '09:00'), exercises: [{ key: 'h', name: 'Cupping · Hold' }] };
  assert.equal(roundsByDate([wrist], [round], [])['wrist']['2026-11-10'], 1);
  const inWorkout = { id: 'w1', kind: 'workout', status: 'done', dayType: 'upper-b', startedAt: at('2026-11-13'), exercises: [{ key: 'h2', name: 'Cupping · Hold' }] };
  assert.equal(roundsByDate([wrist], [inWorkout], [{ sessionId: 'w1', exKey: 'h2', done: true, type: 'hold', durationS: 30 }])['wrist']['2026-11-13'], 1);
  // One arm at a time, by either name.
  const rounds = oneArmHoldRounds([{ holds: [{ exercise: 'Cupping · Hold', sides: ['Right arm', 'Left arm'], sets: 3 }] }]);
  assert.equal(rounds.get('Cupping'), 3); assert.equal(rounds.get('Cupping · Hold'), 3);
  // A hold path's next stage gets the hold's name too.
  const hold = { exercise: 'Bench Press (Smith Machine) · Hold', path: { stages: [{ label: 'Flat Smith', exercise: 'Bench Press (Smith Machine)', loadKg: 31.3 }, { label: 'Flat dumbbells', exercise: 'Bench Press (Dumbbell)', loadKg: 20 }] } };
  assert.equal(movePath(movePath(hold, 'start', '2026-11-10'), 'up', '2026-11-14').exercise, 'Bench Press (Dumbbell) · Hold');
});

test('the next workout copies his last one with the holds under their own name, a skipped hold still a hold', () => {
  const last = { id: 'p1', startedAt: at('2026-11-07'), exercises: [
    { key: 'c1', exerciseId: 'cupping', name: 'Cupping' },
    { key: 'c2', exerciseId: 'cupping', name: 'Cupping', skipped: { reason: 'later' } },
    { key: 'r1', exerciseId: 'lateral-raise-cable', name: 'Lateral Raise (Cable)' }] };
  const lastSets = [
    { sessionId: 'p1', exKey: 'c1', done: true, type: 'normal', kg: 12, reps: 12, order: 0 },
    { sessionId: 'p1', exKey: 'c2', done: false, type: 'hold', kg: 9, durationS: 30, order: 1 },
    { sessionId: 'p1', exKey: 'c2', done: false, type: 'hold', kg: 9, durationS: 30, order: 2 },
    { sessionId: 'p1', exKey: 'r1', done: true, type: 'hold', kg: 6.8, durationS: 30, order: 3 },
  ];
  const routine = { id: 'pull-gbi', dayType: 'pull', exercises: [{ key: 'k1', exerciseId: 'cupping', name: 'Cupping', plan: { routine: 'pull-gbi', name: 'Cupping' }, sets: [] }] };
  const r = routineFromLast(routine, last, lastSets);
  assert.deepEqual(r.exercises.map((e) => [e.name, e.sets.map((x) => x.type[0]).join('')]), [['Cupping', 'n'], ['Cupping · Hold', 'hh'], ['Lateral Raise (Cable) · Hold', 'h']]);
  // His real Saturday 11/7: the second Cupping had nothing logged and a note that says hold: a hold.
  const sat = { id: 'p2', startedAt: at('2026-11-07'), exercises: [
    { key: 'c1', exerciseId: 'cupping', name: 'Cupping' },
    { key: 'c2', exerciseId: 'cupping', name: 'Cupping', notes: '30s hold for the wrist', skipped: { reason: 'not today' } }] };
  const r2 = routineFromLast(routine, sat, [{ sessionId: 'p2', exKey: 'c1', done: true, type: 'normal', kg: 9, reps: 12, order: 0 }]);
  assert.deepEqual(r2.exercises.map((e) => [e.name, e.sets.map((x) => `${x.type[0]}${x.durationS ?? ''}`).join(' ')]), [['Cupping', 'n'], ['Cupping · Hold', 'h30 h30 h30']]);
  // A lift he skipped with a note that isn't a repeat stays the lift.
  const r3 = routineFromLast(routine, { id: 'p3', startedAt: at('2026-11-07'), exercises: [{ key: 'c1', exerciseId: 'cupping', name: 'Cupping', notes: 'hold the top', skipped: { reason: 'wrist' } }] }, []);
  assert.equal(r3.exercises[0].name, 'Cupping');
});

test('the Mac renames the holds once: tendon areas, path stages and routine hold entries; nothing else changes', () => {
  const recs = new Map();
  const store = {
    listRecords: (col) => [...recs.values()].filter((r) => r.col === col),
    writeLocal: (col, id, data) => { recs.set(`${col}/${id}`, { col, id, data, deleted: 0 }); },
  };
  store.writeLocal('tendons', 'area.wrist', { kind: 'area', id: 'wrist', holds: [{ exercise: 'Cupping', loadKg: 9 }] });
  store.writeLocal('tendons', 'area.knees', { kind: 'area', id: 'knees', holds: [{ exercise: 'Leg Extension (Machine)' }, { exercise: 'Toes Wall Squat Hold' }] });
  store.writeLocal('tendons', 'area.abs', { kind: 'area', id: 'abs', holds: [] });
  store.writeLocal('tendons', 'rules', { kind: 'rules', items: [] });
  store.writeLocal('routines', 'push-gbi', { id: 'push-gbi', exercises: [{ name: 'Bench Press (Smith Machine)', plan: {}, sets: [] }, { name: 'Lateral Raise (Cable)', role: 'tendon-hold', sets: [{ type: 'hold' }] }] });
  store.writeLocal('routines', 'legs-gbi', { id: 'legs-gbi', exercises: [{ name: 'Squat (Smith Machine)', sets: [] }] });
  assert.equal(renameHolds(store), 3);
  const get = (k) => recs.get(k).data;
  assert.deepEqual(get('tendons/area.wrist').holds, [{ exercise: 'Cupping · Hold', loadKg: 9, formerly: 'Cupping' }]);
  assert.deepEqual(get('tendons/area.knees').holds.map((h) => h.exercise), ['Leg Extension (Machine) · Hold', 'Toes Wall Squat Hold']);
  assert.deepEqual(get('routines/push-gbi').exercises.map((e) => e.name), ['Bench Press (Smith Machine)', 'Lateral Raise (Cable) · Hold']);
  assert.equal(renameHolds(store), 0, 'once');
});

test('Train line for the block', () => {
  assert.equal(blockLine(BLOCK), 'Upper/Lower until Monday 11/23: Upper, Lower, rest. 1 working set per exercise. Pull, Push and Legs come back after it.');
});

test('the check-in asks as much on Upper/Lower days: Lower checks the Legs areas, an upper day Pull\'s and Push\'s', async () => {
  const { workingKeys, decide } = await import('../app/js/lib/readiness.js');
  const table = { workingArea: { legs: ['L', 'B'], pull: ['B'], push: [] }, rules: [] };
  assert.deepEqual(workingKeys(table, 'lower'), ['L', 'B']);
  assert.deepEqual(workingKeys(table, 'upper-a'), ['B']);
  assert.deepEqual(workingKeys(table, 'upper-b'), ['B']);
  assert.deepEqual(workingKeys(table, 'legs'), ['L', 'B']);
  assert.deepEqual(workingKeys(table, 'push'), []);
  assert.ok(typeof decide === 'function');
});
