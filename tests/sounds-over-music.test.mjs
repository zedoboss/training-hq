// Tue 11/10 at the gym, Push: "I dont like how the app Stops my music with its sounds". The app's sounds (rest end,
// ticks, hold counts) and the coach's voice switched iPhone's audio to 'playback', which pauses every other app's audio.
// They now play in 'ambient', over his music; only the sauna's overdue alarm keeps 'playback' (a hard stop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A fake iPhone: the audio session remembers every mode it was set to; an audio element would note the mode it played in.
const modes = [];
const session = { _t: 'auto', get type() { return this._t; }, set type(v) { this._t = v; modes.push(v); } };
Object.defineProperty(globalThis, 'navigator', { value: { audioSession: session }, configurable: true, writable: true });
const elPlays = [];
globalThis.Audio = class { constructor() { this.src = ''; this.currentTime = 0; } setAttribute() {} play() { elPlays.push(session.type); return Promise.resolve(); } };
const node = () => ({ connect: (x) => x || node(), start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
class FakeContext {
  constructor() { this.state = 'running'; this.destination = {}; this.t0 = Date.now(); }
  get currentTime() { return (Date.now() - this.t0) / 1000; }
  resume() { return Promise.resolve(); }
  createOscillator() { return node(); }
  createGain() { return node(); }
  createBuffer(ch, len, rate) { return { duration: len / rate, copyToChannel() {} }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {}, onended: null }; }
}
globalThis.window = { AudioContext: FakeContext };
const docListeners = {};
globalThis.document = { visibilityState: 'visible', addEventListener: (k, f) => { (docListeners[k] ||= []).push(f); } };
const showApp = (state) => { document.visibilityState = state; for (const f of docListeners.visibilitychange || []) f(); };

const sounds = await import('../app/js/lib/sounds.js');
const alarm = await import('../app/js/lib/alarm.js');
const { createPlayer } = await import('../app/js/lib/voice-player.js');
const tick = () => new Promise((r) => setTimeout(r, 20));

test('from the moment the app opens, the audio mode mixes with his music (1:41 PM: opening it paused the music)', () => {
  assert.equal(session.type, 'ambient');
  assert.deepEqual(modes, ['ambient']);
});

test("a 'playback' left behind when he switched to his music is gone when the app comes back", () => {
  session.type = 'playback'; // what an old sound, cut off by the lock screen, left behind
  showApp('hidden');
  assert.equal(session.type, 'ambient');
  session.type = 'playback';
  showApp('visible');
  assert.equal(session.type, 'ambient');
  modes.length = 0;
});

test('the unlock tap and every timer sound play over his music, never in playback', async () => {
  sounds.unlockAudio();
  await tick();
  // Wed 11/11: no media element at all (a silent play on the first tap; iPhone treats an element as a music player).
  assert.deepEqual(elPlays, [], 'the unlock tap played a media element');
  for (const id of ['beeps', 'count', 'go', 'chime']) sounds.play(id, 80, { alarm: true });
  sounds.play('tick', 80);
  sounds.play('record', 80);
  await tick();
  assert.deepEqual(elPlays, [], 'timer sounds are Web Audio only');
  assert.equal(session.type, 'ambient');
  assert.ok(!modes.includes('playback'), `modes set: ${modes}`);
});

test('a sound after the mode went back to auto (squat screen closed) mixes again', async () => {
  session.type = 'auto';
  sounds.play('beeps', 80, { alarm: true });
  assert.equal(session.type, 'ambient');
});

test("the coach's voice plays over his music", async () => {
  session.type = 'auto';
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4800)); c.close(); } });
  const ctx = new FakeContext();
  const player = createPlayer({ context: () => ctx, fetchSpeech: async () => new Response(body, { status: 200 }), stallMs: 50, firstByteMs: 50 });
  player.say('Hold it. Ten seconds.');
  for (let i = 0; i < 50 && session.type !== 'ambient'; i++) await tick();
  assert.equal(session.type, 'ambient');
  player.stop();
  assert.ok(!modes.includes('playback'));
});

test('an open microphone keeps its own mode (a switch while it opens leaves it deaf, Tue 10/20)', () => {
  session.type = 'play-and-record';
  sounds.micOpening(1);
  sounds.play('tick', 80);
  sounds.play('beeps', 80, { alarm: true });
  assert.equal(session.type, 'play-and-record');
  sounds.micActive(true);
  sounds.play('tick', 80);
  assert.equal(session.type, 'play-and-record');
  sounds.micOpening(-1);
  sounds.micActive(false);
  sounds.play('tick', 80);
  assert.equal(session.type, 'ambient');
});

test("the microphone closing (dictation done, listening off) gives the audio back to his music at once, no sound needed", () => {
  session.type = 'play-and-record';
  sounds.micOpening(1);
  assert.equal(session.type, 'play-and-record');
  sounds.micOpening(-1);
  assert.equal(session.type, 'ambient');
  session.type = 'play-and-record';
  sounds.micActive(true);
  sounds.micActive(false);
  assert.equal(session.type, 'ambient');
});

test("the sauna's overdue alarm keeps playback while armed (heard through the silent switch), then mixing again", () => {
  alarm.arm();
  assert.equal(session.type, 'playback');
  sounds.play('beeps', 80, { alarm: true });
  sounds.overMusic();
  assert.equal(session.type, 'playback', 'a coach line or beep mid-round does not take the alarm off playback');
  assert.ok(alarm.start());
  alarm.stop();
  assert.equal(session.type, 'ambient');
});

test("nothing in the app but the sauna alarm sets 'playback'", () => {
  const root = new URL('../app/js/', import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(root);
  const hits = files.filter((p) => /type\s*=\s*['"]playback['"]/.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length));
  assert.deepEqual(hits, ['lib/alarm.js']);
});
