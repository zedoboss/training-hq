// Thu 10/22 (his words: "check whether my iPhone ever fetches the backup calendar and fix the backup so it never rings
// at a stale time"): the iPhone didn't fetch the subscribed calendar for over an hour. The Mac now keeps the backup in
// his iCloud calendar "Training HQ Backup" through its Calendar app (AppleScript; a fake here), and iCloud updates the
// iPhone in seconds: one the Mac sent, moved or he did leaves at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { desiredEvents, syncScript, readAnswer, openICloudCalendar, isRealFolder, CALENDAR_NAME, STATUS, KEY_PREFIX } from '../server/icloud-calendar.mjs';
import { backupStatusText, BACKUP_CALENDAR } from '../app/js/lib/backup-reminders.js';

const TZ = 'Asia/Bangkok';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);

test('the events: his own words for a coach reminder, starting at the alert time with his time in the title, 3 days ahead', () => {
  const now = at('2026-03-18', '14:00');
  const items = [
    { id: 'coach:r1', kind: 'coach', at: at('2026-03-18', '17:00'), title: 'Reminder', body: 'Mall run: screen protector' },
    { id: 'holds-evening:2026-03-18', kind: 'holds', at: at('2026-03-18', '21:30'), title: 'Evening holds', body: 'Knees: 3 holds.' },
    { id: 'holds-evening:2026-03-22', kind: 'holds', at: at('2026-03-22', '21:30'), title: 'Evening holds', body: 'Knees.' },
  ];
  const ev = desiredEvents(items, now, { tz: TZ });
  assert.equal(ev.length, 2, 'beyond 3 days: left out');
  assert.equal(ev[0].title, 'Mall run: screen protector · 5:00 PM');
  assert.equal(ev[0].at, at('2026-03-18', '17:20'), 'Calendar adds his default alert at the event\'s start: the start is the alert time, so nothing rings with the Mac\'s own notification');
  assert.equal(ev[0].notes, "Backup from Training HQ for 5:00 PM: it rings only when the Mac couldn't send it.");
  assert.equal(ev[1].title, 'Evening holds · 9:30 PM');
  assert.equal(ev[1].notes, "Knees: 3 holds. Backup from Training HQ for 9:30 PM: it rings only when the Mac couldn't send it.");
  assert.ok(ev[0].key.startsWith(`${KEY_PREFIX}coach:r1@${at('2026-03-18', '17:00')}-`));
  // Thu 10/22: Calendar stored "#" as "%23", so no event was recognised and all were made again at every check.
  for (const e of ev) assert.match(e.key, /^[A-Za-z0-9:@._-]+$/, 'only characters Calendar keeps as they are');
  assert.match(desiredEvents([{ ...items[0], id: 'coach:r 1#x/y?z' }], now)[0].key, /^thq-backup:coach:r_1_x_y_z@\d+-[0-9a-f]{8}$/);
  const moved = desiredEvents([{ ...items[0], at: at('2026-03-18', '17:30') }], now, { tz: TZ })[0];
  const reworded = desiredEvents([{ ...items[0], body: 'Mall run' }], now, { tz: TZ })[0];
  assert.notEqual(moved.key, ev[0].key);
  assert.notEqual(reworded.key, ev[0].key);
  assert.equal(desiredEvents([items[0]], now, { tz: TZ })[0].key, ev[0].key, 'the same reminder, the same key');
});

test('the AppleScript: the calendar by name, the Mac\'s local time, the alert 20 minutes after, text escaped', () => {
  const t = new Date(2026, 2, 18, 21, 30).getTime(); // the Mac's local time
  const s = syncScript([{ key: 'thq-backup:a@1#x', title: 'Say "hi" \\ there', notes: 'n', at: t }]);
  assert.match(s, /^tell application "Calendar"\n  set cals to \(every calendar whose name is "Training HQ Backup"\)\n  if \(count of cals\) is 0 then return "NO_CALENDAR"/);
  assert.match(s, /\{"thq-backup:a@1#x", "Say \\"hi\\" \\\\ there", "n", 2026, 3, 18, 77400\}/);
  assert.match(s, /trigger interval:0\}/, 'the alert at the event\'s start, which is the alert time');
  assert.match(s, /if u starts with "thq-backup:" then/, 'only its own events are touched');
  assert.match(s, /set day of d to 1\n      set year of d/, 'the day first, so a short month never rolls over');
  assert.equal(CALENDAR_NAME, BACKUP_CALENDAR);
  assert.match(syncScript([]), /set wanted to \{\}/);
});

test('answers and errors read plainly', () => {
  assert.deepEqual(readAnswer('OK 3 1 12\n'), { ok: true, added: 3, removed: 1, kept: 12 });
  assert.equal(readAnswer('NO_CALENDAR\n').why, 'no-calendar');
  assert.equal(readAnswer('', 'execution error: Not authorized to send Apple events to Calendar. (-1743)').why, 'not-allowed');
  assert.equal(readAnswer('', 'Command failed: osascript (SIGTERM)').why, 'timeout');
  assert.equal(readAnswer('', 'boom').why, 'error');
  assert.equal(readAnswer('', "43:92: execution error: Calendar got an error: Application isn’t running. (-600)").why, 'not-running');
});

