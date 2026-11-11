// Thu 11/12, his words about Wed 11/11 3:36 PM: "That's about 10 hours after this morning's 9:31 AM round" -> the round
// ran 9:42 to 9:48 AM; 9:31 AM was Tuesday's round, and his morning reminder slot is 9:30 AM. The coach saw only
// "morning 9:30 AM: DONE". Now it gets today's logged rounds with their real times, with every message and in the
// today and tendons tools, and never another day's round or the slot as one.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { contextLine, roundTimesText, todayText } from '../server/coach/tools-read.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'UTC';
const D = (day, h, m = 0) => Date.UTC(2026, 0, day, h, m); // 1/20 Tuesday, 1/21 Wednesday
let dir; let store;
const w = (col, id, data) => store.writeLocal(col, id, data);
const round = (id, day, from, to, extra = {}) => {
  w('sessions', id, { id, kind: 'holds', area: 'knees', title: 'Knees holds', startedAt: D(day, ...from), endedAt: D(day, ...to), status: 'done', exercises: [{ key: 'k', name: 'Toes Wall Squat Hold', type: 'duration' }], ...extra });
  for (let i = 1; i <= 3; i++) w('sets', `${id}s${i}`, { id: `${id}s${i}`, sessionId: id, exKey: 'k', order: i, type: 'hold', durationS: 30, done: true, doneAt: D(day, to[0], to[1]) - (3 - i) * 180000, pain: 0 });
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-roundtimes-'));
  store = openStore(join(dir, 'db.sqlite'));
  w('settings', 'main', { notify: { holdsMorning: '09:30', holdsEvening: '21:30' } });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', type: 'hold', load: 'bodyweight', sets: 3, seconds: 30, where: 'home' }], loadsArea: { exercises: ['Leg Extension (Machine) Hold'] } });
  round('tue', 20, [9, 26], [9, 32]); // Tuesday's round
  round('tue2', 20, [9, 31], [9, 37]); // the same Tuesday round logged twice
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const snap = (now) => snapshot(store, { tz: TZ, now });

test('his Wednesday at 3:36 PM: the context gives 9:42 AM to 9:48 AM, never 9:31, 9:26 or the 9:30 slot', () => {
  round('wed', 21, [9, 42], [9, 48], { round: 'morning' });
  const ctx = contextLine({ store, tz: TZ, now: D(21, 15, 36) });
  const line = ctx.split('\n').find((l) => l.startsWith('Now: Hold rounds he logged today'));
  assert.ok(line, ctx);
  assert.match(line, /Knees: 9:42 AM to 9:48 AM \(morning round\)\./);
  assert.match(line, /reminder slots, never when he did one/);
  assert.doesNotMatch(line, /9:31|9:26|9:30|9:37/);
  // The today tool has it too, next to the slot line.
  assert.match(String(todayText(snap(D(21, 15, 36)))), /Hold rounds he logged today .*Knees: 9:42 AM to 9:48 AM/);
});

test('nothing logged today yet: says none, gives no time (Tuesday\'s round is not today\'s)', () => {
  const text = roundTimesText(snap(D(21, 9, 35)));
  assert.equal(text, 'Hold rounds he logged today: none yet. Never give a time for one he hasn\'t logged.');
});

test('both rounds, a round logged twice counts once, a round still open, a gym hold in a workout', () => {
  round('wed', 21, [9, 42], [9, 48]);
  round('wed2', 21, [9, 45], [9, 50]); // the coach logged the same round again
  w('sessions', 'gym', { id: 'gym', kind: 'workout', dayType: 'legs', title: 'Lower', startedAt: D(21, 13, 0), endedAt: D(21, 14, 0), status: 'done', exercises: [{ key: 'le', name: 'Leg Extension (Machine) Hold', type: 'duration' }] });
  w('sets', 'g1', { id: 'g1', sessionId: 'gym', exKey: 'le', order: 1, type: 'hold', durationS: 30, done: true, doneAt: D(21, 13, 40) });
  w('sets', 'g2', { id: 'g2', sessionId: 'gym', exKey: 'le', order: 2, type: 'hold', durationS: 30, done: true, doneAt: D(21, 13, 44) });
  w('sessions', 'eve', { id: 'eve', kind: 'holds', area: 'knees', title: 'Knees holds', startedAt: D(21, 18, 30), endedAt: null, status: 'active', exercises: [{ key: 'k', name: 'Toes Wall Squat Hold', type: 'duration' }] });
  w('sets', 'e1', { id: 'e1', sessionId: 'eve', exKey: 'k', order: 1, type: 'hold', durationS: 30, done: true, doneAt: D(21, 18, 31) });
  const text = roundTimesText(snap(D(21, 18, 33)));
  assert.match(text, /Knees: 9:42 AM to 9:50 AM; Leg Extension \(Machine\) Hold at the gym in Lower, 1:40 PM to 1:44 PM; started 6:30 PM, not finished \(1 hold saved\)\.$/);
});

test('the coach\'s rule: a round\'s time only from the logged rounds', () => {
  assert.match(RULES, /take the time only from the context's "Hold rounds he logged today".*never his reminder slot, another day's round or your memory/);
});
