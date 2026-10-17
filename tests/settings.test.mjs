import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withDefaults, equipmentWithDefaults, mergeDeep, smallestPlate, barKgFor, restDefault, restFor,
  weightUnitFor, toUnit, fromUnit, toDistance, fromDistance, cleanWarmupSteps, DEFAULT_SETTINGS,
} from '../app/js/lib/settings.js';

test('settings fill in defaults and keep what was saved', () => {
  const s = withDefaults({ sounds: { restEnd: 'bell' }, rest: { mainS: 150 }, extra: 1 });
  assert.equal(s.sounds.restEnd, 'bell');
  assert.equal(s.sounds.timerVolume, DEFAULT_SETTINGS.sounds.timerVolume);
  assert.equal(s.rest.mainS, 150);
  assert.equal(s.rest.lightS, DEFAULT_SETTINGS.rest.lightS);
  assert.equal(s.extra, 1);
  assert.deepEqual(withDefaults(null), DEFAULT_SETTINGS);
  assert.notEqual(withDefaults(null).rest, DEFAULT_SETTINGS.rest, 'defaults are copied, never shared');
});

test('a patch changes one value without wiping its neighbours; arrays are replaced', () => {
  const cur = withDefaults({ sounds: { timerVolume: 30 } });
  const next = withDefaults(mergeDeep(cur, { sounds: { restEnd: 'chime' }, warmup: { steps: [{ pct: 60, reps: 5 }] } }));
  assert.equal(next.sounds.timerVolume, 30);
  assert.equal(next.sounds.restEnd, 'chime');
  assert.deepEqual(next.warmup.steps, [{ pct: 60, reps: 5 }]);
  assert.equal(next.warmup.countInStats, false);
});

test('plates: cleaned, largest first, never empty; smallest plate drives rounding', () => {
  assert.deepEqual(equipmentWithDefaults({ plates: [1.25, '20', 20, 0, 5] }).plates, [20, 5, 1.25]);
  assert.deepEqual(equipmentWithDefaults({ plates: [] }).plates, [20, 15, 10, 5, 2.5, 1.25]);
  assert.equal(smallestPlate({ plates: [20, 10, 2.5] }), 2.5);
  assert.equal(smallestPlate(null), 1.25);
});

test('bar weight comes from the equipment settings, then the exercise, else none', () => {
  const eq = { bars: [{ id: 'smith', equipment: 'smith', kg: 11.3 }, { id: 'bb', equipment: 'barbell', kg: 20 }] };
  assert.equal(barKgFor({ name: 'Squat (Smith Machine)', equipment: 'smith', barKg: 10 }, eq), 11.3);
  assert.equal(barKgFor({ name: 'Standing Calf Raise (Smith)', equipment: 'machine' }, eq), 11.3, 'Smith in the name counts');
  assert.equal(barKgFor({ name: 'Bench Press (Barbell)', equipment: 'barbell' }, eq), 20);
  assert.equal(barKgFor({ name: 'Leg Extension (Machine)', equipment: 'machine' }, eq), null);
  assert.equal(barKgFor({ name: 'Squat (Smith Machine)', equipment: 'smith', barKg: 11.3 }, { bars: [] }), 11.3, 'no bar set: the exercise keeps its own');
  assert.equal(barKgFor({ name: 'Bench Press (Barbell)', equipment: 'barbell' }, null), null);
});

test('rest: own time wins (0 = off), else main or light default; holds use the hold rest', () => {
  const s = { rest: { mainS: 180, lightS: 90, holdS: 120 } };
  assert.equal(restDefault({ capClass: 'main' }, s), 180);
  assert.equal(restDefault({ capClass: 'light' }, s), 90);
  assert.equal(restDefault({}, s), 90);
  assert.equal(restFor({ capClass: 'main', restSeconds: 150 }, 'normal', s), 150);
  assert.equal(restFor({ capClass: 'main', restSeconds: 0 }, 'normal', s), 0);
  assert.equal(restFor({ capClass: 'main', restSeconds: null }, 'normal', s), 180);
  assert.equal(restFor({ capClass: 'main', restSeconds: 150 }, 'hold', s), 120);
});

test('units: stored in kg and metres, shown in lb, km or miles', () => {
  assert.equal(weightUnitFor({ unit: 'lb' }, { units: { weight: 'kg' } }), 'lb');
  assert.equal(weightUnitFor({}, { units: { weight: 'lb' } }), 'lb');
  assert.equal(weightUnitFor({}, null), 'kg');
  assert.equal(toUnit(20, 'kg'), 20);
  assert.equal(toUnit(20, 'lb'), 44.1);
  assert.equal(fromUnit(45, 'lb'), 20.412);
  assert.equal(toUnit(fromUnit(45, 'lb'), 'lb'), 45, 'round trip keeps what he typed');
  assert.equal(toUnit(null, 'lb'), null);
  assert.equal(toDistance(5000, 'km'), 5);
  assert.equal(toDistance(1609, 'mi'), 1);
  assert.equal(fromDistance(2.5, 'km'), 2500);
  assert.equal(fromDistance(1, 'mi'), 1609);
});

test('warm-up steps typed on the Settings screen are cleaned and sorted', () => {
  assert.deepEqual(cleanWarmupSteps([{ pct: '75', reps: '4' }, { pct: 40, reps: 10 }, { pct: 0, reps: 5 }, { pct: 120, reps: 1 }, { pct: 60, reps: '' }]),
    [{ pct: 40, reps: 10 }, { pct: 75, reps: 4 }]);
});

test('a bar chosen for one exercise (EZ bar) wins; "none" means no bar; a bar without equipment type is opt-in', () => {
  const eq = { bars: [{ id: 'smith', equipment: 'smith', kg: 11.3 }, { id: 'ez', equipment: null, kg: 10 }] };
  assert.equal(barKgFor({ name: 'EZ Bar Biceps Curl', equipment: 'barbell', barId: 'ez' }, eq), 10);
  assert.equal(barKgFor({ name: 'Preacher Curl (Barbell)', equipment: 'barbell' }, eq), null, 'the EZ bar does not apply to every barbell exercise');
  assert.equal(barKgFor({ name: 'Squat (Smith Machine)', equipment: 'smith', barId: 'none' }, eq), null);
  assert.equal(barKgFor({ name: 'Squat (Smith Machine)', equipment: 'smith', barId: 'gone' }, eq), 11.3, 'a removed bar falls back to the equipment bar');
  assert.equal(equipmentWithDefaults({ bars: [{ id: 'ez', equipment: '', kg: 10 }] }).bars[0].equipment, null);
});
