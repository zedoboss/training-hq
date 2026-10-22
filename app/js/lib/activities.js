// Flexibility and combat sports (Thu 10/22, his words: "I wanna do box and kickbox in the future... And proper
// flexibility to actually get flexible, especially for the legs, so I can do high kicks", then "make sure smart
// notifications are also built for this"). His plans live in 'schedule' (ids 'flex' and 'combat', set by the coach's
// activity_plan tool after he answers); the reminders here follow what he actually did:
// - Flexibility · Legs: 10 minutes after a workout ends (warm muscles), or at his evening time; never once it's done
//   that day. The kick test once a week, until a new test is noted.
// - Boxing / kickboxing: before each class (his days and time, or a one-off trial), and "how was it?" after, unless
//   he already logged it.
import { zonedTime, formatHm, addMinutesHm, isoDate } from './time.js';

export const FLEX_ROUTINE = 'flex-legs';
export const FLEX_IDS = new Set(['leg-swing-front-to-back', 'leg-swing-side-to-side', 'kneeling-hip-flexor-stretch', 'lying-hamstring-stretch-strap',
  'butterfly-stretch', 'seated-straddle-stretch', 'lying-figure-4-stretch', 'standing-front-leg-raise-hold', 'standing-side-leg-raise-hold']);
export const COMBAT_IDS = new Set(['boxing-class', 'kickboxing-class', 'muay-thai-class', 'shadow-boxing', 'heavy-bag']);
export const DISCIPLINE = { boxing: 'Boxing', kickboxing: 'Kickboxing', 'muay-thai': 'Muay Thai' };
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** What he did, by day: flexibility done, combat logged, and the end of his last workout of each day. */
export function activityDays({ sessions = [], sets = [], tz }) {
  const doneSets = new Map();
  for (const s of sets) if (s?.done) (doneSets.get(s.sessionId) || doneSets.set(s.sessionId, []).get(s.sessionId)).push(s);
  const flex = new Set(); const combat = new Set(); const workoutEnd = {}; const workoutStart = {}; const dayTypes = {}; const holdsEnd = {};
  // The gym days (Thu 10/22 audit): a stretch, a class or a home neck session doesn't make a day trained.
  const workoutDays = new Set(); const workoutStarts = [];
  for (const x of sessions) {
    if (!x?.startedAt || x.status === 'discarded') continue;
    const day = isoDate(new Date(x.startedAt), tz);
    if (x.kind === 'holds') { if (x.status === 'done' && x.endedAt) (holdsEnd[day] ||= []).push(x.endedAt); continue; }
    const ids = new Set((doneSets.get(x.id) || []).map((s) => (x.exercises || []).find((e) => e.key === s.exKey)?.exerciseId).filter(Boolean));
    const isFlex = x.routineId === FLEX_ROUTINE || [...ids].some((id) => FLEX_IDS.has(id));
    const isCombat = [...ids].some((id) => COMBAT_IDS.has(id));
    if (isFlex && (x.status === 'done' || ids.size)) flex.add(day);
    if (isCombat) combat.add(day);
    const gym = !isFlex && !isCombat && x.routineId !== FLEX_ROUTINE && x.dayType !== 'neck';
    if (gym) { workoutDays.add(day); workoutStarts.push(x.startedAt); }
    if (x.status === 'done' && x.endedAt && gym) {
      workoutEnd[day] = Math.max(workoutEnd[day] || 0, x.endedAt);
      workoutStart[day] = Math.min(workoutStart[day] || Infinity, x.startedAt);
      if (x.dayType) (dayTypes[day] ||= []).push(x.dayType);
    }
  }
  return { flex, combat, workoutEnd, workoutStart, dayTypes, holdsEnd, workoutDays, workoutStarts: workoutStarts.sort((a, b) => a - b) };
}

const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * Today's flexibility and combat reminders. flex: {when: 'after-workout'|'evening', hm, testWeekday}; combat:
 * {discipline, gym, days: [0-6], hm, durationMin, trial}; done: activityDays(); tests: dates of his kick tests.
 */
export function activityReminders({ date, tz, flex = null, combat = null, done = { flex: new Set(), combat: new Set(), workoutEnd: {} }, tests = [], on = () => true }) {
  const out = [];
  if (flex && on('flex')) {
    const hm = flex.hm || '20:00';
    const end = done.workoutEnd[date];
    const at = flex.when === 'after-workout' && end ? end + 10 * 60000 : zonedTime(date, hm, tz);
    out.push({
      id: `flex:${date}`, kind: 'flex', at, url: `#/routine/${FLEX_ROUTINE}`, tag: `flex-${date}`, fixed: false,
      title: 'Stretch time', body: `${end && flex.when === 'after-workout' ? 'Muscles are warm. ' : ''}Flexibility · Legs, about 15 minutes. That's where the high kicks come from.`,
      due: !done.flex.has(date),
    });
    const lastTest = [...tests].sort().at(-1) || null;
    if (weekday(date) === (flex.testWeekday ?? 0) && (!lastTest || lastTest <= addDaysIso(date, -6))) {
      out.push({
        id: `flex-test:${date}`, kind: 'flex', at: zonedTime(date, hm, tz) + 30 * 60000, url: '#/coach', tag: `flex-test-${date}`, fixed: false,
        title: 'Kick test', body: 'Straight standing leg: the highest wall mark your foot reaches, front and side. Tell me the cm.', due: true,
      });
    }
  }
  if (combat && on('combat') && combat.hm && ((combat.days || []).includes(weekday(date)) || combat.trial === date)) {
    const name = DISCIPLINE[combat.discipline] || 'Class';
    const start = zonedTime(date, combat.hm, tz);
    out.push({
      id: `combat:${date}`, kind: 'combat', at: start - 90 * 60000, url: '#/train', tag: `combat-${date}`, fixed: true,
      title: `${name} at ${formatHm(combat.hm)}`, body: `${combat.trial === date ? 'Your trial class' : `${name} today`}${combat.gym ? `, ${combat.gym}` : ''}. Wraps and water.`, due: true,
    });
    out.push({
      id: `combat-after:${date}`, kind: 'combat', at: zonedTime(date, addMinutesHm(combat.hm, (combat.durationMin || 60) + 30), tz), url: '#/coach', tag: `combat-after-${date}`, fixed: false,
      title: `How was ${name.toLowerCase()}?`, body: 'Tell me the minutes and how it felt, and I\'ll log it.', due: !done.combat.has(date),
    });
  }
  return out;
}

function addDaysIso(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
