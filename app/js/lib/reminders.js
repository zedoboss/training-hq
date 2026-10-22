// Reminders for a day (step 4): what to notify and when, from the same data the screens use. The Mac sends them as
// push notifications (server/notify.mjs); the phone lists them and, as a fallback for when the Mac is off, hands the
// fixed ones to an iPhone Shortcut (Reminders). Each item carries `due`: whether it still applies right now
// (a check-in already done or holds already logged switch it off).
import { rotationDay, LABEL, addDays, lastRotationSession, daysByDate } from './rotation.js';
import { holdSlots, roundsByDate, restChoices, openSlots, roundSeconds, roundLength } from './holds.js';
import { isoDate } from './time.js';
import { weekColumn } from './programme.js';
import { zonedTime, addMinutesHm, formatHm, formatDay } from './time.js';
import { withDefaults } from './settings.js';
import { askedAreas, workingKeys } from './readiness.js';
import { mealReminders, suppReminders, planReminders, saunaReminders } from './fuel-reminders.js';
import { fastingOn } from './fast.js';
import { scanReminders, planFor } from './scans.js';
import { recoveryReminders } from './recovery.js';
import { activityReminders, activityDays } from './activities.js';

export const KINDS = [
  ['readiness', 'Readiness check-in before a session'],
  ['session', 'Session due, at its time'],
  ['holds', 'Tendon holds (morning, evening, rest days)'],
  ['evening', 'Evening: what is still open, and tomorrow'],
  ['neck', 'Neck is still unplanned (weekly)'],
  ['meals', 'Meal times with nothing logged; the after photo'],
  ['supps', 'Supplements at their times, asked again until answered; running low; weekly planning'],
  ['sauna', 'Sauna: planned days, the overdue alarm backup, the question 15 minutes after'],
  ['scan', 'Body scan: on the day (every training day), or the evenings before when it is every 4 weeks'],
  ['coach', 'Reminders you asked the coach for'],
  ['recovery', 'Recovery: the weekly check-in until the checkup, things to do, photos every few weeks'],
  ['dishes', 'The dishes: 2 minutes after you log a meal, get up and wash up'],
  ['walk', 'Walks: asked through the day until your step goal is done; no answer in 5 minutes, it asks when you\'ll go'],
  ['flex', 'Flexibility: your stretch routine after a workout (or at your evening time) and the weekly kick test'],
  ['combat', 'Boxing / kickboxing: before each class, and how it went after'],
  ['rest', 'Rest over: when the rest timer reaches zero (sent by the Mac, so it comes with the screen locked too)'],
];

const KEY_WORD = { L: 'legs', B: 'back' };

/** Minutes before the session for a check-in reminder whose usual time had already passed when he set the time. */
export const LATE_CHECKIN_MIN = 5;

/**
 * How many minutes before the session the check-in reminder comes (Thu 10/22, his words: he set Legs at 9:50 AM at
 * 9:23 AM and "Sore, or good to go?" came a minute later). Normally `readinessMin`; when that time had already passed as
 * he set the session time, just before he leaves (LATE_CHECKIN_MIN); null when even that had passed (the session's own
 * reminder says the check-in is still open). A day doc without `timeSetAt` keeps the usual time.
 */
export function checkInLead(doc, date, tz, readinessMin) {
  const at = zonedTime(date, doc.sessionTime, tz);
  const setAt = doc.timeSetAt || 0;
  if (setAt < at - readinessMin * 60000) return readinessMin;
  return setAt < at - LATE_CHECKIN_MIN * 60000 ? LATE_CHECKIN_MIN : null;
}

const day = (iso) => formatDay(new Date(`${iso}T12:00:00Z`), 'UTC');
/** "Knees: Wall Hold. 3 × 30 s each. Shoulder: the gym for the ... hold, another hold, or skip today?" */
const holdsBody = (shown, round = '') => {
  const plain = shown.filter((s) => !s.ask);
  return [plain.length ? `${plain.map(holdText).join('. ')}. 3 × 30 s each${round ? `, ${round} a round` : ''}.` : '', ...shown.filter((s) => s.ask).map(holdText)].filter(Boolean).join(' ');
};
const holdText = (s) => (s.ask ? `${s.label}: the gym for the ${s.restHold || s.exercise} hold, another hold, or skip today?`
  : `${s.label}: ${s.exercise}${s.also?.length ? ` then ${s.also.join(', ')}` : ''}`);

