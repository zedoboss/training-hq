// Plays a talk script (lib/coach-talk.js) on time (A14, A15). The clips are fetched from the Mac BEFORE the hold or
// set starts (ElevenLabs takes a moment) and kept in Cache Storage, so a line heard once also plays with no
// connection. Each cue fires on its second: the voice if its clip is ready and talking is on, else the cue's sound
// (so the count-in and the end of a hold are always marked). Only his real words stop it (lib/voice.js calls stop()
// when the Mac hears him); pain or stop hands over to Calm for a while.
import { voiceSpeech } from './data.js';
import { audioContext } from './voice-mic.js';
import { pcm16ToFloat } from './wav.js';
import { play, loudFor } from './sounds.js';
import { getState } from './store.js';
import { withDefaults } from './settings.js';
import { scriptTexts } from './coach-talk.js';

const CACHE = 'voice-lines-v1';
const RATE = 24000;
const CALM_MS = 15 * 60000;
const prefs = () => withDefaults(getState().settings);

const bufs = new Map(); // text -> AudioBuffer (ready)
const pending = new Map(); // text -> Promise
let current = null; let muted = false; let calmUntil = 0; let level = 0;
const recent = new Set();
const subs = new Set();
const fired = []; // the last cues played and how (voice, sound, none): for checks and the debug line
const emit = () => { for (const f of subs) { try { f(); } catch { /* gone */ } } };

/** Talking during sets and holds is on (Settings > Coach), the coach's voice is on, and he hasn't muted it. */
export const talkOn = () => { const p = prefs(); return p.coach.talk.during !== false && p.voice.speak !== false && !muted; };
export const isMuted = () => muted;
export function setMuted(v) { muted = Boolean(v); if (muted) stopVoice(); emit(); }
export const isCalm = () => Date.now() < calmUntil;
/** He said pain, stop or something off: Calm only, for a while. */
export function setCalm(ms = CALM_MS) { calmUntil = Date.now() + ms; emit(); }
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
/** Lines said lately (scripts avoid repeating them). */
export const recentLines = () => recent;
export const playing = () => Boolean(current?.sources.size);
/** A script is under way (its lines may still be ahead). */
export const running = () => Boolean(current && !current.stopped);
/** How loud the script is right now (the microphone uses it to tell its echo from him). */
export const talkLevel = () => (current?.sources.size ? level : 0);
/** The talk settings the scripts need. */
export function talkPrefs() {
  const c = prefs().coach;
  return { moods: c.moods || {}, intensity: c.intensity ?? 3, every: c.talk?.every || 'steady', calm: isCalm() };
}

const keyOf = (text) => new Request(`${location.origin}/__voice-line/${encodeURIComponent(text)}`);

function toBuffer(bytes) {
  const samples = pcm16ToFloat(bytes);
  if (samples.length < RATE * 0.15) return null;
  const ctx = audioContext();
  const buf = ctx.createBuffer(1, samples.length, RATE);
  buf.copyToChannel(samples, 0);
  return buf;
}

async function fetchLine(text) {
  let bytes = null;
  try { const hit = await (await caches.open(CACHE)).match(keyOf(text)); if (hit) bytes = new Uint8Array(await hit.arrayBuffer()); } catch { /* no cache */ }
  if (!bytes) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await voiceSpeech(text, ctrl.signal);
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
      // Only his ElevenLabs voice is kept; the Mac's own voice (the fallback) is fetched again next time.
      if (res.headers.get('x-voice') === 'elevenlabs' && bytes.length > 4000) {
        try { await (await caches.open(CACHE)).put(keyOf(text), new Response(bytes, { headers: { 'content-type': 'audio/L16' } })); } catch { /* full */ }
      }
    } finally { clearTimeout(t); }
  }
  const b = toBuffer(bytes);
  if (b) bufs.set(text, b);
  return b;
}

/** Fetch the clips of a script now (before it starts). Resolves when they are ready or have failed. */
export function prepare(script) {
  if (!talkOn()) return Promise.resolve();
  return Promise.all(scriptTexts(script).map((text) => {
    if (bufs.has(text)) return bufs.get(text);
    if (!pending.has(text)) pending.set(text, fetchLine(text).catch(() => null).finally(() => pending.delete(text)));
    return pending.get(text);
  }));
}

function stopVoice() {
  if (!current) return;
  for (const s of current.sources) { try { s.stop(); } catch { /* ended */ } }
  current.sources.clear();
}

function playBuffer(run, buf) {
  // Tue 10/20: with the microphone off, the silent switch muted the coach during his sets.
  loudFor(buf.duration);
  const ctx = audioContext();
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination);
  src.start(ctx.currentTime + 0.02);
  run.sources.add(src);
  // A rough loudness for the echo check.
  const d = buf.getChannelData(0); let peak = 0;
  for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
  level = peak;
  src.onended = () => { run.sources.delete(src); if (!run.sources.size) { level = 0; emit(); } };
  emit();
}

/**
 * Play a script from `t0` (ms; default now). Returns {stop()}. A later run replaces an earlier one.
 * Count and end cues cut off a line still playing; a push is skipped when something is still being said.
 */
export function run(script, { t0 = Date.now(), onCue = null } = {}) {
  stop();
  const r = { timers: [], sources: new Set(), stopped: false };
  current = r;
  const vol = () => prefs().sounds.timerVolume;
  for (const cue of script?.cues || []) {
    const wait = t0 + cue.at * 1000 - Date.now();
    if (wait < -800) continue;
    r.timers.push(setTimeout(() => {
      if (r.stopped) return;
      const buf = cue.text ? bufs.get(cue.text) : null;
      const voice = buf && talkOn();
      if (voice) {
        if (r.sources.size) {
          if (cue.kind === 'push' || cue.kind === 'mid') return;
          for (const s of r.sources) { try { s.stop(); } catch { /* ended */ } }
          r.sources.clear();
        }
        playBuffer(r, buf);
        recent.add(cue.text);
        if (recent.size > 40) recent.delete(recent.values().next().value);
      } else if (cue.sound) play(cue.sound, vol(), { alarm: true });
      // What the coach says shows on screen too (the caption), voice or not: counts excepted.
      if (cue.text && cue.kind !== 'count' && talkOn()) window.dispatchEvent(new CustomEvent('thq:coach-say', { detail: { text: cue.text } }));
      const how = voice ? 'voice' : cue.sound ? 'sound' : 'none';
      fired.push({ kind: cue.kind, how, text: cue.text || '', at: Date.now(), perf: performance.now(), durMs: voice ? Math.round(buf.duration * 1000) : 0 });
      if (fired.length > 60) fired.shift();
      onCue?.(cue, how);
    }, Math.max(0, wait)));
  }
  return { stop: () => { if (current === r) stop(); else { r.stopped = true; r.timers.forEach(clearTimeout); } } };
}

/** Stop the script playing now (his words, the end of a set, leaving the screen). */
export function stop() {
  if (!current) return;
  if (current.sources.size) fired.push({ kind: 'cut', how: 'stop', text: '', at: Date.now(), perf: performance.now(), durMs: 0 });
  current.stopped = true;
  current.timers.forEach(clearTimeout);
  stopVoice();
  current = null;
  level = 0;
  emit();
}

/** The last cues played, oldest first: {kind, how 'voice'|'sound'|'none', text, at}. */
export const firedCues = () => fired.slice();

/** A tap that may lead to sound: lets iPhone play the voice. */
export const unlock = () => { try { audioContext(); } catch { /* no audio */ } };
