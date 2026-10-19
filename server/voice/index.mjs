// Voice on the Mac (step 9). The phone records what it hears and sends each stretch of speech here as a small WAV;
// nothing is acted on until it passes the voice lock:
//   clip -> speech? music? (engine tags, VAD) -> his voice? (voiceprint, strictness) -> Whisper -> the coach
// A clip that fails is dropped: not transcribed, not logged, not answered, and its audio is not kept. The phone only
// learns why (for the small silent readout). Calibration and the test screen use the same check.
import { join } from 'node:path';
import { openVoiceprint, thresholdFor, DEFAULT_STRICTNESS } from './voiceprint.mjs';
import { decide } from './gate.mjs';
import { cleanTranscript } from './whisper.mjs';
import { decodeWav, encodeWav, resample, normalise, VOICE_RATE } from '../../app/js/lib/wav.js';
import { withDefaults } from '../../app/js/lib/settings.js';

import { addressed } from './address.mjs';

export const MAX_CLIP_SEC = 15;
/** The same words from two devices within this time are one utterance (the phone and the Mac both listening). */
export const DUPLICATE_MS = 5000;
const HINT = '80 for 8. 62.5 for 10. Next exercise. Start the timer. Add 15 seconds. Skip the rest. Smith machine.';

const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {object} o
 * @param {ReturnType<import('../store.mjs').openStore>} o.store
 * @param {string} o.dataDir  the private folder's data/
 * @param {ReturnType<import('./engine.mjs').openEngine>} o.engine
 * @param {ReturnType<import('./whisper.mjs').openWhisper>} [o.whisper]
 * @param {ReturnType<import('../coach/index.mjs').openCoach>} [o.coach]
 */
