// Microphone + speech detection together (step 9): each stretch of speech becomes a clip for the Mac. Used by the
// calibration and test screens, and by always-on listening.
import { openMic } from './voice-mic.js';
import { createVad } from './vad.js';
import { encodeWav } from './wav.js';

/**
 * @param {object} o
 * @param {(wav: Uint8Array, info: {voicedMs: number, cut: boolean, samples: Float32Array}) => void} o.onClip
 * @param {(level: number, threshold: number) => void} [o.onLevel]   about 30 times a second
 * @param {(e: {type: string}) => void} [o.onEvent]   'start' when speech starts, 'noise' for a short sound
 * @param {() => void} [o.onEnded]  the microphone was taken away (another app, the screen locked)
 */
export async function micSession({ onClip, onLevel = () => {}, onEvent = () => {}, onEnded = () => {}, vad: vadOpts = {} }) {
  let paused = false;
  let tap = null; // dictation borrowing this microphone's sound (Tue 10/20)
  const vad = createVad(vadOpts, (e) => {
    if (paused) return;
    if (e.type === 'end') onClip(encodeWav(e.samples), e);
    else onEvent(e);
  });
  const mic = await openMic({ onFrame: (f) => { tap?.(f); const level = vad.push(f); onLevel(level, vad.threshold); }, onEnded });
  return {
    vad,
    /** Paused: speech is still followed (so the room level stays right) but no clips are handed out. */
    pause() { paused = true; vad.reset(); },
    resume() { vad.reset(); paused = false; },
    get paused() { return paused; },
    /** Hand every frame to fn as well (null stops): dictation takes the sound from the microphone already open. */
    tap(fn) { tap = fn || null; },
    close() { mic.close(); },
  };
}
