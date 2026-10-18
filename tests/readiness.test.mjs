import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, loadedAreas, exercisesLoading, askedAreas, lighterTarget, lighterKg, shortReps, complete, paramsOf } from '../app/js/lib/readiness.js';

const table = { workingArea: { legs: ['L', 'B'], pull: ['B'], push: [] } };
const areas = [
  { kind: 'area', id: 'shoulder', phase: 'fix', holds: [{}], loadsArea: { exercises: ['Press A', 'Raise B'] } },
  { kind: 'area', id: 'knees', phase: 'heal', holds: [{}], loadsArea: { exercises: ['Squat A', 'Extension B'] } },
  { kind: 'area', id: 'arms', phase: 'none', holds: [] },
];
const r = (o = {}) => ({ T: { shoulder: 0, knees: 0 }, W: { shoulder: false, knees: false }, L: 0, B: 0, E: 2, ...o });

test('areas asked and areas today loads', () => {
  assert.deepEqual(askedAreas(areas).map((a) => a.id), ['shoulder', 'knees']);
  assert.deepEqual(loadedAreas(areas, ['Squat A', 'Curl']), ['knees']);
  assert.deepEqual(exercisesLoading(areas, ['knees'], ['Squat A', 'Curl', 'Extension B']), ['Squat A', 'Extension B']);
});

test('rule 6: all ratings 0-1 and energy 2-3 trains as planned', () => {
  const d = decide({ table, ratings: r({ L: 1, B: 1, T: { shoulder: 1, knees: 1 } }), dayType: 'legs', loaded: ['knees'] });
  assert.equal(d.rule, 6);
  assert.equal(d.action, 'train');
  assert.deepEqual(d.easeHolds, []);
});

test('rule 1: worse than yesterday or T = 3 on a loaded area swaps to rest and holds', () => {
  assert.equal(decide({ table, ratings: r({ W: { shoulder: false, knees: true } }), dayType: 'legs', loaded: ['knees'] }).action, 'rest-holds');
  const d = decide({ table, ratings: r({ T: { shoulder: 0, knees: 3 } }), dayType: 'legs', loaded: ['knees'] });
  assert.equal(d.rule, 1);
  assert.deepEqual(d.easeHolds, ['knees']);
  // Not loaded today: train by rules 2-6, holds eased.
  const pull = decide({ table, ratings: r({ T: { shoulder: 0, knees: 3 } }), dayType: 'pull', loaded: ['shoulder'] });
  assert.equal(pull.action, 'train');
  assert.deepEqual(pull.easeHolds, ['knees']);
});

test('rules 2 and 3: move to tomorrow, once; then rest and holds', () => {
  assert.equal(decide({ table, ratings: r({ E: 0 }), dayType: 'push' }).action, 'move');
  assert.equal(decide({ table, ratings: r({ E: 0 }), dayType: 'push', movedYesterday: true }).action, 'rest-holds');
  const sore = decide({ table, ratings: r({ B: 3 }), dayType: 'pull' });
  assert.equal(sore.rule, 3);
  assert.equal(sore.action, 'move');
  // Push checks no soreness in the draft.
  assert.equal(decide({ table, ratings: r({ B: 3 }), dayType: 'push' }).action, 'train');
});

test('rules 4 and 5: lighter on the area, or lighter on everything; first match decides', () => {
  const area = decide({ table, ratings: r({ T: { shoulder: 2, knees: 0 }, E: 1 }), dayType: 'push', loaded: ['shoulder'] });
  assert.equal(area.rule, 4);
  assert.deepEqual(area.lighterAreas, ['shoulder']);
  assert.equal(decide({ table, ratings: r({ L: 2 }), dayType: 'legs', loaded: [] }).action, 'lighter-all');
  assert.equal(decide({ table, ratings: r({ E: 1 }), dayType: 'pull' }).rule, 5);
  // T = 2 on an area today doesn't load: no change.
  assert.equal(decide({ table, ratings: r({ T: { shoulder: 2, knees: 0 } }), dayType: 'legs', loaded: ['knees'] }).action, 'train');
});

test('rest day: holds eased for a sore area', () => {
  const d = decide({ table, ratings: { T: { shoulder: 3 }, W: { shoulder: false } }, dayType: null });
  assert.equal(d.action, 'rest');
  assert.deepEqual(d.easeHolds, ['shoulder']);
});

test('lighter: previous week column, same sets, 2 reps short; week 1 is 20% under', () => {
  const byWeek = { 1: { kg: 40, reps: [10, 12], sets: 2 }, 2: { kg: 50, reps: [8, 10], sets: 2 }, 3: { kg: 60, reps: [8, 10], sets: 3 } };
  const t3 = lighterTarget({ week: 3, targetAt: (w) => byWeek[w] });
  assert.deepEqual(t3, { kg: 50, reps: [6, 8], sets: 3, why: 'lighter (check-in): week 2 column' });
  const t1 = lighterTarget({ week: 1, targetAt: (w) => byWeek[w], barKg: 10, smallestPlate: 2.5 });
  assert.equal(t1.kg, 30); // 40 - 20% = 32: 10 bar + 2 x 10
  assert.deepEqual(t1.reps, [8, 10]);
  assert.equal(lighterKg(50), 40);
  assert.deepEqual(shortReps([2, 3], 2), [1, 1]);
  assert.equal(paramsOf({ params: { repsShort: 3 } }).repsShort, 3);
});

test('complete only when every asked rating is in', () => {
  assert.equal(complete(r(), ['shoulder', 'knees'], ['L', 'B']), true);
  assert.equal(complete({ T: { shoulder: 0 }, W: { shoulder: false }, E: 2 }, ['shoulder', 'knees'], []), false);
  assert.equal(complete({ T: { shoulder: 0 }, W: { shoulder: false } }, ['shoulder'], []), false);
});
