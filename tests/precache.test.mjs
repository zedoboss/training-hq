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
