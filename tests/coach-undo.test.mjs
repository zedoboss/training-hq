// Thu 11/5, his words: "What else cant u do? Figure it out and let the mac give U the tools". One of the gaps: undo the
// coach's last change in one step. Every tool call's changes are kept; undo puts them back when nothing moved since.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { recordingStore, saveUndo, UNDO_TOOLS, UNDO } from '../server/coach/tools-undo.mjs';
import { TOOLS } from '../server/coach/tools.mjs';

const NOW = Date.UTC(2026, 0, 20, 3, 0);
let dir; let store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-undo-')); store = openStore(join(dir, 'db.sqlite')); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const undo = (args = {}, now = NOW + 60000) => UNDO_TOOLS[0].run(args, { store, tz: 'UTC', now: () => now, action: () => {} });
/** One tool call through the recorder, as the coach runs it. */
function call(fn, at = NOW, tool = 'correct_meal') {
  const rec = recordingStore(store);
  fn(rec.store);
  return saveUndo(store, { tool, title: tool, summary: 'changed it', at, writes: rec.writes() });
}

test('undo puts back an edited record and removes a new one, in one step', async () => {
  store.writeLocal('meals', 'm1', { id: 'm1', name: 'Lunch', at: NOW - 3600000 });
  call((st) => { st.writeLocal('meals', 'm1', { id: 'm1', name: 'Dinner', at: NOW - 3600000 }); st.writeLocalMany([{ col: 'sets', id: 's1', data: { id: 's1', kg: 50 } }]); });
  const r = await undo();
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Undone: correct_meal at 3:00 AM/);
  assert.equal(store.getRecord('meals', 'm1').data.name, 'Lunch');
  assert.equal(store.getRecord('sets', 's1').deleted, true);
  // Again: nothing left.
  assert.match((await undo()).text, /^Nothing to undo/);
});

test('undo again goes one further back; list shows what can be undone', async () => {
  store.writeLocal('meals', 'm1', { id: 'm1', name: 'A' });
  call((st) => st.writeLocal('meals', 'm1', { id: 'm1', name: 'B' }), NOW);
  call((st) => st.writeLocal('meals', 'm1', { id: 'm1', name: 'C' }), NOW + 1000);
  assert.match((await undo({ action: 'list' })).text, /newest first/);
  await undo();
  assert.equal(store.getRecord('meals', 'm1').data.name, 'B');
  await undo();
  assert.equal(store.getRecord('meals', 'm1').data.name, 'A');
});

test('refused when the record was changed since (his phone): nothing is overwritten', async () => {
  store.writeLocal('meals', 'm1', { id: 'm1', name: 'A' });
  call((st) => st.writeLocal('meals', 'm1', { id: 'm1', name: 'B' }));
  store.writeLocal('meals', 'm1', { id: 'm1', name: 'His edit' });
  const r = await undo();
  assert.match(r.text, /^Can't undo/);
  assert.equal(store.getRecord('meals', 'm1').data.name, 'His edit');
});

test('the chat, the Mac changes and older than 24 hours are never undone', async () => {
  assert.equal(call((st) => st.writeLocal('coach-messages', 'x', { id: 'x' })), null);
  assert.equal(call((st) => st.writeLocal('meals', 'm2', { id: 'm2' }), NOW, 'request_change'), null);
  call((st) => st.writeLocal('meals', 'm3', { id: 'm3' }), NOW - 25 * 3600000);
  assert.match((await undo()).text, /^Nothing to undo/);
  assert.ok(store.getRecord('meals', 'm3').data);
});

test('the coach has the undo tool', () => {
  assert.ok(TOOLS.some((t) => t.name === 'undo'));
  assert.ok(store.listRecords(UNDO).length === 0);
});

test('every tool his screens needed is there, each only on his words, and the coach looks before saying it can\'t', async () => {
  const { RULES } = await import('../server/coach/prompt.mjs');
  const added = ['workout_edit', 'past_workout', 'timer', 'routine_edit', 'exercise_library', 'progression_answer', 'rotation_set', 'plan_day', 'tendon_hold', 'bodyweight', 'readiness_confirm', 'supplement_list', 'meal_edit', 'my_food', 'fuel_settings', 'body_log', 'body_delete', 'class_log', 'recovery_answers', 'sauna_log', 'save_photo', 'reminders', 'stats', 'undo'];
  for (const name of added) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name);
    if (!t.annotations?.readOnlyHint && name !== 'stats') assert.match(t.description, /only (when|on) his|he tells you|his words|only when he|he decides/i, name);
    assert.ok(RULES.includes(name), `the rules name ${name}`);
  }
  assert.match(RULES, /Before you say you can't do something, look for its tool/);
  assert.match(RULES, /never on your own idea/);
});
