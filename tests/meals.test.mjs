import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultMealName, newMeal, cleanItems, itemTotals, regram, scaleTo, currentEstimate, beforeItems, leftovers, netItems,
  mealState, mealTotals, dayTotals, afterPhotoAt, mealMarks, AFTER_PHOTO_MIN,
} from '../app/js/lib/meals.js';
import { zonedTime } from '../app/js/lib/time.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (hm, day = '2026-10-18') => zonedTime(day, hm, TZ);

test('meal name: his meal times when set (within 90 minutes), else by the clock', () => {
  assert.equal(defaultMealName(at('07:00'), [], TZ), 'Breakfast');
  assert.equal(defaultMealName(at('12:30'), [], TZ), 'Lunch');
  assert.equal(defaultMealName(at('16:00'), [], TZ), 'Snack');
  assert.equal(defaultMealName(at('19:00'), [], TZ), 'Dinner');
  assert.equal(defaultMealName(at('23:30'), [], TZ), 'Snack');
  const times = [{ name: 'Post-workout', time: '07:30' }, { name: 'Lunch', time: '13:00' }];
  assert.equal(defaultMealName(at('08:10'), times, TZ), 'Post-workout');
  assert.equal(defaultMealName(at('10:30'), times, TZ), 'Lunch');
  assert.equal(defaultMealName(at('16:00'), times, TZ), 'Snack');
});

test('a new meal from a photo waits for its estimate; a manual one is done', () => {
  const m = newMeal({ id: 'm1', at: at('13:04'), photoId: 'p1', name: 'Lunch', tz: TZ });
  assert.equal(m.date, '2026-10-18');
  assert.equal(m.source, 'photo');
  assert.equal(mealState(m, []), 'reading');
  const manual = newMeal({ id: 'm2', at: at('13:04'), name: 'Lunch', tz: TZ });
  assert.equal(manual.source, 'manual');
  assert.equal(mealState(manual, []), 'done');
});

test('items: cleaned, totalled, regrammed and scaled to the scale reading', () => {
  const items = cleanItems([{ name: ' Beef ', grams: '200', kcal: 300, protein: 56 }, { name: '', grams: 212, kcal: 276, protein: 5.5 }, { grams: -3 }]);
  assert.deepEqual(items[0], { name: 'Beef', grams: 200, kcal: 300, protein: 56, unsure: false });
  assert.equal(items[1].name, 'Food');
  assert.equal(items[2].grams, 0);
  assert.deepEqual(itemTotals(items), { grams: 412, kcal: 576, protein: 61.5 });
  assert.deepEqual(regram(items[0], 100), { name: 'Beef', grams: 100, kcal: 150, protein: 28, unsure: false });
  const scaled = scaleTo(items.slice(0, 2), 206);
  assert.equal(itemTotals(scaled).grams, 206);
  assert.equal(scaled[0].kcal, 150);
});

const est = (mealId, kind, extra) => ({ id: `${mealId}.${kind}`, mealId, kind, round: 0, status: 'done', ...extra });

test('an estimate only counts for the photo the meal has now, and the latest round', () => {
  const m = newMeal({ id: 'm1', at: at('13:04'), photoId: 'p1', name: 'Lunch', tz: TZ });
  const e = est('m1', 'before', { photoId: 'p1', scaleG: 412, items: [{ name: 'Rice', grams: 412, kcal: 535, protein: 11 }] });
  assert.equal(currentEstimate(m, [e], 'before'), e);
  assert.equal(currentEstimate({ ...m, before: { ...m.before, photoId: 'p2' } }, [e], 'before'), null);
  assert.equal(currentEstimate({ ...m, round: 1 }, [e], 'before'), null);
  assert.equal(mealState(m, [e]), 'confirm');
  assert.equal(mealState(m, [{ ...e, status: 'failed' }]), 'failed');
  assert.equal(beforeItems(m, [e]).estimated, true);
  assert.equal(beforeItems(m, [e]).items[0].name, 'Rice');
});

