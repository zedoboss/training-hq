import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LADDER, stepText, ladderState, passed, hadSymptoms, todayStep, doctorDue, gates, phaseOf, fluidLost, saunaMarks, CHECKLIST, BREAK_MIN,
} from '../app/js/lib/sauna.js';

let n = 0;
/** A finished session at a step: clean (default), with symptoms, short, or with no after answer. */
function ses(date, step, { symptoms = false, after = 'no', short = false, hotter = false, status = 'done' } = {}) {
  const t = Date.parse(`${date}T18:00:00Z`);
  const st = LADDER[step];
  const rounds = Array.from({ length: st.rounds }, (_, i) => ({ n: i + 1, planned: st.min, inAt: t + i * 40 * 60000, outAt: t + i * 40 * 60000 + (short && i === 0 ? st.min - 3 : st.min) * 60000 }));
  return {
    id: `s${++n}`, date, startedAt: t, endedAt: t + 3 * 3600000, stepIndex: step, plannedRounds: st.rounds, roundMin: st.min, hotter, status,
    rounds, breaks: rounds.slice(1).map((_, i) => ({ after: i + 1, symptoms: false })), symptoms: symptoms ? [{ at: t, when: 'button', what: ['Dizzy'] }] : [],
    after: after == null ? null : { answeredAt: t + 4 * 3600000, symptoms: after === 'yes' },
  };
}

test('the ladder is the brief\'s, 13 steps to 4 x 30', () => {
  assert.equal(LADDER.length, 13);
  assert.deepEqual(LADDER.map((s) => `${s.rounds}x${s.min}`), ['1x10', '1x12', '1x15', '2x10', '2x12', '2x15', '2x20', '3x15', '3x20', '3x25', '4x20', '4x25', '4x30']);
  assert.equal(stepText(0), '1 round of 10 minutes');
  assert.equal(stepText(3), `2 rounds of 10 minutes, ${BREAK_MIN}-minute breaks`);
});

test('a pass needs every round in full, no symptoms, and "no" 15 minutes after', () => {
  assert.equal(passed(ses('2026-10-01', 0)), true);
  assert.equal(passed(ses('2026-10-01', 0, { after: null })), false);
  assert.equal(passed(ses('2026-10-01', 0, { after: 'yes' })), false);
  assert.equal(hadSymptoms(ses('2026-10-01', 0, { after: 'yes' })), true);
  assert.equal(passed(ses('2026-10-01', 3, { short: true })), false);
  assert.equal(passed(ses('2026-10-01', 0, { status: 'stopped', symptoms: true })), false);
});

test('two clean sessions in a row unlock the next step, one at a time', () => {
  const a = [ses('2026-10-01', 0), ses('2026-10-03', 0)];
  assert.equal(ladderState(a, '2026-10-04').step, 1);
  assert.equal(ladderState([ses('2026-10-01', 0)], '2026-10-02').passes, 1);
  // A session that wasn't completed as planned resets the count.
  const b = [ses('2026-10-01', 0), ses('2026-10-03', 0, { after: null }), ses('2026-10-05', 0)];
  assert.deepEqual([ladderState(b, '2026-10-06').step, ladderState(b, '2026-10-06').passes], [0, 1]);
  // Climbing the whole ladder takes two passes at every step.
  const all = [];
  for (let i = 0; i < 12; i++) all.push(ses(`2026-11-${String(i + 1).padStart(2, '0')}`, i), ses(`2026-11-${String(i + 1).padStart(2, '0')}`, i));
  assert.equal(ladderState(all, '2026-11-13').step, 12);
});

test('symptoms: back one step from the one done; two in a row: back two and the doctor question again', () => {
  const up = [ses('2026-10-01', 0), ses('2026-10-02', 0), ses('2026-10-03', 1), ses('2026-10-04', 1), ses('2026-10-05', 2), ses('2026-10-06', 2)];
  assert.equal(ladderState(up, '2026-10-07').step, 3);
  const one = [...up, ses('2026-10-08', 3, { symptoms: true })];
  const s1 = ladderState(one, '2026-10-09');
  assert.deepEqual([s1.step, s1.passes, s1.doctorAgain], [2, 0, null]);
  assert.match(s1.reasons[0], /back one step/);
  const two = [...one, ses('2026-10-10', 2, { after: 'yes' })];
  const s2 = ladderState(two, '2026-10-11');
  assert.equal(s2.step, 0);
  assert.equal(s2.doctorAgain, two.at(-1).id);
  // A clean session after one symptom session ends the run.
  const mixed = [...one, ses('2026-10-10', 2), ses('2026-10-12', 2, { symptoms: true })];
  assert.equal(ladderState(mixed, '2026-10-13').step, 1);
  assert.equal(ladderState(mixed, '2026-10-13').doctorAgain, null);
});

