import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partOf, statusOn, onWeekday, scheduledOn, doseFor, daysText, checklist, logEntry, streak, adherence, stockLeft, stockStatus,
  servingsPerDay, lastsText, suppMarks, trackingFrom,
} from '../app/js/lib/supplements.js';

const supp = (id, extra = {}) => ({ id, kind: 'supplement', name: id, short: id, dose: '5 g', doseRest: null, time: null, withFood: null, days: { type: 'daily' },
  status: 'active', history: [{ on: '2026-10-01', status: 'active' }], stock: null, perTake: { train: 1, rest: 1 }, order: 0, ...extra });
const take = (date, s, status = 'taken', at = Date.parse(`${date}T08:00:00Z`), dayKind = 'train') => logEntry({ supp: s, date, dayKind, status, at, reason: status === 'skipped' ? 'ran out' : '' });

test('times of day, day rules and the dated status history', () => {
  assert.equal(partOf('07:00'), 'Morning');
  assert.equal(partOf('12:30'), 'Midday');
  assert.equal(partOf('15:00'), 'Afternoon');
  assert.equal(partOf('21:00'), 'Evening');
  assert.equal(partOf('22:00'), 'Night');
  assert.equal(partOf(null), null);
  const d3 = supp('d3', { days: { type: 'perWeek', count: 6, offDay: null } });
  assert.equal(scheduledOn(d3, '2026-10-18'), true, 'no day off chosen yet: every day');
  assert.equal(onWeekday({ type: 'perWeek', count: 6, offDay: 0 }, 0), false);
  assert.equal(onWeekday({ type: 'perWeek', count: 6, offDay: 0 }, 1), true);
  assert.equal(onWeekday({ type: 'weekdays', weekdays: [1, 3] }, 2), false);
  assert.equal(daysText(d3.days), '6 days a week · day off not set');
  assert.equal(daysText({ type: 'perWeek', count: 6, offDay: 0 }), '6 days a week · Sunday off');
  assert.equal(daysText({ type: 'weekdays', weekdays: [5, 1] }), 'Mon, Fri');
  const paused = supp('p', { history: [{ on: '2026-10-01', status: 'active' }, { on: '2026-10-10', status: 'paused' }, { on: '2026-10-15', status: 'active' }] });
  assert.equal(statusOn(paused, '2026-09-30'), 'none');
  assert.equal(statusOn(paused, '2026-10-12'), 'paused');
  assert.equal(scheduledOn(paused, '2026-10-12'), false);
  assert.equal(scheduledOn(paused, '2026-10-16'), true);
});

test('magnesium: the rest-day dose on a rest day, and its servings', () => {
  const mg = supp('mg', { dose: '375 mg', doseRest: '750 mg', perTake: { train: 1, rest: 2 } });
  assert.equal(doseFor(mg, 'train'), '375 mg');
  assert.equal(doseFor(mg, 'rest'), '750 mg');
  const e = logEntry({ supp: mg, date: '2026-10-18', dayKind: 'rest', status: 'taken', at: 1 });
  assert.deepEqual([e.id, e.dose, e.servings], ['2026-10-18.mg', '750 mg', 2]);
  assert.equal(logEntry({ supp: mg, date: '2026-10-18', dayKind: 'rest', status: 'skipped', reason: 'forgot', at: 1 }).servings, 0);
});

test('checklist grouped by time, no-time last, with what is still open', () => {
  const a = supp('a', { time: '07:00', order: 1 });
  const b = supp('b', { time: '07:00', order: 0 });
  const c = supp('c', { time: '20:00' });
  const d = supp('d');
  const g = checklist({ supps: [a, b, c, d, supp('gone', { history: [{ on: '2026-10-01', status: 'removed' }] })], log: [take('2026-10-18', a)], date: '2026-10-18', dayKind: 'train' });
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.supp.id), x.open.map((i) => i.supp.id)]), [
    ['Morning', ['b', 'a'], ['b']], ['Evening', ['c'], ['c']], ['No time set', ['d'], ['d']],
  ]);
});

