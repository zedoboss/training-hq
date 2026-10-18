import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openStore } from '../server/store.mjs';
import { writeBackup, readBackup, commitBackup, msUntil } from '../server/backup.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'thq-backup-'));

test('backup: one file per collection, photos one file each, deletions kept; restores into an empty database', () => {
  const dir = tmp();
  try {
    const store = openStore(join(dir, 'a.sqlite'));
    store.writeLocal('sets', 's1', { kg: 50, reps: 8 });
    store.writeLocal('sets', 's2', { kg: 55, reps: 8 });
    store.writeLocal('sets', 's2', null, { deleted: true });
    store.writeLocal('photos', 'p1', { dataUrl: 'data:image/jpeg;base64,AAAA' });
    const out = join(dir, 'backup');
    const r = writeBackup(store, out);
    assert.deepEqual(r, { collections: 2, records: 3, files: 2 });
    assert.deepEqual(readdirSync(out).sort(), ['photos', 'sets.json']);
    assert.deepEqual(readdirSync(join(out, 'photos')), ['p1.json']);
    assert.equal(readFileSync(join(out, 'sets.json'), 'utf8').split('\n').length, 5, 'one record per line');
    store.writeLocal('photos', 'p1', null, { deleted: true });
    writeBackup(store, out);
    assert.equal(JSON.parse(readFileSync(join(out, 'photos', 'p1.json'), 'utf8')).deleted, true);

    const back = readBackup(out);
    const fresh = openStore(join(dir, 'b.sqlite'));
    fresh.applyChanges(back, 'backup000000');
    assert.deepEqual(fresh.getRecord('sets', 's1').data, { kg: 50, reps: 8 });
    assert.equal(fresh.getRecord('sets', 's2').deleted, true);
    assert.equal(fresh.getRecord('sets', 's1').hlc, store.getRecord('sets', 's1').hlc, 'change stamps survive');
    store.close(); fresh.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('progress photos are one file each, like session and meal photos', () => {
  const dir = tmp();
  try {
    const store = openStore(join(dir, 'a.sqlite'));
    store.writeLocal('body-photos', 'bodyphoto.2026-10-18.front', { date: '2026-10-18', pose: 'front', dataUrl: 'data:image/jpeg;base64,AAAA' });
    const out = join(dir, 'backup');
    writeBackup(store, out);
    assert.deepEqual(readdirSync(join(out, 'body-photos')), ['bodyphoto.2026-10-18.front.json']);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('commit: only the backup and demo folders, and only when something changed', () => {
  const dir = tmp();
  try {
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'Test');
    assert.equal(commitBackup(join(dir, 'missing'), 'x'), 'no-git');
    const store = openStore(join(dir, 'db.sqlite'));
    store.writeLocal('sets', 's1', { kg: 50 });
    writeBackup(store, join(dir, 'data', 'backup'));
    mkdirSync(join(dir, 'data', 'demos'), { recursive: true });
    mkdirSync(join(dir, 'notes'), { recursive: true });
    spawnSync('sh', ['-c', `echo draft > ${join(dir, 'notes', 'wip.md')}`]);
    assert.equal(commitBackup(dir, 'Nightly backup'), 'committed', 'an empty demos folder does not block the commit');
    assert.equal(commitBackup(dir, 'Nightly backup'), 'unchanged');
    spawnSync('sh', ['-c', `echo clip > ${join(dir, 'data', 'demos', 'squat.mp4')}`]);
    assert.equal(commitBackup(dir, 'Nightly backup'), 'committed', 'a new clip is committed');
    assert.match(git('status', '--porcelain').stdout, /\?\? notes\//, 'other work is not committed');
    assert.match(git('log', '--oneline').stdout, /Nightly backup/);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('next run time: the next local 1:00 AM', () => {
  const at = new Date(2026, 9, 17, 18, 30);
  assert.equal(msUntil(1, at), 6.5 * 3600000);
  assert.equal(msUntil(1, new Date(2026, 9, 18, 1, 0)), 24 * 3600000);
});
