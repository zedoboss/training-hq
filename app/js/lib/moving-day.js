// His moving day (Tue 10/27, his words: "Why would i be up at 10am?... usually on average I fall asleep by 1-2 hours
// later every day on average. That needs to be built and assumed by the coach... If I log that I just ate a meal, I'm
// not going to go to sleep immediately... wait at least an hour. And if I'm gone, then the coach can assume that I'm
// asleep until my next message. And obviously he can calculate the sleep automatically"; then: "the coach should resume
// the moving schedule and send notifications accordingly... if I do have a consistent schedule, I'll tell it and the
// moving schedule can be turned off, like in a setting"). "Morning. Are you up?" went out at his 10:00 AM wake setting
// while he slept 8:00 AM to 4:50 PM.
// With the moving schedule on (Settings notify.movingDay, the default), his day isn't the clock's:
// - He's asleep when he has gone quiet (no sign of him for quietMin) near his expected bedtime (from nearBedH before
//   it, and never sooner than minAwakeH after he woke), at least afterMealMin after his last meal. Asleep since: his
//   last sign, or his last meal + afterMealMin if later, not before that window. Asleep until his next sign: nothing is
//   asked, nothing waits for a wake time.
// - He woke at his first sign after gapH hours without one that reached minSleepMin into that window (or the wake
//   time he told, if in that gap).
// - His expected bedtime: the last bedtime + 24 hours + driftMin (1 to 2 hours later a day, his words).
// Wed 10/28, his words: "how the fuck did you assume that I went to bed again after waking up?... I cannot sleep from
// 8 a.m. till 4.50 and then go back to bed at 6.20 p.m.... Obviously, I haven't been on my phone": up at 4:50 PM, off
// his phone 6:21 PM to 12:30 AM was taken as a night ("6 hours quiet at any time") and a new day began at 12:30 AM.
// Hours off his phone in the middle of his day aren't sleep: only near his bedtime.
// - His day plays out his usual day from Settings (wake time to bedtime) from the moment he woke: a "body clock" zone,
//   the clock's zone moved so his wake reads as his wake time in Settings. Reminders that wait for his wake time
//   (holds, meals, supplements, the evening round-up...) run on it; food and supplements count toward the day he woke.
import { isoDate, hmOf } from './time.js';

export const MOVING = { driftMin: 90, gapH: 6, quietMin: 60, nearBedH: 4, minAwakeH: 8, minSleepMin: 180, afterMealMin: 60, sleepMin: 510 };

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
 * @param {{bed: number, wake: number, source?: string}[]} o.sleeps his logged nights (he told, Apple Health, or worked
 *   out here: source 'auto', which this works out again rather than trusting)
 * @returns {{wokeAt: number|null, firstSign?: number, nightBed: number|null, gap: boolean, bedAt: number|null,
 *   sleepFrom: number|null, asleep: boolean, asleepSince: number|null, sleepMin: number, nextWakeAt: number|null,
 *   nights: {bed: number, wake: number}[]}}
 *   wokeAt: when his current (or last) stretch awake began; nightBed: when he went to sleep before it; gap: a real
 *   sleep gap seen before it (not just the start of the data); bedAt: when he's expected to sleep next; sleepFrom: the
 *   earliest a sleep is assumed; nights: the sleeps found in the signs, oldest first.
 */
export function dayClock({ now, signs = [], mealTimes = [], sleeps = [], driftMin = MOVING.driftMin }) {
  const c = { ...MOVING, driftMin };
  const list = signs.filter((t) => Number.isFinite(t) && t <= now).sort((a, b) => a - b);
  const sleepMin = usualSleepMin(sleeps);
  const out = { wokeAt: null, nightBed: null, gap: false, bedAt: null, sleepFrom: null, asleep: true, asleepSince: null, sleepMin, nextWakeAt: null, nights: [] };
  if (!list.length) return out;
  const nights = sleeps.filter((x) => Number.isFinite(x?.bed) && Number.isFinite(x?.wake));
  const told = nights.filter((x) => x.source !== 'auto');
  // A stretch awake from `wake` (slept from `bed`, if known): bed again about 1 h 30 min after the last bedtime; a
  // last bedtime more than 2 days back says nothing about tonight: then from his wake and his usual sleep.
  const stretch = (wake, bed, firstSign, gap) => {
    const lastBed = bed ?? nights.filter((x) => x.bed < wake).sort((a, b) => b.bed - a.bed)[0]?.bed ?? null;
    let bedAt = lastBed != null && wake - lastBed < 48 * 3600000 ? lastBed + (24 * 60 + c.driftMin) * 60000 : wake + (24 * 60 + c.driftMin - sleepMin) * 60000;
    bedAt = Math.max(bedAt, wake + 6 * 3600000);
    // Wed 10/28: never asleep a few hours after he woke, only near his bedtime.
    const sleepFrom = Math.max(bedAt - c.nearBedH * 3600000, wake + c.minAwakeH * 3600000);
    return { wokeAt: wake, firstSign, nightBed: bed, gap, bedAt, sleepFrom };
  };
  const toldBefore = (lo, hi, from = told) => from.filter((x) => x.wake > lo && x.wake <= hi + 30 * 60000 && x.bed < hi).sort((a, b) => b.wake - a.wake)[0];
  // The wake he told (or Apple Health's) wins when it falls in the gap before his first sign; so does one worked out
  // here, that far back (it was found from signs since gone from the list).
  const t0 = toldBefore(list[0] - 18 * 3600000, list[0], nights);
  let cur = t0 ? stretch(Math.min(t0.wake, list[0]), t0.bed, list[0], true) : stretch(list[0], null, list[0], false);
  // Forward through his signs: a gap is a night when he told one there, or when it's gapH hours or more and he still
  // had minSleepMin asleep after the earliest he'd go to bed (his last sign, his meal + 1 hour, sleepFrom).
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const t = toldBefore(a, b);
    let night = t ? { bed: t.bed, wake: Math.min(t.wake, b) } : null;
    if (!night && b - a >= c.gapH * 3600000) {
      const bed = Math.max(bedAfter(a, mealTimes, b, c.afterMealMin), cur.sleepFrom);
      if (b - bed >= c.minSleepMin * 60000) night = { bed, wake: b };
    }
    if (!night) continue;
    out.nights.push(night);
    cur = stretch(night.wake, night.bed, b, true);
  }
  Object.assign(out, cur);
  const last = list.at(-1);
  const quiet = now - last;
  const lastMeal = Math.max(-Infinity, ...mealTimes.filter((t) => Number.isFinite(t) && t <= now));
  // Gone quiet an hour, an hour past his last meal, near his bedtime: asleep. Off his phone for hours in the middle of
  // his day isn't sleep (Wed 10/28).
  out.asleep = quiet >= c.quietMin * 60000 && now >= lastMeal + c.afterMealMin * 60000 && now >= cur.sleepFrom;
  if (out.asleep) {
    out.asleepSince = Math.min(Math.max(bedAfter(last, mealTimes, now, c.afterMealMin), cur.sleepFrom), now);
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
export function movingDayOf(at, { signs = [], mealTimes = [], sleeps = [], driftMin, wakeHm, tz }) {
  const list = signs.filter((t) => Number.isFinite(t) && t <= at).concat(at);
  return bodyClock(dayClock({ now: at, signs: list, mealTimes, sleeps, driftMin }).wokeAt, wakeHm, tz).date;
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
