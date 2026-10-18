// Importer (3.1-3.5) with made-up files in each app's real column layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, detectSource, wallTime, zonedToMs, durationSeconds, readHevy, readStrong, applyRules, DEFAULT_RULES,
  dayTypeOf, matchExercises, newExerciseFromImport, readExport, planImport, summarizePlan, sessionIdFor, hashId,
} from '../app/js/lib/import.js';
import { mergeLibrary } from '../app/js/lib/library.js';

const HEVY_HEAD = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';
const hevyRow = (o) => [o.title ?? 'Push', o.start ?? '3 Mar 2025, 06:10', o.end ?? '3 Mar 2025, 07:05', o.desc ?? '', o.ex, o.ss ?? '', o.note ?? '', o.i, o.type ?? 'normal', o.kg ?? '', o.reps ?? '', '', o.dur ?? '', o.rpe ?? '']
  .map((v, i) => ([5, 7, 9, 10, 11, 12, 13].includes(i) ? String(v) : `"${String(v).replace(/"/g, '""')}"`)).join(',');

const HEVY = [
  HEVY_HEAD,
  hevyRow({ desc: 'Felt "good"', ex: 'Bench Press (Barbell)', note: 'Seat 4\\nGrip wide', i: 0, type: 'warmup', kg: 40, reps: 10 }),
  hevyRow({ ex: 'Bench Press (Barbell)', note: 'Seat 4\\nGrip wide', i: 1, kg: 60, reps: 8, rpe: 8 }),
  hevyRow({ ex: 'Bench Press (Barbell)', note: 'Seat 4\\nGrip wide', i: 2, type: 'dropset', kg: 50, reps: 6 }),
  // Same exercise again as its own block (set numbers start at 0 again): a hold block by its note.
  hevyRow({ ex: 'Bench Press (Barbell)', note: '30s hold for the shoulder', i: 0, kg: 30, reps: 10 }),
  hevyRow({ ex: 'Bench Press (Barbell)', note: '30s hold for the shoulder', i: 1, kg: 30, reps: 10 }),
  hevyRow({ ex: 'Leg Extension (Machine)', note: 'hold 3s on the last rep', i: 0, kg: 40, reps: 10 }),
  hevyRow({ ex: 'Triceps Pushdown', ss: 0, i: 0, kg: 20, reps: 12 }),
  hevyRow({ ex: 'Lateral Raise (Dumbbell)', ss: 0, i: 0, type: 'failure', kg: 8, reps: 15 }),
  hevyRow({ ex: 'Plank', i: 0, dur: 60 }),
  hevyRow({ ex: 'Plank', i: 1, dur: 45 }),
  hevyRow({ title: 'Pull', start: '5 Mar 2025, 06:00', end: '5 Mar 2025, 06:50', ex: 'My Odd Row', i: 0, kg: 35, reps: 10 }),
  hevyRow({ title: 'Pull', start: '5 Mar 2025, 06:00', end: '5 Mar 2025, 06:50', ex: 'Pull Up (Weighted)', i: 0, reps: 8 }),
].join('\n');

const STRONG = [
  '"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (lbs)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"',
  '"1";"2022-01-10 17:30:00";"Legs(8 reps)";"3600";"Squat (Barbell)";"Note";"";"";"";"";"";"Low bar";"Busy gym"',
  '"1";"2022-01-10 17:30:00";"Legs(8 reps)";"3600";"Squat (Barbell)";"W";"95.0";"5";"";"";"";"";"Busy gym"',
  '"1";"2022-01-10 17:30:00";"Legs(8 reps)";"3600";"Squat (Barbell)";"1";"225.0";"8";"";"";"";"";"Busy gym"',
  '"1";"2022-01-10 17:30:00";"Legs(8 reps)";"3600";"Squat (Barbell)";"2";"225.0";"7";"";"";"";"";"Busy gym"',
  '"1";"2022-01-10 17:30:00";"Legs(8 reps)";"3600";"Squat (Barbell)";"F";"185.0";"0";"";"";"";"";"Busy gym"',
  '"1";"2022-01-10 17:30:00";"Legs(8 reps)";"3600";"Running";"1";"";"";"";"2000";"600";"";"Busy gym"',
  '"2";"2022-01-12 08:00:00";"Upper 1";"1h 5m";"Pull Up";"1";"0.0";"10";"";"";"";"";""',
].join('\n');

const lib = mergeLibrary([]);

