// Rest timer: local to this device (no server). Survives a reload; plays the chosen sound when it ends.
// The end time is stored, so the timer stays right even if the phone sleeps the page for a while.
import { unlockAudio, play } from './sounds.js';
import { getState } from './store.js';
import { withDefaults } from './settings.js';

export { unlockAudio };

const KEY = 'thq.rest';
const listeners = new Set();
let tick = null;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

let state = load();

const sounds = () => withDefaults(getState().settings).sounds;

/** Plain beeps for the hold timer, at the timer volume. */
export const beep = (times = 3) => play(`beeps-${Math.min(9, Math.max(1, times))}`, sounds().timerVolume);

/** The rest-end sound chosen in Settings. */
export const ring = () => play(sounds().restEnd, sounds().timerVolume);

const emit = () => { for (const fn of listeners) fn(status()); };

function loop() {
  clearInterval(tick);
  if (!state) return;
  tick = setInterval(() => {
    if (!state) { clearInterval(tick); return; }
    if (Date.now() >= state.endsAt) {
      if (!state.rang) { state.rang = true; store(state); ring(); }
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
