import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeWeek, confirmWeek, confirmedKg, isConfirmed, normalReady, ceilingFor, modeOf } from '../app/js/lib/progression.js';
import { targetFor, weekCell } from '../app/js/lib/targets.js';

// Neutral made-up numbers (no personal programme in the public repo).
const total = (...kgs) => kgs.map((kg, i) => ({ week: i + 1, load: { type: 'total', kg }, reps: [8, 10], sets: { count: 2 } }));
const plan = {
  dayType: 'legs',
  exercises: [
    { name: 'Lift A', comebackName: 'Lift A', capClass: 'main', weeks: total(40, 50, 60, 70) },
    { name: 'Lift B', comebackName: 'Lift B (Old Name)', capClass: 'main', weeks: total(10, 12, 14, 18) },
    { name: 'Lift C', capClass: 'main', weeks: total(20, 30, 40, 50).map((w, i) => (i === 3 ? { ...w, gate: 'form on video' } : w)) },
    { name: 'Lift D', capClass: 'light', weeks: [] },
    { name: 'Lift E', capClass: 'main', weeks: [{ load: { type: 'bodyweight' } }, { load: { type: 'bodyweight' } }, { load: { type: 'added', kg: 4 } }, { load: { type: 'added', kg: 8 } }] },
    { name: 'Lift F', capClass: 'light', weeks: total(2, 4, 5, 10) },
  ],
};
const meta = { preLayoffCeilings: [{ name: 'Lift A', kg: 85 }, { name: 'Lift B (Old Name)', kg: 40 }, { name: 'Lift E', addedKg: 10 }] };

test('week 5 proposal: the week 3 to 4 step, capped at 30% and at the pre-layoff number', () => {
  const p = proposeWeek({ planRoutine: plan, week: 5, meta });
  const by = Object.fromEntries(p.items.map((i) => [i.name, i]));
  assert.equal(by['Lift A'].kg, 80); // 70 + 10
  assert.equal(by['Lift B'].kg, 22); // 18 + 4 (ceiling found through the old name)
  assert.equal(by['Lift C'].skip, true); // gated on form
  assert.equal(by['Lift D'].skip, true); // no table
  assert.equal(by['Lift E'].kg, 10); // added 8 + 4 = 12, ceiling +10
  assert.match(by['Lift E'].why, /pre-layoff 10/);
  assert.equal(by['Lift F'].kg, 13); // 10 + 5 = 15 is over 30% of 10: 13
  assert.match(by['Lift F'].why, /30% cap/);
  assert.equal(ceilingFor(meta, plan.exercises[1]), 40);
});

test('week 6 builds on the confirmed week 5, never above the ceiling', () => {
  const p5 = proposeWeek({ planRoutine: plan, week: 5, meta });
  const c5 = confirmWeek(p5, { 'Lift A': 77.5 }, { now: 1, today: '2026-01-05' });
  assert.equal(c5.exercises.find((e) => e.name === 'Lift A').edited, true);
  const p6 = proposeWeek({ planRoutine: plan, week: 6, meta, progress: [c5] });
  assert.equal(p6.items.find((i) => i.name === 'Lift A').kg, 85); // 77.5 + 10 = 87.5, ceiling 85
  assert.equal(p6.items.find((i) => i.name === 'Lift A').fromKg, 77.5);
  assert.equal(p6.items.find((i) => i.name === 'Lift E').kg, 10); // already at the ceiling
});

test('rounding to loadable weights on a bar never drops below last week', () => {
  const p = proposeWeek({ planRoutine: { dayType: 'push', exercises: [plan.exercises[0]] }, week: 5, meta, barKgOf: () => 10, smallestPlate: 2.5 });
  assert.equal(p.items[0].kg, 80); // 10 bar + 2 x 35
  const tight = proposeWeek({ planRoutine: { dayType: 'push', exercises: [{ name: 'Lift G', capClass: 'main', weeks: total(1, 2, 3, 4) }] }, week: 5, barKgOf: () => 3, smallestPlate: 2.5 });
  assert.equal(tight.items[0].kg, 4); // 4 + 1 = 5 isn't loadable on a 3 kg bar with 2.5 plates: stays 4
});

test('confirmed numbers: latest week up to the one asked; targets use them past week 4', () => {
  const progress = [
    { dayType: 'legs', week: 5, confirmedAt: 1, exercises: [{ name: 'Lift A', kg: 80 }] },
    { dayType: 'legs', week: 6, confirmedAt: null, exercises: [{ name: 'Lift A', kg: 90 }] },
    { dayType: 'pull', week: 6, confirmedAt: 2, exercises: [{ name: 'Lift A', kg: 99 }] },
  ];
  assert.deepEqual(confirmedKg(progress, 'legs', 7, 'Lift A'), { week: 5, kg: 80 });
  assert.equal(confirmedKg(progress, 'legs', 4, 'Lift A'), null);
  assert.equal(isConfirmed(progress, 'legs', 6), false);
  assert.equal(isConfirmed(progress, 'pull', 6), true);
  assert.equal(weekCell(plan.exercises[0], 6, 80).load.kg, 80);
  assert.equal(weekCell(plan.exercises[0], 6).load.kg, 70);
  const t = targetFor({ plan: plan.exercises[0], week: 6, last: { kg: 70, reps: 8 }, progressKg: 80 });
  // Decision 33 (Thu 10/22): one step over the last load; the confirmed number is the goal.
  assert.equal(t.kg, 72.5);
  assert.equal(t.why, 'Last time 70 kg, +2.5 kg. Goal (week 6, confirmed): 80 kg');
  assert.equal(targetFor({ plan: plan.exercises[0], week: 6, last: { kg: 50, reps: 8 }, progressKg: 80 }).kg, 52.5);
});

test('Normal switch: main lifts at their week 4 number in the last 2 sessions of that day type', () => {
  const entries = {
    'Lift A': [{ dayType: 'legs', date: '2026-01-09', heaviest: { kg: 70 } }, { dayType: 'legs', date: '2026-01-05', heaviest: { kg: 72.5 } }, { dayType: 'legs', date: '2026-01-01', heaviest: { kg: 60 } }],
    'Lift B': [{ dayType: 'legs', date: '2026-01-09', heaviest: { kg: 18 } }, { dayType: 'push', date: '2026-01-07', heaviest: { kg: 5 } }, { dayType: 'legs', date: '2026-01-05', heaviest: { kg: 18 } }],
    'Lift E': [{ dayType: 'legs', date: '2026-01-09', heaviest: { kg: 8 } }, { dayType: 'legs', date: '2026-01-05', heaviest: { kg: 8 } }],
  };
  const history = { all: (n) => entries[n] || [] };
  const r = normalReady({ planRoutine: plan, history });
  assert.equal(r.ready, true);
  assert.deepEqual(r.lifts.map((l) => l.name), ['Lift A', 'Lift B', 'Lift E']); // gated and light lifts left out
  entries['Lift B'][0].heaviest.kg = 16;
  assert.equal(normalReady({ planRoutine: plan, history }).ready, false);
  assert.equal(normalReady({ planRoutine: plan, history: { all: () => [] } }).ready, false);
  // Sessions before the comeback don't count.
  entries['Lift B'][0].heaviest.kg = 18;
  assert.equal(normalReady({ planRoutine: plan, history }).ready, true);
  assert.equal(normalReady({ planRoutine: plan, history, since: '2026-01-06' }).ready, false);
  assert.equal(modeOf({ legs: { mode: 'normal' } }, 'legs'), 'normal');
  assert.equal(modeOf(null, 'pull'), 'comeback');
});
