import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory, heaviestOf, sameRoutine } from '../app/js/lib/history.js';
import { buildSession, summarize, elapsedMs, clock, previousFor, fillForTick, setsForAdded, setTimerView, setTimerResult } from '../app/js/lib/session.js';

const bridge = {
  exercises: {
    'Bench Press (Smith Machine)': [
      { date: '2026-10-12', start: '2026-10-12T10:54', title: 'Push', dayType: 'push', heaviest: { kg: 51.3, reps: 12 }, sets: [
        { type: 'normal', kg: 51.3, reps: 12, hold: false }, { type: 'normal', kg: 41.3, reps: 12, hold: false },
        { type: 'normal', kg: 31.3, reps: 10, hold: true }, { type: 'normal', kg: 31.3, reps: 10, hold: true }, { type: 'normal', kg: 31.3, reps: 10, hold: true }] },
      { date: '2026-10-06', start: '2026-10-06T06:21', title: 'Push', dayType: 'push', heaviest: { kg: 41.3, reps: 12 }, sets: [{ type: 'normal', kg: 41.3, reps: 12, hold: false }] },
    ],
    'Lateral Raise (Cable)': [{ date: '2026-10-12', start: '2026-10-12T10:54', title: 'Push', heaviest: null, sets: [{ type: 'normal', kg: 6.8, reps: 10, hold: true }] }],
  },
};
const meta = { firstSessions: { push: '2026-09-27' } };
const programmeRoutines = [{ id: 'push-gbi', exercises: [{ comebackName: 'Bench Press (Smith Machine)', capClass: 'main', weeks: [
  { load: { type: 'total', kg: 35 }, reps: [10, 12], sets: { firstSession: 1, after: 2 } }, { load: { type: 'total', kg: 45 }, reps: [8, 10], sets: { count: 2 } },
  { load: { type: 'total', kg: 57.5 }, reps: [6, 8], sets: { count: 2 } }, { load: { type: 'total', kg: 70 }, reps: [6, 8], sets: { count: 2 } }] }] }];
const routine = {
  id: 'push-gbi', title: 'Push', dayType: 'push', exercises: [
    { key: 'k1', exerciseId: 'bench-press-smith-machine', name: 'Bench Press (Smith Machine)', plan: { routine: 'push-gbi', name: 'Bench Press (Smith Machine)' }, sets: [] },
    { key: 'k2', exerciseId: 'lateral-raise-cable', name: 'Lateral Raise (Cable)', plan: null, role: 'tendon-hold', sets: [1, 2, 3].map(() => ({ type: 'hold', kg: 6.8, durationS: 30 })) },
  ],
};
const lib = new Map([
  ['bench-press-smith-machine', { id: 'bench-press-smith-machine', type: 'weight_reps', barKg: 11.3, capClass: 'main', restSeconds: 180 }],
  ['lateral-raise-cable', { id: 'lateral-raise-cable', type: 'weight_reps', restSeconds: 90 }],
]);

test('history: newest first, holds kept out of the heaviest, guard history per session', () => {
  const h = buildHistory({ bridge });
  assert.equal(h.last('Bench Press (Smith Machine)').date, '2026-10-12');
  assert.deepEqual(h.guardHistory('Bench Press (Smith Machine)'), [{ date: '2026-10-12', kg: 51.3 }, { date: '2026-10-06', kg: 41.3 }]);
  const p = h.previous('Bench Press (Smith Machine)');
  assert.equal(p.working.length, 2);
  assert.equal(p.hold.length, 3);
  assert.deepEqual(heaviestOf([{ type: 'warmup', kg: 99, reps: 1 }, { type: 'normal', kg: 40, reps: 8 }]), { kg: 40, reps: 8 });
});

