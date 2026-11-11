// Wed 11/11, 4:10 PM: "Nope still pauses my brave music". Opening Training HQ paused music playing in Brave, with no
// microphone open (the 4:06 PM fix). Cause: the app's audio context, once any tap had started it (the first tap, Send
// on Talk, a timer), ran for good playing silence; iPhone parks a running one when the app hides and starts it again
// when the app comes back on screen, taking the audio. And the first tap played a silent media element. Now the app
// lets go of its audio when it hides and a few seconds after a tap that played nothing, and no media element plays.
// The fake iPhone below restarts a context it parked (as iPhone does) and keeps one the app suspended itself stopped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modes = [];
const session = { _t: 'auto', get type() { return this._t; }, set type(v) { this._t = v; modes.push(v); } };
Object.defineProperty(globalThis, 'navigator', { value: { audioSession: session }, configurable: true, writable: true });
const elPlays = [];
globalThis.Audio = class { setAttribute() {} play() { elPlays.push(session.type); return Promise.resolve(); } };

// Every time one of the app's contexts starts running while his music plays, iPhone hands the app the audio.
let takes = 0;
const contexts = [];
const node = () => ({ connect: (x) => x || node(), start() {}, stop() {}, frequency: { value: 0 }, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
class FakeContext {
  constructor() { this._s = 'suspended'; this.destination = {}; this.t0 = Date.now(); contexts.push(this); }
  get state() { return this._s; }
  set _state(v) { if (v === 'running' && this._s !== 'running') takes++; this._s = v; }
  get currentTime() { return (Date.now() - this.t0) / 1000; }
  resume() { this._state = 'running'; return Promise.resolve(); }
  suspend() { this._state = 'suspended'; this.byApp = true; return Promise.resolve(); }
  close() { this._s = 'closed'; return Promise.resolve(); }
  createOscillator() { return node(); }
  createGain() { return node(); }
}
globalThis.window = { AudioContext: FakeContext };
const docListeners = {};
globalThis.document = { visibilityState: 'visible', addEventListener: (k, f) => { (docListeners[k] ||= []).push(f); } };
// iPhone: hiding parks a running context ('interrupted'); coming back starts a parked one again by itself.
const show = (state) => {
  document.visibilityState = state;
  for (const f of docListeners.visibilitychange || []) f();
  for (const c of contexts) {
    if (state === 'hidden' && c.state === 'running') c._state = 'interrupted';
    if (state === 'visible' && c.state === 'interrupted') c._state = 'running';
  }
};

const mic = await import('../app/js/lib/voice-mic.js');
const sounds = await import('../app/js/lib/sounds.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = () => contexts.at(-1);

test('a tap that only unlocks sound (first tap, Send on Talk) lets the audio go again', async () => {
  sounds.unlockAudio(); // Send on Talk
  assert.equal(ctx().state, 'running', 'the tap unlocks the audio (iPhone needs it inside a tap)');
  await wait(mic.IDLE_MS + 200);
  assert.equal(ctx().state, 'suspended', 'nothing played, but the app kept the audio');
  assert.deepEqual(elPlays, [], 'a media element played on the tap');
});

test('switching to Brave and back to the app, on every screen: the app starts no audio', async () => {
  sounds.play('beeps-3', 80, { alarm: true }); // a rest timer ending: the audio is the app's again
  assert.equal(ctx().state, 'running');
  for (let i = 0; i < 3; i++) {
    show('hidden'); // he goes to Brave
    assert.equal(ctx().state, 'suspended');
    const before = takes;
    show('visible'); // opens Training HQ again (Talk, Today, a session)
    await wait(50);
    assert.notEqual(ctx().state, 'running', 'coming back started the app audio by itself');
    assert.equal(takes, before, 'opening the app took the audio from his music');
  }
  assert.deepEqual(elPlays, []);
  assert.ok(!modes.includes('playback') && !modes.includes('play-and-record'), `modes: ${modes}`);
});

test('back in the app, a sound still plays without a tap, over his music', async () => {
  sounds.play('beeps-2', 80, { alarm: true });
  await wait(20);
  assert.equal(ctx().state, 'running', 'the rest-over sound must still play');
  assert.equal(session.type, 'ambient');
});

test('the audio is not let go mid-sound, mid-line or while a mic records; it is after', async () => {
  sounds.unlockAudio();
  sounds.play('bell', 80); // 1.6 s
  await wait(mic.IDLE_MS + 200);
  assert.equal(ctx().state, 'running', 'a sound right after the tap counts as use');
  mic.holdAudio('voice', true); // the coach speaking, longer than IDLE_MS
  sounds.unlockAudio();
  await wait(mic.IDLE_MS + 200);
  assert.equal(ctx().state, 'running', 'let go mid-sentence');
  mic.holdAudio('voice', false);
  await wait(mic.IDLE_MS + 200);
  assert.equal(ctx().state, 'suspended', 'kept after the voice ended');
  mic.holdAudio('mic', true); mic.audioContext(); // dictation recording
  sounds.unlockAudio();
  await wait(mic.IDLE_MS + 200);
  assert.equal(ctx().state, 'running', 'let go while the mic records');
  mic.holdAudio('mic', false);
  await wait(mic.IDLE_MS + 200);
  assert.equal(ctx().state, 'suspended', 'kept after the dictation ended');
});

test("the coach's voice holds the audio while it speaks (voice.js wiring) and holds its count-ins as unlocks", () => {
  const voice = readFileSync(new URL('../app/js/lib/voice.js', import.meta.url), 'utf8');
  assert.match(voice, /onState: \(speaking\) => \{\s*holdAudio\('voice', speaking\)/);
  assert.match(voice, /addEventListener\('pointerdown', \(\) => \{ unlockAudioContext\(\);/);
  const talk = readFileSync(new URL('../app/js/lib/talk.js', import.meta.url), 'utf8');
  assert.match(talk, /export const unlock = \(\) => \{ try \{ unlockAudioContext\(\);/);
  assert.match(talk, /audioBusy\(buf\.duration/);
});
