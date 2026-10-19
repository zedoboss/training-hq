// Is he talking to the coach? (Michael, Mon 10/19: "it should always listen", but random talk must not get an answer.)
// After the voice lock and Whisper: the coach answers only when he names it (Jarvis, coach, AI), when the words are
// about what the app does (sets, food, supplements, sleep, the sauna, his body...), or when he is answering the coach
// (within a minute of it speaking or nudging him). Anything else is dropped like noise: not answered, not saved.
// Pure, so it is tested directly.

/** He names it: "Jarvis", "coach", "AI" (anywhere: "yo Jarvis", "what's next, coach?"). */
const WAKE = /\b(jarvis|jarvi|coach)\b/i;
const AI = /(^|[^A-Za-z])A\.?\s?I\.?(?=[^A-Za-z]|$)/; // "AI" as Whisper writes it, never the "ai" inside words

/** Words that only come up about the things the app does. One is enough. */
const STRONG = [
  'rep', 'reps', 'squat', 'squats', 'bench', 'deadlift', 'deadlifts', 'kg', 'kgs', 'kilo', 'kilos', 'kilograms', 'timer',
  'exercise', 'exercises', 'workout', 'session', 'warm up', 'warmup', 'superset', 'drop set', 'to failure', 'rpe',
  'sauna', 'evolt', 'body fat', 'supplement', 'supplements', 'creatine', 'magnesium', 'vitamin', 'omega', 'carnitine',
  'collagen', 'ashwagandha', 'protein', 'calories', 'kcal', 'carbs', 'check in', 'check-in', 'checkin', 'tendon',
  'tendons', 'rest day', 'legs day', 'leg day', 'push day', 'pull day', 'week column', 'programme', 'program',
  'personal best', 'pr', 'steps', 'weigh in', 'weighed', 'chia', 'pull ups', 'pull-ups', 'pullups', 'dips',
];
/** Words that are about it often but not always ("I'm done", "come back"): two, or one during a session. */
const WEAK = [
  'set', 'sets', 'rest', 'hold', 'holds', 'next', 'skip', 'skipped', 'start', 'stop', 'done', 'finish', 'finished',
  'failure', 'heavy', 'light', 'easy', 'hard', 'weight', 'knee', 'knees', 'back', 'shoulder', 'wrist', 'elbow', 'legs',
  'energy', 'sore', 'pain', 'ate', 'eat', 'eaten', 'meal', 'breakfast', 'lunch', 'dinner', 'snack', 'slept', 'sleep',
  'woke', 'bed', 'walk', 'took', 'take', 'eggs', 'rice', 'beef', 'yogurt', 'almonds', 'banana', 'broccoli', 'water',
  'neck', 'gym', 'train', 'training', 'today', 'tomorrow', 'seconds', 'minutes', 'add', 'log', 'undo',
];

const norm = (t) => ` ${String(t || '').toLowerCase().replace(/[^\p{L}\p{N}.\-]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (n, w) => n.includes(` ${w} `);

/** "80 for 8", "62.5 for 10", "bodyweight for 12", "100 kilos", "3 sets", "30 seconds". */
const NUMBERS = /\b(\d+(\.\d+)?|bodyweight)\s*(for|x|times)\s*\d+\b|\b\d+(\.\d+)?\s*(kg|kilos?|reps?|sets?|seconds?|minutes?|grams?|g)\b/i;

/**
 * @param {string} text  what Whisper heard
 * @param {object} o
 * @param {string[]} [o.names]     his own words: exercise and supplement names
 * @param {number} [o.lastCoachAt] when the coach last spoke to him (a reply or a nudge), ms
 * @param {number} [o.now]
 * @param {boolean} [o.inSession]  a workout is running
 * @param {number} [o.followMs]    how long after the coach spoke an answer counts
 * @returns {{ok: boolean, why: 'named'|'answer'|'about'|'aside'}}
 */
export function addressed(text, { names = [], lastCoachAt = 0, now = Date.now(), inSession = false, followMs = 60000 } = {}) {
  const raw = String(text || '');
  if (WAKE.test(raw) || AI.test(raw)) return { ok: true, why: 'named' };
  if (lastCoachAt && now - lastCoachAt <= followMs) return { ok: true, why: 'answer' };
  const n = norm(raw);
  if (NUMBERS.test(raw)) return { ok: true, why: 'about' };
  if (STRONG.some((w) => has(n, w))) return { ok: true, why: 'about' };
  if (names.some((w) => w && w.length >= 4 && n.includes(` ${norm(w).trim()} `))) return { ok: true, why: 'about' };
  const weak = WEAK.filter((w) => has(n, w)).length;
  if (weak >= 2 || (inSession && weak >= 1)) return { ok: true, why: 'about' };
  return { ok: false, why: 'aside' };
}
