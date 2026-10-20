// Dictation into the chat box (Tue 10/20, his words: "a microphone... where I can click that and talk to the AI.
// Once I'm done, it should paste the prompt in the chat"). Tap: the microphone records; tap again: the clip goes to
// the Mac's Whisper and the words come back for the box. Nothing is sent to the coach until he taps Send. While it
// records, the always-on listening is held, so the same words aren't also answered.
import { openMic } from './voice-mic.js';
import { encodeWav } from './wav.js';
import { macSendRaw } from './data.js';
import { hold } from './voice.js';

// Paragraphs by voice (Tue 10/20): up to 5 minutes; the Mac reads it in pieces.
const MAX_SEC = 300;

/** @returns {{stop: () => Promise<string>, cancel: () => void}} */
export async function startDictation() {
  const chunks = []; let n = 0; let done = false;
  hold(true);
  let mic;
  try {
    mic = await openMic({ onFrame: (f) => { if (n < MAX_SEC * 16000) { chunks.push(Float32Array.from(f)); n += f.length; } } });
  } catch (e) { hold(false); throw e; }
  const close = () => { if (done) return; done = true; try { mic.close(); } catch { /* gone */ } hold(false); };
  return {
    cancel: close,
    async stop() {
      close();
      const all = new Float32Array(n); let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      if (n < 16000 * 0.4) return '';
      const r = await macSendRaw('/api/voice/dictate', encodeWav(all), 'audio/wav', 180000);
      return String(r.text || '').trim();
    },
  };
}
