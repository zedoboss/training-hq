// Tue 11/24, his words: "Yes obviously" (take the V grip cable row off Upper A). It wasn't in Upper A, and
// routine_edit remove "Seated Cable Row - V Grip (Cable)" removed Seated Shoulder Press (Machine): the name finder took
// one shared word ("seated") as a match. Picking an exercise already in a routine or on a workout's card now needs his
// every word (or the exact name): one that isn't there says so and nothing changes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { PLAN_TOOLS } from '../server/coach/tools-plan.mjs';
import { WORKOUT_TOOLS } from '../server/coach/tools-workout.mjs';
import { findByName } from '../server/coach/shared.mjs';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 10, 24, 7, 55); // Tuesday 11/24
let dir; let store;

const ex = (key, exerciseId, name) => ({ key, exerciseId, name, restSeconds: null, notes: '', plan: null, sets: [{ type: 'normal', reps: [8, 10] }, { type: 'normal', reps: [8, 10] }] });
const UPPER_A = [
  ex('a1', 'bench-press-smith-machine', 'Bench Press (Smith Machine)'),
  ex('a2', 'pull-up', 'Pull Up'),
  ex('a3', 'seated-shoulder-press-machine', 'Seated Shoulder Press (Machine)'),
  ex('a4', 'triceps-pushdown', 'Triceps Pushdown'),
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-notthere-'));
  store = openStore(join(dir, 'db.sqlite'));
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-10-01', push: '2026-10-02', legs: '2026-10-03' } });
  w('routines', 'r-ua', { id: 'r-ua', title: 'Upper A', dayType: 'upper-a', folderId: 'other', order: 0, notes: '', exercises: UPPER_A });
  w('sessions', 'now', { id: 'now', kind: 'workout', title: 'Upper B', dayType: 'upper-b', startedAt: NOW - 600000, endedAt: null, status: 'active', pausedMs: 0, pausedAt: null, note: '', exercises: [
    { key: 'b', exerciseId: 'incline-bench-press-smith-machine', name: 'Incline Bench Press (Smith Machine)', type: 'weight_reps', barKg: null, restSeconds: null, notes: '', supersetId: null, target: null },
    { key: 'c', exerciseId: 'seated-leg-curl-machine', name: 'Seated Leg Curl (Machine)', type: 'weight_reps', barKg: null, restSeconds: null, notes: '', supersetId: null, target: null },
  ] });
  w('sets', 'c1', { id: 'c1', sessionId: 'now', exKey: 'c', order: 0, type: 'normal', kg: 45, reps: null, done: false, target: { kg: 45, reps: [8, 10] } });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = { tz: TZ, now: () => NOW, action: () => {} };
const plan = (args) => PLAN_TOOLS.find((t) => t.name === 'routine_edit').run(args, { ...ctx, store });
const work = (args) => WORKOUT_TOOLS.find((t) => t.name === 'workout_edit').run(args, { ...ctx, store });
const names = () => store.getRecord('routines', 'r-ua').data.exercises.map((e) => e.name);

test('his Tuesday: removing the V grip row from Upper A, where it is not, says so and removes nothing', async () => {
  const r = await plan({ action: 'remove', routine: 'upper-a', exercise: 'Seated Cable Row - V Grip (Cable)', said: 'Yes obviously' });
  assert.notEqual(r.wrote, true);
  assert.match(r.text, /No "Seated Cable Row - V Grip \(Cable\)" in Upper A, so nothing changed/);
  assert.match(r.text, /Seated Shoulder Press \(Machine\)/, 'it lists what is there');
  assert.deepEqual(names(), UPPER_A.map((e) => e.name));
});

test('one shared word is never a match for any routine edit: sets, note, swap, move, a place', async () => {
  for (const args of [
    { action: 'sets', exercise: 'seated cable row', sets: 3 },
    { action: 'note', exercise: 'seated cable row', note: 'x' },
    { action: 'swap', exercise: 'seated cable row', with: 'Pull Up' },
    { action: 'move', exercise: 'seated cable row', position: 1 },
    { action: 'move', exercise: 'Pull Up', after: 'seated cable row' },
  ]) {
    const r = await plan({ routine: 'Upper A', ...args });
    assert.notEqual(r.wrote, true, JSON.stringify(args));
    assert.match(r.text, /No "seated cable row" in/, JSON.stringify(args));
  }
  assert.deepEqual(names(), UPPER_A.map((e) => e.name));
});

test('what he calls an exercise that is there still finds it: part of the name, plural, filler words', async () => {
  assert.equal((await plan({ action: 'remove', routine: 'upper-a', exercise: 'shoulder press', said: 'take it off' })).wrote, true);
  assert.ok(!names().includes('Seated Shoulder Press (Machine)'));
  assert.equal((await plan({ action: 'remove', routine: 'upper-a', exercise: 'pull ups', said: 'take it off' })).wrote, true);
  assert.ok(!names().includes('Pull Up'));
  assert.equal((await plan({ action: 'sets', routine: 'upper-a', exercise: 'the smith bench', sets: 3 })).wrote, true);
  assert.equal((await plan({ action: 'sets', routine: 'upper-a', exercise: 'Triceps Pushdown', sets: 3 })).wrote, true);
});

test('the workout in progress: removing an exercise not on the card says so; the seated leg curl stays', async () => {
  const r = await work({ action: 'remove', exercise: 'Seated Cable Row - V Grip (Cable)' });
  assert.notEqual(r.wrote, true);
  assert.match(r.text, /isn't in Upper B/);
  assert.deepEqual(store.getRecord('sessions', 'now').data.exercises.map((e) => e.name), ['Incline Bench Press (Smith Machine)', 'Seated Leg Curl (Machine)']);
  assert.equal((await work({ action: 'remove', exercise: 'leg curl' })).wrote, true);
});

test('findByName: whole needs every word; without it the most words still win (library searches)', () => {
  const items = UPPER_A;
  assert.equal(findByName(items, 'seated cable row').item?.name, 'Seated Shoulder Press (Machine)', 'loose search unchanged');
  assert.equal(findByName(items, 'seated cable row', undefined, undefined, { whole: true }).item, null);
  assert.equal(findByName(items, 'seated shoulder press machine', undefined, undefined, { whole: true }).item?.name, 'Seated Shoulder Press (Machine)');
  assert.equal(findByName(items, 'pushdowns', undefined, undefined, { whole: true }).item?.name, 'Triceps Pushdown');
});
