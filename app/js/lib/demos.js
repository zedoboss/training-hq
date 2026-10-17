// Exercise demo clips on the phone (2.17). The clips live on the Mac; each synced 'demos' record says which exercise
// has one. A clip played once is kept on this device (Cache Storage 'demos-v1'), so it plays at the gym with no
// connection. New clips are made small before upload: at most 15 seconds, 540 px wide, no sound.
const CACHE = 'demos-v1';
const keyFor = (id, rec) => `https://demos.training-hq.invalid/${encodeURIComponent(id)}?v=${rec?.updatedAt ?? 0}`;

export const MAX_SECONDS = 15;
export const MAX_WIDTH = 540;

/** Kept copy of a clip, or null. */
export async function cachedClip(id, rec) {
  try {
    const hit = await (await caches.open(CACHE)).match(keyFor(id, rec));
    return hit ? await hit.blob() : null;
  } catch { return null; }
}

/** Keep a clip on this device; older versions of the same exercise's clip are dropped. */
export async function keepClip(id, rec, blob) {
  try {
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      if (new URL(req.url).pathname === `/${encodeURIComponent(id)}`) await cache.delete(req);
    }
    await cache.put(keyFor(id, rec), new Response(blob, { headers: { 'content-type': blob.type || rec?.type || 'video/mp4' } }));
  } catch { /* storage full or unavailable: it will be fetched again next time */ }
}

export async function forgetClip(id) {
  try {
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) if (new URL(req.url).pathname === `/${encodeURIComponent(id)}`) await cache.delete(req);
  } catch { /* nothing kept */ }
}

/** Ids of exercises whose clip is kept on this device (any version). */
export async function keptIds() {
  try {
    return new Set((await (await caches.open(CACHE)).keys()).map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1))));
  } catch { return new Set(); }
}

const pickType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
};

/**
 * Make a clip small: redraw it at most MAX_WIDTH wide, silent, first MAX_SECONDS, about 1 Mbit/s.
 * It plays the video once in the background to do this, so it takes as long as the clip (up to 15 s).
 * Falls back to the original file when the browser can't record video.
 * @returns {Promise<{blob: Blob, shrunk: boolean, seconds: number}>}
 */
export function shrinkClip(file, { onProgress = () => {} } = {}) {
  return new Promise((resolve) => {
    const type = pickType();
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    const src = URL.createObjectURL(file);
    video.src = src;
    const done = (out) => { URL.revokeObjectURL(src); video.removeAttribute('src'); resolve(out); };
    video.onerror = () => done({ blob: file, shrunk: false, seconds: 0 });
    video.onloadedmetadata = async () => {
      // Recorded clips often report no length (Infinity): then the clip's own end, or 15 s, stops it.
      const seconds = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(video.duration, MAX_SECONDS) : MAX_SECONDS;
      const canvas = document.createElement('canvas');
      if (!type || !canvas.captureStream || !video.videoWidth) { done({ blob: file, shrunk: false, seconds }); return; }
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      canvas.width = Math.round((video.videoWidth * scale) / 2) * 2;
      canvas.height = Math.round((video.videoHeight * scale) / 2) * 2;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: type.split(';')[0] });
        done(blob.size > 0 && blob.size < file.size ? { blob, shrunk: true, seconds } : { blob: file, shrunk: false, seconds });
      };
      // A timer, not animation frames: frames stop when the screen is hidden; the timer only slows down.
      const finish = () => { clearInterval(tick); if (rec.state !== 'inactive') rec.stop(); video.pause(); };
      const draw = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        onProgress(Math.min(1, video.currentTime / (seconds || 1)));
        if (video.currentTime >= seconds || video.ended) finish();
      };
      let tick = 0;
      video.onended = () => { draw(); finish(); };
      try {
        rec.start(250);
        await video.play();
        tick = setInterval(draw, 33);
      } catch {
        finish();
        done({ blob: file, shrunk: false, seconds });
      }
    };
  });
}
