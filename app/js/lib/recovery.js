// A recovery record (A13): a recovery he follows alongside training (from an operation or an injury), with a short
// check-in about once a week until a checkup, a few things to do (book the checkup, get something in writing), and
// progress photos every few weeks. What it is about, the questions, the dates and the photo poses all come from his
// private seed (collection 'recovery', doc 'main'); nothing personal is in this file. The coach reads his own record
// as text on the Mac and never adds medical advice; the app only asks, keeps his answers and reminds.
//   'recovery' 'main'  {title, since, sinceText, until, untilText, checkIn {from, everyDays, askAgainDays, questions
//                       [{key, label, ask, choices?|kind:'text'}]}, tasks [{id, text, detail, setsCheckup}],
//                       photos {poses, minDays, maxDays, how, from}, checkupQuestions [text]}
//   'recovery' 'state' {tasks {<id>: {doneAt, by}}, checkup {date, setAt, by}}   (his answers, written by the app)
//   'coach-notes' 'recovery.<date>' {id, at, date, topic 'recovery', text, answers {<key>: value}, by}  (check-ins)
import { addDays } from './rotation.js';
import { daysBetween, zonedTime, addMinutesHm, formatDay } from './time.js';

export const TOPIC = 'recovery';
export const noteId = (date) => `recovery.${date}`;
const dayText = (iso) => formatDay(new Date(`${iso}T12:00:00Z`), 'UTC');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Days since it started, as "110 days (15 weeks 5 days)"; null before the start or without one. */
export function sinceText(plan, date) {
  if (!plan?.since || date < plan.since) return null;
  const n = daysBetween(plan.since, date);
  const w = Math.floor(n / 7); const d = n % 7;
  return `${plural(n, 'day')}${w ? ` (${plural(w, 'week')}${d ? ` ${plural(d, 'day')}` : ''})` : ''}`;
}

/** The check-ins end at the checkup: the date he booked, else the plan's own end. */
export const endsOn = (plan, state) => state?.checkup?.date || plan?.until || null;

/** His check-ins (dated notes, topic 'recovery'), newest first. */
export const checkIns = (notes = []) => notes.filter((n) => n?.topic === TOPIC && n.date && n.answers).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.at || 0) - (a.at || 0)));

/**
 * Where the weekly check-in stands on a date: {active, last, dueOn, due, endsOn}. Due from `everyDays` after the last
 * one (the first from checkIn.from), while the checkup is still ahead.
 */
export function checkInStatus(plan, state, notes, date) {
  const c = plan?.checkIn || {};
  const end = endsOn(plan, state);
  const active = Boolean(plan?.since && c.questions?.length && (!end || date <= end));
  const last = checkIns(notes).find((n) => n.date <= date) || null;
  const dueOn = last ? addDays(last.date, c.everyDays || 7) : c.from || plan?.since || date;
  return { active, last, dueOn, due: active && date >= dueOn, endsOn: end };
}

/** Things to do that are still open, in the plan's order. */
export const openTasks = (plan, state) => (plan?.tasks || []).filter((t) => !state?.tasks?.[t.id]?.doneAt);

/** His answer as one line: "Tenderness less, puffiness same, anything new: a small lump." */
export function answersText(plan, answers = {}) {
  const parts = (plan?.checkIn?.questions || []).filter((q) => answers[q.key] != null && String(answers[q.key]).trim() !== '').map((q) => {
    const v = String(answers[q.key]).trim();
    return q.kind === 'text' ? `${q.label.toLowerCase()}: ${v}` : `${q.label.toLowerCase()} ${v.toLowerCase()}`;
  });
  const s = parts.join(', ');
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : '';
}

