// Sat 11/7, his words: "Why is there no animation when I'm on... toes wall squat hold": the hold timer screen shows the
// hold's demo. holdDemoIds picks which demo file belongs to a hold named in his tendon areas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { holdDemoIds } from '../app/js/lib/holds.js';

test('each hold name finds its hold demo first', () => {
  assert.equal(holdDemoIds('Toes Wall Squat Hold')[0], 'toes-wall-squat-hold');
  assert.equal(holdDemoIds('Leg Extension (Machine)')[0], 'leg-extension-hold-machine');
  assert.equal(holdDemoIds('Bench Press (Smith Machine)')[0], 'bench-press-hold-smith-machine');
  assert.equal(holdDemoIds('Lateral Raise (Cable)')[0], 'lateral-raise-hold-cable');
  assert.equal(holdDemoIds('Cupping')[0], 'cupping-hold');
});

test('then the plain name and the matched exercise id, no repeats', () => {
  assert.deepEqual(holdDemoIds('Toes Wall Squat Hold', 'toes-wall-squat-hold'), ['toes-wall-squat-hold']);
  assert.deepEqual(holdDemoIds('Leg Extension (Machine)', 'leg-extension-machine'), ['leg-extension-hold-machine', 'leg-extension-machine']);
  assert.deepEqual(holdDemoIds('Wall Sit', 'wall-sit-x'), ['wall-sit-hold', 'wall-sit', 'wall-sit-x']);
  assert.deepEqual(holdDemoIds('  toes   wall squat HOLD '), ['toes-wall-squat-hold']);
  assert.deepEqual(holdDemoIds('', 'abc'), ['abc']);
  assert.deepEqual(holdDemoIds(null), []);
});

test('the hold timer screen draws the demo under the timer and frees it on leave', () => {
  const src = readFileSync(new URL('../app/js/views/holds.js', import.meta.url), 'utf8');
  assert.match(src, /<div id="h-body"><\/div>\s*<div id="h-demo"><\/div>/);
  assert.match(src, /holdDemoIds\(hold\.exercise, ex\?\.id\)/);
  assert.match(src, /demoPanel\(view\.querySelector\('#h-demo'\)/);
  assert.match(src, /offDemo\(\);/);
});

// On the Mac with his private folder: every hold in his areas has a demo file it finds.
const priv = process.env.TRAINING_HQ_PRIVATE || `${process.env.HOME}/Documents/training-hq-private`;
const seed = `${priv}/data/seed/tendons.json`;
test('every hold in his tendon areas finds a demo file (Mac only)', { skip: !existsSync(seed) || !existsSync(`${priv}/data/demos`) }, () => {
  const files = new Set(readdirSync(`${priv}/data/demos`).map((f) => f.replace(/\.[a-z0-9]+$/, '')));
  const areas = JSON.parse(readFileSync(seed, 'utf8')).areas;
  const list = Array.isArray(areas) ? areas : areas.items || Object.values(areas);
  const holds = list.flatMap((a) => a.holds || []);
  assert.ok(holds.some((h) => h.exercise === 'Toes Wall Squat Hold'));
  for (const h of holds) assert.ok(holdDemoIds(h.exercise).some((id) => files.has(id)), `${h.exercise} has no demo`);
});
