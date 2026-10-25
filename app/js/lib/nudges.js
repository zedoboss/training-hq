// The coach bumping him through the day (Michael, Monday 10/19): "he should bump me all the time... every 15 to 30
// minutes... make the logic make sense". Pure functions; the Mac's reminder clock (server/notify.mjs) runs them.
// - Every notification is the coach's: title "Coach", the facts first, then one short line in his moods (Calm, no
//   mood line, where a safety rule or his recovery is involved).
// - Nudges: every `everyMin` minutes inside his waking hours, the most important thing still open that wasn't
//   nudged within its own gap. Nothing while a session or sauna runs, right after another notification, or while he
//   is talking to the coach. Nothing open, nothing sent.
import { pickLine } from './coach-talk.js';
import { hmOf, formatHm, zonedTime, isoDate } from './time.js';
import { LABEL } from './rotation.js';
import { MEAL_NUDGE } from './fuel-reminders.js';
import { isSnack } from './meals.js';

export const NUDGE_DEFAULTS = { everyMin: 20, wakeHm: '07:00', bedHm: '22:00' };
export const NUDGE_EVERY = [[15, 'Every 15 minutes'], [20, 'Every 20 minutes'], [30, 'Every 30 minutes'], [0, 'Off']];
/** Quiet this long after any notification, and after he last wrote to the coach. */
export const QUIET_AFTER_MIN = 10;
/** Apple Health data older than this gets a nudge to open the app (the export runs when the app opens). */
export const STALE_HEALTH_H = 6;
/** No nudges this long after a workout ends (shower, not hungry yet); then the first meal. */
export const AFTER_WORKOUT_QUIET_MIN = 20;
/** A nudge said once a day. */
const ONCE_MIN = 18 * 60;
/** Kinds of reminder that speak plainly (no mood line). */
const CALM_KINDS = new Set(['sauna', 'recovery', 'scan']);