/** A check-in saved as a dated note (one per day: a second one that day replaces the first). */
export function checkInNote(plan, answers, { date, at, by = 'app' }) {
  const clean = {};
  for (const q of plan?.checkIn?.questions || []) {
    const v = answers?.[q.key];
    if (v == null || String(v).trim() === '') continue;
    if (q.choices && !q.choices.includes(v)) continue;
    clean[q.key] = String(v).trim().slice(0, 500);
  }
  return { id: noteId(date), at, date, topic: TOPIC, text: `${plan?.title || 'Recovery'} check-in: ${answersText(plan, clean) || 'no answers.'}`, answers: clean, by };
}

/** Which check-in questions an answer leaves out (the choice ones; "anything new" may be blank = nothing new). */
export const missingAnswers = (plan, answers = {}) => (plan?.checkIn?.questions || []).filter((q) => q.choices && !answers[q.key]).map((q) => q.key);

/** A task ticked (or unticked) in the state doc. */
export function withTask(state, id, done, by = 'app', now = Date.now()) {
  const tasks = { ...(state?.tasks || {}) };
  if (done) tasks[id] = { doneAt: now, by }; else delete tasks[id];
  return { ...(state || {}), tasks };
}

/** The checkup date he booked (null clears it). */
export const withCheckup = (state, date, by = 'app', now = Date.now()) => ({ ...(state || {}), checkup: date ? { date, setAt: now, by } : null });

/** The poses of the recovery photos, and where they stand: {poses, last, dueOn, due, overdue}. */
export function photoStatus(plan, photos = [], date) {
  const p = plan?.photos;
  if (!p?.poses?.length) return null;
  const mine = photos.filter((x) => x?.date && x.dataUrl && p.poses.includes(x.pose) && x.date <= date).map((x) => x.date).sort();
  const last = mine.at(-1) || null;
  const minD = p.minDays || 14; const maxD = p.maxDays || 28;
  const dueOn = last ? addDays(last, minD) : p.from || plan.checkIn?.from || plan.since || date;
  return { poses: p.poses, last, dueOn, due: date >= dueOn, overdue: last ? date > addDays(last, maxD) : false, takenToday: mine.includes(date) };
}

/**
 * Reminders for a date (kind 'recovery'), all at his recovery time: the check-in on the day it falls due and every
 * few days until answered; the open tasks with it (or weekly on their own once the check-ins have ended); photos on
 * the day they fall due and weekly until taken; the evening before a booked checkup.
 */
export function recoveryReminders({ date, tz, plan, state = null, notes = [], photos = [], hm = '20:15' }) {
  if (!plan?.since || date < plan.since) return [];
  const out = [];
  const title = plan.title || 'Recovery';
  const base = { kind: 'recovery', url: '#/body/recovery', fixed: false };
  const st = checkInStatus(plan, state, notes, date);
  const tasks = openTasks(plan, state);
  const taskLine = tasks.length ? `Still to do: ${tasks.map((t) => t.text.charAt(0).toLowerCase() + t.text.slice(1)).join('; ')}.` : '';
  const every = plan.checkIn?.askAgainDays || 2;
  if (st.active && st.due && daysBetween(st.dueOn, date) % every === 0) {
    const qs = plan.checkIn.questions || [];
    const asks = qs.map((q) => q.ask || q.label).join(' ');
    out.push({ ...base, id: `recovery-checkin:${date}`, at: zonedTime(date, hm, tz), tag: 'recovery-checkin', title: `${title}: weekly check-in`, body: [asks, taskLine].filter(Boolean).join(' '), againText: checkInAgainText(title, qs), due: true });
  } else if (tasks.length && daysBetween(plan.checkIn?.from || plan.since, date) % 7 === 0) {
    out.push({ ...base, id: `recovery-tasks:${date}`, at: zonedTime(date, hm, tz), tag: 'recovery-tasks', title: `${title}: still to do`, body: taskLine,
      againText: `${title}, your list is still open: ${tasks.map((t) => t.text.charAt(0).toLowerCase() + t.text.slice(1)).join('; ')}. Done any of it? Tell me, or tick it in Body > Recovery.`, due: true });
  }
  const ph = photoStatus(plan, photos, date);
  if (ph?.due && daysBetween(ph.dueOn, date) % 7 === 0) {
    out.push({
      ...base, id: `recovery-photos:${date}`, at: zonedTime(date, addMinutesHm(hm, 5), tz), tag: 'recovery-photos', url: '#/body/recovery', title: `${title}: photos`,
      body: `${ph.last ? `Last ones ${dayText(ph.last)}.` : 'None yet.'} ${plan.photos.how || ''}`.trim(), due: !ph.takenToday,
      againText: `${title} photos still not taken today. ${plan.photos.poses?.length || 'A few'} quick shots in Body > Recovery.`,
    });
  }
  const cu = state?.checkup?.date;
  if (cu && date === addDays(cu, -1)) {
    const qs = plan.checkupQuestions || [];
    out.push({ ...base, id: `recovery-checkup:${cu}`, at: zonedTime(date, hm, tz), tag: 'recovery-checkup', title: 'Checkup tomorrow', body: `${dayText(cu)}.${qs.length ? ` Your list for it: ${qs.join('; ')}.` : ''}`, again: false, due: true });
  }
  return out;
}

