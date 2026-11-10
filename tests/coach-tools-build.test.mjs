// Tue 11/10, his words: "you should be able to build the routines and everything and modify the app as much as you
// can. Do not always rely on the Mac... So you can form splits, workouts, modify". The coach had to send his Upper A /
// Upper B split to the Mac because it could only edit routines that existed. routine_build and split_plan build them.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { BUILD_TOOLS } from '../server/coach/tools-build.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { RULES } from '../server/coach/prompt.mjs';
import { contextLine } from '../server/coach/tools-read.mjs';
import { rotationDay, lastRotationSession, useBlock, LABEL, daysByDate, coversOf, isBlockType, inRotation } from '../app/js/lib/rotation.js';
import { projectRotation } from '../app/js/lib/scans.js';
import { holdsAfter } from '../app/js/lib/holds.js';
import { neckToday, neckTodayText } from '../app/js/lib/neck.js';
import { workingKeys } from '../app/js/lib/readiness.js';
import { capWorkingSets } from '../app/js/lib/session.js';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 10, 10, 9, 30); // Tuesday 11/10, 9:30 AM
const at = (iso, h = 5) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:00:00Z`);
let dir; let store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-build-'));
  store = openStore(join(dir, 'db.sqlite'));
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('folders', 'comeback', { id: 'comeback', title: 'The Comeback', order: 0 });
  w('folders', 'other', { id: 'other', title: 'Other', order: 2 });
  w('routines', 'pull-gbi', { id: 'pull-gbi', title: 'Pull', dayType: 'pull', folderId: 'comeback', order: 0, notes: '', exercises: [
    { key: 'a', exerciseId: 'lat-pulldown-cable', name: 'Lat Pulldown (Cable)', restSeconds: null, notes: '', plan: { routine: 'pull-gbi', name: 'Lat Pulldown (Cable)' }, sets: [] },
    { key: 'b', exerciseId: 'seated-cable-row-v-grip-cable', name: 'Seated Cable Row - V Grip (Cable)', restSeconds: null, notes: '', plan: null, sets: [{ type: 'normal', reps: [8, 10] }, { type: 'normal', reps: [8, 10] }] },
  ] });
  w('routines', 'push-gbi', { id: 'push-gbi', title: 'Push', dayType: 'push', folderId: 'comeback', order: 1, notes: '', exercises: [
    { key: 'c', exerciseId: 'bench-press-smith-machine', name: 'Bench Press (Smith Machine)', restSeconds: null, notes: '', plan: { routine: 'push-gbi', name: 'Bench Press (Smith Machine)' }, sets: [] },
    { key: 'd', exerciseId: 'triceps-pushdown', name: 'Triceps Pushdown', restSeconds: null, notes: '', plan: null, sets: [{ type: 'normal', reps: [10, 12] }, { type: 'normal', reps: [10, 12] }] },
  ] });
  w('routines', 'legs-gbi', { id: 'legs-gbi', title: 'Legs', dayType: 'legs', folderId: 'comeback', order: 2, notes: '', exercises: [
    { key: 'e', exerciseId: 'leg-press-machine', name: 'Leg Press (Machine)', restSeconds: null, notes: '', plan: { routine: 'legs-gbi', name: 'Leg Press' }, sets: [] },
  ] });
  w('routines', 'neck', { id: 'neck', title: 'Neck', dayType: 'neck', folderId: 'other', order: 0, notes: '', exercises: [] });
  w('schedule', 'neck', { planned: true, place: 'after-push' });
  w('tendons', 'area.shoulder', { kind: 'area', id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [
    { exercise: 'Bench Press (Smith Machine) · Hold', loadKg: 31.3, sets: 3, seconds: 30, timing: ['after Push'] },
    { exercise: 'Lateral Raise (Cable) · Hold', loadKg: 6.8, sets: 3, seconds: 30, timing: ['after Push', 'rest days'] },
  ] });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Leg Extension (Machine) · Hold', loadKg: 104, timing: ['after Legs'] }] });
  // Push Friday 11/6, Pull Saturday 11/7, Legs Monday 11/9: today would be Pull.
  const sess = (id, date, dayType) => w('sessions', id, { id, kind: 'workout', title: dayType, dayType, startedAt: at(date), endedAt: at(date, 6), status: 'done', exercises: [] });
  sess('s1', '2026-11-06', 'push'); sess('s2', '2026-11-07', 'pull'); sess('s3', '2026-11-09', 'legs');
});
afterEach(() => { useBlock(null); store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (name, args = {}, now = NOW) => BUILD_TOOLS.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => now, action: () => {} });
const rec = (col, id) => store.getRecord(col, id)?.data;
const list = (col) => store.listRecords(col).filter((r) => !r.deleted).map((r) => r.data);
const byTitle = (t) => list('routines').find((r) => r.title === t);
const dow = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T12:00:00Z`).getUTCDay()];