test('previous column from the same routine: Training HQ routine first, Hevy by day type', () => {
  const s1 = { id: 's1', status: 'done', routineId: 'push-normal', dayType: 'push', startedAt: Date.parse('2026-10-18T04:30:00Z'), exercises: [{ key: 'a', name: 'Bench Press (Smith Machine)' }] };
  const sets = [{ sessionId: 's1', exKey: 'a', order: 0, done: true, type: 'normal', kg: 60, reps: 8 }];
  const h = buildHistory({ sessions: [s1], sets, bridge });
  assert.equal(h.previous('Bench Press (Smith Machine)').working[0].kg, 60, 'any session: the newest');
  assert.equal(h.previous('Bench Press (Smith Machine)', { routineId: 'push-normal', dayType: 'push' }).working[0].kg, 60);
  assert.equal(h.previous('Bench Press (Smith Machine)', { routineId: 'push-gbi', dayType: 'push' }).working[0].kg, 51.3, 'other routine skipped; Hevy Push matches by day type');
  assert.equal(h.previous('Bench Press (Smith Machine)', { routineId: null, dayType: 'legs' }).working.length, 0, 'never done on Legs');
  assert.equal(h.previous('Bench Press (Smith Machine)', { routineId: null, dayType: null }).working[0].kg, 60, 'empty session: any');
  assert.equal(sameRoutine({ routineId: 'x', dayType: 'push' }, { routineId: 'y', dayType: 'push' }), false);
});

test('a session logged in Training HQ becomes history, newer than the bridge', () => {
  const s = { id: 's1', status: 'done', startedAt: Date.parse('2026-10-18T04:30:00Z'), exercises: [{ key: 'a', name: 'Bench Press (Smith Machine)' }] };
  const sets = [{ sessionId: 's1', exKey: 'a', order: 0, done: true, type: 'normal', kg: 60, reps: 8 }, { sessionId: 's1', exKey: 'a', order: 1, done: false, type: 'normal', kg: 99, reps: 8 }];
  const h = buildHistory({ sessions: [s], sets, bridge });
  assert.equal(h.last('Bench Press (Smith Machine)').heaviest.kg, 60, 'unticked sets are not history');
  assert.equal(h.last('Bench Press (Smith Machine)').source, 'training-hq');
});

test('session gets the gym tag, and targets round to the plates he has', () => {
  const h = buildHistory({ bridge });
  const { session } = buildSession({ routine, meta, programmeRoutines, lib, history: h, today: '2026-10-18', now: 1000, gym: 'Gym A', smallestPlate: 5 });
  assert.equal(session.gym, 'Gym A');
  assert.equal(session.exercises[0].target.kg, 61.3, 'cap 66.69 with 5 kg as the smallest plate: 11.3 + 2 x 25');
  assert.equal(buildSession({ routine: null, meta, lib, history: h, today: '2026-10-18' }).session.gym, null);
});

test('session from a routine: capped targets, hold sets, rest times; Sunday 10/18 is Push week 4', () => {
  const h = buildHistory({ bridge });
  const { session, sets } = buildSession({ routine, meta, programmeRoutines, lib, history: h, today: '2026-10-18', now: 1000 });
  assert.equal(session.week, 4);
  assert.equal(session.status, 'active');
  const bench = session.exercises[0];
  assert.equal(bench.target.kg, 66.3);
  assert.equal(bench.restSeconds, 180);
  const benchSets = sets.filter((s) => s.exKey === bench.key);
  assert.equal(benchSets.length, 2);
  assert.ok(benchSets.every((s) => s.kg === 66.3 && s.reps === null && s.target.reps[0] === 6));
  const holds = sets.filter((s) => s.exKey === session.exercises[1].key);
  assert.deepEqual(holds.map((s) => [s.type, s.kg, s.durationS]), [['hold', 6.8, 30], ['hold', 6.8, 30], ['hold', 6.8, 30]]);
  assert.deepEqual(sets.map((s) => s.order), [0, 1, 2, 3, 4]);
});

test('summary: working sets only; elapsed time excludes pauses', () => {
  const session = { exercises: [{ key: 'a', type: 'weight_reps' }], startedAt: 0, pausedMs: 60_000, pausedAt: null, endedAt: null };
  const sets = [
    { exKey: 'a', type: 'warmup', kg: 31.3, reps: 8, done: true },
    { exKey: 'a', type: 'normal', kg: 66.3, reps: 8, done: true },
    { exKey: 'a', type: 'normal', kg: 66.3, reps: null, done: false },
    { exKey: 'a', type: 'hold', kg: 31.3, durationS: 30, done: true },
  ];
  assert.deepEqual(summarize(session, sets), { volume: 530, done: 1, total: 2 });
  assert.equal(elapsedMs(session, 3_600_000 + 60_000), 3_600_000);
  assert.equal(clock(3_723_000), '1:02:03');
  assert.equal(elapsedMs({ ...session, pausedAt: 100_000 }, 160_000), 0 + 160_000 - 60_000 - 60_000);
});

