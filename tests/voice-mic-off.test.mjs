// Sat 11/7, 9:44 AM and 9:48 AM: the always-on mic was on without him knowing, and what he said to someone else at the
// Mac went to the coach. The chip had said TAP TO LISTEN (mic closed); his dictation in the chat box ended and the app
// opened the always-on mic by itself; while an earlier answer was on its way the chip said THINKING, never HEARING.
// Now: a dictation ends with listening off (MIC OFF, only a tap on the chip turns it on), and whenever the open mic
// takes his words the chip says HEARING with its red dot. Runs the real lib/voice.js on a fake microphone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const bus = new EventTarget();
globalThis.window = globalThis;
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
globalThis.CustomEvent ??= class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', hidden: false });
globalThis.location = { hash: '#/holds' };
// The local database never opens here: anything sent to the Mac stays "on its way" (the coach still thinking).
globalThis.indexedDB = { open: () => ({}) };

// The fake microphone: each node is one open mic; frames are pushed by hand.
let gum = 0; let node = null; const stopped = [];
const part = () => ({ connect() {}, disconnect() {} });
globalThis.AudioContext = class { constructor() { this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
  resume() { return Promise.resolve(); } close() {} createMediaStreamSource() { return part(); } createGain() { return { ...part(), gain: { value: 1 } }; }
  createOscillator() { return { ...part(), start() {}, stop() {}, frequency: { value: 0 } }; } };
globalThis.AudioWorkletNode = class { constructor() { this.port = { onmessage: null }; node = this; setTimeout(() => this.port.onmessage?.({ data: new Float32Array(512) }), 10); } connect() {} disconnect() {} };
Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { gum++; const track = { addEventListener() {}, removeEventListener() {}, stop() { stopped.push(track); } }; return { getAudioTracks: () => [track], getTracks: () => [track] }; } } });

const voice = await import('../app/js/lib/voice.js');
const { micLive } = await import('../app/js/lib/voice-text.js');
const KEY = 'thq.voice.listen';
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const push = (ms, level) => { for (let i = 0; i < Math.round(ms / 32); i++) node.port.onmessage({ data: new Float32Array(512).map((_, j) => (j % 2 ? level : -level)) }); };
const phases = [];
voice.onChange((s) => phases.push(s.phase));

test('dictation from TAP TO LISTEN (mic closed) never opens the always-on mic', async () => {
  localStorage.setItem(KEY, '1'); // listening wanted, but the mic is closed: the chip says TAP TO LISTEN
  const lease = await voice.lendMic(() => {});
  assert.equal(lease.own, true);
  lease.release();
  await tick(100);
  assert.equal(gum, 0, 'the always-on mic was opened after dictation');
  const s = voice.snapshot();
  assert.equal(s.on, false);
  assert.equal(voice.listening(), false);
  assert.equal(s.phase, 'off');
});

test('dictation while the always-on mic is open: it ends with the mic closed and MIC OFF', async () => {
  localStorage.setItem(KEY, '1');
  voice.hold(true); voice.hold(false); // reopens the always-on mic the way the app does (after a screen lends it)
  for (let i = 0; i < 40 && !voice.snapshot().on; i++) await tick(50);
  assert.equal(voice.snapshot().on, true);
  assert.equal(voice.snapshot().phase, 'listening');
  assert.equal(micLive(voice.snapshot()), true);
  const before = stopped.length;
  const lease = await voice.lendMic(() => {});
  assert.equal(lease.own, false);
  assert.equal(micLive(voice.snapshot()), false, 'no red dot while dictation has the mic');
  lease.release();
  await tick(50);
  assert.equal(stopped.length, before + 1, 'the mic was not closed');
  assert.equal(voice.snapshot().on, false);
  assert.equal(voice.listening(), false);
  assert.equal(voice.snapshot().phase, 'off');
  // Coming back to the app does not switch it on either.
  document.dispatchEvent(new Event('visibilitychange'));
  await tick(100);
  assert.equal(voice.snapshot().on, false);
});

test('speech while an earlier answer is on its way shows HEARING, then THINKING', async () => {
  localStorage.setItem(KEY, '1');
  voice.hold(true); voice.hold(false);
  for (let i = 0; i < 40 && !voice.snapshot().on; i++) await tick(50);
  push(700, 0.002);
  phases.length = 0;
  push(900, 0.1); // he talks
  assert.equal(voice.snapshot().phase, 'hearing');
  push(1000, 0.002); // he stops: the clip goes to the Mac and stays on its way
  await tick();
  assert.equal(voice.snapshot().phase, 'thinking');
  push(900, 0.1); // he talks again (9:44 AM: this showed THINKING)
  assert.equal(voice.snapshot().phase, 'hearing');
  assert.equal(micLive(voice.snapshot()), true);
  push(1000, 0.002);
  await tick();
  assert.equal(voice.snapshot().phase, 'thinking');
  assert.deepEqual(phases.filter((p, i) => p !== phases[i - 1]), ['hearing', 'thinking', 'hearing', 'thinking']);
  voice.stop();
  assert.equal(voice.snapshot().on, false);
});

test('the red dot: only while the mic is open and not lent to dictation', () => {
  assert.equal(micLive({ on: true, phase: 'listening' }), true);
  assert.equal(micLive({ on: true, phase: 'hearing' }), true);
  assert.equal(micLive({ on: true, phase: 'thinking' }), true);
  assert.equal(micLive({ on: true, phase: 'speaking' }), true);
  assert.equal(micLive({ on: true, phase: 'paused' }), false);
  assert.equal(micLive({ on: false, phase: 'tap' }), false);
  assert.equal(micLive({ on: false, phase: 'off' }), false);
  assert.equal(micLive({ on: false, phase: 'speaking' }), false);
});
