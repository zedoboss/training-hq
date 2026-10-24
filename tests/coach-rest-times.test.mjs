// Sat 10/24, his words: "Also the rest is set to 2m ur data is outdated or u didnt Check". The coach said 1:30 on the
// curls from his profile's old rule while the session had 2:00 set on them. The coach now sees each exercise's real
// rest on his phone (its own time, else the Settings default), in a session and out of one. Made-up numbers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { contextLine, restLine } from '../server/coach/tools-read.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'UTC';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00Z`);
const NOW = at('2026-03-17', '15:20');
let dir; let store;
const w = (col, id, data) => store.writeLocal(col, id, data);
const s = () => snapshot(store, { tz: TZ, now: NOW });
const today = async () => { const r = await TOOLS.find((t) => t.name === 'today').run({}, { store, tz: TZ, now: () => NOW, action: () => {} }); return typeof r === 'string' ? r : r.text; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-rest-'));
  store = openStore(join(dir, 'db.sqlite'));
  w('settings', 'main', { rest: { mainS: 180, lightS: 90, holdS: 120, warmupS: 60 } });
  w('sessions', 'old', { id: 'old', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('2026-03-10', '09:00'), endedAt: at('2026-03-10', '10:00'), status: 'done', exercises: [
    { key: 'p', name: 'Preacher Curl (Dumbbell)', type: 'weight_reps', notes: 'Single arm, desna pa leva' }] });
  w('sets', 'o1', { id: 'o1', sessionId: 'old', exKey: 'p', order: 0, type: 'normal', kg: 8, reps: 9, done: true, doneAt: at('2026-03-10', '09:05') });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const openSession = () => {
  w('sessions', 'now', { id: 'now', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('2026-03-17', '14:50'), pausedMs: 0, status: 'active', exercises: [
    { key: 'r', name: 'Row', type: 'weight_reps', capClass: 'main', restSeconds: null },
    { key: 'h', name: 'Hammer Curl (Dumbbell)', type: 'weight_reps', capClass: 'light', restSeconds: 120 },
    { key: 'p', name: 'Preacher Curl (Dumbbell)', type: 'weight_reps', capClass: 'light', restSeconds: 120, notes: '' },
    { key: 'c', name: 'Crunch', type: 'weight_reps', capClass: 'light', restSeconds: null },
    { key: 'x', name: 'Shrug', type: 'weight_reps', capClass: 'main', restSeconds: 0 },
    { key: 'k', name: 'Skipped Fly', type: 'weight_reps', capClass: 'light', restSeconds: null, skipped: true }] });
  w('sets', 'h1', { id: 'h1', sessionId: 'now', exKey: 'h', order: 0, type: 'normal', kg: 10, reps: 12, done: true, doneAt: at('2026-03-17', '15:04') });
  w('sets', 'h2', { id: 'h2', sessionId: 'now', exKey: 'h', order: 1, type: 'normal', kg: 10, target: { reps: [8, 10] }, done: false });
};

test("in a session: each exercise's own rest wins over the default; the defaults come from his Settings", () => {
  openSession();
  const line = restLine(s(), s().active());
  assert.match(line, /Hammer Curl \(Dumbbell\) 2:00 \(set on this exercise\)/);
  assert.match(line, /Preacher Curl \(Dumbbell\) 2:00 \(set on this exercise\) \(after each round; no rest between the arms\)/);
  assert.match(line, /Row 3:00(?! \(set)/);
  assert.match(line, /Crunch 1:30(?! \(set)/);
  assert.match(line, /Shrug off \(set on this exercise\)/);
  assert.doesNotMatch(line, /Skipped Fly/);
  assert.match(line, /Settings defaults: main lifts 3:00, light work 1:30, warm-up sets 1:00, between holds 2:00/);
  assert.match(line, /never from his profile or memory/);
});

test('the context with every message and the today tool both carry the live rest times', async () => {
  openSession();
  assert.match(contextLine({ store, tz: TZ, now: NOW }), /Rest times on his phone now: [^\n]*Hammer Curl \(Dumbbell\) 2:00/);
  assert.match(await today(), /Rest times on his phone now: [^\n]*Hammer Curl \(Dumbbell\) 2:00/);
});

test('a changed Settings default shows at once, no session needed; a routine exercise with its own rest is named', async () => {
  w('settings', 'main', { rest: { mainS: 150, lightS: 120, holdS: 120, warmupS: 60 } });
  w('routines', 'push', { id: 'push', title: 'Push', dayType: 'push', exercises: [{ key: 'a', name: 'Hammer Curl (Dumbbell)', restSeconds: 105 }, { key: 'b', name: 'Row', restSeconds: null }] });
  const text = await today();
  assert.match(text, /Rest times in the app \(Settings defaults\): main lifts 2:30, light work 2:00, warm-up sets 1:00, between holds 2:00\./);
  assert.match(text, /Set on the exercise in his Push routine: Hammer Curl \(Dumbbell\) 1:45\./);
  assert.doesNotMatch(text, /Row 3:00/);
});

test('a holds session gives the hold rest only', () => {
  w('sessions', 'hs', { id: 'hs', kind: 'holds', area: 'knees', title: 'Knee holds', startedAt: at('2026-03-17', '15:00'), pausedMs: 0, status: 'active', exercises: [{ key: 'w', name: 'Wall Squat Hold', type: 'weight_duration' }] });
  assert.equal(restLine(s(), s().one('sessions', 'hs')), 'Rest between holds on his phone: 2:00. Say rest times only from here, never from his profile or memory.');
});

test('the rules say rest times come only from the app', () => {
  assert.match(RULES, /Rest times \(his words, Sat 10\/24[^\n]*never from his profile or memory/i);
});

test('a finished session still shows the rest set on its exercises when he looks back', async () => {
  openSession();
  w('sessions', 'now', { ...s().one('sessions', 'now'), status: 'done', endedAt: at('2026-03-17', '15:40') });
  const hist = await TOOLS.find((t) => t.name === 'history').run({ exercise: null }, { store, tz: TZ, now: () => NOW, action: () => {} });
  assert.match(typeof hist === 'string' ? hist : hist.text, /Hammer Curl \(Dumbbell\): [^\n]*\(rest 2:00, set on this exercise\)/);
});
