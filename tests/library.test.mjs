import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, slug } from '../app/js/data/exercise-library.js';
import { TYPES, MUSCLES, EQUIPMENT, setFields, effectiveKg } from '../app/js/lib/exercise-types.js';
import { mergeLibrary, searchLibrary, newCustomExercise, demoFileName } from '../app/js/lib/library.js';

test('library entries are well formed and unique', () => {
  const ids = new Set();
  for (const e of LIBRARY) {
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.ok(TYPES[e.type], `${e.name}: type ${e.type}`);
    assert.ok(MUSCLES.includes(e.primary), `${e.name}: primary ${e.primary}`);
    for (const m of e.secondary) assert.ok(MUSCLES.includes(m), `${e.name}: secondary ${m}`);
    assert.ok(EQUIPMENT.includes(e.equipment), `${e.name}: equipment ${e.equipment}`);
  }
  assert.ok(LIBRARY.length >= 120);
});

test('slugs are stable file-safe ids', () => {
  assert.equal(slug('Seated Cable Row - V Grip (Cable)'), 'seated-cable-row-v-grip-cable');
  assert.equal(slug('Bench Press (Smith Machine)'), 'bench-press-smith-machine');
  assert.equal(demoFileName({ id: 'bench-press-smith-machine' }), 'bench-press-smith-machine.mp4');
});

test('own records extend library entries and add new ones', () => {
  const merged = mergeLibrary([
    { id: 'bench-press-smith-machine', pinnedNote: 'No free bar', restSeconds: 180 },
    { id: 'cupping', name: 'Cupping', type: 'weight_reps', primary: 'forearms', secondary: [], equipment: 'barbell' },
    newCustomExercise({ name: '  Toes  Wall Squat Hold ', type: 'duration', primary: 'quadriceps', equipment: 'bodyweight' }),
  ]);
  const bench = merged.find((e) => e.id === 'bench-press-smith-machine');
  assert.equal(bench.name, 'Bench Press (Smith Machine)');
  assert.equal(bench.pinnedNote, 'No free bar');
  assert.equal(bench.source, 'library');
  assert.equal(merged.find((e) => e.id === 'cupping').source, 'mine');
  const wall = merged.find((e) => e.id === 'toes-wall-squat-hold');
  assert.equal(wall.name, 'Toes Wall Squat Hold');
  assert.equal(wall.source, 'custom');
});

test('search: any word order, filters, recent first then own then library', () => {
  const list = mergeLibrary([{ id: 'cupping', name: 'Cupping', type: 'weight_reps', primary: 'forearms', secondary: [], equipment: 'barbell' }]);
  assert.equal(searchLibrary(list, { q: 'curl ez' })[0].name, 'EZ Bar Biceps Curl');
  const forearms = searchLibrary(list, { muscle: 'forearms' });
  assert.equal(forearms[0].name, 'Cupping', 'own exercises before library ones');
  const recent = searchLibrary(list, { muscle: 'forearms', recent: ['front-wrist-curl', 'wrist-curl-barbell'] });
  assert.equal(recent[0].id, 'wrist-curl-barbell', 'recently used first (front-wrist-curl is not in this list)');
  assert.ok(searchLibrary(list, { equipment: 'smith' }).every((e) => e.equipment === 'smith'));
  assert.ok(searchLibrary(list, { muscle: 'triceps' }).some((e) => e.name === 'Bench Press (Smith Machine)'), 'secondary muscles count');
});

test('set fields per type, hold sets show time', () => {
  assert.deepEqual(setFields('weight_reps', 'normal'), ['kg', 'reps']);
  assert.deepEqual(setFields('weight_reps', 'hold'), ['kg', 'durationS']);
  assert.deepEqual(setFields('reps_only', 'hold'), ['durationS']);
  assert.deepEqual(setFields('distance_duration', 'normal'), ['distanceM', 'durationS']);
});

test('effective load: bodyweight types count bodyweight', () => {
  assert.equal(effectiveKg('weight_reps', 41.3), 41.3);
  assert.equal(effectiveKg('weighted_bodyweight', 5, 80), 85);
  assert.equal(effectiveKg('assisted_bodyweight', 20, 80), 60);
  assert.equal(effectiveKg('reps_only', null, 80), 80);
  assert.equal(effectiveKg('weighted_bodyweight', 5), 5, 'no bodyweight known: added load only');
});

test('no custom exercise without a name', () => {
  assert.throws(() => newCustomExercise({ name: '  ' }));
});