const minOf = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const addMin = (hm, n) => { const t = (minOf(hm) + Math.round(n / 5) * 5 + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const nf = (n) => Math.round(n).toLocaleString('en-US');

/** Inside his waking hours (wake time up to bedtime; works across midnight). */
export function awakeAt(now, tz, wakeHm = NUDGE_DEFAULTS.wakeHm, bedHm = NUDGE_DEFAULTS.bedHm) {
  const t = minOf(hmOf(new Date(now), tz)); const w = minOf(wakeHm); const b = minOf(bedHm);
  return w < b ? t >= w && t < b : t >= w || t < b;
}

/** How far through his eating day (wake up to 2 hours before bed) it is now, 0 to 1. */
export function dayFraction(now, tz, wakeHm = NUDGE_DEFAULTS.wakeHm, bedHm = NUDGE_DEFAULTS.bedHm) {
  const t = minOf(hmOf(new Date(now), tz)); const w = minOf(wakeHm); let b = minOf(bedHm) - 120;
  let x = t;
  if (b <= w) b += 1440;
  if (x < w) x += 1440;
  return Math.max(0, Math.min(1, (x - w) / (b - w)));
}

/** A notification in the coach's voice: {title, body}. */
export function coachVoice(text, { bank = null, moods = {}, intensity = 3, calm = false, rng = Math.random, avoid = new Set() } = {}) {
  const facts = String(text || '').trim();
  // Thu 10/22, 4:54 PM (his words: "all logs obv wrong", on "Started cooking? Are you going to let your future self be
  // weaker? Move." and "Back from the walk? How many minutes did you go? You got this. Move!"): a push line follows a
  // call to act, never a question to him.
  if (calm || /\?\s*$/.test(facts)) return { title: 'Coach', body: facts };
  const line = pickLine(bank, 'nudge', { moods, intensity, rng, avoid });
  return { title: 'Coach', body: line?.text ? `${facts} ${line.text}` : facts };
}

/**
 * A planned reminder (lib/reminders.js) said by the coach: its title becomes the first sentence, unless the text
 * already says it (Thu 10/22, his words: "Why did it say head home twice?"). A calm item gets no mood line.
 */
export function coachReminder(item, opts = {}) {
  // A reminder the coach set for him (set_reminder): its own words, as the coach wrote them; no "Reminder." in front, no
  // push line (Thu 10/22, 4:54 PM: "Reminder. 4:40 PM. Started cooking? Are you going to let your future self be weaker?
  // Move.").
  if (item.kind === 'coach') return coachVoice(item.body || item.title, { ...opts, calm: true });
  const head = String(item.title || '').replace(/[.?!:]?\s*$/, (m) => (/[?!]/.test(m) ? m.trim() : '.'));
  const said = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const text = item.body && head && said(item.body).includes(said(head)) ? item.body : [head, item.body].filter(Boolean).join(' ');
  return coachVoice(text, { ...opts, calm: opts.calm || item.calm || CALM_KINDS.has(item.kind) });
}

// Which planned reminders are nudged again while still open: [key prefix, priority, minutes between nudges].
// Not holds (Sat 10/24): they have their own few check-ins (lib/reminders.js HOLDS_CHECK), not every hour.
const AGAIN = { readiness: ['checkin', 85, 20], meals: ['meals', 55, 30], supps: ['supps', 60, 45], recovery: ['recovery', 40, 120] };

/**
 * Everything worth a nudge right now, most important first.
 * @param {object} o
 * @param {number} o.now
 * @param {string} o.tz
 * @param {Array} o.reminders     today's planned reminders (remindersFor), with due = still open
 * @param {object} o.rot          rotationDay for today ({today: {kind, dayType}})
 * @param {string|null} o.sessionHm  today's session time ("HH:MM") or null
 * @param {{started: boolean, done: boolean}} o.session  today's workout
 * @param {boolean} o.weighedToday  a weight (Evolt or other) logged today
 * @param {boolean} o.sleepLogged   last night's sleep known (Health or told to the coach)
 * @param {{kcal: number, protein: number}} o.eaten
 * @param {{kcal: number, protein: number}|null} o.targets
 * @param {{steps: number, asOf: number}|null} o.steps   today's steps from Apple Health and when they were read
 * @param {number|null} o.stepGoal
 * @param {{items: string[]}|null} o.scanToday  a body scan planned for today and not done: the on-the-day checklist
 * @param {{open: string[], total: number, taken?: number}|null} o.suppsUntimed  today's supplements with no time set: names
 *   still open; total and taken over all of today's (out of stock ones aren't on the list)
 * @param {string} o.wakeHm
 * @param {string} o.bedHm
 * @param {number|null} o.wokeAt   when he actually woke today (his sleep log or Apple Health), ms
 * @param {{text?: string, gymAfterMin?: number[]}|null} o.morning  his morning routine (settings.notify.morning)
 * @param {number|null} [o.healthAt]  when Apple Health last reached the Mac (the newest file), ms; null = never; left out = don't say
 * @param {{open: string[], mealAt: number, away?: boolean}|null} o.suppsAfterMeal  supplements he takes after his first meal, still open, when that meal was logged, and whether he ate it out
 * @param {number|null} o.workoutEndedAt  when today's workout was finished, ms
 * @param {number|null} o.mealAfterGymAt  no meal nudge before this after the gym (reminders.js afterGym), ms
 * @param {number|null} o.lastMealAt      his latest meal today, ms
 * @returns {Array<{key: string, priority: number, gapMin: number, text: string, url: string, calm?: boolean}>}
 */
export function nudgeCandidates({ now, tz, reminders = [], rot = null, sessionHm = null, session = {}, weighedToday = false, sleepLogged = true,
  eaten = { kcal: 0, protein: 0 }, targets = null, steps = null, stepGoal = null, suppsUntimed = null, scanToday = null, wakeHm = NUDGE_DEFAULTS.wakeHm, bedHm = NUDGE_DEFAULTS.bedHm,
  wokeAt = null, morning = null, workoutEndedAt = null, mealAfterGymAt = null, mealAnsweredAt = null, lastMealAt = null, healthAt = undefined, suppsAfterMeal = null, fasting = false }) {
  const out = [];
  // Tue 10/20, his words: after the first meal is logged, "come on, take your supplements" first, then the dishes.
  // A fasting day (Wed 10/21): nothing about food or supplements.
  if (fasting) { suppsAfterMeal = null; suppsUntimed = null; targets = null; workoutEndedAt = workoutEndedAt && lastMealAt > workoutEndedAt ? workoutEndedAt : null; }
  // Eaten out (Fri 10/23): not before he can be home, and asked as "back home yet?". Not before the time he set himself
  // for being home or taking them either (ownSuppsTime).
  if (suppsAfterMeal?.open?.length && suppsAfterMeal.mealAt && now >= suppsAfterMeal.mealAt + (suppsAfterMeal.away ? AWAY_REMIND_MIN * 60000 : 0)
    && now >= ownSuppsTime(reminders, suppsAfterMeal.open, suppsAfterMeal.mealAt)) {
    out.push({ key: 'supps-after-meal', priority: 91, gapMin: 30, url: '#/supps',
      text: suppsAfterMeal.away ? `Back home yet? Take your supplements now: ${suppsAfterMeal.open.join(', ')}. Tell me when they're down.`
        : `First meal logged: take your supplements now: ${suppsAfterMeal.open.join(', ')}. Tell me when they're down.` });
  }
  // After the workout (Tue 10/20, his words: "I'm usually not hungry immediately and I obviously need to take a
  // shower... wait 20 minutes after my workout is finished and then he should bump me about my first meal"): quiet
  // for 20 minutes, then the meal comes first, before supplements and the rest.
  // Thu 10/22: and not before the after-gym order lets meals in (the Evolt scan, then "head home", lib/reminders.js).
  const quietTo = Math.max(workoutEndedAt ? workoutEndedAt + AFTER_WORKOUT_QUIET_MIN * 60000 : 0, mealAfterGymAt || 0);
  if (workoutEndedAt && now >= workoutEndedAt && now < quietTo) return [];
  // His answer to the meal question (cooking, skipping...) counts as much as a logged meal (Thu 10/22 audit).
  // Sun 10/25 (Saturday's "Workout done at 4:41 PM. Time for your first meal..." 7 times, 5:10 to 8:19 PM, on top of
  // the meal-time asks at 4:52, 5:30 and 6:30 PM): one stream of meal check-ins, his Fri 10/23 rule. The ask, then
  // check-ins at the meal times' own spacing (MEAL_NUDGE.checkInMin), each in its own words, then quiet; and none
  // once his meal time's questions (lib/fuel-reminders.js) speak after the workout: they are the stream then.
  if (workoutEndedAt && now - workoutEndedAt < 4 * 3600000 && !(lastMealAt > workoutEndedAt) && !(mealAnsweredAt > workoutEndedAt)) {
    const handOver = Math.min(Infinity, ...reminders.filter((r) => r.kind === 'meals' && r.due && /^meal(-again)?:/.test(String(r.id)) && r.at > workoutEndedAt).map((r) => r.at));
    const times = [0, ...MEAL_NUDGE.checkInMin].map((m) => quietTo + m * 60000);
    const k = times.findLastIndex((t) => t <= now);
    const doneHm = formatHm(hmOf(new Date(workoutEndedAt), tz));
    const said = [
      `Workout done at ${doneHm}. Time for your first meal${targets?.protein && !eaten.unread ? `: ${nf(eaten.protein)} of ${targets.protein} g protein so far today` : ''}. Tell me what you eat.`,
      'Your meal after the gym: haven\'t heard from you. Eaten, cooking, or skipping it?',
      `Still nothing logged since your ${doneHm} workout. When are you eating, or are you skipping it?`,
      'Last check on your meal after the gym. Eating now, or skipping it today?',
    ];
    if (k >= 0 && now < handOver) out.push({ key: `meal-after:${workoutEndedAt}:${k}`, priority: 89, gapMin: ONCE_MIN, url: '#/fuel', text: said[k] });
  }
  const nowHm = formatHm(hmOf(new Date(now), tz));
  const sinceWake = ((minOf(hmOf(new Date(now), tz)) - minOf(wakeHm)) + 1440) % 1440;
  // His morning (Tue 10/20): the day runs from when he actually woke (else his usual wake time); the gym comes
  // gymAfterMin [from, to] minutes after that.
  const wokeHm = wokeAt ? hmOf(new Date(wokeAt), tz) : wakeHm;
  const sinceWoke = wokeAt ? Math.round((now - wokeAt) / 60000) : sinceWake;
  const after = Array.isArray(morning?.gymAfterMin) && morning.gymAfterMin.length === 2 ? morning.gymAfterMin : null;
  const gymText = after ? `${formatHm(addMin(wokeHm, after[0]))} to ${formatHm(addMin(wokeHm, after[1]))}` : null;

  // Sleep: the morning question, until noon. Asked once (Fri 10/23, his words: "you shouldn't keep on messaging me").
  if (!sleepLogged && sinceWake < Math.max(60, minOf('12:00') - minOf(wakeHm))) {
    out.push({ key: 'sleep', priority: 90, gapMin: ONCE_MIN, url: '#/coach',
      text: `How did you sleep? Tell me when you went to bed and when you woke up (your schedule: ${formatHm(bedHm)} to ${formatHm(wakeHm)}).` });
  }

  // His morning routine, once, in the first 90 minutes after he wakes (Tue 10/20).
  const train0 = rot?.today?.kind === 'train';
  if (morning?.text && sinceWoke >= 0 && sinceWoke < 90) {
    out.push({ key: 'morning', priority: 88, gapMin: 18 * 60, url: '#/today',
      text: `Morning: ${String(morning.text).replace(/[.\s]+$/, '')}.${train0 && gymText && !session.started ? ` Gym ${gymText}.` : ''}` });
  }

  // A body scan planned today (Tue 10/20): the checklist, once that day (Fri 10/23: it went out 4 times by 12:10 PM, "the
  // body scan, which you said twice... body scan again. You're not making any sense"); the scan reminders at his session
  // time (lib/scans.js) still come. After his sleep question, not ahead of it.
  if (scanToday) {
    out.push({ key: 'scan', priority: 87, gapMin: ONCE_MIN, url: '#/body/scan',
      text: `Body scan today, before you train: ${scanToday.items.join('; ')}. Then tell me the numbers.` });
  }

  // Today's session, and the Evolt before it.
  const train = rot?.today?.kind === 'train';
  // A gym day: still to train, or trained already (the rotation then says 'done').
  const gymDay = train || rot?.today?.kind === 'done';
  const label = LABEL[rot?.today?.dayType] || 'Your session';
  if (train && !session.started && !session.done) {
    if (sessionHm) {
      const at = zonedTime(isoDate(new Date(now), tz), sessionHm, tz);
      if (now >= at) out.push({ key: 'session', priority: 80, gapMin: 30, url: '#/train', text: `${label} was due at ${formatHm(sessionHm)}. Go now, or tell me the new time. Evolt first.` });
      else if (now >= at - 60 * 60000) out.push({ key: 'session', priority: 70, gapMin: 45, url: '#/train', text: `${label} at ${formatHm(sessionHm)}. Evolt first when you get there, then train.` });
    } else {
      out.push({ key: 'session', priority: 65, gapMin: 90, url: '#/train', text: `${label} today and no time set. When are you going?${gymText ? ` Your plan: ${gymText}.` : ''} Evolt first when you get there.` });
    }
  }
  // Not all evening: up to 3 hours after the workout (Thu 10/22 audit: every 40 minutes until bed, with no way to say no).
  if (gymDay && (session.started || session.done) && !weighedToday && !(workoutEndedAt && now - workoutEndedAt > 3 * 3600000)) {
    out.push({ key: 'evolt', priority: 75, gapMin: 40, url: '#/coach', text: 'Evolt number from today? Tell me the weight (and body fat if you have it).' });
  }

  // Planned reminders that already went out and are still open.
  for (const r of reminders) {
    const a = AGAIN[r.kind];
    // A one-off message (again: false) is not nudged again (Thu 10/22 audit: "Head home", the step-up question and the
    // after photo came back every half hour or hour); repeats the planner sends itself (group) aren't doubled.
    if (!a || !r.due || r.again === false || r.group || r.at > now || r.at < now - 16 * 3600000) continue;
    // A meal ask isn't nudged here: its own check-ins follow it (lib/fuel-reminders.js; Fri 10/23, "First meal is late"
    // came on top of them, and after the last meal's time).
    const title = String(r.title || '').replace(/[.:]?\s*$/, '');
    out.push({ key: `${a[0]}:${r.tag || r.id}`, priority: a[1], gapMin: a[2], url: r.url || '#/', calm: CALM_KINDS.has(r.kind),
      text: [/[?!]$/.test(title) ? title : `${title}.`, r.body].filter(Boolean).join(' ') });
  }

  // Food behind the day's pace (wake up to 2 hours before bed).
  const frac = dayFraction(now, tz, wakeHm, bedHm);
  // Supplements with no time set (no planned reminder asks about them): once the morning is over.
  if (suppsUntimed?.open?.length && frac >= 0.25) {
    const o = suppsUntimed.open;
    out.push({ key: 'supps-untimed', priority: 58, gapMin: 60, url: '#/supps',
      text: `Supplements: ${suppsUntimed.taken ?? suppsUntimed.total - o.length} of ${suppsUntimed.total} taken today. Still open: ${o.slice(0, 4).join(', ')}${o.length > 4 ? ` and ${o.length - 4} more` : ''}. Take them and tell me.` });
  }
  // A meal still being read counts as nothing yet: no "you're behind" until it's read (Thu 10/22 audit). A meal-time
  // question he hasn't answered yet: that one asks, not this too (Fri 10/23: "Food: 0 of 3,174 kcal... Eat." between
  // the meal asks).
  const mealAsked = reminders.some((r) => r.kind === 'meals' && String(r.id).startsWith('meal:') && r.due && r.at <= now);
  if (targets?.kcal && frac >= 0.15 && !eaten.unread && !mealAsked) {
    const expect = targets.kcal * frac;
    if (eaten.kcal < expect * 0.7 && expect - eaten.kcal >= 400) {
      out.push({ key: 'food', priority: 55, gapMin: 60, url: '#/fuel',
        text: `Food: ${nf(eaten.kcal)} of ${nf(targets.kcal)} kcal and ${nf(eaten.protein)} of ${targets.protein} g protein at ${nowHm}. You should be near ${nf(Math.round(expect / 50) * 50)} kcal by now. Eat.` });
    }
  }

  // Apple Health hasn't reached the Mac for hours (Tue 10/20, his steps missing): opening the app runs the export
  // (his Shortcuts automation), so one tap on this is the fix. Low priority, rarely.
  if (healthAt !== undefined && sinceWake >= 60 && (!healthAt || now - healthAt > STALE_HEALTH_H * 3600000)) {
    out.push({ key: 'health', priority: 25, gapMin: 240, url: '#/today', calm: true,
      text: `Steps and sleep: ${healthAt ? `last update ${formatHm(hmOf(new Date(healthAt), tz))}${isoDate(new Date(healthAt), tz) !== isoDate(new Date(now), tz) ? ' yesterday' : ''}` : 'nothing from Apple Health yet'}. Open the app once and they refresh.` });
  }

  // Steps behind, only from fresh Apple Health numbers (read in the last 3 hours).
  if (stepGoal && steps?.steps != null && steps.asOf && now - steps.asOf <= 3 * 3600000 && frac >= 0.3 && steps.steps < stepGoal * frac * 0.7) {
    out.push({ key: 'steps', priority: 30, gapMin: 90, url: '#/body',
      text: `Steps: ${nf(steps.steps)} by ${formatHm(hmOf(new Date(steps.asOf), tz))}, goal ${nf(stepGoal)}. Walk 15 minutes.` });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

// ---- The dishes after a meal (Tue 10/20, his words: "as soon as I finish a meal and I log it, obviously I tend to
// forget to clean my dishes... I need the coach to send me a notification 2 minutes after I finish and log it...
// just get up now, walk around for 1 minute, 2 minutes, get your body moving, and then it's going to be easy to clean
// the dishes") ----
export const DISHES_AFTER_MIN = 2;
/** A meal logged from a photo before eating, with no "after" photo: give him this long to eat. */
export const DISHES_EAT_MIN = 25;
export const DISHES_TEXT = "You just ate. I know you're full and want to sit, but the dishes won't clean themselves. Get up now, walk around for a minute or two to get moving, then wash them.";

/**
 * Meals whose dishes reminder is due now: 2 minutes after he logged it (the Mac first saw it), or after its "after"
 * photo; a meal logged by a photo before eating waits for the after photo or 25 minutes. Only meals eaten in the last
 * 3 hours (not ones he adds later for earlier), each once.
 * @param {object} o
 * @param {Array} o.meals          today's meals
 * @param {Object<string, number>} o.seen   meal id -> when the Mac first saw it, ms
 * @param {Object<string, number>} o.sent   meal id -> when its reminder went out
 * @returns {Array<object>} the meals, oldest first
 */
export function dishesDue({ meals = [], seen = {}, sent = {}, now = Date.now(), readyAt = {} }) {
  return meals.filter((m) => m?.id && !sent[m.id] && seen[m.id] && (m.at || 0) > now - 3 * 3600000).filter((m) => {
    // A meal whose dishes wait for something else (his collagen after the second meal): due at that time, or not yet.
    if (m.id in readyAt) return now >= readyAt[m.id];
    return now - mealEatenAt(m, seen[m.id]) >= DISHES_AFTER_MIN * 60000;
  }).sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** When a meal counts as eaten: when the Mac saw it, its "after" photo, or 23 minutes after a photo taken before eating. */
export function mealEatenAt(m, seenAt) {
  const after = m.after?.at || null;
  const photoBefore = m.source === 'photo' && m.before?.photoId && !after;
  return after ? Math.max(after, seenAt) : seenAt + (photoBefore ? (DISHES_EAT_MIN - DISHES_AFTER_MIN) * 60000 : 0);
}

// ---- A meal eaten out (Fri 10/23, his words: "if I'm eating outside, you should say: Oh, you're eating outside, when
// you're back home, take those supplements. And then I'll remind you later again"): his supplements are at home, so
// after a meal out the message says take them once home, no dishes, and the reminder comes later. ----
/** How long after a meal out before "back home yet?". */
export const AWAY_REMIND_MIN = 30;
const OUT_WORDS = /\b(eat(ing)?|ate|lunch|dinner|breakfast|meal|food)\s+(out|outside)\b|\bout to eat\b|\brestaurant\b/i;

/**
 * Did he eat this meal away from home? Its own mark (log_meal away), else a food hold-off he asked for because he was
 * going out to eat ("Going out to eat now"), running when he ate (from 30 minutes before it was set).
 */
export function ateOut(m, holds = []) {
  if (!m) return false;
  if (m.away != null) return Boolean(m.away);
  const at = m.at || 0;
  return holds.some((h) => h && (h.areas || []).some((a) => a === 'food' || a === 'all') && OUT_WORDS.test(h.reason || '')
    && (h.from ?? h.at ?? 0) - 30 * 60000 <= at && at <= Math.min(h.until || 0, h.cancelledAt || Infinity));
}

/**
 * His own time for the supplements after a meal (Fri 10/23, his words: "I told him that I'm gonna go to Decathlon. And
 * he responded: Decathlon 5:44 and then supplements at home 5:59. Right now it's 5:42. And at 5:41 I got back home yet
 * a message"): a reminder he had the coach set after that meal about being home or these supplements. The app's own
 * "take them now" / "back home yet?" waits for it, and for AWAY_REMIND_MIN after it went out (his reminder asks first).
 * @param {Array} reminders  today's reminders (remindersFor shape: kind 'coach', at, body, due) or coach-reminders records
 * @param {string[]} names   the supplements still open
 * @param {number} since     the meal's time, ms
 * @returns {number} when the app may ask, ms (0 = no reminder of his)
 */
export function ownSuppsTime(reminders = [], names = [], since = 0) {
  const words = [...new Set(names.flatMap((n) => String(n).toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => (w.length >= 4 || /^[a-z]\d$/.test(w)) && !/^(vitamin|with|after|daily)$/.test(w)))];
  const about = (t) => /\bhome\b|\bsupp(lement)?s?\b/i.test(t) || String(t).toLowerCase().split(/[^a-z0-9]+/).some((w) => words.includes(w));
  const mine = reminders.filter((r) => r && (r.kind === 'coach' || (r.kind == null && 'text' in r)) && r.due !== false && !r.cancelledAt
    && !r.trigger && r.at >= since && about(r.body ?? r.text ?? ''));
  return mine.length ? Math.max(...mine.map((r) => r.at)) + AWAY_REMIND_MIN * 60000 : 0;
}

/**
 * Did this meal leave dishes at home? Only a meal he cooked at home himself (Sun 10/25, his words: "no reason to get
 * dishes noti when i ate lays thats a snack... Cooking a meal only then it should be active so no takeout either like
 * the pizza i had earlier"): never a Snack, a meal eaten out, or one he didn't cook (takeout, delivery, ready-made:
 * its mark cooked: false, from log_meal or correct_meal).
 */
export function leavesDishes(m, holds = []) {
  return Boolean(m) && !isSnack(m) && m.cooked !== false && !ateOut(m, holds);
}

// ---- After the second meal (Thu 10/22, his words: "after my second meal have it prompt first notification that i
// should get up and take collagen and wait until i take it... bump me in five minutes if i haven't responded and keep
// bumping me until i take it and after that's done then i should get a notification immediately prompted for me to
// clean the dishes") ----
export const AFTER_MEAL2_BUMP_MIN = 5;

/** Whether it's time for a nudge at all. */
export function nudgeDue({ now, everyMin = NUDGE_DEFAULTS.everyMin, awake = true, lastNudgeAt = 0, lastNoticeAt = 0, lastUserAt = 0, busy = false, pausedUntil = 0 }) {
  if (!everyMin || !awake || busy || now < (pausedUntil || 0)) return false;
  if (now - lastNudgeAt < everyMin * 60000) return false;
  if (now - lastNoticeAt < QUIET_AFTER_MIN * 60000) return false;
  if (now - lastUserAt < QUIET_AFTER_MIN * 60000) return false;
  return true;
}

/** The candidate to send: the most important one not nudged within its own gap, or null. */
export function pickNudge(candidates = [], sentByKey = {}, now = Date.now()) {
  return candidates.find((c) => now - (sentByKey[c.key] || 0) >= c.gapMin * 60000) || null;
}

// ---- The start of his day (Fri 10/23, his words: "you should have asked me if I'm awake... Since I haven't messaged
// you... you shouldn't keep on messaging me... my sore back from yesterday's workout... you should have started with
// that. That's way more important than morning hold or the body scan"): his morning holds came first at 10:01 AM, the
// scan checklist 4 times, "How did you sleep?" only at 11:18 AM and nothing about his back. Now one question at a
// time, in a human order: are you up, then sleep, then his body (pain from his last workout first), then the day's
// plan. Nothing else of his day goes out before that. ----
// Sat 10/24, his words (again): "you should have asked me if I'm awake... Since I haven't messaged you... you shouldn't
// keep on messaging me": "Are you up?" went out at 10:00 AM, no answer, and at 2:00 PM the day went on anyway (the plan,
// the walk, the scan, the coach's holds talk). Now no answer to "Are you up?" means quiet until he messages or opens
// the app, however long; then sleep, his body, the plan.
/**
 * giveUpH: once he's up, the morning questions left this long after his wake time (or after he got up, if later),
 * the day goes on as usual. Never while he hasn't shown he's up.
 * waitMin: a question he leaves this long counts as passed over, the next one comes. quietMin: after his message or
 * the coach's reply, this long before the next question.
 */
export const MORNING = { giveUpH: 4, waitMin: 30, quietMin: 3 };
export const MORNING_UP_TEXT = 'Morning. Are you up?';
export const PAIN_WORDS = /\b(pain\w*|hurts?|hurting|sore\w*|ache[sd]?|aching|tweak\w*|strain\w*)\b/i;
const BODY_PART = /\b(lower back|upper back|back|knees?|shoulders?|elbows?|wrists?|hips?|neck|hamstrings?|quads?|groin|calf|calves|ankles?|chest)\b/gi;

/**
 * Pain from his last workout before today (in the 2 days before): the exercise notes, skip reasons, set notes and pain
 * scores. {label, date, parts, exercise} or null.
 */
export function lastWorkoutPain({ sessions = [], sets = [], today, tz }) {
  const from = isoDate(new Date(Date.parse(`${today}T12:00:00Z`) - 2 * 86400000), 'UTC');
  const last = sessions.filter((x) => x?.startedAt && x.kind !== 'holds' && x.status !== 'discarded' && x.status !== 'active')
    .map((x) => ({ x, d: isoDate(new Date(x.startedAt), tz) })).filter(({ d }) => d < today && d >= from)
    .sort((a, b) => b.x.startedAt - a.x.startedAt)[0];
  if (!last) return null;
  const se = last.x;
  const mine = sets.filter((s) => s?.sessionId === se.id);
  const hits = [];
  for (const e of se.exercises || []) {
    const texts = [e.notes, e.skipped?.reason, ...mine.filter((s) => s.exKey === e.key).map((s) => s.note)].filter(Boolean).map(String);
    const said = texts.filter((t) => PAIN_WORDS.test(t));
    const scored = mine.some((s) => s.exKey === e.key && Number(s.pain) >= 3);
    if (said.length || scored) hits.push({ name: e.name, parts: said.flatMap((t) => (t.match(BODY_PART) || []).map((p) => p.toLowerCase())), skipped: Boolean(e.skipped) });
  }
  if (se.note && PAIN_WORDS.test(se.note)) hits.push({ name: null, parts: (String(se.note).match(BODY_PART) || []).map((p) => p.toLowerCase()) });
  if (!hits.length) return null;
  let parts = [...new Set(hits.flatMap((h) => h.parts))];
  if (parts.includes('lower back') || parts.includes('upper back')) parts = parts.filter((p) => p !== 'back');
  return { label: LABEL[se.dayType] || se.title || 'workout', date: last.d, parts, exercise: hits.find((h) => h.name && !h.skipped)?.name || hits.find((h) => h.name)?.name || null };
}

/** The body question of his morning: the pain from his last workout first, else how the body feels. */
export function morningBodyText(pain, today, tz) {
  if (!pain) return 'How does your body feel today? Knees, legs, back: 0 to 3.';
  const yesterday = isoDate(new Date(Date.parse(`${today}T12:00:00Z`) - 86400000), 'UTC');
  const day = pain.date === yesterday ? 'yesterday' : `on ${formatDayIso(pain.date)}`;
  const where = pain.parts.length ? pain.parts.join(' and ') : 'body';
  const on = pain.exercise ? ` on ${pain.exercise.replace(/\s*\(.*\)$/, '').toLowerCase()}` : '';
  return `How's your ${where} today? It hurt${on} ${day} (${pain.label}). 0 to 3, and does it still hurt when you bend or move?`;
}
const formatDayIso = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', timeZone: 'UTC' }).replace(',', '');

/**
 * Where his morning is. One question at a time; the day's reminders and nudges wait (hold) until it's through.
 * @param {object} o
 * @param {number} o.now
 * @param {number} o.wakeAt      his usual wake time today (Settings), ms
 * @param {number|null} o.upAt   the first sign he's up today (a message, a meal, a workout, the app opened...), ms
 * @param {boolean} o.sleepKnown last night's sleep logged
 * @param {boolean} o.bodyKnown  today's check-in done, or he trained today already
 * @param {{up?: number, sleep?: number, body?: number, open?: number}} o.state  when each was asked today; open = done
 * @param {{sleep?: number, body?: number}} o.coachAsked  the coach asked it itself in Talk (its reply), when
 * @param {number} o.lastUserAt  his last message, ms
 * @param {number} o.lastCoachAt the coach's last message or notification, ms
 * @param {string} o.bodyText    the body question
 * @returns {{hold: boolean, open: boolean, ask: {key: string, text: string}|null}}
 */
export function morningStep({ now, wakeAt, upAt = null, sleepKnown = false, bodyKnown = false, state = {}, coachAsked = {}, lastUserAt = 0, lastCoachAt = 0, bodyText = morningBodyText(null) }) {
  if (state.open) return { hold: false, open: true, ask: null };
  // Before his day starts: the wake-time rules hold things already.
  if (now < Math.min(wakeAt, upAt ?? Infinity)) return { hold: false, open: false, ask: null };
  if (!upAt) return { hold: true, open: false, ask: state.up ? null : { key: 'up', text: MORNING_UP_TEXT } };
  if (now - Math.max(wakeAt, upAt) >= MORNING.giveUpH * 3600000) return { hold: false, open: true, ask: null };
  const quiet = now - Math.max(lastUserAt || 0, lastCoachAt || 0) >= MORNING.quietMin * 60000;
  const steps = [['sleep', sleepKnown, 'How did you sleep? When did you go to bed and when did you wake up?'], ['body', bodyKnown, bodyText]];
  for (const [key, known, text] of steps) {
    if (known) continue;
    const askedAt = Math.max(state[key] || 0, coachAsked[key] || 0);
    if (!askedAt) return { hold: true, open: false, ask: quiet ? { key, text } : null };
    // Answered (he wrote after it) or passed over: the next one.
    if (!(lastUserAt > askedAt) && now - askedAt < MORNING.waitMin * 60000) return { hold: true, open: false, ask: null };
  }
  // Then the plan: not on top of his answer or the coach's reply either.
  return quiet ? { hold: false, open: true, ask: null } : { hold: true, open: false, ask: null };
}
