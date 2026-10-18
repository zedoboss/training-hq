import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEASURE_FIELDS, fieldOf, shown, stored, unitText, measureIdFor, filled, fieldSeries, latestByField,
  photoId, lastPhoto, photoDays,
} from '../app/js/lib/body.js';

test('the 17 fields: weight, lean mass, body fat and the 14 circumferences, in the Hevy import\'s keys', () => {
  assert.equal(MEASURE_FIELDS.length, 17);
  assert.deepEqual(MEASURE_FIELDS.slice(0, 3).map((f) => f.key), ['weightKg', 'leanMassKg', 'fatPercent']);
  assert.equal(MEASURE_FIELDS[3].key, 'neckCm');
  assert.equal(MEASURE_FIELDS.at(-1).key, 'rightCalfCm');
  assert.ok(MEASURE_FIELDS.slice(3).every((f) => f.kind === 'cm' && f.key.endsWith('Cm')));
  assert.equal(new Set(MEASURE_FIELDS.map((f) => f.key)).size, 17);
  assert.equal(fieldOf('waistCm').label, 'Waist');
  assert.equal(fieldOf('nope'), null);
});

test('values shown and typed in his units', () => {
  assert.equal(shown('kg', 80.5), 80.5);
  assert.equal(shown('kg', 80, { weight: 'lb' }), 176.4);
  assert.equal(shown('cm', 38, { body: 'in' }), 15);
  assert.equal(shown('cm', 82.26), 82.3);
  assert.equal(shown('%', 15.2, { weight: 'lb' }), 15.2);
  assert.equal(shown('kg', null), null);

  assert.equal(stored('kg', '80,5'), 80.5);
  assert.equal(stored('kg', ' 176.4 ', { weight: 'lb' }), 80.01);
  assert.equal(stored('cm', '15', { body: 'in' }), 38.1);
  assert.equal(stored('%', '15.2'), 15.2);
  assert.equal(stored('kg', ''), null);
  assert.equal(stored('kg', '   '), null);
  assert.ok(Number.isNaN(stored('kg', 'abc')));
  assert.ok(Number.isNaN(stored('kg', '-3')));
  assert.ok(Number.isNaN(stored('kg', '8')), 'under 20 kg is a typo');
  assert.ok(Number.isNaN(stored('%', '90')));
  assert.ok(Number.isNaN(stored('cm', '2')));

  assert.equal(unitText('kg'), 'kg');
  assert.equal(unitText('kg', { weight: 'lb' }), 'lb');
  assert.equal(unitText('cm', { body: 'in' }), 'in');
  assert.equal(unitText('%', { weight: 'lb' }), '%');
});

test('one record per date: the Hevy one is edited, else a new one', () => {
  const ms = [{ id: 'measure.hevy.2026-10-10', date: '2026-10-10', weightKg: 80.5 }, { id: 'measure.2026-10-12', date: '2026-10-12', waistCm: 82 }];
  assert.equal(measureIdFor('2026-10-10', ms), 'measure.hevy.2026-10-10');
  assert.equal(measureIdFor('2026-10-12', ms), 'measure.2026-10-12');
  assert.equal(measureIdFor('2026-10-18', ms), 'measure.2026-10-18');
  assert.equal(measureIdFor('2026-10-18'), 'measure.2026-10-18');
  assert.deepEqual(filled({ weightKg: 80, waistCm: null, chestCm: 'x', neckCm: 0 }).map((f) => f.key), ['weightKg', 'neckCm']);
  assert.deepEqual(filled(null), []);
});

test('a field over time and the latest of each, with the change since the entry before', () => {
  const ms = [
    { id: 'a', date: '2026-10-12', weightKg: 81, waistCm: 83, source: 'manual' },
    { id: 'b', date: '2026-09-01', weightKg: 82, source: 'hevy' },
    { id: 'c', date: '2026-10-18', weightKg: 80.4 },
    { id: 'd', date: null, weightKg: 70 },
  ];
  const s = fieldSeries(ms, 'weightKg');
  assert.deepEqual(s.map((p) => [p.date, p.value]), [['2026-09-01', 82], ['2026-10-12', 81], ['2026-10-18', 80.4]]);
  assert.equal(s[0].source, 'hevy');
  assert.equal(s[2].source, 'manual');
  const latest = latestByField(ms);
  assert.deepEqual(latest.map((f) => f.key), ['weightKg', 'waistCm'], 'only fields with data, in field order');
  assert.deepEqual([latest[0].value, latest[0].date, latest[0].prev, latest[0].prevDate, latest[0].count], [80.4, '2026-10-18', 81, '2026-10-12', 3]);
  assert.deepEqual([latest[1].value, latest[1].prev, latest[1].prevDate, latest[1].count], [83, null, null, 1]);
  assert.deepEqual(latestByField([]), []);
});

test('progress photos: one per day and pose, the last one before a date, grouped by day', () => {
  assert.equal(photoId('2026-10-18', 'side'), 'bodyphoto.2026-10-18.side');
  const ps = [
    { id: 'bodyphoto.2026-10-01.front', date: '2026-10-01', pose: 'front', dataUrl: 'data:1' },
    { id: 'bodyphoto.2026-10-11.front', date: '2026-10-11', pose: 'front', dataUrl: 'data:2' },
    { id: 'bodyphoto.2026-10-11.back', date: '2026-10-11', pose: 'back', dataUrl: 'data:3' },
    { id: 'bodyphoto.2026-10-18.front', date: '2026-10-18', pose: 'front', dataUrl: 'data:4' },
    { id: 'x', date: '2026-10-15', pose: 'side', dataUrl: null },
  ];
  assert.equal(lastPhoto(ps, 'front').date, '2026-10-18');
  assert.equal(lastPhoto(ps, 'front', '2026-10-18').date, '2026-10-11', 'retaking today overlays the one before');
  assert.equal(lastPhoto(ps, 'side'), null, 'no picture data, no overlay');
  assert.equal(lastPhoto(ps, 'front', '2026-10-01'), null);
  const days = photoDays(ps);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-18', '2026-10-15', '2026-10-11', '2026-10-01']);
  assert.deepEqual(Object.keys(days[2].photos).sort(), ['back', 'front']);
});

test('compare pickers and capture size', async () => {
  const { posePhotos, fitSize } = await import('../app/js/lib/body.js');
  const ps = [
    { date: '2026-10-18', pose: 'front', dataUrl: 'd' }, { date: '2026-09-01', pose: 'front', dataUrl: 'd' },
    { date: '2026-10-01', pose: 'side', dataUrl: 'd' }, { date: '2026-10-05', pose: 'front', dataUrl: null },
  ];
  assert.deepEqual(posePhotos(ps, 'front').map((p) => p.date), ['2026-09-01', '2026-10-18']);
  assert.deepEqual(posePhotos(ps, 'back'), []);
  assert.deepEqual(fitSize(1080, 1920), [720, 1280]);
  assert.deepEqual(fitSize(1920, 1080), [1280, 720]);
  assert.deepEqual(fitSize(640, 480), [640, 480]);
});
