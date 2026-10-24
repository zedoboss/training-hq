// Sat 10/24, his words at the gym: "My feature didnt get built??? 2 sets per round two arms". On a one-arm exercise
// (his notes: "desna pa leva" = right then left; or a tendon hold he does one arm at a time) the phone's card counts
// rounds: each round is two sets, right then left, so a 3 x 30 s hold is 6 sets; no rest timer after the right arm;
// the card, the bar and the notifications say the round and the arm. Made-up numbers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSession, pairUpRows, oneArmIn, oneArmHoldRounds, armLabel, armOf, nextAfter, nextAfterText, nextSetText } from '../app/js/lib/session.js';
import { buildHistory } from '../app/js/lib/history.js';
import { openStore } from '../server/store.mjs';
import { TOOLS } from '../server/coach/tools.mjs';

const DAY = 86400000;
const T0 = Date.parse('2026-03-17T09:00:00Z');
const tendons = [{ kind: 'area', id: 'wrist', holds: [{ exercise: 'Cupping', type: 'hold', loadKg: 9, sets: 3, seconds: 30, sides: ['Right arm', 'Left arm'] }] },
  { kind: 'area', id: 'knees', holds: [{ exercise: 'Toes Wall Squat Hold', sets: 3, seconds: 30 }] }];

const histOf = (sessions, sets) => buildHistory({ sessions, sets, bridge: null });
const past = (id, at, exercises, sets) => ({ session: { id, kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at, endedAt: at + 3600000, status: 'done', exercises }, sets: sets.map((x, i) => ({ id: `${id}-${i}`, sessionId: id, order: i, done: true, doneAt: at + i * 60000, ...x })) });

test('his tendon notes: a hold with two sides is one-arm, its sets are rounds; a hold without sides is not', () => {
  const r = oneArmHoldRounds(tendons);
  assert.equal(r.get('Cupping'), 3);
  assert.equal(r.has('Toes Wall Squat Hold'), false);
});

test('one-arm from a note in the last year; a two-year-old note ("then one arm 100 kg") no longer counts', () => {
  const a = past('a', T0 - 700 * DAY, [{ key: 'b', name: 'Bench Press (Barbell)', notes: 'two sets, then one arm 100kg x 8' }], [{ exKey: 'b', type: 'normal', kg: 80, reps: 8 }]);
  const b = past('b', T0 - 7 * DAY, [{ key: 'b', name: 'Bench Press (Barbell)', notes: '' }, { key: 'c', name: 'Cupping', notes: 'desna pa leva' }], [{ exKey: 'b', type: 'normal', kg: 90, reps: 8 }, { exKey: 'c', type: 'normal', kg: 9, reps: 15 }]);
  const h = histOf([a.session, b.session], [...a.sets, ...b.sets]);
  assert.equal(oneArmIn(h, 'Bench Press (Barbell)'), false);
  assert.equal(oneArmIn(h, 'Cupping'), true);
  // A workout marked one-arm when it started carries it on, note or no note.
  const c = past('c', T0 - 2 * DAY, [{ key: 'l', name: 'Lateral Raise (Cable)', oneArm: true }], [{ exKey: 'l', type: 'hold', kg: 7, durationS: 30 }]);
  assert.equal(oneArmIn(histOf([c.session], c.sets), 'Lateral Raise (Cable)'), true);
});

test('pairUpRows: 3 holds with 3 rounds in his note become 6; an odd rep count gets its left arm; a finished kind gets none', () => {
  const holds = [0, 1, 2].map((i) => ({ id: `h${i}`, sessionId: 's', exKey: 'c', order: 30 + i, type: 'hold', kg: 9, durationS: 30, done: false }));
  const add = pairUpRows(holds, { holdRounds: 3 });
  assert.equal(add.length, 3);
  assert.ok(add.every((x) => x.type === 'hold' && x.kg === 9 && x.durationS === 30 && !x.done && x.exKey === 'c'));
  const all = [...holds, ...add].sort((a, b) => a.order - b.order);
  assert.deepEqual(all.map((x) => armLabel(all, x, 'H')), ['H1R', 'H1L', 'H2R', 'H2L', 'H3R', 'H3L']);
  // One round done already (right arm ticked): still topped up to 3 rounds.
  assert.equal(pairUpRows([{ ...holds[0], done: true }, holds[1], holds[2]], { holdRounds: 3 }).length, 3);
  // Rep sets: 3 rows -> 4; the table's 2 sets are 2 rounds -> 4 rows; already 4 -> none; all ticked -> none.
  const reps = [0, 1, 2].map((i) => ({ id: `r${i}`, sessionId: 's', exKey: 'p', order: i, type: 'normal', kg: 10 + i, target: { kg: 10, reps: [6, 8] }, done: false }));
  const one = pairUpRows(reps);
  assert.equal(one.length, 1);
  assert.equal(one[0].kg, 11, 'the left arm copies the left arm a round earlier');
  assert.equal(pairUpRows(reps.slice(0, 2), { rounds: 2 }).length, 2);
  assert.equal(pairUpRows([...reps, ...one]).length, 0);
  assert.equal(pairUpRows(reps.map((x) => ({ ...x, done: true }))).length, 0);
  assert.equal(pairUpRows([], { holdRounds: 3 }).length, 0, 'no holds on the card: none made up');
});

