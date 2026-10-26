// Thu 10/22, his words: "clearly the coach doesn't pull his data properly before he sends the notifications. So you
// need to make sure that is for everything, every notification that exists." What the audit found, each pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { remindersFor, reminderState } from '../app/js/lib/reminders.js';
import { roundsByDate } from '../app/js/lib/holds.js';
import { scanReminders, scanTakenOn } from '../app/js/lib/scans.js';
import { planReminders } from '../app/js/lib/fuel-reminders.js';
import { logEntry } from '../app/js/lib/supplements.js';

const TZ = 'Asia/Bangkok';
const D = '2026-03-18';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, rot: { today: { kind: 'train', dayType: 'push' } }, wakeHm: '08:00', bedHm: '00:00', sleepLogged: true, session: { started: false, done: false } };

test('one-off messages are never nudged again; the planner\'s own repeats are not doubled', () => {
  const r = (o) => ({ kind: 'meals', at: at('12:00'), due: true, title: 'x', body: 'y', ...o });
  const keys = (reminders) => nudgeCandidates({ ...base, now: at('14:00'), reminders }).map((c) => c.key).filter((k) => /^(meals|holds):/.test(k));
  assert.deepEqual(keys([r({ id: `home:${D}`, again: false, tag: 'home' })]), []);
  assert.deepEqual(keys([r({ id: 'hold-path:shoulder:0', kind: 'holds', again: false, tag: 'hp' })]), []);
  assert.deepEqual(keys([r({ id: `meal-again:${D}:1230:3`, group: 'g', tag: 'meal-x' })]), []);
  assert.deepEqual(keys([r({ id: `meal:${D}:1230`, tag: 'meal-x' })]), ['meals:meal-x'], 'the meal question itself still is');
});

test('food nudges: his meal answer stops the after-workout one; a meal still being read is not "behind"', () => {
  const b = { ...base, workoutEndedAt: at('11:40'), targets: { kcal: 3000, protein: 240 }, eaten: { kcal: 0, protein: 0, unread: 0 } };
  assert.ok(nudgeCandidates({ ...b, now: at('12:30') }).some((c) => c.key.startsWith('meal-after:')));
  assert.equal(nudgeCandidates({ ...b, now: at('12:30'), mealAnsweredAt: at('12:10') }).some((c) => c.key.startsWith('meal-after:')), false);
  const late = { ...base, now: at('17:00'), targets: { kcal: 3000, protein: 240 } };
  assert.ok(nudgeCandidates({ ...late, eaten: { kcal: 300, protein: 20, unread: 0 } }).some((c) => c.key.startsWith('food:')));
  assert.equal(nudgeCandidates({ ...late, eaten: { kcal: 300, protein: 20, unread: 1 } }).some((c) => c.key.startsWith('food:')), false);
});

