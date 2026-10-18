// Apple Health on the Mac (step 7, brief section 7). The iPhone Shortcut saves its file into an iCloud Drive folder
// (by default iCloud Drive > Shortcuts > Training HQ); the Mac looks there every few minutes, reads any file that is new
// or changed, and stores one 'health' record per date (<YYYY-MM-DD>) that reaches the phone by sync. The Mac only
// reads that folder: it never changes or deletes his files. A file picked on the phone can be sent here too
// (POST /api/apple-health/upload), for when the folder can't be read. What happened is kept in 'health-meta/status'.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseHealthFile, healthDays, mergeDay } from '../app/js/lib/health.js';

/** iCloud Drive > Shortcuts > Training HQ, as the Mac sees it. */
export const defaultHealthDir = () => join(homedir(), 'Library', 'Mobile Documents', 'iCloud~is~workflow~my~workflows', 'Documents', 'Training HQ');
const FILE_RE = /\.(json|jsonl|txt)$/i;

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openStore>} o.store
 * @param {string|null} o.dir folder the Shortcut saves into
 * @param {string} [o.tz] time zone the days are counted in (the Mac's own)
 */
export function openHealth({ store, dir, tz = Intl.DateTimeFormat().resolvedOptions().timeZone, log = () => {}, now = () => Date.now() }) {
  const seen = () => store.getMeta('health:files') || {};
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };

  function setStatus(patch) {
    const cur = one('health-meta', 'status') || {};
    const next = { ...cur, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(cur)) store.writeLocal('health-meta', 'status', next);
    return next;
  }

  /** Read one file's text into the stored days. Returns a summary. */
  function importText(text, { name, fileAt = now(), from = 'folder' }) {
    const parsed = parseHealthFile(text, tz);
    const at = parsed.at ?? fileAt;
    const days = healthDays(parsed.samples, tz);
    const writes = [];
    for (const day of days) {
      const stored = one('health', day.date);
      // A file older than the one a day came from can only add to it, never replace it (iCloud may deliver late).
      const older = stored?.fileAt != null && at < stored.fileAt;
      const merged = mergeDay(stored, older ? { ...day, covered: {} } : day);
      if (!merged) continue;
      writes.push({ col: 'health', id: day.date, data: { id: day.date, ...merged, fileAt: Math.max(at, stored?.fileAt ?? 0), file: name, updatedAt: now() } });
    }
    if (writes.length) store.writeLocalMany(writes);
    const summary = { name, from, at, readAt: now(), samples: parsed.samples.length, bad: parsed.bad, days: days.length, changed: writes.length,
      range: days.length ? [days[0].date, days.at(-1).date] : null, types: countTypes(parsed.samples) };
    log(`health: ${name} (${from}): ${summary.samples} samples, ${summary.changed} of ${summary.days} days changed${summary.bad ? `, ${summary.bad} lines not read` : ''}`);
    return summary;
  }

  /** Look in the folder; read files that are new or changed since last time, oldest first. */
  function scan() {
    if (!dir) return setStatus({ folder: null, error: 'No Health folder is set on the Mac.' });
    if (!existsSync(dir)) return setStatus({ folder: dir, folderFound: false, error: null });
    let names;
    try { names = readdirSync(dir).filter((n) => FILE_RE.test(n) && !n.startsWith('.')); }
    catch (e) { return setStatus({ folder: dir, folderFound: true, error: macError(e) }); }
    const known = seen();
    const todo = [];
    for (const name of names) {
      let st;
      try { st = statSync(join(dir, name)); } catch { continue; }
      const key = `${st.size}:${Math.round(st.mtimeMs)}`;
      if (known[name]?.key === key) continue;
      todo.push({ name, st, key });
    }
    todo.sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);
    let last = null; let error = null;
    for (const f of todo) {
      let text;
      try { text = readFileSync(join(dir, f.name), 'utf8'); } catch (e) { error = macError(e); log(`health: ${f.name} not read (${e.code || e.message})`); continue; }
      last = importText(text, { name: f.name, fileAt: Math.round(f.st.mtimeMs) });
      known[f.name] = { key: f.key, readAt: now() };
    }
    if (todo.length) store.setMeta('health:files', known);
    return setStatus({ folder: dir, folderFound: true, files: names.length, error, ...(last ? { last } : {}) });
  }

  /** A file sent from the phone (picked in the Files app). */
  function upload(text, name = 'health.json') {
    const last = importText(text, { name, from: 'phone' });
    if (last.samples) setStatus({ last }); // a file that couldn't be read leaves the last good one on the screen
    return last;
  }

  return { scan, upload, importText, dir };
}

function countTypes(samples) {
  const out = {};
  for (const s of samples) out[s.type] = (out[s.type] || 0) + 1;
  return out;
}

/** Plain words for a file-system error (macOS privacy settings are the usual cause). */
function macError(e) {
  if (e?.code === 'EPERM' || e?.code === 'EACCES') return 'The Mac may not read the iCloud Drive folder. Allow "node" in System Settings > Privacy & Security > Files and Folders (iCloud Drive), or Full Disk Access.';
  return `The Health folder could not be read (${e?.code || e?.message || 'error'}).`;
}