export function openVoice({ store, dataDir, engine, whisper = null, coach = null, log = () => {}, now = () => Date.now() }) {
  let lastHeard = null; // {text, device, at}: to drop the same words heard by a second device
  const print = openVoiceprint(join(dataDir, 'voice'));
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const strictness = () => withDefaults(one('settings', 'main')).voice?.strictness || DEFAULT_STRICTNESS;

  /** A WAV from the phone as 16 kHz floats. */
  function clipOf(bytes) {
    let wav;
    try { wav = decodeWav(bytes); } catch (e) { throw fail(400, e.message); }
    const s = resample(wav.samples, wav.sampleRate, VOICE_RATE);
    if (s.length < VOICE_RATE * 0.2) throw fail(400, 'clip too short');
    return s.length > VOICE_RATE * MAX_CLIP_SEC ? s.subarray(0, VOICE_RATE * MAX_CLIP_SEC) : s;
  }

  const status = () => ({ engine: engine.status(), ...print.summary(strictness()) });

  /** One calibration phrase. */
  function enrol({ bytes, condition, phrase }) {
    const samples = clipOf(bytes);
    const a = engine.analyse(samples);
    const r = print.addSample({ condition, phrase, samples, analysis: a, now: now() });
    log(`voice: calibration ${condition} ${r.ok ? 'kept' : `not kept (${r.problem})`}, ${a.speechSec.toFixed(1)} s speech`);
    return { ...r, speechSec: Math.round(a.speechSec * 10) / 10, music: Math.round((a.tags.music || 0) * 100) / 100, status: status() };
  }

  /** The voice lock on one clip: {samples, analysis, decision, threshold}. Not calibrated = never him. */
  function check(bytes) {
    const samples = clipOf(bytes);
    const threshold = thresholdFor(strictness());
    const s = print.summary(strictness());
    const analysis = engine.analyse(samples);
    if (!s.calibrated) return { samples, analysis, threshold, decision: { ok: false, reason: 'not-calibrated', score: null } };
    const score = print.score(analysis.embedding);
    return { samples, analysis, threshold, decision: decide(analysis, score, threshold) };
  }

  /** The test screen: him ('me') or someone else ('other') talking. Only the score is kept. */
  function test({ bytes, kind }) {
    const c = check(bytes);
    if (c.decision.reason === 'not-calibrated') throw fail(409, 'Calibrate first.');
    const t = print.addTest({ kind, score: c.decision.score ?? 0, threshold: c.threshold, match: c.decision.ok, now: now() });
    log(`voice: test ${t.kind} -> ${c.decision.reason} ${c.decision.score ?? ''}`);
    return { ...c.decision, threshold: c.threshold, speechSec: Math.round(c.analysis.speechSec * 10) / 10, tags: c.analysis.tags, test: t, status: status() };
  }

  /** Whisper's vocabulary hint: the usual commands and his own supplement names (from his list on the Mac). */
  const hint = () => {
    const names = store.listRecords('supplements').map((r) => r.data).filter((x) => x && !x.removedAt).map((x) => String(x.name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim()).filter(Boolean);
    return `${HINT}${names.length ? ` ${names.slice(0, 12).join(', ')}.` : ''}`;
  };

  /**
   * One stretch of speech from a listening device. Refused clips get only {type:'heard', ok:false, reason, score}:
   * nothing is transcribed, saved or answered, and the audio is gone when this returns. His words go to the coach
   * like a typed message (marked as spoken); the coach's events follow on `emit`.
   */
  async function utterance({ bytes, deviceId = null, model = 'fast', tz = null, emit = () => {} }) {
    const t0 = now();
    const c = check(bytes);
    const d = c.decision;
    if (!d.ok) {
      log(`voice: ignored (${d.reason}${d.score != null ? ` ${d.score}` : ''})`);
      emit({ type: 'heard', ok: false, reason: d.reason, score: d.score });
      return null;
    }
    if (!whisper) throw fail(503, 'speech to text not available');
    // No vocabulary hint: with one, Whisper wrote short commands twice in testing; without, names came out right.
    const raw = await whisper.transcribe(encodeWav(normalise(c.samples)));
    const text = cleanTranscript(raw.text, hint());
    if (!text) {
      log(`voice: no words (${raw.ms} ms)`);
      emit({ type: 'heard', ok: false, reason: 'empty', score: d.score });
      return null;
    }
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (lastHeard && lastHeard.key === key && lastHeard.device !== deviceId && now() - lastHeard.at < DUPLICATE_MS) {
      log('voice: same words from a second device, dropped');
      emit({ type: 'heard', ok: false, reason: 'duplicate', score: d.score });
      return null;
    }
    lastHeard = { key, device: deviceId, at: now() };
    // Talking to someone else: only his naming it, the app's own subjects, or an answer to the coach go on (Mon 10/19).
    const live = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
    const lastCoachAt = Math.max(0, ...live('coach-messages').filter((m) => m.role === 'assistant').map((m) => m.at || 0));
    const names = [...live('exercises').map((x) => String(x.name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim()), ...live('supplements').filter((x) => !x.removedAt).map((x) => String(x.name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim())];
    const to = addressed(text, { names, lastCoachAt, now: now(), inSession: live('sessions').some((x) => x.status === 'active') });
    if (!to.ok) {
      log(`voice: heard you (${d.score}), not for the coach`);
      emit({ type: 'heard', ok: false, reason: 'aside', score: d.score });
      return null;
    }
    log(`voice: heard you (${d.score}, ${to.why}), ${raw.ms} ms to text, ${now() - t0} ms in all`);
    emit({ type: 'heard', ok: true, score: d.score, text, ms: now() - t0 });
    if (!coach) throw fail(503, 'coach not available');
    return coach.send({ text, model, deviceId, tz, via: 'voice', emit });
  }

  return {
    status: () => ({ ...status(), whisper: whisper?.status() || null }),
    utterance,
    warm: () => whisper?.ensure().then(() => true).catch((e) => { log(`whisper: ${e.message}`); return false; }),
    hint,
    enrol,
    check,
    test,
    forget: (condition = null) => { const n = print.removeSamples(condition, now()); log(`voice: removed ${n} calibration phrases (${condition || 'all'})`); return { removed: n, status: status() }; },
    print,
  };
}
