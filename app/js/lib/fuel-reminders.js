// Step 6 reminders, planned with the others in reminders.js and sent by the Mac (brief section 6, Notifications):
// meal times with nothing logged ("Eaten, cooking, or skipping?"), the after photo about 25 minutes after a before
// photo. Supplements and the sauna add theirs here too.
import { zonedTime, formatHm, addMinutesHm, formatTime } from './time.js';
import { afterPhotoAt } from './meals.js';
import { checklist, shortName, statusOn, stockStatus, lastsText } from './supplements.js';
import { addDays } from './rotation.js';
import { ladderState, stepText, plannedHm, OVERDUE_MIN } from './sauna.js';

/** Minutes after a meal time before asking, how far back a meal counts for it, and when "cooking" asks again. */
export const MEAL_NUDGE = { afterMin: 45, windowMin: 90, cookingMin: 30 };

const hmId = (hm) => hm.replace(':', '');

/**
 * His meal times, sorted, valid ones only: [{name, time 'HH:MM', latest?: 'HH:MM', cookMin?: number}]. latest: the
 * latest he wants to have eaten it; cookMin: a "start cooking" reminder that many minutes before (Tue 10/20, his
 * words: "first meal ... at 12:30 and my last meal at 4:30 ... with 5 pm being the latest ... reminders like that,
 * I need to cook and so on").
 */
export const mealTimesOf = (list) => (list || []).filter((t) => /^\d{2}:\d{2}$/.test(t?.time || '') && t.name)
  .map((t) => ({ ...t, latest: /^\d{2}:\d{2}$/.test(t.latest || '') && t.latest > t.time ? t.latest : null, cookMin: Number(t.cookMin) > 0 ? Math.round(Number(t.cookMin)) : null }))
  .sort((a, b) => a.time.localeCompare(b.time));

/**
 * Meal reminders for one date.
 * @param {object} o
 * @param {string} o.date
 * @param {string} [o.tz]
 * @param {Array} o.meals        all meals (any date)
 * @param {Array} o.checks       'meal-checks' answers: {id: '<date>.<HHMM>', date, slot, answer: eaten|cooking|skipped, at}
 * @param {Array} o.mealTimes    his meal times (Settings > Fuel); none = no meal-time reminders
 */
