// The coach's tools against a small made-up database (no real programme numbers here).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS, contextLine } from '../server/coach/tools.mjs';
import { findByName, loadText, dayText } from '../server/coach/shared.mjs';
import { remindersFor, reminderState } from '../app/js/lib/reminders.js';
import { GET_OUT } from '../app/js/lib/sauna.js';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 20, 3, 0); // Tuesday 1/20, 3:00 AM
let dir; let store; let clock; let actions;

const weeks = (kgs) => kgs.map((kg, i) => ({ week: i + 1, text: `${kg}kg`, load: { type: 'total', kg }, reps: [8, 12], sets: i ? { count: 2 } : { firstSession: 1, after: 2 } }));
const at = (iso, h = 3) => Date.parse(`${iso}T0${h}:00:00Z`);

function seed() {
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-01-01', push: '2026-01-02', legs: '2026-01-03' } });
  w('programme', 'routine.legs-gbi', { kind: 'routine', id: 'legs-gbi', dayType: 'legs', exercises: [
    { name: 'Squat (Smith Machine)', comebackName: 'Squat (Smith Machine)', capClass: 'main', weeks: weeks([40, 50, 70, 80]) },
    { name: 'Leg Extension (Machine)', comebackName: 'Leg Extension (Machine)', capClass: 'main', weeks: weeks([30, 35, 40, 45]) },
  ] });
  w('routines', 'legs-gbi', { id: 'legs-gbi', title: 'Legs', folderId: 'comeback', order: 0, dayType: 'legs', exercises: [
    { key: 'e1', exerciseId: 'squat-smith-machine', name: 'Squat (Smith Machine)', plan: { routine: 'legs-gbi', name: 'Squat (Smith Machine)' }, sets: [] },
    { key: 'e2', exerciseId: 'leg-extension-machine', name: 'Leg Extension (Machine)', plan: { routine: 'legs-gbi', name: 'Leg Extension (Machine)' }, sets: [] },
  ] });
  w('settings', 'equipment', { bars: [{ id: 'smith', equipment: 'smith', kg: 15 }], plates: [20, 10, 5, 2.5, 1.25], extraPlates: [] });
  // History: Legs Tuesday 1/13, Pull 1/15, Push 1/17, so today (1/20) is Legs, week 3.
  const sess = (id, dayType, iso, exercises) => w('sessions', id, { id, kind: 'workout', title: dayType[0].toUpperCase() + dayType.slice(1), dayType, startedAt: at(iso), endedAt: at(iso, 4), pausedMs: 0, status: 'done', source: 'training-hq', exercises });
  sess('s-legs', 'legs', '2026-01-13', [{ key: 'a', name: 'Squat (Smith Machine)', exerciseId: 'squat-smith-machine', type: 'weight_reps' }, { key: 'b', name: 'Leg Extension (Machine)', exerciseId: 'leg-extension-machine', type: 'weight_reps' }]);
  sess('s-pull', 'pull', '2026-01-15', []);
  sess('s-push', 'push', '2026-01-17', []);
  const set = (id, exKey, kg, reps, order) => w('sets', id, { id, sessionId: 's-legs', exKey, order, type: 'normal', kg, reps, done: true, doneAt: at('2026-01-13') + order });
  set('x1', 'a', 40, 10, 0); set('x2', 'a', 40, 10, 1); set('x3', 'b', 30, 12, 2);
  w('supplements', 'supp.powder', { id: 'supp.powder', kind: 'supplement', name: 'Test powder', short: 'powder', dose: '5 g', days: { type: 'daily' }, status: 'active', order: 1, stock: { servings: 3, countedAt: at('2026-01-19') } });
  w('supplements', 'supp.caps', { id: 'supp.caps', kind: 'supplement', name: 'Test capsules', short: 'caps', dose: '2 caps', days: { type: 'daily' }, status: 'active', order: 2 });
  w('fuel', 'plan', { kind: 'plan', kcal: 2000, proteinG: 150, foods: [{ name: 'Rice' }] });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Wall Hold', sets: 3, seconds: 30, where: 'home' }], loadsArea: { exercises: ['Leg Extension (Machine)'] } });
  w('tendons', 'readiness', { kind: 'readiness', status: 'draft', workingArea: { legs: ['L'], pull: [], push: [] },
    ratings: [{ key: 'T', label: 'Sore tendon area', levels: ['none', 'slight', 'at the limit', 'above it'] }, { key: 'L', label: 'Legs', levels: ['none', 'slight', 'clearly', 'very'] }, { key: 'E', label: 'Energy', levels: ['drained', 'low', 'normal', 'high'] }] });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-tools-'));
  store = openStore(join(dir, 'db.sqlite'));
  clock = NOW; actions = [];
  seed();
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => clock, action: (a) => actions.push(a) });
const call = (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, ctx());
const list = (col) => store.listRecords(col).map((r) => r.data);

