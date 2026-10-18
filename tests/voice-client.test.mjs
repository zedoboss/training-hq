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
