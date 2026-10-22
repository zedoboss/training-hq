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

test('the calendar: open fixed reminders after the Mac\'s 45 minutes; a cancelled one drops off; a wrong link is refused', () => {
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
    assert.match(ics, /SUMMARY:Reminder\r\nDESCRIPTION:Reminder later/);
    assert.doesNotMatch(ics, /Reminder soon/, 'the Mac sends that one itself');
    assert.doesNotMatch(ics, /Reminder gone/, 'cancelled');
    assert.throws(() => cal.ics('nope'), /wrong link/);
    // Later in the day: the 5 PM one is inside the Mac's window now and leaves the calendar.
    clock = at('2026-03-18', '16:30');
    assert.doesNotMatch(cal.ics(k), /Reminder later/);
    // A new link stops the old one.
    const renewed = new URL(cal.link({ renew: true }).path, 'http://x').searchParams.get('k');
    assert.throws(() => cal.ics(k), /wrong link/);
    assert.match(cal.ics(renewed), /^BEGIN:VCALENDAR/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
