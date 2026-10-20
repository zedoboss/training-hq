// Always listening while the app is open (9.7, brief sections 6 and 12). Switched on per device in Settings > Voice
// (never synced: the phone and the Mac's browser must not both act on the same words), and only after calibration and
// a passed test. Each stretch of speech goes to the Mac, where the voice lock decides; only his words reach the
// coach. Its answer is spoken sentence by sentence (unless a quiet rule holds it back), its actions run here (rest
// timer, sync, the session screen's exercise). Barge-in: when someone talks over the coach, the first second goes to
// the Mac's voice check, and only his voice stops it. The screen stays on while listening (wake lock).
import { micSession } from './voice-rec.js';
import { audioContext, audioRunning, resetAudio } from './voice-mic.js';
import { createPlayer } from './voice-player.js';
import { encodeWav } from './wav.js';
import { sentenceSplitter, replyGate } from './voice-text.js';
import { voiceUtterance, voiceSpeech, macGet, macPost, macSendRaw, syncNow } from './data.js';
import { getState } from './store.js';
import { withDefaults } from './settings.js';
import { runAction } from './coach.js';
import { isQuiet, onQuietEnd, quietFor } from './quiet.js';
import * as rest from './rest-timer.js';
import { play, micActive } from './sounds.js';
import * as talk from './talk.js';
import { callsForCalm } from './coach-talk.js';
import { updateApp } from './sw-client.js';

const KEY = 'thq.voice.listen';
const SEEN = 'thq.voice.used';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } } };
const prefs = () => withDefaults(getState().settings);

let mic = null; let opening = null; let wake = null; let held = 0;
let phase = 'off'; // off | listening | hearing | thinking | speaking | paused | tap | error
let readout = null; let readoutTimer = null; let error = null; let turnsInFlight = 0;
let bargeTimer = null; let bargeSent = false; let overCoach = false;
const quietQueue = [];
const subs = new Set();

// The chip after the coach stops talking. Tue 10/20: it used to change only while the microphone was open, so a
// reply or nudge spoken while the mic was off, dropped or being reopened left SPEAKING on for good, and a tap
// (hush) couldn't clear it either.
const restPhase = () => (mic ? (turnsInFlight ? 'thinking' : 'listening') : held ? (listening() ? 'paused' : 'off') : listening() ? 'tap' : 'off');
const player = createPlayer({
  context: audioContext,
  fetchSpeech: voiceSpeech,
  onState: (speaking) => setPhase(speaking ? 'speaking' : restPhase()),
});

/** What the header chip and the Voice screen show. */
export const snapshot = () => ({ wanted: listening(), used: ls.get(SEEN) === '1', on: !!mic, phase, readout, error, held: held > 0 });
export const listening = () => ls.get(KEY) === '1';
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => { const s = snapshot(); for (const f of subs) { try { f(s); } catch { /* a screen gone */ } } };
function setPhase(p) { if (phase !== p) { phase = p; emit(); report(p); } }

// The chip's changes go to the Mac's log (a second later, together), so it can be followed without iPhone Mirroring.
let reports = []; let reportTimer = null;
function report(p) {
  reports.push({ phase: p, at: Date.now() });
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => { const phases = reports; reports = []; macPost('/api/voice/state', { phases }).catch(() => {}); }, 1500);
}
const broadcast = (e) => window.dispatchEvent(new CustomEvent('thq:voice-event', { detail: e }));

/** The silent readout: speech heard but not acted on, and why (for 4 seconds). */
function showReadout(reason, score) {
  if (!prefs().voice.readout) return;
  readout = { reason, score, at: Date.now() };
  clearTimeout(readoutTimer);
  readoutTimer = setTimeout(() => { readout = null; emit(); }, 4000);
  emit();
}

