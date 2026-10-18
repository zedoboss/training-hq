// His voiceprint (9.1, 9.2): the speaker vectors of the phrases he read during calibration, kept only in the private
// folder (data/voice/voiceprint.json; his calibration recordings beside it in data/voice/samples, so the voiceprint
// can be rebuilt if the speaker model ever changes). Never synced to the phone, never in the public repo, never sent
// anywhere. A clip is scored against it by cosine similarity: the mean of its three best matches among his samples.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cosine, SPEAKER_MODEL } from './engine.mjs';
import { encodeWav } from '../../app/js/lib/wav.js';

/** Score needed to count as him, by strictness. Strict is the default (brief section 12: when in doubt, ignore). */
export const STRICTNESS = { strict: 0.5, normal: 0.42, relaxed: 0.35 };
export const DEFAULT_STRICTNESS = 'strict';
export const thresholdFor = (s) => STRICTNESS[s] ?? STRICTNESS[DEFAULT_STRICTNESS];

/** A round is complete with this many good phrases. */
export const ROUND_MIN = 8;
/** Less speech than this gives an unreliable voice vector. */
export const MIN_SPEECH_SEC = 0.4;
/** A calibration phrase that scores below this against his other phrases is probably not him (or noise). */
export const ODD_ONE = 0.3;
export const CONDITIONS = ['home', 'gym'];

