// Thu 11/5, his words: "Also dive even deeper figure out more stuff regarding missing features". Four of the sixteen:
// the morning routine checklist, the clinic summary, the Mac-unreachable banner (and the Evolt photo read, which was
// already there: scan-vision.test.mjs). Made-up data only.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { EXTRA_TOOLS } from '../server/coach/tools-extra.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { itemsFromText, morningItems, itemsFromLines, morningState, withMorningTick, findItem } from '../app/js/lib/morning.js';
import { clinicSummary } from '../app/js/lib/clinic.js';
import { downSinceNext, reachWarning, WARN_AFTER_MS } from '../app/js/lib/mac-reach.js';
import { screenById, screenOf } from '../app/js/lib/screens.js';

const ROUTINE = 'Banana, bathroom, then stretch and get some sunlight. Coffee about 90 minutes after waking (after the scan on gym days)';

test('morning: items from his routine text, brackets kept with their item; his own list wins; ticks per day', () => {
  assert.deepEqual(itemsFromText(ROUTINE), ['Banana', 'Bathroom', 'Stretch', 'Get some sunlight', 'Coffee about 90 minutes after waking (after the scan on gym days)']);
  assert.deepEqual(morningItems({ text: ROUTINE, items: ['Water', 'Walk'] }), ['Water', 'Walk']);
  assert.deepEqual(morningItems({ text: ROUTINE, items: [] }), [], 'an emptied list means no checklist');
  assert.deepEqual(morningItems(null), []);
  assert.deepEqual(itemsFromLines('- Water\n\n2. Walk\nWater\n'), ['Water', 'Walk']);
  const items = morningItems({ text: ROUTINE });
  let day = withMorningTick({ date: '2026-01-20', sessionTime: '04:15' }, '2026-01-20', 'Banana', true, 1000);
  day = withMorningTick(day, '2026-01-20', 'Banana', true, 2000);
  assert.equal(day.morning.ticks.Banana, 1000, 'ticked twice keeps the first time');
  assert.equal(day.sessionTime, '04:15', 'the rest of the day stays');
  assert.deepEqual(morningState(items, day).filter((x) => x.at).map((x) => x.item), ['Banana']);
  assert.deepEqual(withMorningTick(day, '2026-01-20', 'Banana', false).morning.ticks, {});
  assert.equal(findItem(items, '4'), 'Get some sunlight');
  assert.equal(findItem(items, 'sunlight'), 'Get some sunlight');
  assert.equal(findItem(items, 'coffee'), items[4]);
  assert.equal(findItem(items, 'b'), null, 'two items match: none');
});

test('mac banner: only after 2 minutes unreachable, only when the phone is online and paired; gone when it answers', () => {
  let down = downSinceNext(null, null, 0);
  assert.equal(down, null);
  down = downSinceNext(down, false, 1000);
  assert.equal(down, 1000);
  down = downSinceNext(down, false, 50000);
  assert.equal(down, 1000, 'kept while it stays down');
  assert.equal(reachWarning({ paired: true, online: true, downSince: down, now: 1000 + WARN_AFTER_MS - 1 }), null);
  const t = reachWarning({ paired: true, online: true, downSince: down, now: 1000 + 3 * 60000 });
  assert.match(t, /^Can't reach your Mac for 3 min, though this phone is online\. Most likely this phone's Tailscale dropped: open Tailscale, turn it off and on/);
  assert.match(t, /NextDNS/);
  assert.doesNotMatch(t, /notifications/i, 'notifications still come: they don\'t go through Tailscale');
  assert.doesNotMatch(t, /\d+\.\d+\.\d+\.\d+|ts\.net/, 'no addresses in the public code');
  assert.equal(reachWarning({ paired: true, online: false, downSince: down, now: 1e9 }), null, 'phone offline: not the Mac');
  assert.equal(reachWarning({ paired: false, online: true, downSince: down, now: 1e9 }), null);
  assert.equal(downSinceNext(down, true, 60000), null);
});

test('screens: the clinic summary opens from the coach and is named as the screen he is on', () => {
  assert.equal(screenById('clinic_summary').hash, '#/body/clinic');
  assert.equal(screenOf('#/body/clinic').id, 'clinic_summary');
  assert.equal(screenOf('#/body/recovery').id, 'recovery');
});

