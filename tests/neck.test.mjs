import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neckAsk, answerNeck, neckToday, placeLabel } from '../app/js/lib/neck.js';

test('neck: asked weekly until he picks a place; the answer is kept', () => {
  assert.equal(neckAsk(null, '2026-01-10'), true);
  const later = answerNeck(null, 'not-yet', '2026-01-10');
  assert.deepEqual(later, { planned: false, answers: [{ date: '2026-01-10', answer: 'not-yet' }], lastAskedOn: '2026-01-10' });
  assert.equal(neckAsk(later, '2026-01-16'), false);
  assert.equal(neckAsk(later, '2026-01-17'), true);
  const plan = answerNeck(later, 'after-pull', '2026-01-17');
  assert.equal(plan.planned, true);
  assert.equal(plan.answers.length, 2);
  assert.equal(neckAsk(plan, '2026-03-01'), false);
  assert.equal(neckToday(plan, 'train', 'pull'), true);
  assert.equal(neckToday(plan, 'done', 'pull'), true);
  assert.equal(neckToday(plan, 'train', 'push'), false);
  assert.equal(neckToday(answerNeck(null, 'rest-day', '2026-01-17'), 'rest', null), true);
  assert.equal(placeLabel('after-legs'), 'After Legs');
});
