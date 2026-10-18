// Speech detection on the phone (step 9): finds where someone starts and stops talking in the microphone stream, so
// only those stretches go to the Mac (where the voice lock decides whether it was him). Loudness only, against a
// noise floor that follows the room: it rises slowly with steady sound (gym music) and drops quickly when the room
// goes quiet, so steady music stops counting as speech after a few seconds. Pure: frames in, events out.

export const VAD_DEFAULTS = {
  rate: 16000,
  ratio: 3.2,          // speech must be this many times louder than the room
  minLevel: 0.004,     // ...and at least this loud
  maxLevel: 0.25,      // the threshold never goes above this, however loud the room
  startMs: 90,         // loud this long before it counts as a start
  endMs: 700,          // quiet this long ends the clip
  preMs: 320,          // kept from just before the start
  minVoicedMs: 240,    // less voiced time than this is a noise (a cough, a plate)
  maxSec: 10,          // a clip is cut here (Whisper's limit)
  learnMs: 500,        // the first half second only learns the room
};

/**
 * @param {Partial<typeof VAD_DEFAULTS>} o
 * @param {(e: {type: 'start'} | {type: 'end', samples: Float32Array, voicedMs: number, cut: boolean} | {type: 'noise', voicedMs: number}) => void} onEvent
 */
export function createVad(o = {}, onEvent = () => {}) {
  const c = { ...VAD_DEFAULTS, ...o };
  let floor = null; let learned = 0;
  let loudRun = 0; let quietRun = 0; let voiced = 0; let levelSum = 0; let levelN = 0;
  let speaking = false;
  let pre = []; let preLen = 0;
  let clip = []; let clipLen = 0;
  let boost = 1;
  const ms = (n) => (n / c.rate) * 1000;

  const threshold = () => Math.min(c.maxLevel, Math.max(c.minLevel, (floor ?? c.minLevel) * c.ratio)) * boost;

  function finish(cut = false) {
    const voicedMs = voiced;
    const parts = clip; const len = clipLen;
    // Loud without a break for the whole limit: steady sound (music), not someone talking. The room is that loud now.
    if (cut && levelN) floor = Math.max(floor, (levelSum / levelN / c.ratio) * 1.3);
    speaking = false; clip = []; clipLen = 0; voiced = 0; quietRun = 0; loudRun = 0; levelSum = 0; levelN = 0;
    if (voicedMs < c.minVoicedMs) { onEvent({ type: 'noise', voicedMs }); return; }
    const out = new Float32Array(len);
    let p = 0;
    for (const f of parts) { out.set(f, p); p += f.length; }
    onEvent({ type: 'end', samples: out, voicedMs, cut });
  }

  return {
    /** One frame of 16 kHz samples (any length; about 30 ms works well). Returns this frame's loudness. */
    push(frame) {
      let s = 0;
      for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
      const level = Math.sqrt(s / (frame.length || 1));
      const fms = ms(frame.length);
      if (learned < c.learnMs) {
        floor = floor == null ? level : floor * 0.8 + level * 0.2;
        learned += fms;
        return level;
      }
      const th = threshold();
      const loud = level > th;
      if (!speaking) {
        // The room: fast down, slow up (about 6 s to follow steady music).
        floor = level < floor ? floor * 0.7 + level * 0.3 : floor * 0.995 + level * 0.005;
        pre.push(frame); preLen += frame.length;
        while (pre.length > 1 && ms(preLen - pre[0].length) >= c.preMs) preLen -= pre.shift().length;
        loudRun = loud ? loudRun + fms : 0;
        if (loudRun >= c.startMs) {
          speaking = true; clip = pre; clipLen = preLen; pre = []; preLen = 0;
          voiced = loudRun; quietRun = 0;
          onEvent({ type: 'start' });
        }
        return level;
      }
      clip.push(frame); clipLen += frame.length;
      levelSum += level; levelN++;
      // Slight hysteresis: once talking, a little quieter still counts.
      if (level > th * 0.9) { voiced += fms; quietRun = 0; } else {
        quietRun += fms;
        floor = floor * 0.998 + level * 0.002;
      }
      if (quietRun >= c.endMs) finish(false);
      else if (ms(clipLen) >= c.maxSec * 1000) finish(true);
      return level;
    },
    /** Make it harder to start (while the coach is talking out of the speaker): threshold times `x`. */
    setBoost(x) { boost = Math.max(1, Number(x) || 1); },
    /** Drop anything in progress (after a reply starts, when the screen hides). */
    reset() { speaking = false; clip = []; clipLen = 0; voiced = 0; loudRun = 0; quietRun = 0; pre = []; preLen = 0; levelSum = 0; levelN = 0; },
    get speaking() { return speaking; },
    get floor() { return floor; },
    get threshold() { return threshold(); },
  };
}
