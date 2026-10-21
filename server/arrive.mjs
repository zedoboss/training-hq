// "When I arrive at the gym" (A10): an iPhone Shortcuts automation calls a private link on the Mac when he arrives.
// The Mac notes the arrival on that day (days/<date>.arrivedAt) and sends what matters at the gym now: on a scan day,
// "Body scan first" with the checklist (brief section 6: a reminder when I arrive at the gym). The link's secret lives
// in the server's own meta table, is shown only to a paired device (for the Shortcut on that phone) and can be renewed.
import { linkSecret } from './link-secret.mjs';
import { isoDate } from '../app/js/lib/time.js';
import { arrivalMessage } from '../app/js/lib/scans.js';

const KEY = 'arrive:secret';
const QUIET_MS = 30 * 60000; // a second arrival within 30 minutes (GPS jitter at the door) sends nothing new

export function openArrive({ store, push = null, tz, log = () => {}, now = () => Date.now() }) {
  const secret = linkSecret(store, KEY);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };

  return {
    /** The path for the Shortcut (the phone adds the Mac address it already uses). */
    link: ({ renew = false } = {}) => ({ path: `/api/arrive?k=${secret.get(renew)}` }),

    /** He arrived. Returns what was done; throws 403 on a wrong secret. */
    async arrive(k) {
      secret.check(k);
      const t = now();
      const zone = typeof tz === 'function' ? tz() : tz;
      const date = isoDate(new Date(t), zone);
      const cur = one('days', date) || { date };
      const repeat = cur.arrivedAt && t - cur.arrivedAt < QUIET_MS;
      if (!repeat) store.writeLocal('days', date, { ...cur, date, arrivedAt: t });
      const msg = repeat ? null : arrivalMessage({ plan: one('scan-plan', 'main') || {}, scans: store.listRecords('body-scans').map((r) => r.data).filter(Boolean), date });
      let sent = 0;
      if (msg && push?.list().length) sent = (await push.notify(msg)).sent || 0;
      log(`arrive ${date}${repeat ? ' (again, quiet)' : ''}${msg ? `: ${msg.title} (${sent} sent)` : ''}`);
      return { ok: true, date, repeat: !!repeat, message: msg ? msg.title : null, sent };
    },
  };
}