test('CSV: quotes, doubled quotes, separator from the header', () => {
  const a = parseCsv('"a","b"\n"x, y","say ""hi"""\n');
  assert.deepEqual(a.rows, [{ a: 'x, y', b: 'say "hi"' }]);
  const b = parseCsv('"a";"b"\r\n"1";"2;3"\r\n');
  assert.deepEqual(b.rows, [{ a: '1', b: '2;3' }]);
  assert.equal(detectSource(parseCsv(HEVY).header), 'hevy');
  assert.equal(detectSource(parseCsv(STRONG).header), 'strong');
  assert.equal(detectSource(['date', 'weight']), null);
  assert.throws(() => readExport('"date","weight"\n"1","2"'), /not a Hevy or Strong/);
});

test('dates: each app\'s format to local wall time, then to an instant in the chosen time zone', () => {
  assert.equal(wallTime('10 Oct 2026, 04:53'), '2026-10-10T04:53:00');
  assert.equal(wallTime('Oct 10, 2026, 4:53 PM'), '2026-10-10T16:53:00');
  assert.equal(wallTime('2022-11-09 16:10:39'), '2022-11-09T16:10:39');
  assert.equal(wallTime('yesterday'), null);
  assert.equal(new Date(zonedToMs('2026-10-10T04:53:00', 'Asia/Bangkok')).toISOString(), '2026-10-09T21:53:00.000Z');
  // Daylight saving: New York is UTC-4 in July and UTC-5 in January.
  assert.equal(new Date(zonedToMs('2025-07-01T06:00:00', 'America/New_York')).toISOString(), '2025-07-01T10:00:00.000Z');
  assert.equal(new Date(zonedToMs('2025-01-15T06:00:00', 'America/New_York')).toISOString(), '2025-01-15T11:00:00.000Z');
  assert.equal(durationSeconds('2723'), 2723);
  assert.equal(durationSeconds('1h 5m'), 3900);
  assert.equal(durationSeconds(''), null);
});

test('Hevy: blocks, set types, notes, supersets, duration sets', () => {
  const ws = readHevy(parseCsv(HEVY));
  assert.equal(ws.length, 2);
  const push = ws[0];
  assert.equal(push.start, '2025-03-03T06:10:00');
  assert.equal(push.end, '2025-03-03T07:05:00');
  assert.equal(push.note, 'Felt "good"');
  assert.deepEqual(push.blocks.map((b) => b.name), ['Bench Press (Barbell)', 'Bench Press (Barbell)', 'Leg Extension (Machine)', 'Triceps Pushdown', 'Lateral Raise (Dumbbell)', 'Plank']);
  assert.equal(push.blocks[0].note, 'Seat 4\nGrip wide');
  assert.deepEqual(push.blocks[0].sets.map((s) => s.type), ['warmup', 'normal', 'dropset']);
  assert.equal(push.blocks[0].sets[1].rpe, 8);
  assert.equal(push.blocks[3].supersetKey, '0');
  assert.equal(push.blocks[4].sets[0].type, 'failure');
  assert.deepEqual(push.blocks[5].sets.map((s) => s.durationS), [60, 45]);
  assert.equal(ws[1].blocks[1].sets[0].kg, null);
});

test('Hevy in pounds is stored in kg', () => {
  const text = HEVY.replace('"weight_kg"', '"weight_lbs"');
  const ws = readHevy(parseCsv(text));
  assert.equal(ws[0].blocks[0].sets[1].kg, 27.22);
});

test('Strong: W/F markers, note rows, pounds to kg, duration gives the end time, distance and seconds', () => {
  const ws = readStrong(parseCsv(STRONG));
  assert.equal(ws.length, 2);
  const legs = ws[0];
  assert.equal(legs.note, 'Busy gym');
  assert.equal(legs.end, '2022-01-10T18:30:00');
  assert.equal(legs.blocks[0].note, 'Low bar');
  assert.deepEqual(legs.blocks[0].sets.map((s) => [s.type, s.kg, s.reps]), [['warmup', 43.09, 5], ['normal', 102.06, 8], ['normal', 102.06, 7], ['failure', 83.91, 0]]);
  assert.deepEqual([legs.blocks[1].sets[0].distanceM, legs.blocks[1].sets[0].durationS], [2000, 600]);
  assert.equal(ws[1].end, '2022-01-12T09:05:00');
});

