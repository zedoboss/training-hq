// The microphone (step 9): open it with the phone's echo cancellation, noise suppression and level control, and hand
// 16 kHz frames to a callback. One audio context is shared with the coach's voice, so echo cancellation knows what
// the speaker is playing. Works only while the app is open and on screen (iPhone rule).

import { micOpening } from './sounds.js';

let ctx = null;

// Wed 11/11, 4:10 PM: "Nope still pauses my brave music", after the mic fix: opening the app paused music playing in
// Brave with no microphone open. This audio context, once a tap had started it (the first tap, Send on Talk, a timer),
// stayed running for good, playing silence; iPhone parks a running one when the app hides and starts it again as the
// app comes back on screen, taking the audio as it does. Now the app lets go of it (suspends it) when it goes off
// screen, and a few seconds after a tap that only unlocked sound, a dictation or the coach's voice, if nothing else
// plays: coming back to the app starts no audio. A sound, the voice or the mic wakes it only when it actually plays
// (audioContext() below), and iPhone allows that without a new tap once one tap has started it.
export const IDLE_MS = 3000;
let uses = 0; let busyUntil = 0; let idleTimer = null;
const holds = new Map();

function make() {
  if (!ctx || ctx.state === 'closed') ctx = new (window.AudioContext || window.webkitAudioContext)();
  // 'interrupted' is iPhone's state after something else took the audio (Tue 10/20: iPhone Mirroring).
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  return ctx;
}

/** The app's audio context, for something about to play or record now (made on a tap, so iPhone lets it play). */
export function audioContext() { uses++; return make(); }

/** A tap that may lead to sound later: starts the context inside the tap (iPhone rule), then lets go if unused. */
export function unlockAudioContext() { const c = make(); idleSoon(); return c; }

/** Something is playing for `ms` from now (a sound, a coach line): no letting go before it ends. */
export function audioBusy(ms) { uses++; busyUntil = Math.max(busyUntil, Date.now() + Math.max(0, ms)); }

/** A microphone ('mic') or the coach's voice ('voice') uses the context until it says it's done. */
export function holdAudio(key, on) {
  const n = Math.max(0, (holds.get(key) || 0) + (on ? 1 : -1));
  if (n) holds.set(key, n); else holds.delete(key);
  if (on) uses++; else if (!holds.size) idleSoon();
}

/** Let go of the audio now: iPhone keeps a suspended context stopped when the app comes back (it was ours to stop). */
export function letGoOfAudio() {
  clearTimeout(idleTimer); idleTimer = null;
  if (ctx && (ctx.state === 'running' || ctx.state === 'interrupted')) { try { ctx.suspend().catch(() => {}); } catch { /* gone */ } }
}

/** In IDLE_MS: let go if nothing used the audio since and nothing is playing or recording. */
export function idleSoon() {
  const from = uses;
  clearTimeout(idleTimer);
  const check = () => {
    idleTimer = null;
    if (uses > from || holds.size) return; // used meanwhile, or held: its end asks again
    if (Date.now() < busyUntil) { idleTimer = setTimeout(check, busyUntil - Date.now() + 50); return; }
    letGoOfAudio();
  };
  idleTimer = setTimeout(check, IDLE_MS);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  // Off screen iPhone stops the microphone and the app's sound anyway (voice.js closes the mic and the voice here too).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') letGoOfAudio(); });
}

/** Whether the shared audio context is running (false when there is none yet). */
export const audioRunning = () => !!ctx && ctx.state === 'running';

/** Drop the shared audio context, so the next audioContext() makes a fresh one (best from a tap). */
export function resetAudio() {
  const old = ctx; ctx = null;
  try { old?.close(); } catch { /* already closed */ }
}

// Tue 10/20: after iPhone Mirroring had the microphone, the app said "Listening" but heard nothing: its audio
// context stayed stopped and no sound came through. A mic that gives no frames this soon is not trusted.
const FIRST_FRAME_MS = 2500;

/**
 * @param {{onFrame: (f: Float32Array) => void, onEnded?: () => void}} o
 * @returns {Promise<{close: () => void, stream: MediaStream}>}
 */
export async function openMic({ onFrame, onEnded = () => {} }) {
  try {
    return await openMicOnce({ onFrame, onEnded });
  } catch (e) {
    if (e?.code !== 'silent') throw e;
    // No sound at all: a fresh audio context and a fresh microphone, once.
    resetAudio();
    try { return await openMicOnce({ onFrame, onEnded }); } catch (e2) {
      if (e2?.code === 'silent') throw new Error('No sound from the microphone. Tap the mic to start it again.');
      throw e2;
    }
  }
}

async function openMicOnce({ onFrame, onEnded }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('No microphone access in this browser.');
  micOpening(1); holdAudio('mic', true);
  let released = false;
  const release = () => { if (!released) { released = true; micOpening(-1); holdAudio('mic', false); } };
  try { return await openMicHeld({ onFrame, onEnded, release }); } catch (e) { release(); throw e; }
}

async function openMicHeld({ onFrame, onEnded, release }) {
  // iPhone: record and play at the same time, through the speaker (Safari's audio session, where it exists).
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* older Safari */ }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    throw new Error(e?.name === 'NotAllowedError' ? 'Microphone not allowed. Allow it for Training HQ, then try again.' : `Microphone: ${e?.message || e}`);
  }
  const ac = audioContext();
  await ac.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url).href);
  const src = ac.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ac, 'thq-mic');
  // The tap must reach the output to run; at zero volume nothing is heard.
  const mute = ac.createGain();
  mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ac.destination);
  let gotFrame = false;
  node.port.onmessage = (e) => { gotFrame = true; onFrame(e.data); };
  const track = stream.getAudioTracks()[0];
  const ended = () => { release(); onEnded(); };
  track?.addEventListener('ended', ended);
  let closed = false;
  const mic = {
    stream,
    close() {
      if (closed) return;
      closed = true;
      release();
      track?.removeEventListener('ended', ended);
      node.port.onmessage = null;
      try { src.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already gone */ }
      for (const t of stream.getTracks()) t.stop();
    },
  };
  if (ac.state !== 'running') await ac.resume().catch(() => {});
  const t0 = Date.now();
  while (!gotFrame && Date.now() - t0 < FIRST_FRAME_MS) await new Promise((r) => setTimeout(r, 100));
  if (!gotFrame) {
    mic.close();
    const e = new Error('silent'); e.code = 'silent';
    throw e;
  }
  return mic;
}
