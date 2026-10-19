// Push subscriptions on the Mac (step 4): one per paired device, kept in the server's own meta table (not synced:
// an endpoint is only useful to the Mac). notify() sends to every subscribed device and drops ones that are gone.
import { loadVapid, sendPush } from './webpush.mjs';

const KEY = 'push:subs';
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
