// The Mac's database (built-in node:sqlite). Holds:
//   records: the current version of every record
//   history: every version ever received, never deleted; sync position = its seq
//   devices: paired devices (only a hash of each token is stored)
//   pairing_codes: one-time 6-digit codes (hashed), 10 minutes each
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createClock, newer, isDeviceId } from '../app/js/lib/hlc.js';

export const MAC_DEVICE = 'macserver000';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const COL_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const HLC_RE = /^\d{13}-\d{6}-[0-9a-z]{12}$/;

export function openStore(file, { now = () => Date.now() } = {}) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS records (
      col TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0,
      hlc TEXT NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (col, id));
    CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
    CREATE TABLE IF NOT EXISTS history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT,
      deleted INTEGER NOT NULL, hlc TEXT NOT NULL, device TEXT NOT NULL,
      received_at INTEGER NOT NULL, from_device TEXT NOT NULL, UNIQUE (col, id, hlc));
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL, last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `);

  const getMeta = (k) => {
    const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
    return row ? JSON.parse(row.v) : undefined;
  };
  const setMeta = (k, v) => db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));

  const clock = createClock(MAC_DEVICE, getMeta('clock'), now);
  // A random id for this database. If the Mac's database is ever replaced, devices see a new epoch,
  // pull everything again and re-send everything they hold, so the phone's copy restores the Mac.
  if (!getMeta('epoch')) setMeta('epoch', randomBytes(8).toString('hex'));

  const q = {
    insHistory: db.prepare(`INSERT OR IGNORE INTO history (col, id, data, deleted, hlc, device, received_at, from_device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    getRecord: db.prepare('SELECT col, id, data, deleted, hlc, device, seq FROM records WHERE col = ? AND id = ?'),
    upsert: db.prepare(`INSERT INTO records (col, id, data, deleted, hlc, device, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(col, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted, hlc = excluded.hlc,
      device = excluded.device, seq = excluded.seq`),
    since: db.prepare('SELECT col, id, data, deleted, hlc, device, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?'),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM records'),
  };

  const toRecord = (row) => row && ({
    col: row.col, id: row.id, data: row.data == null ? null : JSON.parse(row.data),
    deleted: !!row.deleted, hlc: row.hlc, device: row.device, seq: row.seq,
  });

  function validate(c) {
    if (!c || typeof c !== 'object') return 'not an object';
    if (!COL_RE.test(c.col ?? '')) return 'bad col';
    if (!ID_RE.test(c.id ?? '')) return 'bad id';
    if (!HLC_RE.test(c.hlc ?? '')) return 'bad hlc';
    if (!isDeviceId(c.device)) return 'bad device';
    if (!c.hlc.endsWith(c.device)) return 'hlc device mismatch';
    if (!c.deleted && (c.data === undefined)) return 'missing data';
    return null;
  }

  /** Store incoming changes. Every new version goes into history; it becomes current only if newer. */
  function applyChanges(changes, fromDevice) {
    let stored = 0; let duplicates = 0; let current = 0;
    const rejected = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const c of changes) {
        const err = validate(c);
        if (err) { rejected.push({ col: c?.col, id: c?.id, hlc: c?.hlc, error: err }); continue; }
        clock.receive(c.hlc);
        const data = c.deleted ? null : JSON.stringify(c.data);
        const info = q.insHistory.run(c.col, c.id, data, c.deleted ? 1 : 0, c.hlc, c.device, now(), fromDevice);
        if (info.changes === 0) { duplicates++; continue; }
        stored++;
        const seq = Number(info.lastInsertRowid);
        const cur = toRecord(q.getRecord.get(c.col, c.id));
        if (newer(c, cur)) {
          q.upsert.run(c.col, c.id, data, c.deleted ? 1 : 0, c.hlc, c.device, seq);
          current++;
        }
      }
      setMeta('clock', clock.state());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { stored, duplicates, current, rejected };
  }

  /** A change made on the Mac itself (seed data, coach tools later). */
  function writeLocal(col, id, data, { deleted = false } = {}) {
    const rec = { col, id, data: deleted ? null : data, deleted, hlc: clock.tick(), device: MAC_DEVICE };
    applyChanges([rec], MAC_DEVICE);
    return rec;
  }

  /** Many changes made on the Mac in one transaction (an import). items: [{col, id, data, deleted}] */
  function writeLocalMany(items) {
    const recs = items.map(({ col, id, data, deleted = false }) => ({ col, id, data: deleted ? null : data, deleted, hlc: clock.tick(), device: MAC_DEVICE }));
    const r = applyChanges(recs, MAC_DEVICE);
    if (r.rejected.length) throw new Error(`write rejected: ${JSON.stringify(r.rejected[0])}`);
    return recs;
  }

  /** Records changed after `since`, up to `limit` records and about `maxBytes` of data (photos), at least one. */
  function changesSince(since, limit = 2000, maxBytes = 4 * 1024 * 1024) {
    const rows = q.since.all(since, limit + 1);
    let n = 0; let bytes = 0;
    while (n < Math.min(rows.length, limit)) {
      const size = rows[n].data?.length ?? 0;
      if (n && bytes + size > maxBytes) break;
      bytes += size; n++;
    }
    const more = rows.length > n;
    const records = rows.slice(0, n).map(toRecord);
    const seq = records.length ? records[records.length - 1].seq : Math.max(since, 0);
    return { records, seq, more };
  }

  // ---- devices and pairing ----
  function createPairingCode(ttlMs = 10 * 60 * 1000) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare('DELETE FROM pairing_codes WHERE expires_at < ? OR used = 1').run(now());
    db.prepare('INSERT OR REPLACE INTO pairing_codes (code_hash, expires_at, used) VALUES (?, ?, 0)').run(sha(code), now() + ttlMs);
    return { code, expiresAt: now() + ttlMs };
  }

  function redeemPairingCode(code, deviceId, name) {
    if (!/^\d{6}$/.test(code ?? '') || !isDeviceId(deviceId)) return null;
    const row = db.prepare('SELECT expires_at, used FROM pairing_codes WHERE code_hash = ?').get(sha(code));
    if (!row || row.used || row.expires_at < now()) return null;
    const token = randomBytes(32).toString('base64url');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE pairing_codes SET used = 1 WHERE code_hash = ?').run(sha(code));
      db.prepare(`INSERT INTO devices (id, name, token_hash, created_at, last_seen, revoked) VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, token_hash = excluded.token_hash, revoked = 0, last_seen = excluded.last_seen`)
        .run(deviceId, String(name || 'Device').slice(0, 60), sha(token), now(), now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return token;
  }

  function deviceForToken(token) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const h = sha(token);
    const row = db.prepare('SELECT id, name, token_hash, revoked FROM devices WHERE token_hash = ?').get(h);
    if (!row || row.revoked) return null;
    if (!timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(h))) return null;
    db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), row.id);
    return { id: row.id, name: row.name };
  }

  const listDevices = () => db.prepare('SELECT id, name, created_at, last_seen, revoked FROM devices ORDER BY created_at').all();
  const revokeDevice = (id) => db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(id).changes > 0;

  return {
    db, applyChanges, writeLocal, writeLocalMany, changesSince,
    getRecord: (col, id) => toRecord(q.getRecord.get(col, id)),
    listRecords: (col) => db.prepare('SELECT col, id, data, deleted, hlc, device, seq FROM records WHERE col = ? AND deleted = 0 ORDER BY id').all(col).map(toRecord),
    historyFor: (col, id) => db.prepare('SELECT seq, data, deleted, hlc, device, from_device FROM history WHERE col = ? AND id = ? ORDER BY seq').all(col, id),
    maxSeq: () => q.maxSeq.get().s,
    createPairingCode, redeemPairingCode, deviceForToken, listDevices, revokeDevice,
    getMeta, setMeta,
    epoch: () => getMeta('epoch'),
    close: () => db.close(),
  };
}