test('rules: a "30s hold" note makes hold sets; a pause on the last rep does not; set rules and not-done blocks', () => {
  const [push] = readHevy(parseCsv(HEVY));
  const r = applyRules(push, DEFAULT_RULES);
  assert.equal(r.holds, 2);
  const holdBlock = r.workout.blocks[1];
  assert.deepEqual(holdBlock.sets.map((s) => [s.type, s.kg, s.reps, s.importedAs, s.durationS]), [['hold', 30, null, 'x 10', null], ['hold', 30, null, 'x 10', null]]);
  assert.equal(r.workout.blocks[2].sets[0].type, 'normal');

  const set = applyRules(push, { ...DEFAULT_RULES, holdNote: null, holdSets: [{ exercise: 'Bench Press (Barbell)', kg: 30, reps: 10, afterHeavier: true }] });
  assert.equal(set.holds, 0, 'the hold block restarts its set numbers, so "after a heavier set" is within the block');
  const one = applyRules({ ...push, blocks: [{ name: 'X', note: '', sets: [{ index: 0, type: 'normal', kg: 50, reps: 5 }, { index: 1, type: 'normal', kg: 30, reps: 10 }] }] },
    { holdSets: [{ exercise: 'X', kg: 30, reps: 10, afterHeavier: true }] });
  assert.deepEqual(one.workout.blocks[0].sets.map((s) => s.type), ['normal', 'hold']);
  const minKg = applyRules({ ...push, blocks: [{ name: 'Y', note: '', sets: [{ index: 0, kg: 99, reps: 1 }, { index: 1, kg: 120, reps: 1 }, { index: 2, kg: 120, reps: 8 }] }] },
    { holdSets: [{ exercise: 'Y', minKg: 100, reps: 1 }] });
  assert.deepEqual(minKg.workout.blocks[0].sets.map((s) => s.type), [undefined, 'hold', undefined]);

  const nd = applyRules(push, { ...DEFAULT_RULES, notDoneNote: 'skipped it' });
  assert.equal(nd.dropped, 0);
  const nd2 = applyRules(push, { ...DEFAULT_RULES, notDone: [{ date: '2025-03-03', exercise: 'Bench Press (Barbell)', holdBlock: true }] });
  assert.equal(nd2.dropped, 1);
  assert.equal(nd2.workout.blocks.filter((b) => b.name === 'Bench Press (Barbell)').length, 1);
});

test('day types from titles', () => {
  assert.equal(dayTypeOf('Pull+'), 'pull');
  assert.equal(dayTypeOf('Legs(8 reps)'), 'legs');
  assert.equal(dayTypeOf('Lower 2'), 'legs');
  assert.equal(dayTypeOf('Push'), 'push');
  assert.equal(dayTypeOf('Neck'), 'neck');
  assert.equal(dayTypeOf('Push+Legs'), null);
  assert.equal(dayTypeOf('Upper 1'), null);
});

test('matching: remembered, same name, or new with suggestions; new exercises get a type from the sets', () => {
  const m = matchExercises(['bench press (barbell)', 'Smith Machine Squat', 'Old Name', 'Zzz'], lib, { 'Old Name': 'squat-barbell' });
  assert.deepEqual(m.map((x) => [x.how, x.id]), [['same name', 'bench-press-barbell'], ['new', null], ['remembered', 'squat-barbell'], ['new', null]]);
  assert.equal(m[1].suggestions[0].name, 'Squat (Smith Machine)');
  assert.deepEqual(m[3].suggestions, []);
  const row = newExerciseFromImport('My Odd Row', [{ kg: 35, reps: 10 }], { library: lib, source: 'hevy' });
  assert.deepEqual([row.id, row.type, row.primary, row.source], ['my-odd-row', 'weight_reps', 'upper_back', 'import']);
  assert.equal(newExerciseFromImport('Leg Raise Thing', [{ kg: null, reps: 10 }]).type, 'reps_only');
  assert.equal(newExerciseFromImport('Dip (Weighted)', [{ kg: null, reps: 8 }]).type, 'weighted_bodyweight');
  assert.equal(newExerciseFromImport('Farmer Hold', [{ kg: 30, durationS: 40 }]).type, 'weight_duration');
  const close = newExerciseFromImport('Smith Machine Squat', [{ kg: 60, reps: 8 }], { suggestion: m[1].suggestions[0], library: lib });
  assert.deepEqual([close.primary, close.equipment], ['quadriceps', 'smith']);
});

const resolveAll = (workouts) => {
  const names = [...new Set(workouts.flatMap((w) => w.blocks.map((b) => b.name)))];
  const m = matchExercises(names, lib);
  return new Map(m.map((x) => [x.name, x.id ? lib.find((e) => e.id === x.id) : newExerciseFromImport(x.name, [])]));
};

