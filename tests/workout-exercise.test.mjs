// Thu 11/5, his words: "Why didnt u add horizontal leg press as first??? Mistake i told u already do so". He said he'd
// do the horizontal leg press first in the Legs session in progress; the coach gave him a load but had no tool to put it
// on the card. workout_exercise adds an exercise at the place he says, with the target, and moves one on the card.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 20, 3, 0); // Tuesday 1/20, 3:00 AM
const at = (iso) => Date.parse(`${iso}T03:00:00Z`);
let dir; let store; let actions;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-wex-'));
  store = openStore(join(dir, 'db.sqlite'));
  actions = [];
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-01-01', push: '2026-01-02', legs: '2026-01-03' } });
  // Leg press logged once, long before the comeback; leg curl last Legs.
  w('sessions', 'old', { id: 'old', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at('2024-08-03'), endedAt: at('2024-08-03') + 3600000, status: 'done', exercises: [{ key: 'p', name: 'Leg Press Horizontal (Machine)', type: 'weight_reps' }] });
  w('sets', 'o1', { id: 'o1', sessionId: 'old', exKey: 'p', order: 0, type: 'normal', kg: 188, reps: 15, done: true, doneAt: at('2024-08-03') });
  w('sessions', 'last', { id: 'last', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at('2026-01-13'), endedAt: at('2026-01-13') + 3600000, status: 'done', exercises: [{ key: 'c', name: 'Seated Leg Curl (Machine)', type: 'weight_reps' }] });
  w('sets', 'l1', { id: 'l1', sessionId: 'last', exKey: 'c', order: 0, type: 'normal', kg: 45, reps: 10, done: true, doneAt: at('2026-01-13') });
  // Legs in progress: squat and RDL skipped for his lower back, leg curl next.
  w('sessions', 'now', { id: 'now', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: NOW - 600000, status: 'active', pausedMs: 0, exercises: [
    { key: 'sq', name: 'Squat (Smith Machine)', type: 'weight_reps', skipped: { at: NOW, reason: 'lower back' } },
    { key: 'rdl', name: 'Romanian Deadlift (Dumbbell)', type: 'weight_reps', skipped: { at: NOW, reason: 'lower back' } },
    { key: 'lc', name: 'Seated Leg Curl (Machine)', type: 'weight_reps' },
    { key: 'cr', name: 'Calf Raise (Horizontal Leg Press)', type: 'weight_reps' },
  ] });
  w('sets', 'n1', { id: 'n1', sessionId: 'now', exKey: 'sq', order: 0, type: 'normal', kg: 61.3, done: false });
  w('sets', 'n2', { id: 'n2', sessionId: 'now', exKey: 'rdl', order: 1, type: 'normal', kg: 20, done: false });
  w('sets', 'n3', { id: 'n3', sessionId: 'now', exKey: 'lc', order: 2, type: 'normal', kg: 45, done: false });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => NOW, action: (a) => actions.push(a) });
const session = () => store.getRecord('sessions', 'now').data;
const setsOf = (key) => store.listRecords('sets').map((r) => r.data).filter((x) => x && x.sessionId === 'now' && x.exKey === key).sort((a, b) => a.order - b.order);