test('confirm, then the after photo subtracts leftovers item by item', () => {
  const items = [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }, { name: 'Beef', grams: 180, kcal: 297, protein: 55 }];
  let m = newMeal({ id: 'm1', at: at('13:04'), photoId: 'p1', name: 'Lunch', tz: TZ });
  m = { ...m, before: { ...m.before, items, confirmedAt: at('13:06') } };
  assert.equal(mealState(m, []), 'after');
  assert.equal(afterPhotoAt(m), m.before.at + AFTER_PHOTO_MIN * 60000);
  m = { ...m, after: { photoId: 'p9', at: at('13:40'), none: false, leftovers: null, confirmedAt: null } };
  assert.equal(mealState(m, []), 'reading-after');
  const ea = est('m1', 'after', { photoId: 'p9', leftovers: [{ index: 0, name: 'Rice', grams: 50 }] });
  assert.equal(mealState(m, [ea]), 'confirm-after');
  assert.deepEqual(leftovers(m, [ea]), { items: ea.leftovers, estimated: true, pending: false });
  const t = mealTotals(m, [ea]);
  assert.equal(t.grams, 330);
  assert.equal(t.kcal, 195 + 297);
  assert.equal(t.estimated, true);
  m = { ...m, after: { ...m.after, leftovers: ea.leftovers, confirmedAt: at('13:42') } };
  assert.equal(mealState(m, [ea]), 'done');
  assert.equal(mealTotals(m, [ea]).estimated, false);
});

test('ate it all: no after photo, nothing subtracted', () => {
  let m = newMeal({ id: 'm1', at: at('13:04'), photoId: 'p1', name: 'Lunch', tz: TZ });
  m = { ...m, before: { ...m.before, items: [{ name: 'Eggs', grams: 100, kcal: 143, protein: 12.6 }], confirmedAt: 1 }, after: { none: true, photoId: null } };
  assert.equal(mealState(m, []), 'done');
  assert.equal(mealTotals(m, []).kcal, 143);
});

test('leftovers match by position, then by name, never below zero', () => {
  const before = [{ name: 'Rice', grams: 100, kcal: 130, protein: 2.7 }, { name: 'Egg', grams: 50, kcal: 72, protein: 6.3 }];
  assert.equal(netItems(before, [{ name: 'egg', grams: 50 }])[1].grams, 0);
  assert.equal(netItems(before, [{ index: 0, grams: 500 }])[0].grams, 0);
  assert.equal(netItems(before, [])[0].grams, 100);
});

test('a scale reading he corrected before confirming rescales the estimate (still to confirm)', () => {
  const m0 = newMeal({ id: 'm1', at: at('13:04'), photoId: 'p1', name: 'Lunch', tz: TZ });
  const e = est('m1', 'before', { photoId: 'p1', items: [{ name: 'Rice', grams: 400, kcal: 520, protein: 10 }] });
  const m = { ...m0, before: { ...m0.before, scaleG: 200, items: scaleTo(e.items, 200), edited: true } };
  assert.equal(beforeItems(m, [e]).items[0].grams, 200);
  assert.equal(mealState(m, [e]), 'confirm');
});

test('day totals count estimates (flagged) and meals still being read', () => {
  const a = { ...newMeal({ id: 'a', at: at('07:00'), name: 'Breakfast', tz: TZ }), before: { photoId: null, at: 1, items: [{ name: 'Eggs', grams: 500, kcal: 715, protein: 63 }], confirmedAt: 1 } };
  const b = newMeal({ id: 'b', at: at('13:00'), photoId: 'pb', name: 'Lunch', tz: TZ });
  const c = newMeal({ id: 'c', at: at('19:00'), photoId: 'pc', name: 'Dinner', tz: TZ });
  const ests = [est('b', 'before', { photoId: 'pb', items: [{ name: 'Beef', grams: 250, kcal: 412, protein: 76 }] })];
  const t = dayTotals([a, b, c], ests, '2026-10-18');
  assert.deepEqual(t, { grams: 750, kcal: 1127, protein: 139, meals: 3, estimated: 1, unread: 1 });
  const marks = mealMarks([a, b, c], ests);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].kind, 'meals');
  assert.match(marks[0].label, /Meals: 3 · 1,127 kcal · 139 g protein \(estimate\)/);
});
