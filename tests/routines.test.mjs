import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextDayType, newRoutine, duplicateRoutine, addExercises, removeExercise, moveExercise, replaceExercise,
  detachFromPlan, groupByFolder, moveFolder, setsSummary, defaultSets,
} from '../app/js/lib/routines.js';

const r0 = () => ({
  id: 'pull-gbi', title: 'Pull', folderId: 'comeback', order: 0, exercises: [
    { key: 'a', exerciseId: 'pull-up-weighted', name: 'Pull Up (Weighted)', plan: { routine: 'pull-gbi', name: 'Pull Up (Weighted)' }, sets: [] },
    { key: 'b', exerciseId: 'cupping', name: 'Cupping', plan: null, sets: [{ type: 'normal', reps: [12, 15] }] },
    { key: 'c', exerciseId: 'crunch-machine', name: 'Crunch (Machine)', plan: null, sets: [] },
  ],
});

test('rotation: Pull, Push, Legs, then Pull again after the rest day', () => {
  assert.equal(nextDayType('push'), 'legs');
  assert.equal(nextDayType('legs'), 'pull');
  assert.equal(nextDayType('pull'), 'push');
  assert.equal(nextDayType(null), 'pull');
});

test('duplicate keeps the programme link and gets new ids', () => {
  const d = duplicateRoutine(r0());
  assert.notEqual(d.id, 'pull-gbi');
  assert.equal(d.title, 'Pull (copy)');
  assert.deepEqual(d.exercises[0].plan, { routine: 'pull-gbi', name: 'Pull Up (Weighted)' });
  assert.ok(d.exercises.every((e, i) => e.key !== r0().exercises[i].key));
});

test('add several, remove, reorder, replace', () => {
  let r = addExercises(r0(), [{ id: 'plank', name: 'Plank', type: 'duration' }, { id: 'shrug-dumbbell', name: 'Shrug (Dumbbell)', type: 'weight_reps' }]);
  assert.equal(r.exercises.length, 5);
  assert.deepEqual(r.exercises[3].sets, defaultSets('duration'));
  r = moveExercise(r, 'c', -1);
  assert.deepEqual(r.exercises.map((e) => e.key).slice(0, 3), ['a', 'c', 'b']);
  assert.equal(moveExercise(r, 'a', -1), r, 'first one cannot move up');
  r = removeExercise(r, 'b');
  assert.ok(!r.exercises.some((e) => e.key === 'b'));
  r = replaceExercise(r, 'a', { id: 'lat-pulldown-cable', name: 'Lat Pulldown (Cable)', type: 'weight_reps' });
  assert.equal(r.exercises[0].name, 'Lat Pulldown (Cable)');
  assert.equal(r.exercises[0].plan, null, 'a replaced exercise no longer follows the programme');
});

test('detach from the plan gives explicit sets', () => {
  const r = detachFromPlan(r0(), 'a', [{ type: 'normal', reps: [6, 8] }, { type: 'normal', reps: [6, 8] }]);
  assert.equal(r.exercises[0].plan, null);
  assert.equal(r.exercises[0].sets.length, 2);
});

test('folders: grouping, loose routines last, reorder', () => {
  const folders = [{ id: 'b', title: 'Normal', order: 1 }, { id: 'a', title: 'Comeback', order: 0 }];
  const routines = [{ id: 'x', title: 'Legs', folderId: 'a', order: 2 }, { id: 'y', title: 'Pull', folderId: 'a', order: 0 }, { id: 'z', title: 'Loose', folderId: null }];
  const g = groupByFolder(folders, routines);
  assert.deepEqual(g.map((x) => x.folder?.id ?? null), ['a', 'b', null]);
  assert.deepEqual(g[0].routines.map((r) => r.id), ['y', 'x']);
  const changed = moveFolder(folders, 'b', -1);
  assert.deepEqual(changed.map((f) => [f.id, f.order]).sort(), [['a', 1], ['b', 0]]);
});

test('set summaries', () => {
  assert.equal(setsSummary([{ type: 'warmup' }, { type: 'normal', reps: [8, 12] }, { type: 'normal', reps: [8, 12] }]), '2 × 8-12');
  assert.equal(setsSummary([{ type: 'hold', durationS: 30 }, { type: 'hold', durationS: 30 }, { type: 'hold', durationS: 30 }]), '3 × 30 s');
  assert.equal(setsSummary([{ type: 'normal', reps: [20, 20] }]), '1 × 20');
  assert.equal(newRoutine({ title: 'X' }).exercises.length, 0);
});
