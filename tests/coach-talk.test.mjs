import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdScript, setScript, setStartText, pickLine, moodsFor, fill, ceilingFor, callsForCalm, scriptTexts, BASE_BANK } from '../app/js/lib/coach-talk.js';
import { setTimerView, setTimerResult } from '../app/js/lib/session.js';
import { withDefaults } from '../app/js/lib/settings.js';
import { cleanTranscript, onlyGrunts } from '../server/voice/whisper.mjs';
import { systemPrompt } from '../server/coach/prompt.mjs';

// A made-up bank (not his lines).
const BANK = { moods: {
  warrior: { 'hold-ready': [[2, 'W ready.']], 'hold-go': [[2, 'W go.']], 'hold-push': [[2, 'W push a.'], [3, 'W push b.'], [5, 'W push loud.']], 'hold-mid': [[2, 'W mid.']], 'hold-end': [[2, 'W end.']], 'set-start': [[3, 'W start.']], 'set-push': [[3, 'W keep.']] },
  hype: { 'set-start': [[3, 'H start.']], 'set-push': [[2, 'H go.'], [4, 'H loud.']], 'hold-push': [[3, 'H hold.']] },
  dark: { 'set-start': [[3, 'D start.']] },
  rival: { 'set-start': [[3, 'Past you did {rivalKg}.'], [3, 'Past you: {rivalKg} for {rivalReps}.']], record: [[3, 'Closing on {rivalKg}.']] },
} };
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('hold script (A14): GET READY 15 s, 3-2-1, the hold, 3-2-1, done; sounds mark every point', () => {
  const s = holdScript({ getReadyS: 15, holdS: 30, bank: BANK, every: 'steady', rng: seq(0.1) });
  const at = s.cues.map((c) => `${c.at}:${c.kind}`);
  assert.deepEqual(at, ['0:ready', '12:count', '13:count', '14:count', '15:go', '30:mid', '42:count', '43:count', '44:count', '45:end']);
  assert.deepEqual(s.cues.filter((c) => c.kind === 'count').map((c) => c.text), ['Three.', 'Two.', 'One.', 'Three.', 'Two.', 'One.']);
  assert.ok(s.cues.every((c) => c.kind === 'mid' || c.sound), 'every point has a sound for when the voice is off');
  assert.equal(s.cues.find((c) => c.kind === 'go').sound, 'go');
  assert.equal(s.cues.find((c) => c.kind === 'end').sound, 'beeps-3');
  assert.equal(s.cues.find((c) => c.kind === 'ready').text, 'W ready.', 'holds: disciplined Warrior');
  // Often: pushes too, never in the last 8 s of the hold or within 4 s of halfway.
  const o = holdScript({ getReadyS: 15, holdS: 30, bank: BANK, every: 'often', rng: seq(0.1) });
  assert.deepEqual(o.cues.filter((c) => c.kind === 'push').map((c) => c.at), [22, 36]);
  assert.deepEqual(holdScript({ getReadyS: 15, holdS: 30, every: 'once' }).cues.filter((c) => c.kind === 'push'), []);
  // A longer hold he set; no get-ready (a timed set in a session).
  const t = holdScript({ getReadyS: 0, holdS: 45, every: 'steady', rng: seq(0.1) });
  assert.deepEqual(t.cues.map((c) => `${c.at}:${c.kind}`), ['0:go', '12:push', '23:mid', '36:push', '42:count', '43:count', '44:count', '45:end']);
  assert.equal(t.cues[0].text, 'Hold.', 'the plain bank fills in');
  assert.deepEqual(scriptTexts(s).slice(0, 3), ['W ready.', 'Three.', 'Two.']);
});

test('moods: by moment, only those switched on, Calm alone when calm; intensity caps the level', () => {
  assert.deepEqual(moodsFor('hold-push'), ['warrior', 'hype', 'commander']);
  assert.deepEqual(moodsFor('set-start', { moods: { dark: false, rival: false } }), ['warrior', 'hype', 'commander']);
  assert.deepEqual(moodsFor('set-start', { calm: true }), ['calm']);
  assert.equal(pickLine(BANK, 'hold-push', { calm: true, rng: seq(0) }).text, BASE_BANK.calm['hold-push'][0][1]);
  assert.equal(pickLine(BANK, 'hold-push', { intensity: 2, rng: seq(0) }).text, 'W push a.');
  assert.ok(['W push a.', 'W push b.'].includes(pickLine(BANK, 'hold-push', { intensity: 3, moods: { hype: false }, rng: seq(0.1, 0.9) }).text));
  assert.equal(pickLine(BANK, 'hold-push', { intensity: 5, moods: { hype: false }, rng: seq(0.1, 0.99) }).text, 'W push loud.', 'closest levels at 5');
  assert.equal(pickLine(BANK, 'hold-push', { intensity: 1, rng: seq(0) }).text, 'Keep it still.', 'nothing at level 1: the plain line');
  // Everything off: plain Commander lines from the base bank.
  const off = { commander: false, hype: false, dark: false, warrior: false, rival: false };
  assert.deepEqual(pickLine(BANK, 'set-push', { moods: off, rng: seq(0) }), { mood: 'commander', text: 'Controlled.' });
  // Recently said lines are avoided while others are left.
  assert.equal(pickLine(BANK, 'hold-push', { intensity: 3, moods: { hype: false }, avoid: new Set(['W push a.']), rng: seq(0.1, 0) }).text, 'W push b.');
});

