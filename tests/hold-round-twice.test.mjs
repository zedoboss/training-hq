// Wed 11/11, his words: "Logged your knee holds: Toes Wall Squat Hold, 3 × 30 s at 9:31 AM. Nice work. The only other
// hold due today is Cupping" -> check the holds already ticked before logging; if the round is in, say so, and name the
// second knee round still due today. Tue 11/10 he ticked a knee round (9:26-9:32 AM, pain 0), said "Did em" at 9:37 AM,
// and the coach's log_round added a second round on top, which also counted as his evening round.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { PLAN_TOOLS } from '../server/coach/tools-plan.mjs';
import { roundsByDate } from '../app/js/lib/holds.js';

const TZ = 'UTC';
const T = (h, m = 0) => Date.UTC(2026, 0, 22, h, m); // Thursday 1/22
let dir; let store; let now;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-twice-'));
  store = openStore(join(dir, 'db.sqlite'));
  now = T(9, 37);
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('settings', 'main', { notify: { holdsMorning: '09:00', holdsEvening: '19:00' } });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', type: 'hold', load: 'bodyweight', sets: 3, seconds: 30, where: 'home' }] });
  // His own round on the hold timer: 9:26 to 9:32 AM, pain 0.
  w('sessions', 'h1', { id: 'h1', kind: 'holds', area: 'knees', title: 'Knees holds', startedAt: T(9, 26), endedAt: T(9, 32), status: 'done', round: 'morning', exercises: [{ key: 'k', name: 'Toes Wall Squat Hold', type: 'duration' }] });
  for (const [i, m] of [[1, 27], [2, 30], [3, 32]]) w('sets', `h1s${i}`, { id: `h1s${i}`, sessionId: 'h1', exKey: 'k', order: i, type: 'hold', durationS: 30, done: true, doneAt: T(9, m), pain: 0 });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (args) => PLAN_TOOLS.find((t) => t.name === 'tendon_hold').run(args, { store, tz: TZ, now: () => now, action: () => {} });
const list = (col) => store.listRecords(col).filter((r) => !r.deleted).map((r) => r.data);
const rounds = () => list('sessions').filter((x) => x.kind === 'holds');

test('"Did em" after he ticked the round: not logged again; says it is in and names the evening round', async () => {
  const r = await call({ action: 'log_round', area: 'knees', said: 'Did em' });
  assert.equal(rounds().length, 1);
  assert.match(r.text, /^Not logged: that round is already in\. He ticked it himself: Knees, Toes Wall Squat Hold, 3 holds, 9:26 AM to 9:32 AM, pain 0\/10\./);
  assert.match(r.text, /Knees: Toes Wall Squat Hold, 1 round of 3 × 30 s still due today: the evening one at 7:00 PM/);
  assert.doesNotMatch(r.text, /all done/);
});

test('the same round said later or with its time: still in, not logged twice', async () => {
  now = T(10, 0); // 28 minutes after he finished, no time said
  assert.match((await call({ action: 'log_round', area: 'knees' })).text, /^Not logged: that round is already in/);
  assert.match((await call({ action: 'log_round', hold: 'toes wall squat', time: '09:28' })).text, /^Not logged: that round is already in/);
  assert.equal(rounds().length, 1);
});

test('the evening round is logged; then all done', async () => {
  now = T(19, 10);
  const r = await call({ action: 'log_round', area: 'knees', said: 'Did em' });
  assert.match(r.text, /^Logged Knees: Toes Wall Squat Hold, 3 × 30 s/);
  assert.match(r.text, /Tendon holds today: all done\./);
  assert.equal(rounds().length, 2);
});

test('a round at another time he names (6:00 PM) is logged next to the morning one', async () => {
  now = T(19, 30);
  assert.match((await call({ action: 'log_round', area: 'knees', time: '18:00' })).text, /^Logged Knees: Toes Wall Squat Hold, 3 × 30 s, Thursday 1\/22 at 6:00 PM\. Tendon holds today: all done\./);
});

test('he says he did one more on top: again: true logs it', async () => {
  const r = await call({ action: 'log_round', area: 'knees', again: true, said: 'did another round right after' });
  assert.match(r.text, /^Logged Knees/);
  assert.equal(rounds().length, 2);
});

test('a round open on the hold timer (2 of 3 saved): not logged on top; says it is open', async () => {
  store.writeLocal('sessions', 'h1', { ...rounds()[0], status: 'active', endedAt: null });
  store.writeLocal('sets', 'h1s3', { id: 'h1s3', deleted: true, sessionId: 'x' });
  const r = await call({ action: 'log_round', area: 'knees' });
  assert.match(r.text, /^Not logged: his Knees round from 9:26 AM is open on the hold timer, 2 of 3 holds saved\./);
  assert.equal(rounds().length, 1);
});

test('rounds of one area that overlap in time count once; apart, twice', () => {
  const areas = [{ kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold' }] }];
  const mk = (id, a, b) => ({ id, kind: 'holds', area: 'knees', startedAt: a, endedAt: b, status: 'done' });
  const sets = [];
  const day = new Date(T(9)).toISOString().slice(0, 10);
  // Tue 11/10: his 9:26-9:32 AM round and the coach's 9:31-9:37 AM one on top.
  assert.equal(roundsByDate(areas, [mk('a', T(9, 26), T(9, 32)), mk('b', T(9, 31), T(9, 37))], sets).knees[day], 1);
  assert.equal(roundsByDate(areas, [mk('a', T(9, 26), T(9, 32)), mk('b', T(19, 0), T(19, 6))], sets).knees[day], 2);
  assert.equal(roundsByDate(areas, [mk('a', T(9, 26), T(9, 32)), mk('b', T(9, 32), T(9, 38))], sets).knees[day], 2);
});
