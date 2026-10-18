import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPrecache, writePrecache } from '../scripts/precache.mjs';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = fileURLToPath(new URL('../app/', import.meta.url));

test('every file the page needs is in the offline list', () => {
  const { version, files } = buildPrecache(APP);
  assert.match(version, /^[0-9a-f]{12}$/);
  for (const f of ['./', 'precache.js', 'index.html', 'manifest.webmanifest', 'css/theme.css', 'css/app.css',
    'js/main.js', 'fonts/inter-latin-wght-normal.woff2', 'fonts/jetbrains-mono-latin-wght-normal.woff2',
    'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png']) {
    assert.ok(files.includes(f), `missing ${f}`);
  }
  for (const f of files) {
    if (f === './' || f === 'precache.js') continue;
    assert.ok(existsSync(APP + f), `listed but missing on disk: ${f}`);
  }
  assert.ok(!files.includes('sw.js'), 'the service worker must not cache itself');
  assert.ok(!files.includes('version.json'), 'the latest-version probe is never cached');
});

test("Squat Depth's pose files (40 MB) stay out of the per-version list; the worker keeps them in their own store", () => {
  const { files } = buildPrecache(APP);
  assert.ok(existsSync(`${APP}vendor/mediapipe/models/pose_landmarker_lite.task`), 'vendored model present');
  assert.ok(!files.some((f) => f.startsWith('vendor/')), 'no vendor file in the app file list');
  assert.ok(files.includes('js/lib/squat-core.js') && files.includes('css/squat.css'), 'the Squat Depth screen itself is');
  const sw = readFileSync(fileURLToPath(new URL('../scripts/sw.template.js', import.meta.url)), 'utf8');
  assert.match(sw, /const VENDOR_CACHE = 'mediapipe-1\.1\.0'/);
  assert.match(sw, /ignoreVary: true/, 'module imports send Origin; the stored copy must still match');
  assert.match(readFileSync(`${APP}js/lib/squat-offline.js`, 'utf8'), /export const VENDOR_CACHE = 'mediapipe-1\.1\.0'/, 'same store name on the page');
});

test('sw.js itself changes when any app file changes, so iPhone Safari sees the update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-pc-'));
  try {
    cpSync(APP, dir, { recursive: true });
    const a = writePrecache(dir);
    const swA = readFileSync(join(dir, 'sw.js'), 'utf8');
    assert.ok(swA.includes(a.version), 'the version is inside sw.js');
    assert.ok(swA.includes('self.TRAINING_HQ_PRECACHE = {'), 'the file list is inside sw.js');
    assert.ok(!swA.includes('importScripts'), 'nothing imported: Safari would not notice it change');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')), { version: a.version });
    writeFileSync(join(dir, 'css', 'app.css'), `${readFileSync(join(dir, 'css', 'app.css'), 'utf8')}\n/* changed */\n`);
    const b = writePrecache(dir);
    assert.notEqual(a.version, b.version);
    assert.notEqual(readFileSync(join(dir, 'sw.js'), 'utf8'), swA);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
