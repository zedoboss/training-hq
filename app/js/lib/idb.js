// IndexedDB storage adapter for repo.js. One database, three stores:
//   records: current version of every record, keyed [col, id]
//   outbox:  local changes not yet confirmed by the Mac
//   meta:    device id, clock state, pairing, last sync position
const DB_NAME = 'training-hq';
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const recs = db.createObjectStore('records', { keyPath: ['col', 'id'] });
      recs.createIndex('col', 'col');
      db.createObjectStore('outbox', { autoIncrement: true });
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});
const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function idbAdapter() {
  const db = await openDb();
  // Ask the browser not to clear this storage under pressure. Home Screen apps are normally granted this.
  navigator.storage?.persist?.().catch(() => {});

  return {
    async getMeta(k) {
      return result(db.transaction('meta').objectStore('meta').get(k));
    },
    async setMeta(k, v) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(v, k);
      await done(tx);
    },
    async getRecord(col, id) {
      return result(db.transaction('records').objectStore('records').get([col, id]));
    },
    async listRecords(col) {
      return result(db.transaction('records').objectStore('records').index('col').getAll(col));
    },
    // Record, outbox entry and clock state are written in one transaction: all or nothing.
    async writeLocal(rec, clockState) {
      const tx = db.transaction(['records', 'outbox', 'meta'], 'readwrite');
      tx.objectStore('records').put(rec);
      tx.objectStore('outbox').add(rec);
      tx.objectStore('meta').put(clockState, 'clock');
      await done(tx);
    },
    async listOutbox() {
      const tx = db.transaction('outbox');
      const store = tx.objectStore('outbox');
      const [keys, recs] = await Promise.all([result(store.getAllKeys()), result(store.getAll())]);
      return keys.map((key, i) => ({ key, rec: recs[i] }));
    },
    async removeOutbox(keys) {
      const tx = db.transaction('outbox', 'readwrite');
      for (const k of keys) tx.objectStore('outbox').delete(k);
      await done(tx);
    },
    async requeueAll() {
      const tx = db.transaction(['records', 'outbox'], 'readwrite');
      const all = tx.objectStore('records').getAll();
      let n = 0;
      all.onsuccess = () => {
        for (const r of all.result) { tx.objectStore('outbox').add(r); n++; }
      };
      await done(tx);
      return n;
    },
    // Callbacks rather than await inside the transaction: Safari can close a transaction across awaits.
    async applyRemote(recs, isNewer, clockState) {
      const tx = db.transaction(['records', 'meta'], 'readwrite');
      const store = tx.objectStore('records');
      const cols = new Set();
      for (const r of recs) {
        const get = store.get([r.col, r.id]);
        get.onsuccess = () => {
          if (isNewer(r, get.result)) { store.put(r); cols.add(r.col); }
        };
      }
      tx.objectStore('meta').put(clockState, 'clock');
      await done(tx);
      return [...cols];
    },
  };
}
