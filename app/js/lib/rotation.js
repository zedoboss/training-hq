// Rotation (step 4): where today sits in Pull, Push, Legs, Rest.
// Rules (brief decision 15, section 2): the next day type comes from the last completed session, not the calendar.
// A rest day he adds (going out, or the readiness check moving the session) doesn't change the last completed
// session, so the same day type is next afterwards and nothing is made up twice. The rotation's own Rest is the day
// after Legs. Day records live in the synced collection 'days', one per date: {date, rest, sessionTime, readiness}.
import { daysBetween, isoDate } from './time.js';
import { activeBridge } from './history.js';

export const ROTATION = ['pull', 'push', 'legs'];
export const inRotation = (t) => ROTATION.includes(t);
export const LABEL = { pull: 'Pull', push: 'Push', legs: 'Legs', neck: 'Neck' };

/** Next day type after the last completed one (rest days are not sessions). */
export function nextDayType(lastDayType) {
  const i = ROTATION.indexOf(lastDayType);
  return i < 0 ? 'pull' : ROTATION[(i + 1) % ROTATION.length];
}

/** ISO date n days after iso. */
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Last completed rotation session: finished workouts (Training HQ and imported) with a Pull, Push or Legs day type,
 * else the Hevy bridge. Neck and untyped sessions don't move the rotation.
 * @returns {{dayType:string, date:string, sessionId:string|null}|null}
 */
export function lastRotationSession(sessions, rawBridge = null, tz) {
  const own = sessions.filter((s) => s.status === 'done' && s.kind !== 'holds' && inRotation(s.dayType))
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const bridge = activeBridge(rawBridge, sessions)?.lastSessions?.find((s) => inRotation(s.dayType));
  const ownIso = own ? isoDate(new Date(own.startedAt), tz) : null;
  if (own && (!bridge || ownIso >= bridge.date)) return { dayType: own.dayType, date: ownIso, sessionId: own.id };
  return bridge ? { dayType: bridge.dayType, date: bridge.date, sessionId: null } : null;
}

const restOf = (days, date) => days?.[date]?.rest || null;

/** First date from `from` on that isn't marked as a rest day. */
function firstTrainingDate(days, from) {
  let d = from;
  for (let i = 0; i < 60 && restOf(days, d); i++) d = addDays(d, 1);
  return d;
}

/**
 * Today in the rotation.
 * @param {object} o
 * @param {{dayType:string, date:string}|null} o.last  last completed rotation session
 * @param {string} o.today   YYYY-MM-DD
 * @param {object} [o.days]  day records by date ({rest: {reason, at}}; reason 'added', 'moved' or 'rest-holds')
 * @returns {{today: {kind:'train'|'rest'|'done', dayType:string|null, reason:string|null},
 *   next: {dayType:string, date:string}, last: object|null}}
 *   kind 'rest' reasons: 'rotation' (the day after Legs), or the day record's reason.
 */
export function rotationDay({ last, today, days = {} }) {
  const after = nextDayType(last?.dayType);
  if (last && last.date === today) {
    // Trained today. After Legs the next day is the rotation's Rest.
    const from = addDays(today, last.dayType === 'legs' ? 2 : 1);
    return { today: { kind: 'done', dayType: last.dayType, reason: null }, next: { dayType: after, date: firstTrainingDate(days, from) }, last };
  }
  const marked = restOf(days, today);
  if (marked) {
    return { today: { kind: 'rest', dayType: null, reason: marked.reason || 'added' }, next: { dayType: after, date: firstTrainingDate(days, addDays(today, 1)) }, last };
  }
  if (last?.dayType === 'legs' && daysBetween(last.date, today) === 1) {
    return { today: { kind: 'rest', dayType: null, reason: 'rotation' }, next: { dayType: after, date: firstTrainingDate(days, addDays(today, 1)) }, last };
  }
  return { today: { kind: 'train', dayType: after, reason: null }, next: { dayType: after, date: today }, last };
}

/** Day record with an added rest day (or with it taken away again). */
export function withRest(doc, date, reason, at = Date.now()) {
  const base = doc || { date };
  if (!reason) {
    const { rest, ...restOfDoc } = base;
    return { ...restOfDoc, date };
  }
  return { ...base, date, rest: { reason, at } };
}

/** Plain words for a rest day's reason. */
export const REST_TEXT = {
  rotation: 'Rest day in the rotation (the day after Legs)',
  added: 'Rest day you added',
  moved: 'Session moved to tomorrow (check-in)',
  'rest-holds': 'Rest and tendon holds (check-in)',
};

/** Day records as a map by date, from the 'days' collection list. */
export const daysByDate = (list) => Object.fromEntries((list || []).filter((d) => d?.date).map((d) => [d.date, d]));
