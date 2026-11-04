// Rest timer: local to this device (no server). Survives a reload; plays the chosen sound when it ends.
// The end time is stored, so the timer stays right even if the phone sleeps the page for a while.
import { unlockAudio, play } from './sounds.js';
import { getState } from './store.js';
import { withDefaults } from './settings.js';

export { unlockAudio };

const KEY = 'thq.rest';
const listeners = new Set();
const planners = new Set();
let tick = null;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

let state = load();

const sounds = () => withDefaults(getState().settings).sounds;

/** Plain beeps for the hold timer, at the timer volume. */
export const beep = (times = 3) => play(`beeps-${Math.min(9, Math.max(1, times))}`, sounds().timerVolume, { alarm: true });

/** The rest-end sound chosen in Settings (always: with or without the coach listening, also on silent). */
export const ring = () => play(sounds().restEnd, sounds().timerVolume, { alarm: true });

const emit = () => { for (const fn of listeners) fn(status()); };
/** When the rest ends, or null: on start, ±15 s and skip (the Mac sends "Rest over" then; Thu 10/22). */
// Thu 11/5: a paused rest has no end, so the Mac's "Rest over" is cancelled until it runs again.
const plan = () => { for (const fn of planners) { try { fn(state && state.pausedLeftMs == null ? { endsAt: state.endsAt, label: state.label, next: state.next || '' } : null); } catch { /* a listener */ } } };

function loop() {
  clearInterval(tick);
  if (!state || state.pausedLeftMs != null) return;
  tick = setInterval(() => {
    if (!state) { clearInterval(tick); return; }
    if (Date.now() >= state.endsAt) {
      if (!state.rang) { state.rang = true; store(state); ring(); }
      // Ended by itself: the Mac's "Rest over" still goes (no cancel), in case this sound wasn't heard.
      state = null; store(null); clearInterval(tick); emit();
      return;
    }
    emit();
  }, 250);
}

export function status() {
  if (!state) return null;
  const paused = state.pausedLeftMs != null;
  const left = paused ? state.pausedLeftMs : Math.max(0, state.endsAt - Date.now());
  return { ...state, paused, leftMs: left, fraction: state.totalMs ? 1 - left / state.totalMs : 1 };
}

/** A rest of `seconds` after `label` (the exercise just ticked); `next` is the set it leads to, in words (lib/session.js nextAfterText). */
export function start(seconds, label = '', next = '') {
  if (!seconds) { clear(); return; }
  state = { endsAt: Date.now() + seconds * 1000, totalMs: seconds * 1000, label, next, rang: false };
  store(state); loop(); emit(); plan();
}

export function adjust(deltaSeconds) {
  if (!state) return;
  if (state.pausedLeftMs != null) {
    state.pausedLeftMs = Math.max(1000, state.pausedLeftMs + deltaSeconds * 1000);
    state.totalMs = Math.max(1000, state.totalMs + deltaSeconds * 1000);
    store(state); emit(); return;
  }
  state.endsAt = Math.max(Date.now() + 1000, state.endsAt + deltaSeconds * 1000);
  state.totalMs = Math.max(1000, state.totalMs + deltaSeconds * 1000);
  store(state); emit(); plan();
}

/** Thu 11/5: the coach pauses the rest (it stands still) and resumes it. False when there is none, or nothing to do. */
export function pause() {
  if (!state || state.pausedLeftMs != null) return false;
  state.pausedLeftMs = Math.max(1000, state.endsAt - Date.now());
  store(state); clearInterval(tick); emit(); plan();
  return true;
}

export function resume() {
  if (!state || state.pausedLeftMs == null) return false;
  state.endsAt = Date.now() + state.pausedLeftMs;
  delete state.pausedLeftMs;
  store(state); loop(); emit(); plan();
  return true;
}

export function clear() { const had = Boolean(state); state = null; store(null); clearInterval(tick); emit(); if (had) plan(); }

export function onPlan(fn) { planners.add(fn); return () => planners.delete(fn); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

if (state) loop();
