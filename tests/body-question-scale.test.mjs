// Thu 11/19, 6:42 AM the coach asked "How does your body feel today? Knees, legs and back, 0 to 3?" and he answered
// "Weird question i dont get it change it too u mean pain or what?". Every 0 to 3 body question now says it asks about
// soreness or pain and what 0 and 3 mean: the morning question (both forms), the check-in notification, the coach's
// rules, and spoken "0 = none" reads as "0 is none".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningBodyText, SORE_SCALE } from '../app/js/lib/nudges.js';
import { remindersFor } from '../app/js/lib/reminders.js';
import { speechText } from '../app/js/lib/voice-text.js';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-20';
const SAYS_SCALE = /soreness or pain.*0 = none, 3 = bad/i;
const BARE = /\b0 to 3\b|zero to three|body feel/i;

test('the morning body question with no pain behind it: soreness or pain, 0 and 3 explained', () => {
  const t = morningBodyText(null, D, TZ);
  assert.equal(t, 'Any soreness or pain today? Knees, legs, lower back: 0 = none, 3 = bad.');
  assert.match(t, SAYS_SCALE);
  assert.doesNotMatch(t, BARE);
});

test('the morning question after pain on his last workout says the scale too', () => {
  const t = morningBodyText({ label: 'Legs', date: '2026-03-18', parts: ['knees'], exercise: 'Smith Squat (Machine)' }, D, TZ);
  assert.equal(t, "How's your knees today? It hurt on smith squat on Wednesday 3/18 (Legs). Soreness or pain, 0 = none, 3 = bad? And does it still hurt when you bend or move?");
  assert.doesNotMatch(t, BARE);
  assert.match(morningBodyText({ label: 'Pull', date: '2026-03-19', parts: [], exercise: null }, D, TZ), /^How's your body today\? It hurt yesterday \(Pull\)\. Soreness or pain, 0 = none, 3 = bad\?/);
  assert.equal(SORE_SCALE, '0 = none, 3 = bad');
});

test('the check-in notification says what 0 and 3 mean, energy the other way round', () => {
  const areas = [{ kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Gym Hold', when: 'after Legs', where: 'gym' }], loadsArea: { exercises: [] } }];
  const meta = { firstSessions: { pull: '2026-01-01', push: '2026-01-02', legs: '2026-01-03' } };
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30' } };
  const legs = remindersFor({ tz: TZ, areas, table: { workingArea: { legs: ['L', 'B'] } }, meta, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18', streak: 2 }, days })
    .find((i) => i.kind === 'readiness');
  assert.equal(legs.body, 'Legs at 4:30 AM, week 3 column. Knees, legs, back: soreness or pain, 0 = none, 3 = bad. Energy: 0 = drained, 3 = high.');
  assert.equal(legs.lateBody, 'Legs now, week 3 column. Knees, legs, back: soreness or pain, 0 = none, 3 = bad. Energy: 0 = drained, 3 = high.');
  // Nothing to rate but energy: only the energy scale.
  const push = remindersFor({ tz: TZ, areas: [], table: { workingArea: { push: [] } }, meta, date: '2026-01-20', last: { dayType: 'pull', date: '2026-01-18', streak: 2 }, days })
    .find((i) => i.kind === 'readiness');
  assert.equal(push.body, 'Push at 4:30 AM, week 3 column. Energy: 0 = drained, 3 = high.');
  for (const t of [legs.body, legs.lateBody, push.body]) assert.doesNotMatch(t, BARE);
});

test("the coach's rules: every rating question says what it measures, no bare 0 to 3", () => {
  assert.match(RULES, /A 0 to 3 rating always says what it measures and what 0 and 3 mean/);
  assert.match(RULES, /Any soreness or pain today\? Knees, legs, lower back: 0 = none, 3 = bad\./);
  // The only bare "0 to 3?" left is the question he complained about, quoted in the rule.
  assert.deepEqual(RULES.match(/\b0 to 3\?/g), ['0 to 3?'], 'no example question ends in a bare "0 to 3?"');
});

test('spoken, the scale reads as words', () => {
  assert.equal(speechText('Any soreness or pain today? Knees, legs, lower back: 0 = none, 3 = bad.'), 'Any soreness or pain today? Knees, legs, lower back: 0 is none, 3 is bad.');
  assert.equal(speechText('Energy: 0 = drained, 3 = high.'), 'Energy: 0 is drained, 3 is high.');
  assert.equal(speechText('2 + 2 = 4'), '2 + 2 = 4');
});
