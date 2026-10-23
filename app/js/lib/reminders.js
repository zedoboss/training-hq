// Reminders for a day (step 4): what to notify and when, from the same data the screens use. The Mac sends them as
// push notifications (server/notify.mjs); the phone lists them and, as a fallback for when the Mac is off, hands the
// fixed ones to an iPhone Shortcut (Reminders). Each item carries `due`: whether it still applies right now
// (a check-in already done or holds already logged switch it off).
import { rotationDay, LABEL, addDays, lastRotationSession, daysByDate, sessionTomorrow, afterRestDay } from './rotation.js';
import { holdSlots, roundsByDate, restChoices, openSlots, roundSeconds, roundLength, holdsAfter } from './holds.js';
import { isoDate } from './time.js';
import { weekColumn } from './programme.js';
import { zonedTime, addMinutesHm, formatHm, formatDay } from './time.js';
import { withDefaults } from './settings.js';
import { askedAreas, workingKeys } from './readiness.js';
import { mealReminders, suppReminders, planReminders, saunaReminders } from './fuel-reminders.js';
import { fastingOn } from './fast.js';
import { scanReminders, planFor, isDone, cadenceOf, scanTakenOn } from './scans.js';
import { recoveryReminders } from './recovery.js';
import { activityReminders, activityDays } from './activities.js';
import { pathsOf } from './hold-path.js';
import { heldOff } from './holdoffs.js';

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
  ['rest', 'Timers: rest over, and a hold\'s go and stop (sent by the Mac, so they come with the screen locked too)'],
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
  const plain = byRound(shown.filter((s) => !s.ask));
  return [plain.length ? `${plain.map(holdText).join('. ')}. 3 × 30 s each${round ? `, ${round} a round` : ''}.` : '', ...shown.filter((s) => s.ask).map(holdText)].filter(Boolean).join(' ');
};
const holdText = (s) => (s.ask ? `${s.label}: the gym for the ${s.restHold || s.exercise} hold, another hold, or skip today?`
  : `${s.label}: ${s.exercise}${s.also?.length ? ` then ${s.also.join(', ')}` : ''}${s.n > 1 ? `, ${s.n} rounds, not back to back` : ''}`);
/** The same hold open twice today (his morning and evening knee rounds) said once, with its count (Sat 10/24: "knees (Toes Wall Squat Hold), shoulder (...), knees (Toes Wall Squat Hold)"). */
const byRound = (slots) => {
  const out = [];
  for (const s of slots) {
    const same = out.find((x) => x.area === s.area && x.exercise === s.exercise);
    if (same) same.n += 1; else out.push({ ...s, n: 1 });
  }
  return out;
};

/**
 * Holds check-ins (Sat 10/24, on Fri 10/23's 11 holds messages: the rest-day holds every hour from 3:41 PM and the
 * evening holds every hour from 9:40 PM, near the same words; he wants one holds stream that checks in a few times,
 * further apart, in new words): minutes after the morning time (before the evening time comes) and after the evening
 * time (before bed). The morning and evening reminders aren't nudged again. A check-in within gapMin of the last holds
 * message that went out is skipped (server/notify.mjs).
 */
export const HOLDS_CHECK = { morningMin: [120, 360], eveningMin: [75], gapMin: 60 };
const HOLDS_SAID = {
  morning: [
    ["Holds: haven't heard from you", (list, round) => `${list} ${cap(round)} and it's off the list.`],
    ['Holds still open today', (list, round, evening) => `${list} One round now${evening ? `, the next at ${evening}` : ''}. ${cap(round)}.`],
  ],
  evening: [["Last call on today's holds", (list) => `${list} Get them in before bed and log them.`]],
};
/**
 * A check-in's text: what's left in short ("Knees: Wall Hold, 2 rounds, not back to back."), then its own words. A
 * rest-day question isn't in it: the morning and evening reminders ask that.
 */
