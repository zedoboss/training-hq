// Reminders for a day (step 4): what to notify and when, from the same data the screens use. The Mac sends them as
// push notifications (server/notify.mjs); the phone lists them and, as a fallback for when the Mac is off, hands the
// fixed ones to an iPhone Shortcut (Reminders). Each item carries `due`: whether it still applies right now
// (a check-in already done or holds already logged switch it off).
import { rotationDay, LABEL, addDays, lastRotationSession, daysByDate } from './rotation.js';
import { holdSlots, roundsByDate } from './holds.js';
import { isoDate } from './time.js';
import { weekColumn } from './programme.js';
import { zonedTime, addMinutesHm, formatHm, formatDay } from './time.js';
import { withDefaults } from './settings.js';
import { askedAreas, workingKeys } from './readiness.js';

export const KINDS = [
  ['readiness', 'Readiness check-in before a session'],
  ['session', 'Session due, at its time'],
  ['holds', 'Tendon holds (morning, evening, rest days)'],
  ['evening', 'Evening: what is still open, and tomorrow'],
  ['neck', 'Neck is still unplanned (weekly)'],
];

const KEY_WORD = { L: 'legs', B: 'back' };
const day = (iso) => formatDay(new Date(`${iso}T12:00:00Z`), 'UTC');
const holdText = (s) => `${s.label}: ${s.exercise}${s.also?.length ? ` then ${s.also.join(', ')}` : ''}`;

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
 * @returns {Array<{id:string, kind:string, at:number, title:string, body:string, url:string, tag:string, due:boolean, fixed:boolean}>}
 */
export function remindersFor({ date, tz, last, days = {}, areas = [], rounds = {}, settings = null, meta = null, table = null, trainedDates = new Set(), neck = null }) {
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
    if (on('readiness')) {
      out.push({
        id: `readiness:${date}`, kind: 'readiness', at: at - n.readinessMin * 60000, url: '#/checkin', tag: `readiness-${date}`, fixed: true,
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
  const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType, roundsToday, times: { morning: n.holdsMorning, evening: n.holdsEvening } });
  if (on('holds')) {
    for (const [part, hm] of [['morning', n.holdsMorning], ['evening', n.holdsEvening]]) {
      const group = slots.filter((s) => (part === 'morning' ? s.slot === 'morning' || s.slot === 'rest' : s.slot === 'evening'));
      if (!group.length) continue;
      const open = group.filter((s) => !s.done);
      out.push({
        id: `holds-${part}:${date}`, kind: 'holds', at: zonedTime(date, hm, tz), url: '#/holds', tag: `holds-${date}-${part}`, fixed: true,
        title: `${part === 'morning' ? (rot.today.kind === 'rest' ? 'Rest day holds' : 'Morning holds') : 'Evening holds'}`,
        body: `${(open.length ? open : group).map(holdText).join('. ')}. 3 × 30 s each.`,
        due: open.length > 0,
      });
    }
  }

  // Evening: holds still open today, and tomorrow's session (or a nudge to set its time).
  if (on('evening')) {
    const open = slots.filter((s) => !s.done);
    const tomorrow = addDays(date, 1);
    const rot2 = rotationDay({ last, today: tomorrow, days });
    let next = '';
    if (rot2.today.kind === 'train') {
      const hm2 = days[tomorrow]?.sessionTime;
      next = hm2 ? `Tomorrow: ${LABEL[rot2.today.dayType]} at ${formatHm(hm2)}, check-in at ${formatHm(addMinutesHm(hm2, -n.readinessMin))}.`
        : `Tomorrow: ${LABEL[rot2.today.dayType]}. No time set yet.`;
    }
    const still = open.length ? `Still open: ${open.map((s) => `${s.label.toLowerCase()} (${s.exercise})`).join(', ')}.` : '';
    if (still || next) {
      out.push({
        id: `evening:${date}`, kind: 'evening', at: zonedTime(date, n.eveningCheck, tz), url: open.length ? '#/holds' : '#/train', tag: `evening-${date}`, fixed: false,
        title: open.length ? 'Still open today' : 'Tomorrow', body: [still, next].filter(Boolean).join(' '), due: true,
      });
    }
  }

  // Neck (4.9): about once a week while it has no place in the rotation (brief section 6, decision 14).
  if (on('neck') && neck && !neck.planned) {
    const lastAsked = neck.lastAskedOn || null;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === n.neckWeekday && (!lastAsked || lastAsked <= addDays(date, -6))) {
      out.push({
        id: `neck:${date}`, kind: 'neck', at: zonedTime(date, n.eveningCheck, tz) + 5 * 60000, url: '#/train', tag: 'neck', fixed: false,
        title: 'Neck is still unplanned', body: 'Your three neck exercises have no place in the rotation yet. Want to slot them in?', due: true,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Items to send now: due, their time has come, not older than the grace window, not sent before. */
export function dueNow(items, now, sent = {}, graceMs = 30 * 60000) {
  return items.filter((i) => i.due && i.at <= now && now - i.at < graceMs && !sent[i.id]);
}

/** The planner's input from the stored data (the Mac's database or the phone's copy). */
export function reminderState({ sessions = [], sets = [], tendons = [], bridge = null, settings = null, meta = null, days = [], neck = null }, tz) {
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
    trainedDates: new Set(sessions.filter((s) => s.kind !== 'holds' && s.startedAt).map((s) => isoDate(new Date(s.startedAt), tz))),
    neck,
  };
}
