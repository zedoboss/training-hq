// Tendon holds: what is due per area, from each area's phase (the owner's tendon note) and the rounds logged.
// A round is 3 holds of ~30 s. Rounds come from hold sessions (kind "holds") and from hold sets inside workouts.
import { isoDate } from './time.js';
import { activeBridge } from './history.js';

/**
 * Thu 10/22 (he did his knee holds with the new "Leg Extension Hold (Machine)" and the app still asked for them): a
 * hold exercise is the hold of its base exercise, and its timed sets are holds whatever their set type.
 */
export const holdBase = (name) => String(name || '').replace(/\s+Hold\b/i, '').replace(/\s+/g, ' ').trim();
export const isHoldSet = (set, ex) => Boolean(set?.done) && (set.type === 'hold' || (/\bhold\b/i.test(ex?.name || '') && (set.durationS || 0) > 0));

/**
 * Rounds per area logged on each date: {areaId: {'YYYY-MM-DD': count}}.
 * Hold sets on an area's hold exercises or on the exercises that load it count for that area.
 * bridge: Hevy history (hold sets marked hold:true), used until Hevy history is imported.
 */
export function roundsByDate(areas, sessions, sets, rawBridge = null) {
  const bridge = activeBridge(rawBridge, sessions);
  // A holds round left open with sets saved counts too (Thu 10/22: the 11:52 AM wrist round, left when he restarted it),
  // unless a finished round of that area the same day already does.
  const dayKey = (s) => `${s.area}|${isoDate(new Date(s.startedAt))}`;
  const doneRounds = new Set(sessions.filter((s) => s.kind === 'holds' && s.status === 'done' && s.startedAt).map(dayKey));
  const holdSessions = sessions.filter((s) => s.status === 'done' || (s.kind === 'holds' && s.status === 'active' && s.startedAt
    && !doneRounds.has(dayKey(s)) && sets.some((x) => x.sessionId === s.id && x.done)));
  const byArea = Object.fromEntries(areas.map((a) => [a.id, {}]));
  const exToArea = new Map();
  for (const a of areas) {
    for (const n of a.loadsArea?.exercises || []) { exToArea.set(n, a.id); exToArea.set(holdBase(n), a.id); }
    for (const h of a.holds || []) { exToArea.set(h.exercise, a.id); exToArea.set(holdBase(h.exercise), a.id); }
  }
  const areaOf = (name) => exToArea.get(name) || exToArea.get(holdBase(name));
  const own = new Set();
  for (const [name, list] of Object.entries(bridge?.exercises || {})) {
    const area = exToArea.get(name);
    if (!area) continue;
    for (const e of list) {
      if (!e.sets?.some((x) => x.hold)) continue;
      const key = `${area}|${e.date}`;
      if (own.has(key)) continue;
      own.add(key);
      byArea[area][e.date] = (byArea[area][e.date] || 0) + 1;
    }
  }
  for (const s of holdSessions) {
    const date = isoDate(new Date(s.startedAt));
    if (s.kind === 'holds' && s.area && byArea[s.area]) {
      byArea[s.area][date] = (byArea[s.area][date] || 0) + 1;
      continue;
    }
    // Hold sets logged inside a workout count as one round for their area.
    const counted = new Set();
    for (const ex of s.exercises || []) {
      const area = areaOf(ex.name);
      if (!area || counted.has(area)) continue;
      if (sets.some((x) => x.sessionId === s.id && x.exKey === ex.key && isHoldSet(x, ex))) {
        byArea[area][date] = (byArea[area][date] || 0) + 1;
        counted.add(area);
      }
    }
  }
  return byArea;
}

/** What is due for one area today. */
export function areaStatus(area, rounds, today) {
  const todayCount = rounds[today] || 0;
  if (area.phase === 'heal') {
    return { kind: 'daily', done: todayCount, target: 2, due: todayCount < 2, text: `${todayCount} / 2 today (morning and evening)` };
  }
  if (area.phase === 'fix' || area.phase === 'maintenance') {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    const since = start.toISOString().slice(0, 10);
    const week = Object.entries(rounds).filter(([d]) => d >= since && d <= today).reduce((n, [, c]) => n + c, 0);
    const target = area.phase === 'fix' ? [3, 4] : [1, 1];
    return { kind: 'weekly', done: week, target, due: week < target[0], today: todayCount, text: `${week} in the last 7 days (aim ${target[0] === target[1] ? target[0] : `${target[0]}-${target[1]}`})` };
  }
  if (area.phase === 'none') return { kind: 'none', done: 0, target: 0, due: false, text: 'No holds unless it starts to hurt' };
  return { kind: 'unscheduled', done: todayCount, target: null, due: false, text: 'Not scheduled yet' };
}

