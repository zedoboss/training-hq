// Sat 10/24, his words: "I accidentally did 50 last workout. He didn't check what I was doing before that. I jumped way
// too high. So he should have recommended me to go back lower." His rear delt fly card kept F 50 × 6 (after 29 × 12 the
// session before) as "ahead of the table". A last load more than 30% over the 4 weeks before it (and more than one
// step) is a jump now: today builds on the earlier history, under its cap. Made-up history, his shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetFor, lastNotes, jumpOf, jumpFrom } from '../app/js/lib/targets.js';
import { buildHistory } from '../app/js/lib/history.js';
import { buildSession } from '../app/js/lib/session.js';
import { RULES } from '../server/coach/prompt.mjs';

const w = (kg, reps, sets) => ({ load: { type: 'total', kg, approx: false }, reps, sets });
const fly = { capClass: 'light', weeks: [w(22, [10, 12], { count: 1 }), w(29, [8, 10], { count: 2 }), w(32, [6, 8], { count: 2 }), w(36, [6, 8], { count: 2 })] };
const NAME = 'Rear Delt Reverse Fly (Machine)';
const e = (date, sets, note = '') => ({ date, sets: sets.map(([kg, reps, type = 'normal']) => ({ type, kg, reps })), heaviest: sets.reduce((b, [kg, reps]) => (!b || kg > b.kg ? { kg, reps } : b), null), ...(note ? { note } : {}) });
const his = [e('2026-10-19', [[50, 6, 'failure'], [36, 12]]), e('2026-10-11', [[29, 12], [29, 12]]), e('2026-10-04', [[23, 12], [23, 12]])];
const tFor = (entries, week = 4, plan = fly, name = NAME) => targetFor({ plan, week, last: { ...entries[0].heaviest, date: entries[0].date }, notes: lastNotes(entries), name });

test('his rear delt fly: F 50 × 6, 36 × 12 after 29 × 12 is a jump; today is 36 kg from the table, and it says why', () => {
  const t = tFor(his);
  assert.equal(t.kg, 36, 'not 50');
  assert.equal(t.jumpLast, true);
  assert.equal(t.why, "Last time's 50 kg × 6 was a jump: 72% over your 29 kg on Sunday 10/11, past the 30% cap, so not your new start. Your other set, 36 kg × 12, is at the table (36 kg): 36 kg today");
  // A higher table: the cap from the earlier weeks (29 × 1.3 = 37.7) holds, rounded down to 37.5.
  const big = tFor(his, 4, { ...fly, weeks: [...fly.weeks.slice(0, 3), w(43, [6, 8], { count: 2 })] });
  assert.equal(big.kg, 37.5);
  assert.match(big.why, /From your other set, 36 kg × 12, \+5 kg reaches the 30% cap: 37\.5 kg$/);
});

test('every set at the jump: back to the load before it, one step up, under its cap', () => {
  const t = tFor([e('2026-10-19', [[50, 8], [50, 7]]), e('2026-10-11', [[29, 12], [29, 12]])]);
  assert.equal(t.kg, 34, '29 + 5');
  assert.match(t.why, /From your 29 kg × 12 on Sunday 10\/11, \+5 kg\. Goal/);
});

