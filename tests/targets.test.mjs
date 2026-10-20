import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadable, capOf, targetFor, guardCheck, setCount, weekCell } from '../app/js/lib/targets.js';

const w = (kg, reps, sets, extra = {}) => ({ load: kg == null ? null : { type: 'total', kg, approx: false }, reps, sets, ...extra });
const bench = { capClass: 'main', weeks: [w(35, [10, 12], { firstSession: 1, after: 2 }), w(45, [8, 10], { count: 2 }), w(57.5, [6, 8], { count: 2 }), w(70, [6, 8], { count: 2 })] };
const incline = { capClass: 'main', weeks: [w(25, [10, 12], { firstSession: 1, after: 2 }), w(30, [8, 10], { count: 2 }), w(37.5, [8, 10], { count: 2 }), w(47.5, [6, 8], { count: 2 })] };
const lateral = { capClass: 'light', weeks: [w(2.5, [12, 15], { firstSession: 1, after: 2 }), w(5, [12, 15], { count: 2 }), w(7.5, [10, 12], { count: 2 }), w(10, [10, 12], { count: 2 })] };

test('loadable weights: Smith bar + plates per side in 1.25 kg steps; machines in 0.5 kg', () => {
  assert.equal(loadable(53.69, { barKg: 11.3 }), 51.3, '53.69 would need 21.195/side; 20/side is the most under it');
  assert.equal(loadable(53.8, { barKg: 11.3 }), 53.8);
  assert.equal(loadable(65, { barKg: 11.3 }), 63.8);
  assert.equal(loadable(10, { barKg: 11.3 }), 11.3, 'never below the bar');
  assert.equal(loadable(37.7), 37.5);
  assert.equal(capOf(41.3), 53.69);
});

test('bench, Sunday 10/18 (week 4): table 70, last 51.3 -> capped at 66.69 -> loadable 66.3', () => {
  const t = targetFor({ plan: bench, week: 4, last: { kg: 51.3, reps: 12, date: '2026-10-12' }, barKg: 11.3 });
  assert.equal(t.capKg, 66.69);
  assert.equal(t.kg, 66.3);
  assert.deepEqual(t.reps, [6, 8]);
  assert.equal(t.sets, 2);
  assert.equal(t.why, 'Cap 66.7 kg: last time 51.3 kg + 30%. Plan says 70 kg');
});

test('ahead of the table: hold at the last load, never go backwards (incline 41.6 vs week 3 table 37.5)', () => {
  const t = targetFor({ plan: incline, week: 3, last: { kg: 41.6, reps: 12, date: '2026-10-12' }, barKg: 11.3 });
  assert.equal(t.kg, 41.6);
  assert.match(t.why, /^You're ahead of the table \(37\.5 kg\): stay at your last 41\.6 kg$/);
});

test('light work follows the table without the cap', () => {
  const t = targetFor({ plan: lateral, week: 4, last: { kg: 5, reps: 12, date: '2026-10-12' } });
  assert.equal(t.kg, 10);
  assert.equal(t.capKg, null);
});

test('first session of an exercise uses the first-session set count', () => {
  assert.equal(setCount({ firstSession: 1, after: 2 }, false), 1);
  assert.equal(setCount({ firstSession: 1, after: 2 }, true), 2);
  assert.equal(setCount({ min: 2, max: 3 }, true), 3);
  assert.equal(weekCell(bench, 7).load.kg, 70, 'past week 4: week 4 until step 4 proposals');
});

test('gated lift not started yet (RDL): week 1, form focus', () => {
  const rdl = { capClass: 'main', weeks: [{ ...w(10, [10, 15], { firstSession: 1, after: 2 }), load: { type: 'total', kg: 10, approx: true } }, w(12.5, [10, 15], { count: 2 }), w(15, [10, 12], { count: 2 }), { ...w(17.5, [8, 12], { count: 2 }), gate: 'form-on-video' }] };
  const t = targetFor({ plan: rdl, week: 3, last: null });
  assert.equal(t.week, 1);
  assert.equal(t.kg, 10);
  assert.equal(t.approx, true);
  assert.equal(t.sets, 1);
});

test('calf raises (decision 3) and extras: the target is the last load', () => {
  const calves = { capClass: 'light', override: { source: 'brief decision 3' }, weeks: [w(null, [15, 20], { firstSession: 1, after: 2 }), w(null, [15, 20], { count: 2 }), w(null, [15, 20], { min: 2, max: 3 }), w(null, [15, 20], { min: 2, max: 3 })] };
  assert.equal(targetFor({ plan: calves, week: 3, last: { kg: 63, reps: 15, date: '2026-10-10' } }).kg, 63);
  assert.equal(targetFor({ plan: { capClass: 'light', weeks: null }, week: 3, last: { kg: 29, reps: 15 } }).kg, 29);
});

test('bodyweight and added-load cells', () => {
  const pull = { capClass: 'main', weeks: [{ load: { type: 'bodyweight' }, reps: [5, 8], sets: { firstSession: 1, after: 2 } }, { load: { type: 'bodyweight' }, reps: [8, 10], sets: { count: 2 } }, { load: { type: 'added', kg: 5 }, reps: [6, 8], sets: { count: 2 } }, { load: { type: 'added', kg: 10 }, reps: [6, 8], sets: { count: 2 } }] };
  const t4 = targetFor({ plan: pull, week: 4, last: { kg: null, reps: 11, date: '2026-10-11' } });
  assert.equal(t4.added, true);
  assert.equal(t4.kg, 10);
  assert.equal(targetFor({ plan: pull, week: 2, last: null }).bodyweight, true);
});

test('30% guard: previous 7 days first, else the last session; main lifts only', () => {
  const history = [{ date: '2026-10-12', kg: 51.3 }, { date: '2026-10-06', kg: 41.3 }];
  // Sunday 10/18: 10/12 is within 7 days.
  const g = guardCheck({ kg: 70, capClass: 'main', history, today: '2026-10-18', barKg: 11.3 });
  assert.equal(g.basis.kg, 51.3);
  assert.equal(g.basis.window, '7 days');
  assert.equal(g.over, 36);
  assert.equal(g.suggest, 66.3);
  assert.equal(guardCheck({ kg: 66.3, capClass: 'main', history, today: '2026-10-18' }), null);
  // Saturday 10/24: nothing in the last 7 days -> last session.
  const g2 = guardCheck({ kg: 70, capClass: 'main', history, today: '2026-10-24' });
  assert.equal(g2.basis.window, 'last session');
  assert.equal(guardCheck({ kg: 100, capClass: 'light', history, today: '2026-10-18' }), null, 'light work is exempt');
  assert.equal(guardCheck({ kg: 100, capClass: 'main', history: [], today: '2026-10-18' }), null, 'no history, no guard');
});

test('guard: an earlier session the same day counts', () => {
  const g = guardCheck({ kg: 80, capClass: 'main', history: [{ date: '2026-10-17', kg: 56.3 }, { date: '2026-10-10', kg: 43.8 }], today: '2026-10-17', barKg: 11.3 });
  assert.equal(g.basis.kg, 56.3);
});
