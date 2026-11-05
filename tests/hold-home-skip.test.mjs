// Thu 11/5, his words: "the entire app, features like this, see if something doesn't update accordingly instantly
// whenever I talk with you" and "Dig even further". He skipped Leg Extension Hold (Machine) at 5:18 AM with "Ill do at
// home"; at 7:55 AM Holds, Today and the coach still said "Knees after the session: Leg Extension (Machine), open", and the
// 4:30 PM "Still open today" said "knees (Leg Extension (Machine))". A gym hold skipped to do at home is now the area's
// home hold (the toes wall squat for his knees), due at home today, everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdSlots, homeSkips, homeReason, openSlots } from '../app/js/lib/holds.js';
import { remindersFor, reminderState } from '../app/js/lib/reminders.js';
import { openItems } from '../app/js/lib/initiatives.js';
import { isoDate } from '../app/js/lib/time.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-19';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
// His tendon data as it is: knees in the fix phase, the gym hold after Legs, the toes wall squat at home on rest days.
const knees = (phase = 'fix') => ({ kind: 'area', id: 'knees', label: 'Knees', phase, holds: [
  { exercise: 'Leg Extension (Machine)', where: 'gym', when: 'after Legs' },
  { exercise: 'Toes Wall Squat Hold', where: 'home', when: null, timing: ['rest days'] }] });
const wrist = { kind: 'area', id: 'wrist', label: 'Wrist', phase: 'fix', holds: [{ exercise: 'Cupping', where: 'gym', timing: ['after Pull', 'after Legs'] }] };
const legs = ({ reason = 'Ill do at home', status = 'done', name = 'Leg Extension Hold (Machine)' } = {}) => ({
  id: 'w', kind: 'workout', status, dayType: 'legs', routineId: 'legs-gbi', startedAt: at('04:35'), endedAt: status === 'done' ? at('05:22') : null,
  exercises: [{ key: 'a', name: 'Leg Extension (Machine)', exerciseId: 'leg-extension-machine' }, { key: 'h', name, skipped: { at: at('05:18'), reason } }],
});
const sets = [{ sessionId: 'w', exKey: 'a', done: true }];
const slotsOf = (sessions, areas = [knees(), wrist], extra = {}) => holdSlots({ areas, dayKind: 'done', dayType: 'legs', homeSkips: homeSkips(sessions, D, TZ), ...extra });

test('skipped "Ill do at home": the knees slot is the toes wall squat at home today; the gym cupping stays', () => {
  const s = slotsOf([legs()]);
  const k = s.find((x) => x.area === 'knees');
  assert.equal(k.slot, 'home');
  assert.equal(k.exercise, 'Toes Wall Squat Hold');
  assert.equal(k.where, 'home');
  assert.equal(k.holdIndex, 1, 'Start opens the home hold');
  assert.deepEqual(k.fromGym, { exercise: 'Leg Extension (Machine)', reason: 'Ill do at home' });
  assert.equal(s.find((x) => x.area === 'wrist').slot, 'after', 'not skipped: still after the session');
  assert.equal(openSlots(s).length, 2, 'Today: still 2 open');
});

test('at once: a skip in the running workout counts too; "home" in any words; a pain skip or a discarded workout does not move it', () => {
  assert.equal(slotsOf([legs({ status: 'active' })]).find((x) => x.area === 'knees').slot, 'home');
  for (const r of ['doing it at home later', 'Home', 'at home tonight']) assert.ok(homeReason(r), r);
  for (const r of ['lower back pain', '', null, 'homemade excuse']) assert.ok(!homeReason(r), String(r));
  assert.equal(slotsOf([legs({ reason: 'Lower back pain' })]).find((x) => x.area === 'knees').slot, 'after');
  assert.equal(slotsOf([legs({ status: 'discarded' })]).find((x) => x.area === 'knees').slot, 'after');
  assert.equal(slotsOf([]).find((x) => x.area === 'knees').exercise, 'Leg Extension (Machine)');
  // Another day's skip doesn't move today's.
  assert.equal(holdSlots({ areas: [knees()], dayKind: 'done', dayType: 'legs', homeSkips: homeSkips([legs()], '2026-03-20', TZ) })[0].slot, 'after');
  // An area with no home hold keeps its gym hold.
  const cup = { ...legs(), exercises: [{ key: 'h', name: 'Cupping', skipped: { at: at('05:18'), reason: 'at home' } }] };
  assert.equal(slotsOf([cup]).find((x) => x.area === 'wrist').slot, 'after');
});

test('a round of the home hold ticks it off; the heal phase keeps its evening round after it', () => {
  assert.equal(slotsOf([legs()], [knees()], { roundsToday: { knees: 1 } })[0].done, true);
  const heal = slotsOf([legs()], [knees('heal')], { times: { morning: '09:30', evening: '21:30' } });
  assert.deepEqual(heal.map((x) => [x.slot, x.exercise]), [['home', 'Toes Wall Squat Hold'], ['evening', 'Toes Wall Squat Hold']]);
});

test('the evening "Still open today" names the toes wall squat at home, never the gym leg extension', () => {
  const st = reminderState({ sessions: [legs()], sets, tendons: [knees(), wrist], settings: { notify: { eveningCheck: '16:30' } } }, TZ);
  const ev = remindersFor({ date: D, ...st }).find((r) => r.id === `evening:${D}`);
  assert.match(ev.body, /knees \(Toes Wall Squat Hold, at home\)/);
  assert.match(ev.body, /wrist \(Cupping\)/);
  assert.doesNotMatch(ev.body, /Leg Extension/);
  // Not skipped: as before.
  const st2 = reminderState({ sessions: [legs({ reason: 'Lower back pain' })], sets, tendons: [knees(), wrist], settings: { notify: { eveningCheck: '16:30' } } }, TZ);
  assert.match(remindersFor({ date: D, ...st2 }).find((r) => r.id === `evening:${D}`).body, /knees \(Leg Extension \(Machine\)\)/);
  // Heal phase: the evening holds reminder says both knee rounds; the summary doesn't repeat the knees.
  const st3 = reminderState({ sessions: [legs()], sets, tendons: [knees('heal')], settings: { notify: { eveningCheck: '16:30', holdsEvening: '21:30' } } }, TZ);
  const r3 = remindersFor({ date: D, ...st3 });
  assert.doesNotMatch(r3.find((r) => r.id === `evening:${D}`)?.body || '', /knees/i);
  assert.match(r3.find((r) => r.id === `holds-evening:${D}`).body, /Toes Wall Squat Hold, 2 rounds/);
});

test("the coach's own hold nudge says the home hold, not the gym one", () => {
  const items = openItems({ today: D, sessions: [legs()], sets, areas: [knees(), wrist], dayOf: (ms) => isoDate(new Date(ms), TZ) });
  const facts = items.map((i) => i.facts).join(' ');
  assert.match(facts, /Toes Wall Squat Hold hold at home today is still open/);
  assert.doesNotMatch(facts, /Leg Extension \(Machine\) hold after Legs/);
});
