// Body scans (step 7, brief section 6 BODY SCAN, decision 22): the Evolt 360 at his gym. The app proposes the next
// scan date and he confirms it; a preparation checklist he ticks so every scan is taken the same way; reminders two
// evenings before (the alcohol rule), the evening before (the preparation list) and at his session time on the day
// (on arrival at the gym); the scanner's own safety notice read once and recorded. Pure helpers; the screen is
// views/body-scan.js, the reminders are planned in reminders.js and sent by the Mac.
//
// scan-plan   'main': {next: {date, confirmedAt, proposedDate, how: 'proposal'|'picked'} | null,
//             safety: {readAt} | null, staff: [{at, text}], protocol: {items: [{id, when, text}], changes: [{at, note}]}
//             | null (= the brief's protocol), log: [{at, what, date}]}
// body-scans  'scan.<date>': {id, date, status: 'prep'|'done', prep: {ticks: {<item id>: true}, items: [{id, when,
//             text}], at}, ... results added in 7.5}
import { addDays, rotationDay } from './rotation.js';
import { daysBetween, zonedTime, formatDay } from './time.js';

/** Every 4 weeks (brief: scanning more often mostly measures day-to-day water changes). */
export const EVERY_DAYS = 28;

/** The starting protocol, in the brief's words (general guidance from gyms that use this scanner). His gym wins. */
export const PROTOCOL = [
  { id: 'no-alcohol', when: 'before', text: 'No alcohol in the 24 to 48 hours before.' },
  { id: 'as-usual', when: 'before', text: 'The day before: eat, salt and take supplements as usual.' },
  { id: 'first-thing', when: 'day', text: 'First thing at the gym, before the workout. No training beforehand.' },
  { id: 'fasted', when: 'day', text: 'Nothing eaten before the scan.' },
  { id: 'water', when: 'day', text: 'Normal water intake.' },
  { id: 'no-caffeine', when: 'day', text: 'No caffeine or pre-workout before the scan.' },
  { id: 'bathroom', when: 'day', text: 'Bathroom first.' },
  { id: 'barefoot', when: 'day', text: 'Barefoot.' },
];
export const WHEN = [['before', 'The day before'], ['day', 'On the day']];

/** The safety notice, asked once (brief): the app records that he read it and gives no other medical advice. */
export const SAFETY_TEXT = 'The scanner passes a small electrical current through the body. Gyms list pacemakers, other implanted electronic devices and pregnancy as reasons not to use it.';
export const SAFETY_ASK = "Read the scanner's own safety notice once (on the scanner or from the staff) before your first scan.";

/** Asked once of the staff (brief, and section 10): their instructions win over the starting protocol. */
export const STAFF_QUESTIONS = ['How do you want me to prepare for the Evolt 360 scan?', 'Can the results be exported (app, email or PDF) instead of photographed?'];

export const protocolOf = (plan) => (plan?.protocol?.items?.length ? plan.protocol.items : PROTOCOL);
export const isDone = (s) => s?.status === 'done';
export const scanId = (date) => `scan.${date}`;

/** The latest scan with results, or null. */
export const lastDone = (scans = []) => scans.filter(isDone).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;

/**
 * The rotation ahead: [{date, kind: 'train'|'rest'|'done', dayType}] for n days from `from`, assuming each planned
 * session happens on its day (as the backup reminders do) and rest days he already added stay.
 */
export function projectRotation({ last, days = {}, from, n }) {
  const out = [];
  let cur = last;
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const rot = rotationDay({ last: cur, today: date, days });
    out.push({ date, kind: rot.today.kind, dayType: rot.today.dayType });
    if (rot.today.kind === 'train') cur = { dayType: rot.today.dayType, date };
  }
  return out;
}

/** Day type the rotation expects on `date` ('train' with its day type, or 'rest'), or null when it is in the past. */
export function expectedOn({ last, days, today, date }) {
  if (date < today) return null;
  return projectRotation({ last, days, from: today, n: daysBetween(today, date) + 1 }).at(-1);
}

/**
 * The proposed next scan date. Rules (brief section 6, decision 22):
 * - 4 weeks after the last scan, so it falls on the same weekday; the first scan: tomorrow;
 * - never before tomorrow, so the evening-before reminder and the preparation can happen;
 * - on a training day (the scan is first thing at the gym, before the workout): a rest day in the rotation moves it to
 *   the next training day.
 * @returns {{date, dayType, base, shifted: boolean, lastDate: string|null}}
 */
export function proposeNext({ scans = [], today, last, days = {}, every = EVERY_DAYS }) {
  const prev = lastDone(scans);
  let base = prev ? addDays(prev.date, every) : addDays(today, 1);
  if (base <= today) base = addDays(today, 1);
  const ahead = projectRotation({ last, days, from: today, n: daysBetween(today, base) + 8 });
  const pick = ahead.find((p) => p.date >= base && p.kind === 'train');
  return { date: pick?.date || base, dayType: pick?.dayType || null, base, shifted: !!pick && pick.date !== base, lastDate: prev?.date || null };
}

/**
 * Where the planner stands today.
 * @returns {{next: object|null, missed: string|null, proposal: object, prep: object|null, onRest: object|null}}
 *   next: the confirmed scan (today or later, no results yet); missed: a confirmed date that passed with no scan;
 *   onRest: the confirmed date is a rest day in the rotation now, with the next training day to move it to.
 */