export function mealReminders({ date, tz, meals = [], checks = [], mealTimes = [] }) {
  const out = [];
  const today = meals.filter((m) => m.date === date).sort((a, b) => a.at - b.at);
  for (const slot of mealTimesOf(mealTimes)) {
    const slotAt = zonedTime(date, slot.time, tz);
    const id = `${date}.${hmId(slot.time)}`;
    const check = checks.find((c) => c.id === id);
    const logged = today.some((m) => m.at >= slotAt - MEAL_NUDGE.windowMin * 60000);
    const before = today.filter((m) => m.at < slotAt - MEAL_NUDGE.windowMin * 60000).at(-1);
    // With a latest time the meal is a target: asked at its time; without, 45 minutes after it.
    const askHm = slot.latest ? slot.time : addMinutesHm(slot.time, MEAL_NUDGE.afterMin);
    if (slot.cookMin) {
      // Once, at its time: start cooking so it's on the plate at the meal time.
      out.push({
        id: `meal-cook:${date}:${hmId(slot.time)}`, kind: 'cook', at: slotAt - slot.cookMin * 60000, url: '#/fuel',
        tag: `meal-${date}-${hmId(slot.time)}`, fixed: false, title: `Start cooking: ${slot.name.toLowerCase()} at ${formatHm(slot.time)}`,
        body: `${slot.cookMin} minutes to get it on the plate${slot.latest ? `; ${formatHm(slot.latest)} at the latest` : ''}.`,
        due: !logged && !check,
      });
    }
    out.push({
      id: `meal:${date}:${hmId(slot.time)}`, kind: 'meals', at: zonedTime(date, askHm, tz), url: `#/fuel/check/${date}/${hmId(slot.time)}`,
      tag: `meal-${date}-${hmId(slot.time)}`, fixed: false, title: `${slot.name} time`,
      // The last meal by its time, not its name (Tue 10/20: "Lunch time ... nothing logged since lunch", his 2:22 PM
      // meal had been named Lunch before he set his meal times).
      body: `${formatHm(askHm)}, nothing logged ${before ? `since your ${formatTime(new Date(before.at), tz)} meal` : 'yet today'}.${slot.latest ? ` ${formatHm(slot.latest)} at the latest.` : ''} Eaten, cooking, or skipping?`,
      due: !logged && !check,
      ...(slot.latest ? { latestAt: zonedTime(date, slot.latest, tz), name: slot.name } : {}),
    });
    // "Cooking": ask again a little later, until a meal is logged.
    if (check?.answer === 'cooking') {
      const again = check.at + MEAL_NUDGE.cookingMin * 60000;
      out.push({
        id: `meal-cooking:${date}:${hmId(slot.time)}:${check.at}`, kind: 'meals', at: again, url: `#/fuel/check/${date}/${hmId(slot.time)}`,
        tag: `meal-${date}-${hmId(slot.time)}`, fixed: false, title: `${slot.name}: ready?`, body: 'Take the before photo when it is on the plate. Eaten, or skipping?',
        due: !today.some((m) => m.at >= check.at),
      });
    }
  }
  // After photo, about 25 minutes after the before photo.
  for (const m of today) {
    if (!m.before?.photoId || m.source !== 'photo') continue;
    out.push({
      id: `meal-after:${m.id}`, kind: 'meals', at: afterPhotoAt(m), url: `#/meal/${m.id}`, tag: `meal-after-${m.id}`, fixed: false,
      title: `${m.name}: after photo`, body: 'Take the after photo of what is left, or tap Ate it all.', due: !m.after,
    });
  }
  return out;
}

/** Supplement follow-ups: every 45 minutes after the time, up to 3 times, while something is still unanswered. */
export const SUPP_FOLLOW = { everyMin: 45, max: 3 };
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Supplement reminders for one date (6.6): at each of his times, then follow-ups until each item is ticked or skipped
 * (brief: it keeps asking and never assumes). Also returns what is still open, for the evening round-up.
 * @returns {{items: Array, open: Array<string>}}
 */
export function suppReminders({ date, tz, supps = [], log = [], dayKind = 'train', follow = SUPP_FOLLOW }) {
  const items = [];
  const groups = checklist({ supps, log, date, dayKind });
  for (const g of groups.filter((x) => x.time)) {
    const id = g.time.replace(':', '');
    const at = zonedTime(date, g.time, tz);
    items.push({
      id: `supps:${date}:${id}`, kind: 'supps', at, url: `#/supps/${date}`, tag: `supps-${date}-${id}`, fixed: true,
      title: `${g.label} supplements`, body: `${g.items.map((i) => `${cap1(shortName(i.supp))} ${i.dose}`).join(', ')}. Tap to tick them off.`,
      due: g.open.length > 0,
    });
    const open = g.open;
    const text = open.length === 1
      ? `${cap1(shortName(open[0].supp))} still unticked.${open[0].supp.doseRest ? ` It's a ${dayKind === 'rest' ? 'rest' : 'training'} day, so ${open[0].dose}.` : ''}`
      : `${g.label} stack's still open: ${open.map((i) => shortName(i.supp)).join(', ')}. Taken or skipped?`;
    for (let k = 1; k <= follow.max; k++) {
      items.push({
        id: `supps-again:${date}:${id}:${k}`, kind: 'supps', at: at + k * follow.everyMin * 60000, url: `#/supps/${date}`, tag: `supps-${date}-${id}`, fixed: false,
        title: `${g.label} supplements still open`, body: text, due: open.length > 0,
      });
    }
  }
  return { items, open: groups.flatMap((g) => g.open.map((i) => shortName(i.supp))) };
}