test('"I\'ll do horizontal leg press first": on the card first, with his target and warm-up, the one he is on now', async () => {
  const r = await call('workout_exercise', { action: 'add', exercise: 'horizontal leg press', position: 1, kg: 100, reps_min: 10, reps_max: 12, warmups: [{ kg: 60, reps: 10 }], why: 'estimate: no target for it' });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Added Leg Press Horizontal \(Machine\) to Legs, first: 2 sets × 10-12 at 100 kg, warm-up 60 kg × 10 first\. On his phone now, ready to tick\. It is the one he is on now\./);
  const ex = session().exercises;
  assert.deepEqual(ex.map((e) => e.name), ['Leg Press Horizontal (Machine)', 'Squat (Smith Machine)', 'Romanian Deadlift (Dumbbell)', 'Seated Leg Curl (Machine)', 'Calf Raise (Horizontal Leg Press)']);
  assert.deepEqual(ex[0].target, { kg: 100, reps: [10, 12], sets: 2, approx: true, why: 'estimate: no target for it' });
  assert.deepEqual(setsOf(ex[0].key).map((x) => [x.type, x.kg, x.target.reps, x.done]), [['warmup', 60, [10, 10], false], ['normal', 100, [10, 12], false], ['normal', 100, [10, 12], false]]);
  assert.ok(actions.some((a) => a.kind === 'focus' && a.exKey === ex[0].key), 'his phone goes to it');
  assert.ok(actions.some((a) => a.kind === 'sync'));
  // log_set now ticks it: it's the exercise he is on.
  const logged = await call('log_set', { kg: 60, reps: 10, type: 'warmup' });
  assert.match(logged.text, /^Logged Leg Press Horizontal \(Machine\)/);
});

test('add: no load from before the comeback; last load since it; already on the card; places after / before / last', async () => {
  const none = await call('workout_exercise', { action: 'add', exercise: 'Leg Press Horizontal (Machine)', position: 1 });
  assert.match(none.text, /No load on it: his last \(188 kg, Saturday 8\/3\/2024\) is from before the comeback\. Give him a number and label it your estimate, or ask/);
  assert.equal(session().exercises[0].target.kg, null);
  assert.match((await call('workout_exercise', { action: 'add', exercise: 'horizontal leg press' })).text, /already in this workout \(first\)\. To change its place: action move/);
  const curl = await call('workout_exercise', { action: 'add', exercise: 'Seated Leg Curl (Machine)', again: true });
  assert.match(curl.text, /, last, after Calf Raise \(Horizontal Leg Press\): 2 sets × 8-12 at 45 kg\./, 'last load since the comeback, the default place is last');
  const ext = await call('workout_exercise', { action: 'add', exercise: 'Leg Extension (Machine)', before: 'squat' });
  assert.match(ext.text, /, number 2, after Leg Press Horizontal \(Machine\)/);
  assert.match((await call('workout_exercise', { action: 'add', exercise: 'Leg Extension (Machine)', after: 'bench' })).text, /^Leg Extension \(Machine\) is already/);
  assert.match((await call('workout_exercise', { action: 'add', exercise: 'Hip Thrust (Machine)', after: 'bench' })).text, /^No "bench" in this workout/);
  assert.match((await call('workout_exercise', { action: 'add', exercise: 'zzz nothing' })).text, /^No exercise called/);
});

test('move: to first, after another; needs a place; nothing in progress', async () => {
  const m = await call('workout_exercise', { action: 'move', exercise: 'leg curl', position: 1 });
  assert.match(m.text, /^Moved Seated Leg Curl \(Machine\) to first in Legs on his phone\. Order now: Seated Leg Curl \(Machine\), Squat/);
  const back = await call('workout_exercise', { action: 'move', exercise: 'leg curl', after: 'romanian deadlift' });
  assert.match(back.text, /to number 3, after Romanian Deadlift/);
  assert.match((await call('workout_exercise', { action: 'move', exercise: 'calf raise', position: 1 })).text, /^Moved Calf Raise \(Horizontal Leg Press\) to first/);
  assert.equal(setsOf('lc').length, 1, 'its sets stay as they were');
  assert.match((await call('workout_exercise', { action: 'move', exercise: 'leg curl' })).text, /^Where to\?/);
  assert.match((await call('workout_exercise', { action: 'move', exercise: 'leg press', position: 1 })).text, /^No "leg press" in this workout.*action add/);
  store.writeLocal('sessions', 'now', { ...session(), status: 'done', endedAt: NOW });
  assert.match((await call('workout_exercise', { action: 'add', exercise: 'leg press' })).text, /^No workout in progress/);
});

test('the coach is told to put an exercise he says he will do on the card in the same turn', () => {
  assert.match(RULES, /workout_exercise: add an exercise to it or move one/);
  assert.match(RULES, /put it on the card at that place in the same turn, with the target you give him/);
});
