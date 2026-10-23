// The backup reminders in his iCloud calendar (Thu 10/22, his words: "fix the backup so it never rings at a stale
// time"). The subscribed calendar (calendar.mjs) depended on the iPhone fetching it every 15 minutes; it didn't (no
// fetch at all in the 40 minutes after fetch logging began, and its copy still showed a reminder the Mac had moved an
// hour before), so its alerts rang at stale times. Now the Mac writes the same open reminders into a calendar named
// "Training HQ Backup" in his iCloud account through the Mac's Calendar app, and iCloud pushes every change to the iPhone in
// seconds: a reminder the Mac sends, moves, or that he did or cancelled, leaves the iPhone at once; with the Mac off
// the events stay and ring 20 minutes after their time (each event starts at that alert time). One run per change (and every 30 minutes).
// Fri 10/23, his words: "why does the calendar app keep opening by itself?": every run started the Mac's Calendar app.
// Now THQ Calendar (cal-helper/main.swift, built by scripts/build-cal-helper.mjs) writes the events through macOS's
// calendar service and Calendar stays closed; macOS asks him once to allow it. Until it may (or if it's missing), the
// AppleScript through the Calendar app still keeps the backup current, so a sent reminder never rings from it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { calendarItems, ALERT_AFTER_MIN } from './calendar.mjs';
import { formatTime } from '../app/js/lib/time.js';

export const CALENDAR_NAME = 'Training HQ Backup';
export const KEY_PREFIX = 'thq-backup:';
export const STATUS = 'icloud-calendar:status';
/** How far ahead the events go: a weekend with the Mac off is covered; further days are guesses that keep changing. */
export const HOURS = 72;
export const HEAL_MS = 30 * 60000;
export const RETRY_MS = 5 * 60000;
export const TIMEOUT_MS = 120000;
export const HELPER_ID = 'com.traininghq.calendar';
export const HELPER_APP = join(homedir(), 'Library', 'Application Support', 'TrainingHQ', 'THQ Calendar.app');
/** How far around now the helper looks for our events (ours are at most 72 h ahead; sent ones are removed). */
export const LOOK_DAYS = 14;

