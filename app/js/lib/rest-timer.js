// Rest timer: local to this device (no server). Survives a reload; plays a sound when it ends.
// The end time is stored, so the timer stays right even if the phone sleeps the page for a while.
const KEY = 'thq.rest';
let audio = null;
const listeners = new Set();
let tick = null;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

let state = load();

/** Call from a tap: iOS only allows sound after a user gesture. */
export function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no audio */ }
}

export function beep(times = 3) {
  if (!audio) return;
  const t0 = audio.currentTime + 0.02;
  for (let i = 0; i < times; i++) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = i === times - 1 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + i * 0.28 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(t0 + i * 0.28);
    o.stop(t0 + i * 0.28 + 0.24);
  }
}

const emit = () => { for (const fn of listeners) fn(status()); };

function loop() {
  clearInterval(tick);
  if (!state) return;
  tick = setInterval(() => {
    if (!state) { clearInterval(tick); return; }
    if (Date.now() >= state.endsAt) {
      if (!state.rang) { state.rang = true; store(state); beep(); }
      clear();
      return;
    }
    emit();
  }, 250);
}

export function status() {
  if (!state) return null;
  const left = Math.max(0, state.endsAt - Date.now());
  return { ...state, leftMs: left, fraction: state.totalMs ? 1 - left / state.totalMs : 1 };
}

export function start(seconds, label = '') {
  if (!seconds) { clear(); return; }
  state = { endsAt: Date.now() + seconds * 1000, totalMs: seconds * 1000, label, rang: false };
  store(state); loop(); emit();
}

export function adjust(deltaSeconds) {
  if (!state) return;
  state.endsAt = Math.max(Date.now() + 1000, state.endsAt + deltaSeconds * 1000);
  state.totalMs = Math.max(1000, state.totalMs + deltaSeconds * 1000);
  store(state); emit();
}

export function clear() { state = null; store(null); clearInterval(tick); emit(); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

if (state) loop();
