import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platesFor, nearestLoad, warmupSets } from '../app/js/lib/plates.js';

test('plates per side, largest first', () => {
  assert.deepEqual(platesFor(20).plates, [20]);
  assert.deepEqual(platesFor(27.5).plates, [20, 5, 2.5]);
  assert.deepEqual(platesFor(22.5).plates, [20, 2.5]);
  const odd = platesFor(21.2);
  assert.deepEqual(odd.plates, [20]);
  assert.equal(odd.exact, false);
  assert.equal(odd.reached, 20);
  assert.deepEqual(platesFor(23.75, [20, 2.5, 1.25]).plates, [20, 2.5, 1.25]);
});

test('nearest loadable total on the Smith bar (11.3 kg)', () => {
  assert.deepEqual(nearestLoad(66.69, 11.3), { total: 66.3, perSide: 27.5, plates: [20, 5, 2.5] });
  assert.deepEqual(nearestLoad(53.7, 11.3), { total: 51.3, perSide: 20, plates: [20] });
  assert.deepEqual(nearestLoad(10, 11.3), { total: 11.3, perSide: 0, plates: [] });
});

test('warm-up sets: 50% x 8 and 75% x 4, loadable, under the working weight', () => {
  assert.deepEqual(warmupSets(66.3, { barKg: 11.3 }), [{ type: 'warmup', kg: 31.3, reps: 8 }, { type: 'warmup', kg: 48.8, reps: 4 }]);
  assert.deepEqual(warmupSets(20, { barKg: 11.3 }), [{ type: 'warmup', kg: 11.3, reps: 8 }, { type: 'warmup', kg: 13.8, reps: 4 }]);
  assert.deepEqual(warmupSets(36), [{ type: 'warmup', kg: 18, reps: 8 }, { type: 'warmup', kg: 27, reps: 4 }]);
  assert.deepEqual(warmupSets(null), []);
});
