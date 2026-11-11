// Sounds made with Web Audio (no sound files): rest-end choices, the set tick, the record sound.
// iOS only plays sound after a tap has unlocked audio, so every tap that may lead to a sound calls unlockAudio().
// Tue 10/20 at the gym, "when it gets to zero nothing, there is no ding": two reasons, both handled here.
// - iPhone stops the app's audio ('interrupted', or 'suspended') when the screen locks, another app plays or the
//   microphone changes; a sound scheduled on that stopped clock is never heard. Every sound now restarts it first.
// - With the coach's microphone off, iPhone's silent switch mutes web audio (with it on, the phone is in a mode that
//   ignores the switch). Timer sounds switched to playback, as the Clock app does; since Tue 11/10 they don't, because
//   playback pauses his music (overMusic below).
// Thu 10/22 at the gym, again: "My rest time just finished. And no sound... volume to the max, not on silent, no sleep
// mode". Web Audio can stay stopped after iPhone interrupts it (the coach's voice, the microphone, another app) and
// restarting it needs a tap. So timer sounds (alarm) now play as a short sound file through an audio element that a
// tap has unlocked (iPhone lets that element play again later without a tap); Web Audio stays for the rest and as
// the fallback. The Mac also sends a "Rest over" notification (rest-push), which iPhone sounds on its own.
// Wed 11/11, 4:10 PM: "Nope still pauses my brave music" (just opening the app). The sound-file way never once played
// on his phone (the Mac's log: 92 timer sounds, every one 'el:false', none by file), and its silent unlock play on the
// first tap is a media element, the one kind of sound iPhone treats as a music player. Gone: timer sounds are Web
// Audio only, and an unlock tap only unlocks: lib/voice-mic.js lets the audio go again if nothing plays.
import { audioContext as sharedContext, unlockAudioContext, audioBusy } from './voice-mic.js';
import { diag } from './diag.js';

let audio = null;
let mic = false;
// Thu 10/22: the beeps used an audio context of their own beside the coach's voice; iPhone can leave a second one
// silent. They now share the voice's (lib/voice-mic.js), which a tap unlocks for both.

function ready() {
  try {
    audio = sharedContext();
    if (audio.state !== 'running') audio.resume().catch(() => {});
  } catch { /* no audio */ }
  return audio;
}

/** A tap that may lead to a sound later: iPhone lets the app play then. Plays nothing now. */
export function unlockAudio() { try { overMusic(); audio = unlockAudioContext(); } catch { /* no audio */ } }

/** The coach's microphone is open (its audio mode already ignores the silent switch; the mix mode must not override it). */
export function micActive(on) { mic = !!on; if (!mic) overMusic(); }

// Microphones opening or open (listening, dictation, calibration). Tue 10/20, his screen recording: every tap gave the
// orange mic dot, then "No sound from the microphone": an audio mode switch landing in the seconds the microphone
// takes to start left it recording silence. While any is opening or open, nothing here touches the audio mode.
let mics = 0;
// Once the last one closes, back to mixing at once: the microphone's 'play-and-record' left on holds his music off.
export function micOpening(delta) { mics = Math.max(0, mics + delta); if (!mics && delta < 0) overMusic(); }

// The sauna's overdue alarm (lib/alarm.js) needs 'playback' (heard through the silent switch, a hard stop): while it is
// armed nothing here changes the mode.
let pinned = false;
export function holdPlayback(on) { pinned = !!on; if (!on) overMusic(); }

/**
 * The app's sounds and the coach's voice play over his music (Tue 11/10 at the gym, Push: "I dont like how the app
 * Stops my music with its sounds"). They used iPhone's 'playback' mode (to beat the silent switch, Tue 10/20), and
 * 'playback' pauses every other app's audio, as a music player does; 'ambient' plays on top and the music keeps going.
 * iPhone's silent switch mutes 'ambient', so with it on silent only the Mac's "Rest over" notification buzzes.
 * Set before every sound and kept (no switch back to 'auto': a sound file played in 'auto' takes the audio too).
 */
export const MIX_MODE = 'ambient';
export function overMusic() {
  const s = navigator.audioSession;
  if (!s || mic || mics || pinned) return;
  try { if (s.type !== MIX_MODE) s.type = MIX_MODE; } catch { /* not supported */ }
}

