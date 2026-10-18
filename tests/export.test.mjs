// CSV export (3.6, P56): workout rows, every collection, photos, and a ZIP that opens with the system's unzip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvCell, toCsv, localStamp, workoutRows, recordRows, zipFiles, crc32, exportFiles, WORKOUT_COLUMNS } from '../app/js/lib/export.js';
import { parseCsv } from '../app/js/lib/import.js';
import { memoryAdapter, openRepo } from '../app/js/lib/repo.js';

const TZ = 'Asia/Bangkok';
const at = (iso) => Date.parse(iso);
const sessions = [
  {
    id: 's2', kind: 'workout', title: 'Push', dayType: 'push', status: 'done', source: 'training-hq', gym: 'Gym', note: 'felt "good", strong',
    startedAt: at('2026-10-12T22:30:00Z'), endedAt: at('2026-10-12T23:40:00Z'), pausedMs: 600000, bodyweightKg: 80,
    exercises: [{ key: 'a', exerciseId: 'bench-press-smith', name: 'Bench Press (Smith Machine)', notes: 'seat 4' }, { key: 'b', exerciseId: 'lat', name: 'Lateral Raise (Cable)', supersetId: 'ss1' }],
  },
  {
    id: 's1', kind: 'workout', title: 'Pull+', dayType: 'pull', status: 'done', source: 'hevy', startedAt: at('2026-10-09T21:00:00Z'), endedAt: null,
    exercises: [{ key: 'k0', exerciseId: 'run', name: 'Treadmill' }],
  },
  { id: 's3', kind: 'workout', title: 'Live', status: 'active', startedAt: at('2026-10-14T21:00:00Z'), exercises: [{ key: 'a', exerciseId: 'x', name: 'X' }] },
];
const sets = [
  { id: 's2.2', sessionId: 's2', exKey: 'b', order: 2, done: true, type: 'hold', kg: 4.5, reps: null, durationS: 30, importedAs: 'x 10' },
  { id: 's2.0', sessionId: 's2', exKey: 'a', order: 0, done: true, type: 'warmup', kg: 21.3, reps: 10, rpe: null },
  { id: 's2.1', sessionId: 's2', exKey: 'a', order: 1, done: true, type: 'normal', kg: 42.5, reps: 12, rpe: 8, note: 'line\nbreak' },
  { id: 's2.9', sessionId: 's2', exKey: 'a', order: 9, done: false, type: 'normal', kg: 42.5, reps: null },
  { id: 's1.0', sessionId: 's1', exKey: 'k0', order: 0, done: true, type: 'normal', distanceM: 1500, durationS: 600 },
  { id: 's3.0', sessionId: 's3', exKey: 'a', order: 0, done: true, type: 'normal', kg: 10, reps: 5 },
];

test('cells: quotes, commas, line breaks and objects', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(42.5), '42.5');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
  assert.equal(localStamp(at('2026-10-12T22:30:00Z'), TZ), '2026-10-13 05:30');
  assert.equal(localStamp(at('2026-10-12T17:05:00Z'), TZ), '2026-10-13 00:05');
});

test('workout rows: finished sessions oldest first, ticked sets only, set numbers per exercise, totals kept', () => {
  const rows = workoutRows(sessions, sets, { tz: TZ });
  assert.deepEqual(rows.map((r) => [r.session_id, r.exercise, r.set_number, r.set_type, r.weight_kg]), [
    ['s1', 'Treadmill', 1, 'normal', undefined],
    ['s2', 'Bench Press (Smith Machine)', 1, 'warmup', 21.3],
    ['s2', 'Bench Press (Smith Machine)', 2, 'normal', 42.5],
    ['s2', 'Lateral Raise (Cable)', 1, 'hold', 4.5],
  ]);
  const [run, , top, hold] = rows;
  assert.equal(run.distance_km, 1.5);
  assert.equal(run.source, 'hevy');
  assert.equal(run.end_time, '');
  assert.equal(top.date, '2026-10-13');
  assert.equal(top.start_time, '2026-10-13 05:30');
  assert.equal(top.duration_min, 60);
  assert.equal(top.exercise_note, 'seat 4');
  assert.equal(top.rpe, 8);
  assert.equal(hold.logged_as, 'x 10');
  assert.equal(hold.superset, 'ss1');
  // Our own CSV reader gets the same values back, line breaks and quotes included.
  const back = parseCsv(toCsv(WORKOUT_COLUMNS, rows));
  assert.deepEqual(back.header, WORKOUT_COLUMNS);
  assert.equal(back.rows.length, 4);
  assert.equal(back.rows[2].set_note, 'line\nbreak');
  assert.equal(back.rows[2].session_note, 'felt "good", strong');
});