test('previous values line up by kind; ticking fills empty fields', () => {
  const prev = { warmup: [], working: [{ kg: 51.3, reps: 12 }, { kg: 41.3, reps: 12 }], hold: [{ kg: 31.3, durationS: 30 }] };
  const sets = [{ id: 'w', exKey: 'a', order: 0, type: 'warmup' }, { id: 'n1', exKey: 'a', order: 1, type: 'normal' }, { id: 'n2', exKey: 'a', order: 2, type: 'normal' }, { id: 'h1', exKey: 'a', order: 3, type: 'hold' }];
  assert.equal(previousFor(prev, sets, sets[0]), null);
  assert.deepEqual(previousFor(prev, sets, sets[2]), { kg: 41.3, reps: 12 });
  assert.deepEqual(previousFor(prev, sets, sets[3]), { kg: 31.3, durationS: 30 });
  assert.deepEqual(fillForTick({ type: 'normal', kg: 66.3, reps: null, target: { reps: [6, 8] } }, { kg: 51.3, reps: 12 }), { reps: 12 });
  assert.deepEqual(fillForTick({ type: 'normal', kg: null, reps: null, target: { reps: [6, 8] } }, null), { reps: 6 });
  assert.deepEqual(fillForTick({ type: 'hold', durationS: null }, null), { durationS: 30 });
});

test('exercise added mid-session starts from its last load', () => {
  const added = setsForAdded('s', { key: 'z', type: 'weight_reps' }, { kg: 20 }, 10);
  assert.equal(added.length, 2);
  assert.deepEqual(added.map((s) => [s.order, s.kg]), [[10, 20], [11, 20]]);
});

test('finish: skipped exercises are not a routine change and keep their sets', async () => {
  const { structureChanged, routineFromSession } = await import('../app/js/lib/finish.js');
  const routine = { id: 'r', title: 'Legs', exercises: [
    { key: 'x1', exerciseId: 'squat', plan: { routine: 'legs-gbi', name: 'Squat' }, sets: [] },
    { key: 'x2', exerciseId: 'abd', plan: null, sets: [{ type: 'normal', kg: 29, reps: [15, 15] }] },
  ] };
  const session = { title: 'Legs', exercises: [{ key: 'a', exerciseId: 'squat', name: 'Squat' }, { key: 'b', exerciseId: 'abd', name: 'Abd' }] };
  const sets = [{ exKey: 'a', done: true, type: 'normal', kg: 56.3, reps: 8, order: 0 }];
  assert.equal(structureChanged(session, sets, routine), false);
  const r = routineFromSession(session, sets, routine);
  assert.deepEqual(r.exercises[1].sets, routine.exercises[1].sets);
  assert.deepEqual(r.exercises[0].plan, routine.exercises[0].plan);
  const moreSets = [...sets, { exKey: 'b', done: true, type: 'normal', kg: 29, reps: 15, order: 1 }, { exKey: 'b', done: true, type: 'normal', kg: 29, reps: 15, order: 2 }];
  assert.equal(structureChanged(session, moreSets, routine), true, 'an extra set on abduction is a change');
  const withWarm = { ...routine, exercises: routine.exercises.map((e) => (e.key === 'x2' ? { ...e, warmup: true } : e)) };
  const warmed = [...sets, { exKey: 'b', done: true, type: 'warmup', kg: 15, reps: 8, order: 1 }, { exKey: 'b', done: true, type: 'normal', kg: 29, reps: 15, order: 2 }];
  assert.equal(structureChanged(session, warmed, withWarm), false, 'warm-ups made by the routine option are not a change');
  const again = routineFromSession(session, warmed, withWarm).exercises[1];
  assert.equal(again.warmup, true);
  assert.deepEqual(again.sets.map((x) => x.type), ['normal'], 'generated warm-ups are not saved into the routine');
});

