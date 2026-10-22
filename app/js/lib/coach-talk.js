// The coach talking during holds and sets (A14, A15, brief decision 30): what it says and exactly when, worked out
// BEFORE the hold or set starts, so the voice clips can be fetched in time and play on the second. Pure functions:
// the screens build a script, lib/talk.js fetches and plays it.
// Lines come from his line bank (private seed, collection 'coach-lines' doc 'bank': {moods: {<mood>: {<moment>:
// [[level 1-5, text], ...]}}}), in the mood the moment calls for, at or under the intensity he set; a small plain
// bank here covers anything missing. Calm replaces every mood the moment a safety rule applies or he says pain or
// stop. Nothing here counts reps (it can't see them) or pushes past a target: lines are about effort and control.
export const MOODS = ['commander', 'hype', 'dark', 'warrior', 'rival', 'calm'];
export const MOOD_LABEL = { commander: 'Commander', hype: 'Hype', dark: 'Dark', warrior: 'Warrior', rival: 'Rival', calm: 'Calm' };
export const MOOD_TEXT = {
  commander: 'Plain facts: targets, times, loads.',
  hype: 'Come on, you got it.',
  dark: 'Prove them wrong.',
  warrior: 'Discipline as the weapon.',
  rival: 'Your pre-layoff self is the rival.',
  calm: 'Plain and short whenever a safety rule applies. Always on.',
};
export const MOMENTS = ['hold-ready', 'hold-go', 'hold-push', 'hold-mid', 'hold-end', 'set-start', 'set-push', 'record', 'nudge'];
// How often it pushes during a set or hold: seconds between lines (0 = the start line only, plus a hold's halfway).
export const EVERY = { often: 7, steady: 12, once: 0 };
export const EVERY_LABEL = [['often', 'Every few seconds'], ['steady', 'Steady'], ['once', 'Once a set']];
export const COUNT = { 3: 'Three.', 2: 'Two.', 1: 'One.' };
export const SET_PUSH_MAX_S = 45; // a set of 8-12 controlled reps; pushes stop after this even if he hasn't ticked it

// Which moods each moment calls for, first choice first (his defaults, Sunday 10/18): holds are disciplined Warrior;
// a set's start Dark, Warrior or Hype; between and during sets short Hype or Warrior; records Rival.
const BY_MOMENT = {
  'hold-ready': ['warrior', 'dark', 'commander'], 'hold-go': ['warrior', 'commander'], 'hold-push': ['warrior', 'hype', 'commander'],
  'hold-mid': ['warrior', 'commander'], 'hold-end': ['warrior', 'commander'],
  'set-start': ['dark', 'warrior', 'hype', 'rival', 'commander'], 'set-push': ['hype', 'warrior', 'commander'], record: ['rival', 'hype', 'commander'],
  // His notifications through the day (Mon 10/19): the coach bumping him about what is still open.
  nudge: ['hype', 'warrior', 'dark', 'rival', 'commander'],
  // After a meal (Tue 10/20): get up, move, do the dishes.
  dishes: ['commander', 'warrior', 'hype', 'dark', 'rival'],
};

// The plain fallback: Commander and Calm, no flavour.
export const BASE_BANK = {
  commander: {
    'hold-ready': [[1, 'Get ready.']], 'hold-go': [[1, 'Hold.']], 'hold-push': [[1, 'Keep it still.']], 'hold-mid': [[1, 'Halfway.']],
    'hold-end': [[1, 'Done.']], 'set-start': [[1, 'Control the bottom.']], 'set-push': [[1, 'Controlled.']], record: [[1, 'New best.']],
    nudge: [[1, 'Get it done.']],
    dishes: [[1, 'Up now. Two minutes of walking, then the sink.']],
  },
  calm: {
    'hold-ready': [[1, 'Get ready. Easy setup.']], 'hold-go': [[1, 'Hold.']], 'hold-push': [[1, 'Breathe. Steady.']],
    'hold-mid': [[1, 'Halfway. Stay inside your limit.']], 'hold-end': [[1, 'Done. Rate it honestly.']],
    'set-start': [[1, 'Smooth reps. Control the bottom.']], 'set-push': [[1, 'Steady.']], record: [[1, 'New best.']],
    nudge: [[1, 'One thing at a time.']],
  },
};

const pickRng = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

