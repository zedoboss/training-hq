// Dictation into the chat box (Tue 10/20, his words: "a microphone... where I can click that and talk to the AI.
// Once I'm done, it should paste the prompt in the chat"). Tap: the microphone records; tap again: the clip goes to
// the Mac's Whisper and the words come back for the box. Nothing is sent to the coach until he taps Send. While it
// records, the always-on listening is held, so the same words aren't also answered.
import { openMic } from './voice-mic.js';
import { encodeWav } from './wav.js';
import { macSendRaw } from './data.js';
import { lendMic } from './voice.js';

// Paragraphs by voice (Tue 10/20): up to 5 minutes; the Mac reads it in one go.
const MAX_SEC = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {{stop: () => Promise<string>, cancel: () => void}} */
export async function startDictation() {
  const chunks = []; let n = 0; let done = false;
  const onFrame = (f) => { if (!done && n < MAX_SEC * 16000) { chunks.push(Float32Array.from(f)); n += f.length; } };
  // The coach's microphone if it is open (the coach hears nothing meanwhile); else one of its own, tried twice.
  const lease = await lendMic(onFrame);
  let own = null;
  if (lease.own) {
    try { own = await openMic({ onFrame }); } catch {
      await sleep(400);
      try { own = await openMic({ onFrame }); } catch (e) { lease.release(); throw e; }
    }
  }
  const close = () => { if (done) return; done = true; try { own?.close(); } catch { /* gone */ } lease.release(); };
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
