// Registers the service worker and keeps the app up to date.
// - An update that finished downloading is applied as the app opens (nothing on screen yet to lose; an unfinished
//   session lives in the database), so opening the app is enough to get the new version.
// - While the app is open, a finished download offers "New version ready · Reload".
// - On open and when it comes back on screen, the app compares itself with version.json on the web. If a newer
//   version is out but the update hasn't come through after a while, it offers to fetch the app files again.
import { toast } from '../ui/toast.js';

const STARTUP_MS = 8000;
const started = Date.now();
let offered = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const apply = (worker) => worker.postMessage('skipWaiting');
    const ready = (worker) => {
      if (!navigator.serviceWorker.controller) return;
      if (Date.now() - started < STARTUP_MS) { apply(worker); return; }
      offered = true;
      toast('New version ready.', { action: 'Reload', ms: 0, onAction: () => apply(worker) });
    };
    if (reg.waiting) ready(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') ready(w); });
    });
    const check = () => { reg.update().catch(() => {}); watchVersion(reg); };
    check();
    // Check again each time the app comes back on screen.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/** If the web has a newer version and no update is on its way after 45 s, offer to fetch the app files again. */
async function watchVersion(reg) {
  const [running, latest] = await Promise.all([appVersion(), latestVersion()]);
  if (!latest || running === 'offline' || latest === running) return;
  setTimeout(() => {
    if (offered || reg.waiting || reg.installing) return;
    offered = true;
    toast('A newer version is out.', { action: 'Update', ms: 0, onAction: () => reloadAppFiles() });
  }, 45000);
}

/** The newest version on the web (version.json is never cached), or null when offline. */
export async function latestVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    return (await res.json()).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Look for a new version now and apply it when it has downloaded (the app then reloads).
 * Returns 'reloading', 'current' (nothing newer), 'slow' (still downloading after 30 s) or 'no-worker'.
 */
export async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'no-worker';
  await reg.update().catch(() => {});
  for (let i = 0; i < 120; i++) {
    if (reg.waiting) {
      if (!navigator.serviceWorker.controller) return 'current';
      reg.waiting.postMessage('skipWaiting');
      return 'reloading';
    }
    // Nothing on its way two seconds after the check: this is the latest.
    if (!reg.installing && i >= 8) return 'current';
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'slow';
}

/**
 * Last resort when an update won't come through: drop the stored app files and load them again from the web.
 * The data on this device (IndexedDB) and kept demo clips are not touched.
 */
export async function reloadAppFiles() {
  for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister();
  for (const k of await caches.keys()) if (k.startsWith('thq-')) await caches.delete(k);
  location.reload();
}

/** The running app's version (from its stored file list), or "offline"/"dev". */
export async function appVersion() {
  try {
    const res = await fetch('precache.js');
    const m = /"version":\s*"([0-9a-f]+)"/.exec(await res.text());
    return m ? m[1] : 'dev';
  } catch {
    return 'offline';
  }
}