/** Fill {placeholders}; null when the line needs a value we don't have (that line is skipped). */
export function fill(text, vars = {}) {
  let missing = false;
  const out = String(text).replace(/\{(\w+)\}/g, (_, k) => { const v = vars[k]; if (v == null || v === '') { missing = true; return ''; } return String(v); });
  return missing ? null : out;
}

/** The moods to use for a moment, in order, from what he switched on (Calm alone when calm). */
export function moodsFor(moment, { moods = {}, calm = false } = {}) {
  if (calm) return ['calm'];
  const on = (m) => moods[m] !== false;
  return (BY_MOMENT[moment] || ['commander']).filter(on);
}

/**
 * One line for a moment: a mood picked from the moment's moods (by chance among those with lines), a line at or under
 * the intensity (closest levels first), not one said recently. Returns {mood, text} or null.
 */
export function pickLine(bank, moment, { moods = {}, intensity = 3, calm = false, vars = {}, avoid = new Set(), rng = Math.random } = {}) {
  const cands = moodsFor(moment, { moods, calm });
  const linesOf = (mood) => {
    const all = [...(bank?.moods?.[mood]?.[moment] || []), ...(BASE_BANK[mood]?.[moment] || [])]
      .map(([level, text]) => ({ level: Number(level) || 1, text: fill(text, vars) }))
      .filter((l) => l.text && l.level <= intensity);
    const near = all.filter((l) => l.level >= intensity - 2);
    const pool = (near.length ? near : all);
    const fresh = pool.filter((l) => !avoid.has(l.text));
    return fresh.length ? fresh : pool;
  };
  // The first-choice mood most of the time, the others for variety.
  const withLines = cands.map((m) => ({ mood: m, lines: linesOf(m) })).filter((x) => x.lines.length);
  if (!withLines.length) {
    const l = linesOf('commander');
    return l.length ? { mood: 'commander', text: l[pickRng(rng, l.length)].text } : null;
  }
  const r = rng();
  const chosen = withLines.length === 1 || r < 0.5 ? withLines[0] : withLines[1 + pickRng(rng, withLines.length - 1)];
  const line = chosen.lines[pickRng(rng, chosen.lines.length)];
  return { mood: chosen.mood, text: line.text };
}

/** Pushes at a steady rhythm between two moments, at least 4 s apart from what's around them. */
function rhythm(from, to, every) {
  if (!every) return [];
  const out = [];
  for (let t = from + every; t <= to; t += every) out.push(t);
  return out;
}

/**
 * A tendon hold (A14): GET READY for `getReadyS`, a count-in, the hold, a count-out, done. Times are seconds from the
 * Start tap. Every cue that marks a point also has a sound, played instead of the voice when the voice is off, muted
 * or not fetched in time.
 * @returns {{cues: Array<{at:number, kind:string, text?:string, mood?:string, sound?:string}>, getReadyS:number, holdS:number}}
 */
export function holdScript({ getReadyS = 15, holdS = 30, setNo = 1, bank = null, moods = {}, intensity = 3, every = 'steady', calm = false, rng = Math.random, avoid = new Set() } = {}) {
  const opt = { moods, intensity, calm, rng, avoid };
  const cues = [];
  const say = (at, kind, moment, sound) => {
    const l = moment ? pickLine(bank, moment, opt) : null;
    if (l) avoid.add(l.text);
    cues.push({ at, kind, ...(l ? { text: l.text, mood: l.mood } : {}), ...(sound ? { sound } : {}) });
  };
  const g = Math.max(0, Math.round(getReadyS));
  if (g >= 6) say(0, 'ready', 'hold-ready', 'beeps-1');
  else if (g > 0) cues.push({ at: 0, kind: 'ready', sound: 'beeps-1' });
  if (g >= 3) for (const n of [3, 2, 1]) cues.push({ at: g - n, kind: 'count', text: COUNT[n], sound: 'count' });
  say(g, 'go', 'hold-go', 'go');
  // During the hold: the halfway line, the pain limit at 10 s left, and pushes at his rhythm (none in the last 8 s: the
  // count-out is there). Thu 10/22, his words: halfway is only "15 seconds left" or "halfway there", picked at random,
  // nothing added; the "only stop if..." line on its own at about 10 s left.
  const mid = g + Math.round(holdS / 2);
  const limitAt = g + holdS - 10;
  const step = EVERY[every] ?? EVERY.steady;
  const pushes = rhythm(g, g + holdS - 8, step).filter((t) => Math.abs(t - mid) >= 4 && t >= g + 4 && (holdS < 20 || Math.abs(t - limitAt) >= 4));
  if (holdS >= 16) cues.push({ at: mid, kind: 'mid', text: rng() < 0.5 ? `${g + holdS - mid} seconds left.` : 'Halfway there.' });
  if (holdS >= 20) cues.push({ at: limitAt, kind: 'limit', text: 'Only stop if the pain goes over four out of ten.' });
  for (const t of pushes) say(t, 'push', 'hold-push');
  for (const n of [3, 2, 1]) if (holdS - n > 0) cues.push({ at: g + holdS - n, kind: 'count', text: COUNT[n], sound: 'count' });
  say(g + holdS, 'end', 'hold-end', 'beeps-3');
  return { cues: cues.sort((a, b) => a.at - b.at), getReadyS: g, holdS, setNo };
}

