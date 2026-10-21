// Neck (brief section 6, decision 14): a routine now, a place in the rotation later. Until he picks one, he is asked
// about once a week. His answers live in the synced doc schedule/neck: {planned, place, on, lastAskedOn, answers}.
import { addDays } from './rotation.js';

export const NECK_PLACES = [
  ['after-pull', 'After Pull'],
  ['after-push', 'After Push'],
  ['after-legs', 'After Legs'],
  ['rest-day', 'On the rest day'],
];
export const placeLabel = (p) => NECK_PLACES.find(([k]) => k === p)?.[1] ?? null;

/** Show the "still unplanned" card: not planned and not answered in the last 7 days. */
export const neckAsk = (neck, today) => !neck?.planned && (!neck?.lastAskedOn || neck.lastAskedOn <= addDays(today, -7));

/** His answer: a place (planned from now on) or 'not-yet' (asked again in a week); where: 'gym' or 'home'. */
export function answerNeck(neck, answer, today, { where = null, homeGear = null } = {}) {
  const base = { planned: false, answers: [], ...(neck || {}) };
  const answers = [...base.answers, { date: today, answer, ...(where ? { where } : {}) }].slice(-20);
  const extra = { ...(where ? { where } : {}), ...(homeGear ? { homeGear: String(homeGear).slice(0, 160) } : {}) };
  if (answer === 'not-yet') return { ...base, ...extra, lastAskedOn: today, answers };
  return { ...base, ...extra, planned: true, place: answer, on: today, lastAskedOn: today, answers };
}

// At home he has no plates (Wed 10/21, his words: "at home I have no plates... maybe with a water bottle"). Water by
// volume: 1 ml weighs 1 g, so a bottle filled to the right line is the load (the bottle itself adds about 20-40 g).
// Steps of 50 ml, so the 30% cap can be kept exactly.
export const HOME_HOW = 'Lie with your head just off the edge of the bed or a bench, a folded towel between the bottle and your head, one hand steadying the bottle. Slow and controlled, no jerking; stop at any neck pain.';
export function bottleFor(kg) {
  const ml = Math.max(100, Math.round((Number(kg) || 0) * 1000 / 50) * 50);
  const size = ml <= 500 ? '0.5 L' : ml <= 1000 ? '1 L' : ml <= 1500 ? '1.5 L' : '2 L';
  return { ml, text: `a ${size} water bottle filled to ${ml} ml (${(ml / 1000).toFixed(ml % 100 ? 2 : 1)} kg)` };
}

/** A neck session at home: each exercise says which bottle and how; the session's place is Home. */
export function withHomeNotes(session, sets, neck) {
  if (session?.dayType !== 'neck' || neck?.where !== 'home') return session;
  const exercises = session.exercises.map((e) => {
    const s = sets.find((x) => x.exKey === e.key && x.type !== 'warmup');
    const kg = s?.target?.kg ?? s?.kg ?? null;
    const line = `At home: ${kg ? bottleFor(kg).text : 'a water bottle, filled to the weight'}. ${HOME_HOW}`;
    return { ...e, notes: e.notes ? `${line}\n${e.notes}` : line };
  });
  return { ...session, exercises, gym: 'Home' };
}

/** Neck is due today by his plan: after that day's session, or on a rest day. */
export function neckToday(neck, dayKind, dayType) {
  if (!neck?.planned) return false;
  if (neck.place === 'rest-day') return dayKind === 'rest';
  return dayKind !== 'rest' && neck.place === `after-${dayType}`;
}

/** "Neck after Push today" / "Neck today (rest day)": the Train card and finish screen line ("at home" when so). */
export function neckTodayText(place, where = null) {
  const home = where === 'home' ? ', at home' : where === 'gym' ? ', at the gym' : '';
  if (place === 'rest-day') return `Neck today (rest day${home})`;
  const label = placeLabel(place);
  return label ? `Neck ${label.replace(/^After /, 'after ')} today${home}` : `Neck today${home}`;
}

/** A Neck session was started or done on this date (local day of startedAt). */
export const neckDoneOn = (sessions, date, dayOf) => sessions.some((s) => s.dayType === 'neck' && s.status !== 'discarded' && s.startedAt && dayOf(s.startedAt) === date);
