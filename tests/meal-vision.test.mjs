import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openMealVision, readAnswer, promptText, MAX_TRIES } from '../server/meal-vision.mjs';
import { parseJsonAnswer, findClaude, runOnce, imageBlock } from '../server/claude.mjs';
import { newMeal } from '../app/js/lib/meals.js';

let dir; let store; let clock;
const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-vision-')); store = openStore(join(dir, 'db.sqlite')); clock = 1_000_000; });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const put = (col, id, data) => store.writeLocal(col, id, data);
const est = (id) => store.getRecord('meal-estimates', id)?.data;
function addMeal(id, extra = {}) {
  put('meal-photos', `${id}-p1`, { id: `${id}-p1`, mealId: id, kind: 'before', dataUrl: JPEG, at: clock });
  put('meals', id, { ...newMeal({ id, at: clock, photoId: `${id}-p1`, name: 'Lunch', tz: 'UTC' }), ...extra });
}
const BEFORE = JSON.stringify({ scaleGrams: 412, items: [{ name: 'Rice', grams: 212, kcal: 276, protein: 5.7 }, { name: 'Beef', grams: 200, kcal: 330, protein: 62, unsure: true }], notes: '' });

test('JSON answers are found inside fences and words', () => {
  assert.deepEqual(parseJsonAnswer('Here:\n```json\n{"a": {"b": "}"}}\n```'), { a: { b: '}' } });
  assert.throws(() => parseJsonAnswer('no json'), /no JSON/);
  const r = readAnswer('after', '{"scaleGrams": 0, "leftovers": [{"index": 0, "grams": 999}, {"name": "beef", "grams": 20}, {"index": 7, "grams": 5}]}', [{ name: 'Rice', grams: 212 }, { name: 'Beef', grams: 200 }]);
  assert.deepEqual(r.leftovers, [{ index: 0, name: 'Rice', grams: 212 }, { index: 1, name: 'Beef', grams: 20 }]);
  assert.equal(r.scaleG, null);
  assert.throws(() => readAnswer('before', '{"scaleGrams": 3}'), /no items/);
});

test('a before photo is read once and the estimate is written beside the meal', async () => {
  put('fuel', 'plan', { foods: [{ name: 'Lean beef (bottom sirloin tri-tip)' }] });
  addMeal('m1');
  const calls = [];
  const v = openMealVision({ store, now: () => clock, run: async (q) => { calls.push(q); return { text: BEFORE, ms: 5 }; } });
  assert.equal(await v.kick(), 1);
  assert.equal(await v.kick(), 0);
  const e = est('m1.before');
  assert.equal(e.status, 'done');
  assert.equal(e.scaleG, 412);
  assert.equal(e.items.length, 2);
  assert.equal(e.items[1].unsure, true);
  assert.equal(e.photoId, 'm1-p1');
  assert.equal(calls[0].content[0].type, 'image');
  assert.match(calls[0].content[1].text, /Lean beef \(bottom sirloin tri-tip\)/);
  assert.equal(calls[0].model, 'claude-sonnet-5-5');
  // The meal itself is never written by the Mac.
  assert.equal(store.historyFor('meals', 'm1').length, 1);
});

test('a photo that has not arrived yet waits; Opus when chosen in Settings', async () => {
  put('meals', 'm2', newMeal({ id: 'm2', at: clock, photoId: 'missing', name: 'Lunch', tz: 'UTC' }));
  put('settings', 'main', { fuel: { visionModel: 'deep' } });
  const models = [];
  const v = openMealVision({ store, now: () => clock, run: async (q) => { models.push(q.model); return { text: BEFORE, ms: 1 }; } });
  assert.equal(await v.kick(), 0);
  put('meal-photos', 'missing', { id: 'missing', mealId: 'm2', kind: 'before', dataUrl: JPEG, at: clock });
  assert.equal(await v.kick(), 1);
  assert.deepEqual(models, ['claude-opus-5-5']);
});

