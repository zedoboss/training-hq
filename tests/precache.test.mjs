import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPrecache } from '../scripts/precache.mjs';

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
});
