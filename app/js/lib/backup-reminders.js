// Backup reminders for when the Mac is off (step 4, brief section 7): the fixed reminders of the next days (session
// and check-in times, tendon holds, supplement times) go into the iPhone's own Reminders through a
// Shortcut, or into Calendar as a file. They then ring with no Mac and no connection.
import { remindersFor } from './reminders.js';
import { daysBetween } from './time.js';
import { rotationDay, addDays } from './rotation.js';
import { formatDay, formatHm, isoDate, hmOf } from './time.js';

export const SHORTCUT_NAME = 'Training HQ Reminders';
export const LIST_NAME = 'Training HQ';

/**
 * Fixed reminders from `from` for `n` days. Future days assume each planned session happens on its day, so the
 * rotation moves on (Pull, Push, Legs, rest) the way it would if he keeps to it.
 */
export function fixedReminders(state, from, n = 7, now = Date.now()) {
  const out = [];
  let last = state.last;
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    out.push(...remindersFor({ ...state, last, date }).filter((r) => r.fixed && r.at > now && (i > 0 || r.due)));
    const rot = rotationDay({ last, today: date, days: state.days });
    // A day that trains carries the streak on (three in a row -> the next day rests).
    if (rot.today.kind === 'train') last = { dayType: rot.today.dayType, date, streak: last && daysBetween(last.date, date) === 1 ? (last.streak || 1) + 1 : 1 };
    else if (rot.today.kind === 'done') last = rot.last;
  }
  return out.sort((a, b) => a.at - b.at);
}

const long = (at, tz) => {
  const d = new Date(at);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day}, ${p.year} at ${formatHm(hmOf(d, tz))}`;
};

/** What the Shortcut receives: JSON text with the list name and one entry per reminder. */
export function shortcutPayload(items, tz) {
  return JSON.stringify({
    list: LIST_NAME,
    items: items.map((r) => ({ title: r.title, notes: r.body, due: long(r.at, tz), day: formatDay(new Date(r.at), tz), id: r.id })),
  });
}

/** Opens the Shortcuts app and runs his Shortcut with the reminders as its input. */
export const shortcutUrl = (payload, name = SHORTCUT_NAME) =>
  `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(payload)}`;

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Fold a content line at 75 bytes (RFC 5545). */
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/**
 * A calendar file with one short event and an alert per reminder (for Calendar, without a Shortcut). refreshMin: for
 * a subscribed calendar (server/calendar.mjs), how often the iPhone should fetch it again.
 */
export function icsFor(items, now = Date.now(), { refreshMin = null, alertAfterMin = 0 } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Training HQ//Backup reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${LIST_NAME}`,
    ...(refreshMin ? [`REFRESH-INTERVAL;VALUE=DURATION:PT${refreshMin}M`, `X-PUBLISHED-TTL:PT${refreshMin}M`] : [])];
  for (const r of items) {
    lines.push('BEGIN:VEVENT', `UID:${r.id.replace(/[^\w.-]/g, '-')}@training-hq`, `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(r.at)}`, 'DURATION:PT10M',
      // A reminder he asked the coach for is titled by its words, not "Reminder".
      `SUMMARY:${icsText(r.kind === 'coach' && r.body ? r.body : r.title)}`, `DESCRIPTION:${icsText(r.body)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:PT${alertAfterMin}M`, `DESCRIPTION:${icsText(r.kind === 'coach' && r.body ? r.body : r.title)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** File name for the calendar file: training-hq-reminders-2026-10-18.ics */
export const icsName = (from) => `training-hq-reminders-${from || isoDate(new Date())}.ics`;
