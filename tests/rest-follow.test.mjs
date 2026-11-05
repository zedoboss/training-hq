// Thu 11/5 at the gym, his words: "I finished a calf raise set and then I saw the next one was Hip Thrust and I skipped
// it... once the rest time was over... the notification said 'do Hip Thrust next'. That doesn't update instantly... If
// you escape an active session or something like that, it should update accordingly, instantly... check the whole app."
// The rest's next set (rest bar, the Mac's waiting "Rest over", the coach's line) is worked out again on every change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { followRest, restSource, keepRestInStep } from '../app/js/lib/rest-follow.js';
import { nextSetText } from '../app/js/lib/session.js';
import { openRepo, memoryAdapter } from '../app/js/lib/repo.js';
import { restBody, openRestPush } from '../server/rest-push.mjs';
import { openStore } from '../server/store.mjs';

const mem = new Map();
globalThis.localStorage = { getItem: (key) => mem.get(key) ?? null, setItem: (key, v) => mem.set(key, v), removeItem: (key) => mem.delete(key) };

const legs = () => ({
  id: 'w1', status: 'active', kind: 'workout', dayType: 'legs',
  exercises: [
    { key: 'calf', name: 'Calf Raise (Horizontal Leg Press)', type: 'weight_reps' },
    { key: 'hip', name: 'Hip Thrust (Machine)', type: 'weight_reps' },
    { key: 'crunch', name: 'Decline Crunch (Weighted)', type: 'weighted_bodyweight' },
    { key: 'ext', name: 'Leg Extension (Machine)', type: 'weight_reps' },
  ],
});
const T = 1_800_000_000_000;
const legSets = () => [
  { id: 'c1', sessionId: 'w1', exKey: 'calf', order: 1, type: 'normal', done: true, doneAt: T, kg: 86, reps: 17, target: { kg: 86, reps: [15, 20] } },
  { id: 'h1', sessionId: 'w1', exKey: 'hip', order: 2, type: 'normal', done: false, kg: null, reps: null, target: { kg: 27.7, reps: [8, 12] } },
  { id: 'h2', sessionId: 'w1', exKey: 'hip', order: 3, type: 'normal', done: false, kg: null, reps: null, target: { kg: 27.7, reps: [8, 12] } },
  { id: 'd1', sessionId: 'w1', exKey: 'crunch', order: 4, type: 'normal', done: false, kg: null, reps: null, target: { kg: 2.5, reps: [15, 20] } },
  { id: 'e1', sessionId: 'w1', exKey: 'ext', order: 5, type: 'normal', done: false, kg: null, reps: null, target: { kg: 45, reps: [10, 12] } },
  { id: 'old', sessionId: 'w0', exKey: 'calf', order: 1, type: 'normal', done: true, doneAt: T - 9e8, kg: 80, reps: 15 },
];
// His calf raise set 1 is ticked (it is a one-set exercise here): the rest leads to Hip Thrust set 1.
const restAfterCalf = { endsAt: T + 120000, label: 'Calf Raise (Horizontal Leg Press)', next: 'Hip Thrust (Machine): set 1, 27.7 kg × 8-12', from: { sessionId: 'w1', exKey: 'calf' } };
const skip = (s, key) => ({ ...s, exercises: s.exercises.map((e) => (e.key === key ? { ...e, skipped: { at: T + 30000, reason: 'Lower back pain' } } : e)) });

test('his case: Hip Thrust skipped during the rest after calf raises: "Rest over" names Decline Crunch set 1, 2.5 kg', () => {
  const r = followRest(restAfterCalf, [skip(legs(), 'hip')], legSets());
  assert.equal(r.next, 'Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20');
  assert.equal(restBody(restAfterCalf.label, r.next), 'Rest over. Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20.');
  assert.equal(followRest(restAfterCalf, [legs()], legSets()).next, restAfterCalf.next, 'nothing changed: the same set');
});

test('every other change during a rest: undo skip, move up, remove, add, an edited or unticked set, all skipped', () => {
  const sets = legSets();
  const undone = { ...skip(legs(), 'hip') }; undone.exercises = undone.exercises.map((e) => ({ ...e, skipped: null }));
  assert.equal(followRest(restAfterCalf, [undone], sets).next, 'Hip Thrust (Machine): set 1, 27.7 kg × 8-12', 'undo skip: back to Hip Thrust');
  const moved = legs(); moved.exercises = [moved.exercises[0], moved.exercises[3], moved.exercises[1], moved.exercises[2]];
  assert.equal(followRest(restAfterCalf, [moved], sets).next, 'Leg Extension (Machine): set 1, 45 kg × 10-12', 'moved up: it is next');
  const removed = legs(); removed.exercises = removed.exercises.filter((e) => e.key !== 'hip');
  assert.equal(followRest(restAfterCalf, [removed], sets.filter((x) => x.exKey !== 'hip')).next, 'Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20', 'removed');
  const added = legs(); added.exercises.splice(1, 0, { key: 'lp', name: 'Leg Press (Machine)', type: 'weight_reps' });
  assert.equal(followRest(restAfterCalf, [added], [...sets, { id: 'l1', sessionId: 'w1', exKey: 'lp', order: 6, type: 'normal', done: false, target: { kg: 100, reps: [8, 10] } }]).next, 'Leg Press (Machine): set 1, 100 kg × 8-10', 'added right after');
  assert.equal(followRest(restAfterCalf, [legs()], sets.map((x) => (x.id === 'h1' ? { ...x, kg: 25 } : x))).next, 'Hip Thrust (Machine): set 1, 25 kg × 8-12', 'kg typed in');
  assert.equal(followRest(restAfterCalf, [legs()], sets.map((x) => (x.id === 'c1' ? { ...x, done: false, doneAt: null } : x))).next, 'Calf Raise (Horizontal Leg Press): set 1, 86 kg × 17', 'unticked: that set again');
  let all = legs(); for (const k of ['hip', 'crunch', 'ext']) all = skip(all, k);
  assert.equal(followRest(restAfterCalf, [all], sets).next, 'Every set ticked: finish the workout');
});

