// Apple Health on the Mac (step 7, brief section 7). The iPhone Shortcut saves its file into an iCloud Drive folder
// (by default iCloud Drive > Shortcuts > Training HQ); the Mac looks there every few minutes, reads any file that is new
// or changed, and stores one 'health' record per date (<YYYY-MM-DD>) that reaches the phone by sync. The Mac only
// reads that folder: it never changes or deletes his files. A file picked on the phone can be sent here too
// (POST /api/apple-health/upload), for when the folder can't be read. What happened is kept in 'health-meta/status'.
// Wed 10/21: iCloud brought a file made at 8:46 PM to the Mac at 10:04 PM, while he was out walking. So the Shortcut
// also sends its file straight here over Tailscale (POST /api/apple-health/push, its own private link: seconds, also
// on mobile data); the iCloud copy stays as the backup and only adds when it arrives late.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { linkSecret } from './link-secret.mjs';
import { parseHealthFile, healthDays, mergeDay } from '../app/js/lib/health.js';
import { formatDay, formatTime, isoDate } from '../app/js/lib/time.js';

// Every file that reached the Mac with samples, {at, from}, newest last (Wed 10/21: so the coach can say how often the
// Shortcut really sent). Server-only meta; the last 300 are kept (a few days of app-open runs).
const SENDS = 'health:sends';

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
  const secret = linkSecret(store, 'health:secret');
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
    if (parsed.samples.length) store.setMeta(SENDS, [...(store.getMeta(SENDS) || []), { at: now(), from }].slice(-300));
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
    // The status shows the newest export: the iCloud copy of a file the Shortcut already sent doesn't replace it.
    const shown = one('health-meta', 'status')?.last;
    const newer = last && !(shown?.at >= last.at);
    return setStatus({ folder: dir, folderFound: true, files: names.length, error, ...(newer ? { last } : {}) });
  }

  /** A file sent from the phone (picked in the Files app). */
  function upload(text, name = 'health.json') {
    const last = importText(text, { name, from: 'phone' });
    if (last.samples) setStatus({ last }); // a file that couldn't be read leaves the last good one on the screen
    return last;
  }

  /** The Shortcut's own link (the phone adds the Mac address it already uses). */
  const link = ({ renew = false } = {}) => ({ path: `/api/apple-health/push?k=${secret.get(renew)}` });

  /** The Shortcut sent its file straight here. `check` first (403 on a wrong link), then `receive` the text. */
  function receive(text) {
    const last = importText(text, { name: 'health.txt', from: 'shortcut' });
    if (last.samples) setStatus({ last });
    return last;
  }

  return { scan, upload, importText, link, check: (k) => secret.check(k), receive, dir };
}

/**
 * What reached the Mac from Apple Health since `since`, in his words, for the coach's "are your steps counted?" check
 * (Wed 10/21): how often the Shortcut sent straight to the Mac, what iCloud brought, and today's steps.
 */
export function healthSendsText(store, { since = 0, now = Date.now(), tz }) {
  const sends = (store.getMeta(SENDS) || []).filter((x) => x.at >= since);
  const direct = sends.filter((x) => x.from === 'shortcut');
  const icloud = sends.filter((x) => x.from === 'folder').length;
  const at = (ms) => `${formatDay(new Date(ms), tz)}, ${formatTime(new Date(ms), tz)}`;
  const parts = [direct.length
    ? `Since ${at(since)} your phone sent Health straight to the Mac ${direct.length === 1 ? 'once' : `${direct.length} times`}, last at ${formatTime(new Date(direct.at(-1).at), tz)}.`
    : `Since ${at(since)} your phone sent nothing straight to the Mac.`];
  if (icloud) parts.push(`iCloud brought ${icloud} more.`);
  const today = store.getRecord('health', isoDate(new Date(now), tz));
  if (today && !today.deleted && today.data?.steps != null) parts.push(`Steps today on the Mac: ${today.data.steps.toLocaleString('en-US')}.`);
  return parts.join(' ');
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
