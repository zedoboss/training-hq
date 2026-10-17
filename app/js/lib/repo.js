// The phone's local data: every record is {col, id, data, deleted, hlc, device}.
// Local writes go into the record store and the outbox together, so nothing waits only in memory.
// The outbox is emptied only after the Mac confirms it has stored the changes.
// Works over any storage adapter: IndexedDB in the app (idb.js), memory in tests (memoryAdapter below).
import { createClock, newDeviceId, newer } from './hlc.js';

export async function openRepo(adapter) {
  let device = await adapter.getMeta('deviceId');
  if (!device) {
    device = newDeviceId();
    await adapter.setMeta('deviceId', device);
  }
  const clock = createClock(device, (await adapter.getMeta('clock')) || undefined);
  const listeners = new Set();
  const changed = (cols) => { for (const fn of listeners) fn(cols); };

  async function write(col, id, data, deleted) {
    const rec = { col, id, data: deleted ? null : data, deleted, hlc: clock.tick(), device };
    await adapter.writeLocal(rec, clock.state());
    changed([col]);
    return rec;
  }

  return {
    device,
    put: (col, id, data) => write(col, id, data, false),
    remove: (col, id) => write(col, id, null, true),
    async get(col, id) {
      const r = await adapter.getRecord(col, id);
      return r && !r.deleted ? r.data : null;
    },
    async list(col) {
      return (await adapter.listRecords(col)).filter((r) => !r.deleted).map((r) => r.data);
    },
    outbox: () => adapter.listOutbox(),
    pendingCount: async () => (await adapter.listOutbox()).length,
    ack: (keys) => adapter.removeOutbox(keys),
    /** Apply records from the Mac. A remote version only replaces a local one if its stamp is newer. */
    async applyRemote(records) {
      for (const r of records) clock.receive(r.hlc);
      const cols = await adapter.applyRemote(records, newer, clock.state());
      if (cols.length) changed(cols);
      return cols;
    },
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
    async writeLocal(rec, clockState) {
      records.set(k(rec.col, rec.id), clone(rec));
      outbox.set(nextKey++, clone(rec));
      meta.set('clock', clockState);
    },
    async listOutbox() { return [...outbox.entries()].map(([key, rec]) => ({ key, rec: clone(rec) })); },
    async removeOutbox(keys) { for (const key of keys) outbox.delete(key); },
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
