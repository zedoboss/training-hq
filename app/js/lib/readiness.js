// Readiness check-in (step 4): the owner's decision table (brief section 2, a draft until he confirms it in the app,
// decision 23). Pure helpers: which areas today's session loads, the rule that decides, and how "lighter" changes
// a target. The rules are applied exactly as written; the app adds no advice of its own.
import { loadable } from './targets.js';
import { coversOf, isBlockType } from './rotation.js';

/** The adjustable numbers of the table. Defaults are the draft's own wording (brief section 2). */
export const DEFAULT_PARAMS = {
  weeksBack: 1, // "drop the affected exercises to the previous week's column"
  week1Pct: 20, // "in Week 1, 20% under the target"
  repsShort: 2, // "stop 2 reps short of the rep target"
  moveLimit: 1, // "if the session was already moved yesterday, swap to Rest + tendon holds instead"
};

export const paramsOf = (table) => ({ ...DEFAULT_PARAMS, ...(table?.params || {}) });

/** Tendon areas asked about at the check-in: every area with holds in its plan (phase other than none). */
export const askedAreas = (areas) => (areas || []).filter((a) => a.kind === 'area' && a.phase && a.phase !== 'none' && a.holds?.length);

/** Areas today's session loads: an exercise in the session is on the area's "loads this area" list. */
export function loadedAreas(areas, exerciseNames) {
  const names = new Set(exerciseNames || []);
  return askedAreas(areas).filter((a) => (a.loadsArea?.exercises || []).some((n) => names.has(n))).map((a) => a.id);
}

/** Exercises of the session that load any of the given areas. */
export function exercisesLoading(areas, ids, exerciseNames) {
  const set = new Set((areas || []).filter((a) => ids.includes(a.id)).flatMap((a) => a.loadsArea?.exercises || []));
  return (exerciseNames || []).filter((n) => set.has(n));
}

/** Working-area soreness keys for a day type (Legs: L and B; Pull: B; Push: none, in the draft). */
// Tue 11/10: an Upper/Lower day checks the areas of the day types it holds (Upper: Pull's and Push's; Lower: Legs'), so
// the check-in asks as much as before.
// Any day type of a split the coach built checks the areas of the days it covers.
const holdsTypes = (t) => (isBlockType(t) ? coversOf(t) : null);
export const workingKeys = (table, dayType) => (table?.workingArea?.[dayType] && !holdsTypes(dayType) ? table.workingArea[dayType]
  : holdsTypes(dayType) ? [...new Set([...(table?.workingArea?.[dayType] || []), ...holdsTypes(dayType).flatMap((t) => table?.workingArea?.[t] || [])])] : []);

/**
 * The rule that decides (first match from the top).
 * @param {object} o
 * @param {object} o.table        readiness table doc
 * @param {{T:Object<string,number>, W:Object<string,boolean>, L?:number, B?:number, E:number}} o.ratings
 * @param {string|null} o.dayType today's session (null on a rest day)
 * @param {string[]} o.loaded     area ids today's session loads
 * @param {boolean} [o.movedYesterday]  the session was already moved yesterday
 * @returns {{rule:number, action:'train'|'lighter-area'|'lighter-all'|'move'|'rest-holds'|'rest',
 *   lighterAreas:string[], easeHolds:string[], why:string}}
 */
export function decide({ table, ratings, dayType, loaded = [], movedYesterday = false }) {
  const T = ratings.T || {};
  const W = ratings.W || {};
  const E = ratings.E ?? 2;
  const ids = [...new Set([...Object.keys(T), ...Object.keys(W)])];
  // W = yes or T = 3 anywhere: the holds for that area are done with less weight or less effort (his note).
  const easeHolds = ids.filter((id) => W[id] === true || T[id] === 3);
  const out = (rule, action, why, lighterAreas = []) => ({ rule, action, lighterAreas, easeHolds, why });

  if (!dayType) return out(0, 'rest', easeHolds.length ? 'Rest day: holds eased for the sore area' : 'Rest day: holds as planned');

  const worse = loaded.filter((id) => W[id] === true || T[id] === 3);
  if (worse.length) return out(1, 'rest-holds', 'Tendon worse than yesterday or above the limit, and today loads it', worse);
  const moveOr = (rule, why) => (movedYesterday ? out(rule, 'rest-holds', `${why}; already moved yesterday`) : out(rule, 'move', why));
  if (E === 0) return moveOr(2, 'Energy 0');
  const sore = Math.max(0, ...workingKeys(table, dayType).map((k) => ratings[k] ?? 0));
  if (sore === 3) return moveOr(3, 'Working-area soreness 3');
  const atLimit = loaded.filter((id) => T[id] === 2);
  if (atLimit.length) return out(4, 'lighter-area', 'Tendon at the limit (2) and today loads it', atLimit);
  if (sore === 2 || E === 1) return out(5, 'lighter-all', sore === 2 ? 'Working-area soreness 2' : 'Energy 1');
  return out(6, 'train', 'All ratings 0-1 and energy 2-3');
}

/** Plain words for an action, for the result card and the Train card. */
export const ACTION_TEXT = {
  train: 'Train as planned.',
  'lighter-area': 'Go lighter on the exercises that load the sore area. Everything else as planned. Holds as scheduled.',
  'lighter-all': 'Go lighter on the whole session.',
  move: 'Move the session to tomorrow.',
  'rest-holds': 'Swap to rest and tendon holds, with less weight or less effort. The rotation shifts by one day.',
  rest: 'Rest day.',
};

