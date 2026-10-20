import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressed, looksUnfinished } from '../server/voice/address.mjs';

const now = Date.parse('2026-10-19T16:30:00+07:00');
const ok = (t, o = {}) => addressed(t, { now, ...o });

test('the coach answers when he names it: Jarvis, coach, AI', () => {
  for (const t of ['Yo Jarvis, what is up', 'Hey coach', 'What do you think, coach?', 'AI, how many calories left?', 'A.I. what time is it'])
    assert.deepEqual(ok(t), { ok: true, why: 'named' }, t);
  assert.equal(ok('I said it again').ok, false, '"ai" inside a word is not AI');
  assert.equal(ok('Coaching is hard work').ok, false, '"coaching" is not "coach"');
});

test('his app\'s subjects get an answer; random talk does not', () => {
  for (const t of ['80 for 8', '62.5 for 10', 'Bodyweight for 12, last set to failure', 'Took my creatine and vitamin C', "What's my next set?",
    'How heavy is the bench today?', 'Start the timer', 'Skip the rest', 'I ate 3 eggs and rice', 'Knees one, not worse. Legs zero, back zero, energy two.',
    'Slept at midnight, woke up at nine', 'Going to the sauna', 'Evolt says 80.4'])
    assert.equal(ok(t).ok, true, t);
  for (const t of ['Bro did you see that game last night', 'Yeah I will call you later', 'Pass me the charger', "I'm done with this movie", 'Come back here'])
    assert.deepEqual(ok(t), { ok: false, why: 'aside' }, t);
});

test('his own exercise and supplement names count; one weak word counts during a session; answers within a minute', () => {
  assert.equal(ok('Cupping now', { names: ['Cupping', 'Leg Extension'] }).ok, true);
  assert.equal(ok('Doing leg extension', { names: ['Leg Extension'] }).ok, true);
  assert.equal(ok('That was heavy').ok, false);
  assert.equal(ok('That was heavy', { inSession: true }).ok, true);
  assert.deepEqual(ok('Yes', { lastCoachAt: now - 30000 }), { ok: true, why: 'answer' });
  assert.equal(ok('Yes', { lastCoachAt: now - 120000 }).ok, false);
});

test('telling the app to do something gets an answer (Tue 10/20): screens, workouts, settings', () => {
  for (const t of ['Open the chat', 'Show me my supplements', 'Go to settings', 'Start push', 'Finish the workout', 'Pause the clock',
    'Turn off the mic', 'Switch to Opus', 'Take me to the calendar', 'Open my history'])
    assert.deepEqual(ok(t), { ok: true, why: 'command' }, t);
  for (const t of ['Open the door', 'Show me the money', "Let's go to the gym", 'Start the car']) assert.equal(ok(t).ok, false, t);
});

test('a clip that ends mid-thought waits for the rest', () => {
  for (const t of ['I woke up slightly before 10:00, so...', 'I had eggs and', 'Bench was heavy,', 'I went to bed around…']) assert.equal(looksUnfinished(t), true, t);
  for (const t of ['I went to bed around 12 a.m.', '80 for 8', 'Yo Jarvis', 'Next exercise.']) assert.equal(looksUnfinished(t), false, t);
});

