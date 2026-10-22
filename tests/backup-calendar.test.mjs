// The backup reminders as a subscribed calendar (Thu 10/22, "fix the not fixed part... make it work somehow"): open
// reminders only, none in the Mac's next 45 minutes, a refresh hint, a private link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openCalendar } from '../server/calendar.mjs';

const TZ = 'Asia/Bangkok';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);

test('the calendar (Thu 10/22: "it can miss info by 15 mins?"): open reminders the Mac hasn\'t sent, alert 20 minutes after; nothing lost when the Mac is off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-cal-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let clock = at('2026-03-18', '14:00');
    const rem = (id, hm, extra = {}) => store.writeLocal('coach-reminders', id, { id, at: at('2026-03-18', hm), date: '2026-03-18', hm, text: `Reminder ${id}`, createdAt: clock - 60000, by: 'coach', ...extra });
    rem('soon', '14:30');
    rem('later', '17:00');
    rem('gone', '18:00', { cancelledAt: clock - 1000 });
    const cal = openCalendar({ store, tz: TZ, now: () => clock });
    const { path } = cal.link();
    const k = new URL(path, 'http://x').searchParams.get('k');
    const ics = cal.ics(k);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT15M/);
    assert.match(ics, /SUMMARY:Reminder soon/, 'not sent yet: it stays, nothing is lost if the Mac goes off');
    assert.match(ics, /SUMMARY:Reminder later\r\nDESCRIPTION:Reminder later/);
    assert.match(ics, /TRIGGER:PT20M/, 'the alert 20 minutes after its time');
    assert.doesNotMatch(ics, /Reminder gone/, 'cancelled');
    assert.throws(() => cal.ics('nope'), /wrong link/);
    // 14:30: the Mac sends it; the next refresh drops it before its 14:50 alert.
    clock = at('2026-03-18', '14:31');
    store.setMeta('notify:sent', { 'coach:soon': at('2026-03-18', '14:30') });
    assert.doesNotMatch(cal.ics(k), /Reminder soon/);
    // The Mac was off at 17:00: the 17:00 one stays until its 17:20 alert has rung, then goes.
    clock = at('2026-03-18', '17:10');
    assert.match(cal.ics(k), /Reminder later/);
    clock = at('2026-03-18', '17:21');
    assert.doesNotMatch(cal.ics(k), /Reminder later/);
    // A new link stops the old one.
    const renewed = new URL(cal.link({ renew: true }).path, 'http://x').searchParams.get('k');
    assert.throws(() => cal.ics(k), /wrong link/);
    assert.match(cal.ics(renewed), /^BEGIN:VCALENDAR/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