test('every tool has a unique name, a title, a description and an object schema', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.title && t.description.length > 30, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name);
  }
  for (const n of ['today', 'programme', 'history', 'calendar', 'health', 'meals', 'supplements', 'body_scans', 'sauna', 'squat_sessions', 'start_session', 'log_set', 'correct_set', 'rest_timer', 'log_meal', 'supplement', 'supplement_plan', 'body_scan', 'set_reminder', 'write_note', 'sauna_session']) assert.ok(names.includes(n), n);
});

test('helpers: names as he says them, loads with the bar, days with weekday', () => {
  const items = [{ name: 'Squat (Smith Machine)' }, { name: 'Leg Extension (Machine)' }, { name: 'Seated Cable Row - V Grip (Cable)' }];
  assert.equal(findByName(items, 'squat').item.name, 'Squat (Smith Machine)');
  assert.equal(findByName(items, 'cable row').item.name, 'Seated Cable Row - V Grip (Cable)');
  assert.equal(findByName(items, 'bench').item, null);
  assert.equal(loadText(62.5, 12.5), '62.5 kg total (12.5 kg bar + 25 kg a side)');
  assert.equal(loadText(29), '29 kg');
  assert.equal(dayText('2026-01-20', '2026-01-20'), 'Tuesday 1/20');
  assert.equal(dayText('2025-12-30', '2026-01-20'), 'Tuesday 12/30/2025');
});

test('today and the context line say the day type, week column and what is open', async () => {
  const r = await call('today');
  assert.match(r.text, /^Today: Legs \(week 3 column\), not done yet\./);
  assert.match(r.text, /Last rotation session: Push, Saturday 1\/17\./);
  assert.match(r.text, /Supplements today: 0 of 2 taken; open: powder, caps\./);
  assert.match(contextLine({ store, tz: TZ, now: NOW }), /^Today: Legs \(week 3 column\)/);
});

test('programme gives exactly what Start would: the table capped at last load + 30%, with the bar split', async () => {
  const r = await call('programme');
  assert.match(r.text, /^Legs, today, week 3 column\./);
  assert.match(r.text, /1\. Squat \(Smith Machine\): 2 sets × 8-12 at 50 kg total \(15 kg bar \+ 17\.5 kg a side\)\. Why: table 70, capped: last 40 \+ 30%/);
  assert.match(r.text, /Last: Tuesday 1\/13, 40 kg × 10, 40 kg × 10/);
  const wk4 = await call('programme', { week: 4 });
  assert.match(wk4.text, /week 4 column \(asked for\)/);
});

