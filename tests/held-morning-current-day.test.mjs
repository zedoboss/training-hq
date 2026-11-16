// Tue 11/17 (the nightly review; his words, about Mon 11/16 3:32 PM): three nights' morning texts were held and went out
// together a minute after he finished Upper A: one said "Today's a rest day ... Lower is Monday", the next "Lower is on
// today". Now a held morning text from a past day is dropped; only last night's goes out, and once a workout is logged
// today its sentences about what today's training is are dropped too.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { openNightly, freshDay, DIARY } from '../server/coach/nightly.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const MON = '2026-11-16';
const T = (hm) => at(MON, hm);
const FRI = 'Nothing from Friday is logged: no meals, knee rounds, Upper A or run. If you did any of it, tell me and I\'ll put it in.';
const SAT = 'Today\'s a rest day. Knees: no answer yet on Phase 2, so it stays Phase 1, twice a day, until you say. Another week, or Phase 2 now? Lower is Monday.';
const SUN = 'Sunday shows no meals, sleep or knee holds logged, just 11,420 steps. If you ate, tell me what and I\'ll add it. Lower is on today.';
let dir; let store; let sent;
const w = (col, id, data) => store.writeLocal(col, id, data);
const diary = (date, morning, fixes = []) => w(DIARY, date, { id: date, date, status: 'done', at: at(date, '23:30'), morning, fixes, facts: [] });
const workout = (id, from, to, extra = {}) => w('sessions', id, { id, dayType: 'upperA', title: 'Upper A', startedAt: T(from), endedAt: T(to), status: 'done', ...extra });
const nightly = (hm) => openNightly({ store, privateDir: dir, since: '2026-01-01', profile: () => '', tz: () => TZ, now: () => T(hm),
  push: { list: () => [{}], notify: async (x) => { sent.push(x); return { sent: 1 }; } }, run: async () => ({ text: '{}' }) });
const said = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.kind === 'nightly').sort((a, b) => a.at - b.at);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-heldday-'));
  store = openStore(join(dir, 'db.sqlite'));
  sent = [];
  w('settings', 'main', { notify: { movingDay: false } });
  diary('2026-11-13', FRI);
  diary('2026-11-14', SAT);
  diary('2026-11-15', SUN);
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test('his Monday replayed: Upper A ends 3:31 PM, at 3:32 PM only Sunday night\'s text goes out, without "Lower is on today"', async () => {
  workout('ua', '14:37', '15:31');
  await nightly('15:32').morning(T('15:32'));
  const m = said();
  assert.equal(m.length, 1, JSON.stringify(m));
  assert.equal(m[0].text, 'Sunday shows no meals, sleep or knee holds logged, just 11,420 steps. If you ate, tell me what and I\'ll add it.');
  assert.doesNotMatch(m[0].text, /rest day|Lower is|Friday/);
  // All three are done with, the two older ones unsaid: nothing comes back on the next tick or tomorrow.
  for (const d of ['2026-11-13', '2026-11-14', '2026-11-15']) assert.ok(store.getRecord(DIARY, d).data.morningAt, d);
  assert.equal(store.getRecord(DIARY, '2026-11-14').data.morningDropped, 'an earlier day');
  assert.equal(store.getRecord(DIARY, '2026-11-15').data.morningDropped, undefined);
  await nightly('15:40').morning(T('15:40'));
  assert.equal(said().length, 1);
});

test('the same Monday before he trains: only Sunday night\'s text, "Lower is on today" kept', async () => {
  w('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'Up', at: T('06:39') });
  await nightly('06:40').morning(T('06:40'));
  const m = said();
  assert.equal(m.length, 1);
  assert.equal(m[0].text, SUN);
  assert.equal(sent.length, 1, 'before midday it notifies');
});

test('only older days held (no text from last night): nothing stale goes out, but their fixes are still told', async () => {
  store.writeLocal(DIARY, '2026-11-15', null, { deleted: true });
  w('coach-changes', 'chg.a', { id: 'chg.a', at: at('2026-11-14', '23:30'), said: 'x', status: 'done', doneAt: at('2026-11-15', '02:00'), answer: 'Done: the walk ask says its time once.', by: 'nightly' });
  diary('2026-11-14', SAT, ['chg.a']);
  w('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'Up', at: T('06:39') });
  await nightly('06:40').morning(T('06:40'));
  const m = said();
  assert.equal(m.length, 1, JSON.stringify(m));
  assert.equal(m[0].text, 'Fixed overnight: the walk ask says its time once.');
  assert.ok(store.getRecord(DIARY, '2026-11-14').data.morningAt);
});

test('freshDay: after a workout today, today\'s plan goes; other days, holds and the rest stay', () => {
  workout('ua', '14:37', '15:31');
  const s = snapshot(store, { tz: TZ, now: T('15:32') });
  const text = 'Today\'s a rest day. Push is today. Lower tonight. Lower is Monday. Lower is Wednesday. Upper B tomorrow. Yesterday\'s session ran 54 min. Knee holds before bed today. 2,100 of 3,174 kcal so far. Eat now.';
  assert.equal(freshDay(text, s), 'Lower is Wednesday. Upper B tomorrow. Yesterday\'s session ran 54 min. Knee holds before bed today. 2,100 of 3,174 kcal so far. Eat now.');
});

test('freshDay: a holds round, a discarded workout or yesterday\'s workout is not training today: text untouched', () => {
  const text = 'Today\'s a rest day. Lower is Monday.';
  w('sessions', 'h', { id: 'h', kind: 'holds', area: 'knees', startedAt: T('07:30'), endedAt: T('07:36'), status: 'done' });
  workout('x', '09:00', '09:05', { status: 'discarded' });
  w('sessions', 'sun', { id: 'sun', dayType: 'upperA', startedAt: at('2026-11-15', '15:00'), endedAt: at('2026-11-15', '16:00'), status: 'done' });
  assert.equal(freshDay(text, snapshot(store, { tz: TZ, now: T('15:32') })), text);
  // A workout running now counts: he's at it.
  workout('now', '15:00', '15:00', { status: 'active', endedAt: null });
  assert.equal(freshDay(text, snapshot(store, { tz: TZ, now: T('15:32') })), '');
});