test('typical session length: median of the last 3 of the same day type', async () => {
  const { typicalDurationMs } = await import('../app/js/lib/session.js');
  const bridge = { lastSessions: [
    { dayType: 'legs', start: '2026-10-10T04:53', end: '2026-10-10T06:07' },
    { dayType: 'push', start: '2026-10-12T10:54', end: '2026-10-12T12:02' },
    { dayType: 'legs', start: '2026-10-02T03:35', end: '2026-10-02T04:39' },
    { dayType: 'legs', start: '2026-09-28T03:52', end: '2026-09-28T04:29' },
    { dayType: 'legs', start: '2026-09-20T03:52', end: '2026-09-20T05:52' },
  ] };
  assert.equal(typicalDurationMs('legs', { bridge, now: Date.parse('2026-10-18T00:00') }) / 60000, 64, 'median of 74, 64, 37');
  assert.equal(typicalDurationMs('pull', { bridge }), null);
});

test('expected finish: history first, then today\'s pace after 3 ticked sets', async () => {
  const { expectedFinish } = await import('../app/js/lib/session.js');
  const start = Date.parse('2026-10-18T04:45:00');
  const session = { startedAt: start, pausedMs: 0, pausedAt: null, endedAt: null };
  const sets = Array.from({ length: 20 }, (_, i) => ({ done: i < 2 }));
  const now15 = start + 15 * 60000;
  const h = expectedFinish({ session, sets, typicalMs: 64 * 60000, now: now15 });
  assert.equal(h.basis, 'history');
  assert.equal(Math.round(h.leftMs / 60000), 58, 'max(64-15, 18 sets x 3.2 min)');
  const paced = expectedFinish({ session, sets: sets.map((s, i) => ({ done: i < 6 })), typicalMs: 64 * 60000, now: now15 });
  assert.equal(paced.basis, 'pace');
  assert.equal(Math.round(paced.leftMs / 60000), 35, '14 sets left at 2.5 min each');
  assert.equal(expectedFinish({ session, sets: [{ done: true }], now: now15 }).leftMs, 0);
  assert.equal(expectedFinish({ session, sets: [{ done: false }], now: now15 }).basis, 'estimate');
});

test('repeat a past session; supersets; rest only after the last exercise of a superset', async () => {
  const { copySession, supersetGroups, restAfter } = await import('../app/js/lib/session.js');
  const past = { id: 'p', title: 'Pull', status: 'done', exercises: [{ key: 'a', name: 'A', supersetId: 'ss1' }, { key: 'b', name: 'B', supersetId: 'ss1' }, { key: 'c', name: 'C' }] };
  const sets = [{ exKey: 'a', done: true, type: 'normal', kg: 20, reps: 12, order: 0 }, { exKey: 'a', done: false, type: 'normal', kg: 99, order: 1 }, { exKey: 'c', done: true, type: 'hold', kg: 9, durationS: 30, order: 2 }];
  const { session, sets: ns } = copySession(past, sets, 5);
  assert.equal(session.status, 'active');
  assert.equal(session.copiedFrom, 'p');
  assert.equal(ns.length, 2, 'only sets that were done');
  assert.deepEqual(ns.map((x) => [x.kg, x.reps, x.done, x.target.reps]), [[20, null, false, [12, 12]], [9, null, false, null]]);
  assert.ok(ns.every((x) => session.exercises.some((e) => e.key === x.exKey)));
  assert.deepEqual(session.exercises.map((e) => e.name), ['A', 'C'], 'exercises with nothing done are left out');
  const g = supersetGroups(past.exercises);
  assert.deepEqual([...g.values()], [{ letter: 'A', keys: ['a', 'b'] }]);
  assert.equal(restAfter(past.exercises, 'a'), false);
  assert.equal(restAfter(past.exercises, 'b'), true);
  assert.equal(restAfter(past.exercises, 'c'), true);
});

