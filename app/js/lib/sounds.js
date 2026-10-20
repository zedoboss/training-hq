// Sounds made with Web Audio (no sound files): rest-end choices, the set tick, the record sound.
// iOS only plays sound after a tap has unlocked audio, so every tap that may lead to a sound calls unlockAudio().
// Tue 10/20 at the gym, "when it gets to zero nothing, there is no ding": two reasons, both handled here.
// - iPhone stops the app's audio ('interrupted', or 'suspended') when the screen locks, another app plays or the
//   microphone changes; a sound scheduled on that stopped clock is never heard. Every sound now restarts it first.
// - With the coach's microphone off, iPhone's silent switch mutes web audio (with it on, the phone is in a mode that
//   ignores the switch). Timer sounds (the rest end, the hold's beeps) switch to playback, as the Clock app does.
let audio = null;
let mic = false;

function ready() {
  try {
    if (!audio || audio.state === 'closed') audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state !== 'running') audio.resume().catch(() => {});
  } catch { /* no audio */ }
  return audio;
}

export function unlockAudio() { ready(); }

/** The coach's microphone is open (its audio mode already ignores the silent switch; playback must not override it). */
export function micActive(on) { mic = !!on; }

let restoreTimer = null;
// Microphones opening or open (listening, dictation, calibration). Tue 10/20, his screen recording: every tap gave the
// orange mic dot, then "No sound from the microphone": a playback switch (or its timer back to 'auto') could land in
// the seconds the microphone takes to start and leave it recording silence. While any is opening or open, nothing
// here touches the audio mode.
let mics = 0;
export function micOpening(delta) {
  mics = Math.max(0, mics + delta);
  if (mics) { clearTimeout(restoreTimer); restoreTimer = null; }
}
/** Heard even with the silent switch on for the next `seconds` (timer sounds, the coach's voice while the mic is off). */
export function loudFor(seconds) {
  const s = navigator.audioSession;
  if (!s || mic || mics) return;
  try {
    if (s.type !== 'playback') s.type = 'playback';
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => { try { if (!mic && !mics) s.type = 'auto'; } catch { /* gone */ } }, (seconds + 1.5) * 1000);
  } catch { /* not supported */ }
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
 * been unlocked by a tap. `alarm`: a timer sound, heard even with the silent switch on.
 */
export function play(id = 'beeps', volume = 80, { alarm = false } = {}) {
  if (!audio || !volume) return;
  const a = ready();
  const n = /^beeps-(\d)$/.exec(id);
  const notes = n ? Array.from({ length: +n[1] }, (_, i) => [i * 0.28, i === +n[1] - 1 ? 1320 : 880, 0.22]) : PATTERNS[id] || PATTERNS.beeps;
  if (alarm) loudFor(Math.max(...notes.map(([at, , len]) => at + len)));
  if (a.state === 'running') { schedule(a, notes, volume); return; }
  // Stopped: play once it runs again (or anyway after a moment, if iPhone never says so).
  let done = false;
  const go = () => { if (!done) { done = true; schedule(a, notes, volume); } };
  a.resume().then(go).catch(go);
  setTimeout(go, 800);
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
