// His waking day (Sat 10/24, his words: "I still haven't slept... the body registers it as one day"): food and
// supplements after midnight, before he has slept, count toward the day he woke up on, not the calendar date.
// Up to 6:00 AM a moment belongs to the day before, unless something says he slept and got up since midnight:
// sleep logged for the night to this date (woken by then), Apple Health's wake time, or a workout started.
// From 6:00 AM it is the calendar date, unless he's still up from the night (Tue 10/27: up all night, a meal at 6:31 AM
// went on the new day): to noon, while his stretch awake began before 3:00 AM (no 4 hours without a sign of him that
// ended from 3:00 AM on), it is still the day before.
import { isoDate, hmOf, zonedTime } from './time.js';
import { addDays } from './rotation.js';

/** Before this clock time, a moment with no sign of sleep belongs to the day before. */
export const WAKING_CUTOFF_HM = '06:00';
/** From WAKING_CUTOFF_HM to this, a night he's still up from (signs, no sleep gap yet) belongs to the day before. */
export const STILL_UP_UNTIL_HM = '12:00';
/** A night's sleep: this many hours with no sign of him, the gap ending from WAKE_FROM_HM (his bedtimes run to ~4 AM). */
export const SLEEP_GAP_H = 4;
export const WAKE_FROM_HM = '03:00';

/** When his stretch awake that includes `t` began: back over every gap shorter than gapH hours. signs sorted. */
export function awakeSince(signs, t, gapH = SLEEP_GAP_H) {
  let s = t;
  for (let i = signs.length - 1; i >= 0; i--) {
    if (signs[i] >= s) continue;
    if (s - signs[i] >= gapH * 3600000) break;
    s = signs[i];
  }
  return s;
}

/**
 * The day food and supplements at `at` count toward. sleepLog: the sleep-log doc for the night to that calendar date
 * (id = date); health: the Apple Health doc for that date; sessions: his sessions (holds rounds don't count as up);
 * signs: the times of every sign of him up to `at`, sorted (or a function giving them, called only from 6:00 AM to noon).
 */
export function wakingDay(at, { tz, sleepLog = null, health = null, sessions = [], signs = null } = {}) {
  const date = isoDate(new Date(at), tz);
  const hm = hmOf(new Date(at), tz);
  if (hm >= STILL_UP_UNTIL_HM) return date;
  if (hm >= WAKING_CUTOFF_HM && !stillUpFromNight(typeof signs === 'function' ? signs() : signs, at, date, tz)) return date;
  const woke = (w) => typeof w === 'number' && w <= at;
  if (sleepLog && !sleepLog.deleted && (sleepLog.wake == null || woke(sleepLog.wake))) return date;
  if (woke(health?.sleep?.wake) && isoDate(new Date(health.sleep.wake), tz) === date) return date;
  if ((sessions || []).some((s) => s && s.kind !== 'holds' && s.startedAt && s.startedAt <= at && isoDate(new Date(s.startedAt), tz) === date)) return date;
  return addDays(date, -1);
}

/** Past 6:00 AM: his stretch awake at `at` began before WAKE_FROM_HM, so he hasn't slept since the night. */
function stillUpFromNight(signs, at, date, tz) {
  const list = (signs || []).filter((t) => Number.isFinite(t) && t <= at).sort((a, b) => a - b);
  return list.length > 0 && awakeSince(list, at) < zonedTime(date, WAKE_FROM_HM, tz);
}

/** The times of the signs of him the phone has (his messages, meals, meal answers, ticks, workouts), sorted. */
export function phoneSigns({ messages = [], meals = [], checks = [], supps = [], sessions = [] } = {}) {
  return [
    ...messages.filter((m) => m && m.role === 'user').map((m) => m.at),
    ...meals.map((m) => m?.at),
    ...checks.map((c) => c?.at),
    ...supps.map((e) => e?.at),
    ...sessions.filter((x) => x && x.status !== 'discarded').map((x) => x.startedAt),
  ].filter(Number.isFinite).sort((a, b) => a - b);
}

/** The same on the phone, from its local copy of the data (device time zone). */
export async function wakingDayAt(repo, at = Date.now(), tz) {
  const date = isoDate(new Date(at), tz);
  const hm = hmOf(new Date(at), tz);
  if (hm >= STILL_UP_UNTIL_HM) return date;
  const [sleepLog, health, sessions] = await Promise.all([repo.get('sleep-log', date), repo.get('health', date), repo.list('sessions')]);
  let signs = null;
  if (hm >= WAKING_CUTOFF_HM) {
    const [messages, meals, checks, supps] = await Promise.all(['coach-messages', 'meals', 'meal-checks', 'supp-log'].map(async (c) => (await repo.list(c)) || []));
    signs = phoneSigns({ messages, meals, checks, supps, sessions: sessions || [] });
  }
  return wakingDay(at, { tz, sleepLog, health, sessions, signs });
}
