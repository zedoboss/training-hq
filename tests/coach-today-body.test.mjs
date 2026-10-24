// Sat 10/24, his words: "I told u i skipped 2nd exercise where did ur data go?" Asked whether his lower back would hurt
// on the next exercise, the coach answered from earlier days only and asked how his back was, though he had skipped an
// exercise for back pain in the open session an hour before. Today's skips with reasons, logged pain and what he said
// about his body today now go with every message. Made-up numbers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { contextLine, todayBodyLine } from '../server/coach/tools-read.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'UTC';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00Z`);
const NOW = at('2026-03-17', '16:02');
let dir; let store;
const w = (col, id, data) => store.writeLocal(col, id, data);
const s = (now = NOW) => snapshot(store, { tz: TZ, now });
const msg = (id, hm, role, text, extra = {}) => w('coach-messages', id, { id, at: at('2026-03-17', hm), role, text, ...extra });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-body-'));
  store = openStore(join(dir, 'db.sqlite'));
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const pull = (status = 'active') => {
  w('sessions', 'p', { id: 'p', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('2026-03-17', '14:48'), status, endedAt: status === 'done' ? at('2026-03-17', '16:10') : null, exercises: [
    { key: 'u', name: 'Pull Up', type: 'weight_reps' },
    { key: 'r', name: 'Cable Row', type: 'weight_reps', skipped: { at: at('2026-03-17', '15:01'), reason: 'Lower back pain can be felt' } },
    { key: 'h', name: 'Hammer Curl', type: 'weight_reps', notes: 'wrist pain sometimes, 30 s hold' }] });
  w('sets', 'u1', { id: 'u1', sessionId: 'p', exKey: 'u', order: 0, type: 'normal', kg: 0, reps: 10, done: true, doneAt: at('2026-03-17', '14:50') });
  w('sets', 'r0', { id: 'r0', sessionId: 'p', exKey: 'r', order: 1, type: 'warmup', kg: 20, reps: 8, done: true, doneAt: at('2026-03-17', '14:57') });
  w('sets', 'r1', { id: 'r1', sessionId: 'p', exKey: 'r', order: 2, type: 'normal', kg: 40, done: false });
  w('sets', 'h1', { id: 'h1', sessionId: 'p', exKey: 'h', order: 3, type: 'normal', kg: 8, reps: 12, pain: 2, done: true, doneAt: at('2026-03-17', '15:05') });
  w('sets', 'h2', { id: 'h2', sessionId: 'p', exKey: 'h', order: 4, type: 'normal', kg: 8, reps: 10, pain: 0, done: true, doneAt: at('2026-03-17', '15:08') });
  msg('m1', '15:00', 'user', "I feel my lower back when I'm doing the second exercise, so I just stopped.", { via: 'voice' });
  msg('m2', '15:00', 'assistant', 'Good call to stop. Skip the rest of the row?');
  msg('m3', '15:01', 'user', 'My back hurts.');
  msg('m4', '15:01', 'assistant', 'Okay, then stop loading your back today.');
  msg('m5', '15:30', 'assistant', 'Holds still open today.', { kind: 'reminder' });
  msg('m6', '15:40', 'user', "I'm back on the bench, next set");
  msg('m7', '15:41', 'assistant', 'Go.');
};

test('the open session: the skipped exercise with its reason and the sets before it, pain he logged, his words with your answer', () => {
  pull();
  const line = todayBodyLine(s());
  assert.match(line, /^Today so far, his body and skips/);
  assert.match(line, /Pull \(open now\): SKIPPED Cable Row at 3:01 PM after 20 kg × 8 warm-up, his reason: "Lower back pain can be felt"/);
  assert.match(line, /Hammer Curl 8 kg × 12, pain 2\/10/);
  assert.doesNotMatch(line, /pain 0\/10/);
  assert.match(line, /3:00 PM "I feel my lower back[^"]*" \(you: "Good call to stop/);
  assert.match(line, /3:01 PM "My back hurts\." \(you: "Okay, then stop loading your back today\."\)/);
  // A standing exercise note from the routine isn't today's pain; "I'm back on the bench" isn't his body.
  assert.doesNotMatch(line, /wrist pain sometimes/);
  assert.doesNotMatch(line, /back on the bench/);
  assert.doesNotMatch(line, /Holds still open/);
});

test('it goes with every message, also after the session is finished, and the rule tells the coach to answer from it', () => {
  pull('done');
  const ctx = contextLine({ store, tz: TZ, now: at('2026-03-17', '17:00') });
  assert.match(ctx, /Today so far, his body and skips[^\n]*Pull: SKIPPED Cable Row[^\n]*"Lower back pain can be felt"/);
  assert.doesNotMatch(ctx, /Pull \(open now\)/);
  assert.match(RULES, /before you answer about an exercise, pain or how something will feel, read the context's "Today so far, his body and skips" line/);
  assert.match(RULES, /never ask what it already answers/);
});

test("yesterday's skips and words stay out (the timeline has them); a discarded session too; nothing today = no line", () => {
  pull();
  const tomorrow = at('2026-03-18', '10:00');
  assert.equal(todayBodyLine(s(tomorrow)), '');
  w('sessions', 'x', { id: 'x', kind: 'workout', title: 'Push', dayType: 'push', startedAt: at('2026-03-18', '09:00'), status: 'discarded', exercises: [
    { key: 'b', name: 'Bench', type: 'weight_reps', skipped: { at: at('2026-03-18', '09:05'), reason: 'shoulder pain' } }] });
  assert.equal(todayBodyLine(s(tomorrow)), '');
  assert.doesNotMatch(contextLine({ store, tz: TZ, now: tomorrow }), /Today so far, his body/);
});

test('a skip without a reason still shows, and a holds round with pain counts too', () => {
  w('sessions', 'p', { id: 'p', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at('2026-03-17', '09:00'), status: 'active', exercises: [
    { key: 'l', name: 'Leg Curl', type: 'weight_reps', skipped: { at: at('2026-03-17', '09:20') } }] });
  w('sessions', 'h', { id: 'h', kind: 'holds', area: 'Knees', startedAt: at('2026-03-17', '08:00'), status: 'done', exercises: [{ key: 'w', name: 'Wall Squat Hold', type: 'duration' }] });
  w('sets', 'w1', { id: 'w1', sessionId: 'h', exKey: 'w', order: 0, type: 'hold', durationS: 30, pain: 3, done: true, doneAt: at('2026-03-17', '08:01') });
  const line = todayBodyLine(s());
  assert.match(line, /Legs \(open now\): SKIPPED Leg Curl at 9:20 AM, his reason: none given/);
  assert.match(line, /holds round \(Knees\): Wall Squat Hold 30 s, pain 3\/10/);
});

test('a workout still open after midnight keeps its skips in the line', () => {
  pull();
  const line = todayBodyLine(s(at('2026-03-18', '00:20')));
  assert.match(line, /Pull \(open now\): SKIPPED Cable Row[^|]*"Lower back pain can be felt"/);
});
