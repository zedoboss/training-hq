// Voice on the Mac (step 9). The phone records what it hears and sends each stretch of speech here as a small WAV;
// nothing is acted on until it passes the voice lock:
//   clip -> speech? music? (engine tags, VAD) -> his voice? (voiceprint, strictness) -> Whisper -> the coach
// A clip that fails is dropped: not transcribed, not logged, not answered, and its audio is not kept. The phone only
// learns why (for the small silent readout). Calibration and the test screen use the same check.
import { join } from 'node:path';
import { openVoiceprint, thresholdFor, DEFAULT_STRICTNESS } from './voiceprint.mjs';
import { decide } from './gate.mjs';
import { decodeWav, resample, VOICE_RATE } from '../../app/js/lib/wav.js';
import { withDefaults } from '../../app/js/lib/settings.js';

export const MAX_CLIP_SEC = 15;

const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {object} o
 * @param {ReturnType<import('../store.mjs').openStore>} o.store
 * @param {string} o.dataDir  the private folder's data/
 * @param {ReturnType<import('./engine.mjs').openEngine>} o.engine
 */
export function openVoice({ store, dataDir, engine, log = () => {}, now = () => Date.now() }) {
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

  return {
    status,
    enrol,
    check,
    test,
    forget: (condition = null) => { const n = print.removeSamples(condition, now()); log(`voice: removed ${n} calibration phrases (${condition || 'all'})`); return { removed: n, status: status() }; },
    print,
  };
}
