import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { seedDocs, applySeed } from '../server/seed.mjs';
import { formatHlc } from '../app/js/lib/hlc.js';

function fixture(dir, title = 'Plan A') {
  mkdirSync(join(dir, 'seed'), { recursive: true });
  writeFileSync(join(dir, 'seed', 'programme.json'), JSON.stringify({
    meta: { kind: 'meta', title },
    routines: [{ kind: 'routine', id: 'pull-gbi', exercises: [{ name: 'A' }] }, { kind: 'routine', id: 'neck', exercises: [] }],
  }));
  writeFileSync(join(dir, 'seed', 'tendons.json'), JSON.stringify({
    sources: {}, notice: 'n', changes: [], rules: { kind: 'rules', items: [] },
    areas: [{ kind: 'area', id: 'knees' }], readiness: { kind: 'readiness', status: 'draft' },
  }));
}

test('seed files become documents and load once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-seed-'));
  try {
    fixture(dir);
    const store = openStore(join(dir, 'db.sqlite'));
    const docs = seedDocs(join(dir, 'seed'));
    assert.deepEqual(docs.map((d) => `${d.col}/${d.id}`), [
      'programme/meta', 'programme/routine.pull-gbi', 'programme/routine.neck',
      'tendons/meta', 'tendons/rules', 'tendons/area.knees', 'tendons/readiness',
    ]);
    assert.deepEqual(applySeed(store, docs), { written: 7, refreshed: 0, kept: 0 });
    assert.deepEqual(applySeed(store, docs), { written: 0, refreshed: 0, kept: 7 });
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a changed seed refreshes untouched documents but never overwrites an edit made in the app', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-seed-'));
  try {
    fixture(dir);
    const store = openStore(join(dir, 'db.sqlite'));
    applySeed(store, seedDocs(join(dir, 'seed')));
    // Michael edits the readiness table in the app.
    store.applyChanges([{ col: 'tendons', id: 'readiness', data: { kind: 'readiness', status: 'confirmed' }, deleted: false,
      hlc: formatHlc(Date.now() + 1000, 0, 'a1b2c3d4e5f6'), device: 'a1b2c3d4e5f6' }], 'a1b2c3d4e5f6');
    // The seed is rebuilt with a new title and a new readiness draft.
    fixture(dir, 'Plan B');
    const docs = seedDocs(join(dir, 'seed'));
    docs.find((d) => d.id === 'readiness').data.status = 'draft v2';
    const r = applySeed(store, docs);
    assert.equal(store.getRecord('programme', 'meta').data.title, 'Plan B');
    assert.equal(store.getRecord('tendons', 'readiness').data.status, 'confirmed');
    assert.equal(r.refreshed, 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no seed files: nothing happens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-seed-'));
  try {
    assert.deepEqual(seedDocs(join(dir, 'missing')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
