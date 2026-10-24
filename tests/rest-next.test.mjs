// Sat 10/24, his words at the gym: "The set is over and cupping is next. But clearly it's not... My next one is
// crunches." After his last cupping round the rest ended with "Rest over. Cupping: next set." It now names what the
// rest leads to: this exercise's next set, else the next exercise on the card (never a skipped one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAfter, nextAfterText, oneArmIn, armOf } from '../app/js/lib/session.js';
import { restBody } from '../server/rest-push.mjs';
import { runAction } from '../app/js/lib/coach.js';

const exercises = [
  { key: 'row', name: 'Seated Cable Row - V Grip (Cable)', type: 'weight_reps', skipped: true },
  { key: 'cup', name: 'Cupping', type: 'weight_reps', notes: '' },
  { key: 'crunch', name: 'Crunch (Machine)', type: 'weight_reps' },
  { key: 'ext', name: 'Back Extension (Weighted Hyperextension)', type: 'weighted_bodyweight' },
  { key: 'cup2', name: 'Cupping', type: 'weight_reps', notes: '30s hold' },
];
let order = 0;
const set = (exKey, o = {}) => ({ id: `s${++order}`, exKey, order, type: 'normal', done: false, ...o });
const card = () => {
  order = 0;
  return [
    set('row', { target: { kg: 57, reps: [8, 10] } }),
    ...[1, 2, 3, 4].map(() => set('cup', { target: { kg: 9, reps: [12, 15] } })),
    set('crunch', { target: { kg: 23, reps: [10, 15] } }), set('crunch', { target: { kg: 23, reps: [10, 15] } }),
    set('ext', { target: { kg: 5, reps: [10, 12] } }),
    set('cup2', { type: 'hold', durationS: 30, target: { kg: 9 } }),
  ];
};
const tick = (sets, ids) => sets.map((x) => (ids.includes(x.id) ? { ...x, done: true, kg: x.target?.kg, reps: 15 } : x));
const history = { all: (name) => (name === 'Cupping' ? [{ note: 'Single arm, desna pa leva' }] : []) };

test('after the last cupping round the rest leads to Crunch set 1, not Cupping (nor the second Cupping later)', () => {
  const sets = tick(card(), ['s2', 's3', 's4', 's5']);
  const n = nextAfter(exercises, sets, 'cup');
  assert.equal(n.ex.key, 'crunch');
  assert.equal(nextAfterText(n, sets, oneArmIn(history, n.ex.name, [n.ex.notes])), 'Crunch (Machine): set 1, 23 kg × 10-15');
  assert.equal(restBody('Cupping', nextAfterText(n, sets)), 'Rest over. Crunch (Machine): set 1, 23 kg × 10-15.');
});

test('one-arm cupping mid-way: right arm done says round 1 left arm; round 1 done says round 2 right arm', () => {
  let sets = tick(card(), ['s2']);
  const one = oneArmIn(history, 'Cupping', ['']);
  assert.equal(one, true, 'his past notes call cupping one-arm');
  assert.equal(nextAfterText(nextAfter(exercises, sets, 'cup'), sets, one), 'Cupping: round 1, left arm, 9 kg × 12-15');
  sets = tick(sets, ['s3']);
  assert.equal(nextAfterText(nextAfter(exercises, sets, 'cup'), sets, one), 'Cupping: round 2, right arm, 9 kg × 12-15');
  assert.deepEqual(armOf(sets.filter((x) => x.exKey === 'cup'), sets[3]), { round: 2, arm: 'right' });
});

test('a skipped exercise is never next; a bodyweight one says bodyweight; a hold says its seconds; all done says finish', () => {
  let sets = tick(card(), ['s2', 's3', 's4', 's5', 's6', 's7']);
  assert.equal(nextAfterText(nextAfter(exercises, sets, 'crunch'), sets), 'Back Extension (Weighted Hyperextension): set 1, bodyweight +5 kg × 10-12');
  sets = tick(sets, ['s8']);
  assert.equal(nextAfterText(nextAfter(exercises, sets, 'ext'), sets), 'Cupping: hold 30 s, 9 kg');
  sets = tick(sets, ['s9']);
  assert.equal(nextAfter(exercises, sets, 'cup2'), null, 'the skipped cable row is never next');
  assert.equal(nextAfterText(null, sets), 'Every set ticked: finish the workout');
  // Done out of order: the next one on the card after this exercise, then any left earlier.
  sets = tick(card(), ['s6', 's7']);
  assert.equal(nextAfter(exercises, sets, 'crunch').ex.key, 'ext');
  sets = tick(sets, ['s8', 's9']);
  assert.equal(nextAfter(exercises, sets, 'cup2').ex.key, 'cup');
});

test('the coach\'s rest action carries the next set to the phone\'s timer; older phones keep "<exercise>: next set"', () => {
  const started = [];
  runAction({ kind: 'rest', seconds: 120, label: 'Cupping', next: 'Crunch (Machine): set 1, 23 kg × 10-15' }, { rest: { start: (...a) => started.push(a) } });
  assert.deepEqual(started, [[120, 'Cupping', 'Crunch (Machine): set 1, 23 kg × 10-15']]);
  assert.equal(restBody('Cupping'), 'Rest over. Cupping: next set.');
});
