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