test('"head home" is not sent once he answered the meal question after the gym', () => {
  const sessions = [{ id: 'w', status: 'done', dayType: 'legs', startedAt: at('10:00'), endedAt: at('11:40'), routineId: 'legs', exercises: [] }];
  const settings = { fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00' }] } };
  const st = reminderState({ sessions, settings, scans: [{ date: D, status: 'done', confirmedAt: at('11:45') }], mealChecks: [{ id: `${D}.1230`, date: D, answer: 'cooking', at: at('11:47') }] }, TZ);
  assert.equal(remindersFor({ date: D, ...st }).find((i) => i.id === `home:${D}`).due, false);
});

test('a holds round left open with sets counts once; not on top of a finished round that day', () => {
  const areas = [{ kind: 'area', id: 'wrist', label: 'Wrist', holds: [{ exercise: 'Cupping' }] }];
  const open = { id: 'a', kind: 'holds', area: 'wrist', status: 'active', startedAt: at('11:52') };
  const sets = [{ sessionId: 'a', exKey: 'k', done: true, type: 'hold' }];
  assert.equal(roundsByDate(areas, [open], sets).wrist[D], 1);
  assert.equal(roundsByDate(areas, [open], []).wrist[D], undefined, 'no sets: not a round');
  const done = { id: 'b', kind: 'holds', area: 'wrist', status: 'done', startedAt: at('11:55') };
  assert.equal(roundsByDate(areas, [open, done], sets).wrist[D], 1);
});

test('scan: no "scan before the workout" once he started; a PDF being read counts as taken', () => {
  const plan = { next: { date: D } };
  const days = { [D]: { sessionTime: '10:00' } };
  const due = (o = {}) => scanReminders({ date: D, tz: TZ, plan, scans: [], days, ...o }).map((i) => [i.id.split(':')[0], i.due]);
  assert.deepEqual(due(), [['scan-morning', true], ['scan-arrive', true]]);
  assert.deepEqual(due({ started: new Set([D]) }), [['scan-morning', false], ['scan-arrive', false]]);
  assert.equal(scanTakenOn([{ date: D, status: 'prep', pdfPending: true }], D), true);
  assert.equal(scanTakenOn([{ id: 'scan.x', date: D, status: 'prep' }], D, ['scan.x']), true, 'photos added');
  // The Evolt question stops 3 hours after the workout.
  const evolt = (hm) => nudgeCandidates({ ...base, now: at(hm), session: { started: true, done: true }, workoutEndedAt: at('11:40'), weighedToday: false }).some((c) => c.key === 'evolt');
  assert.equal(evolt('13:00'), true);
  assert.equal(evolt('15:00'), false);
});

test('a stretch, a class or a home neck session is not a gym day: no Evolt ask, no "head home"', () => {
  const neck = [{ id: 'n', status: 'done', dayType: 'neck', startedAt: at('19:00'), endedAt: at('19:15'), exercises: [] }];
  const st = reminderState({ sessions: neck, scanPlan: { id: 'main', cadence: 'training' }, settings: { fuel: { mealTimes: [{ name: 'Last meal', time: '20:00' }] } } }, TZ);
  assert.equal(st.trainedDates.has(D), false);
  const items = remindersFor({ date: D, ...st });
  assert.equal(items.some((i) => i.id === `scan-after:${D}` || i.id === `home:${D}`), false);
});

test('sauna planned before a fast: no "sauna today"; running low on something already out: not asked; hold-offs reach the evening list', () => {
  const days = [{ date: D, fast: { on: true, at: at('08:00') } }];
  const st = reminderState({ days, saunaPlan: { planned: [{ date: D, hm: '18:00' }] } }, TZ);
  assert.equal(remindersFor({ date: D, ...st }).some((i) => i.id.startsWith('sauna-day:')), false);
  const cr = { id: 'cr', kind: 'supplement', name: 'Creatine', short: 'creatine', dose: '5 g', days: { type: 'daily' }, status: 'active', stock: { servings: 5, countedAt: at('08:00', '2026-03-10') } };
  const log = [logEntry({ supp: cr, date: '2026-03-16', dayKind: 'train', status: 'skipped', reason: 'Ran out', at: at('09:00', '2026-03-16') })];
  assert.equal(planReminders({ date: D, tz: TZ, supps: [cr], log }).some((i) => i.id.startsWith('supps-low:')), false);
  const sup = { id: 'mg', kind: 'supplement', name: 'Magnesium', short: 'magnesium', dose: '1', days: { type: 'daily' }, status: 'active' };
  const evening = (holdoffs) => remindersFor({ date: D, ...reminderState({ supplements: [sup], coachHolds: holdoffs }, TZ) }).find((i) => i.id === `evening:${D}`)?.body || '';
  assert.match(evening([]), /Supplements still open: magnesium/);
  assert.doesNotMatch(evening([{ id: 'h', areas: ['supps'], at: at('08:00'), until: at('23:59') }]), /Supplements still open/);
});

test('restock questions (Fri 10/23, his words: asked at 10:40, 10:50 and 11:35 PM): once that day, halfway through his waking day', () => {
  const sup = (id, name, o = {}) => ({ id, kind: 'supplement', name, short: name === 'Vitamin C' ? 'vitamin C' : name.toLowerCase(), dose: '1', days: { type: 'daily' }, status: 'active', ...o });
  const out = ['Creatine', 'Carnitine', 'Magnesium', 'Vitamin C'].map((n, i) => sup(`s${i}`, n));
  const low = sup('om', 'Omega-3', { stock: { servings: 3, countedAt: at('08:00', '2026-03-10') } });
  const log = out.map((s) => logEntry({ supp: s, date: '2026-03-16', dayKind: 'train', status: 'skipped', reason: 'Ran out', at: at('09:00', '2026-03-16') }));
  const settings = { notify: { eveningCheck: '22:30', wakeHm: '10:00', bedHm: '00:00', suppPlanWeekday: new Date(`${D}T12:00:00Z`).getUTCDay() } };
  const items = remindersFor({ date: D, ...reminderState({ supplements: [...out, low], suppLog: log, settings }, TZ) });
  const ask = items.find((i) => i.id === `supps-out:${D}`);
  assert.ok(ask, 'asked on the second day out');
  assert.match(ask.title, /Still out: Creatine, Carnitine, Magnesium, Vitamin C/);
  assert.equal(ask.at, at('17:00'), 'halfway from his 10:00 AM wake to midnight, not after the 10:30 PM round-up');
  const plan = items.filter((i) => /^supps-(out|low|plan):/.test(i.id));
  assert.equal(plan.length, 3, 'out, running low and the weekly question all planned');
  // Still unanswered late in the evening: no nudge repeats any of them.
  for (const hm of ['17:10', '17:50', '22:50', '23:35']) {
    const keys = nudgeCandidates({ ...base, wakeHm: '10:00', now: at(hm), reminders: items }).map((c) => c.key);
    assert.equal(keys.some((k) => /supps-(out|low|plan)/.test(k)), false, `nothing at ${hm}`);
  }
  // Default waking hours (7:00 AM to 10:00 PM): 2:30 PM.
  assert.equal(planReminders({ date: D, tz: TZ, supps: out, log }).find((i) => i.id.startsWith('supps-out:')).at, at('14:30'));
  // Waking hours across midnight (2:00 PM to 4:00 AM): 9:00 PM.
  assert.equal(planReminders({ date: D, tz: TZ, supps: out, log, wakeHm: '14:00', bedHm: '04:00' }).find((i) => i.id.startsWith('supps-out:')).at, at('21:00'));
});