test('plan: sessions and sets with stable ids, holds kept, supersets grouped, everything ticked', () => {
  const r = readExport(HEVY);
  const plan = planImport({ source: 'hevy', workouts: r.workouts, tz: 'Asia/Bangkok', resolve: resolveAll(r.workouts), importId: 'imp.1' });
  assert.equal(plan.sessions.length, 2);
  const s = plan.sessions[0];
  assert.equal(s.id, sessionIdFor('hevy', r.workouts[0]));
  assert.match(s.id, /^hevy\.[0-9a-f]{16}$/);
  assert.equal(hashId('a'), hashId('a'));
  assert.equal(s.dayType, 'push');
  assert.equal(s.status, 'done');
  assert.equal(s.source, 'hevy');
  assert.equal(new Date(s.startedAt).toISOString(), '2025-03-02T23:10:00.000Z');
  assert.equal(s.endedAt - s.startedAt, 55 * 60000);
  const ss = s.exercises.filter((e) => e.supersetId);
  assert.equal(ss.length, 2);
  assert.equal(ss[0].supersetId, ss[1].supersetId);
  const mine = plan.sets.filter((x) => x.sessionId === s.id);
  assert.equal(mine.length, 10);
  assert.ok(mine.every((x, i) => x.done && x.order === i && x.id === `${s.id}.${i}`));
  assert.equal(mine.filter((x) => x.type === 'hold').length, 2);
  const sum = summarizePlan(plan);
  assert.deepEqual([sum.sessions, sum.sets, sum.holds, sum.skipped], [2, 12, 2, 0]);
});

test('plan: matched names are stored under the library name, the file name kept beside it', () => {
  const r = readExport(HEVY);
  const resolve = resolveAll(r.workouts);
  resolve.set('My Odd Row', lib.find((e) => e.id === 'seated-cable-row-v-grip-cable') || lib[0]);
  const plan = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, importId: 'imp.1' });
  const e = plan.sessions[1].exercises[0];
  assert.equal(e.importedName, 'My Odd Row');
  assert.notEqual(e.name, 'My Odd Row');
});

test('no duplicates: same file again, deleted sessions, and sessions at the same time from another source', () => {
  const r = readExport(HEVY);
  const resolve = resolveAll(r.workouts);
  const first = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, importId: 'imp.1' });
  const again = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, existing: first.sessions, importId: 'imp.2' });
  assert.equal(again.sessions.length, 0);
  assert.deepEqual(again.skipped.map((x) => x.reason), ['already imported', 'already imported']);

  const deleted = first.sessions.map((s, i) => (i === 0 ? { id: s.id, deleted: true } : s));
  const third = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, existing: deleted, importId: 'imp.3' });
  assert.deepEqual(third.skipped.map((x) => x.reason), ['deleted in Training HQ', 'already imported']);
  const undone = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, existing: deleted, restorable: new Set([first.sessions[0].id]), importId: 'imp.4' });
  assert.equal(undone.sessions.length, 1);

  // A Training HQ session logged 10 minutes after the Hevy one started: the Hevy one is skipped.
  const own = { id: 'session-x', title: 'Push', source: 'training-hq', status: 'done', startedAt: first.sessions[0].startedAt + 10 * 60000, endedAt: first.sessions[0].startedAt + 70 * 60000 };
  const clash = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, existing: [own], importId: 'imp.5' });
  assert.equal(clash.sessions.length, 1);
  assert.equal(clash.skipped[0].reason, 'same time as a session already in Training HQ');
  assert.equal(clash.skipped[0].clash.id, 'session-x');
  // An unfinished session doesn't block anything.
  const active = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve, existing: [{ ...own, status: 'active' }], importId: 'imp.6' });
  assert.equal(active.sessions.length, 2);
});

test('plan: two workouts at the same time in one file are both kept', () => {
  const text = [HEVY_HEAD,
    hevyRow({ title: 'A', start: '1 Jan 2025, 06:00', end: '1 Jan 2025, 07:00', ex: 'Squat (Barbell)', i: 0, kg: 60, reps: 5 }),
    hevyRow({ title: 'B', start: '1 Jan 2025, 06:20', end: '1 Jan 2025, 06:40', ex: 'Plank', i: 0, dur: 30 })].join('\n');
  const r = readExport(text);
  const plan = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve: resolveAll(r.workouts), importId: 'i' });
  assert.equal(plan.sessions.length, 2);
});

test('plan: a workout whose only block was not done is skipped with the reason', () => {
  const text = [HEVY_HEAD, hevyRow({ title: 'Push', ex: 'Squat (Barbell)', note: 'reminder, not done', i: 0, kg: 60, reps: 5 })].join('\n');
  const r = readExport(text, { rules: { notDoneNote: 'not done' } });
  assert.equal(r.dropped, 1);
  const plan = planImport({ source: 'hevy', workouts: r.workouts, tz: 'UTC', resolve: new Map(), importId: 'i' });
  assert.deepEqual(plan.skipped.map((x) => x.reason), ['no sets done']);
});
