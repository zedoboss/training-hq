// Imports on the Mac (step 3): the file is kept, preview saves nothing, commit writes everything once, undo removes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openImports } from '../server/imports.mjs';
import { createApp } from '../server/app.mjs';
import { APP_DIR } from '../server/config.mjs';

const HEAD = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';
const row = (title, start, ex, i, kg, reps, note = '') => `"${title}","${start}","${start.replace(/\d\d:\d\d$/, '07:00')}","","${ex}",,"${note}",${i},"normal",${kg},${reps},,,`;
const FILE = [HEAD,
  row('Push', '3 Mar 2025, 06:00', 'Bench Press (Barbell)', 0, 60, 8),
  row('Push', '3 Mar 2025, 06:00', 'Bench Press (Barbell)', 1, 60, 7),
  row('Push', '3 Mar 2025, 06:00', 'Weird Press Thing', 0, 20, 10),
  row('Legs', '5 Mar 2025, 06:00', 'Squat (Barbell)', 0, 80, 5),
  row('Legs', '5 Mar 2025, 06:00', 'Old Curl Name', 0, 12, 10),
].join('\n');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-imports-'));
  let t = 1_750_000_000_000;
  const store = openStore(join(dir, 'db.sqlite'), { now: () => t });
  const imports = openImports({ store, importsDir: join(dir, 'imports'), now: () => (t += 1000) });
  return { dir, store, imports, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('preview keeps the file once and saves nothing else', () => {
  const { dir, store, imports, done } = setup();
  try {
    const p = imports.preview({ text: FILE, fileName: 'workout_data.csv', tz: 'UTC' });
    assert.equal(p.source, 'hevy');
    assert.match(p.fileId, /^hevy\/workout_data-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.csv$/);
    assert.equal(readFileSync(join(dir, 'imports', p.fileId), 'utf8'), FILE);
    assert.deepEqual([p.summary.sessions, p.summary.sets, p.summary.skipped, p.summary.newExercises], [2, 5, 0, 2]);
    assert.deepEqual(p.exercises.map((e) => [e.name, e.how]), [['Bench Press (Barbell)', 'same name'], ['Weird Press Thing', 'new'], ['Squat (Barbell)', 'same name'], ['Old Curl Name', 'new']]);
    assert.equal(store.listRecords('sessions').length, 0);
    const again = imports.preview({ text: FILE, fileName: 'other-name.csv', tz: 'UTC' });
    assert.equal(again.fileId, p.fileId);
    assert.equal(readdirSync(join(dir, 'imports', 'hevy')).length, 1);
    assert.throws(() => imports.preview({ text: '"a","b"\n"1","2"', tz: 'UTC' }), /not a Hevy or Strong/);
    assert.throws(() => imports.plan({ fileId: '../../etc/passwd', tz: 'UTC' }), /unknown file/);
    assert.throws(() => imports.plan({ fileId: p.fileId, tz: 'Nowhere/Land' }), /unknown time zone/);
  } finally { done(); }
});

test('commit writes sessions, sets, new exercises and remembers matches; a second import skips everything', () => {
  const { store, imports, done } = setup();
  try {
    const p = imports.preview({ text: FILE, fileName: 'a.csv', tz: 'UTC' });
    const plan = imports.plan({ fileId: p.fileId, tz: 'UTC', matches: { 'Old Curl Name': 'bicep-curl-barbell' } });
    assert.equal(plan.summary.newExercises, 1);
    const rec = imports.commit({ fileId: p.fileId, tz: 'UTC', matches: { 'Old Curl Name': 'bicep-curl-barbell' } });
    assert.equal(rec.summary.sessions, 2);
    assert.equal(store.listRecords('sessions').length, 2);
    assert.equal(store.listRecords('sets').length, 5);
    assert.deepEqual(store.listRecords('exercises').map((r) => r.id), ['weird-press-thing']);
    const legs = store.listRecords('sessions').map((r) => r.data).find((s) => s.title === 'Legs');
    assert.equal(legs.exercises[1].name, 'Bicep Curl (Barbell)');
    assert.equal(legs.exercises[1].importedName, 'Old Curl Name');
    assert.equal(legs.importId, rec.id);
    assert.deepEqual(store.getRecord('settings', 'import-matches').data, { hevy: { 'Weird Press Thing': 'weird-press-thing', 'Old Curl Name': 'bicep-curl-barbell' } });
    assert.equal(store.getRecord('imports', rec.id).data.sessionIds.length, 2);

    const second = imports.preview({ text: FILE, fileName: 'a.csv', tz: 'UTC' });
    assert.equal(second.summary.sessions, 0);
    assert.deepEqual(second.summary.reasons, { 'already imported': 2 });
    assert.equal(second.exercises.find((e) => e.name === 'Old Curl Name').how, 'remembered');
    assert.throws(() => imports.commit({ fileId: p.fileId, tz: 'UTC' }), /nothing new/);
  } finally { done(); }
});

test('undo removes the import\'s sessions, sets and unused new exercises; the same file can come back', () => {
  const { store, imports, done } = setup();
  try {
    const p = imports.preview({ text: FILE, fileName: 'a.csv', tz: 'UTC' });
    const rec = imports.commit({ fileId: p.fileId, tz: 'UTC' });
    const out = imports.undo({ importId: rec.id });
    assert.deepEqual(out, { sessions: 2, sets: 5, exercises: 2 });
    assert.equal(store.listRecords('sessions').length, 0);
    assert.equal(store.listRecords('sets').length, 0);
    assert.ok(store.getRecord('imports', rec.id).data.undoneAt);
    assert.throws(() => imports.undo({ importId: rec.id }), /already undone/);
    const back = imports.plan({ fileId: p.fileId, tz: 'UTC' });
    assert.equal(back.summary.sessions, 2);
    imports.commit({ fileId: p.fileId, tz: 'UTC' });
    assert.equal(store.listRecords('sessions').length, 2);
    assert.equal(imports.list().length, 2);
  } finally { done(); }
});

test('a session deleted in the app does not come back on a re-import; a Training HQ session at the same time wins', () => {
  const { store, imports, done } = setup();
  try {
    const p = imports.preview({ text: FILE, fileName: 'a.csv', tz: 'UTC' });
    const rec = imports.commit({ fileId: p.fileId, tz: 'UTC' });
    store.writeLocal('sessions', rec.sessionIds[0], null, { deleted: true });
    store.writeLocal('sessions', 'session-own', { id: 'session-own', title: 'Legs', status: 'done', startedAt: Date.UTC(2025, 2, 5, 6, 10), endedAt: Date.UTC(2025, 2, 5, 7, 0), exercises: [] });
    const p2 = imports.plan({ fileId: p.fileId, tz: 'UTC' });
    assert.deepEqual(p2.skipped.map((s) => s.reason).sort(), ['already imported', 'deleted in Training HQ']);
    store.writeLocal('sessions', rec.sessionIds[1], null, { deleted: true });
    const p3 = imports.plan({ fileId: p.fileId, tz: 'UTC' });
    assert.deepEqual(p3.skipped.map((s) => s.reason).sort(), ['deleted in Training HQ', 'deleted in Training HQ']);
  } finally { done(); }
});

test('HTTP: preview, plan, commit and undo need pairing and answer plain errors', async () => {
  const { store, imports, done } = setup();
  const server = createApp({ store, appDir: APP_DIR, imports });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { code } = store.createPairingCode();
    const token = store.redeemPairingCode(code, 'a1b2c3d4e5f6', 'Test');
    const h = { authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/api/import/preview?tz=UTC`, { method: 'POST', body: FILE })).status, 401);
    const pre = await (await fetch(`${base}/api/import/preview?tz=UTC&name=x.csv`, { method: 'POST', headers: { ...h, 'content-type': 'text/csv' }, body: FILE })).json();
    assert.equal(pre.summary.sessions, 2);
    const bad = await fetch(`${base}/api/import/preview?tz=UTC`, { method: 'POST', headers: h, body: 'nope' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /not a Hevy or Strong/);
    const json = (body) => ({ method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const plan = await (await fetch(`${base}/api/import/plan`, json({ fileId: pre.fileId, tz: 'UTC', matches: {} }))).json();
    assert.equal(plan.summary.sets, 5);
    const rec = await (await fetch(`${base}/api/import/commit`, json({ fileId: pre.fileId, tz: 'UTC', matches: {} }))).json();
    assert.equal(rec.sessionIds.length, 2);
    const undo = await (await fetch(`${base}/api/import/undo`, json({ importId: rec.id }))).json();
    assert.equal(undo.sessions, 2);
    assert.equal((await fetch(`${base}/api/import/undo`, json({ importId: 'imp.none' }))).status, 404);
  } finally {
    server.close();
    done();
  }
});

test('a Hevy measurements file: preview, import once per date, undo', () => {
  const { dir, store, imports, done } = setup();
  try {
    const M = '"date","weight_kg","fat_percent","waist_cm","notes"\n"10 Oct 2026, 07:00",80.5,15.2,82,""\n"1 Sep 2026",81,,,""\n';
    const p = imports.preview({ text: M, fileName: 'measurements.csv', tz: 'UTC' });
    assert.equal(p.kind, 'measurements');
    assert.match(p.fileId, /^hevy-measurements\/measurements-/);
    assert.equal(readdirSync(join(dir, 'imports', 'hevy-measurements')).length, 1);
    assert.deepEqual([p.summary.measurements, p.summary.from, p.summary.to, p.summary.ignored], [2, '2026-09-01', '2026-10-10', ['notes']]);
    assert.equal(store.listRecords('measurements').length, 0, 'preview saves nothing');
    const rec = imports.commit({ fileId: p.fileId, tz: 'UTC' });
    assert.equal(rec.kind, 'measurements');
    assert.deepEqual(store.listRecords('measurements').map((r) => [r.id, r.data.weightKg]).sort(), [['measure.hevy.2026-09-01', 81], ['measure.hevy.2026-10-10', 80.5]]);
    const again = imports.plan({ fileId: p.fileId, tz: 'UTC' });
    assert.deepEqual([again.summary.measurements, again.summary.skipped], [0, 2]);
    assert.throws(() => imports.commit({ fileId: p.fileId, tz: 'UTC' }), /nothing new/);
    assert.deepEqual(imports.undo({ importId: rec.id }), { measurements: 2 });
    assert.equal(store.listRecords('measurements').filter((r) => !r.deleted).length, 0);
    assert.equal(imports.plan({ fileId: p.fileId, tz: 'UTC' }).summary.measurements, 2, 'can be imported again after undo');
  } finally { done(); }
});
