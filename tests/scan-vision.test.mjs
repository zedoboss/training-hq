import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openScanVision, readScanAnswer, SYSTEM_SCAN, MAX_TRIES } from '../server/scan-vision.mjs';
import { MODELS } from '../server/claude.mjs';

let dir; let store; let clock;
const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-scanv-')); store = openStore(join(dir, 'db.sqlite')); clock = 1_000_000; });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const put = (col, id, data) => store.writeLocal(col, id, data);
const read = (id) => store.getRecord('scan-reads', id)?.data;
const ANSWER = JSON.stringify({
  scanDate: '2026-10-22', scanTime: '04:41', notes: '',
  metrics: [
    { label: 'Weight', text: '82.4', value: 82.4, unit: 'kg', key: 'weightKg' },
    { label: 'Body Fat %', text: '18.2', value: 18.2, unit: '%', key: 'fatPercent', unsure: true },
    { label: 'Skeletal Muscle Mass', text: '38.1', value: 38.1, unit: 'kg', key: null },
    { label: 'Segmental lean · Right arm', text: '3.9', value: 3.9, unit: 'kg', key: 'nonsense' },
    { label: 'Hydration', text: 'Good', value: null, unit: '', key: null },
  ],
});

test('the answer is checked: labels as printed, keys checked or found from the label, the scan date and time', () => {
  const a = readScanAnswer(`Here it is:\n${ANSWER}`);
  assert.deepEqual(a.metrics.map((m) => [m.label, m.key, m.value, m.text]), [
    ['Weight', 'weightKg', 82.4, '82.4'], ['Body Fat %', 'fatPercent', 18.2, '18.2'], ['Skeletal Muscle Mass', 'muscleMassKg', 38.1, '38.1'],
    ['Segmental lean · Right arm', 'leanRightArmKg', 3.9, '3.9'], ['Hydration', null, null, 'Good'],
  ]);
  assert.equal(a.metrics[1].unsure, true);
  assert.equal(a.scanDate, '2026-10-22');
  assert.equal(a.scanTime, '04:41');
  assert.throws(() => readScanAnswer('{"metrics": []}'), /no numbers/);
  assert.throws(() => readScanAnswer('{"x": 1}'), /no metrics/);
  assert.match(SYSTEM_SCAN, /exactly as reported/);
  assert.match(SYSTEM_SCAN, /fatPercent \(Body fat, %\)/);
});

test('each photo is read once, with Opus 5.5 high by default; a confirmed scan is left alone; Ask again reads it again', async () => {
  put('scan-photos', 'p1', { id: 'p1', scanId: 'scan.2026-10-22', date: '2026-10-22', dataUrl: JPEG, at: clock });
  const calls = [];
  const v = openScanVision({ store, now: () => clock, run: async (q) => { calls.push(q); return { text: ANSWER, ms: 9 }; } });
  assert.equal(await v.kick(), 1);
  assert.equal(await v.kick(), 0);
  assert.equal(calls[0].model, MODELS.deep.model);
  assert.equal(calls[0].effort, 'high');
  assert.equal(calls[0].content[0].type, 'image');
  const r = read('p1');
  assert.equal(r.status, 'done');
  assert.equal(r.scanId, 'scan.2026-10-22');
  assert.equal(r.metrics.length, 5);
  // Settings > Body: the fast model.
  put('settings', 'main', { body: { scanModel: 'fast' } });
  // He confirmed the scan: a new photo of it is not read.
  put('body-scans', 'scan.2026-10-22', { id: 'scan.2026-10-22', date: '2026-10-22', status: 'done', confirmedAt: clock + 10 });
  put('scan-photos', 'p2', { id: 'p2', scanId: 'scan.2026-10-22', date: '2026-10-22', dataUrl: JPEG, at: clock + 5 });
  assert.equal(await v.kick(), 0);
  // Ask again after confirming: read with his note.
  put('scan-photos', 'p1', { id: 'p1', scanId: 'scan.2026-10-22', date: '2026-10-22', dataUrl: JPEG, at: clock, round: 1, askedAt: clock + 20, hint: 'Left column is last scan' });
  assert.equal(await v.kick(), 1);
  assert.equal(calls[1].model, MODELS.fast.model);
  assert.match(calls[1].content[1].text, /Left column is last scan/);
  assert.equal(read('p1').round, 1);
});

test('a failed read is tried again 5 minutes later, at most 3 times', async () => {
  put('scan-photos', 'p1', { id: 'p1', scanId: 'scan.2026-10-22', date: '2026-10-22', dataUrl: JPEG, at: clock });
  let n = 0;
  const v = openScanVision({ store, now: () => clock, run: async () => { n++; throw new Error('Claude Code on the Mac is not logged in'); } });
  await v.kick();
  assert.equal(read('p1').status, 'failed');
  assert.equal(read('p1').error, 'Claude Code on the Mac is not logged in');
  assert.equal(await v.kick(), 0);
  for (let i = 0; i < 5; i++) { clock += 6 * 60000; await v.kick(); }
  assert.equal(n, MAX_TRIES);
  assert.equal(read('p1').tries, MAX_TRIES);
});
