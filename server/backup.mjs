// Nightly backup (2.21): every record of the Mac's database as JSON in the private folder (data/backup/), committed
// to that folder's local git together with the demo clips. Git keeps the history, so any night can be restored.
// One file per collection, one record per line (small diffs); photos and other big records get a file each, so
// adding one photo doesn't rewrite all of them. Deleted records are kept as markers, as in the database.
// Restore into an empty database: node server/restore.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isoDate } from '../app/js/lib/time.js';

const BIG = 100 * 1024;
const SPLIT_COLS = new Set(['photos', 'meal-photos', 'body-photos']);
const safe = (id) => id.replace(/[^A-Za-z0-9_.-]/g, '_');

/** Write the backup files. Returns {collections, records, files}. */
export function writeBackup(store, dir) {
  mkdirSync(dir, { recursive: true });
  const rows = store.db.prepare('SELECT col, id, data, deleted, hlc, device FROM records ORDER BY col, id').all();
  const byCol = new Map();
  for (const r of rows) {
    const rec = { col: r.col, id: r.id, deleted: !!r.deleted, hlc: r.hlc, device: r.device, data: r.data == null ? null : JSON.parse(r.data) };
    if (!byCol.has(r.col)) byCol.set(r.col, []);
    byCol.get(r.col).push({ rec, size: r.data?.length ?? 0 });
  }
  const keep = new Set();
  let files = 0;
  for (const [col, list] of byCol) {
    const small = []; const big = [];
    for (const x of list) (SPLIT_COLS.has(col) || x.size > BIG ? big : small).push(x.rec);
    if (small.length) {
      writeFileSync(join(dir, `${col}.json`), `[\n${small.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
      keep.add(`${col}.json`); files++;
    }
    if (big.length) {
      const sub = join(dir, col);
      mkdirSync(sub, { recursive: true });
      const names = new Set(big.map((r) => `${safe(r.id)}.json`));
      for (const r of big) {
        const f = join(sub, `${safe(r.id)}.json`);
        const text = `${JSON.stringify(r)}\n`;
        if (!existsSync(f) || readFileSync(f, 'utf8') !== text) writeFileSync(f, text);
        files++;
      }
      for (const f of readdirSync(sub)) if (!names.has(f)) rmSync(join(sub, f));
      keep.add(col);
    }
  }
  // Collections that no longer exist lose their files.
  for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f), { recursive: true, force: true });
  return { collections: byCol.size, records: rows.length, files };
}

/** Every record in a backup folder. */
export function readBackup(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith('.json')) out.push(...JSON.parse(readFileSync(p, 'utf8')));
    else for (const g of readdirSync(p)) if (g.endsWith('.json')) out.push(JSON.parse(readFileSync(join(p, g), 'utf8')));
  }
  return out;
}

const gitBin = () => ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'].find((g) => existsSync(g)) || 'git';

/**
 * Commit the backup and the demo clips in the private folder's git (local only; nothing is pushed).
 * Only these paths are committed, so other uncommitted work in the folder is left alone.
 * @returns {'committed'|'unchanged'|'no-git'|string} a short outcome, or the git error
 */
export function commitBackup(privateDir, message, paths = ['data/backup', 'data/demos']) {
  if (!existsSync(join(privateDir, '.git'))) return 'no-git';
  const git = (...args) => spawnSync(gitBin(), ['-C', privateDir, ...args], { encoding: 'utf8' });
  const present = paths.filter((p) => existsSync(join(privateDir, p)));
  if (!present.length) return 'unchanged';
  const add = git('add', '-A', '--', ...present);
  if (add.status !== 0) return `git add failed: ${add.stderr.trim()}`;
  // An empty folder (no clips yet) is unknown to git and can't be named in the commit.
  const known = present.filter((p) => git('ls-files', '--', p).stdout.trim() || git('ls-files', '--deleted', '--', p).stdout.trim() || git('diff', '--cached', '--name-only', '--', p).stdout.trim());
  if (!known.length || git('diff', '--cached', '--quiet', '--', ...known).status === 0) return 'unchanged';
  const c = git('commit', '-q', '-m', message, '--', ...known);
  return c.status === 0 ? 'committed' : `git commit failed: ${c.stderr.trim() || c.stdout.trim()}`;
}

/** Milliseconds until the next local `hour`:00. */
export function msUntil(hour, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

/**
 * Run the backup every night at `hour` (local time), and once at start if the last one is over a day old.
 * @returns {() => void} stop
 */
export function scheduleNightly({ store, privateDir, backupDir, hour = 1, log = () => {}, now = () => Date.now() }) {
  let timer = null;
  const run = () => backupNow({ store, privateDir, backupDir, log, now });
  const plan = () => { timer = setTimeout(() => { run(); plan(); }, msUntil(hour)); timer.unref?.(); };
  const last = store.getMeta('lastBackup');
  if (!last || now() - last.at > 24 * 3600 * 1000) run();
  plan();
  return () => clearTimeout(timer);
}

/** One backup: write the files and commit them. Returns the outcome. */
export function backupNow({ store, privateDir, backupDir, log = () => {}, now = () => Date.now() }) {
  try {
    const r = writeBackup(store, backupDir);
    const day = isoDate(new Date(now()));
    const outcome = commitBackup(privateDir, `Nightly backup ${day}: ${r.records} records in ${r.collections} collections`);
    // A failed commit doesn't count as done: the next start tries again.
    if (!/failed/.test(outcome)) store.setMeta('lastBackup', { at: now(), ...r, outcome });
    log(`backup: ${r.records} records, ${r.files} files, ${outcome}`);
    return outcome;
  } catch (e) {
    log(`backup failed: ${e.stack || e}`);
    return `failed: ${e.message}`;
  }
}
