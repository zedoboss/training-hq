// Registers the service worker and offers a reload when a new version of the app has downloaded.
import { toast } from '../ui/toast.js';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      toast('New version ready.', {
        action: 'Reload',
        ms: 0,
        onAction: () => worker.postMessage('skipWaiting'),
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // Check for a new version each time the app comes back on screen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/** Current app version from the precache manifest, or "dev". */
export async function appVersion() {
  try {
    const res = await fetch('precache.js');
    const m = /"version":\s*"([0-9a-f]+)"/.exec(await res.text());
    return m ? m[1] : 'dev';
  } catch {
    return 'offline';
  }
}
