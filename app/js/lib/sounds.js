// Sounds made with Web Audio (no sound files): rest-end choices, the set tick, the record sound.
// iOS only plays sound after a tap has unlocked audio, so every tap that may lead to a sound calls unlockAudio().
let audio = null;

export function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no audio */ }
}

// [start s, frequency Hz, length s, wave, loudness 0-1]
const PATTERNS = {
  beeps: [[0, 880, 0.22], [0.28, 880, 0.22], [0.56, 1320, 0.22]],
  chime: [[0, 1047, 0.6, 'triangle'], [0.18, 1319, 0.6, 'triangle'], [0.36, 1568, 0.9, 'triangle']],
  bell: [[0, 587, 1.6, 'sine'], [0, 1480, 1.0, 'sine', 0.5], [0, 2349, 0.5, 'sine', 0.25]],
  pulse: [[0, 440, 0.12, 'square', 0.35], [0.2, 440, 0.12, 'square', 0.35], [0.4, 440, 0.12, 'square', 0.35], [0.6, 660, 0.2, 'square', 0.35]],
  rise: [[0, 523, 0.15], [0.15, 659, 0.15], [0.3, 784, 0.15], [0.45, 1047, 0.35]],
  tick: [[0, 1900, 0.06, 'triangle']],
  record: [[0, 784, 0.14, 'triangle'], [0.14, 988, 0.14, 'triangle'], [0.28, 1175, 0.14, 'triangle'], [0.42, 1568, 0.5, 'triangle']],
};

/** Play a sound at a volume of 0-100 ('beeps-2' = two plain beeps, the last one higher). Does nothing until audio has been unlocked by a tap. */
export function play(id = 'beeps', volume = 80) {
  if (!audio || !volume) return;
  const level = Math.min(1, Math.max(0, volume / 100)) * 0.6;
  const t0 = audio.currentTime + 0.02;
  const n = /^beeps-(\d)$/.exec(id);
  const notes = n ? Array.from({ length: +n[1] }, (_, i) => [i * 0.28, i === +n[1] - 1 ? 1320 : 880, 0.22]) : PATTERNS[id] || PATTERNS.beeps;
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
