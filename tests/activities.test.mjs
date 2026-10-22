// Thu 10/22: leg flexibility for high kicks and boxing / kickboxing, with smart reminders and the coach's plan tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityReminders, activityDays } from '../app/js/lib/activities.js';
import { remindersFor, reminderState } from '../app/js/lib/reminders.js';
import { itemHeld } from '../app/js/lib/holdoffs.js';
import { LIBRARY } from '../app/js/data/exercise-library.js';
import { openStore } from '../server/store.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { contextLine } from '../server/coach/tools-read.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-22'; // a Sunday
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const none = { flex: new Set(), combat: new Set(), workoutEnd: {} };

test('flexibility: 10 minutes after a workout ends, else his evening time; nothing once done; the kick test on its day', () => {
  const flex = { when: 'after-workout', hm: '20:00', testWeekday: 0 };
  const after = activityReminders({ date: D, tz: TZ, flex, done: { ...none, workoutEnd: { [D]: at('11:30') } } });
  assert.equal(after[0].at, at('11:40'));
  assert.match(after[0].body, /^Muscles are warm\. Flexibility · Legs, about 15 minutes/);
  assert.equal(activityReminders({ date: D, tz: TZ, flex, done: none })[0].at, at('20:00'), 'a day without a workout: his time');
  assert.equal(activityReminders({ date: D, tz: TZ, flex, done: { ...none, flex: new Set([D]) } })[0].due, false, 'done today');
  const test1 = activityReminders({ date: D, tz: TZ, flex, done: none, tests: ['2026-03-15'] }).find((r) => r.id.startsWith('flex-test'));
  assert.equal(test1.at, at('20:30'));
  assert.ok(test1.body.length <= 150);
  assert.equal(activityReminders({ date: D, tz: TZ, flex, done: none, tests: ['2026-03-20'] }).some((r) => r.id.startsWith('flex-test')), false, 'tested this week');
  assert.equal(activityReminders({ date: '2026-03-23', tz: TZ, flex, done: none }).some((r) => r.id.startsWith('flex-test')), false, 'not his test day');
});

test('classes: 90 minutes before, "how was it?" 30 minutes after unless logged; a one-off trial; held off with "combat"', () => {
  const combat = { discipline: 'boxing', gym: 'The King 2', days: [2, 4], hm: '19:00', durationMin: 60, trial: '2026-03-22' };
  const r = activityReminders({ date: D, tz: TZ, combat, done: none });
  assert.deepEqual(r.map((x) => [x.id, x.at]), [[`combat:${D}`, at('17:30')], [`combat-after:${D}`, at('20:30')]]);
  assert.equal(r[0].title, 'Boxing at 7:00 PM');
  assert.equal(r[0].body, 'Your trial class, The King 2. Wraps and water.');
  assert.equal(activityReminders({ date: D, tz: TZ, combat, done: { ...none, combat: new Set([D]) } })[1].due, false);
  assert.equal(activityReminders({ date: '2026-03-23', tz: TZ, combat, done: none }).length, 0, 'Monday: no class');
  assert.equal(activityReminders({ date: '2026-03-24', tz: TZ, combat, done: none })[0].body, 'Boxing today, The King 2. Wraps and water.');
  const holds = [{ id: 'h', areas: ['combat'], until: at('23:00'), at: at('08:00') }];
  assert.equal(itemHeld(r[0], holds, at('12:00')), true);
  assert.equal(itemHeld({ id: `flex:${D}`, kind: 'flex' }, [{ id: 'h2', areas: ['flex'], until: at('23:00'), at: at('08:00') }], at('12:00')), true);
});