const DAY_NAME = { pull: 'Pull', push: 'Push', legs: 'Legs' };

/** Holds due after this kind of workout, from the tendon data: holds whose timing says "after Push" and so on. */
export function holdsAfter(areas, dayType) {
  const day = DAY_NAME[dayType];
  if (!day) return [];
  const after = new RegExp(`\\bafter ${day}\\b`, 'i');
  return areas.flatMap((a) => (a.holds || []).filter((h) => [...(h.timing || []), h.when || ''].some((t) => after.test(t)))
    .map((h) => ({ area: a.label, exercise: h.exercise, sets: h.sets || 3, seconds: h.seconds || 30 })));
}

/** Pain rule from the tendon note: up to 3-4 out of 10 is fine if it isn't worse the next day. */
export const painOk = (pain) => pain == null || pain <= 4;

// Thu 10/22: the phases in the wording he chose (Phase 1: Relief; Phase 2: Fix it for good; Maintenance). The key 'heal'
// stays in the data.
export const PHASE_TEXT = {
  heal: 'Relief phase: 3 holds twice a day, morning and evening, every day until the pain goes away (about 1-2 weeks)',
  fix: 'Fix phase: 3-4 times a week for at least 4-8 weeks',
  maintenance: 'Maintenance: 5-10 minutes after every workout, or one day a week',
  none: 'Nothing reported',
  unknown: 'Phase not set yet',
};

/**
 * A tendon area moved to another phase (the coach's tendon_phase, or a switch he planned): the holds follow it (outside
 * the heal phase a hold with no training-day timing moves to rest days), and the change is logged with the date.
 */
export function withPhase(area, phase, { date, reason = '', pain = null } = {}) {
  const days = (h) => /\bafter (Pull|Push|Legs)\b|\brest days?\b/i.test([...(h.timing || []), h.when || ''].join(' | '));
  const holds = phase === 'heal' ? area.holds : (area.holds || []).map((h) => (days(h) ? h : { ...h, timing: ['rest days'], when: null, whenBefore: h.when ?? null }));
  const phaseLog = [...(area.phaseLog || []), { date, from: area.phase, to: phase, reason, ...(pain != null ? { pain } : {}) }].slice(-30);
  return { ...area, phase, phaseSince: date, holds, phaseLog };
}

/**
 * Switches he planned ahead (Thu 10/22, his words: "phase one for one week... then we switch to phase two"), due on
 * `date` (YYYY-MM-DD) or before: the areas as they are after the switch, the plan marked done.
 */
export function duePhasePlans(areas = [], date) {
  return areas.filter((a) => a?.phasePlan && !a.phasePlan.done && a.phasePlan.on <= date)
    .map((a) => ({ ...withPhase(a, a.phasePlan.next, { date: a.phasePlan.on, reason: `his plan of ${a.phasePlan.from}${a.phasePlan.said ? `: "${a.phasePlan.said}"` : ''}` }), phasePlan: { ...a.phasePlan, done: true, doneOn: date } }));
}

/** Default clock times for hold reminders (Settings notify.holdsMorning / holdsEvening); he confirms them once. */
export const HOLD_TIMES = { morning: '07:30', evening: '19:30' };

const timingOf = (h) => [...(h.timing || []), h.when || ''].join(' | ');
const isAfter = (h, dayType) => DAY_NAME[dayType] && new RegExp(`\\bafter ${DAY_NAME[dayType]}\\b`, 'i').test(timingOf(h));
const onRestDays = (h) => /\brest days?\b/i.test(timingOf(h));