const holdsCheckText = (open, say, round, evening) => say(`${byRound(open.filter((s) => !s.ask)).map(holdText).join('. ')}.`, round, evening);

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
export function remindersFor({ paths = [], photoScanIds = [], holdoffs = [], date, tz, last, days = {}, areas = [], rounds = {}, settings = null, meta = null, table = null, trainedDates = new Set(), neck = null, meals = [], mealChecks = [], supplements = [], suppLog = [], suppAnswers = [], sauna = [], saunaPlan = null, scans = [], scanPlan = null, coachReminders = [], sessionStarts = [], recovery = null, flexPlan = null, combatPlan = null, activity = undefined, flexTests = [] }) {
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
  const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType, roundsToday, times: { morning: n.holdsMorning, evening: n.holdsEvening }, restChoices: restChoices(days, date), nextSession: sessionTomorrow(rot, date), carriedFrom: afterRestDay(rot, date, days), roundsYesterday: Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[addDays(date, -1)] || 0])) });
  if (on('holds')) {
    const st = withDefaults(settings);
    const round = roundLength(roundSeconds({ getReadyS: st.holds?.getReadyS ?? 15, restS: st.rest?.holdS ?? 120 }));
    // One stream (Sat 10/24): the evening one says all that's left today, the morning round too; check-ins follow each.
    const dayOpen = openSlots(slots.filter((s) => s.slot !== 'after'));
    const eveningOpen = dayOpen.some((s) => s.slot === 'evening');
    const eveningAt = zonedTime(date, n.holdsEvening, tz);
    const bedAt = zonedTime(n.bedHm > n.holdsEvening ? date : addDays(date, 1), n.bedHm, tz);
    for (const [part, hm] of [['morning', n.holdsMorning], ['evening', n.holdsEvening]]) {
      const group = slots.filter((s) => (part === 'morning' ? s.slot === 'morning' || s.slot === 'rest' : s.slot === 'evening') && !s.skipped);
      if (!group.length) continue;
      const open = openSlots(group);
      const shown = part === 'evening' && open.length ? dayOpen : open;
      const at0 = zonedTime(date, hm, tz);
      const stream = `holds:${date}`;
      out.push({
        id: `holds-${part}:${date}`, kind: 'holds', at: at0, url: '#/holds', tag: `holds-${date}-${part}`, fixed: true,
        title: `${part === 'morning' ? (rot.today.kind === 'rest' ? (open.some((s) => s.ask) ? 'Rest day holds: what today?' : 'Rest day holds') : 'Morning holds') : 'Evening holds'}`,
        body: holdsBody(shown.length ? shown : group, round),
        again: false, stream, due: open.length > 0,
      });
      // Morning check-ins end an hour before the evening time; the evening one 15 minutes before bed and by midnight.
      const until = part === 'morning' ? eveningAt - 60 * 60000 : Math.min(bedAt - 15 * 60000, zonedTime(addDays(date, 1), '00:00', tz));
      const toDo = open.filter((s) => !s.ask);
      // Said from what's left (or, once done, what it was); only a rest-day question in it: no check-ins.
      const said = [shown, group].map((x) => x.filter((s) => !s.ask)).find((x) => x.length);
      HOLDS_CHECK[`${part}Min`].forEach((min, k) => {
        const at = at0 + min * 60000;
        if (at >= until || !said) return;
        const [title, say] = HOLDS_SAID[part][k];
        out.push({
          id: `holds-check:${date}:${part}:${k + 1}`, kind: 'holds', at, url: '#/holds', tag: `holds-${date}-${part}`, group: `holds-check:${date}`, fixed: false,
          title, body: holdsCheckText(said, say, round, part === 'morning' && eveningOpen ? formatHm(n.holdsEvening) : null),
          stream, streamGapMin: HOLDS_CHECK.gapMin, due: toDo.length > 0,
        });
      });
    }
  }

  // Supplements (6.6): at his times, then again every 45 minutes until each is answered.
  // A fasting day (Wed 10/21): no supplement or meal prompts.
  const fasting = fastingOn(days, date, meals);
  const supps = on('supps') && !fasting ? suppReminders({ date, tz, supps: supplements, log: suppLog, dayKind: rot.today.kind === 'rest' ? 'rest' : 'train', follow: { everyMin: n.suppFollowMin, max: n.suppFollowMax } }) : { items: [], open: [] };
  out.push(...supps.items);
  // A sauna planned before he said he's fasting: no "sauna today" (its checklist wants food); the safety ones stay (Thu 10/22 audit).
  if (on('sauna')) out.push(...saunaReminders({ date, tz, sessions: sauna, plan: saunaPlan || {} }).filter((i) => !(fasting && i.id.startsWith('sauna-day:'))));
  if (on('scan')) {
    const sp = planFor(scanPlan || {}, { scans, today: date, last, days });
    out.push(...scanReminders({ date, tz, plan: sp, scans, days, eveningHm: n.scanEvening, morningLeadMin: n.readinessMin, photoScanIds, started: trainedDates }));
    // Thu 10/22, his words: "if I miss one before the workout, after the workout you should ask whether I did it or
    // not. If I did it, I should be able to attach it": first thing once the gym is done (afterGym), unless a scan is
    // saved.
    const ag = afterGym({ date, activity, areas, rounds, scans, scanPlan, photoScanIds });
    if (ag?.scanAskAt) {
      out.push({ id: `scan-after:${date}`, kind: 'scan', at: ag.scanAskAt, url: '#/body/scan', tag: `scan-after-${date}`, fixed: false,
        title: 'Evolt scan?', body: 'Do it before you leave the gym, then add the results (photo or PDF).', due: true });
    }
  }
  if (on('supps')) out.push(...planReminders({ date, tz, supps: supplements, log: suppLog, answers: suppAnswers, eveningHm: n.eveningCheck, weekday: n.suppPlanWeekday, wakeHm: n.wakeHm, bedHm: n.bedHm }));
  // Step 8: reminders he asked the coach for, at their time, in his words.
  if (on('coach')) {
    for (const r of coachReminders) {
      const at = r?.trigger === 'session-start' ? sessionStartAt(r, sessionStarts, tz) : r?.at;
      if (!at || isoDate(new Date(at), tz) !== date) continue;
      out.push({ id: `coach:${r.id}`, kind: 'coach', at, url: '#/coach', tag: `coach-${r.id}`, fixed: true, title: 'Reminder', body: String(r.text || ''), due: !r.cancelledAt,
        ...(r.trigger ? { trigger: r.trigger } : {}), ...(r.facts ? { facts: r.facts, since: r.createdAt } : {}) });
    }
  }

  // Evening: holds and supplements still open today, and tomorrow's session (or a nudge to set its time). What he put on
  // hold isn't listed (Thu 10/22 audit).
  if (on('evening')) {
    const eveningAt = zonedTime(date, n.eveningCheck, tz);
    // Holds the holds stream asks about aren't listed again (Sat 10/24, "knees ... knees" at 10:30 PM); only the ones
    // after a workout, which it doesn't.
    const open = heldOff('holds', holdoffs, eveningAt) ? [] : openSlots(slots).filter((s) => !on('holds') || s.slot === 'after');
    const tomorrow = addDays(date, 1);
    const rot2 = rotationDay({ last, today: tomorrow, days });
    let next = '';
    if (rot2.today.kind === 'train') {
      const hm2 = days[tomorrow]?.sessionTime;
      const lead2 = hm2 ? checkInLead(days[tomorrow], tomorrow, tz, n.readinessMin) : null;
      next = hm2 ? `Tomorrow: ${LABEL[rot2.today.dayType]} at ${formatHm(hm2)}${lead2 == null ? '' : `, check-in at ${formatHm(addMinutesHm(hm2, -lead2))}`}.`
        : `Tomorrow: ${LABEL[rot2.today.dayType]}. No time set yet.`;
    }
    const still = open.length ? `Still open: ${byRound(open).map((s) => `${s.label.toLowerCase()} (${s.exercise}${s.n > 1 ? `, ${s.n} rounds` : ''})`).join(', ')}.` : '';
    const suppText = supps.open.length && !heldOff('supps', holdoffs, eveningAt) ? `Supplements still open: ${supps.open.join(', ')}.` : '';
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
  // A hold path ready for its next stage (Thu 10/22: the app asks, he confirms): the morning after its last quiet Push
  // day, every morning until he steps up or says not yet.
  if (on('holds')) {
    for (const { area, state: st } of paths) {
      if (!st.ready || !(st.quietDays.at(-1) < date)) continue;
      out.push({
        id: `hold-path:${area.id}:${st.at}:${date}`, kind: 'holds', at: zonedTime(date, addMinutesHm(n.wakeHm, 30), tz), url: '#/holds', tag: `hold-path-${area.id}`, fixed: false,
        title: `${area.label}: ready for ${st.next.label.toLowerCase()}?`, body: `${st.need} quiet Push days on ${st.stage.label}. Not worse this morning? Step up on Holds, or tell me.`, again: false, due: true,
      });
    }
  }
  // Meals (6.3): his meal times with nothing logged, and the after photo.
  if (on('meals') && !fasting) {
    out.push(...mealReminders({ date, tz, meals, checks: mealChecks, mealTimes: withDefaults(settings).fuel.mealTimes }));
    // After the gym: the soft "head home" first, then meal prompts that fell in the gym time wait 5 minutes more.
    const ag = afterGym({ date, activity, areas, rounds, scans, scanPlan, photoScanIds });
    if (ag) {
      // A meal logged, or his answer to the meal question, since the gym: no "head home" (Thu 10/22 audit).
      const fed = meals.some((m) => m.date === date && m.at >= ag.doneAt) || mealChecks.some((c) => c.date === date && c.at >= ag.doneAt);
      out.push({ id: `home:${date}`, kind: 'meals', at: ag.homeAt, url: '#/fuel', tag: `home-${date}`, fixed: false,
        title: 'Head home', body: 'Gym done. Get settled, food is next.', calm: true, again: false, due: !fed });
      const from = activity.workoutStart?.[date] ?? ag.doneAt;
      const inGym = (i) => (i.kind === 'meals' || i.kind === 'cook') && i.id !== `home:${date}` && i.at >= from && i.at < ag.mealAt;
      // Check-ins (until he answers) that fell in the gym time: none; the moved prompt asks once.
      for (const i of out) if (inGym(i) && i.group) i.due = false;
      const moved = out.filter((i) => inGym(i) && !i.group);
      // One prompt per meal at that moment: the later one (the meal itself over "start cooking").
      for (const i of moved) {
        if (moved.some((j) => j !== i && j.tag === i.tag && j.at > i.at && j.due)) i.due = false;
      }
      for (const i of moved) i.at = ag.mealAt;
    }
  }
  // Thu 10/22: flexibility (after a workout or his evening time, the weekly kick test) and boxing / kickboxing classes.
  out.push(...activityReminders({ date, tz, flex: flexPlan, combat: combatPlan, done: activity, tests: flexTests, on }));
  return out.sort((a, b) => a.at - b.at);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Thu 10/22, his words after Legs: "the first notification I got prompted was the meal. Wrong. It should be the Evolt
// scan... After I do that, don't immediately prompt me with the meal. Wait 5 minutes, bare minimum... a softer prompt
// first: get home now... And then 5 minutes after that one, the first meal."
export const AFTER_GYM = { holdsMaxMin: 40, scanAskMin: 1, scanWaitMin: 10, homeMin: 5, mealMin: 5 };

/**
 * After a workout, in order: the gym is done when the workout is and the holds due after it are too (their round
 * saved; 40 minutes at most); the Evolt ask a minute later (a scan day with no scan saved); the "head home" nudge 5
 * minutes after the scan is saved (10 minutes for it when asked and not saved); meals 5 minutes after that.
 * {doneAt, scanAskAt, homeAt, mealAt} in ms, or null with no workout done that day.
 */
export function afterGym({ date, activity, areas = [], rounds = {}, scans = [], scanPlan = null, photoScanIds = [] }) {
  const end = activity?.workoutEnd?.[date];
  if (!end) return null;
  const open = (activity.dayTypes?.[date] || []).flatMap((t) => holdsAfter(areas, t))
    .some((h) => { const a = areas.find((x) => x.label === h.area); return a && !(rounds[a.id]?.[date] > 0); });
  const doneAt = open ? end + AFTER_GYM.holdsMaxMin * 60000 : Math.max(end, ...(activity.holdsEnd?.[date] || []));
  // (Once the workout is saved the planner's next scan is tomorrow: a scan day is every training day, or the date set.)
  const scanDay = cadenceOf(scanPlan) === 'training' || scanPlan?.next?.date === date;
  const scan = scans.find((s) => s.date === date && isDone(s));
  const scanAskAt = scanDay && !scanTakenOn(scans, date, photoScanIds) ? doneAt + AFTER_GYM.scanAskMin * 60000 : null;
  const base = scanAskAt ? scanAskAt + AFTER_GYM.scanWaitMin * 60000 : Math.max(doneAt, scan?.confirmedAt ?? scan?.at ?? 0);
  const homeAt = base + AFTER_GYM.homeMin * 60000;
  return { doneAt, scanAskAt, homeAt, mealAt: homeAt + AFTER_GYM.mealMin * 60000 };
}

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
export function reminderState({ sessions = [], sets = [], tendons = [], bridge = null, settings = null, meta = null, days = [], neck = null, meals = [], mealChecks = [], supplements = [], suppLog = [], suppAnswers = [], sauna = [], saunaPlan = null, scans = [], scanPlan = null, coachReminders = [], recoveryPlan = null, recoveryState = null, notes = [], photos = [], flexPlan = null, combatPlan = null, coachNotes = [], scanPhotos = [], coachHolds = [] }, tz) {
  const areas = tendons.filter((d) => d?.kind === 'area');
  const activity = activityDays({ sessions, sets, tz });
  return {
    tz,
    last: lastRotationSession(sessions, bridge, tz),
    days: daysByDate(days),
    areas,
    rounds: roundsByDate(areas, sessions, sets, bridge),
    settings,
    meta,
    table: tendons.find((d) => d?.kind === 'readiness') ?? null,
    // Gym workouts only: a stretch, a class or a home neck session isn't a trained day (Thu 10/22 audit).
    trainedDates: activity.workoutDays,
    paths: pathsOf({ areas, sessions, sets, dayOf: (ms) => isoDate(new Date(ms), tz) }),
    sessionStarts: activity.workoutStarts,
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
    activity,
    photoScanIds: scanPhotos.map((p) => p?.scanId).filter(Boolean),
    holdoffs: coachHolds,
    flexTests: coachNotes.filter((x) => /^flex/i.test(x?.topic || '')).map((x) => x.date || isoDate(new Date(x.at), tz)),
  };
}
