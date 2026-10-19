// A3: every new log records the time zone it was made in; it is shown in that zone's local time, naming the place
// when that clock differs from the device's; logs without a zone use the home zone; the Mac's reminders follow the
// zone the phone reported last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zoneOf, setHomeZone, timeAt, awayZone, placeOf, offsetMin, withZone, dateAt, validZone, LOGGED_COLS } from '../app/js/lib/time.js';
import { openRepo, memoryAdapter } from '../app/js/lib/repo.js';
import { dayMarks } from '../app/js/lib/calendar.js';
import { sessionRows } from '../app/js/lib/session-list.js';
import { openStore } from '../server/store.mjs';
import { phoneZone, startNotifier } from '../server/notify.mjs';

const HOME = 'Asia/Bangkok'; // stands in for his home zone (UTC+7)
const AWAY = 'Europe/Skopje';

test('zone of a record: its own, else the home zone, else the device; places and offsets', () => {
  setHomeZone(HOME);
  try {
    assert.equal(zoneOf({ tz: AWAY }), AWAY);
    assert.equal(zoneOf({}), HOME);
    assert.equal(zoneOf({ tz: 'Not/AZone' }), HOME);
    assert.equal(zoneOf({}, 'UTC'), 'UTC');
    assert.equal(placeOf('Asia/Ho_Chi_Minh'), 'Ho Chi Minh City');
    assert.equal(placeOf('America/New_York'), 'New York');
    assert.equal(validZone('Nowhere/Land'), false);
    const ms = Date.parse('2026-10-25T03:30:00Z'); // after Europe's clock change
    assert.equal(offsetMin(ms, HOME), 420);
    assert.equal(offsetMin(ms, AWAY), 60);
    // Shown on a device at home: a session logged in Skopje says so; an old one doesn't.
    assert.equal(timeAt(ms, { tz: AWAY }, HOME), '4:30 AM Skopje time');
    assert.equal(timeAt(ms, {}, HOME), '10:30 AM');
    // On a device in Skopje: old history is in home time, and says so.
    assert.equal(timeAt(ms, {}, AWAY), '10:30 AM Bangkok time');
    assert.equal(timeAt(ms, { tz: AWAY }, AWAY), '4:30 AM');
    // Same clock, other zone name: nothing to say.
    assert.equal(awayZone(ms, { tz: 'Asia/Ho_Chi_Minh' }, HOME), null);
    // The local date where it happened: 11:30 PM in Skopje is the next day at home.
    const late = Date.parse('2026-10-25T22:30:00Z');
    assert.equal(dateAt(late, { tz: AWAY }), '2026-10-25');
    assert.equal(dateAt(late, {}), '2026-10-26');
  } finally { setHomeZone(null); }
});

test('new logs on the phone get its zone; an existing log keeps its own; old logs and settings are left alone', async () => {
  const repo = await openRepo(memoryAdapter());
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await repo.put('sessions', 's1', { id: 's1', startedAt: 1 });
  assert.equal((await repo.get('sessions', 's1')).tz, here);
  await repo.put('meals', 'm1', { id: 'm1', at: 1, tz: AWAY });
  await repo.put('meals', 'm1', { id: 'm1', at: 1, note: 'edited' });
  assert.equal((await repo.get('meals', 'm1')).tz, AWAY, 'an edit keeps where it happened');
  // An old record (no zone) edited later stays without one: it is home-zone history.
  await repo.put('settings', 'x', { a: 1 });
  assert.equal((await repo.get('settings', 'x')).tz, undefined);
  const adapter = memoryAdapter();
  await adapter.writeLocal({ col: 'sessions', id: 'old', data: { id: 'old', startedAt: 1 }, deleted: false, hlc: '0', device: 'd' }, {});
  const r2 = await openRepo(adapter);
  await r2.put('sessions', 'old', { id: 'old', startedAt: 1, note: 'x' });
  assert.equal((await r2.get('sessions', 'old')).tz, undefined);
  assert.ok(LOGGED_COLS.has('supp-log') && !LOGGED_COLS.has('days'));
  assert.deepEqual(withZone('days', { a: 1 }, AWAY), { a: 1 });
});

test('the calendar and the history list put a session on the date where it happened', () => {
  setHomeZone(HOME);
  try {
    const late = Date.parse('2026-10-25T22:30:00Z'); // 11:30 PM in Skopje, Monday 5:30 AM at home
    const sessions = [{ id: 'a', status: 'done', kind: 'workout', title: 'Push', startedAt: late, tz: AWAY, exercises: [] }, { id: 'b', status: 'done', kind: 'workout', title: 'Legs', startedAt: late + 1000, exercises: [] }];
    const marks = dayMarks({ sessions });
    assert.deepEqual(marks.get('2026-10-25').workouts.map((w) => w.id), ['a']);
    assert.deepEqual(marks.get('2026-10-26').workouts.map((w) => w.id), ['b']);
    const rows = sessionRows({ sessions, sets: [] });
    assert.deepEqual(rows.map((r) => [r.id, r.date, r.tz]), [['b', '2026-10-26', null], ['a', '2026-10-25', AWAY]]);
  } finally { setHomeZone(null); }
});

test('the Mac follows the zone the phone reported last; without one, its own', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-zones-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    assert.equal(phoneZone(store, 'UTC'), 'UTC');
    store.writeLocal('here', 'mac', { device: 'mac', tz: 'Asia/Bangkok', at: 3, phone: false });
    assert.equal(phoneZone(store, 'UTC'), 'Asia/Bangkok');
    store.writeLocal('here', 'phone', { device: 'phone', tz: AWAY, at: 2, phone: true });
    assert.equal(phoneZone(store, 'UTC'), AWAY, 'a phone wins over the Mac browser');
    store.writeLocal('here', 'phone', { device: 'phone', tz: 'Bad/Zone', at: 4, phone: true });
    assert.equal(phoneZone(store, 'UTC'), 'Asia/Bangkok');
    // A session time of 4:30 AM fires at 4:30 AM where the phone is.
    store.writeLocal('here', 'phone', { device: 'phone', tz: AWAY, at: 5, phone: true });
    store.writeLocal('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-10-01', push: '2026-10-02', legs: '2026-10-03' } });
    store.writeLocal('sessions', 'x', { id: 'x', kind: 'workout', status: 'done', dayType: 'push', startedAt: Date.parse('2026-10-24T03:00:00Z') });
    store.writeLocal('days', '2026-10-26', { date: '2026-10-26', sessionTime: '04:30' });
    const sent = [];
    let now = Date.parse('2026-10-26T03:01:00Z'); // 4:01 AM in Skopje (UTC+1), 10:01 AM at home
    const n = startNotifier({ store, push: { list: () => [1], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } }, now: () => now, everyMs: 1e9 });
    n.stop();
    assert.deepEqual((await n.tick()).map((i) => i.id), ['readiness:2026-10-26']);
    now = Date.parse('2026-10-26T03:30:00Z');
    assert.deepEqual((await n.tick()).map((i) => i.id), ['session:2026-10-26']);
    assert.equal(sent[1].title, 'Coach');
    assert.match(sent[1].body, /^Legs at 4:30 AM\. /);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
