// Thu 11/5, his words: "And I am walking right now. If the app's not updating, that's not my problem" and "Why did I get
// a message at home: gym done, get settled, food is next? I finished the gym God knows how long ago... obviously you know
// I'm on a walk right now". Legs ended 5:22 AM with the leg extension hold skipped ("Ill do at home") and the cupping
// round never started; the app held the gym open 40 minutes: "Evolt scan? Do it before you leave the gym" at 6:03 AM,
// "Head home. Gym done. Get settled, food is next." at 6:18 AM (first meal 12:30 PM). The walk ask at 5:42 AM went out
// with 972 steps; at 6:02 AM, with 2,189, the check-in still asked "When are you going?".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remindersFor, reminderState, afterGym, leftGymAt, AFTER_GYM } from '../app/js/lib/reminders.js';
import { walkDue, withAsk, withAnswer, walkLines } from '../app/js/lib/walks.js';
import { openStore } from '../server/store.mjs';
import { stepReadingsOf } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-19';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const tendons = [
  { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Leg Extension (Machine)', when: 'after Legs' }, { exercise: 'Toes Wall Squat Hold', timing: ['rest days'] }] },
  { kind: 'area', id: 'wrist', label: 'Wrist', phase: 'fix', holds: [{ exercise: 'Cupping', timing: ['after Pull', 'after Legs'] }] },
];
const settings = { fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }, { name: 'Last meal', time: '16:30', latest: '17:00', cookMin: 30 }] } };
const scanPlan = { id: 'main', cadence: 'training' };
const legs = (skips = ['Leg Extension Hold (Machine)']) => ({
  id: 'w', kind: 'workout', status: 'done', dayType: 'legs', routineId: 'legs-gbi', startedAt: at('04:35'), endedAt: at('05:22'),
  exercises: [{ key: 'a', name: 'Leg Extension (Machine)', exerciseId: 'leg-extension-machine' }, ...skips.map((n, i) => ({ key: `s${i}`, name: n, skipped: { at: at('05:18'), reason: 'Ill do at home' } }))],
});
const sets = [{ sessionId: 'w', exKey: 'a', done: true }];
const of = (extra = {}) => { const st = reminderState({ sessions: [legs()], sets, tendons, settings, scanPlan, ...extra }, TZ); return remindersFor({ date: D, ...st }); };
const pick = (list, id) => list.find((r) => r.id === id);

test('his Legs morning: the scan ask and "head home" right after the workout, never 41 and 56 minutes later', () => {
  const r = of();
  const ask = pick(r, `scan-after:${D}`);
  const home = pick(r, `home:${D}`);
  // Hold skipped in the workout: not waited for; cupping never started: the gym is done 10 minutes after the end.
  assert.equal(ask.at, at('05:33'));
  assert.ok(ask.due);
  assert.equal(home.at, at('05:48'));
  assert.equal(home.body, 'Gym done. Get settled.', 'first meal 12:30 PM: no "food is next" hours ahead');
  assert.ok(!r.some((i) => i.due && /food is next/.test(i.body)));
});

test('his steps climbing after the workout (972 at 5:09 AM, 2,189 at 5:42 AM): no "head home" once he left', () => {
  const stepReadings = { [D]: [{ steps: 972, at: at('05:09') }, { steps: 2189, at: at('05:42') }] };
  const r = of({ stepReadings });
  assert.equal(pick(r, `scan-after:${D}`).due, true, '5:33 AM, before the steps showed him gone');
  assert.equal(pick(r, `home:${D}`).due, false, 'walking at 5:42 AM: no "head home" at 5:48 AM');
  // A few steps around the gym don't count.
  assert.equal(pick(of({ stepReadings: { [D]: [{ steps: 972, at: at('05:09') }, { steps: 1300, at: at('05:42') }] } }), `home:${D}`).due, true);
  // Walking already logged (the coach's walk tool), or a meal: neither ask.
  const walking = of({ walks: [{ date: D, going: { at: at('05:30') }, walks: [], asks: [] }] });
  assert.equal(pick(walking, `scan-after:${D}`).due, false, 'walking from 5:30 AM: no 5:33 AM "before you leave the gym"');
  assert.equal(pick(walking, `home:${D}`).due, false);
  const later = of({ walks: [{ date: D, going: { at: at('05:40') }, walks: [], asks: [] }] });
  assert.equal(pick(later, `scan-after:${D}`).due, true, 'still at the gym at 5:33 AM');
  assert.equal(pick(later, `home:${D}`).due, false, 'walking from 5:40 AM');
  const ate = of({ meals: [{ id: 'm', date: D, at: at('05:30') }] });
  assert.equal(pick(ate, `scan-after:${D}`).due, false, 'home and eating: no scan ask');
});

