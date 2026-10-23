// His waking day (Sat 10/24, his words: "I still haven't slept... the body registers it as one day"): food and
// supplements after midnight, before he has slept, count toward the day he woke up on, not the calendar date.
// Up to 6:00 AM a moment belongs to the day before, unless something says he slept and got up since midnight:
// sleep logged for the night to this date (woken by then), Apple Health's wake time, or a workout started.
// From 6:00 AM it is always the calendar date.
import { isoDate, hmOf } from './time.js';
import { addDays } from './rotation.js';

/** Before this clock time, a moment with no sign of sleep belongs to the day before. */
export const WAKING_CUTOFF_HM = '06:00';

/**
 * The day food and supplements at `at` count toward. sleepLog: the sleep-log doc for the night to that calendar date
 * (id = date); health: the Apple Health doc for that date; sessions: his sessions (holds rounds don't count as up).
 */
export function wakingDay(at, { tz, sleepLog = null, health = null, sessions = [] } = {}) {
  const date = isoDate(new Date(at), tz);
  if (hmOf(new Date(at), tz) >= WAKING_CUTOFF_HM) return date;
  const woke = (w) => typeof w === 'number' && w <= at;
  if (sleepLog && !sleepLog.deleted && (sleepLog.wake == null || woke(sleepLog.wake))) return date;
  if (woke(health?.sleep?.wake) && isoDate(new Date(health.sleep.wake), tz) === date) return date;
  if ((sessions || []).some((s) => s && s.kind !== 'holds' && s.startedAt && s.startedAt <= at && isoDate(new Date(s.startedAt), tz) === date)) return date;
  return addDays(date, -1);
}

/** The same on the phone, from its local copy of the data (device time zone). */
export async function wakingDayAt(repo, at = Date.now(), tz) {
  const date = isoDate(new Date(at), tz);
  if (hmOf(new Date(at), tz) >= WAKING_CUTOFF_HM) return date;
  const [sleepLog, health, sessions] = await Promise.all([repo.get('sleep-log', date), repo.get('health', date), repo.list('sessions')]);
  return wakingDay(at, { tz, sleepLog, health, sessions });
}