function buildUpperLower() {
  const a = call('routine_build', { action: 'create', title: 'Upper A', folder: 'Upper / Lower', day_type: 'Upper A', exercises: [
    { exercise: 'Bench Press (Smith Machine)' },
    { exercise: 'Seated Cable Row - V Grip (Cable)', sets: 2, reps_min: 8, reps_max: 10, kg: 50 },
    { exercise: 'Triceps Pushdown', sets: 2, reps_min: 10, reps_max: 12, superset: 'arms' },
    { exercise: 'Bicep Curl (Dumbbell)', sets: 2, reps_min: 10, reps_max: 12, superset: 'arms' },
    { exercise: 'Bench Press (Smith Machine) · Hold' },
    { exercise: 'Lateral Raise (Cable)', hold: true, seconds: 45 },
  ] });
  const b = call('routine_build', { action: 'copy', routine: 'Upper A', title: 'Upper B', day_type: 'Upper B' });
  const l = call('routine_build', { action: 'copy', routine: 'legs', title: 'Lower', folder: 'Upper / Lower', day_type: 'lower' });
  return { a, b, l };
}

test('the coach builds Upper A, Upper B and Lower itself: library exercises, sets, kg, holds, supersets, a new folder', () => {
  const { a, b, l } = buildUpperLower();
  assert.ok(a.wrote && b.wrote && l.wrote, a.text + b.text + l.text);
  const A = byTitle('Upper A');
  const folder = list('folders').find((f) => f.title === 'Upper / Lower');
  assert.ok(folder, 'a new folder');
  assert.equal(A.folderId, folder.id);
  assert.equal(A.dayType, 'upper-a');
  assert.deepEqual(A.exercises.map((e) => e.name), ['Bench Press (Smith Machine)', 'Seated Cable Row - V Grip (Cable)', 'Triceps Pushdown', 'Bicep Curl (Dumbbell)', 'Bench Press (Smith Machine) · Hold', 'Lateral Raise (Cable) · Hold']);
  // A Comeback lift given without sets keeps following the programme (week column, 30% cap at Start).
  assert.deepEqual(A.exercises[0].plan, { routine: 'push-gbi', name: 'Bench Press (Smith Machine)' });
  assert.deepEqual(A.exercises[1].sets, [{ type: 'normal', reps: [8, 10], kg: 50 }, { type: 'normal', reps: [8, 10], kg: 50 }]);
  assert.ok(A.exercises[2].supersetId && A.exercises[2].supersetId === A.exercises[3].supersetId, 'one superset');
  // Holds: his hold load and 3 × 30 s unless given; their own "· Hold" name; the tendon-hold role.
  assert.deepEqual(A.exercises[4].sets, [1, 2, 3].map(() => ({ type: 'hold', kg: 31.3, durationS: 30 })));
  assert.equal(A.exercises[4].role, 'tendon-hold');
  assert.deepEqual(A.exercises[5].sets.map((x) => [x.kg, x.durationS]), [[6.8, 45], [6.8, 45], [6.8, 45]]);
  assert.match(a.text, /Made Upper A in Upper \/ Lower \(new folder\): 6 exercises/);
  // The copies: their own day types; the originals keep theirs; Legs (his own routine) stays Legs.
  assert.equal(byTitle('Upper B').dayType, 'upper-b');
  assert.equal(byTitle('Upper B').exercises.length, 6);
  assert.equal(byTitle('Lower').dayType, 'lower');
  assert.equal(byTitle('Lower').folderId, folder.id);
  assert.equal(rec('routines', 'legs-gbi').dayType, 'legs');
  assert.equal(list('routines').length, 7);
});

