// Exercise demos (2.17), kept on the Mac in the private folder: data/demos/<exercise id>.<mp4|webm|mov|html>.
// Naming rule: the exercise's id (lowercase words joined by "-") plus the type, e.g. squat-smith-machine.mp4.
// A demo is a video clip or an animated demo page (.html, one self-contained file per exercise, made in the private
// folder's animations/). When an exercise has both, his own clip wins; the animation stays on disk underneath it.
// Clips can be added from the app or copied into the folder by hand; animations only by hand. A rescan picks them up.
// Only a small record per demo is synced (col 'demos'); the phone fetches the file itself and keeps a copy.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
export const DEMO_TYPES = { ...VIDEO_TYPES, html: 'text/html' };
export const MAX_DEMO_BYTES = 30 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const FILE_RE = /^([a-z0-9][a-z0-9-]{0,99})\.(mp4|webm|mov|html)$/;

export const validDemoId = (id) => ID_RE.test(String(id || ''));
/** File extension for an uploaded video's type; uploads are videos only. */
export const extForType = (type) => Object.entries(VIDEO_TYPES).find(([, t]) => String(type || '').split(';')[0].trim() === t)?.[0] ?? null;
const isVideo = (file) => !file.endsWith('.html');
/** The file that represents an exercise's demo: a clip if there is one, otherwise the animation. */
const pick = (files) => files.find(isVideo) ?? files[0] ?? null;

export function openDemos(dir, store) {
  mkdirSync(dir, { recursive: true });

  const filesFor = (id) => readdirSync(dir).filter((f) => FILE_RE.exec(f)?.[1] === id).sort();
  const recordFor = (file) => {
    const [, id, ext] = FILE_RE.exec(file);
    const st = statSync(join(dir, file));
    return { id, file, type: DEMO_TYPES[ext], bytes: st.size, updatedAt: Math.round(st.mtimeMs) };
  };
  /** Point the synced record at the exercise's current demo file, or mark it deleted when none is left. */
  const syncRecord = (id) => {
    const file = pick(filesFor(id));
    if (file) {
      const want = recordFor(file);
      const cur = store.getRecord('demos', id);
      if (!cur || cur.deleted || cur.data?.file !== want.file || cur.data?.bytes !== want.bytes || cur.data?.updatedAt !== want.updatedAt) {
        store.writeLocal('demos', id, want);
        return 'written';
      }
      return 'same';
    }
    if (store.getRecord('demos', id) && !store.getRecord('demos', id).deleted) { store.writeLocal('demos', id, null, { deleted: true }); return 'removed'; }
    return 'none';
  };

  /** Make the synced records match the folder: new files get a record, removed files lose theirs. */
  function rescan() {
    const ids = new Set(readdirSync(dir).filter((f) => FILE_RE.test(f)).map((f) => FILE_RE.exec(f)[1]));
    let added = 0; let removed = 0;
    for (const id of ids) if (syncRecord(id) === 'written') added++;
    for (const r of store.listRecords('demos')) if (!r.deleted && !ids.has(r.id) && syncRecord(r.id) === 'removed') removed++;
    return { clips: ids.size, added, removed };
  }

  function save(id, type, buf) {
    if (!validDemoId(id)) throw Object.assign(new Error('bad exercise id'), { status: 400 });
    const ext = extForType(type);
    if (!ext) throw Object.assign(new Error('demo must be an MP4, WebM or MOV video'), { status: 415 });
    if (!buf.length) throw Object.assign(new Error('empty video'), { status: 400 });
    const file = `${id}.${ext}`;
    const tmp = join(dir, `.${file}.tmp`);
    writeFileSync(tmp, buf);
    for (const old of filesFor(id)) if (old !== file && isVideo(old)) unlinkSync(join(dir, old));
    renameSync(tmp, join(dir, file));
    const rec = recordFor(file);
    store.writeLocal('demos', id, rec);
    return rec;
  }

  function read(id) {
    if (!validDemoId(id)) return null;
    const file = pick(filesFor(id));
    if (!file) return null;
    return { ...recordFor(file), body: readFileSync(join(dir, file)) };
  }

  /** Remove the exercise's clip; with no clip, the animation. Whatever is left becomes the demo. */
  function remove(id) {
    if (!validDemoId(id)) throw Object.assign(new Error('bad exercise id'), { status: 400 });
    const files = filesFor(id);
    const videos = files.filter(isVideo);
    const gone = videos.length ? videos : files;
    for (const f of gone) unlinkSync(join(dir, f));
    syncRecord(id);
    return gone.length > 0;
  }

  return { dir, rescan, save, read, remove, exists: () => existsSync(dir) };
}
