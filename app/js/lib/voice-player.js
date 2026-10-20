// The coach's voice on the phone (9.6): sentences go to the Mac one by one (the next is fetched while the current one
// plays), and the audio is played as it streams in. stop() cuts it off at once (barge-in, a tap, leaving the screen).
import { pcm16ToFloat } from './wav.js';

const RATE = 24000;
/** A sentence whose audio stops coming (the phone changed network, the Mac or ElevenLabs stalled) is dropped after
 * this long without a byte, so the player never waits forever (Tue 10/20: the chip stuck on SPEAKING). The first
 * byte may take longer: the Mac waits up to 20 s for ElevenLabs, then its own voice answers. */
export const STALL_MS = 8000;
export const FIRST_BYTE_MS = 25000;

/**
 * @param {object} o
 * @param {() => AudioContext} o.context
 * @param {(text: string, signal: AbortSignal) => Promise<Response>} o.fetchSpeech  POST /api/voice/speak
 * @param {(speaking: boolean) => void} [o.onState]
 */
export function createPlayer({ context, fetchSpeech, onState = () => {}, stallMs = STALL_MS, firstByteMs = FIRST_BYTE_MS }) {
  let items = []; // {text, ctrl, chunks: Uint8Array[], done, wake}
  let playing = false; let gen = 0; let sources = new Set(); let endAt = 0; let level = 0; let engine = null;

  function fetchItem(item) {
    fetchSpeech(item.text, item.ctrl.signal).then(async (res) => {
      if (!res.ok) throw new Error(`speech ${res.status}`);
      engine = res.headers.get('x-voice') || engine;
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        item.chunks.push(value); item.wake?.();
      }
    }).catch(() => {}).finally(() => { item.done = true; item.wake?.(); });
  }

  // Keep at most two sentences fetching ahead (the Mac and ElevenLabs allow few at once).
  const feed = () => { items.filter((x) => !x.started).slice(0, 2).forEach((x) => { x.started = true; fetchItem(x); }); };

  async function run() {
    if (playing) return;
    playing = true;
    const my = gen;
    onState(true);
    try { while (my === gen && items.length) await play(my); } catch { /* a broken audio context: drop what was queued rather than stay "speaking" */ }
    // Whatever happened, a run that is still the current one always ends: SPEAKING never outlives the sound.
    if (my === gen) {
      for (const it of items) it.ctrl.abort();
      items = []; playing = false; level = 0; onState(false);
    }
  }

  async function play(my) {
    const ctx = context();
    let carry = null; // a trailing odd byte between chunks
    while (items.length && my === gen) {
      const item = items[0];
      feed();
      let i = 0;
      for (;;) {
        if (my !== gen) break;
        if (i < item.chunks.length) {
          let bytes = item.chunks[i++];
          if (carry) { const b = new Uint8Array(carry.length + bytes.length); b.set(carry); b.set(bytes, carry.length); bytes = b; carry = null; }
          if (bytes.length % 2) { carry = bytes.slice(-1); bytes = bytes.subarray(0, bytes.length - 1); }
          const samples = pcm16ToFloat(bytes);
          if (!samples.length) continue;
          let peak = 0;
          for (let k = 0; k < samples.length; k += 8) peak = Math.max(peak, Math.abs(samples[k]));
          level = peak;
          const buf = ctx.createBuffer(1, samples.length, RATE);
          buf.copyToChannel(samples, 0);
          const src = ctx.createBufferSource();
          src.buffer = buf; src.connect(ctx.destination);
          const at = Math.max(endAt, ctx.currentTime + 0.04);
          src.start(at);
          endAt = at + buf.duration;
          sources.add(src);
          src.onended = () => sources.delete(src);
          continue;
        }
        if (item.done) break;
        // Wait for more audio, but not forever: a stalled sentence is given up and the next one plays.
        const got = await new Promise((r) => { item.wake = () => r(true); setTimeout(() => r(false), item.chunks.length ? stallMs : firstByteMs); });
        item.wake = null;
        if (!got && !item.done && i >= item.chunks.length) { item.ctrl.abort(); break; }
      }
      carry = null;
      if (my !== gen) break;
      items.shift();
    }
    // Wait for the last sound to finish before saying it's done, on the clock it was scheduled on (Tue 10/20: when
    // the microphone made a fresh audio context mid-sentence, the new clock started at 0 and the chip stayed on
    // SPEAKING for minutes). A closed context (resetAudio closes the old one) ends the wait at once.
    // A stopped clock (iPhone paused the audio) doesn't move: give up after 3 s of it.
    // And never longer than the sound left plus a little: a clock that runs slow can't hold it either.
    let stoppedSince = 0;
    const latest = Date.now() + Math.max(0, endAt - ctx.currentTime) * 1000 + 1500;
    // A sentence queued meanwhile goes straight on (it is scheduled after this one).
    while (my === gen && !items.length && ctx.state !== 'closed' && ctx.currentTime < endAt && Date.now() < latest) {
      if (ctx.state !== 'running') { stoppedSince ||= Date.now(); if (Date.now() - stoppedSince > 3000) break; } else stoppedSince = 0;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  return {
    /** Queue a sentence to speak. */
    say(text) {
      const t = String(text || '').trim();
      if (!t) return;
      items.push({ text: t, ctrl: new AbortController(), chunks: [], done: false, started: false, wake: null });
      feed();
      run();
    },
    /** Stop speaking now and forget what was queued. */
    stop() {
      gen++;
      for (const it of items) { it.ctrl.abort(); it.wake?.(); }
      items = [];
      for (const s of sources) { try { s.stop(); } catch { /* ended */ } }
      sources = new Set();
      endAt = 0; level = 0;
      if (playing) { playing = false; onState(false); }
    },
    get speaking() { return playing; },
    /** How loud the coach is right now (0..1), so the microphone can tell its echo from him. */
    get level() { return playing ? level : 0; },
    get engine() { return engine; },
  };
}