/** The latest planning answer about one supplement's current stock count, or the latest weekly one. */
export const lowAnswered = (supp, answers = []) => answers.some((a) => a.kind === 'low' && a.suppId === supp.id && a.countedAt === supp.stock?.countedAt);
export function weeklyAnsweredSince(answers = [], fromIso) {
  return answers.some((a) => a.kind === 'weekly' && a.date >= fromIso);
}

/**
 * Stock and planning (6.7): "Creatine: 7 servings left, about a week. Restocking?" every evening until he answers for
 * that count, and roughly once a week "planning to get anything?" (brief section 6). The app records his answer and
 * changes nothing on the list.
 */
export function planReminders({ date, tz, supps = [], log = [], answers = [], eveningHm = '20:30', weekday = 0 }) {
  const out = [];
  for (const s of supps.filter((x) => statusOn(x, date) === 'active')) {
    const st = stockStatus(s, log);
    if (!st?.low) continue;
    out.push({
      id: `supps-low:${s.id}:${date}`, kind: 'supps', at: zonedTime(date, addMinutesHm(eveningHm, 10), tz), url: `#/supps/plan/${s.id}`, tag: `supps-low-${s.id}`, fixed: false,
      title: `${s.name}: running low`, body: `${cap1(shortName(s))}: ${st.left} serving${st.left === 1 ? '' : 's'} left, ${lastsText(st.days)}. Restocking?`, due: !lowAnswered(s, answers),
    });
  }
  if (new Date(`${date}T12:00:00Z`).getUTCDay() === weekday && supps.some((x) => statusOn(x, date) === 'active')) {
    out.push({
      id: `supps-plan:${date}`, kind: 'supps', at: zonedTime(date, addMinutesHm(eveningHm, 15), tz), url: '#/supps/plan', tag: 'supps-plan', fixed: false,
      title: 'Supplements: planning to get anything?', body: 'Restock anything, or add something new? Tap to answer.',
      due: !weeklyAnsweredSince(answers, addDays(date, -6)),
    });
  }
  return out;
}

/**
 * Sauna (6.9, brief section 11): a reminder on a planned sauna day with the day's step and the checklist; a backup for
 * the overdue alarm (the phone's own alarm needs the app on screen; this push comes from the Mac at the same moment);
 * and the symptom question 15 minutes after the last round.
 */
export function saunaReminders({ date, tz, sessions = [], plan = {} }) {
  const out = [];
  const p = (plan.planned || []).find((x) => x.date === date);
  if (p) {
    const st = ladderState(sessions, date, plan);
    out.push({
      id: `sauna-day:${date}`, kind: 'sauna', at: zonedTime(date, plannedHm(p), tz), url: '#/sauna', tag: `sauna-${date}`, fixed: true,
      title: 'Sauna today', body: `${stepText(st.step)}. Checklist first: eaten and drunk, no alcohol, not ill, slept, energy 2 or 3, water and a cold towel, someone knows you're in there. Never before lifting.`,
      due: !sessions.some((s) => s.date === date),
    });
  }
  for (const s of sessions.filter((x) => x.date === date)) {
    for (const r of (s.rounds || []).filter((x) => x.inAt)) {
      if (s.status !== 'active' && r.outAt) continue;
      out.push({
        id: `sauna-overdue:${s.id}:${r.n}`, kind: 'sauna', at: r.inAt + (r.planned + OVERDUE_MIN) * 60000, url: `#/sauna/run/${s.id}`, tag: `sauna-overdue-${s.id}`, fixed: false,
        title: 'Sauna: overdue', body: `Round ${r.n} was ${r.planned} minutes. Get out now and tap OUT.`, due: s.status === 'active' && !r.outAt,
      });
    }
    if (s.after?.dueAt) {
      out.push({
        id: `sauna-after:${s.id}`, kind: 'sauna', at: s.after.dueAt, url: `#/sauna/run/${s.id}`, tag: `sauna-after-${s.id}`, fixed: false,
        title: 'Sauna: 15 minutes after', body: 'Any symptoms? Tap to answer.', due: !s.after.answeredAt,
      });
    }
  }
  return out;
}
