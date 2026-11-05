// Thu 11/5, his words: "Why am I being asked if I did the evote scan today here in the homepage when I clearly told you
// earlier that I'm not gonna do the evote scan for a bit because it's kind of pointless right now" and "the entire app,
// features like this, see if something doesn't update accordingly instantly". He paused scans at 6:06 AM (a scan
// hold-off till Friday); at 7:50 AM Today still said "Evolt scan not logged today: did you do it?" with Log the scan,
// the today tool "Body scan: every training day; next Friday", and the context "weigh-in not logged (Evolt at the gym
// before training...)". While a scan hold-off runs: no scan ask, no next date, no Evolt prompt anywhere. Made-up data.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanHold, heldOff } from '../app/js/lib/holdoffs.js';
import { remindersFor, reminderState, afterGym } from '../app/js/lib/reminders.js';
import { nudgeCandidates, sessionOpenText } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { contextLine, todayText, READ_TOOLS } from '../server/coach/tools-read.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-19';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const pause = (extra = {}) => ({ id: 'hold-scan', areas: ['scan'], at: at('06:06'), until: at('00:00', '2026-04-03'), reason: 'Scans pointless for a bit', by: 'coach', ...extra });

test('scanHold: only a running hold on scans; an "all" hold mutes notifications but does not pause the plan', () => {
  assert.equal(scanHold([pause()], at('07:50'))?.id, 'hold-scan');
  assert.equal(scanHold([pause({ from: at('06:06') })], at('05:00')), null, 'a pause that starts later');
  assert.equal(scanHold([pause()], at('00:00', '2026-04-03')), null, 'pause over');
  assert.equal(scanHold([pause({ cancelledAt: at('07:00') })], at('07:50')), null, 'he turned them back on');
  assert.equal(scanHold([{ id: 'a', areas: ['all'], until: at('09:00') }], at('07:50')), null);
  assert.equal(heldOff('evolt', [pause()], at('07:50')), true);
});

const tendons = [{ kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', timing: ['rest days'] }] }];
const legs = { id: 'w', kind: 'workout', status: 'done', dayType: 'legs', routineId: 'legs', startedAt: at('04:35'), endedAt: at('05:22'), exercises: [{ key: 'a', name: 'Leg Press' }] };
const sets = [{ sessionId: 'w', exKey: 'a', done: true }];
const settings = { fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }] } };
const scanPlan = { id: 'main', cadence: 'training' };
const day = (coachHolds = []) => { const st = reminderState({ sessions: [legs], sets, tendons, settings, scanPlan, coachHolds }, TZ); return { st, list: remindersFor({ date: D, ...st }) }; };

test('after the gym while paused: no "Evolt scan?" and "head home" does not wait 11 minutes for a scan', () => {
  const on = day();
  assert.ok(on.list.some((r) => r.id === `scan-after:${D}`), 'control: scans on, the after-gym ask is there');
  const off = day([pause({ at: at('04:00') })]);
  assert.ok(!off.list.some((r) => r.kind === 'scan'), 'no scan reminder of any kind');
  const agOn = afterGym({ date: D, ...on.st });
  const agOff = afterGym({ date: D, ...off.st });
  assert.equal(agOff.scanAskAt, null);
  assert.equal(agOn.homeAt - agOff.homeAt, 11 * 60000);
  // His pause, said at 6:06 AM after a 5:22 AM workout: today's ask is gone too, the moment he says it.
  assert.equal(afterGym({ date: D, ...day([pause()]).st }).scanAskAt, null);
});

test('the phone\'s backup reminders and the Mac\'s day plan: no scan reminder on a day inside the pause, back after it', () => {
  const st = reminderState({ sessions: [legs], sets, tendons, settings, scanPlan: { id: 'main', cadence: 'training' }, coachHolds: [pause({ at: at('04:00') })],
    days: [{ id: '2026-03-20', date: '2026-03-20', sessionTime: '05:00' }, { id: '2026-04-04', date: '2026-04-04', sessionTime: '05:00' }] }, TZ);
  const inPause = remindersFor({ ...st, date: '2026-03-20' }).filter((r) => r.kind === 'scan');
  assert.deepEqual(inPause, []);
});

