// A private link for an iPhone Shortcut, which has no device token: the link carries a secret kept in the server's
// own meta table, shown only to a paired device (for the Shortcut on that phone). Renewing it makes the old link stop
// working. Used by "When I arrive at the gym" (A10) and the Apple Health Shortcut.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function linkSecret(store, key) {
  return {
    /** The secret, made the first time (or new when renewing). */
    get(renew = false) {
      let s = store.getMeta(key);
      if (!s || renew) { s = randomBytes(18).toString('base64url'); store.setMeta(key, s); }
      return s;
    },
    /** Throws 403 'wrong link' unless `k` is the current secret. */
    check(k) {
      const s = store.getMeta(key);
      const a = Buffer.from(String(k || '')); const b = Buffer.from(String(s || ''));
      if (!s || a.length !== b.length || !timingSafeEqual(a, b)) { const e = new Error('wrong link'); e.status = 403; throw e; }
    },
  };
}
