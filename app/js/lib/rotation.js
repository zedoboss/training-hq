// Rotation (step 4): where today sits in Pull, Push, Legs, Rest.
// Rules (brief decision 15, section 2): the next day type comes from the last completed session, not the calendar.
// A rest day he adds (going out, or the readiness check moving the session) doesn't change the last completed
// session, so the same day type is next afterwards and nothing is made up twice. The rotation's own Rest comes after
// three training days in a row (Tue 10/20, his words: "3 then 1 rest"), whatever the day types were; the day type
// carries on where it left off. Day records live in the synced collection 'days', one per date: {date, rest,
// sessionTime, readiness}.
import { daysBetween, isoDate, hmOf } from './time.js';
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
 * @returns {{dayType:string, date:string, sessionId:string|null, streak:number}|null}  streak: training days in a row
 *   up to and including that day
 */
export function lastRotationSession(sessions, rawBridge = null, tz) {
  const mine = sessions.filter((s) => s.status === 'done' && s.kind !== 'holds' && inRotation(s.dayType)).sort((a, b) => b.startedAt - a.startedAt);
  const own = mine[0];
  const bridge = activeBridge(rawBridge, sessions)?.lastSessions?.find((s) => inRotation(s.dayType));
  const ownIso = own ? isoDate(new Date(own.startedAt), tz) : null;
  if (own && (!bridge || ownIso >= bridge.date)) {
    const dates = new Set(mine.map((s) => isoDate(new Date(s.startedAt), tz)));
    let streak = 1;
    while (dates.has(addDays(ownIso, -streak))) streak++;
    return { dayType: own.dayType, date: ownIso, sessionId: own.id, streak };
  }
  return bridge ? { dayType: bridge.dayType, date: bridge.date, sessionId: null, streak: 1 } : null;
}

/** The rotation's own rest comes after three training days in a row (3 on, 1 off). */
export const restAfter = (last) => !!last && (last.streak || 1) >= 3;

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
    // Trained today. After three days in a row the next day is the rotation's Rest.
    const from = addDays(today, restAfter(last) ? 2 : 1);
    return { today: { kind: 'done', dayType: last.dayType, reason: null }, next: { dayType: after, date: firstTrainingDate(days, from) }, last };
  }
  const marked = restOf(days, today);
  if (marked) {
    return { today: { kind: 'rest', dayType: null, reason: marked.reason || 'added' }, next: { dayType: after, date: firstTrainingDate(days, addDays(today, 1)) }, last };
  }
  if (restAfter(last) && daysBetween(last.date, today) === 1) {
    return { today: { kind: 'rest', dayType: null, reason: 'rotation' }, next: { dayType: after, date: firstTrainingDate(days, addDays(today, 1)) }, last };
  }
  return { today: { kind: 'train', dayType: after, reason: null }, next: { dayType: after, date: today }, last };
}

/**
 * On a rest day, the next session's day type when that session is tomorrow, else null (Sat 10/24: a weekly gym hold
 * isn't asked on a rest day before a training day; he's at the gym tomorrow and it goes after that session).
 */
export const sessionTomorrow = (rot, date) => (rot?.today?.kind === 'rest' && rot.next?.date === addDays(date, 1) ? rot.next.dayType : null);

/**
 * On a training day, yesterday's date when yesterday was a rest day (so today's session was its next one), else null:
 * the weekly gym hold not asked then comes after today's session (holdSlots carriedFrom). Once today's session is done
 * the rotation's own rest is read from the type (the day after a rest is the first of the rotation).
 */
export const afterRestDay = (rot, date, days = {}) => {
  const k = rot?.today?.kind;
  const y = addDays(date, -1);
  const rest = k === 'train' ? !!rot.last && rot.last.date < y && rotationDay({ last: rot.last, today: y, days }).today.kind === 'rest'
    : k === 'done' && (rot.last?.streak || 1) === 1 && (!!restOf(days, y) || rot.last.dayType === nextDayType('legs'));
  return rest ? y : null;
};

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
  rotation: 'Rest day in the rotation (three days on, one off)',
  added: 'Rest day you added',
  moved: 'Session moved to tomorrow (check-in)',
  'rest-holds': 'Rest and tendon holds (check-in)',
};

/** Day records as a map by date, from the 'days' collection list. */
export const daysByDate = (list) => Object.fromEntries((list || []).filter((d) => d?.date).map((d) => [d.date, d]));

/** Day record with a session time ("HH:MM", 24-hour) set, or cleared with null. */
export function withTime(doc, date, hm, at = Date.now()) {
  const base = doc || { date };
  if (!hm) {
    const { sessionTime, timeSetAt, ...rest } = base;
    return { ...rest, date };
  }
  return { ...base, date, sessionTime: hm, timeSetAt: at };
}

/**
 * The usual start time: the middle one of the last 10 rotation sessions' start times (local clock), "HH:MM", or
 * null. Used to prefill the time picker; he always sets the time himself (decision 15).
 */
export function usualStart(sessions, tz, n = 10) {
  const hms = sessions.filter((s) => s.status === 'done' && s.kind !== 'holds' && inRotation(s.dayType) && s.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, n).map((s) => hmOf(new Date(s.startedAt), tz)).sort();
  if (!hms.length) return null;
  const mid = hms[Math.floor((hms.length - 1) / 2)];
  // Round to 5 minutes.
  const [h, m] = mid.split(':').map(Number);
  const r = Math.round((h * 60 + m) / 5) * 5 % 1440;
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}
