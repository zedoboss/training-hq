// Sauna (step 6, brief section 11): a safety system first, a tracker second. Every rule here is the brief's own;
// the app adds no health advice. The ladder, the hard stops and the step-back rules are fixed: nothing (not the coach)
// can talk its way around them. Pure functions; the screens, reminders and the Mac pass the records in.
//
// sauna       {id, date, startedAt, endedAt, stepIndex, plannedRounds, roundMin, hotter, tempC, saunaName, status:
//              'active'|'done'|'stopped'|'ended', checklist, energy, rounds: [{n, planned, inAt, outAt}],
//              breaks: [{after, startAt, endAt, symptoms}], symptoms: [{at, when, what: []}], after: {dueAt, answeredAt,
//              symptoms, what} | null, weighIn: {beforeKg, afterKg} | null, note}
// sauna-plan  'main': {doctor: [{at, answer, context}], maintenanceStep, planned: [{date, time}], emergency: {name, phone},
//              saunaName, usualTempC}
import { daysBetween, addMinutesHm } from './time.js';

/** The ladder, step by step (brief section 11). Index 12 is the goal: 4 rounds of 30 minutes. */
export const LADDER = [
  { rounds: 1, min: 10 }, { rounds: 1, min: 12 }, { rounds: 1, min: 15 },
  { rounds: 2, min: 10 }, { rounds: 2, min: 12 }, { rounds: 2, min: 15 }, { rounds: 2, min: 20 },
  { rounds: 3, min: 15 }, { rounds: 3, min: 20 }, { rounds: 3, min: 25 },
  { rounds: 4, min: 20 }, { rounds: 4, min: 25 }, { rounds: 4, min: 30 },
];
export const GOAL_STEP = LADDER.length - 1;
export const PASSES_TO_UNLOCK = 2;
export const BREAK_MIN = 5;
export const OVERDUE_MIN = 5;
export const AFTER_MIN = 15;
export const LONG_BREAK_DAYS = 14;

export const stepText = (i) => { const s = LADDER[i]; return s.rounds === 1 ? `1 round of ${s.min} minutes` : `${s.rounds} rounds of ${s.min} minutes, ${BREAK_MIN}-minute breaks`; };
export const stepShort = (i) => { const s = LADDER[i]; return s.rounds === 1 ? `1 × ${s.min} min` : `${s.rounds} × ${s.min} min`; };

/** Symptoms that end the round and the whole session (brief section 11, hard stops). */
export const SYMPTOMS = ['Light-headed', 'Dizzy', 'Sick', 'Headache', 'Cramps', 'Racing or pounding heart', 'Chest discomfort', 'Blurred vision', 'Confusion', 'Just "off"'];

/** What to do on a hard stop, in the brief's words. */
export const GET_OUT = 'Get out, sit or lie down, cool down gradually and drink.';

/** Before a session: every item ticked, or the app tells him to skip today. 'company' is "if possible". */
export const CHECKLIST = [
  { id: 'fed', text: "I've eaten and drunk water in the last few hours.", sub: 'Never straight after a fasted workout with nothing in me.' },
  { id: 'clear', text: "No alcohol, I'm not ill, and I slept reasonably." },
  { id: 'energy', text: 'My readiness energy rating today is 2 or 3.' },
  { id: 'kit', text: 'I have water with me, and my cold towel or ice pack.' },
  { id: 'company', text: "Someone else is in the sauna area or the staff know I'm in there.", sub: 'If possible.', optional: true },
];

export const DOCTOR_QUESTION = 'Have you checked with a doctor about sauna use, given your surgery and infection this year and the light-headed episode?';
export const DOCTOR_ANSWERS = [['yes', 'Yes, I have'], ['not-yet', 'Not yet'], ['no', 'No']];

const finished = (s) => s && s.status !== 'active' && s.startedAt;
/** A session where he reported anything: a symptom in a round or a break, I FEEL OFF, or yes 15 minutes after. */
export const hadSymptoms = (s) => (s.symptoms || []).length > 0 || s.after?.symptoms === true || (s.breaks || []).some((b) => b.symptoms === true);
/** Every planned round done for its full time, every break answered no, and the 15-minutes-after answer was no. */
export function passed(s) {
  if (s.status !== 'done' || hadSymptoms(s)) return false;
  const rounds = (s.rounds || []).filter((r) => r.inAt && r.outAt);
  if (rounds.length < s.plannedRounds) return false;
  if (rounds.some((r) => r.outAt - r.inAt < (r.planned * 60 - 30) * 1000)) return false;
  return s.after?.answeredAt != null && s.after.symptoms === false;
}

