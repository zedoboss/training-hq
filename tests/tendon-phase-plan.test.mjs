// Thu 10/22, his words: "I will do phase one for one week for [the knees], starting today... Make that a plan: one week,
// and then we switch to phase two." The coach records the plan; the Mac switches the phase on its day by itself and a
// heads-up comes that morning.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { READ_TOOLS, contextLine } from '../server/coach/tools-read.mjs';
import { applyPhasePlans } from '../server/notify.mjs';
import { duePhasePlans, withPhase } from '../app/js/lib/holds.js';

const TZ = 'Asia/Bangkok';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);
let dir; let store; let clock;
const KNEES = { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [
  { exercise: 'Leg Extension (Machine)', when: 'after Legs', where: 'gym' },
  { exercise: 'Toes Wall Squat Hold', when: 'the second session on Legs days; both sessions on every other day', where: 'home' }] };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-phaseplan-'));
  store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('tendons', 'area.knees', KNEES);
  store.writeLocal('settings', 'main', { notify: { holdsMorning: '11:30', holdsEvening: '21:30' } });
  clock = at('2026-10-22', '19:10');
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => clock, action: () => {} });
const phase = (a) => WRITE_TOOLS.find((t) => t.name === 'tendon_phase').run(a, ctx());
const knees = () => store.getRecord('tendons', 'area.knees').data;
const reminders = () => store.listRecords('coach-reminders').map((r) => r.data);

test('"phase one for one week, then phase two": recorded with its day, a heads-up that morning, in every message', async () => {
  const r = await phase({ area: 'knees', phase: 'heal', until: '2026-10-28', then: 'fix', said: 'phase one for one week, then phase two' });
  assert.match(r.text, /^Knees: Relief phase: 3 holds twice a day.*, from Thursday 10\/22\. Until Wednesday 10\/28; Fix phase: 3-4 times a week for at least 4-8 weeks from Thursday 10\/29, switched by the app, with a heads-up at 11:30 AM that day\./);
  const k = knees();
  assert.equal(k.phase, 'heal');
  assert.equal(k.phaseSince, '2026-10-22');
  assert.deepEqual({ ...k.phasePlan, at: 0, reminderId: 'x' }, { next: 'fix', on: '2026-10-29', from: '2026-10-22', at: 0, said: 'phase one for one week, then phase two', reminderId: 'x' });
  const [rem] = reminders();
  assert.equal(rem.at, at('2026-10-29', '11:30'));
  assert.equal(rem.text, 'Knees: your Phase 1 (Relief) is done. Phase 2 (Fix it for good) from today: 3-4 sessions a week, once a day.');
  assert.match(contextLine({ store, tz: TZ, now: clock }), /Now: Knees: Relief phase[^\n]*His plan: this phase until Wednesday 10\/28, then Fix phase[^\n]* from Thursday 10\/29; the app switches it by itself \(his decision, Thursday 10\/22: "phase one for one week, then phase two"\)\./);
  assert.match((await READ_TOOLS.find((t) => t.name === 'tendons').run({}, ctx())).text, /- Knees: Relief phase[^\n]*\(since Thursday 10\/22\)\. His plan: this phase until Wednesday 10\/28/);
});

test('the Mac switches it on its day, by itself: holds follow, logged with his plan, the plan marked done', async () => {
  await phase({ area: 'knees', phase: 'heal', until: '2026-10-28', then: 'fix', said: 'one week then phase two' });
  assert.deepEqual(applyPhasePlans(store, at('2026-10-28', '23:59'), TZ), [], 'not before its day');
  assert.equal(knees().phase, 'heal');
  const logs = [];
  const done = applyPhasePlans(store, at('2026-10-29', '00:01'), TZ, (m) => logs.push(m));
  assert.equal(done.length, 1);
  const k = knees();
  assert.equal(k.phase, 'fix');
  assert.equal(k.phaseSince, '2026-10-29');
  assert.equal(k.phasePlan.done, true);
  assert.deepEqual(k.holds.map((h) => [h.exercise, h.when, h.timing || null]), [['Leg Extension (Machine)', 'after Legs', null], ['Toes Wall Squat Hold', null, ['rest days']]]);
  assert.match(k.phaseLog.at(-1).reason, /^his plan of 2026-10-22: "one week then phase two"$/);
  assert.match(logs[0], /Knees moved to fix/);
  assert.deepEqual(applyPhasePlans(store, at('2026-10-30', '00:01'), TZ), [], 'once');
  assert.doesNotMatch(contextLine({ store, tz: TZ, now: at('2026-10-29', '09:00') }), /His plan:/);
});

test('a new phase or plan replaces the old one and cancels its heads-up; a wrong plan is refused', async () => {
  await phase({ area: 'knees', phase: 'heal', until: '2026-10-28', then: 'fix' });
  const first = reminders()[0];
  clock = at('2026-10-25', '10:00');
  await phase({ area: 'knees', phase: 'fix', reason: 'pain gone early' });
  assert.equal(knees().phase, 'fix');
  assert.equal(knees().phasePlan, null);
  assert.ok(store.getRecord('coach-reminders', first.id).data.cancelledAt, 'the heads-up is cancelled');
  assert.match((await phase({ area: 'knees', phase: 'heal', until: '2026-10-20' })).text, /^until is a day before today/);
  assert.match((await phase({ area: 'knees', phase: 'fix', until: '2026-10-30', then: 'fix' })).text, /^then: the phase that follows/);
});

test('the pure rules: withPhase and duePhasePlans', () => {
  const a = withPhase(KNEES, 'maintenance', { date: '2026-11-01', reason: 'x' });
  assert.equal(a.phase, 'maintenance');
  assert.deepEqual(a.phaseLog, [{ date: '2026-11-01', from: 'heal', to: 'maintenance', reason: 'x' }]);
  assert.deepEqual(duePhasePlans([KNEES], '2026-11-01'), []);
  assert.equal(duePhasePlans([{ ...KNEES, phasePlan: { next: 'fix', on: '2026-10-29', from: '2026-10-22' } }], '2026-10-31')[0].phaseSince, '2026-10-29', 'the Mac off that day: still from its own day');
});