test('a session started, sets logged by voice-style numbers, the 30% guard and the rest timer', async () => {
  const st = await call('start_session');
  assert.equal(st.wrote, true);
  assert.match(st.text, /^Started Legs \(week 3 column\): 2 exercises/);
  assert.match(st.text, /Check-in not done today/);
  const session = list('sessions').find((s) => s.status === 'active');
  assert.ok(session);
  assert.deepEqual(actions.at(-1), { kind: 'open', url: `#/session/${session.id}`, label: 'Open the session' });
  assert.match((await call('start_session')).text, /Session in progress: Legs/, 'one session at a time');

  clock += 60000;
  const a = await call('log_set', { kg: 60, reps: 8 });
  assert.match(a.text, /^Logged Squat \(Smith Machine\), set 1 of 2: 60 kg total \(15 kg bar \+ 22\.5 kg a side\) × 8\./);
  assert.match(a.text, /Over his 30% cap: heaviest in the last 7 days was 40 kg \(Tuesday 1\/13\); 60 kg is 50% more; the cap is 52 kg\. 50 kg keeps him under it\./);
  assert.match(a.text, /New comeback best/);
  assert.deepEqual(actions.at(-1), { kind: 'rest', seconds: 180, label: 'Squat (Smith Machine)' });
  clock += 60000;
  const b = await call('log_set', { reps: 9 });
  assert.match(b.text, /set 2 of 2: 50 kg total .* × 9/, 'no kg said: the target load');
  assert.match(b.text, /Next: Leg Extension \(Machine\), set 1 of 2/);
  const sets = list('sets').filter((x) => x.sessionId === session.id);
  assert.equal(sets.filter((x) => x.done).length, 2);
  assert.ok(sets.every((x) => !x.done || x.doneAt));

  const c = await call('correct_set', { exercise: 'squat', set: 1, kg: 50 });
  assert.match(c.text, /set 1 of Legs is now 50 kg total .* × 8 \(was 60 kg total/);
  const extra = await call('log_set', { exercise: 'squat', kg: 50, reps: 8 });
  assert.match(extra.text, /set 3 of 3 \(an extra set\)/);
  const rm = await call('correct_set', { exercise: 'squat', set: 3, remove: true });
  assert.match(rm.text, /^Removed Squat \(Smith Machine\) set 3/);
  assert.equal(store.getRecord('sets', list('sets').length ? sets[0].id : 'x')?.deleted, false);

  actions = [];
  const n = await call('next_exercise');
  assert.match(n.text, /^Next: Leg Extension \(Machine\), set 1 of 2/);
  assert.equal(actions[0].kind, 'focus');
  assert.match((await call('log_set', { exercise: 'bench', kg: 20, reps: 5 })).text, /isn't in this session/);
  const t = await call('rest_timer', { action: 'add', seconds: -15 });
  assert.equal(t.text, 'Rest timer -15 s on his phone.');
  assert.deepEqual(actions.at(-1), { kind: 'rest-add', seconds: -15 });
});

test('supplements: taken and skipped are logged as he said, with the stock warning; never more', async () => {
  const r = await call('supplement', { names: ['powder'], status: 'taken' });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Tuesday 1\/20: powder 5 g taken\./);
  assert.match(r.text, /Test powder: 2 servings left/);
  assert.match(r.text, /Still open: caps\./);
  const e = store.getRecord('supp-log', '2026-01-20.supp.powder').data;
  assert.equal(e.status, 'taken');
  assert.equal(e.by, 'coach');
  const s2 = await call('supplement', { names: ['caps'], status: 'skipped', reason: 'Ran out' });
  assert.match(s2.text, /caps skipped \(Ran out\)/);
  assert.match(s2.text, /Everything for the day is answered\./);
  assert.match((await call('supplement', { names: ['vitamin x'], status: 'taken' })).text, /isn't on his list/);
  assert.match((await call('supplement', { names: ['powder'], status: 'taken', date: '2026-01-21' })).text, /still to come/);
  await call('supplement', { names: ['powder'], status: 'undo' });
  assert.equal(store.getRecord('supp-log', '2026-01-20.supp.powder').deleted, true);
  assert.equal(list('supplements').length, 2, 'his list is never changed');
  await call('supplement_plan', { kind: 'considering', name: 'Something new' });
  assert.equal(list('supp-considering')[0].status, 'considering');
  assert.equal(list('supplements').length, 2);
});

test('a meal he describes is logged with confirmed items, and can be corrected', async () => {
  const r = await call('log_meal', { items: [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }, { name: 'Eggs', grams: 100, kcal: 143, protein: 12.6 }], time: '02:30' });
  assert.match(r.text, /^Logged [A-Za-z]+, 2:30 AM \[id meal-[^\]]+\]: Rice 200 g, Eggs 100 g; 403 kcal, 17\.6 g protein\./);
  assert.match(r.text, /Tuesday 1\/20: 403 kcal, 17\.6 g protein \(targets 2000 kcal, 150 g protein/);
  const meal = list('meals')[0];
  assert.equal(meal.source, 'manual');
  assert.ok(meal.before.confirmedAt);
  const fix = await call('correct_meal', { meal: meal.id, items: [{ name: 'Rice', grams: 150, kcal: 195, protein: 3.8 }] });
  assert.match(fix.text, /Rice 150 g; 195 kcal, 3\.8 g protein/);
  assert.match((await call('log_meal', { items: [{ name: 'X', grams: 1, kcal: 1, protein: 0 }], time: '20:00' })).text, /in the future/);
});

test('sauna: a symptom ends the running session at once; the hard-stop words come back', async () => {
  store.writeLocal('sauna', 'sauna-1', { id: 'sauna-1', date: '2026-01-20', startedAt: NOW - 600000, stepIndex: 0, plannedRounds: 1, roundMin: 10, status: 'active', rounds: [{ n: 1, planned: 10, inAt: NOW - 500000, outAt: null }], breaks: [], symptoms: [], after: null });
  const r = await call('sauna_session', { action: 'symptoms', symptoms: ['dizzy'] });
  assert.match(r.text, /^STOPPED\./);
  assert.ok(r.text.includes(GET_OUT));
  const s = store.getRecord('sauna', 'sauna-1').data;
  assert.equal(s.status, 'stopped');
  assert.deepEqual(s.symptoms.at(-1).what, ['Dizzy']);
  assert.equal(s.rounds[0].outAt, NOW);
  assert.equal(actions.at(-1).url, '#/sauna/run/sauna-1');
  assert.match((await call('sauna_session', { action: 'end' })).text, /No sauna session is running/);
});

test('sauna: end here, then the question 15 minutes after', async () => {
  store.writeLocal('sauna', 'sauna-2', { id: 'sauna-2', date: '2026-01-20', startedAt: NOW - 600000, stepIndex: 1, plannedRounds: 2, roundMin: 10, status: 'active', rounds: [{ n: 1, planned: 10, inAt: NOW - 900000, outAt: NOW - 300000 }], breaks: [{ after: 1, startAt: NOW - 300000, endAt: null, symptoms: null }], symptoms: [], after: null });
  const r = await call('sauna_session', { action: 'end' });
  assert.match(r.text, /doesn't count as a clean session/);
  const s = store.getRecord('sauna', 'sauna-2').data;
  assert.equal(s.status, 'ended');
  assert.equal(s.after.dueAt, NOW + 15 * 60000);
  await call('sauna_session', { action: 'after_answer', none: true });
  assert.equal(store.getRecord('sauna', 'sauna-2').data.after.symptoms, false);
});

test('reminders the coach sets reach the reminder planner (kind coach) and can be cancelled', async () => {
  const r = await call('set_reminder', { time: '19:30', text: 'Knee holds' });
  assert.match(r.text, /^Reminder set for Tuesday 1\/20, 7:30 PM: "Knee holds"/);
  const rem = list('coach-reminders')[0];
  const plan = () => remindersFor({ ...reminderState({ coachReminders: list('coach-reminders') }, TZ), date: '2026-01-20' }).filter((x) => x.kind === 'coach');
  assert.deepEqual(plan().map((x) => [x.title, x.body, x.due, x.url]), [['Reminder', 'Knee holds', true, '#/coach']]);
  const past = await call('set_reminder', { time: '02:00', text: 'Tomorrow then' });
  assert.match(past.text, /Wednesday 1\/21, 2:00 AM/, 'a time already passed today means tomorrow');
  await call('set_reminder', { cancel: rem.id });
  assert.equal(plan()[0].due, false);
  const note = await call('write_note', { text: 'Ask about the left knee', topic: 'knees' });
  assert.equal(note.wrote, true);
  assert.match((await call('notes')).text, /\[knees\] \[id note-[^\]]+\]: Ask about the left knee/);
});

test('schedule: a session time, a rest day and its undo follow the rotation rules', async () => {
  const r = await call('schedule', { action: 'set_time', time: '04:30' });
  assert.match(r.text, /^Legs Tuesday 1\/20 at 4:30 AM; check-in 4:00 AM\./);
  assert.equal(store.getRecord('days', '2026-01-20').data.sessionTime, '04:30');
  const rest = await call('schedule', { action: 'rest_today' });
  assert.match(rest.text, /Next: Legs, Wednesday 1\/21 at 4:30 AM/);
  assert.equal(store.getRecord('days', '2026-01-21').data.sessionTime, '04:30', 'the time moves with the session');
  assert.match((await call('today')).text, /^Today: rest \(a rest day he added\)/);
  await call('schedule', { action: 'undo_rest' });
  assert.match((await call('today')).text, /^Today: Legs/);
  clock = Date.UTC(2026, 0, 20, 14, 0);
  const later = await call('schedule', { action: 'set_time', time: '04:30' });
  assert.match(later.text, /Wednesday 1\/21 at 4:30 AM.*today has passed, so this is for tomorrow/);
});

test('body scan: confirm the proposed date (never today), record the safety notice and results', async () => {
  assert.match((await call('body_scan', { action: 'confirm_date', date: '2026-01-20' })).text, /Pick a day after today/);
  const c = await call('body_scan', { action: 'confirm_date' });
  assert.match(c.text, /^Body scan confirmed for [A-Z][a-z]+day \d+\/\d+/);
  assert.ok(store.getRecord('scan-plan', 'main').data.next.date > '2026-01-20');
  await call('body_scan', { action: 'safety_read' });
  assert.ok(store.getRecord('scan-plan', 'main').data.safety.readAt);
  const res = await call('body_scan', { action: 'record_results', metrics: [{ label: 'Weight', value: 70.5, unit: 'kg' }, { label: 'Body Fat %', value: 15.1, unit: '%' }], fasted: true, time: '03:15' });
  assert.match(res.text, /Saved the scan of Tuesday 1\/20 at 3:15 AM: Weight 70\.5 kg; Body Fat % 15\.1 %/);
  const scan = store.getRecord('body-scans', 'scan.2026-01-20').data;
  assert.equal(scan.status, 'done');
  assert.equal(scan.conditions.fasted, true);
  assert.equal(scan.source, 'coach');
});

test('check-in by talking: refused on a draft table; missing ratings asked for; his rules decide; a move applied only on his word', async () => {
  const draft = await call('check_in', { energy: 2 });
  assert.match(draft.text, /still a draft/);
  assert.equal(actions.at(-1).url, '#/checkin');
  const t = store.getRecord('tendons', 'readiness').data;
  store.writeLocal('tendons', 'readiness', { ...t, status: 'confirmed' });
  const part = await call('check_in', { areas: [{ area: 'knees', sore: 2 }] });
  assert.match(part.text, /Still needed .*Knees: worse than yesterday, yes or no; legs soreness 0-3; energy 0-3/);
  assert.match(part.text, /sore tendon area 0 none, 1 slight, 2 at the limit, 3 above it/);
  assert.equal(store.getRecord('days', '2026-01-20'), undefined, 'nothing saved');
  const r = await call('check_in', { areas: [{ area: 'knees', sore: 2, worse: false }], legs: 0, energy: 2 });
  assert.match(r.text, /rule 4/);
  assert.match(r.text, /Lighter today: Leg Extension \(Machine\) [\d.]+ kg × 6-10/);
  const rec = store.getRecord('days', '2026-01-20').data.readiness;
  assert.deepEqual([rec.rule, rec.action, rec.lighterExercises, rec.by], [4, 'lighter-area', ['Leg Extension (Machine)'], 'coach']);
  assert.match((await call('check_in', { areas: [{ area: 'knees', sore: 0, worse: false }], legs: 0, energy: 2 })).text, /already checked in today/);
  const move = await call('check_in', { areas: [{ area: 'knees', sore: 0, worse: false }], legs: 0, energy: 0, again: true });
  assert.match(move.text, /rule 2.*\n.*Not applied yet/s);
  assert.equal(store.getRecord('days', '2026-01-20').data.rest, undefined);
  await call('check_in', { apply: true });
  assert.equal(store.getRecord('days', '2026-01-20').data.rest.reason, 'moved');
  assert.match((await call('today')).text, /^Today: rest \(session moved to tomorrow at the check-in\)\. Next: Legs, Wednesday 1\/21/);
});

test('today projects the coming days from the rotation (dates never worked out by hand)', async () => {
  const r = await call('today');
  assert.match(r.text, /Coming up, if each planned session happens on its day: Wednesday 1\/21 rest; Thursday 1\/22 Pull \(week 4\); Friday 1\/23 Push \(week 4\)/);
});

test('read tools answer on an empty database without failing', async () => {
  const empty = openStore(join(dir, 'empty.sqlite'));
  for (const t of TOOLS.filter((x) => x.annotations?.readOnlyHint)) {
    const r = await t.run({}, { store: empty, tz: TZ, now: () => NOW, action: () => {} });
    assert.equal(typeof r.text, 'string', t.name);
  }
  empty.close();
});
