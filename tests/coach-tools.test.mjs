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
  // History: Legs Tuesday 1/13, Pull 1/18, Push 1/19, so today (1/20) is Legs (the third day in a row), week 3.
  const sess = (id, dayType, iso, exercises) => w('sessions', id, { id, kind: 'workout', title: dayType[0].toUpperCase() + dayType.slice(1), dayType, startedAt: at(iso), endedAt: at(iso, 4), pausedMs: 0, status: 'done', source: 'training-hq', exercises });
  sess('s-legs', 'legs', '2026-01-13', [{ key: 'a', name: 'Squat (Smith Machine)', exerciseId: 'squat-smith-machine', type: 'weight_reps' }, { key: 'b', name: 'Leg Extension (Machine)', exerciseId: 'leg-extension-machine', type: 'weight_reps' }]);
  sess('s-pull', 'pull', '2026-01-18', []);
  sess('s-push', 'push', '2026-01-19', []);
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
  assert.match(r.text, /Last rotation session: Push, Monday 1\/19\./);
  assert.match(r.text, /Supplements today: 0 of 2 taken; open: powder, caps\./);
  assert.match(contextLine({ store, tz: TZ, now: NOW }), /^Today: Legs \(week 3 column\)/);
});

test('today: Neck after his chosen session (due today on a Legs plan), the weekly ask while unplanned', async () => {
  store.writeLocal('routines', 'neck', { id: 'neck', title: 'Neck', folderId: 'other', order: 0, dayType: 'neck', exercises: [] });
  assert.match((await call('today')).text, /Neck: his Neck routine is still unplanned/);
  store.writeLocal('schedule', 'neck', { planned: true, place: 'after-legs' });
  assert.match((await call('today')).text, /Neck: his plan puts it after Legs; due today after Legs \(Train offers it\)\./);
  store.writeLocal('schedule', 'neck', { planned: true, place: 'after-push' });
  assert.match((await call('today')).text, /Neck: his plan puts it after Push\./);
  assert.doesNotMatch((await call('today')).text, /unplanned/);
});