test('a new Pull copied from last time (3 cupping holds): 6 holds, 3 rounds; rep cupping in pairs; a two-arm curl unchanged', () => {
  const last = past('last', T0 - 2 * DAY, [{ key: 'c', name: 'Cupping', notes: 'desna pa leva' }, { key: 'h', name: 'Hammer Curl (Dumbbell)' }],
    [{ exKey: 'c', type: 'normal', kg: 9, reps: 15 }, { exKey: 'c', type: 'normal', kg: 9, reps: 15 }, { exKey: 'c', type: 'normal', kg: 9, reps: 14 }, { exKey: 'h', type: 'normal', kg: 12, reps: 10 }, { exKey: 'h', type: 'normal', kg: 12, reps: 9 }, { exKey: 'h', type: 'normal', kg: 12, reps: 8 }]);
  const history = histOf([last.session], last.sets);
  const routine = { id: 'pull', title: 'Pull', dayType: 'pull', exercises: [
    { key: 'a', exerciseId: 'cup', name: 'Cupping', notes: '', sets: [{ type: 'normal', kg: 9, reps: [12, 15] }, { type: 'normal', kg: 9, reps: [12, 15] }, { type: 'normal', kg: 9, reps: [12, 15] }] },
    { key: 'b', exerciseId: 'ham', name: 'Hammer Curl (Dumbbell)', notes: '', sets: [{ type: 'normal', kg: 12, reps: [8, 10] }, { type: 'normal', kg: 12, reps: [8, 10] }, { type: 'normal', kg: 12, reps: [8, 10] }] },
    { key: 'c', exerciseId: 'cup', name: 'Cupping', notes: '30s hold', sets: [{ type: 'hold', kg: 9, durationS: 30 }, { type: 'hold', kg: 9, durationS: 30 }, { type: 'hold', kg: 9, durationS: 30 }] },
    { key: 'd', exerciseId: 'lat', name: 'Lateral Raise (Cable)', notes: '', sets: [{ type: 'hold', kg: 7, durationS: 30 }] },
  ] };
  const { session, sets } = buildSession({ routine, meta: null, lib: new Map(), history, today: '2026-03-17', now: T0, holdRounds: oneArmHoldRounds([...tendons, { kind: 'area', id: 'shoulder', holds: [{ exercise: 'Lateral Raise (Cable)', sets: 3, sides: ['Right arm', 'Left arm'] }] }]) });
  const of = (i) => sets.filter((x) => x.exKey === session.exercises[i].key).sort((a, b) => a.order - b.order);
  assert.deepEqual(session.exercises.map((e) => Boolean(e.oneArm)), [true, false, true, true]);
  assert.equal(of(0).length, 4, 'rep cupping: 3 -> 2 rounds');
  assert.equal(of(1).length, 3, 'the hammer curl is two arms: as it was');
  assert.equal(of(2).length, 6, 'the cupping hold: 3 rounds, 6 sets');
  assert.ok(of(2).every((x) => x.type === 'hold' && x.durationS === 30 && x.kg === 9));
  assert.equal(of(3).length, 6, 'a one-arm tendon hold without notes: 3 rounds from his tendon note');
  // Orders stay whole and in card order.
  assert.deepEqual(sets.map((x) => x.order), sets.map((_, i) => i));
  // The bar names the round: "Cupping · hold round 1 of 3 · right arm · hold 30 s".
  const holdsOnly = { ...session, exercises: session.exercises.slice(2, 3) };
  assert.equal(nextSetText(holdsOnly, of(2)), 'Cupping · hold round 1 of 3 · right arm · hold 30 s');
  const s2 = of(2).map((x, i) => (i === 0 ? { ...x, done: true } : x));
  assert.equal(nextSetText(holdsOnly, s2), 'Cupping · hold round 1 of 3 · left arm · hold 30 s');
  // "Rest over" after a full round: the next round's right arm, with its seconds.
  const s3 = of(2).map((x, i) => (i < 2 ? { ...x, done: true } : x));
  assert.equal(nextAfterText(nextAfter(holdsOnly.exercises, s3, holdsOnly.exercises[0].key), s3, true), 'Cupping: round 2, right arm, hold 30 s, 9 kg');
  assert.deepEqual(armOf(s3, s3[5]), { round: 3, arm: 'left' });
});

// The coach logging his holds: no rest after the right arm's hold, rest after the left.
let dir; let store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-rounds-')); store = openStore(join(dir, 'db.sqlite')); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test('coach log_set on a one-arm hold: the right arm starts no rest, the left does and names round 2', async () => {
  const at = (hm) => Date.parse(`2026-03-17T${hm}:00Z`);
  const now = at('16:30');
  store.writeLocal('sessions', 'now', { id: 'now', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('15:00'), pausedMs: 0, status: 'active', exercises: [{ key: 'c', name: 'Cupping', type: 'weight_reps', notes: '30s hold', oneArm: true }] });
  for (let i = 0; i < 6; i++) store.writeLocal('sets', `h${i}`, { id: `h${i}`, sessionId: 'now', exKey: 'c', order: i, type: 'hold', kg: 9, durationS: 30, done: false });
  const acts = [];
  const ctx = { store, tz: 'UTC', now: () => now, action: (a) => acts.push(a) };
  const log = TOOLS.find((t) => t.name === 'log_set');
  await log.run({ exercise: 'cupping', seconds: 30 }, ctx);
  assert.equal(acts.filter((x) => x.kind === 'rest').length, 0, 'no rest after the right arm');
  await log.run({ exercise: 'cupping', seconds: 30 }, ctx);
  const rests = acts.filter((x) => x.kind === 'rest');
  assert.equal(rests.length, 1);
  assert.equal(rests[0].next, 'Cupping: round 2, right arm, hold 30 s, 9 kg');
});
