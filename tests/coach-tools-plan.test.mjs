// Thu 11/5, his words: "What else cant u do? Figure it out and let the mac give U the tools". The plan tools: routines,
// the exercise library, week 5+ numbers and the Normal switch, the rotation and week columns, rest days on other dates,
// tendon holds, the bodyweight for pull-ups and his OK on the readiness table. Same records as his screens write.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { PLAN_TOOLS } from '../server/coach/tools-plan.mjs';
import { rotationDay, chosenNext, withNextType, daysByDate, lastRotationSession } from '../app/js/lib/rotation.js';
import { weekColumn } from '../app/js/lib/programme.js';
import { comebackStartOf, routineFromLast } from '../app/js/lib/finish.js';
import { currentBodyweight } from '../app/js/lib/health.js';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 22, 15, 0); // Thursday 1/22, 3:00 PM
const at = (iso, h = 10) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:00:00Z`);
let dir; let store; let actions;

const weeks = (...kgs) => kgs.map((kg, i) => ({ week: i + 1, load: { type: 'total', kg } }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-plan-'));
  store = openStore(join(dir, 'db.sqlite'));
  actions = [];
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2025-12-20', push: '2025-12-21', legs: '2025-12-22', source: 'test' }, lastSessionBeforeLayoff: { date: '2025-10-01' }, changes: [] });
  w('programme', 'routine.pull-gbi', { kind: 'routine', id: 'pull-gbi', dayType: 'pull', exercises: [{ name: 'Lat Pulldown (Cable)', comebackName: 'Lat Pulldown (Cable)', capClass: 'main', weeks: weeks(40, 42.5, 45, 47.5) }] });
  w('routines', 'r-pull', { id: 'r-pull', title: 'Pull', dayType: 'pull', folderId: 'comeback', order: 0, notes: '', exercises: [
    { key: 'a', exerciseId: 'lat-pulldown-cable', name: 'Lat Pulldown (Cable)', restSeconds: null, notes: '', plan: { routine: 'pull-gbi', name: 'Lat Pulldown (Cable)' }, sets: [] },
    { key: 'b', exerciseId: 'face-pull-cable', name: 'Face Pull (Cable)', restSeconds: null, notes: '', plan: null, sets: [{ type: 'normal', reps: [12, 15] }, { type: 'normal', reps: [12, 15] }] },
  ] });
  w('routines', 'r-flex', { id: 'r-flex', title: 'Flexibility · Legs', dayType: null, folderId: 'other', order: 1, notes: '', exercises: [
    { key: 'f1', exerciseId: 'kneeling-hip-flexor-stretch', name: 'Kneeling Hip Flexor Stretch', restSeconds: 15, notes: '', plan: null, sets: [1, 2, 3, 4].map(() => ({ type: 'normal', durationS: 30 })) },
    { key: 'f2', exerciseId: 'lying-hamstring-stretch-strap', name: 'Lying Hamstring Stretch (Strap)', restSeconds: 15, notes: '', plan: null, sets: [1, 2].map(() => ({ type: 'normal', durationS: 30 })) },
  ] });
  // Pull 1/14 and 1/18 at the week 4 number, Push 1/19, Legs 1/20: three in a row, so 1/21 rested and today is Pull.
  const sess = (id, date, dayType, ex = []) => w('sessions', id, { id, kind: 'workout', title: dayType, dayType, startedAt: at(date), endedAt: at(date, 11), status: 'done', exercises: ex });
  for (const [id, date] of [['p1', '2026-01-14'], ['p2', '2026-01-18']]) {
    sess(id, date, 'pull', [{ key: 'a', exerciseId: 'lat-pulldown-cable', name: 'Lat Pulldown (Cable)', type: 'weight_reps' }, { key: 'b', exerciseId: 'face-pull-cable', name: 'Face Pull (Cable)', type: 'weight_reps' }]);
    w('sets', `${id}s`, { id: `${id}s`, sessionId: id, exKey: 'a', order: 0, type: 'normal', kg: 47.5, reps: 10, done: true, doneAt: at(date) });
  }
  sess('u1', '2026-01-19', 'push');
  sess('l1', '2026-01-20', 'legs');
  w('tendons', 'rules', { kind: 'rules', items: ['pain up to 3-4 of 10 is fine if not worse the next day'] });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', loadsArea: { exercises: ['Leg Extension (Machine)'], draft: true }, holds: [
    { exercise: 'Leg Extension (Machine)', type: 'hold', load: 'full stack', sets: 3, seconds: 30, where: 'gym', when: 'after Legs' },
    { exercise: 'Toes Wall Squat Hold', type: 'hold', load: 'bodyweight', sets: 3, seconds: 30, where: 'home' },
  ] });
  w('tendons', 'area.shoulder', { kind: 'area', id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Bench Press (Smith Machine)', type: 'hold', loadKg: 30, loadNote: '30 kg total at mid-rep', sets: 3, seconds: 30, timing: ['after Push'] }] });
  w('tendons', 'readiness', { kind: 'readiness', status: 'draft', ratings: [{ key: 'T', label: 'Tendon', levels: ['none', 'a little', 'some', 'a lot'] }], rules: [{ if: 'T 3', then: 'rest' }], params: { weeksBack: 1 }, workingArea: { legs: ['L', 'B'] } });
  w('health', '2025-11-01', { date: '2025-11-01', weights: [{ kg: 80, at: Date.UTC(2025, 10, 1, 8) }] });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (name, args = {}) => PLAN_TOOLS.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => NOW, action: (a) => actions.push(a) });
const rec = (col, id) => store.getRecord(col, id)?.data;
const list = (col) => store.listRecords(col).filter((r) => !r.deleted).map((r) => r.data);

test('every plan tool: unique name, object schema, and a write tool says it is only on his words', () => {
  const names = PLAN_TOOLS.map((t) => t.name);
  assert.deepEqual(names, ['routine_edit', 'exercise_library', 'progression_answer', 'rotation_set', 'plan_day', 'tendon_hold', 'bodyweight', 'readiness_confirm']);
  for (const t of PLAN_TOOLS) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.match(t.description, /only when he tells you|only when he says|he decides|only on his/i, t.name);
  }
  assert.match(PLAN_TOOLS.find((t) => t.name === 'readiness_confirm').description, /never changes the table's levels, rules or "go lighter" amounts/);
  assert.equal(PLAN_TOOLS.find((t) => t.name === 'readiness_confirm').inputSchema.properties.params, undefined);
});

test('routine_edit: flexibility holds 30 s -> 45 s, one set to 60 s, as the routine screen saves them', async () => {
  const shown = await call('routine_edit', { action: 'show', routine: 'flexibility' });
  assert.match(shown.text, /1\. Kneeling Hip Flexor Stretch: 4 × 30 s, rest 0:15/);
  const r = await call('routine_edit', { action: 'sets', routine: 'Flexibility · Legs', exercise: 'hip flexor', seconds: 45 });
  assert.equal(r.wrote, true);
  assert.equal(r.text, 'Flexibility · Legs, Kneeling Hip Flexor Stretch: 4 × 45 s (was 4 × 30 s).');
  assert.deepEqual(rec('routines', 'r-flex').exercises[0].sets, [1, 2, 3, 4].map(() => ({ type: 'normal', durationS: 45 })));
  const one = await call('routine_edit', { action: 'sets', routine: 'flexibility', exercise: 'hamstring', set: 2, seconds: 60 });
  assert.match(one.text, /Lying Hamstring Stretch \(Strap\): 1 × 30 s, 1 × 60 s \(was 2 × 30 s\)/);
  assert.match((await call('routine_edit', { action: 'sets', routine: 'flexibility', exercise: 'hamstring', set: 3, seconds: 60 })).text, /has 2 working sets in this routine; there is no set 3/);
  assert.equal(rec('routines', 'r-flex').updatedAt, NOW);
});

test('routine_edit: add, move, swap, remove (his words only), sets on a programme exercise, rest and notes', async () => {
  const add = await call('routine_edit', { action: 'add', routine: 'pull', exercise: 'seated cable row v grip', after: 'face pull', sets: 3, reps_min: 8, reps_max: 10, kg: 50 });
  assert.match(add.text, /^Added Seated Cable Row - V Grip \(Cable\) to Pull, last, after Face Pull \(Cable\): 3 × 8-10 at 50 kg\./);
  assert.match(add.text, /follow his last session, so these kg are used only where he has no last set/);
  assert.match(add.text, /His next Pull starts from the routine as changed now, with the rest of his last Pull \(Sunday 1\/18\) as it was; after that, Start copies his last Pull again\./);
  let ex = rec('routines', 'r-pull').exercises;
  assert.deepEqual(ex.map((e) => e.name), ['Lat Pulldown (Cable)', 'Face Pull (Cable)', 'Seated Cable Row - V Grip (Cable)']);
  assert.deepEqual(ex[2].sets, [1, 2, 3].map(() => ({ type: 'normal', reps: [8, 10], kg: 50 })));
  assert.equal(ex[2].exerciseId, 'seated-cable-row-v-grip-cable');
  assert.match((await call('routine_edit', { action: 'add', routine: 'pull', exercise: 'Seated Cable Row - V Grip (Cable)' })).text, /already in Pull/);

  assert.match((await call('routine_edit', { action: 'move', routine: 'pull', exercise: 'cable row', position: 1 })).text, /^Moved Seated Cable Row - V Grip \(Cable\) to first in Pull\. Order now: Seated Cable Row - V Grip \(Cable\), Lat Pulldown/);
  assert.match((await call('routine_edit', { action: 'move', routine: 'pull', exercise: 'cable row' })).text, /^Where to\?/);

  const swap = await call('routine_edit', { action: 'swap', routine: 'pull', exercise: 'face pull', with: 'Lat Pulldown (Machine)' });
  assert.match(swap.text, /Face Pull \(Cable\) replaced by Lat Pulldown \(Machine\), same place: 2 × 12-15/);

  assert.match((await call('routine_edit', { action: 'remove', routine: 'pull', exercise: 'lat pulldown machine' })).text, /needs his explicit words/);
  assert.equal(rec('routines', 'r-pull').exercises.length, 3);
  assert.match((await call('routine_edit', { action: 'remove', routine: 'pull', exercise: 'lat pulldown machine', said: 'take the machine pulldown out of pull' })).text, /^Removed Lat Pulldown \(Machine\) from Pull/);
  ex = rec('routines', 'r-pull').exercises;
  assert.deepEqual(ex.map((e) => e.name), ['Seated Cable Row - V Grip (Cable)', 'Lat Pulldown (Cable)']);

  // The programme exercise: its own sets only on his word (detach), as "Set my own sets" on the routine screen.
  assert.match((await call('routine_edit', { action: 'sets', routine: 'pull', exercise: 'Lat Pulldown (Cable)', sets: 3 })).text, /follows The Comeback in Pull.*detach: true/);
  const det = await call('routine_edit', { action: 'sets', routine: 'pull', exercise: 'Lat Pulldown (Cable)', sets: 3, detach: true });
  assert.match(det.text, /Lat Pulldown \(Cable\): 3 × 8-10 \(was follows The Comeback/);
  assert.equal(rec('routines', 'r-pull').exercises[1].plan, null);

  assert.match((await call('routine_edit', { action: 'rest', routine: 'pull', exercise: 'cable row', rest_seconds: 90 })).text, /rest 1:30 from the next session on/);
  assert.equal(rec('routines', 'r-pull').exercises[0].restSeconds, 90);
  assert.match((await call('routine_edit', { action: 'rest', routine: 'pull', exercise: 'cable row', rest_seconds: 100 })).text, /rest choices are/);
  await call('routine_edit', { action: 'note', routine: 'pull', exercise: 'cable row', note: 'seat on 4' });
  await call('routine_edit', { action: 'note', routine: 'pull', exercise: 'cable row', note: 'chest pad on 2' });
  assert.equal(rec('routines', 'r-pull').exercises[0].notes, 'seat on 4. chest pad on 2');
  assert.match((await call('routine_edit', { action: 'show', routine: 'nothing like it' })).text, /^No routine called "nothing like it"\. His routines: (Pull; Flexibility · Legs|Flexibility · Legs; Pull)\./);
});

test('routine_edit: his next Start is the routine as changed, with what he added mid-session last time; then it copies his last one again', async () => {
  // Last Pull: an exercise he added mid-session (not in the routine), Face Pull skipped for a reason.
  const p2 = rec('sessions', 'p2');
  store.writeLocal('sessions', 'p2', { ...p2, exercises: [...p2.exercises.map((e) => (e.key === 'b' ? { ...e, skipped: { at: p2.startedAt, reason: 'elbow' } } : e)), { key: 'c', exerciseId: 'hammer-curl-dumbbell', name: 'Hammer Curl (Dumbbell)', type: 'weight_reps' }] });
  store.writeLocal('sets', 'p2c', { id: 'p2c', sessionId: 'p2', exKey: 'c', order: 1, type: 'normal', kg: 14, reps: 10, done: true, doneAt: at('2026-01-18') });
  const sets = () => store.listRecords('sets').map((r) => r.data).filter((x) => x?.sessionId === 'p2');
  // Before: Start copies the last Pull.
  assert.equal(routineFromLast(rec('routines', 'r-pull'), rec('sessions', 'p2'), sets()).copiedFrom, 'p2');
  await call('routine_edit', { action: 'add', routine: 'pull', exercise: 'seated cable row v grip', sets: 3, reps_min: 8, reps_max: 10 });
  const r = rec('routines', 'r-pull');
  assert.equal(r.editedAt, NOW);
  const next = routineFromLast(r, rec('sessions', 'p2'), sets());
  assert.equal(next.copiedFrom, undefined, 'the routine as changed, not a copy');
  assert.deepEqual(next.exercises.map((e) => e.name), ['Lat Pulldown (Cable)', 'Face Pull (Cable)', 'Hammer Curl (Dumbbell)', 'Seated Cable Row - V Grip (Cable)']);
  assert.deepEqual(next.exercises[2].sets, [{ type: 'normal', kg: 14, reps: [10, 10], durationS: null }], 'what he did last time stays');
  assert.equal(next.exercises[1].notes, '', 'the skip reason stays with that workout, not in the routine');
  assert.equal(next.exercises[1].skippedLast, undefined);
  // He trains Pull after the edit: the Start after that copies that workout again.
  const p3 = { id: 'p3', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: NOW + 3600000, endedAt: NOW + 7200000, status: 'done', exercises: [{ key: 'z', exerciseId: 'lat-pulldown-cable', name: 'Lat Pulldown (Cable)', type: 'weight_reps' }] };
  assert.equal(routineFromLast(r, p3, []).copiedFrom, 'p3');
});

test('exercise_library: a custom exercise as the library screen makes it, its pinned note on the exercise, its bar', async () => {
  const c = await call('exercise_library', { action: 'create', name: 'Copenhagen  Plank', type: 'duration', equipment: 'bodyweight', primary: 'adductors' });
  assert.match(c.text, /^Made Copenhagen Plank \(Time, bodyweight, custom\) in his library/);
  const made = rec('exercises', 'copenhagen-plank');
  assert.equal(made.custom, true); assert.equal(made.type, 'duration'); assert.equal(made.primary, 'adductors'); assert.equal(made.equipment, 'bodyweight');
  assert.match((await call('exercise_library', { action: 'create', name: 'copenhagen plank', type: 'duration' })).text, /already in his library/);
  assert.match((await call('exercise_library', { action: 'create', name: 'Something' })).text, /^Its type:/);

  const n = await call('exercise_library', { action: 'note', exercise: 'bench press barbell', text: 'bench setting 7' });
  assert.match(n.text, /^Bench Press \(Barbell\): pinned note now "bench setting 7"/);
  assert.deepEqual(rec('exercises', 'bench-press-barbell').pinnedNote, { text: 'bench setting 7', from: 'Training HQ, Thursday 1/22' });
  await call('exercise_library', { action: 'note', exercise: 'Bench Press (Barbell)', text: 'safeties on 3' });
  assert.equal(rec('exercises', 'bench-press-barbell').pinnedNote.text, 'bench setting 7. safeties on 3');
  await call('exercise_library', { action: 'note', exercise: 'Bench Press (Barbell)', text: 'setting 8', replace: true });
  assert.equal(rec('exercises', 'bench-press-barbell').pinnedNote.text, 'setting 8');

  assert.match((await call('exercise_library', { action: 'bar', exercise: 'Bench Press (Barbell)', bar: 'none' })).text, /no bar, loads are plain totals/);
  assert.equal(rec('exercises', 'bench-press-barbell').barId, 'none');
  assert.match((await call('exercise_library', { action: 'edit', exercise: 'Bench Press (Barbell)', equipment: 'smith' })).text, /from the general library/);
  assert.match((await call('exercise_library', { action: 'find', exercise: 'copenhagen' })).text, /Copenhagen Plank \(Time, bodyweight, custom\)/);
  assert.match((await call('exercise_library', { action: 'delete', exercise: 'copenhagen plank' })).text, /needs his explicit words/);
  assert.match((await call('exercise_library', { action: 'delete', exercise: 'copenhagen plank', said: 'delete the copenhagen plank' })).text, /^Deleted Copenhagen Plank/);
  assert.equal(rec('exercises', 'copenhagen-plank'), null);
});

test('progression_answer: week 5 confirmed with his number, decline saves nothing, Normal switch and "Not yet"', async () => {
  const shown = await call('progression_answer', { action: 'show', dayType: 'pull' });
  assert.match(shown.text, /^Pull week 5 numbers .*: waiting for his OK\.\n- Lat Pulldown \(Cable\): 50 kg \(from 47\.5 kg; 47\.5 \+ 2\.5 \(the week 3 to 4 step\)\)/);
  assert.match(shown.text, /Ready for Normal: yes/);

  const no = await call('progression_answer', { action: 'decline_week', dayType: 'pull' });
  assert.equal(no.wrote, undefined);
  assert.equal(list('progression').length, 0);

  const ok = await call('progression_answer', { action: 'confirm_week', dayType: 'pull', kg: [{ exercise: 'lat pulldown', kg: 49 }] });
  assert.match(ok.text, /^Pull week 5 confirmed: Lat Pulldown \(Cable\) 49 kg \(his number\)\. The 30% cap against his last load still applies/);
  const doc = rec('progression', 'pull.5');
  assert.equal(doc.dayType, 'pull'); assert.equal(doc.week, 5); assert.equal(doc.confirmedAt, NOW); assert.equal(doc.confirmedOn, '2026-01-22');
  assert.deepEqual(doc.exercises, [{ name: 'Lat Pulldown (Cable)', kg: 49, proposedKg: 50, fromKg: 47.5, edited: true }]);

  assert.match((await call('progression_answer', { action: 'not_yet', dayType: 'pull' })).text, /^Not yet: Pull stays on Getting Back Into/);
  assert.equal(rec('progression', 'modes').pull.notYet, '2026-01-18');
  assert.equal(rec('progression', 'modes').pull.mode, 'comeback');
  assert.match((await call('progression_answer', { action: 'normal', dayType: 'pull' })).text, /^Pull runs its Normal programme from now on/);
  assert.equal(rec('progression', 'modes').pull.mode, 'normal');
  assert.equal(rec('progression', 'modes').pull.ready, true);
  assert.match((await call('progression_answer', { action: 'normal', dayType: 'pull' })).text, /already runs the Normal programme/);
  await call('progression_answer', { action: 'comeback', dayType: 'pull' });
  assert.equal(rec('progression', 'modes').pull.mode, 'comeback');
});

test('rotation_set: Legs next instead of Pull until he trains, then the rotation carries on; clear; week column', async () => {
  assert.match((await call('rotation_set', { action: 'show' })).text, /Last: Legs, Tuesday 1\/20\. Next: Pull, Thursday 1\/22, week 5 column/);
  const r = await call('rotation_set', { action: 'next', dayType: 'legs', said: 'legs today not pull' });
  assert.match(r.text, /^Next session: Legs, Thursday 1\/22, week 5 column\. After it the rotation carries on from Legs/);
  assert.equal(rec('days', '2026-01-22').nextType.dayType, 'legs');
  // Every screen reads the rotation the same way: a rest day he adds in between keeps the choice.
  const days = daysByDate(list('days'));
  const last = lastRotationSession(list('sessions'), null, TZ);
  assert.equal(rotationDay({ last, today: '2026-01-22', days }).today.dayType, 'legs');
  assert.equal(rotationDay({ last, today: '2026-01-23', days: { ...days, '2026-01-22': { ...days['2026-01-22'], rest: { reason: 'added' } } } }).today.dayType, 'legs');
  // Once Legs is done the choice is spent: Pull comes next as always.
  const done = { dayType: 'legs', date: '2026-01-22', streak: 1 };
  assert.equal(rotationDay({ last: done, today: '2026-01-22', days }).next.dayType, 'pull');
  assert.equal(rotationDay({ last: done, today: '2026-01-23', days }).today.dayType, 'pull');

  assert.match((await call('rotation_set', { action: 'clear' })).text, /taken back.*Next: Pull, Thursday 1\/22/);
  assert.equal(rec('days', '2026-01-22').nextType, undefined);
  assert.match((await call('rotation_set', { action: 'clear' })).text, /^No day type he chose is waiting/);

  const wk = await call('rotation_set', { action: 'week', dayType: 'pull', week: 3, said: 'put pull back on week 3' });
  assert.match(wk.text, /^Pull is on week 3 now \(was 5\); week 4 from Saturday 1\/24\./);
  const meta = rec('programme', 'meta');
  assert.equal(meta.firstSessions.pull, '2026-01-03');
  assert.equal(weekColumn(meta.firstSessions.pull, '2026-01-22'), 3);
  assert.equal(comebackStartOf(meta), '2025-12-20', 'the comeback start stays');
  assert.match(meta.changes.at(-1).what, /Pull week column moved from 5 to 3/);
  assert.match((await call('rotation_set', { action: 'week', dayType: 'push', week: 20 })).text, /before the comeback.*The highest is week 16\./);
});

test('chosenNext: holds from its date until a rotation session on or after it; the newest wins', () => {
  const days = { '2026-01-22': withNextType(null, '2026-01-22', 'legs'), '2026-01-24': withNextType(null, '2026-01-24', 'push') };
  assert.deepEqual(chosenNext(days, { date: '2026-01-20' }, '2026-01-22'), { date: '2026-01-22', dayType: 'legs' });
  assert.deepEqual(chosenNext(days, { date: '2026-01-20' }, '2026-01-25'), { date: '2026-01-24', dayType: 'push' });
  assert.equal(chosenNext(days, { date: '2026-01-24' }, '2026-01-25'), null);
  assert.equal(withNextType(days['2026-01-22'], '2026-01-22', null).nextType, undefined);
});

test('plan_day: a rest day on a coming date, on a past day, undo; today goes through schedule', async () => {
  const r = await call('plan_day', { action: 'rest', date: '2026-01-24' });
  assert.match(r.text, /^Saturday 1\/24 is a rest day .*The next session stays Pull, Thursday 1\/22\./);
  assert.equal(rec('days', '2026-01-24').rest.reason, 'added');
  assert.match((await call('plan_day', { action: 'rest', date: '2026-01-24' })).text, /already a rest day/);
  assert.match((await call('plan_day', { action: 'undo_rest', date: '2026-01-24' })).text, /^Rest day on Saturday 1\/24 taken back/);
  assert.equal(rec('days', '2026-01-24').rest, undefined);
  assert.match((await call('plan_day', { action: 'rest', date: '2026-01-20' })).text, /He trained on Tuesday 1\/20/);
  assert.match((await call('plan_day', { action: 'rest', date: '2026-01-21' })).text, /^Wednesday 1\/21 is marked a rest day/);
  assert.match((await call('plan_day', { action: 'undo_rest', date: '2026-01-25' })).text, /has no rest day he added/);
  const today = await call('plan_day', { action: 'rest', date: '2026-01-22' });
  assert.match(today.text, /^Today is a rest day now/);
  assert.equal(rec('days', '2026-01-22').rest.reason, 'added');
});

test('tendon_hold: a home round logged as the hold timer saves it; hold load and seconds; areas; rules untouched', async () => {
  const before = { rules: rec('tendons', 'rules'), knees: rec('tendons', 'area.knees').phase, shoulder: rec('tendons', 'area.shoulder').phase };
  const r = await call('tendon_hold', { action: 'log_round', hold: 'toes wall squat hold', seconds: 45, time: '08:00', pain: 2 });
  assert.match(r.text, /^Logged Knees: Toes Wall Squat Hold, 3 × 45 s, Thursday 1\/22 at 8:00 AM\./);
  const round = list('sessions').find((x) => x.kind === 'holds');
  assert.equal(round.area, 'knees'); assert.equal(round.status, 'done'); assert.equal(round.round, 'morning'); assert.equal(round.startedAt, at('2026-01-22', 8));
  assert.deepEqual(round.exercises.map((e) => [e.name, e.type]), [['Toes Wall Squat Hold', 'duration']]);
  const sets = list('sets').filter((x) => x.sessionId === round.id);
  assert.deepEqual(sets.map((x) => [x.type, x.durationS, x.done, x.pain]), [1, 2, 3].map(() => ['hold', 45, true, 2]));
  assert.match((await call('tendon_hold', { action: 'log_round', area: 'knees', seconds: 30, pain: 6 })).text, /Which Knees hold: 1 = Leg Extension/);
  assert.match((await call('tendon_hold', { action: 'log_round', area: 'knees', hold: '2', pain: 6 })).text, /Pain 6\/10 is over his 3-4 limit/);

  const set = await call('tendon_hold', { action: 'set_hold', area: 'shoulder', kg: 35, seconds: 45 });
  assert.match(set.text, /^Shoulder: Bench Press \(Smith Machine\), 35 kg total, 3 × 45 s, after Push \(was Bench Press \(Smith Machine\), 30 kg total, 3 × 30 s, after Push\)\. His pain limit and the phase rules stay as they are\./);
  const h = rec('tendons', 'area.shoulder').holds[0];
  assert.equal(h.loadKg, 35); assert.equal(h.seconds, 45); assert.equal(h.loadNote, undefined);

  assert.match((await call('tendon_hold', { action: 'use_hold', area: 'knees', hold: 'wall squat', exercise: 'Wall Sit' })).text, /^Knees: Wall Sit instead of Toes Wall Squat Hold: Wall Sit, bodyweight|^Knees: Wall Sit instead of Toes Wall Squat Hold/);
  assert.equal(rec('tendons', 'area.knees').holds[1].where, 'home');
  assert.match((await call('tendon_hold', { action: 'add_area', label: 'Elbow' })).text, /^Elbow is a tendon area now, no hold yet\. Its phase isn't set/);
  assert.equal(rec('tendons', 'area.elbow').phase, 'unknown');
  assert.match((await call('tendon_hold', { action: 'remove_area', area: 'elbow' })).text, /needs his explicit words/);
  assert.match((await call('tendon_hold', { action: 'remove_area', area: 'elbow', said: 'remove the elbow' })).text, /^Elbow is no longer a tendon area/);
  assert.equal(rec('tendons', 'area.elbow'), null);

  assert.deepEqual(rec('tendons', 'rules'), before.rules);
  assert.equal(rec('tendons', 'area.knees').phase, before.knees);
  assert.equal(rec('tendons', 'area.shoulder').phase, before.shoulder);
});

test('bodyweight: Apple Health is stale, his number is used for pull-ups (and on the workout in progress); clear', async () => {
  assert.match((await call('bodyweight', { action: 'show' })).text, /^No bodyweight in the last 30 days \(newest weigh-in 80 kg, Saturday 11\/1\/2025/);
  store.writeLocal('sessions', 'act', { id: 'act', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: NOW - 60000, status: 'active', exercises: [], bodyweightKg: null });
  const r = await call('bodyweight', { action: 'set', kg: 78.5 });
  assert.match(r.text, /^Bodyweight 78\.5 kg from now on for pull-ups .*Pull in progress included/);
  assert.deepEqual(rec('settings', 'main').bodyweight, { kg: 78.5, at: NOW });
  assert.equal(rec('sessions', 'act').bodyweightKg, 78.5);
  assert.deepEqual(currentBodyweight({ healthDocs: list('health'), manual: rec('settings', 'main').bodyweight, now: NOW }), { kg: 78.5, at: NOW, from: 'manual' });
  assert.match((await call('bodyweight', { action: 'show' })).text, /use 78\.5 kg \(set by hand/);
  assert.match((await call('bodyweight', { action: 'clear' })).text, /^Hand-set bodyweight cleared/);
  assert.equal(rec('settings', 'main').bodyweight.kg, null);
  assert.match((await call('bodyweight', { action: 'set', kg: 20 })).text, /between 30 and 250/);
});

test('readiness_confirm: his OK of the table as it is, nothing in it changed; edits stay on its screen', async () => {
  const draft = rec('tendons', 'readiness');
  const r = await call('readiness_confirm', { said: 'yes the table is fine, confirm it' });
  assert.match(r.text, /^Readiness table confirmed as it is, Thursday 1\/22/);
  const t = rec('tendons', 'readiness');
  assert.equal(t.status, 'confirmed'); assert.equal(t.confirmedOn, '2026-01-22');
  assert.deepEqual(t.ratings, draft.ratings); assert.deepEqual(t.rules, draft.rules);
  assert.deepEqual(t.params, { ...t.params, weeksBack: 1 });
  assert.deepEqual(t.workingArea.legs, ['L', 'B']);
  assert.equal(rec('tendons', 'area.knees').loadsArea.draft, false);
  assert.deepEqual(rec('tendons', 'area.knees').loadsArea.exercises, ['Leg Extension (Machine)']);
  assert.match((await call('readiness_confirm', {})).text, /already confirmed .*open_screen readiness_table/);
});

test('plan_day: a rest day on the next training day moves his session time with the session', async () => {
  store.writeLocal('sessions', 'p3', { id: 'p3', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('2026-01-22', 9), endedAt: at('2026-01-22', 10), status: 'done', exercises: [] });
  store.writeLocal('days', '2026-01-23', { date: '2026-01-23', sessionTime: '16:30' });
  const r = await call('plan_day', { action: 'rest', date: '2026-01-23' });
  assert.match(r.text, /^Friday 1\/23 is a rest day .*Next session: Push, Saturday 1\/24 at 4:30 PM\./);
  assert.equal(rec('days', '2026-01-24').sessionTime, '16:30');
});
