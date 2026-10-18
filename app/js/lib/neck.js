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

/** His answer: a place (planned from now on) or 'not-yet' (asked again in a week). */
export function answerNeck(neck, answer, today) {
  const base = { planned: false, answers: [], ...(neck || {}) };
  const answers = [...base.answers, { date: today, answer }].slice(-20);
  if (answer === 'not-yet') return { ...base, lastAskedOn: today, answers };
  return { ...base, planned: true, place: answer, on: today, lastAskedOn: today, answers };
}

/** Neck is due today by his plan: after that day's session, or on a rest day. */
export function neckToday(neck, dayKind, dayType) {
  if (!neck?.planned) return false;
  if (neck.place === 'rest-day') return dayKind === 'rest';
  return dayKind !== 'rest' && neck.place === `after-${dayType}`;
}

/** "Neck after Push today" / "Neck today (rest day)": the Train card and finish screen line. */
export function neckTodayText(place) {
  if (place === 'rest-day') return 'Neck today (rest day)';
  const label = placeLabel(place);
  return label ? `Neck ${label.replace(/^After /, 'after ')} today` : 'Neck today';
}

/** A Neck session was started or done on this date (local day of startedAt). */
export const neckDoneOn = (sessions, date, dayOf) => sessions.some((s) => s.dayType === 'neck' && s.status !== 'discarded' && s.startedAt && dayOf(s.startedAt) === date);