/**
 * Today's hold plan per area (decisions 17 and 18, the tendon data's timing):
 * - Holds timed "after Push" (Pull, Legs) go in an 'after' slot on that day.
 * - Holds timed "rest days" go in a 'rest' slot on a rest day (reminded at the morning time).
 * - Heal phase (twice a day, morning and evening): a gym hold after today's session counts as one of the two
 *   (decision 18); the other, and both on every other day, are the area's home hold.
 * Rounds already logged today tick slots off in order.
 * @param {object} o
 * @param {Array} o.areas         tendon area docs
 * @param {'train'|'done'|'rest'} o.dayKind  today in the rotation
 * @param {string|null} o.dayType today's session (planned or done); null on a rest day
 * @param {object} [o.roundsToday] {areaId: rounds logged today}
 * @param {{morning:string, evening:string}} [o.times]
 * @param {object} [o.restChoices] {areaId: {today, last}} from restChoices(): his rest-day answer (A2)
 * @param {string|null} [o.nextSession] on a rest day, tomorrow's session (sessionTomorrow in rotation.js)
 * @param {string|null} [o.carriedFrom] on a training day, yesterday's date when it was a rest day (afterRestDay in rotation.js)
 * @param {object} [o.roundsYesterday] {areaId: rounds logged yesterday}
 * @returns {Array<{area:string, label:string, slot:'after'|'rest'|'morning'|'evening', time:string|null,
 *   holdIndex:number|'other', exercise:string, where:string|null, done:boolean, ask?:boolean, choice?:string|null,
 *   skipped?:boolean, last?:object|null}>}
 */
export function holdSlots({ areas, dayKind, dayType = null, roundsToday = {}, times = HOLD_TIMES, restChoices = {}, nextSession = null, carriedFrom = null, roundsYesterday = {} }) {
  const out = [];
  const trainType = dayKind === 'rest' ? null : dayType;
  for (const a of areas || []) {
    const holds = a.holds || [];
    if (!holds.length || a.phase === 'none' || a.phase === 'unknown') continue;
    const slots = [];
    const add = (slot, i) => slots.push({ area: a.id, label: a.label, slot, time: slot === 'morning' || slot === 'rest' ? times.morning : slot === 'evening' ? times.evening : null, holdIndex: i, exercise: holds[i].exercise, where: holds[i].where || null });
    if (a.phase === 'heal') {
      const gym = trainType ? holds.findIndex((h) => isAfter(h, trainType)) : -1;
      const home = holds.findIndex((h) => h.where === 'home');
      const homeIdx = home >= 0 ? home : holds.findIndex((h, i) => i !== gym);
      if (gym >= 0) add('after', gym); else if (homeIdx >= 0) add('morning', homeIdx);
      if (homeIdx >= 0) add('evening', homeIdx); else if (gym >= 0) add('evening', gym);
    } else {
      // One round covers the area for the day: the first matching hold of the slot leads, the rest follow in the round.
      const after = trainType ? holds.findIndex((h) => isAfter(h, trainType)) : -1;
      const rest = !trainType ? holds.findIndex(onRestDays) : -1;
      // Sat 10/24: the gym hold not asked on yesterday's rest day (a session was next) comes after today's session,
      // unless he answered yesterday, did a round then, or his own hold stood (it was asked then).
      const rc0 = restChoices[a.id] || {};
      const prev = rc0.last?.choice === 'skip' ? rc0.lastPlan : rc0.last;
      const carried = after < 0 && trainType && carriedFrom ? holds.findIndex(onRestDays) : -1;
      const carry = carried >= 0 && holds[carried].where !== 'home' && rc0.last?.date !== carriedFrom && !(roundsYesterday[a.id] > 0) && prev?.choice !== 'other';
      if (after >= 0) add('after', after);
      else if (carry) add('after', carried);
      else if (rest >= 0) add('rest', rest);
      // The round's other holds on the same timing (bench hold, then the cable raise hold, after Push).
      if (slots[0]) slots[0].also = holds.filter((h, i) => i !== slots[0].holdIndex && (after >= 0 ? isAfter(h, trainType) : onRestDays(h))).map((h) => h.exercise);
      // Rest day (his answer Sun 10/18): he is asked each rest day: the gym for this hold, another hold he names, or
      // skip today. Until he answers, his last gym/other answer stands (a skip counts for its own day only).
      if (after < 0 && rest >= 0 && slots[0]) {
        const rc = restChoices[a.id] || {};
        const pick = rc.today || (rc.last?.choice === 'skip' ? rc.lastPlan : rc.last) || null;
        // Sat 10/24 (Fri 10/23: at 2:50 PM the coach put the shoulder after Pull on Saturday, from 3:41 PM the holds asked
        // him to go to the gym for it on his rest day): a session tomorrow takes the gym hold, so nothing is asked today.
        // Still here: his answer today, a round done today, his own hold standing.
        if (nextSession && !rc.today && !(roundsToday[a.id] > 0) && pick?.choice !== 'other' && holds[rest].where !== 'home') continue;
        Object.assign(slots[0], { ask: !rc.today, choice: pick?.choice || null, skipped: rc.today?.choice === 'skip', last: rc.last || null, restHold: holds[rest].exercise });
        if (pick?.choice === 'other' && pick.holdName) Object.assign(slots[0], { holdIndex: 'other', exercise: pick.holdName, where: null, also: [] });
      }
    }
    const done = roundsToday[a.id] || 0;
    slots.forEach((s, i) => out.push({ ...s, done: i < done, ...(i < done && s.ask ? { ask: false } : {}) }));
  }
  const ORDER = { morning: 0, rest: 1, after: 2, evening: 3 };
  return out.sort((x, y) => ORDER[x.slot] - ORDER[y.slot]);
}