test('not a jump: one step (light dumbbells, 7.5 -> 10 is 33%), a build-up inside the cap, a heavier week in the 4 before', () => {
  const curl = { capClass: 'light', weeks: [w(5, [10, 12], { count: 1 }), w(7.5, [8, 10], { count: 2 }), w(10, [6, 8], { count: 2 }), w(15, [6, 8], { count: 2 })] };
  const step = tFor([e('2026-10-19', [[10, 8], [10, 8]]), e('2026-10-11', [[7.5, 12]])], 4, curl, 'Preacher Curl (Dumbbell)');
  assert.equal(step.jumpLast, undefined);
  assert.equal(step.kg, 12.5, 'the usual step on top of 10');
  assert.equal(jumpFrom(lastNotes([e('2026-10-19', [[10, 8]]), e('2026-10-11', [[7.5, 12]])]).jump, 2.5), null);
  const inside = tFor([e('2026-10-19', [[36, 8], [36, 8]]), e('2026-10-11', [[29, 12], [29, 12]])]);
  assert.equal(inside.kg, 36);
  assert.match(inside.why, /^You're ahead of the table/, 'his normal ahead-of-plan hold stays');
  const heavierBefore = [e('2026-10-19', [[50, 8], [50, 8]]), e('2026-10-12', [[30, 12]]), e('2026-10-01', [[40, 10]])];
  assert.equal(lastNotes(heavierBefore).jump, undefined, '50 is inside 40 × 1.3 = 52 from 2 weeks before');
  // Nothing in the 4 weeks before: the session right before still counts (a long break back at a big load is a jump).
  assert.equal(jumpOf(e('2026-10-19', [[50, 8]]), [e('2026-08-01', [[29, 12]])]).jump.basis.kg, 29);
  assert.equal(lastNotes([e('2026-10-19', [[50, 8]])]).jump, undefined, 'no history before: nothing to compare');
});

test('ahead of the table on one set only: the other set fell below it, so build on that set', () => {
  const t = tFor([e('2026-10-19', [[37, 6], [30, 12]]), e('2026-10-11', [[29, 12], [29, 12]])]);
  assert.equal(t.kg, 35, '30 + 5, under the table');
  assert.equal(t.loneLast, true);
  assert.match(t.why, /^Only one set at 37 kg last time, the other was 30 kg × 12/);
  const both = tFor([e('2026-10-19', [[37, 6], [36, 8]]), e('2026-10-11', [[29, 12], [29, 12]])]);
  assert.equal(both.kg, 37, 'both sets at the table: hold as before');
  const drop = tFor([e('2026-10-19', [[37, 8], [37, 8], [25, 10, 'dropset']]), e('2026-10-11', [[29, 12]])]);
  assert.equal(drop.kg, 37, 'a drop set never counts as the other set');
});

test('pain or a skip last time still wins over the jump rule', () => {
  const sq = { capClass: 'main', weeks: [w(40, [10, 12], { count: 1 }), w(50, [8, 10], { count: 2 }), w(65, [6, 8], { count: 2 }), w(80, [6, 8], { count: 2 })] };
  const hurt = targetFor({ plan: sq, week: 4, barKg: 11.3, last: { kg: 71.3, reps: 8 }, name: 'Squat (Smith Machine)', notes: lastNotes([e('2026-10-22', [[71.3, 8]], 'lower back pain'), e('2026-10-18', [[51.8, 8]])]) });
  assert.equal(hurt.painLast, true);
  assert.equal(hurt.kg, 54.3);
});

test('Start builds the card from it, and a routine without a table steps from before the jump too', () => {
  const bridge = { exercises: { [NAME]: his.map((x) => ({ ...x, start: `${x.date}T10:00`, title: 'Pull', dayType: 'pull' })) } };
  const h = buildHistory({ bridge });
  const lib = new Map([['fly', { id: 'fly', type: 'weight_reps', equipment: 'machine' }]]);
  const programmeRoutines = [{ id: 'pull-gbi', exercises: [{ comebackName: NAME, ...fly }] }];
  const planned = { id: 'pull-gbi', title: 'Pull', dayType: 'pull', exercises: [{ key: 'k', exerciseId: 'fly', name: NAME, plan: { routine: 'pull-gbi', name: NAME }, sets: [] }] };
  const a = buildSession({ routine: planned, meta: { firstSessions: { pull: '2026-09-24' } }, programmeRoutines, lib, history: h, today: '2026-10-24' });
  assert.equal(a.session.exercises[0].target.kg, 36);
  assert.deepEqual(a.sets.filter((x) => x.type !== 'warmup').map((x) => x.kg), [36, 36]);
  const free = { id: 'pull-normal', title: 'Pull', dayType: 'pull', exercises: [{ key: 'k', exerciseId: 'fly', name: NAME, plan: null, sets: [{ type: 'normal', reps: [6, 8] }, { type: 'normal', reps: [6, 8] }] }] };
  const b = buildSession({ routine: free, meta: {}, lib, history: h, today: '2026-10-24' });
  assert.ok(b.sets.every((x) => x.kg <= 37.7), `never over 29 × 1.3: ${b.sets.map((x) => x.kg)}`);
  assert.equal(b.sets[0].kg, 37.5, 'not 55 (50 + 5)');
});

test('the coach checks the sessions before the last one before backing a weight', () => {
  assert.match(RULES, /look at the sessions before the last one too/);
  assert.match(RULES, /30% over the 4 weeks before it/);
});