test('two weeks or more without a sauna: back three steps', () => {
  const up = [ses('2026-10-01', 0), ses('2026-10-02', 0), ses('2026-10-03', 1), ses('2026-10-04', 1), ses('2026-10-05', 2), ses('2026-10-06', 2), ses('2026-10-07', 3), ses('2026-10-08', 3)];
  assert.equal(ladderState(up, '2026-10-21').step, 4);
  const late = ladderState(up, '2026-10-22');
  assert.equal(late.step, 1);
  assert.match(late.reasons[0], /two weeks or more/);
  assert.equal(ladderState([...up, ses('2026-10-23', 1)], '2026-10-23').step, 1);
});

test('a clearly hotter sauna is two steps back and does not count; maintenance stays put; never above it', () => {
  const st = ladderState([ses('2026-10-01', 0), ses('2026-10-02', 0), ses('2026-10-03', 1), ses('2026-10-04', 1), ses('2026-10-05', 2)], '2026-10-06');
  assert.equal(todayStep(st, { hotter: true }), 0);
  assert.equal(todayStep(st), 2);
  const hot = ladderState([ses('2026-10-01', 0), ses('2026-10-02', 0), ses('2026-10-03', 1, { hotter: true }), ses('2026-10-04', 1, { hotter: true })], '2026-10-05');
  assert.equal(hot.step, 1);
  const kept = ladderState([ses('2026-10-01', 0), ses('2026-10-02', 0), ses('2026-10-03', 1), ses('2026-10-04', 1)], '2026-10-05', { maintenanceStep: 1 });
  assert.equal(kept.step, 1);
});

test('doctor question: before the first session, before going past two rounds, after two symptom sessions in a row', () => {
  assert.equal(doctorDue({}, { doctorAgain: null }, 0), 'first');
  const plan = { doctor: [{ at: 1, answer: 'not-yet', context: 'first' }] };
  assert.equal(doctorDue(plan, { doctorAgain: null }, 6), null);
  assert.equal(doctorDue(plan, { doctorAgain: null }, 7), 'past-two-rounds');
  assert.equal(doctorDue({ doctor: [...plan.doctor, { context: 'past-two-rounds' }] }, { doctorAgain: null }, 7), null);
  assert.equal(doctorDue(plan, { doctorAgain: 's9' }, 0), 'after-s9');
  assert.equal(doctorDue({ doctor: [...plan.doctor, { context: 'after-s9' }] }, { doctorAgain: 's9' }, 0), null);
});

test('gates: never before lifting, energy 2 or 3, every item ticked ("if possible" answered either way)', () => {
  const all = Object.fromEntries(CHECKLIST.map((c) => [c.id, c.optional ? 'not-possible' : true]));
  assert.deepEqual(gates({ ticks: all, energy: 2 }), []);
  assert.deepEqual(gates({ ticks: all, energy: null }), []);
  assert.match(gates({ ticks: all, energy: 1 })[0], /energy rating today is 1/);
  assert.match(gates({ ticks: all, liftingLeft: true })[0], /^Never before lifting/);
  assert.equal(gates({ ticks: { ...all, kit: false } }).length, 1);
  assert.equal(gates({ ticks: { ...all, company: null } }).length, 1);
});

