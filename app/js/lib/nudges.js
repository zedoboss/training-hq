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
/** Kinds of reminder that speak plainly (no mood line). */
const CALM_KINDS = new Set(['sauna', 'recovery', 'scan']);

const minOf = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
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
 * @param {{open: string[], total: number}|null} o.suppsUntimed  today's supplements with no time set: names still open
 * @param {string} o.wakeHm
 * @param {string} o.bedHm
 * @returns {Array<{key: string, priority: number, gapMin: number, text: string, url: string, calm?: boolean}>}
 */
export function nudgeCandidates({ now, tz, reminders = [], rot = null, sessionHm = null, session = {}, weighedToday = false, sleepLogged = true,
  eaten = { kcal: 0, protein: 0 }, targets = null, steps = null, stepGoal = null, suppsUntimed = null, wakeHm = NUDGE_DEFAULTS.wakeHm, bedHm = NUDGE_DEFAULTS.bedHm }) {
  const out = [];
  const nowHm = formatHm(hmOf(new Date(now), tz));
  const sinceWake = ((minOf(hmOf(new Date(now), tz)) - minOf(wakeHm)) + 1440) % 1440;

  // Sleep: the morning question until he answers (until noon).
  if (!sleepLogged && sinceWake < Math.max(60, minOf('12:00') - minOf(wakeHm))) {
    out.push({ key: 'sleep', priority: 90, gapMin: 40, url: '#/coach',
      text: `How did you sleep? Tell me when you went to bed and when you woke up (your schedule: ${formatHm(bedHm)} to ${formatHm(wakeHm)}).` });
  }

  // Today's session, and the Evolt before it.
  const train = rot?.today?.kind === 'train';
  const label = LABEL[rot?.today?.dayType] || 'Your session';
  if (train && !session.started && !session.done) {
    if (sessionHm) {
      const at = zonedTime(isoDate(new Date(now), tz), sessionHm, tz);
      if (now >= at) out.push({ key: 'session', priority: 80, gapMin: 30, url: '#/train', text: `${label} was due at ${formatHm(sessionHm)}. Go now, or tell me the new time. Evolt first.` });
      else if (now >= at - 60 * 60000) out.push({ key: 'session', priority: 70, gapMin: 45, url: '#/train', text: `${label} at ${formatHm(sessionHm)}. Evolt first when you get there, then train.` });
    } else {
      out.push({ key: 'session', priority: 65, gapMin: 90, url: '#/train', text: `${label} today and no time set. When are you going? Evolt first when you get there.` });
    }
  }
  if (train && (session.started || session.done) && !weighedToday) {
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

/** Whether it's time for a nudge at all. */
export function nudgeDue({ now, everyMin = NUDGE_DEFAULTS.everyMin, awake = true, lastNudgeAt = 0, lastNoticeAt = 0, lastUserAt = 0, busy = false }) {
  if (!everyMin || !awake || busy) return false;
  if (now - lastNudgeAt < everyMin * 60000) return false;
  if (now - lastNoticeAt < QUIET_AFTER_MIN * 60000) return false;
  if (now - lastUserAt < QUIET_AFTER_MIN * 60000) return false;
  return true;
}

/** The candidate to send: the most important one not nudged within its own gap, or null. */
export function pickNudge(candidates = [], sentByKey = {}, now = Date.now()) {
  return candidates.find((c) => now - (sentByKey[c.key] || 0) >= c.gapMin * 60000) || null;
}