const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Is this server his real one (his private folder), not a dev copy in a scratch folder that would overwrite his
 * calendar with test data? (The login service sets TRAINING_HQ_PRIVATE to the real folder, so that can't tell.)
 */
export const isRealFolder = (privateDir, home = homedir()) => resolve(String(privateDir || '')) === resolve(join(home, 'Documents', 'training-hq-private'));

/**
 * The events the iCloud calendar should hold now: {key, title, notes, at}. Each starts at its alert time, the reminder's
 * time + 20 minutes, with the reminder's own time in the title (Thu 10/22: Calendar adds his account's default alert,
 * "at time of event", to every new event and AppleScript can't see or remove it; at the reminder's own time it would
 * ring together with the Mac's notification). The Mac removes the event when it sends, long before either alert.
 * The key changes when the time or the words do.
 */
export function desiredEvents(items, now = Date.now(), { hours = HOURS, tz = 'UTC', alertMin = ALERT_AFTER_MIN } = {}) {
  return items.filter((r) => r.at <= now + hours * 3600000).map((r) => {
    const title = `${oneLine(r.kind === 'coach' && r.body ? r.body : r.title, 180)} · ${formatTime(new Date(r.at), tz)}`;
    const notes = oneLine(`${r.kind === 'coach' ? '' : `${r.body || ''} `}Backup from Training HQ for ${formatTime(new Date(r.at), tz)}: it rings only when the Mac couldn't send it.`, 400);
    // Only characters Calendar stores as they are (Thu 10/22: it kept "#" as "%23", so the Mac never recognised its own
    // events and made all of them again at every check).
    const key = `${KEY_PREFIX}${r.id}@${r.at}-${hash(`${title}|${notes}`)}`.replace(/[^A-Za-z0-9:@._-]/g, '_');
    return { key, title, notes, at: r.at + alertMin * 60000 };
  });
}

const asText = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The AppleScript that makes the calendar hold exactly these events: ours not wanted are deleted, missing ones made
 * (each with an alert at its start, the alert time). Times are the Mac's local time (the server runs in it). Returns
 * "OK <added> <removed> <kept>", or "NO_CALENDAR" when there's no calendar of that name.
 */
export function syncScript(events, { name = CALENDAR_NAME, alertMin = 0 } = {}) {
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
  if (/NO_ACCESS/.test(out)) return { ok: false, why: 'no-access', text: `macOS hasn't allowed THQ Calendar to use calendars yet (${/waiting|asking/.test(out) ? 'click Allow on the Mac' : 'System Settings, Privacy & Security, Calendars, THQ Calendar'}).` };
  if (/NO_HELPER/.test(err)) return { ok: false, why: 'no-helper', text: 'THQ Calendar isn\'t built (node scripts/build-cal-helper.mjs).' };
  const e = String(err || out);
  if (/-1743|not authori[sz]ed|Not allowed/i.test(e)) return { ok: false, why: 'not-allowed', text: 'macOS hasn\'t allowed the server to use Calendar (System Settings, Privacy & Security, Automation).' };
  if (/\(-600\)|isn.t running/i.test(e)) return { ok: false, why: 'not-running', text: 'The Mac\'s Calendar app isn\'t running.' };
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
/** What THQ Calendar gets: the calendar, our prefix, the window around now, and each event's start and end (seconds). */
export function helperRequest(events, { name = CALENDAR_NAME, now = Date.now() } = {}) {
  return {
    calendar: name, prefix: KEY_PREFIX,
    from: (now - LOOK_DAYS * 86400000) / 1000, to: (now + LOOK_DAYS * 86400000) / 1000,
    events: events.map((e) => ({ key: e.key, title: e.title, notes: e.notes, start: e.at / 1000, end: e.at / 1000 + 300 })),
  };
}

/**
 * Runs THQ Calendar on these events (opened by LaunchServices, so macOS asks about calendar access for it, not for
 * the server). Resolves {out, err} like osascript; err "NO_HELPER" when it isn't built. Never rejects.
 */
export function eventKit(events, { app = HELPER_APP, now = Date.now(), timeoutMs = TIMEOUT_MS + 10000 } = {}) {
  if (!existsSync(app)) return Promise.resolve({ out: '', err: 'NO_HELPER' });
  const dir = mkdtempSync(join(tmpdir(), 'thq-cal-'));
  const req = join(dir, 'request.json'); const ans = join(dir, 'answer.txt');
  writeFileSync(req, JSON.stringify(helperRequest(events, { now })));
  return new Promise((done) => {
    execFile('open', ['-W', '-g', '-j', '-n', '-a', app, '--args', req, ans], { timeout: timeoutMs }, (e, _out, err) => {
      // `open -W` can return before a quick run has written its answer ("Unable to block on application", Fri 10/23):
      // wait for the answer file a little.
      const until = Date.now() + (e?.killed ? 0 : ANSWER_WAIT_MS);
      const read = () => {
        let out = '';
        try { out = readFileSync(ans, 'utf8'); } catch { /* not written yet */ }
        if (!out && Date.now() < until) { setTimeout(read, 100); return; }
        rmSync(dir, { recursive: true, force: true });
        done({ out, err: out ? '' : String(err || '') + (e ? String(e.message || e) : '') || 'THQ Calendar gave no answer' });
      };
      read();
    });
  });
}
const ANSWER_WAIT_MS = 20000;

/** Starts the Mac's Calendar app hidden, in the background (it must run for the AppleScript; nothing comes to the front). */
export function startCalendar() {
  return new Promise((resolve) => { execFile('open', ['-g', '-j', '-a', 'Calendar'], { timeout: 20000 }, () => setTimeout(resolve, 5000)); });
}

export function openICloudCalendar({ store, tz, run = osascript, launch = startCalendar, direct = null, now = () => Date.now(), log = () => {} }) {
  let busy = false;
  let lastSig = null; let lastOkAt = 0; let lastFailAt = 0; let lastWhy = null;
  // THQ Calendar (direct): used first; after it can't (no access yet, not built, an error), the Calendar app this time,
  // and THQ Calendar again 10 minutes later (not at every change, so a prompt he hasn't answered isn't asked again and again).
  let directAfter = 0; let directWhy = undefined;

  /** One sync through THQ Calendar, or null when the Calendar app has to do it this time. */
  async function viaDirect(events, t) {
    if (!direct || t < directAfter) return null;
    const { out, err } = await direct(events, { now: t });
    const r = readAnswer(out, err);
    if (r.ok || r.why === 'no-calendar') {
      if (directWhy !== null) log('icloud calendar: writing through THQ Calendar (the Calendar app stays closed)');
      directWhy = null;
      return r;
    }
    if (r.why !== directWhy) log(`icloud calendar: THQ Calendar couldn't write (${r.text}); the Calendar app does it meanwhile`);
    directWhy = r.why; directAfter = t + 2 * RETRY_MS;
    return null;
  }

  /** Brings the calendar in line with the open reminders, when they changed (or every 30 minutes, or forced). */
  async function sync({ force = false } = {}) {
    if (busy) return null;
    const t = now();
    const zone = typeof tz === 'function' ? tz() : tz;
    const events = desiredEvents(calendarItems(store, zone, t), t, { tz: zone });
    const sig = hash(events.map((e) => e.key).sort().join('\n'));
    if (!force && sig === lastSig && t - lastOkAt < HEAL_MS) return null;
    // After a failure: again in 5 minutes; while only the calendar is missing, every minute (he's making it now).
    if (!force && lastFailAt && t - lastFailAt < (lastWhy === 'no-calendar' ? 60000 : RETRY_MS)) return null;
    busy = true;
    try {
      let r = await viaDirect(events, t);
      if (!r) {
        let { out, err } = await run(syncScript(events));
        r = readAnswer(out, err);
        // Thu 10/22, 7:01 PM: Calendar had been quit and the AppleScript didn't start it: start it hidden, try once more.
        if (r.why === 'not-running') {
          log('icloud calendar: starting the Calendar app (hidden)');
          await launch();
          ({ out, err } = await run(syncScript(events)));
          r = readAnswer(out, err);
        }
      }
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
