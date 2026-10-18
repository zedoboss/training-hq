// Dates and times in the device's time zone, in the formats the owner asked for:
// times as H:MM AM/PM, days with weekday and date ("Sunday 10/11").
// Every function takes an optional IANA time zone; tests pass one explicitly.
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const parts = (date, opts, tz = deviceTimeZone()) => {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
};

/** "4:05 PM" */
export function formatTime(date, tz) {
  const p = parts(date, { hour: 'numeric', minute: '2-digit', hour12: true }, tz);
  return `${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}

/** "4:05:12 PM" (HUD clocks with seconds) */
export function formatTimeSec(date, tz) {
  const p = parts(date, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }, tz);
  return `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod.toUpperCase()}`;
}

/** "Saturday 10/17" */
export function formatDay(date, tz) {
  const p = parts(date, { weekday: 'long', month: 'numeric', day: 'numeric' }, tz);
  return `${p.weekday} ${p.month}/${p.day}`;
}

/** "Tuesday 10/10/2023": a day with its year, for history that spans years */
export function formatDate(date, tz) {
  const p = parts(date, { weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric' }, tz);
  return `${p.weekday} ${p.month}/${p.day}/${p.year}`;
}

/** "SAT" */
export function weekdayShort(date, tz) {
  return parts(date, { weekday: 'short' }, tz).weekday.toUpperCase();
}

/** "2026-10-17": the calendar date in the given (or device) time zone. */
export function isoDate(date, tz) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' }, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Whole days from isoA to isoB ("2026-09-24" to "2026-10-17" = 23). */
export function daysBetween(isoA, isoB) {
  const a = Date.UTC(...isoA.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = Date.UTC(...isoB.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((b - a) / 86400000);
}

/** ISO week number of the local date (Saturday 10/10/2026 = 41). */
export function isoWeek(date, tz) {
  const [y, m, d] = isoDate(date, tz).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7; // Monday 1 .. Sunday 7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

/** "GMT+7" */
export function gmtOffset(date, tz) {
  return parts(date, { timeZoneName: 'shortOffset' }, tz).timeZoneName;
}

/** "04:30" (24-hour, as stored) to "4:30 AM". */
export function formatHm(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "04:30" moved by some minutes, within the day ("04:30", -30 = "04:00"). */
export function addMinutesHm(hm, minutes) {
  const [h, m] = hm.split(':').map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** The moment a local date and "HH:MM" happen in a time zone (ms). Works across DST changes. */
export function zonedTime(iso, hm, tz = deviceTimeZone()) {
  const [y, mo, d] = iso.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the zone at that moment: what the zone's wall clock shows for the UTC guess.
  const wall = (t) => {
    const p = parts(new Date(t), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz);
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  };
  let t = guess - (wall(guess) - guess);
  t = guess - (wall(t) - t);
  return t;
}

/** "04:30": the local clock time of a moment. */
export function hmOf(date, tz) {
  const p = parts(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz);
  return `${p.hour}:${p.minute}`;
}

// ---- Where a log happened (A3) ------------------------------------------------------------------------------------
// Every new log records the time zone it was made in (tz). It is shown in that zone's local time, with the place
// named when that clock differs from this device's now ("5:30 AM Skopje time"). Logs without a zone (all history
// before this, and imports) are in the home zone (the synced doc settings/zones, set by setHomeZone at start).

/** Collections whose new records carry the zone they were made in. */
export const LOGGED_COLS = new Set(['sessions', 'meals', 'supp-log', 'sauna', 'squats', 'body-photos', 'measurements', 'body-scans', 'coach-notes', 'coach-messages', 'meal-checks']);

let homeZone = null;
export const setHomeZone = (tz) => { homeZone = validZone(tz) ? tz : null; };
export const getHomeZone = () => homeZone;

/** A zone Intl knows. */
export function validZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The zone a record happened in: its own, else `fallback`, else the home zone, else this device's. */
export const zoneOf = (rec, fallback = null) => (validZone(rec?.tz) ? rec.tz : fallback || homeZone || deviceTimeZone());

/** A new record of a logged collection, stamped with the zone it is made in (kept if it already has one). */
export const withZone = (col, data, tz = deviceTimeZone()) => (LOGGED_COLS.has(col) && data && typeof data === 'object' && !data.tz ? { ...data, tz } : data);

/** "Ho Chi Minh City", "Skopje", "New York": the place part of an IANA zone. */
export function placeOf(tz) {
  const city = String(tz || '').split('/').pop().replace(/_/g, ' ');
  return city === 'Ho Chi Minh' || city === 'Saigon' ? 'Ho Chi Minh City' : city || 'UTC';
}

/** Minutes the zone's clock is ahead of UTC at that moment. */
export function offsetMin(ms, tz) {
  const p = parts(new Date(ms), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz);
  return Math.round((Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - Math.floor(ms / 60000) * 60000) / 60000);
}

/** The record's zone when its clock at that moment differs from this device's zone now, else null. */
export function awayZone(ms, rec, here = deviceTimeZone()) {
  const z = zoneOf(rec);
  return z !== here && offsetMin(ms, z) !== offsetMin(ms, here) ? z : null;
}

/** "5:30 AM", or "5:30 AM Skopje time" when it happened on another clock than this device's. */
export function timeAt(ms, rec, here) {
  const z = zoneOf(rec);
  const away = awayZone(ms, rec, here);
  return `${formatTime(new Date(ms), z)}${away ? ` ${placeOf(away)} time` : ''}`;
}

/** The local date where it happened ("2026-10-17"). */
export const dateAt = (ms, rec) => isoDate(new Date(ms), zoneOf(rec));
/** "Saturday 10/17" where it happened. */
export const dayAt = (ms, rec) => formatDay(new Date(ms), zoneOf(rec));
/** "Tuesday 10/10/2023" where it happened. */
export const fullDateAt = (ms, rec) => formatDate(new Date(ms), zoneOf(rec));
/** " · SKOPJE TIME" style tag for headers, or ''. */
export const awayTag = (ms, rec, here) => { const z = awayZone(ms, rec, here); return z ? `${placeOf(z)} time` : ''; };
