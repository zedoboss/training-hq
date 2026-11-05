// The phone's local data: every record is {col, id, data, deleted, hlc, device}.
// Local writes go into the record store and the outbox together, so nothing waits only in memory.
// The outbox is emptied only after the Mac confirms it has stored the changes.
// Works over any storage adapter: IndexedDB in the app (idb.js), memory in tests (memoryAdapter below).
import { createClock, newDeviceId, newer } from './hlc.js';
import { LOGGED_COLS, withZone, deviceTimeZone } from './time.js';

export async function openRepo(adapter) {
  let device = await adapter.getMeta('deviceId');
  if (!device) {
    device = newDeviceId();
    await adapter.setMeta('deviceId', device);
  }
  const clock = createClock(device, (await adapter.getMeta('clock')) || undefined);
  const listeners = new Set();
  // origin: 'local' for writes on this device, 'remote' for changes that arrived by sync.
  const changed = (cols, origin) => { for (const fn of listeners) fn(cols, origin); };

  // Thu 11/5 (opening an exercise and going back to the workout took about a second): each screen read his whole
  // history (8,000+ sets) from storage again. A collection read once is kept in memory and kept in step with every
  // write here and every change from the Mac; callers get copies, so nothing they change touches the kept one.
  // Photo collections (large pictures) are always read from storage.
  const lists = new Map();
  const keeps = (col) => !/photo/i.test(col);
  const kept = (col) => {
    if (!keeps(col)) return null;
    let p = lists.get(col);
    if (!p) {
      p = adapter.listRecords(col).then((recs) => new Map(recs.filter((r) => !r.deleted).map((r) => [r.id, r.data])));
      lists.set(col, p);
      p.catch(() => { if (lists.get(col) === p) lists.delete(col); });
    }
    return p;
  };
  const copy = (v) => (v == null ? v : structuredClone(v));

  async function write(col, id, data, deleted) {
    const rec = { col, id, data: deleted ? null : data, deleted, hlc: clock.tick(), device };
    await adapter.writeLocal(rec, clock.state());
    const p = lists.get(col);
    if (p) {
      const value = copy(rec.data);
      // Runs after the read in flight (if any), so this write is never lost from the kept list.
      await p.then((m) => { if (deleted) m.delete(id); else m.set(id, value); }, () => {});
    }
    changed([col], 'local');
    return rec;
  }

  return {
    device,
    /** A new record of a logged collection gets this device's time zone (A3); an existing one keeps what it has. */
    async put(col, id, data) {
      if (LOGGED_COLS.has(col) && data && typeof data === 'object' && !data.tz) {
        const cur = await adapter.getRecord(col, id);
        if (!cur || cur.deleted || !cur.data) data = withZone(col, data, deviceTimeZone());
        else if (cur.data.tz) data = { ...data, tz: cur.data.tz };
      }
      return write(col, id, data, false);
    },
    remove: (col, id) => write(col, id, null, true),
    async get(col, id) {
      if (lists.has(col)) { const m = await kept(col).catch(() => null); if (m) return copy(m.get(id) ?? null); }
      const r = await adapter.getRecord(col, id);
      return r && !r.deleted ? r.data : null;
    },
    async list(col) {
      const p = kept(col);
      if (!p) return (await adapter.listRecords(col)).filter((r) => !r.deleted).map((r) => r.data);
      return structuredClone([...(await p).values()]);
    },
    /** The records of `col` that pass `keep`, copied (only those: a workout's sets, not all 8,000; Thu 11/5). */
    async where(col, keep) {
      const p = kept(col);
      if (!p) return (await adapter.listRecords(col)).filter((r) => !r.deleted).map((r) => r.data).filter(keep);
      return structuredClone([...(await p).values()].filter(keep));
    },
    /** Read these collections from storage again next time (another tab of the app wrote them). */
    forget(cols) { for (const c of cols) lists.delete(c); },
    cols: () => adapter.listCols(),
    outbox: () => adapter.listOutbox(),
    pendingCount: async () => (await adapter.listOutbox()).length,
    ack: (keys) => adapter.removeOutbox(keys),
    /** Apply records from the Mac. A remote version only replaces a local one if its stamp is newer. */
    async applyRemote(records) {
      for (const r of records) clock.receive(r.hlc);
      const cols = await adapter.applyRemote(records, newer, clock.state());
      for (const c of cols) lists.delete(c);
      if (cols.length) changed(cols, 'remote');
      return cols;
    },
    /** Queue every local record again (used when the Mac's database was replaced: the phone restores it). */
    requeueAll: () => adapter.requeueAll(),
    getMeta: (k) => adapter.getMeta(k),
    setMeta: (k, v) => adapter.setMeta(k, v),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** In-memory adapter with the same behaviour as the IndexedDB one. Used by tests. */
export function memoryAdapter() {
  const records = new Map();
  const outbox = new Map();
  const meta = new Map();
  let nextKey = 1;
  const k = (col, id) => `${col}\u0000${id}`;
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  return {
    async getMeta(key) { return clone(meta.get(key)); },
    async setMeta(key, v) { meta.set(key, clone(v)); },
    async getRecord(col, id) { return clone(records.get(k(col, id))); },
    async listRecords(col) { return [...records.values()].filter((r) => r.col === col).map(clone); },
    async listCols() { return [...new Set([...records.values()].map((r) => r.col))].sort(); },
    async writeLocal(rec, clockState) {
      records.set(k(rec.col, rec.id), clone(rec));
      outbox.set(nextKey++, clone(rec));
      meta.set('clock', clockState);
    },
    async listOutbox() { return [...outbox.entries()].map(([key, rec]) => ({ key, rec: clone(rec) })); },
    async removeOutbox(keys) { for (const key of keys) outbox.delete(key); },
    async requeueAll() { for (const r of records.values()) outbox.set(nextKey++, clone(r)); return records.size; },
    async applyRemote(recs, isNewer, clockState) {
      const cols = new Set();
      for (const r of recs) {
        const cur = records.get(k(r.col, r.id));
        if (isNewer(r, cur)) { records.set(k(r.col, r.id), clone(r)); cols.add(r.col); }
      }
      meta.set('clock', clockState);
      return [...cols];
    },
    _dump: () => ({ records, outbox, meta }),
  };
}
