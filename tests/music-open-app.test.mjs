// Wed 11/11, 3:58 PM: "Opening the training hq stops my music again" (Talk screen). The server log: "voice chip:
// 08:58:26 listening": the app opened the always-on mic by itself as it came on screen. An open microphone puts iPhone
// in 'play-and-record', which pauses his music. Now opening the app or coming back to it never opens the mic: the chip
// says TAP TO LISTEN and the audio mode stays the mixing one. Runs the real lib/voice.js on a fake microphone.
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
globalThis.location = { hash: '#/coach' };
globalThis.indexedDB = { open: () => ({}) };

// iPhone's audio session: every mode the app sets is kept in order.
const modes = [];
let mode = 'auto';
Object.defineProperty(globalThis.navigator, 'audioSession', { configurable: true, value: { get type() { return mode; }, set type(v) { mode = v; modes.push(v); } } });

let gum = 0; const stopped = [];
const part = () => ({ connect() {}, disconnect() {} });
globalThis.AudioContext = class { constructor() { this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
  resume() { return Promise.resolve(); } close() {} createMediaStreamSource() { return part(); } createGain() { return { ...part(), gain: { value: 1 } }; }
  createOscillator() { return { ...part(), start() {}, stop() {}, frequency: { value: 0 } }; } };
globalThis.AudioWorkletNode = class { constructor() { this.port = { onmessage: null }; setTimeout(() => this.port.onmessage?.({ data: new Float32Array(512) }), 10); } connect() {} disconnect() {} };
Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { gum++; const track = { addEventListener() {}, removeEventListener() {}, stop() { stopped.push(track); } }; return { getAudioTracks: () => [track], getTracks: () => [track] }; } } });

const voice = await import('../app/js/lib/voice.js');
const KEY = 'thq.voice.listen';
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const show = (v) => { document.visibilityState = v; document.hidden = v === 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };

test('opening the app with listening on: no mic, TAP TO LISTEN, music keeps playing', async () => {
  assert.equal(mode, 'ambient', 'the app opens in the mixing mode');
  localStorage.setItem(KEY, '1');
  voice.resume(); // main.js at start (the Mac check never answers here: the chip must not wait for it)
  await tick(100);
  assert.equal(gum, 0, 'the mic was opened by itself when the app opened');
  assert.equal(voice.snapshot().on, false);
  assert.equal(voice.snapshot().phase, 'tap');
  assert.ok(!modes.includes('play-and-record'), 'the audio mode that pauses music was set');
  assert.equal(mode, 'ambient');
});

test('switching back to the app (any screen): the mic it had stays closed until he taps', async () => {
  localStorage.setItem(KEY, '1');
  voice.hold(true); voice.hold(false); // the mic open, as after his tap
  for (let i = 0; i < 40 && !voice.snapshot().on; i++) await tick(50);
  assert.equal(voice.snapshot().on, true);
  assert.equal(mode, 'play-and-record');
  const opened = gum;
  show('hidden'); // he switches to his music app
  await tick();
  assert.equal(voice.snapshot().on, false);
  assert.equal(mode, 'ambient', 'closing the mic gives the audio back to his music');
  modes.length = 0;
  for (const hash of ['#/coach', '#/today', '#/session']) {
    location.hash = hash;
    show('visible'); // opens the app again
    await tick(100);
    assert.equal(gum, opened, `the mic opened by itself on ${hash}`);
    assert.equal(voice.snapshot().phase, 'tap');
    show('hidden'); await tick();
  }
  assert.ok(!modes.includes('play-and-record'));
  assert.equal(voice.listening(), true, 'listening stays chosen: one tap on the chip opens the mic');
});

test('with listening off, opening or coming back does nothing to the audio', async () => {
  voice.stop(); // he tapped the chip off
  const opened = gum; modes.length = 0;
  show('visible'); await tick(100);
  voice.resume(); await tick(50);
  assert.equal(gum, opened);
  assert.equal(voice.snapshot().phase, 'off');
  assert.ok(!modes.includes('play-and-record') && !modes.includes('playback'));
});