test('the holds he does at the gym after the workout still come first; "food is next" when a meal is close', () => {
  // The cupping round started 5:30 AM, saved 5:40 AM: the ask at 5:41 AM, as on Thu 10/22.
  const holds = { id: 'h', kind: 'holds', area: 'wrist', status: 'done', startedAt: at('05:30'), endedAt: at('05:40'), exercises: [{ key: 'c', name: 'Cupping' }] };
  const r = of({ sessions: [legs(), holds] });
  assert.equal(pick(r, `scan-after:${D}`).at, at('05:41'));
  // A round started and still going: wait for it, 40 minutes at most.
  const going = { ...holds, status: 'active', endedAt: null };
  assert.equal(pick(of({ sessions: [legs(), going] }), `scan-after:${D}`).at, at('06:03'));
  // The knee hold not skipped and nothing started: 10 minutes, not 40.
  assert.equal(afterGym({ date: D, activity: reminderState({ sessions: [legs([])], sets, tendons, scanPlan }, TZ).activity, areas: tendons, rounds: {}, scanPlan }).doneAt, at('05:22') + AFTER_GYM.holdsStartMin * 60000);
  // A late workout: the first meal soon after the gym: "food is next" stays.
  const late = { ...legs(), startedAt: at('10:30'), endedAt: at('11:40') };
  const lr = remindersFor({ date: D, ...reminderState({ sessions: [late], sets, tendons, settings, scanPlan }, TZ) });
  assert.equal(pick(lr, `home:${D}`).body, 'Gym done. Get settled, food is next.');
});

test('leftGymAt: the first sign after the end; nothing before the end counts', () => {
  const end = at('05:22');
  assert.equal(leftGymAt({ end }), Infinity);
  assert.equal(leftGymAt({ end, steps: [{ steps: 2189, at: at('05:42') }] }), Infinity, 'one reading, nothing to compare with');
  assert.equal(leftGymAt({ end, steps: [{ steps: 1200, at: at('05:30') }, { steps: 1800, at: at('05:50') }] }), at('05:50'), 'no reading in the gym: the first after it is the base');
  assert.equal(leftGymAt({ end, start: at('04:30'), steps: [{ steps: 100, at: at('04:00') }, { steps: 900, at: at('05:25') }] }), Infinity, 'gym steps since a reading before the workout');
  assert.equal(leftGymAt({ end, start: at('04:30'), steps: [{ steps: 100, at: at('04:00') }, { steps: 900, at: at('05:25') }, { steps: 1500, at: at('05:40') }] }), at('05:40'));
  assert.equal(leftGymAt({ end, steps: [{ steps: 100, at: at('04:00') }, { steps: 972, at: at('05:09') }] }), Infinity, 'steps in the gym');
  assert.equal(leftGymAt({ end, walk: { going: { at: at('05:00') } } }), Infinity, 'a walk before the workout');
  assert.equal(leftGymAt({ end, steps: [{ steps: 972, at: at('05:09') }, { steps: 2189, at: at('05:42') }], mealChecks: [{ at: at('05:35') }] }), at('05:35'));
});

test('the Mac reads every step count the phone sent today from the record history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'left-gym-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('health', D, { id: D, date: D, steps: 972, fileAt: at('05:09') });
    store.writeLocal('health', D, { id: D, date: D, steps: 2189, fileAt: at('05:42') });
    assert.deepEqual(stepReadingsOf(store)[D], [{ steps: 972, at: at('05:09') }, { steps: 2189, at: at('05:42') }]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('walk: steps up since the ask: one "Out walking?" instead of "When are you going?", then quiet', () => {
  const base = { tz: TZ, goal: 8000, wakeHm: '04:00', bedHm: '20:00' };
  let doc = withAsk(null, D, 'ask', at('05:42'), { steps: 972, asOf: at('05:09') });
  assert.equal(doc.asks[0].steps, 972, 'the ask keeps the count it was sent with');
  const due = (hm, steps, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: { steps, asOf: at(steps === 972 ? '05:09' : '05:42') }, ...o });
  assert.deepEqual(due('06:02', 2189), { kind: 'out', text: 'Out walking? 2,189 steps as of 5:42 AM, up 1,217 since I asked.' });
  assert.equal(due('06:02', 972).kind, 'check', 'no new steps: the usual check-in');
  assert.equal(due('06:02', 1300).kind, 'check', 'a few hundred steps: not a walk');
  doc = withAsk(doc, D, 'out', at('06:02'), { steps: 2189 });
  for (const hm of ['06:45', '07:45', '09:00', '12:00']) assert.equal(due(hm, 2189), null, `${hm}: no more "when are you going?"`);
  assert.ok(!walkLines([doc], { today: D, now: at('06:10'), tz: TZ }).join(' ').includes('get a time from him'), 'the coach is told not to chase a time');
  // He answered with no time, then his steps climbed: "Out walking?", not "No time set yet. When are you going?"
  let d2 = withAsk(null, D, 'ask', at('05:42'), { steps: 972 });
  d2 = withAnswer(d2, D, { action: 'none' }, at('05:50'));
  assert.equal(walkDue({ ...base, now: at('06:25'), doc: d2, steps: { steps: 3000, asOf: at('06:20') } }).kind, 'out');
  assert.equal(walkDue({ ...base, now: at('06:25'), doc: d2, steps: { steps: 1000, asOf: at('06:20') } }).kind, 'ask');
  // His own time came, no answer, steps climbing: "Out walking?" in place of "Out yet? Going now, or a new time?".
  let d3 = withAnswer(withAsk(null, D, 'ask', at('05:00'), { steps: 500 }), D, { action: 'plan', at: at('06:00'), said: '6' }, at('05:05'));
  d3 = withAsk(d3, D, 'plan', at('06:00'), { steps: 600 });
  assert.equal(walkDue({ ...base, now: at('06:20'), doc: d3, steps: { steps: 2600, asOf: at('06:18') } }).kind, 'out');
  // Older records (asks with no count): as before.
  const old = withAsk(null, D, 'ask', at('05:42'));
  assert.equal(walkDue({ ...base, now: at('06:02'), doc: old, steps: { steps: 2189, asOf: at('05:42') } }).kind, 'check');
});