// ---- the clinic summary and the coach tools, on a store ----------------------------------------------------------

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 20, 3, 0); // Tuesday 1/20, 3:00 AM
const at = (iso, hm = '03:00') => Date.parse(`${iso}T${hm}:00Z`);
let dir; let store; let clock;
const w = (col, id, data) => store.writeLocal(col, id, data);
const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
const call = (name, args = {}) => EXTRA_TOOLS.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => clock, action: () => {} });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-misc-'));
  store = openStore(join(dir, 'db.sqlite'));
  clock = NOW;
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-01-02', push: '2026-01-03', legs: '2026-01-01' } });
  w('exercises', 'sq', { id: 'sq', name: 'Test Squat', capClass: 'main' });
  w('exercises', 'curl', { id: 'curl', name: 'Test Curl', capClass: 'light' });
  const sess = (id, date, ex, note = '') => w('sessions', id, { id, kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at(date), endedAt: at(date, '04:00'), pausedMs: 0, status: 'done', note, exercises: ex });
  sess('old', '2025-11-01', [{ key: 'a', name: 'Test Squat' }]);
  w('sets', 'o1', { id: 'o1', sessionId: 'old', exKey: 'a', order: 0, type: 'normal', kg: 100, reps: 5, done: true });
  sess('l1', '2026-01-01', [{ key: 'a', name: 'Test Squat', notes: '' }, { key: 'b', name: 'Test Curl' }]);
  w('sets', 'a1', { id: 'a1', sessionId: 'l1', exKey: 'a', order: 0, type: 'normal', kg: 40, reps: 8, done: true });
  w('sets', 'a2', { id: 'a2', sessionId: 'l1', exKey: 'a', order: 1, type: 'normal', kg: 42.5, reps: 8, done: true, note: 'Lower back pain on the last rep' });
  w('sets', 'b1', { id: 'b1', sessionId: 'l1', exKey: 'b', order: 0, type: 'normal', kg: 10, reps: 12, done: true, note: 'felt good, no pain' });
  sess('l2', '2026-01-15', [{ key: 'a', name: 'Test Squat', skipped: { at: 1, reason: 'Lower back sore on warm-up' } }, { key: 'b', name: 'Test Curl' }]);
  w('sets', 'b2', { id: 'b2', sessionId: 'l2', exKey: 'b', order: 0, type: 'normal', kg: 12, reps: 12, done: true });
  sess('l3', '2026-01-18', [{ key: 'a', name: 'Test Squat' }]);
  w('sets', 'c1', { id: 'c1', sessionId: 'l3', exKey: 'a', order: 0, type: 'normal', kg: 45, reps: 8, done: true });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Test Wall Hold', type: 'hold' }] });
  w('tendons', 'area.abs', { kind: 'area', id: 'abs', label: 'Abs', phase: 'none', holds: [] });
  w('sessions', 'h1', { id: 'h1', kind: 'holds', title: 'Knee holds', startedAt: at('2026-01-19'), endedAt: at('2026-01-19', '03:10'), status: 'done', exercises: [{ key: 'h', name: 'Test Wall Hold', type: 'duration' }] });
  w('sets', 'h1s', { id: 'h1s', sessionId: 'h1', exKey: 'h', order: 0, type: 'hold', durationS: 30, done: true });
  w('body-scans', 'scan.2026-01-02', { id: 'scan.2026-01-02', date: '2026-01-02', status: 'done', metrics: [{ key: 'weightKg', label: 'Weight', value: 76, unit: 'kg' }, { key: 'fatPercent', label: 'Body fat', value: 15, unit: '%' }] });
  w('body-scans', 'scan.2026-01-16', { id: 'scan.2026-01-16', date: '2026-01-16', status: 'done', metrics: [{ key: 'weightKg', label: 'Weight', value: 75.2, unit: 'kg' }, { key: 'fatPercent', label: 'Body fat', value: 14.1, unit: '%' }] });
  w('recovery', 'main', { title: 'Test recovery', since: '2025-12-01', until: '2026-05-01', checkIn: { from: '2025-12-08', everyDays: 7, questions: [{ key: 't', label: 'Tenderness', choices: ['Gone', 'Less', 'Same'] }] } });
  w('coach-notes', 'recovery.2026-01-10', { id: 'recovery.2026-01-10', date: '2026-01-10', topic: 'recovery', text: 'x', answers: { t: 'Less' } });
  w('settings', 'main', { notify: { morning: { text: ROUTINE, gymAfterMin: [60, 90] } } });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const fromStore = () => {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  return clinicSummary({ today: '2026-01-20', tz: TZ, recPlan: one('recovery', 'main'), notes: list('coach-notes'), tendons: list('tendons'), sessions: list('sessions'), sets: list('sets'), exercises: list('exercises'), scans: list('body-scans'), comebackStart: '2026-01-01' });
};