/**
 * @param {object} o
 * @param {string} o.date        YYYY-MM-DD
 * @param {string} [o.tz]        time zone the times are in
 * @param {{dayType:string, date:string}|null} o.last  last completed rotation session
 * @param {object} o.days        day records by date
 * @param {Array} o.areas        tendon area docs
 * @param {object} [o.rounds]    holds rounds: {areaId: {date: count}}
 * @param {object} [o.settings]  settings 'main' doc
 * @param {object} [o.meta]      programme meta (week columns)
 * @param {object} [o.table]     readiness table (which soreness is asked)
 * @param {Set<string>} [o.trainedDates]  dates with a workout started or done
 * @param {object} [o.neck]      {planned, lastAskedOn} (4.9)
 * @param {Array} [o.meals]      meals (step 6), any date
 * @param {Array} [o.mealChecks] answers to "eaten, cooking, or skipping?"
 * @param {Array} [o.supplements] his supplement list (step 6)
 * @param {Array} [o.suppLog]    taken / skipped answers
 * @param {Array} [o.suppAnswers] restock and weekly planning answers
 * @param {Array} [o.sauna]      sauna sessions; [o.saunaPlan] the sauna plan
 * @param {Array} [o.scans]      body scans (step 7); [o.scanPlan] the scan plan
 * @param {Array} [o.coachReminders] reminders the coach set for him (step 8): {id, at, date, text, cancelledAt}, or
 *   {trigger: 'session-start', date, delayMin}: a few minutes after he starts his workout log on or after that day
 * @param {number[]} [o.sessionStarts] when his workouts started (not holds, not discarded), oldest first
 * @param {object} [o.recovery]  A13: {plan, state, notes, photos} (lib/recovery.js), when he has a recovery record
 * @returns {Array<{id:string, kind:string, at:number, title:string, body:string, url:string, tag:string, due:boolean, fixed:boolean}>}
 */
