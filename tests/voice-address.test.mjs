import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressed, looksUnfinished, selfTalk, otherVoice } from '../server/voice/address.mjs';

const now = Date.parse('2026-10-19T16:30:00+07:00');
const ok = (t, o = {}) => addressed(t, { now, othersAround: true, ...o }); // someone else talking near him
const alone = (t, o = {}) => addressed(t, { now, ...o });

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


test('alone (Tue 10/20, his words: "There are no people talking here"): everything he says is for the coach, but self-talk', () => {
  for (const t of ["Yo, what's up?", 'What do you think?', 'How am I doing today', 'Bro did you see that game last night', 'Tell me something'])
    assert.deepEqual(alone(t), { ok: true, why: 'alone' }, t);
  for (const t of ['Okay', 'Come on!', "Let's go", 'One more', 'Fuck', 'Eight, nine, ten', 'Yeah yeah', 'Light weight baby'])
    assert.deepEqual(alone(t), { ok: false, why: 'self-talk' }, t);
  assert.deepEqual(alone('Yeah', { lastCoachAt: now - 20000 }), { ok: true, why: 'answer' }, 'an answer to the coach is never self-talk');
  assert.deepEqual(alone('Come on coach'), { ok: true, why: 'named' });
  assert.equal(selfTalk("Let's go, let's go, come on, push, push, one more"), false, 'more than five words is more than self-talk');
});

test('someone else near him: a clip the voice lock rejected, clearly not him, a second or more, not the coach\'s own voice', () => {
  const base = { reason: 'not-you', score: 0.05, speechSec: 4, lastCoachAt: 0, now };
  assert.equal(otherVoice(base), true);
  assert.equal(otherVoice({ ...base, score: 0.43 }), false, 'a short clip of his own scores near 0.4');
  assert.equal(otherVoice({ ...base, speechSec: 0.5 }), false, 'too short to be a conversation');
  assert.equal(otherVoice({ ...base, reason: 'noise' }), false);
  assert.equal(otherVoice({ ...base, reason: 'music' }), false);
  assert.equal(otherVoice({ ...base, score: null, reason: 'unsure' }), false);
  assert.equal(otherVoice({ ...base, lastCoachAt: now - 20000 }), false, 'the coach just spoke: its own voice from his speaker');
  assert.equal(otherVoice({ ...base, lastCoachAt: now - 60000 }), true);
});

test('how long the Mac waits for more (Tue 10/20): quick for questions and commands, longer while he tells it something', async () => {
  const { holdFor, HOLDS, isHush } = await import('../server/voice/address.mjs');
  for (const t of ['Yo coach', "What's next?", '80 for 8', 'Start the timer', 'Next exercise', 'What did I eat today?']) assert.equal(holdFor(t), HOLDS.quick, t);
  for (const t of ['Yo, I just finished my meal 10 minutes ago. My last meal.', 'And you know it, 500 grams of beef uncooked.', 'I had eggs and', 'For my last meal I cooked rice'])
    assert.equal(holdFor(t), HOLDS.telling, t);
  assert.equal(holdFor('Yeah, I just took the collagen, so please tick that.'), HOLDS.between);
  for (const t of ['Okay, okay, you can stop, that\'s enough', 'Stop.', 'Shut up', 'OK that\'s enough coach', 'Be quiet please', 'Alright, stop talking'])
    assert.equal(isHush(t), true, t);
  for (const t of ['Stop the timer', 'Stop nudging me for an hour', 'Stop the workout', "That's enough protein for today?", 'I had enough'])
    assert.equal(isHush(t), false, t);
});
