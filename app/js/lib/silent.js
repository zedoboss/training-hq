// Gone quiet (Thu 11/5, from his list of missing features: "When you go quiet for days, the app keeps sending the same
// asks instead of changing how it reaches out"). From Wed 10/28 he answered nothing for a week, and a day still brought
// over 30 asks (Wed 11/4): the first meal chased five times twice over, the walk four times, "no time set" for the
// workout three times, holds, supplements. Now, once SILENT.afterH hours (two days) have passed with no answer from him (a message, a meal or a
// meal answer, a supplement tick, a workout or a set, a walk answer, a session time or check-in), the app's own asks stop going out one by one; once
// a day, inside his waking hours and once his morning question is through (it stays the day's first ask), one short
// catch-up names what is still open. What he set himself still goes out on time (his own reminders, the session time he chose and its check-in, the sauna). The first answer from him ends it.
// Pure: the server (notify.mjs) reads the records and sends.
import { formatDay, formatTime } from './time.js';

export const SILENT = { afterH: 48, catchUpAfterWakeMin: 120 };
/** Reminder kinds that are his own or safety: they keep their time while he is quiet. */
export const SILENT_PASS = new Set(['coach', 'sauna', 'session', 'readiness']);

/** His last answer, from the records' lists: {messages, meals, checks, supps, sessions, sets, walks, days}. 0 when none. */
export function lastAnswerAt({ messages = [], meals = [], checks = [], supps = [], sessions = [], sets = [], walks = [], days = [] } = {}, now = Infinity) {
  const times = [
    ...messages.filter((m) => m?.role === 'user').map((m) => m.at),
    ...meals.map((m) => m?.at),
    ...checks.map((c) => c?.at),
    ...supps.map((e) => e?.at),
    ...sessions.filter((x) => x && x.status !== 'discarded').map((x) => x.startedAt),
    ...sets.filter((x) => x?.done).map((x) => x.doneAt),
    // His day: the session time he set, his check-in, a rest day.
    ...days.flatMap((d) => [d?.timeSetAt, d?.readiness?.at, d?.rest?.at]),
    ...walks.flatMap((w) => [w?.going?.at, ...(w?.walks || []).filter((x) => !x?.auto).map((x) => x.at), ...(w?.skips || []).map((x) => x.at), w?.plan && w.plan.by !== 'coach' ? w.plan.setAt : null]),
  ].filter((t) => Number.isFinite(t) && t <= now);
  return times.length ? Math.max(...times) : 0;
}

/** Quiet long enough: {since, hours}; null while he answers (or before he ever has: a new install isn't silence). */
export function silentNow(lastAt, now, afterH = SILENT.afterH) {
  if (!lastAt || now - lastAt < afterH * 3600000) return null;
  return { since: lastAt, hours: Math.floor((now - lastAt) / 3600000) };
}

const LABELS = { meals: 'food', cook: 'food', supps: 'supplements', holds: 'holds', neck: 'neck', scan: 'body scan', recovery: 'recovery check-in' };

/** One label a kind of open item, in this order, no repeats. kinds: reminder kinds; extra: labels added as they are. */
export function openLabels(kinds = [], extra = []) {
  const out = [];
  for (const l of [...extra, ...kinds.map((k) => LABELS[k])]) if (l && !out.includes(l)) out.push(l);
  return out;
}

/** The day's one catch-up while he's quiet: when he last answered, what is open, and that the asks wait for him. */
export function catchUpText({ since, open = [], tz }) {
  const when = `${formatDay(new Date(since), tz)}, ${formatTime(new Date(since), tz)}`;
  const list = open.length ? ` Still open today: ${open.join(', ')}.` : '';
  return `No answer from you since ${when}.${list} One message a day till you're back: answer anything and I pick up from there.`;
}