test('then the split: Upper A, Lower, rest, Upper B, Lower, rest for two weeks, 1 working set; today Upper A; PPL after it', () => {
  buildUpperLower();
  const r = call('split_plan', { action: 'set', name: 'Upper/Lower', weeks: 2, working_sets: 1, at_end: 'ask', said: 'Upper A upper B. One working set for two weeks starting today',
    days: [{ type: 'Upper A' }, { type: 'Lower' }, { type: 'rest' }, { type: 'Upper B' }, { type: 'Lower' }, { type: 'rest' }] });
  assert.ok(r.wrote, r.text);
  assert.match(r.text, /Upper A, Lower, rest, Upper B, Lower, rest, repeating, from Tuesday 11\/10 to Monday 11\/23\. Next session: Upper A, Tuesday 11\/10/);
  assert.match(r.text, /Upper A takes the Pull \+ Push holds/);
  assert.match(r.text, /Lower takes the Legs holds/);
  assert.match(r.text, /On Monday 11\/23 I ask him/);
  const doc = rec('schedule', 'block');
  assert.deepEqual([doc.v, doc.from, doc.to, doc.then, doc.workingSets, doc.atEnd], [2, '2026-11-10', '2026-11-23', 'pull', 1, 'ask']);
  assert.deepEqual(doc.order, ['upper-a', 'lower', 'rest', 'upper-b', 'lower', 'rest']);
  // 1 working set on the split's routines, until its end; Pull, Push, Legs untouched.
  for (const t of ['Upper A', 'Upper B', 'Lower']) assert.deepEqual([byTitle(t).workingSets, byTitle(t).workingSetsUntil], [1, '2026-11-23'], t);
  for (const id of ['pull-gbi', 'push-gbi', 'legs-gbi']) assert.equal(rec('routines', id).workingSets, undefined);
  // The question at the end.
  assert.equal(rec('coach-questions', 'block-end').askAfter, '2026-11-23');
  // The rotation runs it, through the two weeks and out the other side.
  useBlock(doc);
  const last = lastRotationSession(list('sessions'), null, TZ);
  const days = projectRotation({ last, from: '2026-11-10', n: 16, days: {} });
  assert.deepEqual(days.map((d) => `${dow(d.date)} ${d.kind === 'rest' ? 'rest' : LABEL[d.dayType]}`), [
    'Tue Upper A', 'Wed Lower', 'Thu rest', 'Fri Upper B', 'Sat Lower', 'Sun rest',
    'Mon Upper A', 'Tue Lower', 'Wed rest', 'Thu Upper B', 'Fri Lower', 'Sat rest',
    'Sun Upper A', 'Mon Lower', 'Tue Pull', 'Wed rest',
  ]);
  // The coach sees it with every message.
  const ctx = contextLine({ store, tz: TZ, now: NOW });
  assert.match(ctx, /Training split: Upper\/Lower from Tuesday 11\/10 to Monday 11\/23: Upper A, Lower, rest, Upper B, Lower, rest, repeating/);
  // show
  assert.match(call('split_plan', { action: 'show' }).text, /Upper A: starts "Upper A" \(6 exercises\), covers Pull \+ Push.*Next: Upper A, Tuesday 11\/10/);
});

test('a split the coach built: holds, neck and the check-in follow what each day covers; neck can be planned onto a day', () => {
  call('routine_build', { action: 'create', title: 'Push Day', day_type: 'Push Day', exercises: [{ exercise: 'Bench Press (Smith Machine)' }] });
  call('routine_build', { action: 'create', title: 'Pull Day', day_type: 'Pull Day', exercises: [{ exercise: 'Lat Pulldown (Cable)' }] });
  call('routine_build', { action: 'create', title: 'Leg Day', day_type: 'Leg Day', exercises: [{ exercise: 'Leg Press (Machine)' }] });
  const r = call('split_plan', { action: 'set', name: 'Bro split', open: true, days: [{ type: 'Push Day', neck: false }, { type: 'Pull Day', neck: true }, { type: 'rest' }, { type: 'Leg Day' }, { type: 'rest' }, { type: 'rest' }] });
  assert.ok(r.wrote, r.text);
  assert.match(r.text, /until he ends it|It runs until he ends it/);
  const doc = rec('schedule', 'block');
  assert.equal(doc.to, null);
  assert.equal(rec('coach-questions', 'block-end'), undefined, 'no end, no question');
  useBlock(doc);
  assert.ok(isBlockType('push-day') && inRotation('leg-day'));
  assert.deepEqual(coversOf('push-day'), ['push']);
  assert.equal(LABEL['leg-day'], 'Leg Day');
  const areas = list('tendons').filter((x) => x.kind === 'area');
  assert.deepEqual(holdsAfter(areas, 'push-day').map((h) => h.exercise), ['Bench Press (Smith Machine) · Hold', 'Lateral Raise (Cable) · Hold']);
  assert.deepEqual(holdsAfter(areas, 'leg-day').map((h) => h.exercise), ['Leg Extension (Machine) · Hold']);
  assert.deepEqual(holdsAfter(areas, 'pull-day'), []);
  // His neck plan is after Push, but he planned it after Pull Day and never after Push Day.
  const neck = rec('schedule', 'neck');
  assert.equal(neckToday(neck, 'train', 'push-day'), false);
  assert.equal(neckToday(neck, 'train', 'pull-day'), true);
  assert.equal(neckToday(neck, 'rest', 'pull-day'), false);
  assert.equal(neckTodayText(neck.place, null, 'pull-day', 'train'), 'Neck after Pull Day today');
  assert.deepEqual(workingKeys({ workingArea: { legs: ['L', 'B'], pull: ['B'], push: [] } }, 'leg-day'), ['L', 'B']);
  // Two rest days after Leg Day; nothing ends it.
  const last = lastRotationSession(list('sessions'), null, TZ);
  const days = projectRotation({ last, from: '2026-11-10', n: 14, days: {} });
  assert.deepEqual(days.map((d) => (d.kind === 'rest' ? 'rest' : LABEL[d.dayType])), ['Push Day', 'Pull Day', 'rest', 'Leg Day', 'rest', 'rest', 'Push Day', 'Pull Day', 'rest', 'Leg Day', 'rest', 'rest', 'Push Day', 'Pull Day']);
});

