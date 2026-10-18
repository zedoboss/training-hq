import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neckAsk, answerNeck, neckToday, placeLabel, neckTodayText, neckDoneOn } from '../app/js/lib/neck.js';

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

test('neck after Push (his answer Sun 10/18): the Train line, done-today check, and no weekly ask', () => {
  const neck = { planned: true, place: 'after-push', on: '2026-10-18', lastAskedOn: '2026-10-18', answers: [{ date: '2026-10-18', answer: 'after-push' }] };
  assert.equal(neckTodayText('after-push'), 'Neck after Push today');
  assert.equal(neckTodayText('rest-day'), 'Neck today (rest day)');
  assert.equal(neckAsk(neck, '2026-12-01'), false);
  assert.equal(neckToday(neck, 'train', 'push'), true);
  assert.equal(neckToday(neck, 'rest', null), false);
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const at = Date.parse('2026-10-20T05:00:00Z');
  assert.equal(neckDoneOn([{ dayType: 'push', status: 'done', startedAt: at }], '2026-10-20', dayOf), false);
  assert.equal(neckDoneOn([{ dayType: 'neck', status: 'discarded', startedAt: at }], '2026-10-20', dayOf), false);
  assert.equal(neckDoneOn([{ dayType: 'neck', status: 'active', startedAt: at }], '2026-10-20', dayOf), true);
  assert.equal(neckDoneOn([{ dayType: 'neck', status: 'done', startedAt: at }], '2026-10-21', dayOf), false);
});
