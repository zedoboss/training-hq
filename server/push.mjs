// Push subscriptions on the Mac (step 4): one per paired device, kept in the server's own meta table (not synced:
// an endpoint is only useful to the Mac). notify() sends to every subscribed device and drops ones that are gone, with
// the body cut to what the lock screen shows (lockScreen).
import { loadVapid, sendPush } from './webpush.mjs';

const KEY = 'push:subs';
// The lock screen shows about 4 lines (Thu 10/22, his words: "I can't read everything unless I hold it"). Talk keeps
// the full message; the notification carries its start.
export const LOCK_SCREEN_CHARS = 150;

/** Whole sentences from the start that fit; a first sentence that doesn't fit is cut at a clause or word, with "…". */
export function lockScreen(text, max = LOCK_SCREEN_CHARS) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const s of t.split(/(?<=[.!?])\s+/)) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  if (out) return out;
  const head = t.slice(0, max - 1);
  const at = Math.max(head.lastIndexOf('; '), head.lastIndexOf(', '), head.lastIndexOf(': '));
  const cut = at >= max / 2 ? head.slice(0, at) : head.slice(0, Math.max(head.lastIndexOf(' '), 1));
  return `${cut.replace(/[\s,;:–-]+$/, '')}…`;
}
// Push services want a contact for the sender; the app's public address is enough (no personal data).
export const DEFAULT_SUBJECT = 'https://zedoboss.github.io/training-hq/';

export function openPush({ store, vapidFile, vapid = null, subject = DEFAULT_SUBJECT, log = () => {}, send = sendPush }) {
  const keys = vapid || loadVapid(vapidFile);
  const list = () => store.getMeta(KEY) || [];
  const save = (subs) => store.setMeta(KEY, subs);

  function subscribe(device, sub, name = '') {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      const e = new Error('not a push subscription'); e.status = 400; throw e;
    }
    const known = list().some((s) => s.deviceId === device.id && s.endpoint === sub.endpoint && s.keys?.auth === sub.keys.auth);
    const rest = list().filter((s) => s.deviceId !== device.id && s.endpoint !== sub.endpoint);
    save([...rest, { deviceId: device.id, name: name || device.name, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: Date.now() }]);
    if (!known) log(`push: ${device.name} subscribed (${new URL(sub.endpoint).host})`);
    return { subscribed: true };
  }

  function unsubscribe(device) {
    const before = list();
    save(before.filter((s) => s.deviceId !== device.id));
    return { removed: before.length - list().length };
  }

  const status = (device) => ({ subscribed: list().some((s) => s.deviceId === device.id), devices: list().length });

  /** Send to all devices (or one). Resolves to {sent, failed, dropped}. */
  async function notify(message, { deviceId = null } = {}) {
    if (typeof message?.body === 'string') message = { ...message, body: lockScreen(message.body) };
    let sent = 0; let failed = 0; let dropped = 0;
    for (const s of list().filter((x) => !deviceId || x.deviceId === deviceId)) {
      try {
        const r = await send(s, message, keys, { subject });
        if (r.gone) { save(list().filter((x) => x.endpoint !== s.endpoint)); dropped++; log(`push: dropped ${s.name} (${r.status})`); }
        else if (r.status >= 200 && r.status < 300) sent++;
        else { failed++; log(`push: ${s.name} answered ${r.status} ${r.text}`); }
      } catch (e) { failed++; log(`push: ${s.name} unreachable: ${e.message}`); }
    }
    return { sent, failed, dropped };
  }

  return { publicKey: keys.publicKey, subscribe, unsubscribe, status, notify, list };
}
