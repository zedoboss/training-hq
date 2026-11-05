// Dictation into the chat box (Tue 10/20, his words: "a microphone... where I can click that and talk to the AI.
// Once I'm done, it should paste the prompt in the chat"). Tap: the microphone records; tap again: the clip goes to
// the Mac's Whisper and the words come back for the box. Nothing is sent to the coach until he taps Send. While it
// records, the always-on listening is held, so the same words aren't also answered.
import { openMic } from './voice-mic.js';
import { encodeWav } from './wav.js';
import { macSendRaw } from './data.js';
import { lendMic } from './voice.js';
import { getState, subscribe } from './store.js';
import { formatTime } from './time.js';
import { flushKept, cacheStore, isUnreachable, joinDraft, KEPT_MESSAGE } from './dictate-keep.js';

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
      const wav = encodeWav(all);
      try {
        return await sendClip(wav);
      } catch (e) {
        // Thu 11/5: the Mac out of reach (this phone's Tailscale dropped) no longer loses what he said: kept, and sent
        // by itself once the Mac answers again (watchKept below).
        if (!isUnreachable(e)) throw e;
        await store().keep(Date.now(), wav);
        waiting = true;
        const err = new Error(KEPT_MESSAGE); err.kept = true;
        throw err;
      }
    },
  };
}

const sendClip = async (wav) => String((await macSendRaw('/api/voice/dictate', wav, 'audio/wav', 180000)).text || '').trim();
let kept = null; let waiting = false;
const store = () => (kept ||= cacheStore());

// The chat box's draft (views/coach.js keeps the box in it as he types).
const DRAFT = 'thq.coach.draft';

/**
 * From app start: whenever the Mac answers (each sync, about every 30 s, and when the app comes on screen) the kept
 * clips go to it, once each; their words land in the chat box's draft, the coach screen shows them at once
 * (event 'thq:dictation'), and a toast says so. Nothing is sent to the coach until he taps Send.
 */
export function watchKept({ toast } = {}) {
  if (!globalThis.caches) return;
  let busy = false; let lastTry = 0;
  const tryNow = async () => {
    if (busy || getState().mac?.reachable !== true) return;
    busy = true; lastTry = Date.now();
    try {
      if (!(await store().count())) { waiting = false; return; }
      const words = [];
      const r = await flushKept({
        ...store(),
        send: sendClip,
        onText: (text, at) => {
          if (!text) return;
          try { localStorage.setItem(DRAFT, joinDraft(localStorage.getItem(DRAFT), text)); } catch { /* private mode */ }
          words.push(formatTime(new Date(at)));
          window.dispatchEvent(new CustomEvent('thq:dictation', { detail: { text, at } }));
        },
        onFail: (e, at) => toast?.(`The Mac couldn't read your ${formatTime(new Date(at))} recording: ${e.message}`, { ms: 6000 }),
      });
      waiting = r.waiting;
      if (words.length) toast?.(`Back on the Mac. Your words from ${words.join(', ')} are in the chat box: tap Send.`, { ms: 8000 });
    } catch { /* storage gone: next time */ } finally { busy = false; }
  };
  let was = getState().mac?.reachable;
  subscribe((s) => {
    const now = s.mac?.reachable;
    // The Mac answered again, or a clip is waiting (at most one try in 20 s while it keeps answering).
    if (now === true && (was !== true || (waiting && Date.now() - lastTry > 20000))) tryNow();
    was = now;
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tryNow(); });
  tryNow();
}