test('set timer: counts up, the target is a cue, stopping fills the seconds done', () => {
  const t = { startedAt: 1000, targetS: 30 };
  assert.deepEqual(setTimerView(t, 1000 + 12400), { elapsedS: 12, targetS: 30, reached: false, ready: false, text: '0:12 / 0:30' });
  assert.equal(setTimerView(t, 1000 + 30000).reached, true);
  assert.equal(setTimerView(t, 1000 + 95000).text, '1:35 / 0:30', 'keeps counting past the target');
  assert.equal(setTimerView({ startedAt: 0, targetS: 0 }, 61000).text, '1:01');
  assert.equal(setTimerResult(t, 1000 + 34600), 35);
  assert.equal(setTimerResult(t, 1000 + 200), 1);
});

test('record banner: a ticked set over the comeback best, not on a first-ever exercise, not twice for the same load', async () => {
  const { setRecord } = await import('../app/js/lib/finish.js');
  const h = buildHistory({ bridge });
  const set = (id, kg, type = 'normal') => ({ id, kg, reps: 8, type, done: true });
  const name = 'Bench Press (Smith Machine)';
  assert.deepEqual(setRecord({ set: set('a', 53.8), name, sessionId: 'x', history: h }), { kg: 53.8, reps: 8, previous: 51.3 });
  assert.equal(setRecord({ set: set('a', 51.3), name, sessionId: 'x', history: h }), null, 'equal is not a record');
  assert.equal(setRecord({ set: set('b', 53.8), name, sessionId: 'x', otherSets: [set('a', 53.8)], history: h }), null, 'already beaten today at that load');
  assert.deepEqual(setRecord({ set: set('b', 56.3), name, sessionId: 'x', otherSets: [set('a', 53.8)], history: h }).previous, 53.8);
  assert.equal(setRecord({ set: set('a', 99, 'warmup'), name, sessionId: 'x', history: h }), null, 'warm-ups never count');
  assert.equal(setRecord({ set: set('a', 99, 'hold'), name, sessionId: 'x', history: h }), null, 'holds never count');
  assert.equal(setRecord({ set: set('a', 99), name: 'Never Done Before', sessionId: 'x', history: h }), null, 'first-ever session');
  assert.equal(setRecord({ set: { ...set('a', 60), done: false }, name, sessionId: 'x', history: h }), null);
});

test('routine weights follow the last session set by set, or the routine own weights when switched off (P11)', () => {
  const s1 = { id: 's1', status: 'done', routineId: 'mine', dayType: 'push', startedAt: Date.parse('2026-10-18T04:30:00Z'), exercises: [{ key: 'a', name: 'Bench Press (Smith Machine)' }] };
  const done = [{ sessionId: 's1', exKey: 'a', order: 0, done: true, type: 'normal', kg: 60, reps: 8 }, { sessionId: 's1', exKey: 'a', order: 1, done: true, type: 'normal', kg: 55, reps: 10 }];
  const h = buildHistory({ sessions: [s1], sets: done, bridge });
  const mine = { id: 'mine', title: 'Mine', dayType: 'push', exercises: [{ key: 'k', exerciseId: 'bench-press-smith-machine', name: 'Bench Press (Smith Machine)', plan: null,
    sets: [{ type: 'normal', kg: 40, reps: [8, 8] }, { type: 'normal', kg: 40, reps: [8, 8] }, { type: 'normal', kg: 40, reps: [8, 8] }] }] };
  const kgs = (r) => buildSession({ routine: r, meta, lib, history: h, today: '2026-10-19' }).sets.map((s) => s.kg);
  assert.deepEqual(kgs(mine), [60, 55, 40], 'third set: nothing last time, keeps the routine weight');
  assert.deepEqual(kgs({ ...mine, followLast: false }), [40, 40, 40]);
});