/** Holds of an area that belong to one slot (the round's other holds on the same timing, e.g. bench + cable raise after Push). */
export function slotHolds(area, slot, dayType) {
  const holds = area.holds || [];
  if (slot === 'after') return holds.map((h, i) => ({ h, i })).filter(({ h }) => isAfter(h, dayType));
  if (slot === 'rest') return holds.map((h, i) => ({ h, i })).filter(({ h }) => onRestDays(h));
  return [];
}

/**
 * How long a round takes on the hold timer: every hold with its GET READY, his rest between holds (Tue 10/20: the
 * coach guessed "3 minutes" for 3 × 30 s with 15 s get-ready and 2:00 rest, about 6:15).
 */
export const roundSeconds = ({ holds = 3, seconds = 30, getReadyS = 15, restS = 120 } = {}) => holds * (getReadyS + seconds) + Math.max(0, holds - 1) * restS;
export const roundLength = (sec) => `about ${Math.max(1, Math.round(sec / 60))} min`;

/** The answers on a rest day (A2): the gym for the rest-day hold, another hold he names, or skip today. */
export const REST_CHOICES = [['gym', 'Gym, just for this hold'], ['other', 'Another hold'], ['skip', 'Skip today']];

/** Areas he is asked about on a rest day: a hold timed "rest days" outside the heal phase (today: the shoulder). */
export const restAskAreas = (areas) => (areas || []).filter((a) => a.phase !== 'heal' && a.phase !== 'none' && a.phase !== 'unknown' && (a.holds || []).some(onRestDays));

/**
 * His rest-day answers per area, from the day records (days[date].restHolds[areaId] = {choice, holdName, at, by}):
 * today's answer, the last one before today, and the last gym/other one (what stands when the last was a skip).
 * @returns {{[areaId:string]: {today:object|null, last:object|null, lastPlan:object|null}}}
 */
export function restChoices(days, date) {
  const out = {};
  const dates = Object.keys(days || {}).filter((d) => d <= date && days[d]?.restHolds).sort().reverse();
  for (const d of dates) {
    for (const [area, c] of Object.entries(days[d].restHolds)) {
      if (!c?.choice) continue;
      const o = (out[area] ||= { today: null, last: null, lastPlan: null });
      if (d === date) { o.today = { ...c, date: d }; continue; }
      if (!o.last) o.last = { ...c, date: d };
      if (!o.lastPlan && c.choice !== 'skip') o.lastPlan = { ...c, date: d };
    }
  }
  return out;
}

/** Day record with his rest-day answer for one area. */
export function withRestChoice(doc, date, areaId, { choice, holdName = null }, by = 'app', at = Date.now()) {
  const base = doc || { date };
  const entry = { choice, at, by, ...(choice === 'other' ? { holdName: String(holdName || '').trim() } : {}) };
  return { ...base, date, restHolds: { ...(base.restHolds || {}), [areaId]: entry } };
}

/** One line for his answer: "gym for Lateral Raise (Cable)", "his own hold: wall press", "skipped today". */
export function restChoiceText(c, area) {
  if (!c) return 'not answered';
  if (c.choice === 'skip') return 'skipped';
  if (c.choice === 'other') return `his own hold: ${c.holdName}`;
  const h = (area?.holds || []).find(onRestDays);
  return `the gym for the ${h ? h.exercise : 'rest-day'} hold`;
}

/** Slots still to do today (a skipped slot is not open). */
export const openSlots = (slots) => slots.filter((x) => !x.done && !x.skipped);