test('streak: all taken counts, open today does not break it, a skip does', () => {
  const a = supp('a'); const b = supp('b');
  const log = ['2026-10-15', '2026-10-16', '2026-10-17'].flatMap((d) => [take(d, a), take(d, b)]);
  assert.deepEqual(streak({ supps: [a, b], log, today: '2026-10-18' }), { days: 3, today: false });
  assert.deepEqual(streak({ supps: [a, b], log: [...log, take('2026-10-18', a)], today: '2026-10-18' }), { days: 3, today: false });
  assert.deepEqual(streak({ supps: [a, b], log: [...log, take('2026-10-18', a), take('2026-10-18', b)], today: '2026-10-18' }), { days: 4, today: true });
  assert.deepEqual(streak({ supps: [a, b], log: [...log, take('2026-10-18', a, 'skipped')], today: '2026-10-18' }), { days: 0, today: false });
  const gap = log.filter((e) => e.date !== '2026-10-16');
  assert.equal(streak({ supps: [a, b], log: gap, today: '2026-10-18' }).days, 1);
  assert.equal(trackingFrom(log), '2026-10-15');
});

test('adherence over 7 and 30 days counts from the first answer, today once answered', () => {
  const a = supp('a');
  const log = [take('2026-10-12', a), take('2026-10-13', a, 'skipped'), take('2026-10-15', a), take('2026-10-16', a)];
  // 10/14, the day after "ran out" with nothing answered, isn't counted: it was out of stock (Thu 10/22).
  assert.deepEqual(adherence(a, log, '2026-10-18', 7), { taken: 3, scheduled: 5, pct: 60 });
  assert.deepEqual(adherence(a, [...log, take('2026-10-18', a)], '2026-10-18', 30), { taken: 4, scheduled: 6, pct: 67 });
  assert.deepEqual(adherence(a, [], '2026-10-18', 7), { taken: 0, scheduled: 0, pct: null });
});

test('stock counts down with every tick after it was counted; low at about a week', () => {
  const cr = supp('cr', { stock: { servings: 10, countedAt: Date.parse('2026-10-15T00:00:00Z') } });
  const log = [take('2026-10-14', cr), take('2026-10-15', cr), take('2026-10-16', cr), take('2026-10-17', cr, 'skipped')];
  assert.equal(stockLeft(cr, log), 8);
  assert.deepEqual(stockStatus(cr, log), { left: 8, days: 8, low: false });
  assert.equal(stockStatus(cr, [...log, take('2026-10-18', cr)]).low, true);
  assert.equal(stockStatus(supp('x'), log), null);
  const mg = supp('mg', { perTake: { train: 1, rest: 2 }, days: { type: 'perWeek', count: 6, offDay: 0 } });
  assert.equal(Math.round(servingsPerDay(mg) * 1000) / 1000, Math.round((6 / 7) * 1.25 * 1000) / 1000);
  assert.equal(lastsText(7), 'about a week');
  assert.equal(lastsText(3), '3 days');
  assert.equal(lastsText(21), 'about 3 weeks');
});

test('calendar marks: taken of scheduled, skips with reasons', () => {
  const a = supp('a', { short: 'creatine' }); const b = supp('b', { short: 'omega-3' });
  const m = suppMarks([a, b], [take('2026-10-18', a), take('2026-10-18', b, 'skipped')]);
  assert.equal(m[0].label, 'Supplements: 1 of 2 taken · skipped omega-3 (ran out)');
  assert.equal(m[0].all, false);
});

test('dayKindFrom: the rotation for today and later, what happened for past days', async () => {
  const { dayKindFrom } = await import('../app/js/lib/supplements.js');
  const legs = { id: 'a', kind: 'workout', dayType: 'legs', status: 'done', startedAt: Date.UTC(2026, 0, 19, 4) };
  const pull = { id: 'b', kind: 'workout', dayType: 'pull', status: 'done', startedAt: Date.UTC(2026, 0, 17, 4) };
  const push = { id: 'c', kind: 'workout', dayType: 'push', status: 'done', startedAt: Date.UTC(2026, 0, 18, 4) };
  const base = { sessions: [pull, push, legs], days: [], today: '2026-01-20', tz: 'UTC' };
  assert.equal(dayKindFrom({ ...base, date: '2026-01-20' }), 'rest', 'the day after three in a row');
  assert.equal(dayKindFrom({ ...base, date: '2026-01-21' }), 'train');
  assert.equal(dayKindFrom({ ...base, date: '2026-01-19' }), 'train', 'a workout was logged');
  assert.equal(dayKindFrom({ ...base, date: '2026-01-16' }), 'rest', 'a past day with no workout');
});

