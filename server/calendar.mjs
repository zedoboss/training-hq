// The backup reminders as a calendar his iPhone subscribes to (Thu 10/22, his words about reminders exported to the
// iPhone that can't know what's done: "fix the not fixed part... make it work somehow"). The Mac serves the next 7
// days' fixed reminders that are still open, minus the next 45 minutes: while it's up it sends those itself, and the
// iPhone (refreshing every 15 minutes) drops each one from its copy before it rings, so there is no double. A reminder
// done or cancelled drops off at the next refresh. With the Mac off or offline the iPhone keeps its last copy, and
// those alarms ring: the backup. The link carries its own secret (no device token in a calendar subscription).
import { linkSecret } from './link-secret.mjs';
import { fixedReminders, icsFor } from '../app/js/lib/backup-reminders.js';
import { stateFrom } from './notify.mjs';
import { isoDate } from '../app/js/lib/time.js';

export const KEY = 'calendar:secret';
/** The Mac's own window: reminders this close are left to its notifications. */
export const MAC_AHEAD_MIN = 45;
export const REFRESH_MIN = 15;

/** The open fixed reminders the calendar carries at `now`. */
export function calendarItems(store, tz, now) {
  const st = stateFrom(store, tz);
  return fixedReminders(st, isoDate(new Date(now), tz), 7, now).filter((r) => r.due !== false && r.at > now + MAC_AHEAD_MIN * 60000);
}

export function openCalendar({ store, tz, now = () => Date.now() }) {
  const secret = linkSecret(store, KEY);
  return {
    /** The path for the subscription (the phone adds the Mac address it already uses). */
    link: ({ renew = false } = {}) => ({ path: `/api/calendar.ics?k=${secret.get(renew)}` }),
    /** The calendar file; throws 403 on a wrong secret. */
    ics(k) {
      secret.check(k);
      const t = now();
      return icsFor(calendarItems(store, typeof tz === 'function' ? tz() : tz, t), t, { refreshMin: REFRESH_MIN });
    },
  };
}