test('phases: in (over, overdue 5 minutes after), break (5 minutes and a "no"), after', () => {
  const t = 1_000_000_000_000;
  const s = { plannedRounds: 2, rounds: [{ n: 1, planned: 10, inAt: t }], breaks: [] };
  assert.equal(phaseOf(s, t + 9 * 60000).phase, 'in');
  assert.equal(phaseOf(s, t + 11 * 60000).over, true);
  assert.equal(phaseOf(s, t + 14 * 60000).overdue, false);
  assert.equal(phaseOf(s, t + 15 * 60000).overdue, true);
  s.rounds[0].outAt = t + 10 * 60000;
  s.breaks.push({ after: 1, startAt: t + 10 * 60000, symptoms: null });
  assert.deepEqual([phaseOf(s, t + 16 * 60000).phase, phaseOf(s, t + 16 * 60000).ready], ['break', false]);
  s.breaks[0].symptoms = false;
  assert.equal(phaseOf(s, t + 14 * 60000).ready, false);
  assert.equal(phaseOf(s, t + 15 * 60000).ready, true);
  s.rounds.push({ n: 2, planned: 10, inAt: t + 16 * 60000, outAt: t + 26 * 60000 });
  assert.equal(phaseOf(s, t + 27 * 60000).phase, 'after');
  assert.equal(phaseOf({ plannedRounds: 1, rounds: [] }).phase, 'ready');
});

test('weigh-in and calendar marks', () => {
  assert.equal(fluidLost({ beforeKg: 80.4, afterKg: 79.8 }), 0.6);
  assert.equal(fluidLost({ beforeKg: 80 }), null);
  const m = saunaMarks([ses('2026-10-01', 3), { ...ses('2026-10-02', 0, { symptoms: true }), status: 'stopped' }, { status: 'active', startedAt: 1 }]);
  assert.equal(m.length, 2);
  assert.equal(m[0].label, 'Sauna: 2 of 2 rounds (10, 10 min)');
  assert.equal(m[1].label, 'Sauna: 1 of 1 round (10 min) · stopped: symptoms');
});

test('the steps that end a session (shared by the round screen and the coach)', async () => {
  const { feelOffState, endHereState, afterAnswerState, AFTER_MIN } = await import('../app/js/lib/sauna.js');
  const s = { id: 'x', status: 'active', plannedRounds: 2, rounds: [{ n: 1, planned: 10, inAt: 1000, outAt: 2000 }, { n: 2, planned: 10, inAt: 3000, outAt: null }], breaks: [{ after: 1, startAt: 2000, endAt: 3000, symptoms: false }], symptoms: [], after: null };
  const off = feelOffState(s, { when: 'coach', what: ['Dizzy'], now: 5000 });
  assert.equal(off.status, 'stopped');
  assert.equal(off.rounds[1].outAt, 5000, 'the open round closes');
  assert.deepEqual(off.symptoms, [{ at: 5000, when: 'coach', what: ['Dizzy'] }]);
  assert.equal(off.endedAt, 5000);
  const inBreak = { ...s, rounds: [s.rounds[0]], breaks: [{ after: 1, startAt: 2000, endAt: null, symptoms: null }] };
  assert.equal(feelOffState(inBreak, { when: 'break', now: 2500 }).breaks[0].symptoms, true);
  const end = endHereState(inBreak, 2600);
  assert.equal(end.status, 'ended');
  assert.deepEqual(end.breaks[0], { after: 1, startAt: 2000, endAt: 2600, symptoms: false });
  assert.equal(end.after.dueAt, 2600 + AFTER_MIN * 60000);
  const ans = afterAnswerState(end, { symptoms: true, what: ['Headache'], now: 9000 });
  assert.deepEqual([ans.after.answeredAt, ans.after.symptoms, ans.after.what], [9000, true, ['Headache']]);
  assert.deepEqual(afterAnswerState(end, { symptoms: false, now: 9000 }).after.what, []);
});