export function scanStatus({ plan = {}, scans = [], today, last, days = {} }) {
  const n = plan?.next?.date ? plan.next : null;
  const doneOn = (d) => scans.some((s) => s.date === d && isDone(s));
  const next = n && n.date >= today && !doneOn(n.date) ? n : null;
  const missed = n && n.date < today && !scans.some((s) => s.date >= n.date && isDone(s)) ? n.date : null;
  const proposal = proposeNext({ scans, today, last, days });
  let onRest = null;
  if (next) {
    const exp = expectedOn({ last, days, today, date: next.date });
    if (exp && exp.kind === 'rest') {
      const ahead = projectRotation({ last, days, from: today, n: daysBetween(today, next.date) + 8 });
      const to = ahead.find((p) => p.date > next.date && p.kind === 'train');
      onRest = to ? { to: to.date, dayType: to.dayType } : null;
    }
  }
  const prep = next ? scans.find((s) => s.date === next.date) || null : null;
  return { next, missed, proposal, prep, onRest };
}

/** The plan with a confirmed date (from the proposal or picked by him), dated in its log. */
export function confirmDate(plan = {}, date, { proposedDate = null, at = Date.now() } = {}) {
  const how = proposedDate && proposedDate === date ? 'proposal' : 'picked';
  return { ...plan, next: { date, confirmedAt: at, proposedDate, how }, log: [...(plan.log || []), { at, what: plan.next?.date ? 'moved' : 'confirmed', date }] };
}
export function cancelDate(plan = {}, at = Date.now()) {
  return { ...plan, next: null, log: [...(plan.log || []), { at, what: 'cancelled', date: plan.next?.date || null }] };
}

/** The scan record with one checklist line ticked or unticked; the item texts are kept as they were that day. */
export function withTick(rec, date, items, id, on, at = Date.now()) {
  const base = rec || { id: scanId(date), date, status: 'prep', createdAt: at };
  const ticks = { ...(base.prep?.ticks || {}) };
  if (on) ticks[id] = true; else delete ticks[id];
  return { ...base, prep: { ticks, items: items.map(({ id: i, when, text }) => ({ id: i, when, text })), at } };
}

/** Lines not ticked for a scan, from the items it was taken with. */
export function unticked(rec, items) {
  const list = rec?.prep?.items?.length ? rec.prep.items : items;
  return list.filter((i) => !rec?.prep?.ticks?.[i.id]);
}

/** The checklist with his changes (the gym's instructions win), dated. */
export function withProtocol(plan = {}, items, note = 'Edited', at = Date.now()) {
  const clean = items.map((i) => ({ id: i.id, when: i.when === 'before' ? 'before' : 'day', text: String(i.text || '').trim() })).filter((i) => i.text);
  return { ...plan, protocol: { items: clean, changes: [...(plan.protocol?.changes || []), { at, note }] } };
}

const dayText = (iso) => formatDay(new Date(`${iso}T12:00:00Z`), 'UTC');
const joinTexts = (items) => items.map((i) => i.text.replace(/^The day before: (.)/, (_, c) => c.toUpperCase()).replace(/\.$/, '')).join('. ');

/**
 * Reminders for a day (brief section 6: the evening before with the preparation list, and on arrival at the gym).
 * A web app can't tell when he walks into the gym, so "on arrival" is his session time that day (he sets it the day
 * before, decision 15). Two evenings before, a heads-up for the no-alcohol line (24 to 48 hours).
 */
export function scanReminders({ date, tz, plan = {}, scans = [], days = {}, eveningHm = '20:00' }) {
  const d = plan?.next?.date;
  if (!d) return [];
  const due = !scans.some((s) => s.date === d && isDone(s));
  const items = protocolOf(plan);
  const base = { kind: 'scan', url: '#/body/scan', tag: `scan-${d}`, fixed: true, due };
  const hm = days[d]?.sessionTime || null;
  if (date === addDays(d, -2)) {
    const alcohol = items.find((i) => i.id === 'no-alcohol');
    return [{ ...base, id: `scan-alcohol:${d}`, at: zonedTime(date, eveningHm, tz), title: 'Body scan in two days', body: `${dayText(d)}, first thing at the gym.${alcohol ? ` ${alcohol.text}` : ''}` }];
  }
  if (date === addDays(d, -1)) {
    const before = items.filter((i) => i.when === 'before'); const on = items.filter((i) => i.when !== 'before');
    return [{
      ...base, id: `scan-eve:${d}`, at: zonedTime(date, eveningHm, tz), title: 'Body scan tomorrow',
      body: `${dayText(d)}.${before.length ? ` Tonight: ${joinTexts(before)}.` : ''}${on.length ? ` Tomorrow: ${joinTexts(on)}.` : ''}${hm ? '' : " Set tomorrow's session time so the gym reminder comes on time."}`,
    }];
  }
  if (date === d && hm) {
    return [{ ...base, id: `scan-arrive:${d}`, at: zonedTime(d, hm, tz), title: 'Body scan first', body: 'At the gym: scan before the workout. Tick the checklist.' }];
  }
  return [];
}