test('rest_day_hold (A2): asked on a rest day, his answer recorded, never on a training day; "other" needs his words', async () => {
  store.writeLocal('tendons', 'area.shoulder', { kind: 'area', id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Press Hold', timing: ['after Push'] }, { exercise: 'Raise Hold', timing: ['after Push', 'rest days'] }] });
  assert.equal((await call('rest_day_hold', { choice: 'gym' })).wrote, undefined);
  await call('schedule', { action: 'rest_today' });
  assert.match((await call('today')).text, /Rest-day shoulder hold: ask him what he wants today: the gym just for the Raise Hold hold, another hold he names, or skip today/);
  const no = await call('rest_day_hold', { choice: 'other' });
  assert.match(no.text, /needs the hold he named/);
  const r = await call('rest_day_hold', { choice: 'other', hold: 'Band hold' });
  assert.equal(r.wrote, true);
  assert.match(r.text, /Shoulder, Tuesday 1\/20: his own hold: Band hold\. 3 × 30 s, his rule\./);
  const day = list('days').find((d) => d.date === '2026-01-20');
  assert.equal(day.restHolds.shoulder.choice, 'other');
  assert.ok(day.rest, 'the rest day stays');
  assert.match((await call('today')).text, /Shoulder rest day \(7:30 AM\): Band hold \(his own hold\), open/);
  assert.doesNotMatch((await call('today')).text, /Rest-day shoulder hold: ask him/);
  await call('rest_day_hold', { choice: 'skip' });
  assert.match((await call('today')).text, /Shoulder rest day \(7:30 AM\): skipped today \(his choice\)/);
});

test('programme gives exactly what Start would: the table capped at last load + 30%, with the bar split', async () => {
  const r = await call('programme');
  assert.match(r.text, /^Legs, today, week 3 column\./);
  assert.match(r.text, /1\. Squat \(Smith Machine\): 2 sets × 8-12 at 50 kg total \(15 kg bar \+ 17\.5 kg a side\)\. Why: Cap 52 kg: last time 40 kg \+ 30%\. Plan says 70 kg/);
  assert.match(r.text, /Last: Tuesday 1\/13, 40 kg × 10, 40 kg × 10/);
  const wk4 = await call('programme', { week: 4 });
  assert.match(wk4.text, /week 4 column \(asked for\)/);
});

test('the coach asks before it starts a session (his rule, Mon 10/19)', async () => {
  const say = (turnId, role, at, tools = []) => store.writeLocal('coach-messages', `m-${turnId}-${role}`, { id: `m-${turnId}-${role}`, role, turnId, at, text: '', tools });
  const inTurn = (turnId) => (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, { ...ctx(), turnId });
  // "About to start squats": the first call only offers.
  say('t1', 'user', clock - 3000);
  const first = await inTurn('t1')('start_session');
  assert.match(first.text, /^Not started\. Ask him first, in a few words: "Start Legs[^"]* now\?"/);
  assert.match(first.summary, /^asked first: /);
  assert.ok(!list('sessions').some((x) => x.status === 'active'), 'nothing started');
  // Calling again in the same turn still doesn't start it.
  assert.match((await inTurn('t1')('start_session')).text, /^Not started/);
  // The reply offered it; an unrelated turn in between, or a different session, doesn't count.
  say('t1', 'assistant', clock - 2000, [{ name: 'start_session', summary: first.summary }]);
  assert.match((await inTurn('t2')('start_session', { empty: true })).text, /^Not started/);
  // He talked about something else first: the offer has lapsed.
  say('t2', 'user', clock - 1500); say('t2', 'assistant', clock - 1000);
  say('t3', 'user', clock);
  assert.match((await inTurn('t3')('start_session')).text, /^Not started/);
  for (const t of ['t1', 't2', 't3']) for (const r of ['user', 'assistant']) store.writeLocal('coach-messages', `m-${t}-${r}`, null, { deleted: true });
});

test('the coach works the app (Tue 10/20): told to start, it starts; screens; the workout; settings; the phone', async () => {
  const said = (turnId, text) => store.writeLocal('coach-messages', `m-${turnId}-user`, { id: `m-${turnId}-user`, role: 'user', turnId, at: clock, text });
  const inTurn = (turnId) => (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, { ...ctx(), turnId });
  // "Go start a new workout push": started at once, open on his phone.
  said('c1', 'Go start a new workout legs');
  const st = await inTurn('c1')('start_session', { dayType: 'legs' });
  assert.match(st.text, /^Started Legs/);
  const session = list('sessions').find((x) => x.status === 'active');
  assert.deepEqual(actions.at(-1), { kind: 'go', url: `#/session/${session.id}`, label: 'Open the session' });
  // Any screen; the ones that need something find it.
  assert.match((await call('open_screen', { screen: 'talk' })).text, /^Opened on his phone: Talk/);
  assert.deepEqual(actions.at(-1), { kind: 'go', url: '#/coach', label: 'Talk (the chat with the coach)' });
  await call('open_screen', { screen: 'session' }); assert.equal(actions.at(-1).url, `#/session/${session.id}`);
  await call('open_screen', { screen: 'supplement', name: 'powder' }); assert.equal(actions.at(-1).url, '#/supp/supp.powder');
  await call('open_screen', { screen: 'routine', name: 'legs' }); assert.equal(actions.at(-1).url, '#/routine/legs-gbi');
  await call('open_screen', { screen: 'exercise', name: 'leg extension' }); assert.match(actions.at(-1).url, /^#\/exercise\/[\w-]+$/);
  await call('open_screen', { screen: 'body_scan_results' }); assert.equal(actions.at(-1).url, '#/body/scan/r/2026-01-20');
  assert.match((await call('open_screen', { screen: 'nope' })).text, /^No screen called "nope"/);
  // The clock.
  clock += 60000;
  assert.match((await call('workout', { action: 'pause' })).text, /clock paused/);
  clock += 120000;
  assert.match((await call('workout', { action: 'resume' })).text, /clock running again/);
  assert.equal(list('sessions').find((x) => x.id === session.id).pausedMs, 120000);
  await call('log_set', { kg: 40, reps: 10 });
  // Finish: asked when he only hints at it, done when he says so; unticked sets dropped, the summary opens.
  said('c2', "I think I'm done");
  assert.match((await inTurn('c2')('workout', { action: 'finish' })).text, /^Not finished\. Ask him first.*"Finish Legs now\? 1 of \d+ sets ticked; the unticked ones are dropped\."/);
  said('c3', 'Jarvis, finish the workout');
  const fin = await inTurn('c3')('workout', { action: 'finish' });
  assert.match(fin.text, /^Saved Legs: 0:0\d, 1 set, 400 kg volume; \d+ unticked sets dropped\./);
  assert.equal(list('sessions').find((x) => x.id === session.id).status, 'done');
  assert.equal(list('sets').filter((x) => x.sessionId === session.id).length, 1);
  assert.deepEqual(actions.slice(-2), [{ kind: 'rest-skip' }, { kind: 'go', url: `#/finish/${session.id}`, label: 'The workout summary' }]);
  assert.match((await call('workout', { action: 'status' })).text, /^No workout in progress/);
  // Settings.
  assert.match((await call('app_settings')).text, /coach\.model = "fast"/);
  assert.equal((await call('app_settings', { setting: 'coach.model', value: 'deep' })).text, 'Coach model: Sonnet 5.5 (medium) to Opus 5.5 (high). His phone has it on the next sync (seconds).');
  assert.equal(store.getRecord('settings', 'main').data.coach.model, 'deep');
  assert.match((await call('app_settings', { setting: 'rest.mainS', value: '200' })).text, /give one of/);
  assert.match((await call('app_settings', { setting: 'notify.holdsMorning', value: '9:15' })).text, /to "09:15"/);
  assert.match((await call('app_settings', { setting: 'voice.speak', value: 'off' })).text, /true to false/);
  // The phone.
  await call('phone', { action: 'mic_off' }); assert.deepEqual(actions.at(-1), { kind: 'mic-off' });
  await call('phone', { action: 'reload' }); assert.deepEqual(actions.at(-1), { kind: 'reload' });
});

test('discarding a workout always needs his yes to that question', async () => {
  const said = (turnId, text) => store.writeLocal('coach-messages', `m-${turnId}-user`, { id: `m-${turnId}-user`, role: 'user', turnId, at: clock, text });
  const inTurn = (turnId) => (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, { ...ctx(), turnId });
  said('d1', 'start legs');
  await inTurn('d1')('start_session', { dayType: 'legs' });
  const session = list('sessions').find((x) => x.status === 'active');
  said('d2', 'Discard the session');
  const ask = await inTurn('d2')('workout', { action: 'discard' });
  assert.match(ask.text, /^Not discarded\. Ask him first: "Discard Legs\? 0 logged sets will be deleted\."/);
  store.writeLocal('coach-messages', 'm-d2-assistant', { id: 'm-d2-assistant', role: 'assistant', turnId: 'd2', at: clock + 1, text: 'Discard Legs?', tools: [{ name: 'workout', summary: ask.summary }] });
  clock += 5000;
  said('d3', 'yes');
  assert.match((await inTurn('d3')('workout', { action: 'discard' })).text, /^Discarded Legs/);
  assert.equal(list('sessions').find((x) => x.id === session.id).status, 'discarded');
  assert.equal(list('sets').filter((x) => x.sessionId === session.id).length, 0);
});

test('one yes to the coach\'s own question is enough (Tue 10/20 on his phone: he had to say yes twice)', async () => {
  const msg = (turnId, role, text, at) => store.writeLocal('coach-messages', `m-${turnId}-${role}`, { id: `m-${turnId}-${role}`, role, turnId, at, text });
  const inTurn = (turnId) => (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, { ...ctx(), turnId });
  msg('y1', 'user', 'start legs', clock);
  await inTurn('y1')('start_session', { dayType: 'legs' });
  const session = list('sessions').find((x) => x.status === 'active');
  // "Discard this workout" -> the coach asked in its own words (no tool) -> "Yes" discards.
  msg('y2', 'user', 'Discard this workout', clock + 1000); msg('y2', 'assistant', 'Discard the Legs you started? Yes or no?', clock + 2000);
  msg('y3', 'user', 'Yes', clock + 3000);
  clock += 4000;
  assert.match((await inTurn('y3')('workout', { action: 'discard' })).text, /^Discarded Legs/);
  assert.equal(list('sessions').find((x) => x.id === session.id).status, 'discarded');
  // A yes to something else does not start a workout: the question must be about starting.
  msg('y4', 'user', 'did I eat enough', clock + 1000); msg('y4', 'assistant', 'No. Want the numbers?', clock + 2000);
  msg('y5', 'user', 'yes', clock + 3000); clock += 4000;
  assert.match((await inTurn('y5')('start_session', { dayType: 'legs' })).text, /^Not started/);
  msg('y6', 'user', 'at the gym', clock + 1000); msg('y6', 'assistant', 'Start Legs now?', clock + 2000);
  msg('y7', 'user', 'yeah', clock + 3000); clock += 4000;
  assert.match((await inTurn('y7')('start_session', { dayType: 'legs' })).text, /^Started Legs/);
});

test('a session started, sets logged by voice-style numbers, the 30% guard and the rest timer', async () => {
  // He said yes to the coach's offer in his next message (see the test above).
  store.writeLocal('coach-messages', 'm-o1-user', { id: 'm-o1-user', role: 'user', turnId: 'o1', at: clock - 2000, text: 'about to start squats' });
  const offer = await TOOLS.find((t) => t.name === 'start_session').run({}, { ...ctx(), turnId: 'o1' });
  store.writeLocal('coach-messages', 'm-o1-assistant', { id: 'm-o1-assistant', role: 'assistant', turnId: 'o1', at: clock - 1000, text: 'Start Legs now?', tools: [{ name: 'start_session', summary: offer.summary }] });
  store.writeLocal('coach-messages', 'm-o2-user', { id: 'm-o2-user', role: 'user', turnId: 'o2', at: clock, text: 'yes' });
  const st = await TOOLS.find((t) => t.name === 'start_session').run({}, { ...ctx(), turnId: 'o2' });
  for (const id of ['m-o1-user', 'm-o1-assistant', 'm-o2-user']) store.writeLocal('coach-messages', id, null, { deleted: true });
  assert.equal(st.wrote, true);
  assert.match(st.text, /^Started Legs \(week 3 column\): 2 exercises/);
  assert.match(st.text, /Check-in not done today/);
  const session = list('sessions').find((s) => s.status === 'active');
  assert.equal(session.tz, TZ, 'a session started by the coach carries the zone of the phone he talks from (A3)');
  assert.ok(session);
  assert.deepEqual(actions.at(-1), { kind: 'go', url: `#/session/${session.id}`, label: 'Open the session' });
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
  assert.match(r.text, /^Logged [A-Za-z]+, 2:30 AM \[id meal-[^\]]+\]: Rice 200 g \(his numbers\), Eggs 100 g \(his numbers\); 403 kcal, 17\.6 g protein\./);
  assert.match(r.text, /Tuesday 1\/20: 403 kcal, 17\.6 g protein \(targets 2000 kcal, 150 g protein/);
  const meal = list('meals')[0];
  assert.equal(meal.source, 'manual');
  assert.ok(meal.before.confirmedAt);
  const fix = await call('correct_meal', { meal: meal.id, items: [{ name: 'Rice', grams: 150, kcal: 195, protein: 3.8 }] });
  assert.match(fix.text, /Rice 150 g \(his numbers\); 195 kcal, 3\.8 g protein/);
  assert.match((await call('log_meal', { items: [{ name: 'X', grams: 1, kcal: 1, protein: 0 }], time: '20:00' })).text, /in the future/);
  // A5: no numbers from him: USDA values; a food USDA doesn't know and no numbers: refused.
  const u = await call('log_meal', { items: [{ name: 'Rice', grams: 450, usda: 'Rice, white, long-grain, regular, unenriched, cooked without salt' }, { name: 'Eggs', grams: 100 }], time: '02:00' });
  assert.match(u.text, /Rice 450 g, Eggs 100 g; 728 kcal, 24\.7 g protein \(USDA values\)/);
  const usda = list('meals').find((m) => m.before.items.some((x) => x.grams === 450)).before.items;
  assert.deepEqual(usda.map((x) => [x.fdcId, x.source]), [[169757, 'usda'], [171287, 'usda']]);
  assert.match((await call('log_meal', { items: [{ name: 'Nuoc cham', grams: 20 }] })).text, /No USDA match for "Nuoc cham"\. .*Nothing logged yet/);
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
  const soon = await call('set_reminder', { inMinutes: 12, text: 'Throw out the trash' });
  assert.match(soon.text, /^Reminder set for 3:12 AM \(in 12 minutes\): "Throw out the trash"/, 'minutes from now, exact');
  assert.equal(list('coach-reminders').find((x) => x.text === 'Throw out the trash').at, NOW + 12 * 60000);
  assert.ok(plan().some((x) => x.body === 'Throw out the trash' && x.at === NOW + 12 * 60000));
  const past = await call('set_reminder', { time: '02:00', text: 'Tomorrow then' });
  assert.match(past.text, /Wednesday 1\/21, 2:00 AM/, 'a time already passed today means tomorrow');
  await call('set_reminder', { cancel: rem.id });
  assert.equal(plan().find((x) => x.body === 'Knee holds').due, false);
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

test('body scan: confirm the proposed date (today too, with the checklist; never a past day), record the safety notice and results', async () => {
  // Today's Legs is open: the proposal is a day he trains either way, and says which workout each way.
  assert.match((await call('body_scans')).text, /No date confirmed\. Proposed: Thursday 1\/22 \(a Pull day\), the first scan/);
  assert.match((await call('body_scan', { action: 'confirm_date', date: '2026-01-19' })).text, /Pick today or a later day/);
  const t = await call('body_scan', { action: 'confirm_date', date: '2026-01-20' });
  assert.match(t.text, /^Body scan confirmed for today, Tuesday 1\/20\. Go through this with him now .*Nothing eaten before the scan; Normal water intake.*Bathroom first; Barefoot\. If he ate something the checklist doesn't allow, record it/);
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
  // Every training day (Tue 10/20): no dates to confirm; one checklist line in his words.
  assert.match((await call('body_scan', { action: 'every', every: 'training' })).text, /^Scans now every training day/);
  assert.equal(store.getRecord('scan-plan', 'main').data.cadence, 'training');
  assert.match((await call('body_scan', { action: 'confirm_date' })).text, /every training day: no date to confirm/);
  assert.match((await call('body_scans')).text, /every training day.*Next scan: [A-Z][a-z]+day \d+\/\d+ \(the next training day\).*Nothing eaten before the scan\. \(fasted\)/s);
  assert.match((await call('body_scan', { action: 'checklist_line', line: 'fasted', text: 'Only the usual banana on waking.' })).text, /line changed: Only the usual banana on waking\./);
  const items = store.getRecord('scan-plan', 'main').data.protocol.items;
  assert.equal(items.find((i) => i.id === 'fasted').text, 'Only the usual banana on waking.');
  assert.equal(items.length, 8);
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
  // Today's Legs isn't done: if it doesn't happen today it carries over, so tomorrow isn't stated as fact
  // (phone test Sun 10/18, 11:48 PM: the coach called Monday a rest day while Legs was still open).
  assert.match(r.text, /If today's Legs is NOT done today, it carries over: Wednesday 1\/21 Legs \(week \d+\); Thursday 1\/22 Pull \(week \d+\); Friday 1\/23 Push/);
  assert.match(r.text, /don't state tomorrow's day as fact/);
});

test('read tools answer on an empty database without failing', async () => {
  const empty = openStore(join(dir, 'empty.sqlite'));
  for (const t of TOOLS.filter((x) => x.annotations?.readOnlyHint)) {
    const r = await t.run({}, { store: empty, tz: TZ, now: () => NOW, action: () => {} });
    assert.equal(typeof r.text, 'string', t.name);
  }
  empty.close();
});

test('supplement_review (A6): the open Diet.html line is shown, his answer recorded; keep leaves the list', async () => {
  store.writeLocal('fuel', 'supp-review', { items: [{ suppId: 'supp.powder', kind: 'differs', brief: '5 g', diet: '5 tablets', set: { dose: '5 tablets' } }, { suppId: 'supp.caps', kind: 'detail', brief: '2 caps', diet: '2 caps (300 mg each)', set: { dose: '2 caps (300 mg each)' } }], answers: {} });
  assert.match((await call('supplements')).text, /Not confirmed yet, his Diet\.html words these differently.*Test powder: list "5 g" vs Diet\.html "5 tablets"/);
  const r = await call('supplement_review', { supplement: 'powder', answer: 'use' });
  assert.equal(r.wrote, true);
  assert.equal(store.getRecord('supplements', 'supp.powder').data.dose, '5 tablets');
  await call('supplement_review', { supplement: 'caps', answer: 'keep' });
  assert.equal(store.getRecord('supplements', 'supp.caps').data.dose, '2 caps');
  assert.doesNotMatch((await call('supplements')).text, /Not confirmed yet/);
  assert.match((await call('supplement_review', { supplement: 'caps', answer: 'use' })).text, /Nothing to confirm/);
});

test('log_meal by packs and counts (A7): his foods sized from his packs; unknown ones refused', async () => {
  store.writeLocal('fuel', 'plan', { kind: 'plan', kcal: 2000, proteinG: 150, foods: [
    { name: 'Raw almonds', fdcId: 170567, pack: { grams: 200, label: '200 g pack' } },
    { name: 'Eggs', fdcId: 171287, unit: { grams: 50, label: 'egg', plural: 'eggs' } },
  ] });
  const r = await call('log_meal', { items: [{ name: 'almonds', packs: 0.5 }, { name: 'eggs', count: 3 }], time: '02:00' });
  assert.match(r.text, /Raw almonds ½ pack \(100 g\), Eggs 3 eggs \(150 g\); 794 kcal, 40 g protein \(USDA values\)/);
  const items = list('meals')[0].before.items;
  assert.deepEqual(items.map((x) => [x.name, x.grams, x.portion, x.fdcId, x.source]), [['Raw almonds', 100, '½ pack', 170567, 'usda'], ['Eggs', 150, '3 eggs', 171287, 'usda']]);
  assert.match(await call('meals').then((m) => m.text), /No kitchen scale: he goes by packs and counts: Raw almonds, pack 200 g; Eggs, 1 egg = 50 g/);
  assert.match((await call('log_meal', { items: [{ name: 'cashews', packs: 1 }] })).text, /No grams for "cashews"/);
});

test('sauna_plan (A9): proposes from the rotation with his checklist and no fasting; plans what he agrees to', async () => {
  // Today (Tue 1/20) is Legs, not done yet: Wed 1/21 is the rest day after Legs if he trains today, Legs if it moves.
  const p = await call('sauna_plan', { action: 'propose' });
  assert.match(p.text, /^Proposal \(not planned yet; he decides\): Wednesday 1\/21 at 5:00 PM \(after Legs, or rest day, never before lifting\); Saturday 1\/24 at 5:00 PM \(rest day, or after Legs, never before lifting\)/);
  assert.match(p.text, /"X, or Y" means X if it moves to tomorrow, Y if he does it today/);
  assert.match((await call('sauna')).text, /The app would propose .*Wednesday 1\/21 5:00 PM \(after Legs, or rest day\).*Y if he does it today/);
  assert.match(p.text, /I've eaten and drunk water in the last few hours/);
  assert.match(p.text, /never tell him to fast/);
  assert.doesNotMatch(p.text, /\bfast(ed|ing)? before\b/i);
  assert.ok(!store.getRecord('sauna-plan', 'main'), 'a proposal writes nothing');
  const r = await call('sauna_plan', { action: 'plan', dates: [{ date: '2026-01-21' }] });
  assert.equal(r.wrote, true);
  assert.deepEqual(store.getRecord('sauna-plan', 'main').data.planned, [{ date: '2026-01-21', time: '17:00' }]);
  assert.match((await call('sauna')).text, /Planned sauna days: Wednesday 1\/21 5:00 PM/);
  store.writeLocal('days', '2026-01-22', { date: '2026-01-22', sessionTime: '18:00' });
  assert.match((await call('sauna_plan', { action: 'plan', dates: [{ date: '2026-01-22', time: '17:00' }] })).text, /Never before lifting/);
  await call('sauna_plan', { action: 'set_time', time: '19:00' });
  assert.equal(store.getRecord('sauna-plan', 'main').data.time, '19:00');
});

test('micronutrients (A12): his references, food and supplements ticked taken, numbers only', async () => {
  store.writeLocal('fuel', 'plan', { kind: 'plan', kcal: 2000, proteinG: 150, foods: [{ name: 'Eggs', fdcId: 171287, gramsPerDay: 500 }] });
  store.writeLocal('fuel', 'micro', { energyBasisMJ: 10, references: [{ key: 'vitA', name: 'Vitamin A', unit: 'mcg', ref: 750, refNote: 'EFSA DRV', ul: 3000, ulNote: 'EFSA UL', group: 'vitamins' }, { key: 'vitC', name: 'Vitamin C', unit: 'mg', ref: 110, refNote: 'EFSA DRV', group: 'vitamins' }],
    retention: { foods: [171287], factors: { vitA: 0.9 } }, supplements: { 'supp.powder': { perDay: { vitC: 1000 } } } });
  await call('log_meal', { items: [{ name: 'Eggs', grams: 200 }], time: '02:00' });
  await call('supplement', { names: ['powder'], status: 'taken' });
  const t = (await call('micronutrients')).text;
  assert.match(t, /Numbers only: never advise/);
  assert.match(t, /- Vitamin A: 288 mcg \(38% of 750\); planned 720; 10% of the limit 3000 \(EFSA UL\)/);
  assert.match(t, /- Vitamin C: 1000 mg \(909% of 110\), 1000 from supplements/);
});

test('log_weight and log_sleep (Mon 10/19): the Evolt weigh-in and last night as he tells it', async () => {
  const w = await call('log_weight', { kg: 80.4, bodyFatPct: 14.2 });
  assert.equal(w.wrote, true);
  assert.match(w.text, /^Saved for Tuesday 1\/20: 80\.4 kg, body fat 14\.2%\./);
  const m = list('measurements').find((x) => x.date === '2026-01-20');
  assert.equal(m.weightKg, 80.4);
  assert.equal(m.fatPercent, 14.2);
  assert.equal(m.source, 'evolt');
  // A second weigh-in that day replaces the number, keeps one entry.
  await call('log_weight', { kg: 80.1 });
  assert.equal(list('measurements').filter((x) => x.date === '2026-01-20').length, 1);
  assert.equal(list('measurements').find((x) => x.date === '2026-01-20').weightKg, 80.1);
  assert.match((await call('log_weight', { kg: 12 })).text, /exactly as the scanner showed/);
  // Sleep: bed the evening before, up this morning.
  const sl = await call('log_sleep', { bed: '18:30', wake: '04:40' });
  assert.equal(sl.wrote, true);
  assert.match(sl.text, /6:30 PM to 4:40 AM, 10 h 10 min asleep/);
  const doc = store.getRecord('sleep-log', '2026-01-20').data;
  assert.equal(doc.inBedMin, 610);
  assert.match((await call('log_sleep', { bed: '04:00', wake: '04:40' })).text, /Check the times with him/);
  // The coach's context says today's weigh-in and sleep are in.
  const { contextLine } = await import('../server/coach/tools.mjs');
  assert.match(contextLine({ store, tz: TZ, now: clock }), /Today: weigh-in logged; last night's sleep known\./);
});

test('nudges by talking: how often, waking hours, a pause and resume', async () => {
  assert.match((await call('nudges')).text, /^Nudges: every 20 minutes, 7:00 AM to 10:00 PM\.$/);
  const r = await call('nudges', { wakeHm: '04:40', bedHm: '18:00', everyMin: 15 });
  assert.equal(r.text, 'Nudges every 15 minutes, from 4:40 AM, until 6:00 PM.');
  assert.deepEqual([store.getRecord('settings', 'main').data.notify.wakeHm, store.getRecord('settings', 'main').data.notify.bedHm], ['04:40', '18:00']);
  assert.match((await call('nudges', { pauseMin: 120 })).text, /^Nudges paused until \d+:\d\d [AP]M\.$/);
  assert.ok(store.getRecord('settings', 'main').data.notify.nudgePausedUntil > clock);
  assert.equal((await call('nudges', { resume: true })).text, 'Nudges back on now.');
  assert.equal(store.getRecord('settings', 'main').data.notify.nudgePausedUntil, 0);
});


test('his own foods with a pack label: the label counts for kcal and protein, by his name (Tue 10/20)', async () => {
  store.writeLocal('fuel', 'plan', { kind: 'plan', kcal: 2000, proteinG: 150, foods: [
    { name: 'Greek yogurt', fdcId: 170894, label: { perGrams: 100, kcal: 55, protein: 8.3 } },
    { name: 'Chia seeds', fdcId: 170554, label: { perGrams: 15, kcal: 47.6, protein: 3.1 } },
  ] });
  const r = await call('log_meal', { items: [{ name: 'Greek yogurt', grams: 225 }, { name: 'Chia seeds', grams: 50 }], time: '02:00' });
  assert.match(r.text, /Greek yogurt 225 g \(his pack label\), Chia seeds 50 g \(his pack label\); 283 kcal, 29 g protein/);
  const meal = list('meals').at(-1);
  assert.deepEqual(meal.before.items.map((x) => [x.name, x.kcal, x.protein, x.source, x.fdcId]), [['Greek yogurt', 124, 18.7, 'label', 170894], ['Chia seeds', 159, 10.3, 'label', 170554]]);
});

test('a scan with results is the day\'s weigh-in; the context knows; the meal on his screen is in the context (Tue 10/20)', async () => {
  const r = await call('body_scan', { action: 'record_results', metrics: [{ label: 'Weight', value: 75.1, unit: 'kg' }, { label: 'Body fat', value: 14.9, unit: '%' }, { label: 'Lean body mass', value: 63.9, unit: 'kg' }], time: '11:30' });
  assert.match(r.text, /^Saved the scan/);
  const m = store.getRecord('measurements', 'measure.2026-01-20').data;
  assert.deepEqual([m.weightKg, m.fatPercent, m.leanMassKg, m.source], [75.1, 14.9, 63.9, 'evolt']);
  assert.match(contextLine({ store, tz: TZ, now: clock }), /Today: weigh-in logged/);
  // The meal he is looking at.
  await call('log_meal', { items: [{ name: 'Rice', grams: 200, usda: 'Rice, white, long-grain, regular, unenriched, cooked without salt' }], time: '02:30', name: 'Test lunch' });
  const meal = list('meals').find((x) => x.name === 'Test lunch');
  const ctx1 = contextLine({ store, tz: TZ, now: clock, screen: `#/meal/${meal.id}` });
  assert.match(ctx1, new RegExp(`The meal on his screen: Test lunch \\(2:30 AM, Tuesday 1/20\\) \\[id ${meal.id}\\]: Rice 200 g; \\d+ kcal, [\\d.]+ g protein; confirmed\\. What he says about the plate corrects it`));
  assert.doesNotMatch(contextLine({ store, tz: TZ, now: clock, screen: '#/today' }), /The meal on his screen/);
});

test('supplement_setup: time, with food, servings, rest-day dose; never adds one (Tue 10/20)', async () => {
  assert.match((await call('supplement_setup', { supplement: 'powder', time: '11:00', withFood: 'with', servings: 40 })).text, /^Test powder: time 11:00 AM, with food, 40 servings left\./);
  const p = store.getRecord('supplements', 'supp.powder').data;
  assert.deepEqual([p.time, p.withFood, p.stock.servings], ['11:00', 'with', 40]);
  assert.match((await call('supplement_setup', { supplement: 'powder', time: '' })).text, /no set time/);
  assert.equal(store.getRecord('supplements', 'supp.powder').data.time, null);
  assert.match((await call('supplement_setup', { supplement: 'zinc', time: '09:00' })).text, /isn't on his list/);
  assert.match((await call('supplement_setup', { supplement: 'powder' })).text, /^Nothing to change/);
});

test('tendons: the coach gets the real length of a round, and a late morning round is called late', async () => {
  const early = (await call('tendons')).text;
  assert.match(early, /A round of 3 × 30 s takes 6:15 on his hold timer: 15 s GET READY before each hold, 2:00 rest between holds/);
  assert.doesNotMatch(early, /is late/, '3:00 AM: the morning round is not due yet');
  clock = Date.UTC(2026, 0, 20, 17, 27);
  const late = (await call('tendons')).text;
  assert.match(late, /The morning round \(Knees, due 7:30 AM\) is late: call it late, not "morning"\. One round now, the evening one at 7:30 PM; not back to back\./);
});

test('walk (Tue 10/20): "in an hour" sets the time and says it back; going, done, not now', async () => {
  const plan = await call('walk', { action: 'plan', inMinutes: 60, said: "I'll go in an hour" });
  assert.match(plan.text, /^Walk set for 4:00 AM\. No walk questions until then; .*Tell him so: "Okay, I'll message you at 4:00 AM\."/);
  let w = list('walks')[0];
  assert.equal(w.plan.at, NOW + 3600000);
  assert.equal(w.plan.said, "I'll go in an hour");
  await call('walk', { action: 'going' });
  w = list('walks')[0];
  assert.equal(w.plan, null);
  assert.equal(w.going.at, NOW);
  await call('walk', { action: 'done', minutes: 35 });
  w = list('walks')[0];
  assert.deepEqual([w.going, w.walks[0].minutes], [null, 35]);
  const skip = await call('walk', { action: 'skip', reason: 'raining', askAgainInMinutes: 90 });
  assert.match(skip.text, /^Not now \(raining\): asked again at 4:30 AM\./);
  assert.match((await call('walk', { action: 'plan' })).text, /needs inMinutes or a time/, 'a plan needs a time');
});

test('human coach (Wed 10/21): fast, hold_off, neck_plan, sauna later and the doctor answer', async () => {
  const f = await call('fast', { action: 'start', said: 'Today I fast' });
  assert.match(f.text, /^Tuesday 1\/20 is a fasting day: no cooking, meal-time, food or supplement prompts; skipped \(fasting\): powder, caps\./);
  assert.equal(list('days').find((d) => d.date === '2026-01-20').fast.said, 'Today I fast');
  assert.deepEqual(list('supp-log').map((e) => [e.status, e.reason]), [['skipped', 'fasting'], ['skipped', 'fasting']]);
  assert.match((await call('fast', { action: 'end' })).text, /^Fast ended at 3:00 AM/);
  const h = await call('hold_off', { areas: ['walk', 'sauna'], untilTime: '18:00', reason: 'wedding' });
  assert.match(h.text, /^Holding off walk, sauna until Tuesday 1\/20 6:00 PM \(wedding\)/);
  const hold = list('coach-holds')[0];
  assert.match((await call('hold_off', { cancel: hold.id })).text, /^Hold lifted/);
  assert.match((await call('hold_off', { areas: ['nothing'] })).text, /^Which areas\?/);
  assert.match((await call('neck_plan', { place: 'after-pull', reason: 'Pull is shorter' })).text, /^Neck goes after pull from now on; Train offers it on those days\. Where \(gym or home\) is not decided: ask him\./);
  assert.match((await call('neck_plan', { place: 'rest-day', where: 'home', homeGear: 'water bottles' })).text, /Where: home\. At home \(no plates\): a 1 L water bottle filled to 900 ml \(0\.9 kg\)/);
  assert.equal(list('schedule').find((x) => x.place)?.where, 'home');
  await call('neck_plan', { place: 'after-pull', where: 'gym' });
  assert.equal(list('schedule').find((x) => x.place)?.place, 'after-pull');
  assert.match((await call('sauna_plan', { action: 'later', days: 7 })).text, /^No sauna planning questions until Tuesday 1\/27\./);
  assert.match((await call('sauna_plan', { action: 'doctor', answer: 'not-yet' })).text, /^Recorded his answer to the doctor question: not-yet\./);
  assert.equal(list('sauna-plan')[0].doctor[0].context, 'first');
});

test('tendon_phase (Wed 10/21): knees from heal to fix on his answer; the wall squat gets rest days, the cycle is logged', async () => {
  store.writeLocal('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Leg Extension (Machine)', timing: ['after Legs'], where: 'gym' }, { exercise: 'Toes Wall Squat Hold', when: 'the second session on Legs days; both sessions on every other day', where: 'home' }] });
  const r = await call('tendon_phase', { area: 'knees', phase: 'fix', pain: 0, reason: 'random pain gone' });
  assert.match(r.text, /^Knees: Fix phase: 3-4 times a week for 4-8 weeks, from Tuesday 1\/20\. Holds: Leg Extension \(Machine\) after Legs; Toes Wall Squat Hold rest days\./);
  const k = store.getRecord('tendons', 'area.knees').data;
  assert.deepEqual([k.phase, k.phaseSince, k.phaseLog.at(-1).from, k.phaseLog.at(-1).pain], ['fix', '2026-01-20', 'heal', 0]);
  assert.match((await call('tendon_phase', { area: 'elbows', phase: 'fix' })).text, /^Which area/);
});
