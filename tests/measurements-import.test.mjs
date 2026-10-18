import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectSource, measureColumn, measureDate, readMeasurements, planMeasurements } from '../app/js/lib/import.js';

// Made-up file in the shape of Hevy's public API body measurement (no real export has been checked yet).
const CSV = `"date","weight_kg","lean_mass_kg","fat_percent","neck_cm","shoulder_cm","chest_cm","left_bicep_cm","right_bicep_cm","waist","notes"
"10 Oct 2026, 07:00",80.5,,15.2,38,,,,,82,"after breakfast"
"2026-09-01",81,,,,,,,,,
"bad date",80,,,,,,,,,
"12 Sep 2026",,,,,,,,,,`;

test('a measurements export is recognised by its columns', () => {
  assert.equal(detectSource(parseCsv(CSV).header), 'hevy-measurements');
  assert.equal(detectSource(['date', 'weight_kg']), null, 'one column is not enough');
  assert.equal(detectSource(['title', 'start_time', 'exercise_title', 'set_index', 'weight_kg']), 'hevy');
});

test('columns are matched loosely, with units', () => {
  assert.deepEqual(measureColumn('weight_kg'), { field: 'weightKg', unit: 'kg' });
  assert.deepEqual(measureColumn('Weight (lbs)'), { field: 'weightKg', unit: 'lb' });
  assert.deepEqual(measureColumn('fat_percent'), { field: 'fatPercent', unit: '%' });
  assert.deepEqual(measureColumn('Body Fat %'), { field: 'fatPercent', unit: '%' });
  assert.deepEqual(measureColumn('left_thigh'), { field: 'leftThighCm', unit: 'cm' });
  assert.deepEqual(measureColumn('Left Calf (in)'), { field: 'leftCalfCm', unit: 'in' });
  assert.equal(measureColumn('notes'), null);
  assert.equal(measureDate('10 Oct 2026, 07:00'), '2026-10-10');
  assert.equal(measureDate('Oct 9, 2026'), '2026-10-09');
  assert.equal(measureDate('2026-09-01T08:00:00Z'), '2026-09-01');
  assert.equal(measureDate('soon'), null);
});

test('rows become values per date; unreadable dates are counted', () => {
  const r = readMeasurements(parseCsv(CSV));
  assert.deepEqual(r.rows[0], { date: '2026-10-10', values: { weightKg: 80.5, fatPercent: 15.2, neckCm: 38, waistCm: 82 } });
  assert.equal(r.rows.length, 3);
  assert.equal(r.badRows, 1);
  assert.deepEqual(r.ignored, ['notes']);
  assert.equal(r.read.length, 9);
  const lb = readMeasurements(parseCsv('date,weight_lbs,waist_in\n2026-10-10,176,32'));
  assert.deepEqual(lb.rows[0].values, { weightKg: 79.83, waistCm: 81.28 });
});

test('no duplicates: one measurement per date, skipped and why', () => {
  const { rows } = readMeasurements(parseCsv(CSV));
  const first = planMeasurements({ rows, importId: 'imp1' });
  assert.deepEqual(first.records.map((m) => m.id), ['measure.hevy.2026-09-01', 'measure.hevy.2026-10-10']);
  assert.equal(first.records[1].source, 'hevy');
  assert.equal(first.records[1].importId, 'imp1');
  assert.deepEqual(first.skipped, [{ date: '2026-09-12', reason: 'no numbers in the row' }]);
  const existing = [{ id: 'measure.hevy.2026-09-01', date: '2026-09-01', source: 'hevy' }, { id: 'm.own', date: '2026-10-10', source: 'training-hq' }];
  const again = planMeasurements({ rows, existing, importId: 'imp2' });
  assert.deepEqual(again.records, []);
  assert.deepEqual(again.skipped.map((x) => x.reason).sort(), ['a measurement is already here for that date', 'already imported', 'no numbers in the row']);
  const undone = planMeasurements({ rows, existing: existing.map((m) => ({ ...m, deleted: true })), importId: 'imp3' });
  assert.equal(undone.records.length, 2, 'deleted ones come back');
});