test('a missed day carries over and his real sessions decide where the cycle is', () => {
  buildUpperLower();
  call('split_plan', { action: 'set', name: 'Upper/Lower', weeks: 2, days: [{ type: 'Upper A' }, { type: 'Lower' }, { type: 'rest' }, { type: 'Upper B' }, { type: 'Lower' }, { type: 'rest' }] });
  useBlock(rec('schedule', 'block'));
  const w = (id, date, dayType) => store.writeLocal('sessions', id, { id, kind: 'workout', dayType, startedAt: at(date), status: 'done', exercises: [] });
  w('u1', '2026-11-10', 'upper-a'); w('l1', '2026-11-11', 'lower');
  const last = lastRotationSession(list('sessions'), null, TZ);
  assert.equal(rotationDay({ last, today: '2026-11-12' }).today.kind, 'rest');
  assert.equal(rotationDay({ last, today: '2026-11-13' }).today.dayType, 'upper-b');
  assert.equal(rotationDay({ last, today: '2026-11-14' }).today.dayType, 'upper-b', 'skipped Friday: still Upper B');
  w('u2', '2026-11-14', 'upper-b'); w('l2', '2026-11-15', 'lower');
  const l2 = lastRotationSession(list('sessions'), null, TZ);
  assert.equal(rotationDay({ last: l2, today: '2026-11-16' }).today.kind, 'rest');
  assert.equal(rotationDay({ last: l2, today: '2026-11-17' }).today.dayType, 'upper-a', 'Lower after Upper B: Upper A next');
});