const spokenKg = (kg) => `${Number.isInteger(kg) ? kg : String(Math.round(kg * 10) / 10)} kilos`;
const spokenReps = (r) => (!r ? '' : Array.isArray(r) ? (r[0] === r[1] ? `${r[0]} reps` : `${r[0]} to ${r[1]} reps`) : `${r} reps`);

/** "Last set. 60 kilos, 8 to 10 reps." from the set's target (what the screen shows; never a made-up number). */
export function setStartText({ setNo, total, kg = null, reps = null, bodyweight = false, added = null, type = 'normal' }) {
  const head = type === 'warmup' ? 'Warm-up.' : type === 'dropset' ? 'Drop set.' : type === 'failure' ? 'To failure.' : setNo === total && total > 1 ? 'Last set.' : `Set ${setNo}.`;
  const load = bodyweight ? (added ? `Plus ${spokenKg(added)}` : 'Bodyweight') : kg != null ? spokenKg(kg) : '';
  const r = spokenReps(reps);
  return [head, [load, r].filter(Boolean).join(', ')].filter(Boolean).join(' ').replace(/([^.])$/, '$1.');
}

/** His pre-layoff number for a lift (The Comeback's ceilings), by name (`also`: the lift's other names). */
export function ceilingFor(ceilings = [], name = '', also = []) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const names = [name, ...also].map(norm).filter(Boolean);
  return ceilings.find((c) => [c.name, ...(c.also || [])].some((x) => names.includes(norm(x)))) || null;
}

/**
 * A set (A15): the start line with the set's real numbers and one line in the moment's mood, then short pushes at his
 * rhythm until he ticks it (the screen stops the script) or about 45 s have passed. No counts: it can't see reps.
 */
export function setScript({ start, bank = null, moods = {}, intensity = 3, every = 'steady', calm = false, rival = null, rng = Math.random, avoid = new Set(), maxS = SET_PUSH_MAX_S } = {}) {
  const vars = rival ? { rivalKg: rival.kg, rivalReps: rival.reps ?? null, rivalLift: rival.lift || null } : {};
  const opt = { moods, intensity, calm, rng, avoid, vars };
  const first = pickLine(bank, 'set-start', opt);
  if (first) avoid.add(first.text);
  const cues = [{ at: 0, kind: 'start', text: [start, first?.text].filter(Boolean).join(' '), mood: first?.mood || 'commander' }];
  const step = EVERY[every] ?? EVERY.steady;
  // The first push after the start line has had time to finish (about 6 s).
  for (const t of rhythm(0, maxS, step).filter((x) => x >= 6)) {
    const l = pickLine(bank, 'set-push', opt);
    if (!l) continue;
    avoid.add(l.text);
    cues.push({ at: t, kind: 'push', text: l.text, mood: l.mood });
  }
  return { cues };
}

// Words that hand over to Calm at once (he said pain, stop, or anything off).
const CALM_WORDS = /\b(pain|painful|hurts?|hurting|ow+|ouch|stop|enough|dizzy|sick|cramp\w*|sharp|off|wrong|can'?t|injur\w*|tweak\w*|pull(ed)?\s+something)\b/i;
export const callsForCalm = (text) => CALM_WORDS.test(String(text || ''));

/** The text of every cue that speaks (to fetch the clips ahead). */
export const scriptTexts = (script) => [...new Set((script?.cues || []).map((c) => c.text).filter(Boolean))];
