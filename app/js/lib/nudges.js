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

export const NUDGE_DEFAULTS = { everyMin: 20, wakeHm: '07:00', bedHm: '22:00' };
export const NUDGE_EVERY = [[15, 'Every 15 minutes'], [20, 'Every 20 minutes'], [30, 'Every 30 minutes'], [0, 'Off']];
/** Quiet this long after any notification, and after he last wrote to the coach. */
export const QUIET_AFTER_MIN = 10;
/** No nudges this long after a workout ends (shower, not hungry yet); then the first meal. */
export const AFTER_WORKOUT_QUIET_MIN = 20;
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
  if (calm) return { title: 'Coach', body: facts };
  const line = pickLine(bank, 'nudge', { moods, intensity, rng, avoid });
  return { title: 'Coach', body: line?.text ? `${facts} ${line.text}` : facts };
}

/** A planned reminder (lib/reminders.js) said by the coach: its title becomes the first sentence. */
export function coachReminder(item, opts = {}) {
  const head = String(item.title || '').replace(/[.?!:]?\s*$/, (m) => (/[?!]/.test(m) ? m.trim() : '.'));
  const text = [head, item.body].filter(Boolean).join(' ');
  return coachVoice(text, { ...opts, calm: opts.calm || CALM_KINDS.has(item.kind) });
}

// Which planned reminders are nudged again while still open: [key prefix, priority, minutes between nudges].
const AGAIN = { readiness: ['checkin', 85, 20], holds: ['holds', 50, 60], meals: ['meals', 55, 45], supps: ['supps', 60, 45], recovery: ['recovery', 40, 120] };

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
 * @param {{open: string[], total: number}|null} o.suppsUntimed  today's supplements with no time set: names still open
 * @param {string} o.wakeHm
 * @param {string} o.bedHm
 * @param {number|null} o.wokeAt   when he actually woke today (his sleep log or Apple Health), ms
 * @param {{text?: string, gymAfterMin?: number[]}|null} o.morning  his morning routine (settings.notify.morning)
 * @param {number|null} o.workoutEndedAt  when today's workout was finished, ms
 * @param {number|null} o.lastMealAt      his latest meal today, ms
 * @returns {Array<{key: string, priority: number, gapMin: number, text: string, url: string, calm?: boolean}>}
 */