test('the Mac keeps the calendar in line: a run when something changed, a sent reminder removed at once, retries after a failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-icloud-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let clock = at('2026-03-18', '14:00');
    store.writeLocal('coach-reminders', 'r1', { id: 'r1', at: at('2026-03-18', '14:30'), date: '2026-03-18', hm: '14:30', text: 'Buy water', createdAt: clock - 60000, by: 'coach' });
    store.writeLocal('coach-reminders', 'r2', { id: 'r2', at: at('2026-03-18', '17:00'), date: '2026-03-18', hm: '17:00', text: 'Call home', createdAt: clock - 60000, by: 'coach' });
    const scripts = []; const logs = [];
    let answer = { out: 'NO_CALENDAR\n', err: '' };
    const ic = openICloudCalendar({ store, tz: () => TZ, now: () => clock, log: (m) => logs.push(m), run: async (s) => { scripts.push(s); return answer; } });
    const s1 = await ic.sync();
    assert.equal(s1.why, 'no-calendar');
    assert.equal(store.getMeta(STATUS).why, 'no-calendar');
    assert.match(logs[0], /No calendar named "Training HQ Backup"/);
    clock += 30000; await ic.sync();
    assert.equal(scripts.length, 1, 'the calendar missing: again a minute later');
    clock += 30000; answer = { out: '', err: 'Not authorized to send Apple events to Calendar. (-1743)' };
    await ic.sync();
    assert.equal(scripts.length, 2);
    clock += 60000; await ic.sync();
    assert.equal(scripts.length, 2, 'any other failure: again in 5 minutes, not every minute');
    clock += 5 * 60000; answer = { out: 'OK 2 0 0\n', err: '' };
    const s2 = await ic.sync();
    assert.equal(s2.ok, true);
    assert.equal(s2.events, 2);
    // It starts at 2:50 PM, its alert time, in the Mac's local time (the CI runs in another zone).
    const alertAt = new Date(at('2026-03-18', '14:50'));
    const local = `${alertAt.getFullYear()}, ${alertAt.getMonth() + 1}, ${alertAt.getDate()}, ${alertAt.getHours() * 3600 + alertAt.getMinutes() * 60}}`;
    assert.ok(scripts.at(-1).includes(`"Buy water · 2:30 PM", "Backup from Training HQ for 2:30 PM: it rings only when the Mac couldn't send it.", ${local}`));
    assert.match(scripts.at(-1), /"Call home · 5:00 PM"/);
    clock += 60000; await ic.sync();
    assert.equal(scripts.length, 3, 'nothing changed: no run');
    // 14:30: the Mac sends "Buy water": the next minute's run takes it out of his iCloud calendar.
    clock = at('2026-03-18', '14:31');
    store.setMeta('notify:sent', { 'coach:r1': at('2026-03-18', '14:30') });
    answer = { out: 'OK 0 1 1\n', err: '' };
    await ic.sync();
    assert.equal(scripts.length, 4);
    assert.doesNotMatch(scripts.at(-1), /Buy water/);
    assert.match(scripts.at(-1), /Call home/);
    assert.ok(logs.some((l) => /0 added, 1 removed, 1 kept/.test(l)));
    // Every 30 minutes it runs anyway (an event deleted by hand comes back).
    clock += 31 * 60000; await ic.sync();
    assert.equal(scripts.length, 5);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Settings shows how the backup stands, and what to do when it waits', () => {
  const ft = () => '5:50 PM';
  assert.deepEqual(backupStatusText({ ok: true, events: 12, at: 1 }, { formatTime: ft }), { ok: true, text: 'Working: 12 reminders for the next 3 days in your "Training HQ Backup" calendar (checked 5:50 PM).' });
  assert.match(backupStatusText({ ok: false, why: 'no-calendar' }).text, /^Waiting for the calendar: on your iPhone, Calendar, Calendars, Add Calendar, name it Training HQ Backup, iCloud, Done\.$/);
  assert.match(backupStatusText({ ok: false, why: 'not-allowed' }).text, /Click OK on the Mac/);
  assert.match(backupStatusText(null).text, /^Not set up yet/);
  assert.equal(backupStatusText(null, { enabled: false }).text, 'The backup is off on this Mac.');
});

test('only the real server writes his calendar: his private folder, not a dev copy', () => {
  assert.equal(isRealFolder('/Users/x/Documents/training-hq-private', '/Users/x'), true);
  assert.equal(isRealFolder('/Users/x/Documents/training-hq-private/', '/Users/x'), true);
  assert.equal(isRealFolder('/private/tmp/claude-501/abc/scratchpad/devprivate', '/Users/x'), false);
  assert.equal(isRealFolder('', '/Users/x'), false);
});

test('Calendar not running: the Mac starts it hidden and tries once more (Thu 10/22, 7:01 PM)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-icloud-run-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    const answers = [{ out: '', err: 'execution error: Calendar got an error: Application isn’t running. (-600)' }, { out: 'OK 0 0 0\n', err: '' }];
    let launched = 0; const logs = [];
    const ic = openICloudCalendar({ store, tz: () => TZ, now: () => at('2026-03-18', '14:00'), log: (m) => logs.push(m), launch: async () => { launched++; }, run: async () => answers.shift() });
    const st = await ic.sync();
    assert.equal(launched, 1);
    assert.equal(st.ok, true);
    assert.ok(logs.some((l) => /starting the Calendar app \(hidden\)/.test(l)));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
