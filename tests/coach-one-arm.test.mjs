// Sat 10/24, his words: "Theres no 1:30 there first set is right arm then left". On an exercise his notes call one-arm
// ("single arm", "desna pa leva" = right then left) each logged set is one arm, right then left back to back: the coach
// reads a pair as one round and judges rest per arm, round to round. Made-up numbers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot, oneArm, armOf, roundsText } from '../server/coach/shared.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { activeText } from '../server/coach/tools-read.mjs';
import { timelineText } from '../server/coach/memory.mjs';

const TZ = 'UTC';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00Z`);
const NOW = at('2026-03-17', '15:20');
let dir; let store;
const w = (col, id, data) => store.writeLocal(col, id, data);
const s = () => snapshot(store, { tz: TZ, now: NOW });
const ctx = () => ({ store, tz: TZ, now: () => NOW, action: () => {} });
const call = async (name, args = {}) => { const r = await TOOLS.find((t) => t.name === name).run(args, ctx()); return typeof r === 'string' ? r : r.text; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-one-arm-'));
  store = openStore(join(dir, 'db.sqlite'));
  // Last week: the note says one arm, right then left; the curl next to it is a normal two-arm exercise.
  w('sessions', 'old', { id: 'old', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('2026-03-10', '09:00'), endedAt: at('2026-03-10', '10:00'), status: 'done', exercises: [
    { key: 'p', name: 'Preacher Curl (Dumbbell)', type: 'weight_reps', notes: 'Single arm, desna pa leva' }, { key: 'h', name: 'Hammer Curl (Dumbbell)', type: 'weight_reps' }] });
  [[8, 9], [8, 9], [8, 8], [8, 8]].forEach(([kg, reps], i) => w('sets', `o${i}`, { id: `o${i}`, sessionId: 'old', exKey: 'p', order: i, type: 'normal', kg, reps, done: true, doneAt: at('2026-03-10', `09:0${i}`) }));
  w('sets', 'oh', { id: 'oh', sessionId: 'old', exKey: 'h', order: 9, type: 'normal', kg: 10, reps: 10, done: true, doneAt: at('2026-03-10', '09:30') });
  // Today: no note on the curl (the copied workout doesn't carry it), right arm then left a minute later.
  w('sessions', 'now', { id: 'now', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('2026-03-17', '14:50'), pausedMs: 0, status: 'active', exercises: [
    { key: 'h', name: 'Hammer Curl (Dumbbell)', type: 'weight_reps', notes: '' }, { key: 'p', name: 'Preacher Curl (Dumbbell)', type: 'weight_reps', notes: '' }] });
  w('sets', 'h1', { id: 'h1', sessionId: 'now', exKey: 'h', order: 0, type: 'normal', kg: 11, reps: 12, done: true, doneAt: at('2026-03-17', '15:04') });
  w('sets', 'h2', { id: 'h2', sessionId: 'now', exKey: 'h', order: 1, type: 'failure', kg: 12, reps: 4, done: true, doneAt: at('2026-03-17', '15:07') });
  w('sets', 'pw', { id: 'pw', sessionId: 'now', exKey: 'p', order: 2, type: 'warmup', kg: 5, reps: 10, done: true, doneAt: at('2026-03-17', '15:12') });
  w('sets', 'p1', { id: 'p1', sessionId: 'now', exKey: 'p', order: 3, type: 'failure', kg: 12, reps: 4, done: true, doneAt: at('2026-03-17', '15:14') });
  w('sets', 'p2', { id: 'p2', sessionId: 'now', exKey: 'p', order: 4, type: 'normal', kg: 12, reps: 4, done: true, doneAt: at('2026-03-17', '15:15') });
  for (let i = 3; i <= 6; i++) w('sets', `p${i}`, { id: `p${i}`, sessionId: 'now', exKey: 'p', order: 2 + i, type: 'normal', kg: 10, target: { reps: [6, 8] }, done: false });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test('one-arm comes from his notes on the exercise, today or in any past session; not from other exercises', () => {
  assert.equal(oneArm(s(), 'Preacher Curl (Dumbbell)'), true);
  assert.equal(oneArm(s(), 'Hammer Curl (Dumbbell)'), false);
  assert.equal(oneArm(s(), 'Concentration Curl', ['right then left']), true);
  assert.equal(oneArm(s(), 'Concentration Curl', ['Desna pa leva raka']), true);
  assert.equal(oneArm(s(), 'Concentration Curl', ['One-arm, slow']), true);
  assert.equal(oneArm(s(), 'Concentration Curl', ['slow, full ROM', '']), false);
});

test('rounds: working sets pair up right then left; warm-ups have no arm; an odd last set is a right arm', () => {
  const sets = s().setsOf('now').filter((x) => x.exKey === 'p');
  assert.equal(armOf(sets, sets[0]), null);
  assert.deepEqual(armOf(sets, sets[1]), { round: 1, arm: 'right' });
  assert.deepEqual(armOf(sets, sets[2]), { round: 1, arm: 'left' });
  assert.deepEqual(armOf(sets, sets[3]), { round: 2, arm: 'right' });
  assert.equal(roundsText([{ kg: 1 }, { kg: 2 }, { kg: 3 }], (x) => `${x.kg} kg`), 'round 1: right 1 kg, left 2 kg; round 2: right 3 kg');
});

test("today's session reads the preacher curl as one round, right then left; the hammer curl stays per set", async () => {
  const text = await call('history', { from: '2026-03-17', to: '2026-03-17' });
  assert.match(text, /Preacher Curl \(Dumbbell\) \(one arm per logged set, right then left back to back, each pair is one round; no rest between the arms, rest and rep drops count per arm, round to round \(right vs right\)\): W 5 kg × 10, round 1: right F 12 kg × 4, left 12 kg × 4\b/);
  assert.match(text, /Hammer Curl \(Dumbbell\): 11 kg × 12, F 12 kg × 4\n/);
  assert.doesNotMatch(text, /Hammer Curl[^\n]*round/);
});

test("one exercise's history says how he logs it and pairs every session", async () => {
  const text = await call('history', { exercise: 'preacher curl' });
  assert.match(text, /How he logs it: one arm per logged set/);
  assert.match(text, /round 1: right 8 kg × 9, left 8 kg × 9; round 2: right 8 kg × 8, left 8 kg × 8/);
  assert.doesNotMatch(await call('history', { exercise: 'hammer curl' }), /round|one arm/);
});

test('the timeline gives each set its round and arm, so set 2 a minute after set 1 is the left arm, not a rest', () => {
  const text = timelineText(s(), { date: '2026-03-17', kinds: ['workouts'] });
  assert.match(text, /3:14 PM \[workouts\] Preacher Curl \(Dumbbell\) set 1 \(round 1, right arm\): 12 kg × 4 \(to failure\)/);
  assert.match(text, /3:15 PM \[workouts\] Preacher Curl \(Dumbbell\) set 2 \(round 1, left arm\): 12 kg × 4/);
  assert.match(text, /Preacher Curl \(Dumbbell\) warm-up: 5 kg × 10/);
  assert.match(text, /Hammer Curl \(Dumbbell\) set 2: 12 kg × 4/);
  assert.doesNotMatch(text, /Hammer Curl[^\n]*arm\)/);
});

test('the session in progress says the next set (4 of 7, after the warm-up) is round 2, right arm', () => {
  const snap = s();
  assert.match(activeText(snap, snap.active()), /Now: Preacher Curl \(Dumbbell\), set 4 of 7 \(round 2, right arm; one arm per logged set/);
});

test('log_set says which arm it logged; no rest timer after the right arm, the rest comes after the left', async () => {
  const acts = [];
  const run = async (args) => { const r = await TOOLS.find((t) => t.name === 'log_set').run(args, { ...ctx(), action: (x) => acts.push(x) }); return typeof r === 'string' ? r : r.text; };
  const text = await run({ exercise: 'preacher curl', kg: 10, reps: 6 });
  assert.equal(acts.filter((x) => x.kind === 'rest').length, 0);
  assert.match(text, /No rest timer: the left arm goes straight after the right/);
  assert.match(text, /Logged Preacher Curl \(Dumbbell\), set \d of \d+ \(round 2, right arm\)/);
  assert.match(text, /Next: Preacher Curl \(Dumbbell\), set \d of \d+ \(round 2, left arm;/);
  const left = await run({ exercise: 'preacher curl', kg: 10, reps: 6 });
  assert.match(left, /round 2, left arm/);
  assert.doesNotMatch(left, /No rest timer/);
  // Sat 10/24: the rest's "Rest over" names the set it leads to (the next round's right arm), not the arm just done.
  assert.deepEqual(acts.filter((x) => x.kind === 'rest').map((x) => x.next), ['Preacher Curl (Dumbbell): round 3, right arm, 10 kg × 6-8']);
});
