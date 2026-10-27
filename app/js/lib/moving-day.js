// His moving day (Tue 10/27, his words: "Why would i be up at 10am?... usually on average I fall asleep by 1-2 hours
// later every day on average. That needs to be built and assumed by the coach... If I log that I just ate a meal, I'm
// not going to go to sleep immediately... wait at least an hour. And if I'm gone, then the coach can assume that I'm
// asleep until my next message. And obviously he can calculate the sleep automatically"; then: "the coach should resume
// the moving schedule and send notifications accordingly... if I do have a consistent schedule, I'll tell it and the
// moving schedule can be turned off, like in a setting"). "Morning. Are you up?" went out at his 10:00 AM wake setting
// while he slept 8:00 AM to 4:50 PM.
// With the moving schedule on (Settings notify.movingDay, the default), his day isn't the clock's:
// - He's asleep when he has gone quiet (no sign of him for quietMin) near his expected bedtime, at least afterMealMin
//   after his last meal, or quiet gapH hours at any time. Asleep since: his last sign, or his last meal + afterMealMin
//   if later. Asleep until his next sign: nothing is asked, nothing waits for a wake time.
// - He woke at his first sign after gapH hours without one (or the wake time he told, if in that gap).
// - His expected bedtime: the last bedtime + 24 hours + driftMin (1 to 2 hours later a day, his words).
// - His day plays out his usual day from Settings (wake time to bedtime) from the moment he woke: a "body clock" zone,
//   the clock's zone moved so his wake reads as his wake time in Settings. Reminders that wait for his wake time
//   (holds, meals, supplements, the evening round-up...) run on it; food and supplements count toward the day he woke.
import { awakeSince } from './waking-day.js';
import { isoDate, hmOf } from './time.js';

export const MOVING = { driftMin: 90, gapH: 6, quietMin: 60, nearBedH: 4, afterMealMin: 60, sleepMin: 510 };

const minOf = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** His usual sleep length, minutes: the median of his last 5 nights (bed to wake, 4 to 14 hours), else `fallback`. */
export function usualSleepMin(sleeps = [], fallback = MOVING.sleepMin) {
  const xs = sleeps.filter((x) => Number.isFinite(x?.bed) && Number.isFinite(x?.wake)).sort((a, b) => a.wake - b.wake).slice(-5)
    .map((x) => (x.wake - x.bed) / 60000).filter((m) => m >= 240 && m <= 840).sort((a, b) => a - b);
  if (!xs.length) return fallback;
  const k = Math.floor(xs.length / 2);
  return Math.round(xs.length % 2 ? xs[k] : (xs[k - 1] + xs[k]) / 2);
}

/** When he went to sleep after his last sign `last`: then, or afterMealMin after his last meal if later; never past `cap`. */
export function bedAfter(last, mealTimes = [], cap = Infinity, afterMealMin = MOVING.afterMealMin) {
  const meal = Math.max(-Infinity, ...mealTimes.filter((t) => Number.isFinite(t) && t <= last));
  return Math.min(Math.max(last, meal + afterMealMin * 60000), cap);
}

/**
 * Where he is in his moving day at `now`.
 * @param {object} o
 * @param {number[]} o.signs     every sign of him up to now (messages, meals, ticks, workouts, the app...), sorted
 * @param {number[]} o.mealTimes when his meals were (ms)
 * @param {{bed: number, wake: number}[]} o.sleeps his logged nights (he told, Apple Health, or worked out here)
 * @returns {{wokeAt: number|null, firstSign?: number, nightBed: number|null, gap: boolean, bedAt: number|null, asleep: boolean,
 *   asleepSince: number|null, sleepMin: number, nextWakeAt: number|null}}
 *   wokeAt: when his current (or last) stretch awake began; nightBed: when he went to sleep before it; gap: a real
 *   sleep gap seen before it (not just the start of the data); bedAt: when he's expected to sleep next.
 */