test('warm-up sets in a routine are worked out from today\'s working weight with the Settings steps (P5)', () => {
  const h = buildHistory({ bridge });
  const withWarmup = { ...routine, exercises: routine.exercises.map((e, i) => (i === 0 ? { ...e, warmup: true } : e)) };
  const { session, sets } = buildSession({ routine: withWarmup, meta, programmeRoutines, lib, history: h, today: '2026-10-18' });
  const bench = sets.filter((s) => s.exKey === session.exercises[0].key);
  assert.deepEqual(bench.map((s) => [s.type, s.kg]), [['warmup', 31.3], ['warmup', 48.8], ['normal', 66.3], ['normal', 66.3]]);
  assert.deepEqual(bench[0].target.reps, [8, 8]);
  const custom = buildSession({ routine: withWarmup, meta, programmeRoutines, lib, history: h, today: '2026-10-18', warmupSteps: [{ pct: 60, reps: 5 }] }).sets;
  assert.equal(custom.filter((s) => s.type === 'warmup').length, 1);
  const plainRows = { id: 'p', title: 'P', exercises: [{ key: 'k', exerciseId: 'bench-press-smith-machine', name: 'Bench Press (Smith Machine)', plan: null, warmup: true,
    sets: [{ type: 'warmup', reps: [10, 10] }, { type: 'normal', kg: 60, reps: [8, 8] }] }] };
  assert.deepEqual(buildSession({ routine: { ...plainRows, followLast: false }, meta, lib, history: h, today: '2026-10-18' }).sets.map((s) => [s.type, s.kg]),
    [['warmup', 28.8], ['warmup', 43.8], ['normal', 60]], 'calculated warm-ups replace plain warm-up rows');
});

test('bodyweight (P20): volume and the 30% guard load for bodyweight exercises', async () => {
  const { guardLoad } = await import('../app/js/lib/session.js');
  assert.equal(guardLoad('weighted_bodyweight', 7.5, 78), 85.5);
  assert.equal(guardLoad('assisted_bodyweight', 20, 78), 58);
  assert.equal(guardLoad('reps_only', null, 78), null);
  assert.equal(guardLoad('weight_reps', 50, 78), 50, 'other types: the load itself');
  assert.equal(guardLoad('weighted_bodyweight', 7.5, null), 7.5, 'no bodyweight yet: the added load');
  const s = { exercises: [{ key: 'p', type: 'weighted_bodyweight' }], bodyweightKg: 80 };
  assert.equal(summarize(s, [{ exKey: 'p', type: 'normal', done: true, kg: 5, reps: 10 }]).volume, 850);
  assert.equal(summarize({ ...s, bodyweightKg: null }, [{ exKey: 'p', type: 'normal', done: true, kg: 5, reps: 10 }]).volume, 50);
  const { guardCheck } = await import('../app/js/lib/targets.js');
  const hist = [{ date: '2026-10-16', kg: guardLoad('weighted_bodyweight', 5, 78) }];
  assert.equal(guardCheck({ kg: guardLoad('weighted_bodyweight', 7.5, 78), capClass: 'main', history: hist, today: '2026-10-18' }), null, '+5 to +7.5 kg is 3%, not 50%');
});

test('check-in said lighter: previous week column, same sets, reps short; holds untouched', () => {
  const h = buildHistory({ bridge });
  const normal = buildSession({ routine, meta, programmeRoutines, lib, history: h, today: '2026-10-18', now: 1000 });
  assert.equal(normal.session.exercises[0].target.kg, 66.3);
  const { session, sets } = buildSession({ routine, meta, programmeRoutines, lib, history: h, today: '2026-10-18', now: 1000,
    lighter: { all: false, names: ['Bench Press (Smith Machine)'], params: { weeksBack: 1, week1Pct: 20, repsShort: 2 }, rule: 4 } });
  const t = session.exercises[0].target;
  assert.equal(t.kg, 56.3); // week 3 column 57.5, loadable on the 11.3 bar
  assert.deepEqual(t.reps, [4, 6]);
  assert.match(t.why, /lighter \(check-in\): week 3 column \(planned 66.3\)/);
  assert.equal(sets.filter((x) => x.exKey === session.exercises[0].key).length, 2);
  assert.deepEqual(session.lighter, { all: false, names: ['Bench Press (Smith Machine)'], rule: 4 });
  const holds = sets.filter((x) => x.exKey === session.exercises[1].key);
  assert.ok(holds.every((x) => x.type === 'hold' && x.kg === 6.8));
});
