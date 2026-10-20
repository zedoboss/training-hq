// When a photo was taken (Tue 10/20: a meal photo picked from Photos keeps the time it was taken).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exifTime, photoTime } from '../app/js/lib/photos.js';

/** A minimal JPEG whose EXIF says the photo was taken at `when` ("YYYY:MM:DD HH:MM:SS"), little-endian. */
function jpegWith(when) {
  const t = [];
  const u16 = (v) => t.push(v & 255, (v >> 8) & 255);
  const u32 = (v) => t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  t.push(0x49, 0x49, 0x2a, 0x00); u32(8);                          // TIFF header, IFD0 at 8
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0);              // IFD0: Exif IFD at 26
  u16(1); u16(0x9003); u16(2); u32(20); u32(44); u32(0);             // Exif IFD: DateTimeOriginal at 44
  for (const c of `${when}\0`) t.push(c.charCodeAt(0));
  const app1 = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], t);
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]);
}

test('the camera time in the photo, as the phone clock read it', async () => {
  const b = jpegWith('2026:10:20 13:42:05');
  assert.equal(exifTime(b), new Date(2026, 9, 20, 13, 42, 5).getTime());
  const now = new Date(2026, 9, 20, 14, 20, 0).getTime();
  assert.equal(await photoTime(new Blob([b]), now), new Date(2026, 9, 20, 13, 42, 5).getTime());
});

test('no camera time: the file time when clearly earlier, else now; never the future or long ago', async () => {
  const now = new Date(2026, 9, 20, 14, 20, 0).getTime();
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);
  assert.equal(await photoTime(Object.assign(png, { lastModified: now - 30 * 60000 }), now), now - 30 * 60000);
  assert.equal(await photoTime(Object.assign(new Blob([new Uint8Array([1])]), { lastModified: now - 10000 }), now), now, 'just now: now');
  assert.equal(await photoTime(new Blob([jpegWith('2026:10:25 13:42:05')]), now), now, 'a wrong camera clock in the future');
  assert.equal(await photoTime(new Blob([jpegWith('2025:01:01 08:00:00')]), now), now, 'an old photo: now');
  assert.equal(exifTime(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
});
