import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { raeFrom } from '../scripts/build-usda.mjs';

test('vitamin A without an RAE value: from retinol and carotenoids, unknown rather than 0', () => {
  // His Greek yogurt (Foundation Foods 2259794) gives only retinol.
  assert.equal(raeFrom({ 1105: 38.13 }), 38.13);
  // Both measured: retinol + beta-carotene / 12 + alpha-carotene / 24 + beta-cryptoxanthin / 24.
  assert.equal(raeFrom({ 1105: 10, 1107: 120, 1108: 24, 1120: 48 }), 10 + 10 + 1 + 2);
  // Beta-carotene from its cis and trans parts.
  assert.equal(raeFrom({ 1105: 0, 1159: 12, 2028: 24 }), 3);
  // A plant with carotenoids only.
  assert.equal(raeFrom({ 1107: 600 }), 50);
  // Nothing to go on, retinol 0 with no carotenoid data, carotenoids 0 with retinol not measured: unknown.
  assert.equal(raeFrom({}), null);
  assert.equal(raeFrom({ 1105: 0 }), null);
  assert.equal(raeFrom({ 1107: 0, 1108: 0 }), null);
});

test('the bundled database has the Greek yogurt\'s vitamin A', () => {
  const db = JSON.parse(readFileSync(new URL('../app/data/usda-foods.json', import.meta.url), 'utf8'));
  const i = db.nutrients.findIndex((n) => n.key === 'vitA');
  assert.equal(db.foods.find((f) => f[0] === 2259794)[4][i], 38.13);
});
