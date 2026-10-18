// Step 6 reminders, planned with the others in reminders.js and sent by the Mac (brief section 6, Notifications):
// meal times with nothing logged ("Eaten, cooking, or skipping?"), the after photo about 25 minutes after a before
// photo. Supplements and the sauna add theirs here too.
import { zonedTime, formatHm, addMinutesHm } from './time.js';
import { afterPhotoAt } from './meals.js';

/** Minutes after a meal time before asking, how far back a meal counts for it, and when "cooking" asks again. */
export const MEAL_NUDGE = { afterMin: 45, windowMin: 90, cookingMin: 30 };

const hmId = (hm) => hm.replace(':', '');

/** His meal times, sorted, valid ones only: [{name, time 'HH:MM'}]. */
export const mealTimesOf = (list) => (list || []).filter((t) => /^\d{2}:\d{2}$/.test(t?.time || '') && t.name).sort((a, b) => a.time.localeCompare(b.time));

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
    const askHm = addMinutesHm(slot.time, MEAL_NUDGE.afterMin);
    out.push({
      id: `meal:${date}:${hmId(slot.time)}`, kind: 'meals', at: zonedTime(date, askHm, tz), url: `#/fuel/check/${date}/${hmId(slot.time)}`,
      tag: `meal-${date}-${hmId(slot.time)}`, fixed: false, title: `${slot.name} time`,
      body: `${formatHm(askHm)}, nothing logged ${before ? `since ${before.name.toLowerCase()}` : 'yet today'}. Eaten, cooking, or skipping?`,
      due: !logged && !check,
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