export function nudgeCandidates({ now, tz, reminders = [], rot = null, sessionHm = null, session = {}, weighedToday = false, sleepLogged = true,
  eaten = { kcal: 0, protein: 0 }, targets = null, steps = null, stepGoal = null, suppsUntimed = null, scanToday = null, wakeHm = NUDGE_DEFAULTS.wakeHm, bedHm = NUDGE_DEFAULTS.bedHm,
  wokeAt = null, morning = null, workoutEndedAt = null, lastMealAt = null }) {
  const out = [];
  // After the workout (Tue 10/20, his words: "I'm usually not hungry immediately and I obviously need to take a
  // shower... wait 20 minutes after my workout is finished and then he should bump me about my first meal"): quiet
  // for 20 minutes, then the meal comes first, before supplements and the rest.
  if (workoutEndedAt && now >= workoutEndedAt && now - workoutEndedAt < AFTER_WORKOUT_QUIET_MIN * 60000) return [];
  if (workoutEndedAt && now - workoutEndedAt < 4 * 3600000 && !(lastMealAt > workoutEndedAt)) {
    out.push({ key: 'meal-after', priority: 89, gapMin: 30, url: '#/fuel',
      text: `Workout done at ${formatHm(hmOf(new Date(workoutEndedAt), tz))}. Time for your first meal${targets?.protein ? `: ${nf(eaten.protein)} of ${targets.protein} g protein so far today` : ''}. Tell me what you eat.` });
  }
  const nowHm = formatHm(hmOf(new Date(now), tz));
  const sinceWake = ((minOf(hmOf(new Date(now), tz)) - minOf(wakeHm)) + 1440) % 1440;
  // His morning (Tue 10/20): the day runs from when he actually woke (else his usual wake time); the gym comes
  // gymAfterMin [from, to] minutes after that.
  const wokeHm = wokeAt ? hmOf(new Date(wokeAt), tz) : wakeHm;
  const sinceWoke = wokeAt ? Math.round((now - wokeAt) / 60000) : sinceWake;
  const after = Array.isArray(morning?.gymAfterMin) && morning.gymAfterMin.length === 2 ? morning.gymAfterMin : null;
  const gymText = after ? `${formatHm(addMin(wokeHm, after[0]))} to ${formatHm(addMin(wokeHm, after[1]))}` : null;

  // Sleep: the morning question until he answers (until noon).
  if (!sleepLogged && sinceWake < Math.max(60, minOf('12:00') - minOf(wakeHm))) {
    out.push({ key: 'sleep', priority: 90, gapMin: 40, url: '#/coach',
      text: `How did you sleep? Tell me when you went to bed and when you woke up (your schedule: ${formatHm(bedHm)} to ${formatHm(wakeHm)}).` });
  }

  // His morning routine, once, in the first 90 minutes after he wakes (Tue 10/20).
  const train0 = rot?.today?.kind === 'train';
  if (morning?.text && sinceWoke >= 0 && sinceWoke < 90) {
    out.push({ key: 'morning', priority: 88, gapMin: 18 * 60, url: '#/today',
      text: `Morning: ${String(morning.text).replace(/[.\s]+$/, '')}.${train0 && gymText && !session.started ? ` Gym ${gymText}.` : ''}` });
  }

  // A body scan planned today (Tue 10/20): the checklist until it's done, ahead of everything else.
  if (scanToday) {
    out.push({ key: 'scan', priority: 92, gapMin: 30, url: '#/body/scan',
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
  if (gymDay && (session.started || session.done) && !weighedToday) {
    out.push({ key: 'evolt', priority: 75, gapMin: 40, url: '#/coach', text: 'Evolt number from today? Tell me the weight (and body fat if you have it).' });
  }

  // Planned reminders that already went out and are still open.
  for (const r of reminders) {
    const a = AGAIN[r.kind];
    if (!a || !r.due || r.at > now || r.at < now - 16 * 3600000) continue;
    out.push({ key: `${a[0]}:${r.tag || r.id}`, priority: a[1], gapMin: a[2], url: r.url || '#/', calm: CALM_KINDS.has(r.kind),
      text: [String(r.title || '').replace(/[.:]?\s*$/, '.'), r.body].filter(Boolean).join(' ') });
  }

  // Food behind the day's pace (wake up to 2 hours before bed).
  const frac = dayFraction(now, tz, wakeHm, bedHm);
  // Supplements with no time set (no planned reminder asks about them): once the morning is over.
  if (suppsUntimed?.open?.length && frac >= 0.25) {
    const o = suppsUntimed.open;
    out.push({ key: 'supps-untimed', priority: 58, gapMin: 60, url: '#/supps',
      text: `Supplements: ${suppsUntimed.total - o.length} of ${suppsUntimed.total} taken today. Still open: ${o.slice(0, 4).join(', ')}${o.length > 4 ? ` and ${o.length - 4} more` : ''}. Take them and tell me.` });
  }
  if (targets?.kcal && frac >= 0.15) {
    const expect = targets.kcal * frac;
    if (eaten.kcal < expect * 0.7 && expect - eaten.kcal >= 400) {
      out.push({ key: 'food', priority: 55, gapMin: 60, url: '#/fuel',
        text: `Food: ${nf(eaten.kcal)} of ${nf(targets.kcal)} kcal and ${nf(eaten.protein)} of ${targets.protein} g protein at ${nowHm}. You should be near ${nf(Math.round(expect / 50) * 50)} kcal by now. Eat.` });
    }
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
export function dishesDue({ meals = [], seen = {}, sent = {}, now = Date.now() }) {
  return meals.filter((m) => m?.id && !sent[m.id] && seen[m.id] && (m.at || 0) > now - 3 * 3600000).filter((m) => {
    const after = m.after?.at || null;
    const photoBefore = m.source === 'photo' && m.before?.photoId && !after;
    const from = after ? Math.max(after, seen[m.id]) : seen[m.id] + (photoBefore ? (DISHES_EAT_MIN - DISHES_AFTER_MIN) * 60000 : 0);
    return now - from >= DISHES_AFTER_MIN * 60000;
  }).sort((a, b) => (a.at || 0) - (b.at || 0));
}

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