/**
 * Where he is on the ladder, from every finished session (brief section 11):
 * - every step needs two sessions in a row with no symptoms before the next unlocks; the app never skips a step;
 * - after a symptom, the next session goes back one step from the one he did, and that step must be passed twice again;
 * - two symptom sessions in a row: back two steps, and the doctor question comes again;
 * - after a break of two weeks or more: back three steps;
 * - a clearly hotter sauna is done two steps back and doesn't count towards the next step;
 * - at his chosen maintenance level it stays there.
 * @returns {{step, passes, last, symptomRun, doctorAgain, reasons: string[], cap}}
 */
export function ladderState(sessions = [], today, plan = {}) {
  const cap = Number.isInteger(plan.maintenanceStep) ? Math.min(GOAL_STEP, Math.max(0, plan.maintenanceStep)) : GOAL_STEP;
  let step = 0; let passes = 0; let run = 0; let prev = null; let doctorAgain = null;
  let reasons = [];
  const list = sessions.filter(finished).sort((a, b) => a.startedAt - b.startedAt);
  for (const s of list) {
    reasons = [];
    if (prev && daysBetween(prev.date, s.date) >= LONG_BREAK_DAYS) { step = Math.max(0, step - 3); passes = 0; }
    const did = Number.isInteger(s.stepIndex) ? s.stepIndex : step;
    if (hadSymptoms(s)) {
      run++;
      step = Math.max(0, did - (run >= 2 ? 2 : 1));
      passes = 0;
      reasons.push(run >= 2 ? 'Two sessions in a row with symptoms: back two steps.' : 'Symptoms last time: back one step, to be passed twice again.');
      if (run >= 2) doctorAgain = s.id;
    } else {
      run = 0;
      if (passed(s) && !s.hotter && did === step) {
        passes++;
        if (passes >= PASSES_TO_UNLOCK && step < cap) { step++; passes = 0; reasons.push('Two clean sessions in a row: the next step is unlocked.'); }
      } else if (!passed(s)) {
        passes = 0;
        reasons.push('Last session was not completed as planned: this step needs two full, clean sessions in a row.');
      }
    }
    step = Math.min(step, cap);
    prev = s;
  }
  if (prev && today && daysBetween(prev.date, today) >= LONG_BREAK_DAYS) {
    step = Math.max(0, step - 3); passes = 0;
    reasons = [`No sauna for ${daysBetween(prev.date, today)} days (two weeks or more): back three steps.`];
  }
  return { step, passes, last: prev, symptomRun: run, doctorAgain, reasons, cap };
}

/** Today's step: the ladder's, or two steps back in a clearly hotter sauna. A lower step can be chosen, never a higher one. */
export const todayStep = (state, { hotter = false } = {}) => (hotter ? Math.max(0, state.step - 2) : state.step);

/**
 * Is the doctor question due before this session (brief section 11)? Before the first planned session; again before
 * the plan first goes past two rounds; again after two symptom sessions in a row. Returns the context, or null.
 * The answer is recorded; the app gives no other medical advice.
 */
export function doctorDue(plan = {}, state, step) {
  const asked = (ctx) => (plan.doctor || []).some((d) => d.context === ctx);
  if (!(plan.doctor || []).length) return 'first';
  if (LADDER[step].rounds > 2 && !asked('past-two-rounds')) return 'past-two-rounds';
  if (state?.doctorAgain && !asked(`after-${state.doctorAgain}`)) return `after-${state.doctorAgain}`;
  return null;
}

/**
 * Gates before a session starts (the brief's rules, in its words). Returns the reasons to skip today; empty = go.
 * @param {object} o
 * @param {object} o.ticks       {fed, clear, energy, kit: true|false, company: 'yes'|'not-possible'|null}
 * @param {number|null} o.energy today's readiness energy rating (0-3) if he checked in
 * @param {boolean} o.liftingLeft a lifting session is planned today and not done yet
 */
export function gates({ ticks = {}, energy = null, liftingLeft = false }) {
  const out = [];
  if (liftingLeft) out.push('Never before lifting. Train first, or make today a rest day.');
  if (energy != null && energy < 2) out.push(`Your readiness energy rating today is ${energy}. The sauna needs 2 or 3.`);
  for (const c of CHECKLIST) {
    if (c.optional) { if (!ticks[c.id]) out.push(`Answer: ${c.text}`); continue; }
    if (ticks[c.id] !== true) out.push(`Not ticked: ${c.text}`);
  }
  return out;
}

