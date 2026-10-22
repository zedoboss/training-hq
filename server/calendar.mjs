// RETIRED Thu 10/22, 5:45 PM: the feed is empty now; the backup lives in his iCloud calendar (icloud-calendar.mjs),
// which uses calendarItems below. Kept so a phone still subscribed fetches an empty calendar and drops the old alerts.
// The backup reminders as a calendar his iPhone subscribes to (Thu 10/22, his words about reminders exported to the
// iPhone that can't know what's done: "fix the not fixed part... make it work somehow"; then "it can miss info by 15
// mins or what?"). The Mac serves the next 7 days' fixed reminders that are still open and that it hasn't sent yet;
// each one's alert rings 20 minutes after its time. While the Mac is up it sends the reminder at its time and the
// iPhone (refreshing every 15 minutes) drops it from its copy before that alert: no double. With the Mac off or
// offline the iPhone keeps its last copy and nothing is lost: each reminder rings 20 minutes late. A reminder done or
// cancelled drops off at the next refresh. The link carries its own secret (no device token in a subscription).
import { linkSecret } from './link-secret.mjs';
import { fixedReminders, icsFor } from '../app/js/lib/backup-reminders.js';
import { stateFrom, SENT, afterMeals, mealSpansFor } from './notify.mjs';
import { isoDate } from '../app/js/lib/time.js';

export const KEY = 'calendar:secret';
/** The last fetch of the feed: {at, agent, count}. */
export const FETCHED = 'calendar:fetched';
/** The alert comes this long after the reminder's time: more than the iPhone's 15-minute refresh, so a sent one is gone first. */
export const ALERT_AFTER_MIN = 20;
export const REFRESH_MIN = 15;

/** The open fixed reminders the calendar carries at `now`: not sent by the Mac yet, their alert still ahead. */
export function calendarItems(store, tz, now) {
  const st = stateFrom(store, tz);
  const sent = store.getMeta(SENT) || {};
  // A reminder he set that lands in a meal rings after it, like the Mac's (notify.mjs, afterMeals): all of today's are
  // looked at, since one moved there may have been planned hours before; the filter below drops the old ones.
  return afterMeals(fixedReminders(st, isoDate(new Date(now), tz), 7, 0), mealSpansFor(store, now, tz), st.coachReminders)
    .filter((r) => r.due !== false && !sent[r.id] && r.at + ALERT_AFTER_MIN * 60000 > now);
}

export function openCalendar({ store, tz, now = () => Date.now() }) {
  const secret = linkSecret(store, KEY);
  return {
    /** The path for the subscription (the phone adds the Mac address it already uses). */
    link: ({ renew = false } = {}) => ({ path: `/api/calendar.ics?k=${secret.get(renew)}` }),
    /** The calendar file; throws 403 on a wrong secret. Each fetch is kept (Thu 10/22: is the iPhone refreshing?). */
    ics(k, { agent = '' } = {}) {
      secret.check(k);
      const t = now();
      store.setMeta(FETCHED, { at: t, agent: String(agent).slice(0, 120), count: (store.getMeta(FETCHED)?.count || 0) + 1 });
      // Retired (Thu 10/22, 5:45 PM): the iPhone didn't fetch it for over an hour, so its alerts rang at stale times. The
      // backup is in his iCloud calendar now (icloud-calendar.mjs); this answers with an empty calendar, so a phone
      // that still fetches it drops the old events and their alerts.
      return icsFor([], t, { refreshMin: REFRESH_MIN });
    },
  };
}
