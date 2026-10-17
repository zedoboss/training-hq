import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { openDemos, extForType, validDemoId } from '../server/demos.mjs';
import { APP_DIR } from '../server/config.mjs';

let dir, store, demos, server, base, token;
const clip = Buffer.from('fake-mp4-bytes-for-a-test');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'thq-demos-'));
  store = openStore(join(dir, 'test.sqlite'));
  demos = openDemos(join(dir, 'demos'), store);
  server = createApp({ store, appDir: APP_DIR, demos });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const { code } = store.createPairingCode();
  token = (await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceId: 'a1b2c3d4e5f6', name: 'iPhone' }) })).json()).token;
});
after(() => { server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });

const up = (id, body, type = 'video/mp4', t = token) => fetch(`${base}/api/demo?id=${encodeURIComponent(id)}`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': type }, body });

test('names and types', () => {
  assert.equal(extForType('video/mp4'), 'mp4');
  assert.equal(extForType('video/webm;codecs=vp9'), 'webm');
  assert.equal(extForType('video/quicktime'), 'mov');
  assert.equal(extForType('image/png'), null);
  assert.ok(validDemoId('squat-smith-machine'));
  assert.ok(!validDemoId('../etc/passwd'));
  assert.ok(!validDemoId('Squat'));
});

test('upload needs a token, saves <exercise id>.<type> and a synced record', async () => {
  assert.equal((await up('squat-smith-machine', clip, 'video/mp4', 'nope')).status, 401);
  assert.equal((await up('../evil', clip)).status, 400);
  assert.equal((await up('squat-smith-machine', clip, 'image/png')).status, 415);
  const res = await up('squat-smith-machine', clip);
  assert.equal(res.status, 200);
  const rec = await res.json();
  assert.equal(rec.file, 'squat-smith-machine.mp4');
  assert.equal(rec.bytes, clip.length);
  assert.ok(existsSync(join(dir, 'demos', 'squat-smith-machine.mp4')));
  assert.equal(store.getRecord('demos', 'squat-smith-machine').data.file, 'squat-smith-machine.mp4');
});

test('fetch returns the video; a replacement of another type removes the old file', async () => {
  const got = await fetch(`${base}/api/demo?id=squat-smith-machine`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), clip);
  assert.equal((await fetch(`${base}/api/demo?id=squat-smith-machine`)).status, 401);
  assert.equal((await fetch(`${base}/api/demo?id=no-such`, { headers: { authorization: `Bearer ${token}` } })).status, 404);
  await up('squat-smith-machine', Buffer.from('webm'), 'video/webm');
  assert.deepEqual(readdirSync(join(dir, 'demos')).filter((f) => !f.startsWith('.')), ['squat-smith-machine.webm']);
});

test('clips copied into the folder by hand are picked up by a rescan; removed ones lose their record', async () => {
  writeFileSync(join(dir, 'demos', 'leg-extension-machine.mp4'), clip);
  writeFileSync(join(dir, 'demos', 'Not A Rule Name.mp4'), clip);
  const scan = await (await fetch(`${base}/api/demos`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(scan.clips, 2);
  assert.equal(store.getRecord('demos', 'leg-extension-machine').data.type, 'video/mp4');
  unlinkSync(join(dir, 'demos', 'leg-extension-machine.mp4'));
  assert.equal(demos.rescan().removed, 1);
  assert.equal(store.getRecord('demos', 'leg-extension-machine').deleted, true);
});

test('delete removes the file and marks the record deleted', async () => {
  const res = await fetch(`${base}/api/demo/delete`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'squat-smith-machine' }) });
  assert.deepEqual(await res.json(), { removed: true });
  assert.equal(store.getRecord('demos', 'squat-smith-machine').deleted, true);
  assert.deepEqual(readdirSync(join(dir, 'demos')).filter((f) => f.endsWith('.webm')), []);
});