async function keepAwake() {
  try { if (!wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed now */ }
}
function letSleep() { try { wake?.release(); } catch { /* gone */ } wake = null; }

// Things the coach asked this device to do (the same as on the Talk screen). Tue 10/20: it works the app too:
// opens screens, switches the microphone off (after it has said so), loads the newest version.
const deps = {
  rest,
  sync: () => { syncNow().catch(() => {}); },
  focus: (a) => {
    try { sessionStorage.setItem('thq.coach.focus', JSON.stringify({ ...a, at: Date.now() })); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('thq:coach-focus', { detail: a }));
  },
  go: (url) => { if (location.hash !== url) location.hash = url; },
  micOff: () => afterReply(() => stop()),
  reload: () => afterReply(() => updateApp()),
};

/** Once the coach has finished talking (at most 20 s), so its answer is heard first. */
function afterReply(fn) {
  const t0 = Date.now();
  const tick = () => { if ((player.speaking || turnsInFlight) && Date.now() - t0 < 20000) setTimeout(tick, 300); else fn(); };
  setTimeout(tick, 600);
}

function speak(sentence) {
  // On screen too, spoken or not (the caption at the top).
  window.dispatchEvent(new CustomEvent('thq:coach-say', { detail: { text: sentence } }));
  if (!prefs().voice.speak) return;
  // A15 (brief decision 30): the coach talks during sets and holds, so its answers no longer wait for them to end,
  // unless he switched that off (then the old quiet rule holds them back).
  // A16: never while the squat camera runs a set (the depth ding must stay clear): it waits until the set is over.
  if (isQuiet() && (prefs().coach.talk.during === false || quietFor('squat'))) { quietQueue.push(sentence); return; }
  talk.stop();
  player.say(sentence);
}
onQuietEnd(() => { while (quietQueue.length) player.say(quietQueue.shift()); });

/** One stretch of speech: to the Mac, then the coach's answer as it comes. */
async function turn(wav, { overCoach: echo = false } = {}) {
  turnsInFlight++;
  if (!player.speaking) setPhase('thinking');
  const split = sentenceSplitter();
  const gate = replyGate(); let ok = false;
  const sentence = (s) => { for (const x of gate.sentence(s)) speak(x); };
  try {
    const st = prefs();
    await voiceUtterance({
      wav, model: st.coach.model, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, screen: location.hash,
      onEvent: (e) => {
        broadcast(e);
        if (e.type === 'heard') {
          // Not him. A clip that began while the coach was talking is mostly its own echo: no readout for that.
          if (!e.ok) { if (!(echo && e.reason === 'not-you')) showReadout(e.reason, e.score); return; }
          ok = true;
          // His voice, confirmed: whatever the coach was saying stops (barge-in), the set or hold talk too (only real
          // words get this far: grunts and breathing are dropped on the Mac). Pain, stop or anything off: Calm.
          if (player.speaking) player.stop();
          talk.stop();
          if (callsForCalm(e.text)) talk.setCalm();
          quietQueue.length = 0;
          setPhase('thinking');
        } else if (e.type === 'text') {
          for (const s of split.push(e.delta)) sentence(s);
        } else if (e.type === 'action') {
          // Spoken turns have no buttons: a screen the coach opened ('open') is shown at once.
          runAction(e.action?.kind === 'open' ? { ...e.action, kind: 'go' } : e.action, deps);
        } else if (e.type === 'done') {
          for (const s of split.flush()) sentence(s);
          const end = gate.end();
          for (const x of end.speak) speak(x);
          if (end.tick && st.voice.speak) play('tick', st.sounds.tickVolume);
        } else if (e.type === 'error') {
          error = e.error;
        }
      },
    });
  } catch (e) {
    error = e.message;
    showReadout('mac', null);
  } finally {
    turnsInFlight--;
    if (ok) syncNow().catch(() => {});
    if (!player.speaking) setPhase(restPhase());
    emit();
  }
}

/** Someone started talking over the coach: after about a second, ask the Mac whether it's him. */
function bargeCheck() {
  clearTimeout(bargeTimer);
  bargeSent = false;
  bargeTimer = setTimeout(async () => {
    if (!mic || !player.speaking || bargeSent) return;
    const part = mic.vad.partial();
    if (!part || part.length < 16000 * 0.6) return;
    bargeSent = true;
    try {
      const r = await macSendRaw('/api/voice/barge', encodeWav(part), 'audio/wav', 8000);
      if (r.me && player.speaking) player.stop();
      else if (!r.me && r.reason !== 'not-you') showReadout(r.reason, r.score);
    } catch { /* the full clip still goes through */ }
  }, 1000);
}

// When the microphone can't be opened (Mon 10/19: under iPhone Mirroring iOS refuses it with a dialog), the app must not
// ask again on every return to the screen: that kept the dialog coming back and the phone stuck. Automatic retries
// wait this long; a tap on the chip always tries at once.
const MIC_RETRY_MS = 120000;
let micFailedAt = 0;
const mayRetry = () => Date.now() - micFailedAt >= MIC_RETRY_MS;

async function openListening() {
  if (mic || held || opening) return opening;
  opening = (async () => {
    try {
      mic = await micSession({
        onClip: (wav) => { clearTimeout(bargeTimer); turn(wav, { overCoach }); overCoach = false; },
        onEvent: (e) => {
          if (e.type === 'start') {
            overCoach = player.speaking || talk.playing();
            // Tue 10/20: he started again while the Mac holds his last clip: tell it, so the coach waits for the rest.
            if (turnsInFlight && !overCoach) macPost('/api/voice/talking').catch(() => {});
            if (player.speaking) bargeCheck(); else if (!turnsInFlight && !overCoach) setPhase('hearing');
          }
          else if (e.type === 'noise' && phase === 'hearing') setPhase('listening');
        },
        // While the coach talks, its own sound must be louder than usual to count as someone speaking.
        onLevel: () => { const lv = Math.max(player.level, talk.talkLevel()); mic?.vad.setBoost(player.speaking || talk.playing() ? 1 + 4 * lv : 1); },
        onEnded: () => { mic = null; micActive(false); letSleep(); setPhase(listening() ? 'tap' : 'off'); },
      });
      error = null;
      micActive(true);
      setPhase(player.speaking ? 'speaking' : turnsInFlight ? 'thinking' : 'listening');
      keepAwake();
    } catch (e) {
      mic = null;
      error = e.message;
      micFailedAt = Date.now();
      setPhase('tap');
      throw e;
    } finally { opening = null; }
  })();
  return opening;
}

function closeListening() {
  clearTimeout(bargeTimer);
  mic?.close(); mic = null; micActive(false);
  letSleep();
}

/** Switch listening on for this device (from a tap: it also lets iPhone play the coach's voice). */
export async function start() {
  // A tap: if the audio context isn't running (another app or iPhone Mirroring had the audio), start a fresh one now,
  // while the tap still lets iPhone run it.
  if (!audioRunning()) { player.stop(); resetAudio(); }
  audioContext(); rest.unlockAudio();
  const st = await macGet('/api/voice/status');
  if (!st.canListen) throw new Error('Calibrate and test your voice first (Settings > Voice).');
  ls.set(KEY, '1'); ls.set(SEEN, '1');
  micFailedAt = 0; // a tap: try now
  await openListening();
  macPost('/api/voice/warm').catch(() => {});
  emit();
}

/** Switch listening off for this device. */
export function stop() {
  ls.set(KEY, null);
  closeListening();
  player.stop();
  quietQueue.length = 0;
  setPhase('off');
  emit();
}

/** Say something in the coach's voice (sentence by sentence, following the quiet rules and the speak setting). */
export function speakText(text) {
  const split = sentenceSplitter();
  for (const s of [...split.push(String(text || '')), ...split.flush()]) speak(s);
}

/**
 * Mon 10/19: the coach says its nudges and reminders out loud too, when the app is open and listening is on (they
 * arrive by sync within about 30 seconds). Only new ones: what was already there when the app opened stays quiet.
 */
export function watchNudges(repo) {
  const said = new Set();
  let primed = false;
  const check = async () => {
    const msgs = (await repo.list('coach-messages')).filter((m) => m && m.role === 'assistant' && (m.kind === 'nudge' || m.kind === 'reminder'));
    for (const m of msgs) {
      if (said.has(m.id)) continue;
      said.add(m.id);
      const fresh = Date.now() - (m.at || 0) < 3 * 60000;
      if (primed && fresh && listening() && document.visibilityState === 'visible') speakText(m.text);
    }
    primed = true;
  };
  check().catch(() => {});
  return repo.onChange((cols) => { if (cols.includes('coach-messages')) check().catch(() => {}); });
}

/** Stop the coach talking (a tap on the chip while it speaks). */
export const hush = () => { player.stop(); quietQueue.length = 0; if (phase === 'speaking') setPhase(restPhase()); };

/** Calibration and the test screen use the microphone themselves: listening pauses meanwhile. */
export function hold(on) {
  held = Math.max(0, held + (on ? 1 : -1));
  if (held) { closeListening(); player.stop(); setPhase(listening() ? 'paused' : 'off'); }
  else if (listening()) openListening().catch(() => {});
}

// Only while the app is open and on screen: the microphone closes when it hides and opens again when it's back
// (iPhone may want a tap for that: the chip then says TAP TO LISTEN).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { closeListening(); player.stop(); if (listening()) setPhase('paused'); }
  else if (listening() && !held && mayRetry()) openListening().catch(() => {});
});
// The first tap after the app opens lets iPhone play sound again.
document.addEventListener('pointerdown', () => { audioContext(); rest.unlockAudio(); }, { once: true, capture: true });

/** At app start: listen again if it was on, as long as calibration still allows it. */
export async function resume() {
  if (!listening()) return;
  try {
    const st = await macGet('/api/voice/status');
    if (!st.canListen) { stop(); return; }
  } catch { /* Mac unreachable: listening waits; the chip says so */ setPhase('tap'); error = 'Mac unreachable'; emit(); return; }
  if (!mayRetry()) { setPhase('tap'); return; }
  openListening().catch(() => {});
}
