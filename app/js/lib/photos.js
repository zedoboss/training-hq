// Photos: shrunk on the device (longest side 1280 px, JPEG) before they are stored and synced.
export async function fileToJpeg(file, { max = 1280, quality = 0.8 } = {}) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

export const newPhotoId = () => `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * When a photo was taken (Tue 10/20: he took the meal photo before eating and picks it from Photos afterwards; the
 * meal must keep that time, not the moment he uploads it). The camera's own time in the photo (EXIF
 * DateTimeOriginal, the phone's local clock), else the file's time when it is clearly earlier, else now.
 * @param {Blob & {lastModified?: number}} file
 * @returns {Promise<number>} ms
 */
export async function photoTime(file, now = Date.now()) {
  let t = null;
  try { t = exifTime(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())); } catch { /* not a JPEG */ }
  if (!t && file.lastModified && file.lastModified < now - 60000) t = file.lastModified;
  // Only a time in the last two days and not in the future counts (a wrong camera clock must not move the meal).
  return t && t <= now + 60000 && t > now - 2 * 86400000 ? Math.min(t, now) : now;
}

/** EXIF DateTimeOriginal (else DateTime) of a JPEG's first bytes, read as local time; null when there is none. */
export function exifTime(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1]; const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && String.fromCharCode(...b.slice(i + 4, i + 8)) === 'Exif') return tiffTime(b, i + 10);
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

function tiffTime(b, t0) {
  const le = b[t0] === 0x49;
  const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24 : b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
  const tags = (ifd) => {
    const out = new Map(); const n = u16(t0 + ifd);
    for (let k = 0; k < n; k++) { const e = t0 + ifd + 2 + k * 12; if (e + 12 > b.length) break; out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 }); }
    return out;
  };
  const text = (tag) => { if (!tag || tag.count < 19) return null; const o = t0 + u32(tag.at); return o + 19 <= b.length ? String.fromCharCode(...b.slice(o, o + 19)) : null; };
  const ifd0 = tags(u32(t0 + 4));
  const exif = ifd0.get(0x8769) ? tags(u32(ifd0.get(0x8769).at)) : new Map();
  const s = text(exif.get(0x9003)) || text(ifd0.get(0x0132));
  const m = s && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}
