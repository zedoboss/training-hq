// Exercise demo clips (2.17), kept on the Mac in the private folder: data/demos/<exercise id>.<mp4|webm|mov>.
// Naming rule: the exercise's id (lowercase words joined by "-") plus the video type, e.g. squat-smith-machine.mp4.
// Clips can be added from the app or copied into the folder by hand; a rescan picks those up.
// Only a small record per clip is synced (col 'demos'); the phone fetches the video itself and keeps a copy.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEMO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
export const MAX_DEMO_BYTES = 30 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const FILE_RE = /^([a-z0-9][a-z0-9-]{0,99})\.(mp4|webm|mov)$/;

export const validDemoId = (id) => ID_RE.test(String(id || ''));
export const extForType = (type) => Object.entries(DEMO_TYPES).find(([, t]) => String(type || '').split(';')[0].trim() === t)?.[0] ?? null;

export function openDemos(dir, store) {
  mkdirSync(dir, { recursive: true });

  const filesFor = (id) => readdirSync(dir).filter((f) => FILE_RE.exec(f)?.[1] === id);
  const recordFor = (file) => {
    const [, id, ext] = FILE_RE.exec(file);
    const st = statSync(join(dir, file));
    return { id, file, type: DEMO_TYPES[ext], bytes: st.size, updatedAt: Math.round(st.mtimeMs) };
  };

  /** Make the synced records match the folder: new files get a record, removed files lose theirs. */
  function rescan() {
    const files = readdirSync(dir).filter((f) => FILE_RE.test(f));
    const byId = new Map(files.map((f) => [FILE_RE.exec(f)[1], f]));
    let added = 0; let removed = 0;
    for (const [id, file] of byId) {
      const want = recordFor(file);
      const cur = store.getRecord('demos', id);
      if (!cur || cur.deleted || cur.data?.file !== want.file || cur.data?.bytes !== want.bytes) { store.writeLocal('demos', id, want); added++; }
    }
    for (const r of store.listRecords('demos')) {
      if (!r.deleted && !byId.has(r.id)) { store.writeLocal('demos', r.id, null, { deleted: true }); removed++; }
    }
    return { clips: byId.size, added, removed };
  }

  function save(id, type, buf) {
    if (!validDemoId(id)) throw Object.assign(new Error('bad exercise id'), { status: 400 });
    const ext = extForType(type);
    if (!ext) throw Object.assign(new Error('demo must be an MP4, WebM or MOV video'), { status: 415 });
    if (!buf.length) throw Object.assign(new Error('empty video'), { status: 400 });
    const file = `${id}.${ext}`;
    const tmp = join(dir, `.${file}.tmp`);
    writeFileSync(tmp, buf);
    for (const old of filesFor(id)) if (old !== file) unlinkSync(join(dir, old));
    renameSync(tmp, join(dir, file));
    const rec = recordFor(file);
    store.writeLocal('demos', id, rec);
    return rec;
  }

  function read(id) {
    if (!validDemoId(id)) return null;
    const file = filesFor(id)[0];
    if (!file) return null;
    return { ...recordFor(file), body: readFileSync(join(dir, file)) };
  }

  function remove(id) {
    if (!validDemoId(id)) throw Object.assign(new Error('bad exercise id'), { status: 400 });
    const files = filesFor(id);
    for (const f of files) unlinkSync(join(dir, f));
    if (store.getRecord('demos', id)) store.writeLocal('demos', id, null, { deleted: true });
    return files.length > 0;
  }

  return { dir, rescan, save, read, remove, exists: () => existsSync(dir) };
}
