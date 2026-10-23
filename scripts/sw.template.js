// Service worker: keeps the whole app on the phone so it opens with no connection.
// TEMPLATE: scripts/precache.mjs writes app/sw.js from this file with the version and the file list put in
// below, so sw.js itself changes with every version. Browsers decide "is there an update?" by comparing
// sw.js byte for byte; iPhone Safari does not look at files sw.js imports, so the list can't live elsewhere.
// A new version installs in the background; the page offers a reload when it is ready.
/*PRECACHE*/

const { version, files } = self.TRAINING_HQ_PRECACHE;
const CACHE = `thq-${version}`;
// Squat Depth's pose library and models (vendor/, about 20 MB used): their own store, named after the MediaPipe
// version, kept across app updates and "Reload app files". Filled as they are first fetched (lib/squat-offline.js
// fetches them ahead of time); a new MediaPipe version gets a new name here.
const VENDOR_CACHE = 'mediapipe-1.1.0';
const isVendor = (url) => url.pathname.includes('/vendor/mediapipe/');
const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(files.map((f) => new Request(scopeUrl(f), { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('thq-') && key !== CACHE) await caches.delete(key);
      if (key.startsWith('mediapipe-') && key !== VENDOR_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// "Reload" on the page: switch to this version now. waitUntil keeps the worker alive until the switch is done.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Calls to the Mac server (and anything off-site) always go to the network; so does the "latest version" probe.
  if (url.origin !== self.location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/version.json')) return;

  if (isVendor(url)) {
    event.respondWith(caches.open(VENDOR_CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true }); // module imports send Origin, fetch() doesn't
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) await cache.put(new Request(url.origin + url.pathname), res.clone());
      return res;
    }));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE)
        .then((cache) => cache.match(scopeUrl('index.html')))
        .then((hit) => hit || fetch(req))
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(req, { ignoreSearch: true }))
      .then((hit) => hit || fetch(req))
  );
});

// Notifications from the Mac (step 4). The message is {title, body, url, tag}; tapping it opens that screen.
self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data ? event.data.text() : '' }; }
  // Thu 10/22, "Rest over": each one must sound, so it gets a fresh tag (a reused tag may replace the last one
  // silently); the one before it is closed so they don't pile up.
  const rest = /^(rest|hold)$/.test(m.tag || '');
  // A meal's check-ins (Thu 10/22): the same, per meal.
  const meal = /^meal-/.test(m.tag || '');
  event.waitUntil((async () => {
    if (rest) { try { for (const n of await self.registration.getNotifications()) if (/^(rest|hold)-/.test(n.tag || '')) n.close(); } catch { /* not supported */ } }
    if (meal) { try { for (const n of await self.registration.getNotifications()) if (n.tag === m.tag || (n.tag || '').startsWith(`${m.tag}~`)) n.close(); } catch { /* not supported */ } }
    await self.registration.showNotification(m.title || 'Training HQ', {
      body: m.body || '', tag: rest ? `${m.tag}-${Date.now()}` : meal ? `${m.tag}~${Date.now()}` : m.tag || undefined, data: { url: m.url || '#/today' }, icon: scopeUrl('icons/icon-192.png'),
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = event.notification.data?.url || '#/today';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      await c.focus();
      c.postMessage({ type: 'open', url: hash });
      return;
    }
    await self.clients.openWindow(scopeUrl(`index.html${hash}`));
  })());
});
