// The voice lock's decision (9.2, 9.4): may a clip go on to Whisper and the coach? Pure, so it is tested directly.
// Order: too little speech (noise) -> music or singing rather than speech -> whose voice. Anything that fails is
// dropped on the Mac: nothing is transcribed, logged or answered, and the audio is not kept. When in doubt, ignore.
import { MIN_SPEECH_SEC } from './voiceprint.mjs';

/** Music levels (AudioSet tagger, 0..1) above which a clip counts as music rather than speech. */
export const MUSIC_LIMITS = { singing: 0.3, music: 0.4, quietSpeech: 0.1 };

/**
 * @param {object} a  engine.analyse() of the clip ({speechSec, tags: {speech, music, singing}})
 * @param {number|null} score  how much it sounds like him (voiceprint.score), null when there is no voice vector
 * @param {number} threshold  the score needed (strictness)
 * @returns {{ok: boolean, reason: 'you'|'noise'|'music'|'unsure'|'not-you', score: number|null}}
 */
export function decide(a, score, threshold) {
  const t = a?.tags || { speech: 0, music: 0, singing: 0 };
  const s = score == null ? null : Math.round(score * 100) / 100;
  if (!a || a.speechSec < MIN_SPEECH_SEC) return { ok: false, reason: 'noise', score: s };
  if (t.singing >= MUSIC_LIMITS.singing && t.singing >= t.speech) return { ok: false, reason: 'music', score: s };
  if (t.music >= MUSIC_LIMITS.music && t.music > t.speech) return { ok: false, reason: 'music', score: s };
  if (t.speech < MUSIC_LIMITS.quietSpeech && t.music > t.speech) return { ok: false, reason: 'music', score: s };
  if (s == null) return { ok: false, reason: 'unsure', score: null };
  if (score < threshold) return { ok: false, reason: 'not-you', score: s };
  return { ok: true, reason: 'you', score: s };
}