test('supplements taken after the first meal are their own group (Tue 10/20)', async () => {
  const { checklist } = await import('../app/js/lib/supplements.js');
  const supps = [
    { id: 'a', name: 'A', days: { type: 'daily' }, status: 'active', order: 1, time: '09:00', perTake: { train: 1, rest: 1 } },
    { id: 'b', name: 'B', days: { type: 'daily' }, status: 'active', order: 2, afterMeal: 'first', perTake: { train: 1, rest: 1 } },
    { id: 'c', name: 'C', days: { type: 'daily' }, status: 'active', order: 3, perTake: { train: 1, rest: 1 } },
  ];
  const g = checklist({ supps, log: [], date: '2026-10-20', dayKind: 'train' });
  assert.deepEqual(g.map((x) => [x.key, x.label, x.items.map((i) => i.supp.id)]), [['09:00', 'Morning', ['a']], ['after-meal', 'After your first meal', ['b']], ['', 'No time set', ['c']]]);
});

test('out of stock (Thu 10/22, his words: "I literally told it that I ran out"): off the list until a tick, a new count or an arrival', async () => {
  const { outOf, outOfStock } = await import('../app/js/lib/supplements.js');
  const c = supp('c'); const mg = supp('mg'); const o3 = supp('o3');
  const log = [take('2026-10-20', c, 'skipped'), take('2026-10-20', mg, 'skipped'), take('2026-10-20', o3), take('2026-10-22', o3)];
  assert.deepEqual(outOf(c, log), { since: '2026-10-20', at: Date.parse('2026-10-20T08:00:00Z') });
  const items = checklist({ supps: [c, mg, o3], log, date: '2026-10-22', dayKind: 'train' }).flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.supp.id), ['o3'], 'today: only what he has');
  assert.deepEqual(checklist({ supps: [c, mg, o3], log, date: '2026-10-20', dayKind: 'train' }).flatMap((g) => g.items).map((i) => i.supp.id).sort(), ['c', 'mg', 'o3'], 'the day he said it still shows his answer');
  assert.deepEqual(outOfStock([c, mg, o3], log, '2026-10-22').map((x) => x.supp.id), ['c', 'mg']);
  // Back: a tick, a new count, or the arrival he told the coach about.
  assert.equal(outOf(c, [...log, take('2026-10-23', c)]), null);
  assert.equal(outOf({ ...mg, stock: { servings: 60, countedAt: Date.parse('2026-10-22T10:00:00Z') } }, log), null);
  assert.equal(outOf({ ...mg, restockedAt: Date.parse('2026-10-22T10:00:00Z') }, log), null);
  // A skip for another reason isn't "out".
  assert.equal(outOf(c, [logEntry({ supp: c, date: '2026-10-21', dayKind: 'train', status: 'skipped', reason: 'Forgot it' })]), null);
});

test('restock question (Thu 10/22): every second day while out, on the arrival day once he says it, never one he stops', async () => {
  const { restockAsk } = await import('../app/js/lib/fuel-reminders.js');
  const c = supp('c', { name: 'Vitamin C', short: 'vitamin C' }); const mg = supp('mg', { name: 'Magnesium', short: 'magnesium' });
  const log = [take('2026-10-20', c, 'skipped'), take('2026-10-20', mg, 'skipped')];
  const supps = [c, mg];
  assert.equal(restockAsk({ date: '2026-10-21', supps, log }), null, 'not the next day');
  assert.deepEqual(restockAsk({ date: '2026-10-22', supps, log }), { names: 'Vitamin C, Magnesium', arriving: false, due: true });
  assert.equal(restockAsk({ date: '2026-10-23', supps, log }), null);
  const at = Date.parse('2026-10-22T13:00:00Z');
  // Answered today: no more today, two days after the answer again.
  const notYet = [{ kind: 'out', suppId: 'c', answer: 'not-yet', at, date: '2026-10-22' }, { kind: 'out', suppId: 'mg', answer: 'not-yet', at, date: '2026-10-22' }];
  assert.equal(restockAsk({ date: '2026-10-22', supps, log, answers: notYet }), null);
  assert.equal(restockAsk({ date: '2026-10-24', supps, log, answers: notYet }).due, true);
  // Ordered, arriving Saturday: quiet until then, then "arrived?"; a stopped one is never asked.
  const ordered = [{ kind: 'out', suppId: 'c', answer: 'ordered', arrives: '2026-10-24', at, date: '2026-10-22' }, { kind: 'out', suppId: 'mg', answer: 'stop', at, date: '2026-10-22' }];
  assert.equal(restockAsk({ date: '2026-10-23', supps, log, answers: ordered }), null);
  assert.deepEqual(restockAsk({ date: '2026-10-24', supps, log, answers: ordered }), { names: 'Vitamin C', arriving: true, due: true });
});