test('a workout finished or discarded cancels its rest; a countdown or a rest with no set is left alone', () => {
  assert.deepEqual(followRest(restAfterCalf, [{ ...legs(), status: 'done' }], legSets()), { clear: true });
  assert.deepEqual(followRest(restAfterCalf, [{ ...legs(), status: 'discarded' }], legSets()), { clear: true });
  assert.deepEqual(followRest(restAfterCalf, [], []), { clear: true }, 'deleted');
  assert.equal(followRest({ ...restAfterCalf, label: 'Countdown', next: '' }, [skip(legs(), 'hip')], legSets()), null);
  assert.equal(followRest({ ...restAfterCalf, next: '' }, [skip(legs(), 'hip')], legSets()), null);
  assert.equal(followRest(null, [legs()], legSets()), null);
});

test('a rest the coach started (no workout named) follows the active workout from its last ticked set', () => {
  const coachRest = { ...restAfterCalf, from: null };
  const src = restSource(coachRest, [{ ...legs(), id: 'w0', status: 'done' }, skip(legs(), 'hip')], legSets());
  assert.equal(src.session.id, 'w1'); assert.equal(src.fromKey, 'calf'); assert.equal(src.sets.length, 5, 'only this workout\'s sets');
  assert.equal(followRest(coachRest, [skip(legs(), 'hip')], legSets()).next, 'Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20');
  assert.equal(followRest(coachRest, [{ ...legs(), status: 'done' }], legSets()), null, 'no active workout: nothing to go on');
});

test('the workout bar\'s "Next" follows the order he moved exercises to, and skips', () => {
  const moved = legs(); moved.exercises = [moved.exercises[0], moved.exercises[3], moved.exercises[1], moved.exercises[2]];
  const sets = legSets().filter((x) => x.sessionId === 'w1');
  assert.equal(nextSetText(moved, sets), 'Leg Extension (Machine) · set 1 of 1 · 45 kg × 10-12');
  assert.equal(nextSetText(skip(legs(), 'hip'), sets), 'Decline Crunch (Weighted) · set 1 of 1 · 2.5 kg × 15-20');
});

test('on the phone: skipping during a rest rewrites the rest at once and the Mac gets the new "Rest over", same end', async () => {
  const rest = await import('../app/js/lib/rest-timer.js');
  const repo = await openRepo(memoryAdapter());
  await repo.put('sessions', 'w1', { ...legs(), tz: 'UTC' });
  for (const x of legSets()) await repo.put('sets', x.id, { ...x, tz: 'UTC' });
  const plans = [];
  const offPlan = rest.onPlan((p) => plans.push(p));
  const follow = keepRestInStep(repo, rest);
  try {
    rest.start(120, restAfterCalf.label, restAfterCalf.next, restAfterCalf.from);
    const endsAt = rest.status().endsAt;
    await repo.put('sessions', 'w1', { ...skip(legs(), 'hip'), tz: 'UTC' });
    await follow.run();
    assert.equal(rest.status().next, 'Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20');
    assert.deepEqual(plans.at(-1), { endsAt, label: restAfterCalf.label, next: 'Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20' });
    const n = plans.length;
    await repo.put('sets', 'e1', { ...legSets()[4], kg: 50, tz: 'UTC' });
    await follow.run();
    assert.equal(plans.length, n, 'a change that doesn\'t touch the next set sends nothing');
    assert.equal(rest.retarget(rest.status().next), false);
    // He finishes the workout before the rest ends: no "Rest over" afterwards.
    await repo.put('sessions', 'w1', { ...skip(legs(), 'hip'), status: 'done', tz: 'UTC' });
    await follow.run();
    assert.equal(rest.status(), null);
    assert.equal(plans.at(-1), null, 'the Mac\'s waiting "Rest over" is cancelled');
    // A plain countdown is never touched.
    rest.start(60, 'Countdown');
    await repo.put('sessions', 'w1', { ...legs(), tz: 'UTC' });
    await follow.run();
    assert.equal(rest.status().next, '');
  } finally { rest.clear(); offPlan(); follow.stop(); }
});

test('the Mac replaces the waiting "Rest over" with the new text: one notification, the new next set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-restfollow-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let clock = T;
    const sent = [];
    const r = openRestPush({ store, push: { notify: async (m) => { sent.push(m.body); return { sent: 1 }; } }, now: () => clock });
    r.set('phone', { endsAt: T + 120000, label: restAfterCalf.label, next: restAfterCalf.next, url: '#/session/w1' });
    r.set('phone', { endsAt: T + 120000, label: restAfterCalf.label, next: 'Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20', url: '#/session/w1' });
    clock += 121000;
    await r.tick();
    assert.deepEqual(sent, ['Rest over. Decline Crunch (Weighted): set 1, bodyweight +2.5 kg × 15-20.']);
  } finally { store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

test('repo.where copies only the records asked for', async () => {
  const repo = await openRepo(memoryAdapter());
  for (const x of legSets()) await repo.put('sets', x.id, x);
  await repo.list('sets');
  const mine = await repo.where('sets', (x) => x.sessionId === 'w0');
  assert.deepEqual(mine.map((x) => x.id), ['old']);
  mine[0].kg = 1;
  assert.equal((await repo.get('sets', 'old')).kg, 80, 'a copy');
});
