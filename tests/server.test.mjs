import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { APP_DIR } from '../server/config.mjs';
import { formatHlc } from '../app/js/lib/hlc.js';

const PAGES = 'https://example.github.io';
const DEV = 'a1b2c3d4e5f6';
const DEV2 = '0f0f0f0f0f0f';
let dir, store, server, base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'thq-server-'));
  store = openStore(join(dir, 'test.sqlite'));
  server = createApp({ store, appDir: APP_DIR, allowedOrigins: [PAGES] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method, path, { token, body, origin } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
};
const rec = (id, data, wall, device = DEV, extra = {}) =>
  ({ col: 'sets', id, data, deleted: false, hlc: formatHlc(wall, 0, device), device, ...extra });

let token;

test('health answers without a token; everything else needs one', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.equal((await call('POST', '/api/sync', { body: {} })).status, 401);
  assert.equal((await call('GET', '/api/whoami', { token: 'made-up' })).status, 401);
});

test('pairing: a code works once; wrong codes are refused', async () => {
  const { code } = store.createPairingCode();
  assert.equal((await call('POST', '/api/pair', { body: { code: '000000' === code ? '111111' : '000000', deviceId: DEV, name: 'iPhone' } })).status, 403);
  const ok = await call('POST', '/api/pair', { body: { code, deviceId: DEV, name: 'iPhone' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token.length >= 40);
  assert.ok(ok.json.epoch);
  token = ok.json.token;
  const again = await call('POST', '/api/pair', { body: { code, deviceId: DEV2, name: 'Other' } });
  assert.equal(again.status, 403, 'a used code cannot pair a second device');
  const me = await call('GET', '/api/whoami', { token });
  assert.equal(me.json.device.id, DEV);
});

test('the token itself is never stored, only its hash', () => {
  const rows = store.db.prepare('SELECT token_hash FROM devices').all();
  assert.ok(rows.every((r) => r.token_hash !== token && /^[0-9a-f]{64}$/.test(r.token_hash)));
});

test('CORS: the Pages site and localhost are allowed; other sites are not', async () => {
  const ok = await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { origin: PAGES, 'access-control-request-private-network': 'true' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), PAGES);
  assert.equal(ok.headers.get('access-control-allow-private-network'), 'true');
  const local = await fetch(`${base}/api/health`, { headers: { origin: 'http://localhost:4317' } });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:4317');
  const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('sync: push sets, pull them back, resend is harmless', async () => {
  const epoch = store.epoch();
  const changes = [rec('s1', { kg: 43.8, reps: 8 }, 1000), rec('s2', { kg: 43.8, reps: 8 }, 1001)];
  const r1 = await call('POST', '/api/sync', { token, body: { since: 0, epoch, changes } });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.stored, 2);
  assert.equal(r1.json.records.length, 2);
  // The reply to a sync was lost on the way back, so the phone sends the same changes again.
  const r2 = await call('POST', '/api/sync', { token, body: { since: 0, epoch, changes } });
  assert.equal(r2.json.stored, 0);
  assert.equal(r2.json.duplicates, 2);
  assert.equal(store.historyFor('sets', 's1').length, 1);
  // Nothing new since the last position.
  const r3 = await call('POST', '/api/sync', { token, body: { since: r1.json.seq, epoch, changes: [] } });
  assert.deepEqual(r3.json.records, []);
});

test('conflicting edits: newest wins everywhere, and the losing version is still kept', async () => {
  const epoch = store.epoch();
  const base1 = await call('POST', '/api/sync', { token, body: { since: 0, epoch, changes: [] } });
  // Mac browser edits s1 at t=5000; the phone (offline at the gym) edited it earlier at t=3000 and syncs later.
  await call('POST', '/api/sync', { token, body: { since: base1.json.seq, epoch, changes: [rec('s1', { kg: 45, reps: 8 }, 5000, DEV2)] } });
  const late = await call('POST', '/api/sync', { token, body: { since: base1.json.seq, epoch, changes: [rec('s1', { kg: 44, reps: 9 }, 3000)] } });
  assert.equal(late.json.stored, 1);
  assert.deepEqual(store.getRecord('sets', 's1').data, { kg: 45, reps: 8 });
  const versions = store.historyFor('sets', 's1').map((h) => JSON.parse(h.data));
  assert.deepEqual(versions, [{ kg: 43.8, reps: 8 }, { kg: 45, reps: 8 }, { kg: 44, reps: 9 }]);
  assert.ok(late.json.records.some((r) => r.id === 's1' && r.data.kg === 45), 'the phone is sent the winning version');
});

test('a set logged offline is never lost, even when a delete from another device arrives first', async () => {
  const epoch = store.epoch();
  await call('POST', '/api/sync', { token, body: { epoch, changes: [{ col: 'sets', id: 's9', data: null, deleted: true, hlc: formatHlc(9000, 0, DEV2), device: DEV2 }] } });
  await call('POST', '/api/sync', { token, body: { epoch, changes: [rec('s9', { kg: 63, reps: 15 }, 8000)] } });
  assert.equal(store.getRecord('sets', 's9').deleted, true, 'the later delete wins on screen');
  assert.equal(store.historyFor('sets', 's9').filter((h) => h.data && JSON.parse(h.data).kg === 63).length, 1, 'but the set is kept in history');
});

test('bad changes are rejected one by one without blocking good ones', async () => {
  const epoch = store.epoch();
  const r = await call('POST', '/api/sync', {
    token,
    body: { epoch, changes: [{ col: 'sets', id: '../x', hlc: 'nope', device: DEV }, rec('s20', { kg: 1 }, 20000)] },
  });
  assert.equal(r.json.stored, 1);
  assert.equal(r.json.rejected.length, 1);
});

test('pull is paged', async () => {
  const many = Array.from({ length: 2105 }, (_, i) => rec(`p${i}`, { i }, 100000 + i));
  await call('POST', '/api/sync', { token, body: { epoch: store.epoch(), changes: many } });
  const first = await call('POST', '/api/sync', { token, body: { since: 0, epoch: store.epoch(), changes: [] } });
  assert.equal(first.json.records.length, 2000);
  assert.equal(first.json.more, true);
  const second = await call('POST', '/api/sync', { token, body: { since: first.json.seq, epoch: store.epoch(), changes: [] } });
  assert.equal(second.json.more, false);
  assert.ok(second.json.records.length > 100);
});

test('a device with an old epoch gets everything from the start', async () => {
  const r = await call('POST', '/api/sync', { token, body: { since: 999999, epoch: 'old-epoch', changes: [] } });
  assert.equal(r.json.records.length, 2000);
  assert.equal(r.json.epoch, store.epoch());
});

test('revoked devices are locked out', async () => {
  const { code } = store.createPairingCode();
  const p2 = await call('POST', '/api/pair', { body: { code, deviceId: DEV2, name: 'Mac browser' } });
  const t2 = p2.json.token;
  assert.equal((await call('POST', '/api/devices/revoke', { token, body: { id: DEV2 } })).json.revoked, true);
  assert.equal((await call('GET', '/api/whoami', { token: t2 })).status, 401);
});

test('static app files are served; paths outside the app are not', async () => {
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /text\/html/);
  const font = await fetch(`${base}/fonts/inter-latin-wght-normal.woff2`);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  const escape = await fetch(`${base}/..%2fpackage.json`);
  assert.equal(escape.status, 404);
});

test('too many wrong pairing codes lock pairing for a while', async () => {
  for (let i = 0; i < 6; i++) await call('POST', '/api/pair', { body: { code: '999999', deviceId: DEV2, name: 'x' } });
  const { code } = store.createPairingCode();
  const r = await call('POST', '/api/pair', { body: { code, deviceId: DEV2, name: 'x' } });
  assert.equal(r.status, 429);
});
