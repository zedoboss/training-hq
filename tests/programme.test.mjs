import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekColumn, summarizeProgramme } from '../app/js/lib/programme.js';

test('week column moves up 7 days after the first session of that day type', () => {
  assert.equal(weekColumn('2026-01-01', '2026-01-01'), 1);
  assert.equal(weekColumn('2026-01-01', '2026-01-07'), 1);
  assert.equal(weekColumn('2026-01-01', '2026-01-08'), 2);
  assert.equal(weekColumn('2026-01-01', '2026-01-22'), 4);
  assert.equal(weekColumn('2026-01-01', '2026-01-29'), 5, 'keeps counting past week 4');
  assert.equal(weekColumn('2026-01-05', '2026-01-01'), null, 'before the first session');
  assert.equal(weekColumn(null, '2026-01-01'), null);
});

test('programme summary counts routines and distinct exercises', () => {
  const docs = [
    { kind: 'meta', title: 'Test plan', firstSessions: { pull: '2026-01-01', push: '2026-01-03', legs: '2026-01-04' } },
    { kind: 'routine', exercises: [{ name: 'A' }, { name: 'B' }] },
    { kind: 'routine', exercises: [{ name: 'B' }, { name: 'C' }] },
  ];
  assert.deepEqual(summarizeProgramme(docs, '2026-01-10'), {
    title: 'Test plan', routineCount: 2, exerciseCount: 3, weekColumns: { pull: 2, push: 2, legs: 1 },
  });
  assert.equal(summarizeProgramme([], '2026-01-10'), null);
});