// [start s, frequency Hz, length s, wave, loudness 0-1]
const PATTERNS = {
  beeps: [[0, 880, 0.22], [0.28, 880, 0.22], [0.56, 1320, 0.22]],
  chime: [[0, 1047, 0.6, 'triangle'], [0.18, 1319, 0.6, 'triangle'], [0.36, 1568, 0.9, 'triangle']],
  bell: [[0, 587, 1.6, 'sine'], [0, 1480, 1.0, 'sine', 0.5], [0, 2349, 0.5, 'sine', 0.25]],
  pulse: [[0, 440, 0.12, 'square', 0.35], [0.2, 440, 0.12, 'square', 0.35], [0.4, 440, 0.12, 'square', 0.35], [0.6, 660, 0.2, 'square', 0.35]],
  rise: [[0, 523, 0.15], [0.15, 659, 0.15], [0.3, 784, 0.15], [0.45, 1047, 0.35]],
  tick: [[0, 1900, 0.06, 'triangle']],
  // A14: the hold's count-in and count-out, and the moment the hold starts.
  count: [[0, 988, 0.12, 'sine']],
  go: [[0, 1319, 0.45, 'sine']],
  record: [[0, 784, 0.14, 'triangle'], [0.14, 988, 0.14, 'triangle'], [0.28, 1175, 0.14, 'triangle'], [0.42, 1568, 0.5, 'triangle']],
};

/**
 * Play a sound at a volume of 0-100 ('beeps-2' = two plain beeps, the last one higher). Does nothing until audio has
 * been unlocked by a tap. `alarm`: a timer sound, played as a sound file (it plays after iPhone stopped Web Audio).
 */
export function play(id = 'beeps', volume = 80, { alarm = false } = {}) {
  if (!audio || !volume) return;
  const a = ready();
  const n = /^beeps-(\d)$/.exec(id);
  const notes = n ? Array.from({ length: +n[1] }, (_, i) => [i * 0.28, i === +n[1] - 1 ? 1320 : 880, 0.22]) : PATTERNS[id] || PATTERNS.beeps;
  overMusic();
  audioBusy((Math.max(...notes.map(([at, , len]) => at + len)) + 1) * 1000);
  if (alarm) diag({ what: 'sound', id, path: 'webaudio', ctx: a.state });
  if (a.state === 'running') { schedule(a, notes, volume); return; }
  // Stopped: play once it runs again (or anyway after a moment, if iPhone never says so).
  let done = false;
  const go = () => { if (!done) { done = true; schedule(a, notes, volume); } };
  a.resume().then(go).catch(go);
  setTimeout(go, 800);
}

const WAVES = {
  sine: (x) => Math.sin(2 * Math.PI * x),
  triangle: (x) => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * x)),
  square: (x) => (Math.sin(2 * Math.PI * x) >= 0 ? 1 : -1),
};

/** The notes as a 16-bit mono WAV file, with the same shape as schedule(): a quick rise, then a fade to nothing. */
export function wavOf(notes, volume = 80, rate = 22050) {
  // Louder than the Web Audio level: a timer sound has to cut through gym music, as the Clock app's does.
  const level = Math.min(1, Math.max(0, volume / 100)) * 0.9;
  const total = Math.max(...notes.map(([at, , len]) => at + len)) + 0.05;
  const n = Math.ceil(total * rate);
  const pcm = new Float32Array(n);
  for (const [at, freq, len, wave = 'sine', loud = 1] of notes) {
    const peak = Math.max(0.0002, level * loud); const fn = WAVES[wave] || WAVES.sine;
    const s0 = Math.floor(at * rate); const s1 = Math.min(n, Math.ceil((at + len) * rate));
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / rate;
      const env = t < 0.015 ? 0.0001 * (peak / 0.0001) ** (t / 0.015) : peak * (0.0001 / peak) ** ((t - 0.015) / Math.max(0.001, len - 0.015));
      pcm[i] += fn(freq * t) * env;
    }
  }
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  return buf;
}

function schedule(audio, notes, volume) {
  const level = Math.min(1, Math.max(0, volume / 100)) * 0.6;
  const t0 = audio.currentTime + 0.02;
  for (const [at, freq, len, wave = 'sine', loud = 1] of notes) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = wave;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * loud), t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(g).connect(audio.destination);
    o.start(t0 + at);
    o.stop(t0 + at + len + 0.02);
  }
}

// Tue 11/10, 1:41 PM: "Even if i open the app while music plays it pauses it!?" Before any sound: the 'playback' mode
// set for a sound was left on when the phone locked or he switched to his music (its switch back to 'auto' was a timer,
// which iPhone freezes with the app), and opening the app again (the audio waking, the rest-over sound) took the audio
// back from his music. Now the mode is the mixing one from the moment the app opens and every time it comes back.
overMusic();
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => overMusic());