export function dayClock({ now, signs = [], mealTimes = [], sleeps = [], driftMin = MOVING.driftMin }) {
  const c = { ...MOVING, driftMin };
  const list = signs.filter((t) => Number.isFinite(t) && t <= now).sort((a, b) => a - b);
  const sleepMin = usualSleepMin(sleeps);
  const out = { wokeAt: null, nightBed: null, gap: false, bedAt: null, asleep: true, asleepSince: null, sleepMin, nextWakeAt: null };
  if (!list.length) return out;
  const last = list.at(-1);
  const start = awakeSince(list, last, c.gapH);
  const before = list.filter((t) => t < start).at(-1) ?? null;
  // The wake he told (or Apple Health's) wins when it falls in the gap before his first sign.
  const told = sleeps.filter((x) => Number.isFinite(x?.wake) && x.wake <= start + 30 * 60000 && x.wake > (before ?? start - 18 * 3600000))
    .sort((a, b) => b.wake - a.wake)[0];
  out.firstSign = start;
  out.wokeAt = told ? Math.min(told.wake, start) : start;
  out.gap = before != null || Boolean(told);
  out.nightBed = told && Number.isFinite(told.bed) ? told.bed : before != null ? bedAfter(before, mealTimes, out.wokeAt, c.afterMealMin) : null;
  const lastBed = out.nightBed ?? sleeps.filter((x) => Number.isFinite(x?.bed) && x.bed < out.wokeAt).sort((a, b) => b.bed - a.bed)[0]?.bed ?? null;
  // A last bedtime more than 2 days back says nothing about tonight: then from his wake and his usual sleep.
  out.bedAt = lastBed != null && out.wokeAt - lastBed < 48 * 3600000
    ? lastBed + (24 * 60 + c.driftMin) * 60000
    : out.wokeAt + (24 * 60 + c.driftMin - sleepMin) * 60000;
  out.bedAt = Math.max(out.bedAt, out.wokeAt + 6 * 3600000);
  const quiet = now - last;
  const lastMeal = Math.max(-Infinity, ...mealTimes.filter((t) => Number.isFinite(t) && t <= now));
  out.asleep = quiet >= c.gapH * 3600000
    || (quiet >= c.quietMin * 60000 && now >= lastMeal + c.afterMealMin * 60000 && now >= out.bedAt - c.nearBedH * 3600000);
  if (out.asleep) {
    out.asleepSince = bedAfter(last, mealTimes, now, c.afterMealMin);
    out.nextWakeAt = out.asleepSince + sleepMin * 60000;
  }
  return out;
}

/** The zone's offset from UTC at `t`, minutes. */
export function offsetMinAt(t, tz) {
  const [y, mo, d] = isoDate(new Date(t), tz).split('-').map(Number);
  const [h, mi] = hmOf(new Date(t), tz).split(':').map(Number);
  return Math.round((Date.UTC(y, mo - 1, d, h, mi) - Math.floor(t / 60000) * 60000) / 60000);
}

/**
 * His body clock for a stretch awake from `wokeAt`: the offset (minutes from UTC) of a zone where that moment reads as
 * his wake time in Settings (to 5 minutes), kept within -12:00 to +14:00. Zone string "+00:10" for the planner.
 */
export function bodyClock(wokeAt, wakeHm, tz) {
  const local = offsetMinAt(wokeAt, tz);
  const shift = Math.round((minOf(hmOf(new Date(wokeAt), tz)) - minOf(wakeHm)) / 5) * 5;
  let off = local - shift;
  while (off < -720) off += 1440;
  while (off >= 840) off -= 1440;
  const a = Math.abs(off);
  const zone = `${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  return { offsetMin: off, zone, shiftMin: local - off, date: isoDate(new Date(wokeAt + off * 60000), 'UTC') };
}

/** The day food and supplements at `at` count toward: the body-clock date of the stretch awake it falls in. */
export function movingDayOf(at, { signs = [], wakeHm, tz, gapH = MOVING.gapH }) {
  const list = signs.filter((t) => Number.isFinite(t) && t <= at).concat(at).sort((a, b) => a - b);
  return bodyClock(awakeSince(list, at, gapH), wakeHm, tz).date;
}

/** A clock time in a text written on the body clock ("10:30 AM"), on the real clock: moved by shiftMin. */
export function realTimes(text, shiftMin) {
  if (!text || !shiftMin) return text;
  return String(text).replace(/\b(\d{1,2}):(\d{2}) (AM|PM)\b/g, (_, h, m, p) => {
    const t = ((Number(h) % 12) + (p === 'PM' ? 12 : 0)) * 60 + Number(m);
    const r = ((t + shiftMin) % 1440 + 1440) % 1440;
    const hh = Math.floor(r / 60);
    return `${hh % 12 || 12}:${String(r % 60).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  });
}
