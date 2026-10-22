// Voice on the phone (step 9): speech detection and the other pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVad } from '../app/js/lib/vad.js';

const FRAME = 512; // 32 ms at 16 kHz
const frames = (ms, level) => Array.from({ length: Math.round(ms / 32) }, () => new Float32Array(FRAME).map((_, i) => (i % 2 ? level : -level)));
const run = (vad, parts) => { for (const [ms, level] of parts) for (const f of frames(ms, level)) vad.push(f); };

test('VAD: a word in a quiet room is one clip with a little lead-in', () => {
  const ev = [];
  const vad = createVad({}, (e) => ev.push(e));
  run(vad, [[600, 0.002], [800, 0.1], [900, 0.002]]);
  assert.deepEqual(ev.map((e) => e.type), ['start', 'end']);
  const sec = ev[1].samples.length / 16000;
  assert.ok(sec > 1.1 && sec < 1.9, `clip ${sec} s`);
  assert.equal(ev[1].cut, false);
});

test('VAD: a short knock is noise, not a clip', () => {
  const ev = [];
  const vad = createVad({}, (e) => ev.push(e));
  run(vad, [[600, 0.002], [130, 0.2], [900, 0.002]]);
  assert.deepEqual(ev.map((e) => e.type), ['start', 'noise']);
});

test('VAD: steady loud music stops counting after a while; louder speech over it still starts', () => {
  const ev = [];
  const vad = createVad({}, (e) => ev.push(e));
  run(vad, [[600, 0.002], [12000, 0.05]]);
  // The music start counts once (cut at 10 s) ...
  const starts = ev.filter((e) => e.type === 'start').length;
  ev.length = 0;
  run(vad, [[20000, 0.05]]);
  // ... after the floor has followed it, it no longer starts clips.
  assert.equal(ev.filter((e) => e.type === 'start').length, 0, `music kept starting clips (first part: ${starts})`);
  run(vad, [[900, 0.3], [900, 0.05]]);
  assert.deepEqual(ev.map((e) => e.type), ['start', 'end']);
});

test('VAD: a long speech is cut at the limit; boost makes it harder to start', () => {
  const ev = [];
  const vad = createVad({ maxSec: 2 }, (e) => ev.push(e));
  run(vad, [[600, 0.002], [3000, 0.1]]);
  assert.equal(ev.find((e) => e.type === 'end').cut, true);
  const ev2 = [];
  const v2 = createVad({}, (e) => ev2.push(e));
  run(v2, [[600, 0.002]]);
  v2.setBoost(40);
  run(v2, [[800, 0.05], [900, 0.002]]);
  assert.equal(ev2.length, 0);
  v2.setBoost(1);
  run(v2, [[800, 0.05], [900, 0.002]]);
  assert.deepEqual(ev2.map((e) => e.type), ['start', 'end']);
});

test('spoken text: times with A M / P M, dates as month and day, kilos, no symbols', async () => {
  const { speechText } = await import('../app/js/lib/voice-text.js');
  assert.equal(speechText('Pull at 4:30 AM, Sunday 10/11. Readiness check at 4:00 AM.'), 'Pull at 4:30 A M, Sunday October 11. Readiness check at 4:00 A M.');
  assert.equal(speechText('**Squat** 65 kg x 8 · 2 sets'), 'Squat 65 kilos for 8, 2 sets');
  assert.equal(speechText('- Smith bench: 41.3 kg total (11.3 kg bar + 15 kg a side)'), 'Smith bench: 41.3 kilos total (11.3 kilos bar + 15 kilos a side)');
  assert.equal(speechText('at 7:30pm.'), 'at 7:30 P M.');
});

test('sentence splitter: whole sentences as they complete, decimals kept together', async () => {
  const { sentenceSplitter } = await import('../app/js/lib/voice-text.js');
  const s = sentenceSplitter();
  assert.deepEqual(s.push('Logged 62.5 kg'), []);
  assert.deepEqual(s.push(' for 10. That\'s over'), ['Logged 62.5 kg for 10.']);
  assert.deepEqual(s.push(' your cap! Drop'), ["That's over your cap!"]);
  assert.deepEqual(s.push(' to 60.'), []);
  assert.deepEqual(s.flush(), ['Drop to 60.']);
  assert.deepEqual(s.flush(), []);
});

test('quiet rule: a lone "Logged." is a tick; anything more is spoken in order', async () => {
  const { replyGate } = await import('../app/js/lib/voice-text.js');
  let g = replyGate();
  assert.deepEqual(g.sentence('Logged.'), []);
  assert.deepEqual(g.end(), { speak: [], tick: true });
  g = replyGate();
  assert.deepEqual(g.sentence('Logged.'), []);
  assert.deepEqual(g.sentence('That is a comeback best.'), ['Logged.', 'That is a comeback best.']);
  assert.deepEqual(g.sentence('Rest 3:00.'), ['Rest 3:00.']);
  assert.deepEqual(g.end(), { speak: [], tick: false });
  g = replyGate();
  assert.deepEqual(g.sentence('Legs today.'), ['Legs today.'], 'any other first sentence is spoken at once');
  assert.deepEqual(g.sentence('Week 4 column.'), ['Week 4 column.']);
  assert.deepEqual(g.end(), { speak: [], tick: false });
  assert.deepEqual(replyGate().end(), { speak: [], tick: false });
});

test('quiet times: on while any reason is on; the end is announced once', async () => {
  const { setQuiet, isQuiet, onQuietEnd } = await import('../app/js/lib/quiet.js');
  let ends = 0;
  const off = onQuietEnd(() => ends++);
  setQuiet('hold', true); setQuiet('set-timer', true);
  assert.equal(isQuiet(), true);
  setQuiet('hold', false);
  assert.equal(isQuiet(), true);
  assert.equal(ends, 0);
  setQuiet('set-timer', false);
  assert.equal(isQuiet(), false);
  assert.equal(ends, 1);
  setQuiet('set-timer', false);
  assert.equal(ends, 1);
  off();
});

test('voice buttons: the mic only mutes him, the X stops the coach (Thu 10/22)', async () => {
  const { micTap, showsStop } = await import('../app/js/lib/voice-text.js');
  // Muting while the coach thinks or speaks is a mute, never a hush.
  assert.equal(micTap({ on: true, held: false, phase: 'speaking' }), 'mute');
  assert.equal(micTap({ on: true, held: false, phase: 'thinking' }), 'mute');
  assert.equal(micTap({ on: false, held: false, phase: 'speaking' }), 'listen');
  assert.equal(micTap({ on: false, held: true }), 'held');
  assert.equal(showsStop({ replying: true }), true);
  assert.equal(showsStop({ replying: false }), false);
  // Switching the mic off leaves an answer on its way, or being spoken, alone.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../app/js/lib/voice.js', import.meta.url), 'utf8');
  const stop = src.slice(src.indexOf('export function stop()'), src.indexOf('\n}\n', src.indexOf('export function stop()')));
  assert.doesNotMatch(stop, /speechGen\+\+|player\.stop\(\)|quietQueue/);
  const hud = await readFile(new URL('../app/js/ui/voice-hud.js', import.meta.url), 'utf8');
  assert.match(hud, /stopEl\.addEventListener\('click', \(\) => voice\.hush\(\)\)/);
  assert.doesNotMatch(hud.slice(hud.indexOf("el.addEventListener('click'")), /hush/);
});
