// Thu 11/5: the coach's workout tools (server/coach/tools-workout.mjs): everything his workout and history screens can
// do, each only on his words; deletes of logged sets and whole workouts only after his yes. And the phone's new timer
// actions (rest pause / resume, hold pause / resume / restart).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { WORKOUT_TOOLS } from '../server/coach/tools-workout.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { runAction } from '../app/js/lib/coach.js';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 10, 5, 10, 0); // Thursday 11/5, 10:00 AM
const at = (iso, h = 9) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:00:00Z`);
let dir; let store; let actions;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-wtools-'));
  store = openStore(join(dir, 'db.sqlite'));
  actions = [];
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-10-01', push: '2026-10-02', legs: '2026-10-03' } });
  w('exercises', 'bench-press-barbell', { id: 'bench-press-barbell', name: 'Bench Press (Barbell)', type: 'weight_reps', capClass: 'main' });
  w('routines', 'r-legs', { id: 'r-legs', title: 'Legs', dayType: 'legs', folderId: 'comeback', order: 0, exercises: [] });
  // A Push a month ago (out of correct_set's 24 hours) and Legs on Tuesday.
  w('sessions', 'p1', { id: 'p1', kind: 'workout', title: 'Push', dayType: 'push', startedAt: at('2026-10-10'), endedAt: at('2026-10-10') + 3600000, pausedMs: 0, status: 'done', note: '', exercises: [{ key: 'pb', exerciseId: 'bench-press-barbell', name: 'Bench Press (Barbell)', type: 'weight_reps', capClass: 'main', notes: '' }] });
  w('sets', 'p1a', { id: 'p1a', sessionId: 'p1', exKey: 'pb', order: 0, type: 'normal', kg: 60, reps: 8, done: true, doneAt: at('2026-10-10') + 600000 });
  w('sets', 'p1b', { id: 'p1b', sessionId: 'p1', exKey: 'pb', order: 1, type: 'normal', kg: 60, reps: 7, done: true, doneAt: at('2026-10-10') + 900000 });
  w('photos', 'ph1', { id: 'ph1', sessionId: 'p1', dataUrl: 'data:', at: at('2026-10-10') });
  w('sessions', 'l1', { id: 'l1', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at('2026-11-03'), endedAt: at('2026-11-03') + 3600000, pausedMs: 0, status: 'done', note: '', exercises: [
    { key: 'lp', exerciseId: 'leg-press-machine', name: 'Leg Press (Machine)', type: 'weight_reps', notes: '' },
    { key: 'lc', exerciseId: 'seated-leg-curl-machine', name: 'Seated Leg Curl (Machine)', type: 'weight_reps', notes: '' }] });
  w('sets', 'l1a', { id: 'l1a', sessionId: 'l1', exKey: 'lp', order: 0, type: 'normal', kg: 100, reps: 10, done: true, doneAt: at('2026-11-03') + 600000 });
  w('sets', 'l1b', { id: 'l1b', sessionId: 'l1', exKey: 'lc', order: 1, type: 'normal', kg: 45, reps: 10, done: true, doneAt: at('2026-11-03') + 1200000 });
  // Push in progress since 9:30 AM: bench warm-up and one set ticked, two left; leg extension untouched.
  w('sessions', 'now', { id: 'now', kind: 'workout', title: 'Push', dayType: 'push', startedAt: NOW - 1800000, endedAt: null, status: 'active', pausedMs: 0, pausedAt: null, note: '', exercises: [
    { key: 'b', exerciseId: 'bench-press-barbell', name: 'Bench Press (Barbell)', type: 'weight_reps', capClass: 'main', barKg: 20, restSeconds: null, notes: '', supersetId: null, target: { kg: 60, reps: [6, 8] } },
    { key: 'x', exerciseId: 'leg-extension-machine', name: 'Leg Extension (Machine)', type: 'weight_reps', capClass: null, barKg: null, restSeconds: null, notes: '', supersetId: null, target: null },
    { key: 'c', exerciseId: 'seated-leg-curl-machine', name: 'Seated Leg Curl (Machine)', type: 'weight_reps', capClass: null, barKg: null, restSeconds: null, notes: '', supersetId: null, target: null },
  ] });
  const row = (id, exKey, order, type, kg, done, reps = null) => w('sets', id, { id, sessionId: 'now', exKey, order, type, kg, reps, durationS: null, done, doneAt: done ? NOW - 600000 : null, rpe: null, note: '', target: { kg, reps: type === 'warmup' ? [8, 8] : [6, 8] } });
  row('bw', 'b', 0, 'warmup', 40, true, 8);
  row('b1', 'b', 1, 'normal', 60, true, 8);
  row('b2', 'b', 2, 'normal', 60, false);
  row('b3', 'b', 3, 'normal', 60, false);
  row('x1', 'x', 4, 'normal', 40, false);
  row('x2', 'x', 5, 'normal', 40, false);
  row('c1', 'c', 6, 'normal', 45, false);
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (name, args = {}, turnId = undefined) => WORKOUT_TOOLS.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => NOW, action: (a) => actions.push(a), turnId });
const rec = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
const session = (id = 'now') => rec('sessions', id);
const setsOf = (sid, key) => store.listRecords('sets').map((r) => r.data).filter((x) => x && x.sessionId === sid && (!key || x.exKey === key)).sort((a, b) => a.order - b.order);
const say = (turnId, role, text, extra = {}) => store.writeLocal('coach-messages', `${turnId}-${role}`, { id: `${turnId}-${role}`, turnId, role, text, at: NOW - (role === 'user' && turnId === 't1' ? 60000 : 30000), ...extra });

test('every write tool says it is used only on his words; names are new', () => {
  for (const t of WORKOUT_TOOLS) assert.match(t.description, /Only when he tells you to \(his words\), never on your own idea/, t.name);
  assert.deepEqual(WORKOUT_TOOLS.map((t) => t.name), ['workout_edit', 'past_workout', 'timer']);
  for (const t of WORKOUT_TOOLS) assert.equal(t.inputSchema.additionalProperties, false);
});

test('show, rename, and "I started 10 minutes earlier"', async () => {
  const shown = await call('workout_edit', { action: 'show' });
  assert.match(shown.text, /1\. Bench Press \(Barbell\): #1 warm-up 40 kg .*× 8, #2 60 kg .*× 8, #3 not ticked: 60 kg .*× 6-8, #4 not ticked/);
  assert.match(shown.text, /rest default 3:00/);
  assert.match((await call('workout_edit', { action: 'rename', title: 'Push heavy' })).text, /^Renamed the workout in progress: Push is now Push heavy\./);
  assert.equal(session().title, 'Push heavy');
  const t = await call('workout_edit', { action: 'times', shift_minutes: -10 });
  assert.match(t.text, /started 9:20 AM \(was 9:30 AM\); 0:40 on the clock now\./);
  assert.equal(session().startedAt, NOW - 2400000);
  assert.match((await call('workout_edit', { action: 'times', start: '09:00' })).text, /started 9:00 AM/);
  assert.match((await call('workout_edit', { action: 'times', minutes: 45 })).text, /started 9:15 AM/);
  assert.match((await call('workout_edit', { action: 'times', start: '11:00', date: '2026-11-05' })).text, /after now/);
});

test('remove: untouched at once; with logged sets only after his yes', async () => {
  const r = await call('workout_edit', { action: 'remove', exercise: 'leg extension' });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Removed Leg Extension \(Machine\) from Push with its 2 sets\. Order now: Bench Press \(Barbell\), Seated Leg Curl/);
  assert.equal(setsOf('now', 'x').length, 0);
  // Bench has logged sets: asks first.
  say('t1', 'user', 'remove the bench, my shoulder hurts');
  const ask = await call('workout_edit', { action: 'remove', exercise: 'bench' }, 't1');
  assert.equal(ask.wrote, undefined);
  assert.equal(ask.summary, 'asked first: remove:b');
  assert.equal(setsOf('now', 'b').length, 4);
  say('t1', 'assistant', 'Remove Bench Press and its 2 logged sets?', { tools: [{ name: 'workout_edit', summary: ask.summary }] });
  say('t2', 'user', 'no, keep it');
  assert.match((await call('workout_edit', { action: 'remove', exercise: 'bench' }, 't2')).summary, /^asked first/, 'a no is no');
  say('t2', 'user', 'yes');
  const yes = await call('workout_edit', { action: 'remove', exercise: 'bench' }, 't2');
  assert.match(yes.text, /^Removed Bench Press \(Barbell\) from Push with its 4 sets \(2 logged\)/);
  assert.equal(setsOf('now', 'b').length, 0);
  assert.deepEqual(session().exercises.map((e) => e.key), ['c']);
});

test('replace: same place, target from his last load since the comeback (+ one step, Thu 11/5); a swap for today; logged sets stay as the old exercise', async () => {
  const r = await call('workout_edit', { action: 'replace', exercise: 'leg extension', with: 'leg press machine' });
  assert.match(r.text, /^Replaced Leg Extension \(Machine\) with Leg Press \(Machine\) in Push, same place: 2 sets × 6-8 at 105 kg\. On his phone now, marked as a swap for today \(the next workout brings Leg Extension \(Machine\) back\)\. Its target \(say it, with the number\): Last time 100 kg × 10 \(Tuesday 11\/3\), \+5 kg\./, 'the slot keeps its reps; 100 × 10 reached 6-8: one step');
  const ex = session().exercises;
  assert.deepEqual(ex.map((e) => e.name), ['Bench Press (Barbell)', 'Leg Press (Machine)', 'Seated Leg Curl (Machine)']);
  assert.equal(ex[1].key, 'x');
  assert.equal(ex[1].exerciseId, 'leg-press-machine');
  assert.equal(ex[1].swappedFrom.name, 'Leg Extension (Machine)', 'the card says what it replaces');
  assert.deepEqual(setsOf('now', 'x').map((x) => [x.type, x.kg, x.target.reps, x.done]), [['normal', 105, [6, 8], false], ['normal', 105, [6, 8], false]]);
  // Bench has two logged sets: they stay; the new one comes after it with the two sets left.
  const r2 = await call('workout_edit', { action: 'replace', exercise: 'bench', with: 'incline bench press barbell', kg: 50 });
  assert.match(r2.text, /the 2 sets he logged stay as Bench Press \(Barbell\), Incline Bench Press \(Barbell\) comes right after it: 2 sets × 6-8 at 50 kg/);
  assert.deepEqual(session().exercises.map((e) => e.name), ['Bench Press (Barbell)', 'Incline Bench Press (Barbell)', 'Leg Press (Machine)', 'Seated Leg Curl (Machine)']);
  assert.deepEqual(setsOf('now', 'b').map((x) => x.id), ['bw', 'b1']);
  assert.ok(actions.some((a) => a.kind === 'sync'));
  assert.match((await call('workout_edit', { action: 'replace', exercise: 'leg curl', with: 'zzz nothing' })).text, /^No exercise called/);
});

test('target, add and remove sets, warm-ups from his steps; the 30% cap warns', async () => {
  const t = await call('workout_edit', { action: 'target', exercise: 'bench', kg: 62.5, reps_min: 5, reps_max: 6 });
  assert.match(t.text, /^Bench Press \(Barbell\) #3, #4 now 62\.5 kg .*× 5-6 on his phone \(not ticked yet\)\./);
  assert.deepEqual(setsOf('now', 'b').filter((x) => !x.done).map((x) => [x.kg, x.target.reps]), [[62.5, [5, 6]], [62.5, [5, 6]]]);
  assert.match((await call('workout_edit', { action: 'target', exercise: 'bench', set: 2, kg: 70 })).text, /#2 is ticked.*correct_set/);
  const over = await call('workout_edit', { action: 'target', exercise: 'bench', set: 3, kg: 100 });
  assert.match(over.text, /Over his 30% cap/);
  const add = await call('workout_edit', { action: 'add_sets', exercise: 'leg extension', count: 2, kg: 45 });
  assert.match(add.text, /^Added 2 sets to Leg Extension \(Machine\): 45 kg × 6-8, 45 kg × 6-8\./);
  assert.equal(setsOf('now', 'x').length, 4);
  const warm = await call('workout_edit', { action: 'add_sets', exercise: 'leg curl', type: 'warmup' });
  assert.match(warm.text, /^Added 2 warm-up sets to Seated Leg Curl \(Machine\): 22\.5 kg × 8, 33\.5 kg × 4\./);
  assert.deepEqual(setsOf('now', 'c').map((x) => x.type), ['warmup', 'warmup', 'normal']);
  const rm = await call('workout_edit', { action: 'remove_sets', exercise: 'leg curl', type: 'warmup' });
  assert.match(rm.text, /^Removed 2 unticked sets from Seated Leg Curl/);
  assert.match((await call('workout_edit', { action: 'remove_sets', exercise: 'leg extension', count: 3 })).text, /^Removed 3 unticked sets/);
  assert.equal(setsOf('now', 'x').length, 1);
  assert.match((await call('workout_edit', { action: 'remove_sets', exercise: 'bench', set: 1 })).text, /is ticked.*correct_set remove/);
});

test('rest, notes, superset on the running workout', async () => {
  assert.match((await call('workout_edit', { action: 'rest', exercise: 'bench', seconds: 150 })).text, /^Bench Press \(Barbell\) rest in this workout: 2:30 \(was the default \(3:00\)\)/);
  assert.equal(session().exercises[0].restSeconds, 150);
  assert.match((await call('workout_edit', { action: 'rest', exercise: 'bench' })).text, /: the default \(3:00\) \(was 2:30\)/);
  assert.equal(session().exercises[0].restSeconds, null);
  await call('workout_edit', { action: 'note', exercise: 'leg extension', note: 'seat 5, back pad 3' });
  const n2 = await call('workout_edit', { action: 'note', exercise: 'leg extension', note: 'pad on the shins' });
  assert.match(n2.text, /"seat 5, back pad 3\. pad on the shins" \(added to the note already there\)/);
  await call('workout_edit', { action: 'note', note: 'gym was packed' });
  assert.equal(session().note, 'gym was packed');
  const ss = await call('workout_edit', { action: 'superset', exercise: 'leg extension', with: 'leg curl' });
  assert.match(ss.text, /^Superset on his phone: Leg Extension \(Machine\) \+ Seated Leg Curl \(Machine\)\. The rest timer starts after Seated Leg Curl/);
  const ids = session().exercises.map((e) => e.supersetId);
  assert.equal(ids[0], null); assert.ok(ids[1]); assert.equal(ids[1], ids[2]);
  await call('workout_edit', { action: 'unsuperset', exercise: 'leg curl' });
  assert.deepEqual(session().exercises.map((e) => e.supersetId), [null, null, null], 'a group of one is no superset');
  store.writeLocal('sessions', 'now', { ...session(), status: 'done', endedAt: NOW });
  assert.match((await call('workout_edit', { action: 'show' })).text, /^No workout in progress\. A finished one: past_workout/);
});

test('past_workout: a month-old workout: show, edit, add and remove sets, notes, details', async () => {
  const shown = await call('past_workout', { action: 'show', date: '2026-10-10' });
  assert.match(shown.text, /^Push, Saturday 10\/10, 9:00 AM - 10:00 AM \(60 min\) \(id p1\)/);
  assert.match(shown.text, /1\. Bench Press \(Barbell\): #1 60 kg .*× 8, #2 60 kg .*× 7/);
  const e = await call('past_workout', { action: 'edit_set', date: '2026-10-10', exercise: 'bench', set: 2, reps: 8, note: 'last rep paused' });
  assert.match(e.text, /^Bench Press \(Barbell\) #2 of Push \(Saturday 10\/10\) is now 60 kg .*× 8 \(was 60 kg .*× 7\)\. Note: "last rep paused"\./);
  assert.equal(rec('sets', 'p1b').reps, 8);
  const add = await call('past_workout', { action: 'add_set', date: '2026-10-10', exercise: 'bench', kg: 50, reps: 10, count: 2 });
  assert.match(add.text, /^Added to Bench Press \(Barbell\) in Push \(Saturday 10\/10\): 50 kg .*× 10, 50 kg .*× 10\./);
  assert.ok(setsOf('p1', 'pb').every((x) => x.done));
  const warm = await call('past_workout', { action: 'add_set', id: 'p1', exercise: 'bench', type: 'warmup', kg: 20, reps: 10 });
  assert.match(warm.text, /now: #1 warm-up 20 kg/);
  assert.match((await call('past_workout', { action: 'remove_set', id: 'p1', exercise: 'bench', set: 1 })).text, /^Removed Bench Press \(Barbell\) #1 \(20 kg/);
  await call('past_workout', { action: 'note', id: 'p1', exercise: 'bench', note: 'bench 3 at the window' });
  assert.equal(session('p1').exercises[0].notes, 'bench 3 at the window');
  await call('past_workout', { action: 'note', id: 'p1', note: 'felt strong' });
  assert.equal(session('p1').note, 'felt strong');
  const d = await call('past_workout', { action: 'details', id: 'p1', new_date: '2026-10-11', start: '08:15', minutes: 75, title: 'Push A' });
  assert.match(d.text, /^Push \(was Saturday 10\/10, 9:00 AM\): title Push A; Sunday 10\/11, 8:15 AM - 9:30 AM \(75 min\)\. The rotation counts it on the new day\./);
  const p = session('p1');
  assert.equal(p.startedAt, Date.UTC(2026, 9, 11, 8, 15));
  assert.equal(p.endedAt, Date.UTC(2026, 9, 11, 9, 30));
  assert.equal(rec('sets', 'p1a').doneAt, Date.UTC(2026, 9, 11, 8, 25), 'the sets move with it');
  assert.match((await call('past_workout', { action: 'details', id: 'p1', new_date: '2026-11-06' })).text, /in the future/);
  const ex = await call('past_workout', { action: 'add_exercise', id: 'p1', exercise: 'incline bench press barbell', sets: [{ kg: 40, reps: 10, count: 3 }] });
  assert.match(ex.text, /^Added Incline Bench Press \(Barbell\) to Push A \(Sunday 10\/11\), number 2: #1 40 kg .*× 10, #2 .*#3 /);
  assert.match((await call('past_workout', { action: 'show', date: '2026-10-11', which: 'push' })).text, /2\. Incline Bench Press/);
  assert.match((await call('past_workout', { action: 'show', date: '2026-10-12' })).text, /^No finished workout on Monday 10\/12\. Latest: Legs, Tuesday 11\/3/);
  assert.match((await call('past_workout', { action: 'show', id: 'now' })).text, /^That workout is in progress: workout_edit/);
});

test('past_workout delete and remove_exercise: only after his yes to the question', async () => {
  say('t1', 'user', 'delete that push workout from october 10');
  const ask = await call('past_workout', { action: 'delete', date: '2026-10-10' }, 't1');
  assert.equal(ask.summary, 'asked first: delete:p1');
  assert.ok(session('p1'));
  // A yes in his own words to the coach's own question works too.
  say('t1', 'assistant', 'Delete Push from Saturday 10/10 and its 2 sets?');
  say('t2', 'user', 'yes');
  const yes = await call('past_workout', { action: 'delete', id: 'p1' }, 't2');
  assert.match(yes.text, /^Deleted Push from Saturday 10\/10 with its 2 sets and 1 photo\./);
  assert.equal(session('p1'), null);
  assert.equal(setsOf('p1').length, 0);
  assert.equal(rec('photos', 'ph1'), null);
  const r = await call('past_workout', { action: 'remove_exercise', id: 'l1', exercise: 'leg curl' }, 't3');
  assert.match(r.summary, /^asked first: remove:l1:lc/);
});

test('log a workout he did without the app: like the app\'s own in history, records and the rotation', async () => {
  const before = snapshot(store, { tz: TZ, now: NOW }).last();
  assert.equal(before.dayType, 'legs');
  const r = await call('past_workout', { action: 'log', date: '2026-11-04', start: '18:00', minutes: 50, dayType: 'push', exercises: [
    { name: 'bench press barbell', sets: [{ type: 'warmup', kg: 40, reps: 8 }, { kg: 62.5, reps: 6, count: 3 }] },
    { name: 'leg extension', note: 'seat 5', sets: [{ kg: 40, reps: 12 }] },
  ] });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Logged Push on Wednesday 11\/4, 6:00 PM - 6:50 PM \(50 min\): 2 exercises, 4 sets, 1,605 kg volume\./);
  assert.match(r.text, /The rotation counts it: next is Legs/);
  const s = snapshot(store, { tz: TZ, now: NOW });
  const logged = s.list('sessions').find((x) => x.startedAt === Date.UTC(2026, 10, 4, 18));
  assert.equal(logged.status, 'done'); assert.equal(logged.kind, 'workout'); assert.equal(logged.dayType, 'push'); assert.equal(logged.source, 'training-hq');
  assert.equal(logged.logFor, '2026-11-04'); assert.equal(logged.week, 5); assert.equal(logged.endedAt, Date.UTC(2026, 10, 4, 18, 50));
  assert.equal(s.last().dayType, 'push', 'the rotation sees it');
  assert.equal(s.history().last('Bench Press (Barbell)').heaviest.kg, 62.5, 'history and records see it');
  const sets = s.setsOf(logged.id);
  assert.equal(sets.length, 5);
  assert.ok(sets.every((x) => x.done && x.doneAt > logged.startedAt && x.doneAt < logged.endedAt));
  assert.equal(logged.exercises[1].notes, 'seat 5');
  assert.match((await call('past_workout', { action: 'log', date: '2026-11-04', start: '19:00', dayType: 'push', exercises: [{ name: 'bench press barbell', sets: [{ kg: 60, reps: 5 }] }] })).text, /^Already in history: Push, Wednesday 11\/4, 6:00 PM/);
  assert.match((await call('past_workout', { action: 'log', date: '2026-11-05', start: '09:30', dayType: 'pull', exercises: [{ name: 'bench press barbell', sets: [{ kg: 60, reps: 5 }] }] })).text, /after now/);
  assert.match((await call('past_workout', { action: 'log', date: '2026-11-01', start: '09:30', exercises: [{ name: 'zzz', sets: [{ kg: 60, reps: 5 }] }] })).text, /^Nothing saved\. No exercise called "zzz"/);
  const cap = await call('past_workout', { action: 'log', date: '2026-11-02', start: '09:00', dayType: 'push', exercises: [{ name: 'bench press barbell', sets: [{ kg: 100, reps: 3 }] }] });
  assert.match(cap.text, /Bench Press \(Barbell\): Over his 30% cap/);
});

test('timer: the phone gets the pause, resume and restart actions', async () => {
  for (const action of ['rest_pause', 'rest_resume', 'hold_pause', 'hold_resume', 'hold_restart']) await call('timer', { action });
  assert.deepEqual(actions.map((a) => a.kind), ['rest-pause', 'rest-resume', 'hold-pause', 'hold-resume', 'hold-restart']);
});

test('runAction: rest pause and resume, hold pause, resume and restart', () => {
  const calls = [];
  const deps = { rest: { pause: () => calls.push('rest pause'), resume: () => calls.push('rest resume') }, hold: (op) => calls.push(`hold ${op}`) };
  for (const kind of ['rest-pause', 'rest-resume', 'hold-pause', 'hold-resume', 'hold-restart']) assert.equal(runAction({ kind }, deps), true);
  assert.deepEqual(calls, ['rest pause', 'rest resume', 'hold pause', 'hold resume', 'hold restart']);
  assert.equal(runAction({ kind: 'rest-pause' }, { rest: {} }), false, 'an old timer without pause does nothing');
  assert.equal(runAction({ kind: 'hold-pause' }, { rest: {} }), false, 'no page to tell');
});

test('rest timer: a paused rest stands still, the Mac\'s "Rest over" is cancelled, and it runs on when resumed', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (key) => mem.get(key) ?? null, setItem: (key, v) => mem.set(key, v), removeItem: (key) => mem.delete(key) };
  const rest = await import('../app/js/lib/rest-timer.js');
  const plans = [];
  const off = rest.onPlan((p) => plans.push(p));
  try {
    rest.start(90, 'Bench');
    assert.equal(rest.pause(), true);
    const left = rest.status().leftMs;
    assert.equal(rest.status().paused, true);
    assert.ok(left > 85000 && left <= 90000);
    assert.equal(plans.at(-1), null, 'no end while paused');
    rest.adjust(15);
    assert.equal(rest.status().leftMs, left + 15000);
    assert.equal(rest.pause(), false);
    assert.equal(rest.resume(), true);
    assert.equal(rest.status().paused, false);
    assert.ok(plans.at(-1).endsAt >= Date.now() + left + 14000, 'the Mac learns the new end');
    assert.equal(rest.resume(), false);
  } finally { rest.clear(); off(); }
});