test('what he did, from his sessions; the planner and its switches; the new exercises are in the library', () => {
  const sessions = [
    { id: 'w', status: 'done', startedAt: at('10:16'), endedAt: at('11:30'), routineId: 'legs-gbi', exercises: [{ key: 'a', exerciseId: 'squat-smith-machine' }] },
    { id: 'f', status: 'done', startedAt: at('11:45'), endedAt: at('12:00'), routineId: 'flex-legs', exercises: [{ key: 'b', exerciseId: 'butterfly-stretch' }] },
    { id: 'c', status: 'done', startedAt: at('19:00'), endedAt: at('20:00'), routineId: null, exercises: [{ key: 'c', exerciseId: 'boxing-class' }] },
  ];
  const sets = [{ sessionId: 'w', exKey: 'a', done: true }, { sessionId: 'f', exKey: 'b', done: true }, { sessionId: 'c', exKey: 'c', done: true }];
  const done = activityDays({ sessions, sets, tz: TZ });
  assert.deepEqual([[...done.flex], [...done.combat], done.workoutEnd[D]], [[D], [D], at('11:30')]);
  const st = reminderState({ sessions, sets, flexPlan: { when: 'after-workout', hm: '20:00' }, combatPlan: null, coachNotes: [{ topic: 'flexibility', date: '2026-03-20', at: at('12:00', '2026-03-20') }] }, TZ);
  const items = remindersFor({ date: D, ...st }).filter((x) => x.kind === 'flex');
  assert.deepEqual(items.map((x) => [x.id, x.due]), [[`flex:${D}`, false]]);
  assert.equal(remindersFor({ date: D, ...st, settings: { notify: { kinds: { flex: false } } } }).some((x) => x.kind === 'flex'), false);
  for (const id of ['leg-extension-hold-machine', 'cupping-hold', 'butterfly-stretch', 'standing-front-leg-raise-hold', 'boxing-class', 'kickboxing-class', 'muay-thai-class']) assert.ok(LIBRARY.some((e) => e.id === id), id);
  assert.equal(LIBRARY.find((e) => e.id === 'butterfly-stretch').primary, 'other', 'stretches never count as training sets for a muscle');
});

test('the coach sets the plans he agreed and logs a class he tells it about', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-act-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    const clock = at('21:10');
    const ctx = { store, tz: TZ, now: () => clock, action: () => {} };
    const tool = WRITE_TOOLS.find((t) => t.name === 'activity_plan');
    assert.match((await tool.run({ what: 'flex', when: 'after-workout', time: '21:00', testDay: 'sunday' }, ctx)).text, /^Flexibility · Legs \(routine flex-legs\): a reminder 10 minutes after each workout ends, and at 9:00 PM on days without one, never once it's done that day\. Kick test reminder on Sundays\./);
    assert.match((await tool.run({ what: 'combat', discipline: 'boxing', gym: 'The King 2', days: ['tuesday', 'thursday'], time: '19:00', trialDate: '2026-03-24' }, ctx)).text, /^Boxing at The King 2, 7:00 PM on Tuesday, Thursday; trial Tuesday 3\/24: a reminder 90 minutes before each class/);
    const logged = await tool.run({ what: 'log_class', minutes: 60, note: 'first trial' }, ctx);
    assert.match(logged.text, /^Logged: Boxing, 60 min, Sunday 3\/22 \(first trial\)/);
    const s = store.listRecords('sessions').map((r) => r.data)[0];
    assert.deepEqual([s.status, s.title, s.exercises[0].exerciseId, s.endedAt - s.startedAt], ['done', 'Boxing', 'boxing-class', 3600000]);
    const line = contextLine({ store, tz: TZ, now: clock });
    assert.match(line, /Flexibility plan: after each workout \(else 9:00 PM\); last done never; last kick test none yet\./);
    assert.match(line, /Classes: Boxing at The King 2, tue\/thu at 7:00 PM, trial Tuesday 3\/24; last class Sunday 3\/22\./);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Evolt missed before the workout: asked 10 minutes after it ends, unless a scan is saved (Thu 10/22)', () => {
  const sessions = [{ id: 'w', status: 'done', dayType: 'legs', startedAt: at('10:16'), endedAt: at('11:40'), routineId: 'legs-gbi', exercises: [{ key: 'a', exerciseId: 'squat-smith-machine' }] }];
  const sets = [{ sessionId: 'w', exKey: 'a', done: true }];
  const st = reminderState({ sessions, sets, scanPlan: { id: 'main', cadence: 'training' } }, TZ);
  const ask = remindersFor({ date: D, ...st }).find((r) => r.id === `scan-after:${D}`);
  assert.equal(ask.at, at('11:50'));
  assert.equal(ask.url, '#/body/scan');
  assert.match(ask.body, /^Did you do the Evolt scan today\? If yes, add the results/);
  const done = reminderState({ sessions, sets, scanPlan: { id: 'main', cadence: 'training' }, scans: [{ date: D, status: 'done' }] }, TZ);
  assert.equal(remindersFor({ date: D, ...done }).some((r) => r.id === `scan-after:${D}`), false);
});
