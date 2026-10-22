// The backup reminders in his iCloud calendar (Thu 10/22, his words: "fix the backup so it never rings at a stale
// time"). The subscribed calendar (calendar.mjs) depended on the iPhone fetching it every 15 minutes; it didn't (no
// fetch at all in the 40 minutes after fetch logging began, and its copy still showed a reminder the Mac had moved an
// hour before), so its alerts rang at stale times. Now the Mac writes the same open reminders into a calendar named
// "Training HQ Backup" in his iCloud account through the Mac's Calendar app, and iCloud pushes every change to the iPhone in
// seconds: a reminder the Mac sends, moves, or that he did or cancelled, leaves the iPhone at once; with the Mac off
// the events stay and ring 20 minutes after their time. One AppleScript run per change (and every 30 minutes).
// macOS asks once whether the server may control Calendar; he creates the iCloud calendar once on his iPhone.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { calendarItems, ALERT_AFTER_MIN } from './calendar.mjs';

export const CALENDAR_NAME = 'Training HQ Backup';
export const KEY_PREFIX = 'thq-backup:';
export const STATUS = 'icloud-calendar:status';
/** How far ahead the events go: a weekend with the Mac off is covered; further days are guesses that keep changing. */
export const HOURS = 72;
export const HEAL_MS = 30 * 60000;
export const RETRY_MS = 5 * 60000;
export const TIMEOUT_MS = 120000;

const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Is this server his real one (his private folder), not a dev copy in a scratch folder that would overwrite his
 * calendar with test data? (The login service sets TRAINING_HQ_PRIVATE to the real folder, so that can't tell.)
 */
export const isRealFolder = (privateDir, home = homedir()) => resolve(String(privateDir || '')) === resolve(join(home, 'Documents', 'training-hq-private'));

/** The events the iCloud calendar should hold now: {key, title, notes, at}. The key changes when time or words do. */
export function desiredEvents(items, now = Date.now(), hours = HOURS) {
  return items.filter((r) => r.at <= now + hours * 3600000).map((r) => {
    const title = oneLine(r.kind === 'coach' && r.body ? r.body : r.title, 200);
    const notes = oneLine(`${r.kind === 'coach' ? '' : `${r.body || ''} `}Backup from Training HQ: it rings only when the Mac couldn't send it.`, 400);
    return { key: `${KEY_PREFIX}${r.id}@${r.at}#${hash(`${title}|${notes}`)}`, title, notes, at: r.at };
  });
}

const asText = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The AppleScript that makes the calendar hold exactly these events: ours not wanted are deleted, missing ones made
 * (each with an alert `alertMin` after its start). Times are the Mac's local time (the server runs in it). Returns
 * "OK <added> <removed> <kept>", or "NO_CALENDAR" when there's no calendar of that name.
 */
export function syncScript(events, { name = CALENDAR_NAME, alertMin = ALERT_AFTER_MIN } = {}) {
  const wanted = events.map((e) => {
    const d = new Date(e.at);
    const secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    return `{${asText(e.key)}, ${asText(e.title)}, ${asText(e.notes)}, ${d.getFullYear()}, ${d.getMonth() + 1}, ${d.getDate()}, ${secs}}`;
  });
  return `tell application "Calendar"
  set cals to (every calendar whose name is ${asText(name)})
  if (count of cals) is 0 then return "NO_CALENDAR"
  set c to item 1 of cals
  set wanted to {${wanted.join(', ')}}
  set wantedKeys to {${events.map((e) => asText(e.key)).join(', ')}}
  set have to {}
  set removed to 0
  set evs to every event of c
  repeat with e in evs
    set u to url of e
    if u is missing value then set u to ""
    if u starts with ${asText(KEY_PREFIX)} then
      if (wantedKeys contains u) and (have does not contain u) then
        set end of have to u
      else
        delete e
        set removed to removed + 1
      end if
    end if
  end repeat
  set added to 0
  repeat with w in wanted
    if have does not contain (item 1 of w) then
      set d to current date
      set day of d to 1
      set year of d to (item 4 of w)
      set month of d to (item 5 of w)
      set day of d to (item 6 of w)
      set time of d to (item 7 of w)
      set e to make new event at end of events of c with properties {summary:(item 2 of w), description:(item 3 of w), start date:d, end date:(d + 300), url:(item 1 of w)}
      tell e to make new display alarm at end of display alarms with properties {trigger interval:${Math.round(alertMin)}}
      set added to added + 1
    end if
  end repeat
  return "OK " & added & " " & removed & " " & (count of have)
end tell`;
}

/** What an osascript answer or error means: {ok, added, removed, kept} or {ok: false, why, text}. */
export function readAnswer(out = '', err = '') {
  const m = /^OK (\d+) (\d+) (\d+)/.exec(String(out).trim());
  if (m) return { ok: true, added: +m[1], removed: +m[2], kept: +m[3] };
  if (/NO_CALENDAR/.test(out)) return { ok: false, why: 'no-calendar', text: `No calendar named "${CALENDAR_NAME}" on the Mac: make one in iCloud (iPhone: Calendar, Calendars, Add Calendar).` };
  const e = String(err || out);
  if (/-1743|not authori[sz]ed|Not allowed/i.test(e)) return { ok: false, why: 'not-allowed', text: 'macOS hasn\'t allowed the server to use Calendar (System Settings, Privacy & Security, Automation).' };
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(e)) return { ok: false, why: 'timeout', text: 'Calendar didn\'t answer in time.' };
  return { ok: false, why: 'error', text: oneLine(e, 300) || 'osascript failed' };
}

/** Runs an AppleScript with the Mac's osascript. Resolves {out, err}; never rejects. */
export function osascript(script, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (e, out, err) => resolve({ out: String(out || ''), err: String(err || '') + (e && !err ? String(e.message || e) : '') }));
  });
}

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openStore>} o.store
 * @param {() => string} o.tz   his time zone (the reminders' days)
 * @param {(script: string) => Promise<{out, err}>} [o.run]  tests pass a fake
 */
export function openICloudCalendar({ store, tz, run = osascript, now = () => Date.now(), log = () => {} }) {
  let busy = false;
  let lastSig = null; let lastOkAt = 0; let lastFailAt = 0; let lastWhy = null;

  /** Brings the calendar in line with the open reminders, when they changed (or every 30 minutes, or forced). */
  async function sync({ force = false } = {}) {
    if (busy) return null;
    const t = now();
    const events = desiredEvents(calendarItems(store, typeof tz === 'function' ? tz() : tz, t), t);
    const sig = hash(events.map((e) => e.key).sort().join('\n'));
    if (!force && sig === lastSig && t - lastOkAt < HEAL_MS) return null;
    if (!force && lastFailAt && t - lastFailAt < RETRY_MS) return null;
    busy = true;
    try {
      const { out, err } = await run(syncScript(events));
      const r = readAnswer(out, err);
      const status = { ...r, at: t, events: events.length };
      store.setMeta(STATUS, status);
      if (r.ok) {
        lastSig = sig; lastOkAt = t; lastFailAt = 0; lastWhy = null;
        if (r.added || r.removed) log(`icloud calendar: ${r.added} added, ${r.removed} removed, ${r.kept} kept`);
      } else {
        lastFailAt = t;
        if (r.why !== lastWhy) log(`icloud calendar: ${r.text}`);
        lastWhy = r.why;
      }
      return status;
    } finally { busy = false; }
  }

  return { sync, status: () => store.getMeta(STATUS) || null };
}