test('record rows: id first, every field, pictures left out', () => {
  const { columns, rows } = recordRows([{ id: 'b', z: 1, nested: { a: [1] } }, { id: 'a', dataUrl: `data:image/jpeg;base64,${'A'.repeat(4096)}` }]);
  assert.deepEqual(columns, ['id', 'dataUrl', 'nested', 'z']);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].dataUrl, '(file, 3 KB)');
  assert.deepEqual(rows[1].nested, { a: [1] });
});

test('zip: stored files open with the system unzip, names and bytes intact', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
  const data = {
    sessions, sets,
    exercises: [{ id: 'my-curl', name: 'Mÿ Curl', type: 'weight_reps' }],
    photos: [{ id: 'photo-1', sessionId: 's2', dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`, at: 1 }],
    empty: [],
  };
  const { files, counts } = exportFiles(data, { tz: TZ });
  assert.deepEqual(counts, { sessions: 2, sets: 4, photos: 1, collections: 4 });
  assert.deepEqual(files.map((f) => f.name), ['README.txt', 'workouts.csv', 'data/exercises.csv', 'data/photos.csv', 'data/sessions.csv', 'data/sets.csv', 'photos/photo-1.jpg']);
  const dir = mkdtempSync(join(tmpdir(), 'thq-zip-'));
  try {
    const file = join(dir, 'x.zip');
    writeFileSync(file, zipFiles(files, new Date(2026, 9, 18, 9, 30)));
    const list = execFileSync('unzip', ['-l', file]).toString();
    assert.match(list, /photos\/photo-1\.jpg/);
    assert.match(list, /(10-18-2026|2026-10-18) 09:30/, "macOS and Linux unzip print the date differently");
    execFileSync('unzip', ['-t', file]);
    assert.deepEqual([...execFileSync('unzip', ['-p', file, 'photos/photo-1.jpg'])], [...jpeg]);
    assert.match(execFileSync('unzip', ['-p', file, 'data/exercises.csv']).toString(), /Mÿ Curl/);
    assert.equal(execFileSync('unzip', ['-p', file, 'workouts.csv']).toString(), files[1].data);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('repo lists the collections it holds', async () => {
  const repo = await openRepo(memoryAdapter());
  await repo.put('sets', 'a', {});
  await repo.put('exercises', 'b', {});
  await repo.put('sets', 'c', {});
  assert.deepEqual(await repo.cols(), ['exercises', 'sets']);
});

test('meal photos go in as photos/meal-<meal>-<before|after>.jpg', () => {
  const url = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 1]).toString('base64')}`;
  const { files, counts } = exportFiles({ 'meal-photos': [{ id: 'photo-a', mealId: 'meal-1', kind: 'before', dataUrl: url }, { id: 'photo-b', mealId: 'meal-1', kind: 'after', dataUrl: url }] }, { tz: TZ });
  assert.equal(counts.photos, 2);
  assert.ok(files.some((f) => f.name === 'photos/meal-meal-1-before.jpg'));
  assert.ok(files.some((f) => f.name === 'photos/meal-meal-1-after.jpg'));
  assert.ok(files.some((f) => f.name === 'data/meal-photos.csv'));
});