test('clinic summary: his own records since the comeback, nothing added', () => {
  const c = fromStore();
  assert.equal(c.from, '2026-01-01');
  assert.equal(c.recovery.checkup, '2026-05-01');
  assert.deepEqual(c.recovery.checkIns, [{ date: '2026-01-10', answers: [{ label: 'Tenderness', value: 'Less' }] }]);
  assert.deepEqual(c.tendons, [{ label: 'Knees', phase: 'Heal', holds: ['Test Wall Hold'], rounds: 1, days: 1, of: 28 }], 'areas with no phase left out');
  assert.deepEqual(c.pain, [
    { date: '2026-01-01', exercise: 'Test Squat', text: 'Lower back pain on the last rep', skipped: false },
    { date: '2026-01-15', exercise: 'Test Squat', text: 'Lower back sore on warm-up', skipped: true },
  ], '"no pain" is not pain; before the comeback is left out');
  assert.deepEqual(c.lifts, [{ name: 'Test Squat', sessions: 2, first: { date: '2026-01-01', kg: 42.5, reps: 8 }, last: { date: '2026-01-18', kg: 45, reps: 8 }, changeKg: 2.5 }], 'main lifts only, from the comeback');
  assert.equal(c.scans.count, 2);
  assert.deepEqual(c.scans.rows[0], { label: 'Weight', unit: 'kg', first: 76, last: 75.2, change: -0.8 });
});

test('coach: clinic_summary reads the page; morning_checklist lists, ticks on his words and sets his items', async () => {
  const names = TOOLS.map((t) => t.name);
  for (const t of EXTRA_TOOLS) {
    assert.equal(names.filter((n) => n === t.name).length, 1, `${t.name} once in TOOLS`);
    assert.equal(t.inputSchema.additionalProperties, false);
    if (!t.annotations?.readOnlyHint) assert.match(t.description, /his words/);
  }
  const cs = await call('clinic_summary');
  assert.match(cs.text, /open_screen clinic_summary/);
  assert.match(cs.text, /Knees \(Heal\): 1 rounds on 1 of the last 28 days/);
  assert.match(cs.text, /Test Squat 42\.5 kg -> 45 kg/);
  assert.doesNotMatch(cs.text, /Test Curl/);

  assert.match((await call('morning_checklist', { action: 'list' })).text, /^1\. Banana: open\n2\. Bathroom: open/);
  const r = await call('morning_checklist', { action: 'tick', items: ['banana', 'sunlight'] });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Ticked: Banana; Get some sunlight \(Tuesday 1\/20\)\. Still open: Bathroom; Stretch; Coffee/);
  assert.equal(one('days', '2026-01-20').morning.ticks.Banana, NOW);
  assert.match((await call('morning_checklist', { action: 'list' })).text, /1\. Banana: done 3:00 AM/);
  const bad = await call('morning_checklist', { action: 'tick', items: ['meditate'] });
  assert.ok(!bad.wrote); assert.match(bad.text, /^Not on his checklist: meditate/);
  assert.match((await call('morning_checklist', { action: 'tick', items: ['1'], done: false })).text, /^Unticked: Banana/);
  assert.match((await call('morning_checklist', { action: 'tick', items: ['1'], date: '2026-01-21' })).text, /^Not a future date/);
  const set = await call('morning_checklist', { action: 'set', items: ['Water', ' Walk  outside '] });
  assert.equal(set.wrote, true);
  const st = one('settings', 'main');
  assert.deepEqual(st.notify.morning.items, ['Water', 'Walk outside']);
  assert.equal(st.notify.morning.text, ROUTINE, 'his routine text (the morning nudge) stays');
  assert.match((await call('morning_checklist', { action: 'list' })).text, /^1\. Water: open\n2\. Walk outside: open$/);
});