test('failures are kept with the reason, retried after 5 minutes, at most 3 times', async () => {
  addMeal('m1');
  let n = 0;
  const v = openMealVision({ store, now: () => clock, run: async () => { n++; throw new Error('Claude Code on the Mac is not logged in'); } });
  await v.kick();
  assert.equal(est('m1.before').status, 'failed');
  assert.equal(est('m1.before').error, 'Claude Code on the Mac is not logged in');
  await v.kick();
  assert.equal(n, 1);
  for (let i = 0; i < 5; i++) { clock += 6 * 60000; await v.kick(); }
  assert.equal(n, MAX_TRIES);
});

test('asking again (a new round, with his note) reads the photo again', async () => {
  addMeal('m1');
  const texts = [];
  const v = openMealVision({ store, now: () => clock, run: async (q) => { texts.push(q.content[1].text); return { text: BEFORE, ms: 1 }; } });
  await v.kick();
  const m = store.getRecord('meals', 'm1').data;
  put('meals', 'm1', { ...m, round: 1, hint: 'It is brown rice' });
  assert.equal(await v.kick(), 1);
  assert.equal(est('m1.before').round, 1);
  assert.match(texts[1], /His note about this meal\. It overrides the photo[^\n]*\nIt is brown rice$/);
});

test('the after photo waits for the before estimate, then lists the before items by number', async () => {
  addMeal('m1');
  const m = store.getRecord('meals', 'm1').data;
  put('meal-photos', 'm1-p2', { id: 'm1-p2', mealId: 'm1', kind: 'after', dataUrl: JPEG, at: clock + 1 });
  put('meals', 'm1', { ...m, after: { photoId: 'm1-p2', at: clock + 1, none: false, confirmedAt: null } });
  const seen = [];
  const v = openMealVision({ store, now: () => clock, run: async (q) => {
    seen.push(q.system.startsWith('You read the AFTER') ? 'after' : 'before');
    return { text: q.system.startsWith('You read the AFTER') ? '{"scaleGrams": 96, "leftovers": [{"index": 0, "name": "Rice", "grams": 96}], "notes": ""}' : BEFORE, ms: 1 };
  } });
  assert.equal(await v.kick(), 2);
  assert.deepEqual(seen, ['before', 'after']);
  assert.deepEqual(est('m1.after').leftovers, [{ index: 0, name: 'Rice', grams: 96 }]);
  assert.match(promptText({ kind: 'after', meal: m, before: [{ name: 'Rice', grams: 212 }] }), /0\. Rice: 212 g/);
});

test('confirmed or ate-it-all parts are not read', async () => {
  addMeal('m1');
  const m = store.getRecord('meals', 'm1').data;
  put('meals', 'm1', { ...m, before: { ...m.before, items: [], confirmedAt: 5 }, after: { none: true } });
  const v = openMealVision({ store, now: () => clock, run: async () => { throw new Error('should not run'); } });
  assert.equal(await v.kick(), 0);
});

test('runOnce speaks stream-json to Claude Code and returns the result text', async () => {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const fake = join(bin, 'claude');
  // A stand-in for Claude Code: checks its flags, echoes the image type back in a result line.
  writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const msg = JSON.parse(input.trim());
  const ok = args.includes('--tools') && args[args.indexOf('--tools') + 1] === '' && args.includes('--no-session-persistence');
  console.log(JSON.stringify({ type: 'system' }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ok ? '{"got": "' + msg.message.content[0].type + '"}' : 'bad flags' }));
});`);
  chmodSync(fake, 0o755);
  const r = await runOnce({ system: 's', content: [imageBlock(JPEG), { type: 'text', text: 'x' }], claude: fake });
  assert.deepEqual(parseJsonAnswer(r.text), { got: 'image' });
  await assert.rejects(runOnce({ system: 's', content: 'x', claude: null }), /not found/);
  assert.equal(findClaude({ CLAUDE_PATH: fake, HOME: dir }), fake);
  assert.equal(findClaude({ HOME: dir }), null);
});