test('change, extend, end and programme-wide working sets', () => {
  buildUpperLower();
  call('split_plan', { action: 'set', name: 'Upper/Lower', weeks: 2, working_sets: 1, days: [{ type: 'Upper A' }, { type: 'Lower' }, { type: 'rest' }, { type: 'Upper B' }, { type: 'Lower' }, { type: 'rest' }] });
  // change: only the order; the rest stays.
  const c = call('split_plan', { action: 'change', days: [{ type: 'Upper A' }, { type: 'Upper B' }, { type: 'rest' }, { type: 'Lower' }, { type: 'rest' }] });
  assert.ok(c.wrote, c.text);
  const doc = rec('schedule', 'block');
  assert.deepEqual([doc.order, doc.to, doc.workingSets, doc.name], [['upper-a', 'upper-b', 'rest', 'lower', 'rest'], '2026-11-23', 1, 'Upper/Lower']);
  // A routine that joins the split later gets its 1 working set too.
  call('routine_build', { action: 'create', title: 'Upper C', day_type: 'Upper C', exercises: [{ exercise: 'Lat Pulldown (Cable)' }] });
  assert.equal(byTitle('Upper C').workingSets, undefined);
  call('split_plan', { action: 'change', days: [{ type: 'Upper A' }, { type: 'Upper B' }, { type: 'rest' }, { type: 'Lower' }, { type: 'rest' }, { type: 'Upper C' }, { type: 'rest' }] });
  assert.deepEqual([byTitle('Upper C').workingSets, byTitle('Upper C').workingSetsUntil], [1, '2026-11-23']);
  call('split_plan', { action: 'change', days: [{ type: 'Upper A' }, { type: 'Upper B' }, { type: 'rest' }, { type: 'Lower' }, { type: 'rest' }] });
  // extend: 2 more weeks, asked again at the new end.
  const e = call('split_plan', { action: 'extend', said: 'keep it' });
  assert.match(e.text, /runs on to Monday 12\/7/);
  assert.equal(rec('coach-questions', 'block-end').askAfter, '2026-12-07');
  // working sets for everything (PPL too) until Sunday 11/29; then off for Upper B only.
  const ws = call('split_plan', { action: 'working_sets', working_sets: 2, scope: 'all', until: '2026-11-29' });
  assert.match(ws.text, /2 working sets per exercise until Sunday 11\/29 in .*Pull.*Push.*Legs.*It only caps/);
  assert.deepEqual([rec('routines', 'pull-gbi').workingSets, rec('routines', 'pull-gbi').workingSetsUntil], [2, '2026-11-29']);
  call('split_plan', { action: 'working_sets', working_sets: 0, routines: ['Upper B'] });
  assert.equal(byTitle('Upper B').workingSets, undefined);
  // The cap only caps: 3 sets -> 2, warm-ups and holds stay; an exercise with 1 set keeps 1.
  const rows = [{ type: 'warmup' }, { type: 'normal' }, { type: 'normal' }, { type: 'normal' }];
  assert.equal(capWorkingSets(rows, { workingSets: 2 }, '2026-11-12').filter((x) => x.type === 'normal').length, 2);
  // end: Pull, Push, Legs from tomorrow.
  const end = call('split_plan', { action: 'end', said: 'back to PPL' });
  assert.ok(end.wrote, end.text);
  assert.match(end.text, /is over\. Next: Pull/);
  assert.ok(rec('coach-questions', 'block-end').answered);
});

test('what it refuses: delete without his words, his Pull/Push/Legs routines, a day with no routine, a past start, clashing names', () => {
  buildUpperLower();
  assert.match(call('routine_build', { action: 'delete', routine: 'Upper B' }).text, /needs his explicit words/);
  assert.match(call('routine_build', { action: 'delete', routine: 'Pull', said: 'delete pull' }).text, /stays/);
  assert.match(call('routine_build', { action: 'day_type', routine: 'Pull', day_type: 'Upper C' }).text, /keeps that/);
  assert.match(call('routine_build', { action: 'create', title: 'Pull B', day_type: 'pull', exercises: [{ exercise: 'Lat Pulldown (Cable)' }] }).text, /keeps its own routine/);
  assert.match(call('routine_build', { action: 'create', title: 'Upper A', exercises: [{ exercise: 'Lat Pulldown (Cable)' }] }).text, /already has a routine called Upper A/);
  assert.match(call('routine_build', { action: 'create', title: 'X', exercises: [{ exercise: 'Zzzz Nothing' }] }).text, /No exercise called/);
  assert.match(call('split_plan', { action: 'set', days: [{ type: 'Full Body' }, { type: 'rest' }] }).text, /No routine for Full Body yet/);
  assert.match(call('split_plan', { action: 'set', from: '2026-11-01', days: [{ type: 'Upper A' }] }).text, /today at the earliest/);
  assert.match(call('split_plan', { action: 'set', days: [{ type: 'Arms' }] }).text, /What does Arms hold/);
  assert.match(call('split_plan', { action: 'set', days: [{ type: 'rest' }] }).text, /at least one training day/);
  assert.equal(rec('schedule', 'block'), undefined, 'nothing written by a refusal');
  // A split day in use can't be deleted until the split changes; after that, on his words, it goes.
  call('split_plan', { action: 'set', weeks: 2, days: [{ type: 'Upper A' }, { type: 'Lower' }, { type: 'rest' }, { type: 'Upper B' }, { type: 'Lower' }, { type: 'rest' }] });
  assert.match(call('routine_build', { action: 'delete', routine: 'Upper B', said: 'delete upper b' }).text, /stays/);
  call('split_plan', { action: 'change', days: [{ type: 'Upper A' }, { type: 'Lower' }, { type: 'rest' }] });
  const d = call('routine_build', { action: 'delete', routine: 'Upper B', said: 'delete upper b' });
  assert.ok(d.wrote, d.text);
  assert.equal(byTitle('Upper B'), undefined);
});