/**
 * The follow-up to an unanswered weekly check-in, in other words than the check-in itself (Thu 10/29: the same check-in
 * went out twice, word for word, ten minutes apart): "Surgery recovery: no answer yet. Tenderness and puffiness: gone,
 * less, same or more? Anything new? One line does it."
 */
export function checkInAgainText(title, questions = []) {
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
  const or = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0] || '');
  const low = (t) => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
  const rated = questions.filter((q) => q.choices?.length);
  const open = questions.filter((q) => !q.choices?.length).map((q) => `${q.label || q.ask}`.replace(/[?.]*$/, '?'));
  const head = rated.length ? and(rated.map((q) => low(q.label || q.key))) : '';
  const scale = rated.length ? `${head.charAt(0).toUpperCase()}${head.slice(1)}: ${or(rated[0].choices.map(low))}?` : '';
  return [`${title}: no answer yet.`, scale, ...open, 'One line does it.'].filter(Boolean).join(' ');
}

/** The coach's lines for today: where he is, and what is due (so the coach asks, never works out dates itself). */
export function recoveryLines({ plan, state = null, notes = [], photos = [], date }) {
  if (!plan?.since) return [];
  const since = sinceText(plan, date);
  if (!since) return [];
  const st = checkInStatus(plan, state, notes, date);
  const end = st.endsOn;
  const lines = [`${plan.title || 'Recovery'}: today is ${since} since ${plan.sinceText || dayText(plan.since)}. Use only what his record marks CURRENT for today.`];
  if (st.active) {
    lines.push(st.due ? `Weekly recovery check-in DUE (last: ${st.last ? `${dayText(st.last.date)}, "${st.last.text}"` : 'none yet'}). Ask it briefly when the moment fits (not during a set, a hold or the sauna): ${(plan.checkIn.questions || []).map((q) => q.ask || q.label).join(' ')} Save his answer with the recovery tool.`
      : `Weekly recovery check-in: ${st.last ? `done ${dayText(st.last.date)}; ` : ''}next ${dayText(st.dueOn)}.`);
    if (end) lines.push(`Check-ins run until ${state?.checkup?.date ? `his checkup, ${dayText(end)}` : plan.untilText || dayText(end)}.`);
  }
  const tasks = openTasks(plan, state);
  if (tasks.length) lines.push(`Still to do (his list): ${tasks.map((t) => `${t.text}${t.detail ? ` (${t.detail})` : ''}`).join('; ')}.`);
  const ph = photoStatus(plan, photos, date);
  if (ph) lines.push(ph.due ? `Recovery photos due (${ph.last ? `last ${dayText(ph.last)}` : 'none yet'}): Body > Recovery.` : `Recovery photos: ${ph.last ? `last ${dayText(ph.last)}, ` : ''}next from ${dayText(ph.dueOn)}.`);
  return lines;
}
