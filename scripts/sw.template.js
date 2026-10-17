// Service worker: keeps the whole app on the phone so it opens with no connection.
// TEMPLATE: scripts/precache.mjs writes app/sw.js from this file with the version and the file list put in
// below, so sw.js itself changes with every version. Browsers decide "is there an update?" by comparing
// sw.js byte for byte; iPhone Safari does not look at files sw.js imports, so the list can't live elsewhere.
// A new version installs in the background; the page offers a reload when it is ready.
/*PRECACHE*/

const { version, files } = self.TRAINING_HQ_PRECACHE;
const CACHE = `thq-${version}`;
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
