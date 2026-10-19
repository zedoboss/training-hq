// Notifications on this device (step 4): the phone subscribes with the Mac's public key; the Mac sends.
// iPhone: only in the Home Screen app (iOS 16.4+), and permission must come straight from a tap.
import { macGet, macPost } from './data.js';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const permission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

const fromB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const sameKey = (sub, key) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k); const b = fromB64u(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Call straight from a tap: asks for permission, subscribes, and tells the Mac. */
export async function enablePush(name = 'iPhone') {
  const asked = Notification.requestPermission(); // first, while the tap still counts
  const perm = await asked;
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Notifications are off for Training HQ. Turn them on in iPhone Settings > Notifications > Training HQ, then try again.'
      : 'Notifications were not allowed.');
  }
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await macGet('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) { await sub.unsubscribe(); sub = null; }
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(publicKey) });
  await macPost('/api/push/subscribe', { subscription: sub.toJSON(), name });
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription().catch(() => null);
  await macPost('/api/push/unsubscribe').catch(() => null);
  if (sub) await sub.unsubscribe();
}

/**
 * At every app start (Mon 10/19: an app update had silently dropped this phone's subscription, so nothing arrived
 * though the Mac's pushes were accepted): when notifications are allowed, send the current subscription to the Mac
 * again ('ok'), or report that it is gone ('lost': turning it back on needs a tap). 'off' when not allowed or unsupported.
 */
export async function keepPush(name = 'iPhone') {
  if (!pushSupported() || permission() !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const { publicKey } = await macGet('/api/push/key');
  if (!sub || !sameKey(sub, publicKey)) return 'lost';
  await macPost('/api/push/subscribe', { subscription: sub.toJSON(), name });
  return 'ok';
}

export const testPush = () => macPost('/api/push/test');
export const pushStatus = () => macGet('/api/push/status');