test('rename, folders, notes, day types, adding several at once; a day can start one of his routines (copied when it has a type)', () => {
  buildUpperLower();
  assert.ok(call('routine_build', { action: 'rename', routine: 'Upper B', title: 'Upper B · Pull focus' }).wrote);
  assert.equal(byTitle('Upper B · Pull focus').dayType, 'upper-b');
  assert.ok(call('routine_build', { action: 'folder', routine: 'Upper A', folder: 'Blocks' }).wrote);
  assert.equal(byTitle('Upper A').folderId, list('folders').find((f) => f.title === 'Blocks').id);
  assert.ok(call('routine_build', { action: 'folder', folder: 'Blocks', title: 'Training blocks' }).wrote);
  assert.ok(list('folders').some((f) => f.title === 'Training blocks'));
  assert.ok(call('routine_build', { action: 'notes', routine: 'Lower', notes: 'Back OK first' }).wrote);
  assert.equal(byTitle('Lower').notes, 'Back OK first');
  const add = call('routine_build', { action: 'add', routine: 'Lower', exercises: [{ exercise: 'Leg Extension (Machine)', hold: true }, { exercise: 'Squat (Barbell)', sets: 1, reps_min: 5, reps_max: 5, kg: 60 }] });
  assert.ok(add.wrote, add.text);
  assert.deepEqual(byTitle('Lower').exercises.slice(-2).map((e) => e.name), ['Leg Extension (Machine) · Hold', 'Squat (Barbell)']);
  assert.equal(byTitle('Lower').exercises.at(-2).sets[0].kg, 104);
  // "Push" as a split day starts his own Push; a day naming the Pull routine gets a copy with its own type.
  const r = call('split_plan', { action: 'set', name: 'PPL + Upper', weeks: 1, days: [{ type: 'Push' }, { type: 'Pull Heavy', routine: 'Pull' }, { type: 'rest' }] });
  assert.ok(r.wrote, r.text);
  const copy = list('routines').find((x) => x.dayType === 'pull-heavy');
  assert.equal(copy.title, 'Pull Heavy');
  assert.equal(rec('routines', 'pull-gbi').dayType, 'pull');
  assert.match(r.text, /Pull Heavy is a copy of Pull/);
  assert.match(call('routine_build', { action: 'list' }).text, /Training blocks: Upper A \[upper-a\]/);
});

test('the coach is told to build training itself, not send it to the Mac', () => {
  assert.ok(TOOLS.some((t) => t.name === 'routine_build') && TOOLS.some((t) => t.name === 'split_plan'));
  assert.match(RULES, /routine_build/);
  assert.match(RULES, /split_plan/);
  assert.match(RULES, /never send it to the Mac/i);
});

test('the first Upper/Lower block (from before v2) still runs the same and can be changed', () => {
  store.writeLocal('schedule', 'block', { kind: 'block', name: 'Upper/Lower', from: '2026-11-10', to: '2026-11-23', order: ['upper-a', 'lower', 'upper-b', 'lower'], then: 'pull', workingSets: 1 });
  store.writeLocal('routines', 'upper-a', { id: 'upper-a', title: 'Upper A', dayType: 'upper-a', folderId: 'other', order: 5, exercises: [] });
  store.writeLocal('routines', 'upper-b', { id: 'upper-b', title: 'Upper B', dayType: 'upper-b', folderId: 'other', order: 6, exercises: [] });
  store.writeLocal('routines', 'lower', { id: 'lower', title: 'Lower', dayType: 'lower', folderId: 'other', order: 7, exercises: [] });
  assert.match(call('split_plan', { action: 'show' }).text, /Upper\/Lower: Upper A, Lower, rest, Upper B, Lower, rest, repeating/);
  const r = call('split_plan', { action: 'change', days: [{ type: 'Upper A' }, { type: 'Lower' }, { type: 'Upper B' }, { type: 'rest' }] });
  assert.ok(r.wrote, r.text);
  const doc = rec('schedule', 'block');
  assert.deepEqual([doc.v, doc.order, doc.to, doc.workingSets], [2, ['upper-a', 'lower', 'upper-b', 'rest'], '2026-11-23', 1]);
  useBlock(doc);
  const last = lastRotationSession(list('sessions'), null, TZ);
  assert.deepEqual(projectRotation({ last, from: '2026-11-10', n: 5, days: daysByDate([]) }).map((d) => (d.kind === 'rest' ? 'rest' : LABEL[d.dayType])), ['Upper A', 'Lower', 'Upper B', 'rest', 'Upper A']);
});
