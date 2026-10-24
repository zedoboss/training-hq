// Sat 10/24, his words: "Why is there no previous weight on cupping?? Wtf fix". Cupping is done both as reps and as a
// hold; the last session was holds only (H 9 kg × 30 s × 3), so the card said "Plan: 25 kg (no previous load)" over his
// 9 kg rep sets. Today's weight, the Previous column and the coach's card line come from the last rep sets now.
// Made-up history, his shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory } from '../app/js/lib/history.js';
import { buildSession } from '../app/js/lib/session.js';

const w = (kg) => ({ load: { type: 'total', kg, approx: false }, reps: [12, 15], sets: { firstSession: 1, after: 2 } });
const cup = { comebackName: 'Cupping', capClass: 'light', weeks: [w(10), w(14), w(20), w(25)] };
const NAME = 'Cupping';
const lib = new Map([['cupping', { id: 'cupping', name: NAME, type: 'weight_reps', equipment: 'cable', capClass: 'light' }]]);
const programmeRoutines = [{ id: 'pull-gbi', exercises: [cup] }];
const routine = { id: 'pull-gbi', title: 'Pull', dayType: 'pull', exercises: [{ key: 'k', exerciseId: 'cupping', name: NAME, plan: { routine: 'pull-gbi', name: NAME }, sets: [] }] };
const meta = { firstSessions: { pull: '2026-09-24' } };

let n = 0;
const day = (date, rows) => {
  const id = `s${++n}`;
  const startedAt = Date.parse(`${date}T10:00:00Z`);
  return {
    session: { id, status: 'done', startedAt, source: 'training-hq', dayType: 'pull', routineId: 'pull-gbi', exercises: [{ key: 'c', name: NAME }] },
    sets: rows.map(([type, kg, reps, durationS = null], i) => ({ id: `${id}-${i}`, sessionId: id, exKey: 'c', order: i, done: true, type, kg, reps, durationS })),
  };
};
const hist = (days) => buildHistory({ sessions: days.map((d) => d.session), sets: days.flatMap((d) => d.sets) });
const reps = [
  day('2026-10-04', [['normal', 9, 20], ['normal', 9, 20], ['normal', 9, 15], ['normal', 9, 15]]),
  day('2026-10-11', [['normal', 9, 20], ['normal', 9, 15]]),
  day('2026-10-19', [['normal', 9, 16], ['normal', 9, 15], ['normal', 6.8, 15], ['normal', 6.8, 15]]),
];
const holds = day('2026-10-22', [['hold', 9, null, 30], ['hold', 9, null, 30], ['hold', 9, null, 30]]);
const start = (h) => buildSession({ routine, meta, programmeRoutines, lib, history: h, today: '2026-10-24' });

test('his cupping: a hold-only last session, the target builds on Monday 10/19\'s 9 kg rep sets, not the plan\'s 25', () => {
  const h = hist([...reps, holds]);
  assert.equal(h.last(NAME).date, '2026-10-22');
  assert.equal(h.lastLifted(NAME).date, '2026-10-19');
  assert.deepEqual(h.lifted(NAME).map((e) => e.date), ['2026-10-19', '2026-10-11', '2026-10-04']);
  const { session, sets } = start(h);
  const t = session.exercises[0].target;
  assert.equal(t.kg, 14, 'his 9 kg plus one cable step (decision 33), not 25');
  assert.doesNotMatch(t.why, /no previous load/);
  assert.equal(t.why, 'Thursday 10/22 was holds only, so from your rep sets: Monday 10/19 9 kg, +5 kg. Goal (The Comeback, week 4): 25 kg');
  assert.deepEqual(sets.map((x) => x.kg), [14, 14]);
  // Same card as with no hold session at all, apart from the why.
  const plain = start(hist(reps)).session.exercises[0].target;
  assert.equal(plain.kg, t.kg);
  assert.equal(plain.holdsLast, undefined);
});

test('short of the reps last rep session: the same 9 kg, still not 25', () => {
  const short = day('2026-10-19', [['normal', 9, 10], ['normal', 9, 10]]);
  const t = start(hist([...reps.slice(0, 2), short, holds])).session.exercises[0].target;
  assert.equal(t.kg, 9);
  assert.match(t.why, /^Thursday 10\/22 was holds only, so from your rep sets: Same as Monday 10\/19 \(9 kg × 10\): get to 12 reps first/);
});

test('Previous column: rep rows from the last rep sets, hold rows from the last holds', () => {
  const p = hist([...reps, holds]).previous(NAME);
  assert.deepEqual(p.working.map((x) => [x.kg, x.reps]), [[9, 16], [9, 15], [6.8, 15], [6.8, 15]]);
  assert.deepEqual(p.hold.map((x) => [x.kg, x.durationS]), [[9, 30], [9, 30], [9, 30]]);
  // Reps last: holds come from the hold session before it.
  const later = day('2026-10-25', [['normal', 9, 15]]);
  const q = hist([...reps, holds, later]).previous(NAME);
  assert.deepEqual(q.working.map((x) => x.kg), [9]);
  assert.equal(q.hold.length, 3);
});

test('holds only, ever: still the plan number, and reps then a hold in one session change nothing', () => {
  const t = start(hist([holds])).session.exercises[0].target;
  assert.equal(t.kg, 25);
  assert.match(t.why, /no previous load/);
  const mixed = day('2026-10-22', [['normal', 9, 15], ['normal', 9, 15], ['hold', 9, null, 30]]);
  const m = start(hist([...reps, mixed])).session.exercises[0].target;
  assert.equal(m.kg, 14);
  assert.equal(m.holdsLast, undefined, 'that session had rep sets: it is the last rep session');
});

test('a bodyweight rep session (no kg) still counts as the last rep session', () => {
  const bw = day('2026-10-19', [['normal', null, 11], ['failure', null, 6]]);
  const old = day('2026-04-02', [['failure', 20, 7]]);
  const h = hist([old, bw]);
  assert.equal(h.lastLifted(NAME).date, '2026-10-19');
  assert.deepEqual(h.lifted(NAME).map((e) => e.date), ['2026-10-19', '2026-04-02']);
});

test('pain written on the hold-only session still keeps today at his last rep weight, no step', () => {
  const sore = day('2026-10-22', [['hold', 9, null, 30], ['hold', 9, null, 30]]);
  sore.session.exercises[0].notes = 'shoulder hurt on the last hold';
  const t = start(hist([...reps, sore])).session.exercises[0].target;
  assert.equal(t.kg, 9);
  assert.equal(t.painLast, true);
  assert.match(t.why, /^Last time 9 kg hurt \("shoulder hurt on the last hold"\)\. Stay at 9 kg, no step/);
  // No pain on it: the step from Monday's rep sets as before.
  assert.equal(start(hist([...reps, holds])).session.exercises[0].target.kg, 14);
});
