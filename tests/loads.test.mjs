import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kg, platesPerSide, totalFromPlates, barFor } from '../app/js/lib/loads.js';

test('total and plates per side convert both ways (Smith bar 11.3 kg)', () => {
  assert.equal(platesPerSide(65, 11.3), 26.85);
  assert.equal(totalFromPlates(26.85, 11.3), 65);
  assert.equal(platesPerSide(31.3, 11.3), 10);
  assert.equal(platesPerSide(10, 11.3), null);
  assert.equal(kg(43.8), '43.8');
  assert.equal(kg(65), '65');
});

test('bar weight comes from the equipment setting', () => {
  const eq = { smith: { barKg: 11.3 } };
  assert.equal(barFor('Squat (Smith Machine)', eq), 11.3);
  assert.equal(barFor('Hip Thrust (Machine)', eq), null);
});