/** Where a running session is: {phase: 'ready'|'in'|'break'|'after', round, ...}. */
export function phaseOf(s, now = Date.now()) {
  const rounds = s.rounds || [];
  const cur = rounds.find((r) => r.inAt && !r.outAt);
  if (cur) {
    const plannedEnd = cur.inAt + cur.planned * 60000;
    return { phase: 'in', round: cur.n, plannedEnd, overdueAt: plannedEnd + OVERDUE_MIN * 60000, overdue: now >= plannedEnd + OVERDUE_MIN * 60000, over: now >= plannedEnd };
  }
  const done = rounds.filter((r) => r.outAt).length;
  if (done >= s.plannedRounds) return { phase: 'after', round: done };
  if (done > 0) {
    const br = (s.breaks || []).find((b) => b.after === done);
    const breakEnd = (br?.startAt ?? rounds[done - 1].outAt) + BREAK_MIN * 60000;
    return { phase: 'break', round: done, breakEnd, answered: br?.symptoms === false, ready: now >= breakEnd && br?.symptoms === false };
  }
  return { phase: 'ready', round: 0 };
}

// The steps of a running session that end it, shared by the round screen and the coach (the coach can record what
// he says; it can never add a round or time). Each returns the new session record.

/** I FEEL OFF (or "yes" to the break question): the round and the whole session end now, with what he felt. */
export function feelOffState(s, { when = 'button', what = [], now = Date.now() } = {}) {
  const rounds = (s.rounds || []).map((r) => (r.inAt && !r.outAt ? { ...r, outAt: now } : r));
  const breaks = (s.breaks || []).map((b) => (b.symptoms == null && !b.endAt ? { ...b, symptoms: true, endAt: now } : b));
  return { ...s, rounds, breaks, status: 'stopped', endedAt: s.endedAt ?? now, symptoms: [...(s.symptoms || []), { at: now, when, what: [...what] }] };
}

/** End here, with no symptoms: an open round closes now; the 15-minute question follows. Doesn't count as clean. */
export function endHereState(s, now = Date.now()) {
  const rounds = (s.rounds || []).map((r) => (r.inAt && !r.outAt ? { ...r, outAt: now } : r));
  const breaks = (s.breaks || []).map((b) => (b.symptoms == null ? { ...b, symptoms: false, endAt: now } : { ...b, endAt: b.endAt ?? now }));
  return { ...s, rounds, status: 'ended', endedAt: now, breaks, after: { dueAt: now + AFTER_MIN * 60000, answeredAt: null, symptoms: null, what: [] } };
}

/** His answer to the question 15 minutes after. */
export function afterAnswerState(s, { symptoms, what = [], now = Date.now() }) {
  return { ...s, after: { ...(s.after || { dueAt: now }), answeredAt: now, symptoms: !!symptoms, what: symptoms ? [...what] : [] } };
}

/** The 15-minutes-after question time. */
export const afterDueAt = (s) => (s.endedAt ?? Date.now()) + AFTER_MIN * 60000;

/** Weigh-in: fluid lost, to drink back (1 kg of water is 1 litre). */
export function fluidLost(w) {
  if (!w || w.beforeKg == null || w.afterKg == null) return null;
  const kg = Math.round((w.beforeKg - w.afterKg) * 10) / 10;
  return kg > 0 ? kg : 0;
}

/** Calendar markers (dayMarks extra): {date, kind: 'sauna', id, label, symptoms}. */
export function saunaMarks(sessions = []) {
  return sessions.filter(finished).sort((a, b) => a.startedAt - b.startedAt).map((s) => {
    const done = (s.rounds || []).filter((r) => r.outAt);
    const mins = done.map((r) => Math.round((r.outAt - r.inAt) / 60000));
    return {
      date: s.date, kind: 'sauna', id: s.id, symptoms: hadSymptoms(s),
      label: `Sauna: ${done.length} of ${s.plannedRounds} round${s.plannedRounds === 1 ? '' : 's'} (${mins.join(', ') || 0} min)${hadSymptoms(s) ? ' · stopped: symptoms' : s.status === 'done' ? '' : ' · ended early'}${s.tempC ? ` · ${s.tempC}°C` : ''}`,
    };
  });
}

/** The planned time of day for a sauna reminder ("HH:MM"), else midday. */
export const plannedHm = (p) => (/^\d{2}:\d{2}$/.test(p?.time || '') ? p.time : addMinutesHm('12:00', 0));