export function remindersFor({ date, tz, last, days = {}, areas = [], rounds = {}, settings = null, meta = null, table = null, trainedDates = new Set(), neck = null, meals = [], mealChecks = [], supplements = [], suppLog = [], suppAnswers = [], sauna = [], saunaPlan = null, scans = [], scanPlan = null, coachReminders = [], sessionStarts = [], recovery = null, flexPlan = null, combatPlan = null, activity = undefined, flexTests = [] }) {
  const n = withDefaults(settings).notify;
  const on = (k) => n.kinds?.[k] !== false;
  const rot = rotationDay({ last, today: date, days });
  const doc = days[date] || {};
  const out = [];
  const dayType = rot.today.kind === 'rest' ? null : rot.today.dayType;

  // Session and the check-in before it: only on a training day with a time set (decision 15: he sets the time).
  if (rot.today.kind === 'train' && doc.sessionTime) {
    const hm = doc.sessionTime;
    const at = zonedTime(date, hm, tz);
    const wk = weekColumn(meta?.firstSessions?.[dayType], date);
    const started = trainedDates.has(date);
    const asked = [...askedAreas(areas).map((a) => a.label.toLowerCase()), ...workingKeys(table, dayType).map((k) => KEY_WORD[k])];
    const lead = checkInLead(doc, date, tz, n.readinessMin);
    if (on('readiness') && lead != null) {
      out.push({
        id: `readiness:${date}`, kind: 'readiness', at: at - lead * 60000, url: '#/checkin', tag: `readiness-${date}`, fixed: true,
        title: 'Sore, or good to go?',
        body: `${LABEL[dayType]} at ${formatHm(hm)}${wk ? `, week ${wk} column` : ''}. ${asked.length ? `${cap(asked.join(', '))}, then energy` : 'Energy'}. Zero to three.`,
        due: !doc.readiness && !started,
      });
    }
    if (on('session')) {
      out.push({
        id: `session:${date}`, kind: 'session', at, url: '#/train', tag: `session-${date}`, fixed: true,
        title: `${LABEL[dayType]} at ${formatHm(hm)}`,
        body: `${day(date)}.${wk ? ` Week ${wk} column.` : ''}${doc.readiness ? '' : ' Check-in still open.'}`,
        due: !started,
      });
    }
  }

  // Tendon holds (decisions 17, 18): morning (and rest-day) holds, evening holds.
  const roundsToday = Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[date] || 0]));
  const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType, roundsToday, times: { morning: n.holdsMorning, evening: n.holdsEvening }, restChoices: restChoices(days, date) });
  if (on('holds')) {
    const st = withDefaults(settings);
    const round = roundLength(roundSeconds({ getReadyS: st.holds?.getReadyS ?? 15, restS: st.rest?.holdS ?? 120 }));
    for (const [part, hm] of [['morning', n.holdsMorning], ['evening', n.holdsEvening]]) {
      const group = slots.filter((s) => (part === 'morning' ? s.slot === 'morning' || s.slot === 'rest' : s.slot === 'evening') && !s.skipped);
      if (!group.length) continue;
      const open = openSlots(group);
      out.push({
        id: `holds-${part}:${date}`, kind: 'holds', at: zonedTime(date, hm, tz), url: '#/holds', tag: `holds-${date}-${part}`, fixed: true,
        title: `${part === 'morning' ? (rot.today.kind === 'rest' ? (open.some((s) => s.ask) ? 'Rest day holds: what today?' : 'Rest day holds') : 'Morning holds') : 'Evening holds'}`,
        body: holdsBody(open.length ? open : group, round),
        due: open.length > 0,
      });
    }
  }

  // Supplements (6.6): at his times, then again every 45 minutes until each is answered.
  // A fasting day (Wed 10/21): no supplement or meal prompts.
  const fasting = fastingOn(days, date, meals);
  const supps = on('supps') && !fasting ? suppReminders({ date, tz, supps: supplements, log: suppLog, dayKind: rot.today.kind === 'rest' ? 'rest' : 'train', follow: { everyMin: n.suppFollowMin, max: n.suppFollowMax } }) : { items: [], open: [] };
  out.push(...supps.items);
  if (on('sauna')) out.push(...saunaReminders({ date, tz, sessions: sauna, plan: saunaPlan || {} }));
  if (on('scan')) out.push(...scanReminders({ date, tz, plan: planFor(scanPlan || {}, { scans, today: date, last, days }), scans, days, eveningHm: n.scanEvening, morningLeadMin: n.readinessMin }));
  if (on('supps')) out.push(...planReminders({ date, tz, supps: supplements, log: suppLog, answers: suppAnswers, eveningHm: n.eveningCheck, weekday: n.suppPlanWeekday }));
  // Step 8: reminders he asked the coach for, at their time, in his words.
  if (on('coach')) {
    for (const r of coachReminders) {
      const at = r?.trigger === 'session-start' ? sessionStartAt(r, sessionStarts, tz) : r?.at;
      if (!at || isoDate(new Date(at), tz) !== date) continue;
      out.push({ id: `coach:${r.id}`, kind: 'coach', at, url: '#/coach', tag: `coach-${r.id}`, fixed: true, title: 'Reminder', body: String(r.text || ''), due: !r.cancelledAt,
        ...(r.trigger ? { trigger: r.trigger } : {}), ...(r.facts ? { facts: r.facts, since: r.createdAt } : {}) });
    }
  }

  // Evening: holds and supplements still open today, and tomorrow's session (or a nudge to set its time).
  if (on('evening')) {
    const open = openSlots(slots);
    const tomorrow = addDays(date, 1);
    const rot2 = rotationDay({ last, today: tomorrow, days });
    let next = '';
    if (rot2.today.kind === 'train') {
      const hm2 = days[tomorrow]?.sessionTime;
      const lead2 = hm2 ? checkInLead(days[tomorrow], tomorrow, tz, n.readinessMin) : null;
      next = hm2 ? `Tomorrow: ${LABEL[rot2.today.dayType]} at ${formatHm(hm2)}${lead2 == null ? '' : `, check-in at ${formatHm(addMinutesHm(hm2, -lead2))}`}.`
        : `Tomorrow: ${LABEL[rot2.today.dayType]}. No time set yet.`;
    }
    const still = open.length ? `Still open: ${open.map((s) => `${s.label.toLowerCase()} (${s.exercise})`).join(', ')}.` : '';
    const suppText = supps.open.length ? `Supplements still open: ${supps.open.join(', ')}.` : '';
    if (still || suppText || next) {
      out.push({
        id: `evening:${date}`, kind: 'evening', at: zonedTime(date, n.eveningCheck, tz), url: open.length ? '#/holds' : suppText ? '#/supps' : '#/train', tag: `evening-${date}`, fixed: false,
        title: open.length || suppText ? 'Still open today' : 'Tomorrow', body: [still, suppText, next].filter(Boolean).join(' '), due: true,
      });
    }
  }

  // Neck (4.9): about once a week while it has no place in the rotation (brief section 6, decision 14).
  if (on('neck') && neck && !neck.planned) {
    const lastAsked = neck.lastAskedOn || null;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === n.neckWeekday && (!lastAsked || lastAsked <= addDays(date, -7))) {
      out.push({
        id: `neck:${date}`, kind: 'neck', at: zonedTime(date, n.eveningCheck, tz) + 5 * 60000, url: '#/train', tag: 'neck', fixed: false,
        title: 'Neck is still unplanned', body: 'Your three neck exercises have no place in the rotation yet. Want to slot them in?', due: true,
      });
    }
  }
  // A13: his recovery record: the weekly check-in, things to do, photos.
  if (on('recovery') && recovery?.plan) out.push(...recoveryReminders({ date, tz, ...recovery, hm: n.recoveryHm }));
  // Meals (6.3): his meal times with nothing logged, and the after photo.
  if (on('meals') && !fasting) out.push(...mealReminders({ date, tz, meals, checks: mealChecks, mealTimes: withDefaults(settings).fuel.mealTimes }));
  // Thu 10/22: flexibility (after a workout or his evening time, the weekly kick test) and boxing / kickboxing classes.
  out.push(...activityReminders({ date, tz, flex: flexPlan, combat: combatPlan, done: activity, tests: flexTests, on }));
  return out.sort((a, b) => a.at - b.at);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Items to send now: due, their time has come, not older than the grace window, not sent before. */