/** Mean of the best `k` cosine scores of `emb` against the samples' vectors (fewer if there are fewer samples). */
export function scoreAgainst(samples, emb, { k = 3, skip = null } = {}) {
  if (!emb) return null;
  const scores = samples.filter((s) => s.embedding && s.id !== skip).map((s) => cosine(s.embedding, emb)).sort((a, b) => b - a);
  if (!scores.length) return null;
  const top = scores.slice(0, k);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/** Each sample scored against all the others: how well the voiceprint knows his own voice. */
export function selfScores(samples) {
  return samples.filter((s) => s.embedding).map((s) => ({ id: s.id, condition: s.condition, score: scoreAgainst(samples, s.embedding, { skip: s.id }) }))
    .filter((r) => r.score != null);
}

const pct = (arr, p) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** What the calibration screen shows: rounds, how well it knows him, whether listening may be switched on. */
export function summary(print, strictness = DEFAULT_STRICTNESS) {
  const samples = print.samples || [];
  const by = Object.fromEntries(CONDITIONS.map((c) => [c, samples.filter((s) => s.condition === c).length]));
  const self = samples.length >= 4 ? selfScores(samples).map((r) => r.score) : [];
  const threshold = thresholdFor(strictness);
  const tests = print.tests || [];
  const meTests = tests.filter((t) => t.kind === 'me');
  const passed = meTests.some((t) => t.match && t.at >= (print.calibratedAt || 0));
  const homeDone = by.home >= ROUND_MIN;
  return {
    model: print.model || SPEAKER_MODEL,
    samples: samples.length,
    rounds: Object.fromEntries(CONDITIONS.map((c) => [c, { count: by[c], done: by[c] >= ROUND_MIN }])),
    self: self.length ? { low: round2(pct(self, 0.1)), median: round2(pct(self, 0.5)), missRate: Math.round((self.filter((s) => s < threshold).length / self.length) * 100) } : null,
    strictness: STRICTNESS[strictness] ? strictness : DEFAULT_STRICTNESS,
    threshold,
    tests: { me: meTests.length, meMatched: meTests.filter((t) => t.match).length, other: tests.filter((t) => t.kind === 'other').length, otherRejected: tests.filter((t) => t.kind === 'other' && !t.match).length, last: tests.at(-1) || null },
    calibrated: homeDone,
    tested: homeDone && passed,
    // Brief section 12: listening stays off until calibration is done and tested.
    canListen: homeDone && passed,
    updatedAt: print.updatedAt || null,
  };
}

/**
 * @param {string} dir  the private folder's data/voice
 */
export function openVoiceprint(dir) {
  const file = join(dir, 'voiceprint.json');
  const samplesDir = join(dir, 'samples');
  const empty = () => ({ model: SPEAKER_MODEL, samples: [], tests: [], createdAt: null, updatedAt: null, calibratedAt: null });
  let cache = null;

  function read() {
    if (cache) return cache;
    try { cache = { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { cache = empty(); }
    return cache;
  }
  function write(p) {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(p)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    cache = p;
    return p;
  }

  /**
   * Add one calibration phrase. `analysis` is engine.analyse() of the clip. Returns {ok, sample, problem}: a phrase
   * with too little speech, or one that doesn't sound like his other phrases, is not kept (problem says why).
   */
  function addSample({ condition, phrase = '', samples, analysis, now = Date.now() }) {
    if (!CONDITIONS.includes(condition)) throw Object.assign(new Error('condition must be home or gym'), { status: 400 });
    const p = read();
    if (!analysis.embedding || analysis.speechSec < MIN_SPEECH_SEC) return { ok: false, problem: 'too-short', speechSec: analysis.speechSec };
    const others = p.samples;
    const fit = others.length >= 3 ? scoreAgainst(others, analysis.embedding) : null;
    if (fit != null && fit < ODD_ONE) return { ok: false, problem: 'not-like-the-others', score: round2(fit), speechSec: analysis.speechSec };
    const id = `${condition}.${now}`;
    mkdirSync(samplesDir, { recursive: true });
    writeFileSync(join(samplesDir, `${id}.wav`), encodeWav(samples), { mode: 0o600 });
    const sample = {
      id, condition, phrase: String(phrase).slice(0, 200), at: now,
      sec: round2(analysis.sec), speechSec: round2(analysis.speechSec),
      music: round2(analysis.tags?.music ?? 0), embedding: analysis.embedding,
    };
    const all = [...others, sample];
    // The home round is complete the moment it reaches ROUND_MIN phrases: a test after that unlocks listening.
    const homeNow = all.filter((s) => s.condition === 'home').length;
    const calibratedAt = condition === 'home' && homeNow === ROUND_MIN ? now : p.calibratedAt;
    write({ ...p, samples: all, createdAt: p.createdAt || now, updatedAt: now, calibratedAt });
    return { ok: true, sample: { ...sample, embedding: undefined }, fit: round2(fit) };
  }

  /** Remove the samples of one condition, or all of them (start again). Tests go too when everything goes. */
  function removeSamples(condition = null, now = Date.now()) {
    const p = read();
    const gone = p.samples.filter((s) => !condition || s.condition === condition);
    for (const s of gone) rmSync(join(samplesDir, `${s.id}.wav`), { force: true });
    const left = p.samples.filter((s) => !gone.includes(s));
    // Redoing the home round means testing again before listening.
    const homeChanged = gone.some((s) => s.condition === 'home');
    write({ ...p, samples: left, tests: left.length ? p.tests : [], updatedAt: now, calibratedAt: homeChanged ? null : p.calibratedAt });
    return gone.length;
  }

  /** Record a test on the test screen: him ('me') or someone else ('other'). Only the score is kept, never audio. */
  function addTest({ kind, score, threshold, match, now = Date.now() }) {
    const p = read();
    const t = { at: now, kind: kind === 'other' ? 'other' : 'me', score: round2(score), threshold, match: !!match };
    write({ ...p, tests: [...(p.tests || []), t].slice(-50) });
    return t;
  }

  return {
    dir, file,
    read,
    exists: () => existsSync(file),
    summary: (strictness) => summary(read(), strictness),
    addSample,
    removeSamples,
    addTest,
    /** How much a clip's voice vector sounds like him (null when there was too little speech to tell). */
    score: (emb) => scoreAgainst(read().samples, emb),
    reload: () => { cache = null; return read(); },
  };
}
