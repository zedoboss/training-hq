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

test('neck at home (Wed 10/21): no plates, a water bottle filled by volume; the workout says which and how', async () => {
  const { bottleFor, withHomeNotes, neckTodayText, answerNeck } = await import('../app/js/lib/neck.js');
  assert.deepEqual(bottleFor(0.9), { ml: 900, text: 'a 1 L water bottle filled to 900 ml (0.9 kg)' });
  assert.equal(bottleFor(1.15).text, 'a 1.5 L water bottle filled to 1150 ml (1.15 kg)');
  assert.equal(bottleFor(0.45).text, 'a 0.5 L water bottle filled to 450 ml (0.45 kg)');
  const session = { dayType: 'neck', exercises: [{ key: 'a', name: 'Lying Neck Extension (Weighted)', notes: '' }], gym: 'Anytime' };
  const sets = [{ exKey: 'a', type: 'normal', kg: 0.9, target: { kg: 0.9 } }];
  const home = withHomeNotes(session, sets, { planned: true, place: 'after-push', where: 'home' });
  assert.match(home.exercises[0].notes, /^At home: a 1 L water bottle filled to 900 ml \(0\.9 kg\)\. Lie with your head just off the edge/);
  assert.equal(home.gym, 'Home');
  assert.equal(withHomeNotes(session, sets, { where: 'gym' }), session, 'at the gym: unchanged');
  assert.equal(neckTodayText('rest-day', 'home'), 'Neck today (rest day, at home)');
  assert.equal(neckTodayText('after-push', 'gym'), 'Neck after Push today, at the gym');
  assert.equal(answerNeck(null, 'rest-day', '2026-03-18', { where: 'home', homeGear: 'water bottles, a towel' }).homeGear, 'water bottles, a towel');
});