export function dueNow(items, now, sent = {}, graceMs = 30 * 60000) {
  return items.filter((i) => i.due && i.at <= now && now - i.at < graceMs && !sent[i.id]);
}

/**
 * "Remind me after I arrive at the gym and start my log" (Wed 10/21): a coach reminder tied to his workout fires
 * `delayMin` (default 1) minutes after the first workout he starts on or after its day, once the reminder exists.
 */
export function sessionStartAt(r, sessionStarts, tz) {
  const t = sessionStarts.find((x) => x >= (r.createdAt || 0) && isoDate(new Date(x), tz) >= (r.date || ''));
  return t == null ? null : t + (r.delayMin ?? 1) * 60000;
}

/** The planner's input from the stored data (the Mac's database or the phone's copy). */
export function reminderState({ sessions = [], sets = [], tendons = [], bridge = null, settings = null, meta = null, days = [], neck = null, meals = [], mealChecks = [], supplements = [], suppLog = [], suppAnswers = [], sauna = [], saunaPlan = null, scans = [], scanPlan = null, coachReminders = [], recoveryPlan = null, recoveryState = null, notes = [], photos = [], flexPlan = null, combatPlan = null, coachNotes = [] }, tz) {
  const areas = tendons.filter((d) => d?.kind === 'area');
  return {
    tz,
    last: lastRotationSession(sessions, bridge, tz),
    days: daysByDate(days),
    areas,
    rounds: roundsByDate(areas, sessions, sets, bridge),
    settings,
    meta,
    table: tendons.find((d) => d?.kind === 'readiness') ?? null,
    trainedDates: new Set(sessions.filter((s) => s.kind !== 'holds' && s.startedAt && s.status !== 'discarded').map((s) => isoDate(new Date(s.startedAt), tz))),
    sessionStarts: sessions.filter((s) => s.kind !== 'holds' && s.startedAt && s.status !== 'discarded').map((s) => s.startedAt).sort((a, b) => a - b),
    neck,
    meals,
    mealChecks,
    supplements,
    suppLog,
    suppAnswers,
    sauna,
    saunaPlan,
    scans,
    scanPlan,
    coachReminders,
    recovery: recoveryPlan ? { plan: recoveryPlan, state: recoveryState, notes, photos } : null,
    flexPlan,
    combatPlan,
    activity: activityDays({ sessions, sets, tz }),
    flexTests: coachNotes.filter((x) => /^flex/i.test(x?.topic || '')).map((x) => x.date || isoDate(new Date(x.at), tz)),
  };
}