const base = { tz: TZ, rot: { today: { kind: 'train', dayType: 'legs' } }, session: { started: false, done: false }, weighedToday: false, sleepLogged: true, wakeHm: '04:00', bedHm: '20:00' };

test('nudges while paused: no "Evolt first", no scan checklist, no "Evolt number from today?"', () => {
  const texts = (o) => nudgeCandidates({ ...base, ...o });
  const due = { now: at('06:40'), sessionHm: '06:00' };
  const soon = { now: at('05:15'), sessionHm: '06:00' };
  assert.match(texts(due).find((c) => c.key === 'session').text, /Evolt first/, 'control');
  for (const o of [due, soon]) {
    const c = texts({ ...o, scanPaused: true });
    assert.ok(c.some((x) => x.key === 'session'), 'the session nudge itself stays');
    assert.ok(c.every((x) => !/Evolt|scan/i.test(x.text)), c.map((x) => x.text).join(' | '));
  }
  const scanToday = { items: ['Bathroom first', 'No food'] };
  assert.ok(texts({ now: at('04:30'), scanToday }).some((c) => c.key === 'scan'), 'control: the scan checklist');
  assert.ok(!texts({ now: at('04:30'), scanToday, scanPaused: true }).some((c) => c.key === 'scan'));
  const after = { now: at('06:00'), session: { started: true, done: true }, rot: { today: { kind: 'done', dayType: 'legs' } }, workoutEndedAt: at('05:22') };
  assert.ok(texts(after).some((c) => c.key === 'evolt'), 'control: the Evolt number ask');
  assert.ok(!texts({ ...after, scanPaused: true }).some((c) => c.key === 'evolt'));
  assert.ok(!/Evolt/.test(sessionOpenText(0, 'Legs', null, true)));
  assert.match(sessionOpenText(0, 'Legs', null), /Evolt first/);
  const morning = { text: 'Banana, bathroom. Coffee about 90 minutes after waking (after the Evolt on gym days)' };
  const m = (o) => nudgeCandidates({ ...base, now: at('04:20'), wokeAt: at('04:00'), morning, ...o }).find((c) => c.key === 'morning')?.text;
  assert.match(m({}) || '', /Evolt/, 'control: his own morning words');
  assert.ok(m({ scanPaused: true }) && !/Evolt/.test(m({ scanPaused: true })), m({ scanPaused: true }));
});

let dir; let store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-scanpause-')); store = openStore(join(dir, 'db.sqlite')); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test('the coach while paused: no next scan date, no Evolt weigh-in prompt, in the today tool, the context and body_scans', async () => {
  const NOW = at('07:55');
  store.writeLocal('scan-plan', 'main', { id: 'main', cadence: 'training', safety: { readAt: at('06:00', '2026-03-01') } });
  const ctx = () => contextLine({ store, tz: TZ, now: NOW });
  const today = () => todayText(snapshot(store, { tz: TZ, now: NOW }));
  const scansTool = READ_TOOLS.find((t) => t.name === 'body_scans');
  const scansText = async () => (await scansTool.run({}, { store, tz: TZ, now: () => NOW })).text;
  assert.match(today(), /Body scan: every training day/, 'control');
  assert.match(ctx(), /Evolt at the gym before training/, 'control');
  store.writeLocal('coach-holds', 'hold-scan', pause());
  for (const text of [today(), ctx(), await scansText()]) assert.doesNotMatch(text, /Body scan: every training day|Next scan:|Evolt at the gym before training/);
  for (const text of [today(), await scansText()]) assert.match(text, /Body scans PAUSED by him until Friday 4\/3 12:00 AM .*never ask about, remind him of or plan an Evolt scan/);
  assert.match(ctx(), /weigh-in not logged \(Evolt scans paused by him: don't ask for one\)/);
  // He turns them back on: the plan comes back at once.
  store.writeLocal('coach-holds', 'hold-scan', pause({ cancelledAt: at('07:56') }));
  assert.match(today(), /Body scan: every training day/);
  assert.match(RULES, /paused scans/);
});

test('the workout Finish screen asks about the Evolt only while scans are not paused', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/js/views/finish.js', import.meta.url), 'utf8');
  const ask = src.slice(src.indexOf('const scanAsk ='), src.indexOf('const changed ='));
  assert.match(ask, /!scanHold\(await repo\.list\('coach-holds'\)\)/);
});