/**
 * "Lighter" for one programme exercise: the previous week's column (week 1: X% under the target), the same number
 * of sets, reps short of the target. `targetAt(week)` gives the normal target for a week (targets.js targetFor).
 * @returns {{kg:number|null, reps:[number,number]|null, sets:number, why:string}}
 */
export function lighterTarget({ week, targetAt, params = DEFAULT_PARAMS, barKg = null, smallestPlate = 1.25 }) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const now = targetAt(week);
  const back = Math.max(1, (week || 1) - p.weeksBack);
  let kg; let why;
  // Thu 10/22 (decision 33): targets are one step over the last load, so an earlier column often gives the same number;
  // then lighter is the week 1 rule (X% under), so it is always lighter.
  const earlier = (week || 1) > 1 ? targetAt(back).kg : null;
  if (earlier != null && (now.kg == null || earlier < now.kg)) {
    kg = earlier;
    why = `lighter (check-in): week ${back} column`;
  } else if ((week || 1) > 1) {
    kg = now.kg == null ? null : loadable(now.kg * (1 - p.week1Pct / 100), { barKg, smallestPlate });
    why = `lighter (check-in): ${p.week1Pct}% under`;
  } else {
    kg = now.kg == null ? null : loadable(now.kg * (1 - p.week1Pct / 100), { barKg, smallestPlate });
    why = `lighter (check-in): week 1, ${p.week1Pct}% under`;
  }
  if (kg != null && now.kg != null && kg > now.kg) kg = now.kg;
  return { kg, reps: shortReps(now.reps, p.repsShort), sets: now.sets, why };
}

/** A rep target with reps taken off ([8, 10] - 2 = [6, 8]); never below 1. */
export const shortReps = (reps, n) => (Array.isArray(reps) ? reps.map((r) => Math.max(1, r - n)) : reps);

/** "Lighter" for an exercise without a programme row: X% under its planned weight (the draft's week 1 rule). */
export function lighterKg(kg, { params = DEFAULT_PARAMS, barKg = null, smallestPlate = 1.25 } = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  return kg == null ? null : loadable(kg * (1 - p.week1Pct / 100), { barKg, smallestPlate });
}

/** Ratings complete enough to decide: every asked area has T and W, the working keys and E are set. */
export function complete(ratings, areaIds, keys) {
  return areaIds.every((id) => Number.isInteger(ratings.T?.[id]) && typeof ratings.W?.[id] === 'boolean')
    && keys.every((k) => Number.isInteger(ratings[k])) && Number.isInteger(ratings.E);
}

/**
 * His words to a 0-3 rating (Thu 11/5, his words at a check-in: "I cant rate it... somewhat sore and a tiny tiny
 * pain"): the app proposes the number and he confirms it (the screen pre-selects it; the coach asks "that's a 1, right?").
 * key: T (tendon area), L (legs), B (back) or E (energy); levels: his table's wording for 0-3, matched too.
 * Qualifiers win over the plain word: "somewhat sore" is 1, not 2. A pain number out of 10 follows the T scale (his
 * table: 1-2/10 slight, 3-4/10 at the limit, 5+/10 above). Returns {rating, level, why} or null when the words don't say.
 */
export function ratingFromWords(text, key, levels = []) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9%/ ]+/g, ' ').replace(/\s+/g, ' ')} `;
  if (!t.trim()) return null;
  const out = (rating, why) => ({ rating, level: levels[rating] ?? null, why });
  if (key === 'E') {
    if (/\b(drained|exhausted|dead|wrecked|empty|no energy|destroyed|shattered)\b/.test(t)) return out(0, 'drained');
    if (/\b(low|tired|sleepy|meh|sluggish|not great|so so|kind of tired|bit tired|a little tired)\b/.test(t)) return out(1, 'low');
    if (/\b(high|great|amazing|pumped|energi[sz]ed|fired up|full of energy|strong|awesome)\b/.test(t)) return out(3, 'high');
    if (/\b(normal|ok|okay|fine|good|alright|decent|average|usual)\b/.test(t)) return out(2, 'normal');
    return null;
  }
  const n = /\b(10|[0-9])\s*(\/\s*10|out of 10)\b/.exec(t);
  if (n) { const v = Number(n[1]); return out(v === 0 ? 0 : v <= 2 ? 1 : v <= 4 ? 2 : 3, `${v}/10`); }
  if (/\b(not sore|no pain|no soreness|nothing|none|fine|all good|good to go|feels good|feel good|perfect|zero)\b/.test(t) && !/\b(but|except|little|bit|slight|tiny)\b/.test(t)) return out(0, 'none');
  if (/\b(very|really|extremely|super|so) (sore|painful|stiff|tight)\b|\b(hurts to move|can t move|cant move|can t walk|cant walk|a lot|severe|sharp|terrible|awful|killing)\b/.test(t)) return out(3, 'very sore');
  if (/\b(slight\w*|little|bit|tiny|somewhat|mild\w*|minor|barely|kinda|kind of|5%|a touch|light\w*)\b/.test(t)) return out(1, 'slight');
  if (/\b(sore|soreness|hurts?|painful|pain|stiff|tight|aches?|aching|clearly|affects)\b/.test(t)) return out(2, 'clearly sore');
  if (/\b(no|not)\b/.test(t)) return out(0, 'none');
  return null;
}