test('planning sauna days (A9): rest days first, never before lifting, two a week while building up, one at his level', async () => {
  const { proposeSaunaDays, planSaunaDay, SAUNA_TIME } = await import('../app/js/lib/sauna.js');
  const rotation = [
    { date: '2026-10-19', kind: 'train', dayType: 'legs' }, { date: '2026-10-20', kind: 'rest', dayType: null },
    { date: '2026-10-21', kind: 'train', dayType: 'pull' }, { date: '2026-10-22', kind: 'train', dayType: 'push' },
    { date: '2026-10-23', kind: 'train', dayType: 'legs' }, { date: '2026-10-24', kind: 'rest', dayType: null },
    { date: '2026-10-25', kind: 'train', dayType: 'pull' },
  ];
  const today = '2026-10-18';
  let p = proposeSaunaDays({ rotation, today });
  assert.equal(p.perWeek, 2); assert.equal(p.time, SAUNA_TIME);
  assert.deepEqual(p.items.map((x) => [x.date, x.kind]), [['2026-10-20', 'rest'], ['2026-10-24', 'rest']]);
  // One already planned: one more; his own time.
  p = proposeSaunaDays({ rotation, today, plan: { time: '18:30', planned: [{ date: '2026-10-20', time: '18:30' }] } });
  assert.deepEqual(p.items.map((x) => [x.date, x.time]), [['2026-10-24', '18:30']]);
  // No rest day free: after a training day's session; never a day whose session is after the sauna time.
  p = proposeSaunaDays({ rotation: rotation.filter((d) => d.kind === 'train'), today, days: { '2026-10-19': { sessionTime: '18:00' } } });
  assert.deepEqual(p.items.map((x) => [x.date, x.kind, x.dayType]), [['2026-10-21', 'after-training', 'pull'], ['2026-10-22', 'after-training', 'push']]);
  // At his chosen maintenance level: once a week.
  assert.equal(proposeSaunaDays({ rotation, today, plan: { maintenanceStep: 0 } }).perWeek, 1);
  // Planning: before lifting is refused.
  assert.match(planSaunaDay({}, { date: '2026-10-19', time: '17:00' }, { today, kind: 'train', sessionTime: '18:00' }).error, /Never before lifting/);
  assert.deepEqual(planSaunaDay({}, { date: '2026-10-20' }, { today, kind: 'rest' }).plan.planned, [{ date: '2026-10-20', time: SAUNA_TIME }]);
  assert.match(planSaunaDay({}, { date: '2026-10-01' }, { today }).error, /today or later/);
});

test('sauna days while today\'s session is open: a day that is rest only if he trains today counts as training', async () => {
  const { proposeSaunaDays, proposalDayText, planSaunaDay } = await import('../app/js/lib/sauna.js');
  const { projectRotationEitherWay, expectedEitherWay, projectRotation } = await import('../app/js/lib/scans.js');
  const { LABEL } = await import('../app/js/lib/rotation.js');
  // Sunday 10/18 is Legs and not done yet: Monday is rest only if he trains today, Legs if it moves.
  const last = { dayType: 'push', date: '2026-10-17', streak: 2 };
  const today = '2026-10-18';
  const rot = projectRotationEitherWay({ last, days: {}, from: today, n: 8 });
  assert.deepEqual(rot[0], { date: today, kind: 'train', dayType: 'legs' });
  assert.deepEqual(rot[1], { date: '2026-10-19', kind: 'train', dayType: 'legs', maybe: true, ifDone: { kind: 'rest', dayType: null }, ifMoved: { kind: 'train', dayType: 'legs' } });
  const p = proposeSaunaDays({ rotation: rot, today });
  assert.deepEqual(p.items.map((x) => [x.date, x.kind, proposalDayText(x, LABEL)]), [
    ['2026-10-19', 'after-training', 'after Legs, or rest day'], ['2026-10-22', 'after-training', 'rest day, or after Legs'],
  ]);
  // Never before lifting either way: Monday's evening session rules Monday out.
  const p2 = proposeSaunaDays({ rotation: rot, today, days: { '2026-10-19': { sessionTime: '18:00' } } });
  assert.ok(!p2.items.some((x) => x.date === '2026-10-19'));
  const exp = expectedEitherWay({ last, days: {}, today, date: '2026-10-19' });
  assert.match(planSaunaDay({}, { date: '2026-10-19', time: '17:00' }, { today, kind: exp.kind, sessionTime: '18:00' }).error, /Never before lifting/);
  // Done today (or a rest day today): the plain projection, no maybe days.
  const done = { dayType: 'legs', date: today, streak: 3 };
  assert.deepEqual(projectRotationEitherWay({ last: done, days: {}, from: today, n: 8 }), projectRotation({ last: done, days: {}, from: today, n: 8 }));
  assert.equal(proposalDayText(proposeSaunaDays({ rotation: projectRotationEitherWay({ last: done, days: {}, from: today, n: 8 }), today }).items[0], LABEL), 'rest day');
});