test('rival lines need his number; missing values skip the line', () => {
  assert.equal(fill('Past you did {rivalKg}.', { rivalKg: 120 }), 'Past you did 120.');
  assert.equal(fill('{rivalKg} for {rivalReps}', { rivalKg: 90 }), null);
  const only = { hype: false, dark: false, warrior: false, commander: false };
  assert.equal(pickLine(BANK, 'set-start', { moods: only, vars: { rivalKg: 90 }, rng: seq(0) }).text, 'Past you did 90.');
  assert.equal(pickLine(BANK, 'set-start', { moods: only, vars: {}, rng: seq(0) }).mood, 'commander', 'no number: no rival line');
  const c = [{ name: 'Shoulder Press (Machine Plates)', kg: 64, also: ['Seated Shoulder Press (Machine)'] }, { name: 'Squat (Smith Machine)', kg: 120, reps: 6 }];
  assert.equal(ceilingFor(c, 'Seated Shoulder Press (Machine)').kg, 64);
  assert.equal(ceilingFor(c, 'squat (smith machine)').reps, 6);
  assert.equal(ceilingFor(c, 'Leg Press'), null);
});

test('set script (A15): the start line has the set\'s numbers; pushes at his rhythm, none after 45 s; no counts', () => {
  assert.equal(setStartText({ setNo: 2, total: 3, kg: 57.5, reps: [8, 10] }), 'Set 2. 57.5 kilos, 8 to 10 reps.');
  assert.equal(setStartText({ setNo: 2, total: 2, kg: 60, reps: [8, 8] }), 'Last set. 60 kilos, 8 reps.');
  assert.equal(setStartText({ setNo: 1, total: 2, bodyweight: true, reps: [8, 10] }), 'Set 1. Bodyweight, 8 to 10 reps.');
  assert.equal(setStartText({ setNo: 1, total: 2, bodyweight: true, added: 5, reps: [6, 8] }), 'Set 1. Plus 5 kilos, 6 to 8 reps.');
  assert.equal(setStartText({ setNo: 1, total: 3, type: 'warmup', kg: 30, reps: [8, 8] }), 'Warm-up. 30 kilos, 8 reps.');
  const s = setScript({ start: 'Set 1. 60 kilos, 8 reps.', bank: BANK, every: 'steady', rng: seq(0.1) });
  assert.match(s.cues[0].text, /^Set 1\. 60 kilos, 8 reps\. (D|W|H) start\.$/);
  assert.deepEqual(s.cues.map((c) => c.at), [0, 12, 24, 36]);
  assert.ok(s.cues.every((c) => !/\b(one|two|three|more|left)\b/i.test(c.text)), 'never a rep count');
  assert.deepEqual(setScript({ start: 'Set 1.', every: 'once' }).cues.length, 1);
  assert.deepEqual(setScript({ start: 'Set 1.', every: 'often' }).cues.map((c) => c.at), [0, 7, 14, 21, 28, 35, 42]);
  const calm = setScript({ start: 'Set 1.', bank: BANK, calm: true, rng: seq(0.1) });
  assert.ok(calm.cues.every((c) => c.mood === 'calm'), 'Calm only');
});

test('Calm words, grunts, the GET READY timer, the settings and the coach rules', () => {
  for (const t of ['My knee hurts', 'stop', 'ow', 'Ouch.', 'something feels off', 'I feel dizzy', "I can't"]) assert.ok(callsForCalm(t), t);
  for (const t of ['80 for 8', 'next exercise', 'start the timer']) assert.ok(!callsForCalm(t), t);
  for (const t of ['Ugh.', 'Hnngh', 'ahh hmm', 'Rahhh!', 'oof']) { assert.ok(onlyGrunts(t), t); assert.equal(cleanTranscript(t), ''); }
  assert.equal(cleanTranscript('Ouch.'), 'Ouch.');
  assert.equal(cleanTranscript('Ugh, stop.'), 'Ugh, stop.');
  const t = { startedAt: 1000, targetS: 30, readyUntil: 16000 };
  assert.deepEqual(setTimerView(t, 4200), { elapsedS: 0, targetS: 30, leftS: 30, readyS: 12, reached: false, ready: true, text: 'GET READY 12' });
  assert.equal(setTimerView(t, 16000 + 12400).text, '0:18 left');
  assert.equal(setTimerView(t, 16000 + 30000).reached, true);
  assert.equal(setTimerResult(t, 9000), null, 'stopped during GET READY: nothing held');
  assert.equal(setTimerResult(t, 16000 + 21600), 22, 'only the hold part');
  const st = withDefaults(null);
  assert.deepEqual([st.coach.intensity, st.coach.talk, st.holds.getReadyS], [3, { during: true, every: 'steady' }, 15]);
  assert.deepEqual(st.coach.moods, { commander: true, hype: true, dark: true, warrior: true, rival: true });
  const p = systemPrompt({});
  assert.match(p, /MOODS AND TALKING DURING SETS AND HOLDS/);
  assert.match(p, /Calm \(plain, short, no hype, no dark lines\) the moment a safety rule applies/);
  assert.doesNotMatch(p, /During a set or a hold, say nothing/);
});
