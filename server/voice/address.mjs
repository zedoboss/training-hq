// Is he talking to the coach? (Michael, Mon 10/19: "it should always listen", but random talk must not get an answer.)
// After the voice lock and Whisper. Tue 10/20, his words: "There are no people talking here... If I am talking to
// someone else, then it is not for coach, but I don't have to say coach, Jarvis, or AI in every instance." So:
// - He names it (Jarvis, coach, AI), answers the coach (within a minute of it speaking), says numbers, a command or
//   the app's own subjects: always the coach's.
// - Alone (the voice lock heard nobody else lately): everything he says is for the coach, except self-talk on its
//   own ("okay", "come on", "let's go", counting, a lone swear).
// - Someone else talking near him (another voice in the last few minutes): only the above; the rest is dropped like
//   noise, not answered, not saved.
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

/**
 * Telling the app to do something (Tue 10/20, the coach works the app): open a screen, start or finish a workout,
 * switch a setting. "Open the chat", "show me my supplements", "start push", "turn off the mic", "switch to Opus".
 */
const COMMAND = /\b(open|show( me)?|go to|take me to|switch to|bring up|pull up|start|begin|finish|end|save|pause|resume|discard|turn (on|off)|mute|reload|refresh|sync)\b[^.?!]{0,30}?\b(chat|talk|session|workout|train|training|fuel|body|settings|calendar|history|stats|statistics|supplements?|sauna|scan|library|programme|program|holds|today|home|progression|vitamins|check ?-?in|squat|demos|meals?|push|pull|legs|neck|clock|timer|mic|microphone|voice|app|opus|sonnet|model|notifications?|nudges?|exercise|routine)\b/i;

const norm = (t) => ` ${String(t || '').toLowerCase().replace(/[^\p{L}\p{N}.\-]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (n, w) => n.includes(` ${w} `);

/** "80 for 8", "62.5 for 10", "bodyweight for 12", "100 kilos", "3 sets", "30 seconds". */
const NUMBERS = /\b(\d+(\.\d+)?|bodyweight)\s*(for|x|times)\s*\d+\b|\b\d+(\.\d+)?\s*(kg|kilos?|reps?|sets?|seconds?|minutes?|grams?|g)\b/i;

// Self-talk: a clip made only of these words is him talking to himself (mid-set, between sets), not to the coach.
const SELF = new Set(['ok', 'okay', 'k', 'yeah', 'yea', 'yep', 'yup', 'yes', 'no', 'nope', 'nah', 'alright', 'right', 'hmm', 'mm', 'mhm',
  'come', 'on', 'lets', "let's", 'go', 'fuck', 'fucking', 'shit', 'damn', 'bro', 'man', 'dude', 'god', 'oh', 'jesus', 'wow', 'nice', 'good',
  'light', 'weight', 'baby', 'push', 'up', 'again', 'one', 'more', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'last', 'easy', 'breathe', 'focus', 'whatever', 'anyway', 'so', 'well', 'uh', 'um', 'huh', 'and', 'the']);
export const selfTalk = (t) => {
  const w = String(t || '').toLowerCase().replace(/[’']/g, "'").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  return w.length > 0 && w.length <= 5 && w.every((x) => SELF.has(x) || /^\d+$/.test(x));
};

/**
 * @param {string} text  what Whisper heard
 * @param {object} o
 * @param {string[]} [o.names]     his own words: exercise and supplement names
 * @param {number} [o.lastCoachAt] when the coach last spoke to him (a reply or a nudge), ms
 * @param {number} [o.now]
 * @param {boolean} [o.inSession]  a workout is running
 * @param {number} [o.followMs]    how long after the coach spoke an answer counts
 * @param {boolean} [o.othersAround] another voice was heard near him lately (the voice lock rejected it)
 * @returns {{ok: boolean, why: 'named'|'answer'|'command'|'about'|'alone'|'aside'|'self-talk'}}
 */
export function addressed(text, { names = [], lastCoachAt = 0, now = Date.now(), inSession = false, followMs = 60000, othersAround = false } = {}) {
  const raw = String(text || '');
  if (WAKE.test(raw) || AI.test(raw)) return { ok: true, why: 'named' };
  if (lastCoachAt && now - lastCoachAt <= followMs) return { ok: true, why: 'answer' };
  const n = norm(raw);
  if (NUMBERS.test(raw)) return { ok: true, why: 'about' };
  if (COMMAND.test(raw)) return { ok: true, why: 'command' };
  if (STRONG.some((w) => has(n, w))) return { ok: true, why: 'about' };
  if (names.some((w) => w && w.length >= 4 && n.includes(` ${norm(w).trim()} `))) return { ok: true, why: 'about' };
  if (selfTalk(raw)) return { ok: false, why: 'self-talk' };
  const weak = WEAK.filter((w) => has(n, w)).length;
  if (weak >= 2 || (inSession && weak >= 1)) return { ok: true, why: 'about' };
  if (!othersAround) return { ok: true, why: 'alone' };
  return { ok: false, why: 'aside' };
}

/**
 * Was this rejected clip someone else talking near him? Clearly not his voice (score at most 0.25; his own clips score
 * 0.44 to 0.81, short ones of his near 0.4), at least a second of speech, and not right after the coach spoke (its
 * own voice from his speaker must not count as a person).
 */
export const OTHER_VOICE = { maxScore: 0.25, minSpeechSec: 1, afterCoachMs: 45000, aroundMs: 3 * 60000 };
export function otherVoice({ reason, score, speechSec, lastCoachAt = 0, now = Date.now() }) {
  return reason === 'not-you' && score != null && score <= OTHER_VOICE.maxScore && speechSec >= OTHER_VOICE.minSpeechSec
    && !(lastCoachAt && now - lastCoachAt < OTHER_VOICE.afterCoachMs);
}

/** He trailed off mid-thought ("I woke up before 10, so...", "and", a comma): more is probably coming in the next clip. */
export function looksUnfinished(text) {
  const t = String(text || '').trim();
  if (/(\.\.\.|…|,|-)$/.test(t)) return true;
  return /\b(and|so|but|or|because|then|like|um|uh|plus|also|with|to|the|a|my)$/i.test(t.replace(/[.?!]+$/, ''));
}

