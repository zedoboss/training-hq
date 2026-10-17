import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { APP_DIR } from '../server/config.mjs';
import { openRepo, memoryAdapter } from '../app/js/lib/repo.js';
import { syncOnce } from '../app/js/lib/sync.js';

let dir, store, server, base;

async function startServer(file) {
  store = openStore(file);
  server = createApp({ store, appDir: APP_DIR });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stopServer() {
  await new Promise((r) => server.close(r));
  store.close();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'thq-sync-'));
  await startServer(join(dir, 'a.sqlite'));
});
afterEach(async () => {
  await stopServer();
  rmSync(dir, { recursive: true, force: true });
});

/** A device: its own storage, paired with the server, with a switch to simulate losing the connection. */
async function device(name) {
  const repo = await openRepo(memoryAdapter());
  const { code } = store.createPairingCode();
  const res = await fetch(`${base}/api/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceId: repo.device, name }),
  }).then((r) => r.json());
  await repo.setMeta('epoch', res.epoch);
  const d = {
    repo,
    online: true,
    dropNextReply: false,
    async post(path, body) {
      if (!d.online) throw new TypeError('fetch failed');
      const r = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${res.token}` },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (d.dropNextReply) { d.dropNextReply = false; throw new TypeError('connection reset'); }
      return { status: r.status, json };
    },
    sync() { return syncOnce({ repo, post: d.post }); },
  };
  return d;
}

test('two devices converge', async () => {
  const phone = await device('iPhone');
  const mac = await device('Mac browser');
  await phone.repo.put('sets', 's1', { kg: 43.8, reps: 8 });
  await mac.repo.put('notes', 'n1', { text: 'shoulder 0/10' });
  assert.equal((await phone.sync()).ok, true);
  assert.equal((await mac.sync()).ok, true);
  await phone.sync();
  assert.deepEqual(await mac.repo.get('sets', 's1'), { kg: 43.8, reps: 8 });
  assert.deepEqual(await phone.repo.get('notes', 'n1'), { text: 'shoulder 0/10' });
  assert.equal(await phone.repo.pendingCount(), 0);
});

test('sets logged with no connection stay queued and arrive later', async () => {
  const phone = await device('iPhone');
  phone.online = false;
  for (let i = 1; i <= 6; i++) await phone.repo.put('sets', `gym${i}`, { kg: 43.8, reps: 8, n: i });
  const r = await phone.sync();
  assert.equal(r.reason, 'unreachable');
  assert.equal(await phone.repo.pendingCount(), 6, 'nothing dropped while offline');
  phone.online = true;
  assert.equal((await phone.sync()).ok, true);
  assert.equal(store.listRecords('sets').length, 6);
  assert.equal(await phone.repo.pendingCount(), 0);
});

test('a lost reply means a resend, never a lost or doubled set', async () => {
  const phone = await device('iPhone');
  await phone.repo.put('sets', 's1', { kg: 41.3, reps: 12 });
  phone.dropNextReply = true;
  const r1 = await phone.sync();
  assert.equal(r1.ok, false);
  assert.equal(await phone.repo.pendingCount(), 1, 'still queued because the Mac never confirmed');
  assert.equal((await phone.sync()).ok, true);
  assert.equal(store.historyFor('sets', 's1').length, 1, 'stored once');
});

test('same set edited on both devices: both end with the newer edit; the older is kept in history', async () => {
  const phone = await device('iPhone');
  const mac = await device('Mac browser');
  await phone.repo.put('sets', 's1', { kg: 40, reps: 12 });
  await phone.sync();
  await mac.sync();
  phone.online = false;
  await phone.repo.put('sets', 's1', { kg: 41.3, reps: 12 }); // at the gym
  await new Promise((r) => setTimeout(r, 5));
  await mac.repo.put('sets', 's1', { kg: 41.3, reps: 10 }); // corrected later on the Mac
  await mac.sync();
  phone.online = true;
  await phone.sync();
  await mac.sync();
  assert.deepEqual(await phone.repo.get('sets', 's1'), { kg: 41.3, reps: 10 });
  assert.deepEqual(await mac.repo.get('sets', 's1'), { kg: 41.3, reps: 10 });
  assert.equal(store.historyFor('sets', 's1').length, 3);
});

test('the Mac database is lost: the phone restores everything it holds', async () => {
  const phone = await device('iPhone');
  for (let i = 0; i < 5; i++) await phone.repo.put('sets', `s${i}`, { i });
  await phone.sync();
  // Replace the Mac's database with an empty one (same token table is gone too, so re-pair).
  await stopServer();
  await startServer(join(dir, 'b.sqlite'));
  const fresh = await device('iPhone again');
  // Move the phone's data into the re-paired device's storage by syncing the old repo under the new pairing.
  fresh.repo = phone.repo;
  const r = await syncOnce({ repo: phone.repo, post: fresh.post });
  assert.equal(r.ok, true);
  assert.equal(store.listRecords('sets').length, 5);
});

test('unpaired device is told so and keeps its data', async () => {
  const phone = await device('iPhone');
  await phone.repo.put('sets', 's1', { kg: 1 });
  store.revokeDevice(phone.repo.device);
  const r = await phone.sync();
  assert.equal(r.reason, 'unpaired');
  assert.equal(await phone.repo.pendingCount(), 1);
});

test('large pulls are paged until caught up', async () => {
  const mac = await device('Mac browser');
  for (let i = 0; i < 2300; i++) store.writeLocal('history', `h${i}`, { i });
  const phone = await device('iPhone');
  const r = await phone.sync();
  assert.equal(r.ok, true);
  assert.equal(r.pulled, 2300);
  assert.equal((await phone.repo.list('history')).length, 2300);
  assert.ok(mac);
});
