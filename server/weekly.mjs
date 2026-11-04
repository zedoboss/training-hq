// The weekly report on the Mac (lib/weekly.js): once a week, on his report day (Settings notify.weekly, Sunday 7:00 PM
// by default) from that time until his bedtime, inside his waking hours and not while a workout or the sauna runs. Sent
// once a week: one notification (the short line) and the whole report into Talk as a coach message he can answer.
import { weeklyReport, WEEKLY } from '../app/js/lib/weekly.js';
import { withDefaults } from '../app/js/lib/settings.js';
import { isoDate, zonedTime } from '../app/js/lib/time.js';
import { recordsOf, hoursNow, awakeIn, sessionBusy } from './notify.mjs';

export const WEEKLY_SENT = 'weekly:sent';

/** The day's weekday (0 = Sunday) for a YYYY-MM-DD date. */
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Builds the report for the week ending `end` from the store (also for the coach's tools). */
export function weeklyFor(store, end, tz) {
  const list = (col) => recordsOf(store, col);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const plan = one('fuel', 'plan');
  const sleeps = [...list('sleep-log'), ...store.listRecords('health').filter((r) => !r.deleted && r.data?.sleep).map((r) => ({ date: r.id, ...r.data.sleep }))]
    .filter((s) => s?.date);
  // One a night: what he told (or the coach worked out) wins over Apple Health's.
  const nights = [...new Map([...sleeps].reverse().map((s) => [s.date, s])).values()];
  return weeklyReport({ end, tz, sessions: list('sessions'), sets: list('sets'), meals: list('meals'), estimates: list('meal-estimates'),
    targets: plan?.kcal ? { kcal: plan.kcal, proteinG: plan.proteinG } : null, sleeps: nights, scans: list('body-scans') });
}

/** Once a minute from the notifier: the report when it's due. Returns what was sent, or null. */
export async function weeklyTick({ store, push, log = () => {}, now, tz }) {
  const n = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  if (n.kinds?.weekly === false) return null;
  const w = { ...WEEKLY, ...(n.weekly || {}) };
  const date = isoDate(new Date(now), tz);
  if (weekdayOf(date) !== Number(w.weekday) || now < zonedTime(date, w.hm, tz)) return null;
  if ((store.getMeta(WEEKLY_SENT) || {}).date === date) return null;
  const h = hoursNow(store, now, tz);
  if (!awakeIn(h, now, tz) || now < (h.nudgePausedUntil || 0)) return null;
  const list = (col) => recordsOf(store, col);
  if (sessionBusy(list('sessions'), now) || list('sauna').some((x) => x.status === 'active')) return null;
  const r = weeklyFor(store, date, tz);
  const id = `wk.${now.toString(36)}`;
  store.writeLocal('coach-messages', id, { id, role: 'assistant', text: r.text, at: now, tz, kind: 'weekly', ref: `weekly:${date}` });
  const out = push.list().length ? await push.notify({ title: 'Coach', body: r.short, url: '#/coach', tag: 'weekly' }) : { sent: 0 };
  store.setMeta(WEEKLY_SENT, { date, at: now });
  log(`weekly report ${date}: ${out.sent} sent`);
  return { key: `weekly:${date}`, body: r.short, text: r.text };
}
