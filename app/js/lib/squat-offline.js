// Squat Depth offline (5.2): the pose library and model kept on the device, so Squat Depth works with no connection.
// They are big (about 19 MB with the lite model), so they live in their own Cache Storage store, apart from the
// per-version app files: an app update never downloads them again. scripts/sw.template.js serves vendor/mediapipe/
// from the same store and adds anything it fetches there (the full model, the rare no-SIMD build).
export const VENDOR_CACHE = 'mediapipe-1.1.0';

const appUrl = (path) => new URL(path, document.baseURI).href;
export const MP_LOCAL = () => appUrl('vendor/mediapipe/tasks-vision');
export const MODEL_LOCAL = (model) => appUrl(`vendor/mediapipe/models/pose_landmarker_${model}.task`);

// Approximate sizes for the screen before anything is downloaded (bytes).
const SIZE = { bundle: 156135, loader: 335393, wasm: 12997248, lite: 5777746, full: 9398198 };
export const approxBytes = (model = 'lite') => SIZE.bundle + SIZE.loader + SIZE.wasm + (SIZE[model] || SIZE.lite);
export const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

/** The files Squat Depth loads for this model: the library, the wasm build this browser uses, the model. */
async function filesFor(model) {
  const base = MP_LOCAL();
  // MediaPipe picks the SIMD build when the browser has SIMD (every iPhone on iOS 16.4+); ask it the same way.
  let simd = true;
  try {
    const vision = await import(`${base}/vision_bundle.mjs`);
    simd = await vision.FilesetResolver.isSimdSupported();
  } catch { /* library not reachable: the default list is still right for an iPhone */ }
  const wasm = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  return [`${base}/vision_bundle.mjs`, `${base}/wasm/${wasm}.js`, `${base}/wasm/${wasm}.wasm`, MODEL_LOCAL(model)];
}

const key = (url) => { const u = new URL(url); return u.origin + u.pathname; };

/** What is on this device: {ready, have, total, bytes} (bytes stored, from the cached responses' sizes). */
export async function offlineStatus(model = 'lite') {
  if (!('caches' in self)) return { ready: false, have: 0, total: 0, bytes: 0, unsupported: true };
  const cache = await caches.open(VENDOR_CACHE);
  const files = await filesFor(model);
  let have = 0;
  let bytes = 0;
  for (const f of files) {
    const hit = await cache.match(key(f));
    if (!hit) continue;
    have += 1;
    bytes += Number(hit.headers.get('content-length')) || 0;
  }
  return { ready: have === files.length, have, total: files.length, bytes };
}

let running = null;

/**
 * Download whatever is missing into the store. onProgress({done, total}) in bytes (total is an estimate until each
 * file's size is known). Resolves to offlineStatus(); throws when a file can't be fetched (no connection).
 */
export function keepOffline(model = 'lite', onProgress = () => {}) {
  if (running) return running;
  running = (async () => {
    const cache = await caches.open(VENDOR_CACHE);
    const files = await filesFor(model);
    const missing = [];
    for (const f of files) if (!(await cache.match(key(f)))) missing.push(f);
    let total = approxBytes(model);
    let done = total - missing.reduce((n, f) => n + (SIZE[sizeName(f)] || 0), 0);
    onProgress({ done, total });
    for (const f of missing) {
      const res = await fetch(f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status} for ${f.split('/').pop()}`);
      const len = Number(res.headers.get('content-length')) || 0;
      if (len) total += len - (SIZE[sizeName(f)] || 0);
      const parts = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        parts.push(value);
        done += value.length;
        onProgress({ done, total });
      }
      const body = new Blob(parts);
      await cache.put(key(f), new Response(body, { headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream', 'Content-Length': String(body.size) } }));
    }
    // Ask the browser not to clear this store when space runs low (Home Screen apps usually get it).
    try { await navigator.storage?.persist?.(); } catch { /* not offered */ }
    return offlineStatus(model);
  })().finally(() => { running = null; });
  return running;
}

function sizeName(url) {
  if (url.endsWith('.mjs')) return 'bundle';
  if (url.endsWith('.js')) return 'loader';
  if (url.endsWith('.wasm')) return 'wasm';
  if (url.includes('_full.')) return 'full';
  return 'lite';
}

export const isDownloading = () => !!running;

const TRIED_KEY = 'thq.squat.offlineTriedAt';

/**
 * Fetch the files once in the background after the app opens, so Squat Depth is ready at the gym with no signal.
 * Quiet: no message on failure; tries again an hour later at the earliest.
 */
export function autoKeepOffline(model = 'lite', { delayMs = 20000 } = {}) {
  if (!('caches' in self) || typeof navigator === 'undefined') return;
  setTimeout(async () => {
    try {
      if (!navigator.onLine || document.visibilityState !== 'visible') return;
      const last = Number(localStorage.getItem(TRIED_KEY)) || 0;
      if (Date.now() - last < 3600000) return;
      if ((await offlineStatus(model)).ready) return;
      localStorage.setItem(TRIED_KEY, String(Date.now()));
      await keepOffline(model);
    } catch { /* offline or storage refused: the Squat Depth screen says so */ }
  }, delayMs);
}
