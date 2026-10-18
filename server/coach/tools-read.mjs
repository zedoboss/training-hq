// The coach's read tools (8.2, brief sections 7 and 11): schedule and programme, history and calendar, Health,
// meals, supplements, body scans, sauna, squat sessions, notes. Each answers in short lines with the formats he
// asked for, computed by the app's own rules (the same modules the phone uses), so the coach repeats them instead of
// working anything out.
import { snapshot, dayText, whenText, timeText, loadText, repsText, mmss, plural, findByName, k, formatHm } from './shared.mjs';
import { LABEL, addDays } from '../../app/js/lib/rotation.js';
import { weekColumn } from '../../app/js/lib/programme.js';
import { buildSession, summarize, elapsedMs } from '../../app/js/lib/session.js';
import { targetFor } from '../../app/js/lib/targets.js';
import { confirmedKg, modeOf, isConfirmed } from '../../app/js/lib/progression.js';
import { currentBodyweight, healthDays, hoursText, weightSeries } from '../../app/js/lib/health.js';
import { roundsByDate, areaStatus, holdSlots, PHASE_TEXT } from '../../app/js/lib/holds.js';
import { ACTION_TEXT, askedAreas } from '../../app/js/lib/readiness.js';
import { dayMarks, setText, weekStreak, workoutDates, sessionsPerWeek, sourceOf, SOURCE_LABEL } from '../../app/js/lib/calendar.js';
import { sessionPoints, records, repRecords } from '../../app/js/lib/records.js';
import { dayTotals, mealTotals, beforeItems, leftovers, netItems, mealState, STATE_SHORT, mealMarks } from '../../app/js/lib/meals.js';
import { checklist, statusOn, stockStatus, lastsText, adherence, streak, dayKindFrom, daysText, FOOD_TEXT, suppMarks, doseFor } from '../../app/js/lib/supplements.js';
import { lowAnswered } from '../../app/js/lib/fuel-reminders.js';
import { scanStatus, protocolOf, lastDone, isDone, conditionNotes, latestChange, scanMarks, SAFETY_ASK, projectRotation } from '../../app/js/lib/scans.js';
import { ladderState, stepText, LADDER, PASSES_TO_UNLOCK, doctorDue, DOCTOR_QUESTION, hadSymptoms, passed, phaseOf, saunaMarks, CHECKLIST, SYMPTOMS, GET_OUT, BREAK_MIN, OVERDUE_MIN } from '../../app/js/lib/sauna.js';
import { runText, squatMarks } from '../../app/js/lib/squat-log.js';
import { latestByField } from '../../app/js/lib/body.js';
import { neckAsk, neckToday, neckDoneOn, placeLabel } from '../../app/js/lib/neck.js';
import { addMinutesHm } from '../../app/js/lib/time.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DAY_TYPE = { type: 'string', enum: ['pull', 'push', 'legs', 'neck'] };

// ---- the active session -------------------------------------------------------------------------------------------

/** The exercise he is on: the one he ticked last if it still has sets left, else the first with sets left. */
export function currentExercise(session, sets) {
  const open = (key) => sets.some((x) => x.exKey === key && !x.done);
  const lastTicked = [...sets].filter((x) => x.done && x.doneAt).sort((a, b) => b.doneAt - a.doneAt)[0];
  if (lastTicked && open(lastTicked.exKey)) return session.exercises.find((e) => e.key === lastTicked.exKey) || null;
  return session.exercises.find((e) => open(e.key)) || null;
}

/** "set 2 of 3: 60 kg total (...) × 8-10 (target)" for the next set of an exercise. */
export function nextSetText(ex, sets) {
  const mine = sets.filter((x) => x.exKey === ex.key);
  const i = mine.findIndex((x) => !x.done);
  if (i < 0) return `${ex.name}: all ${mine.length} sets done`;
  const x = mine[i];
  const t = x.target || {};
  const kgv = x.kg ?? t.kg;
  const what = x.type === 'hold' ? `hold ${x.durationS ?? 30} s${kgv != null ? ` at ${loadText(kgv, ex.barKg)}` : ''}` : `${kgv != null ? loadText(kgv, ex.barKg) : ex.type === 'reps_only' ? 'bodyweight' : 'no load set'}${t.reps ? ` × ${repsText(t.reps)}` : ''}`;
  return `${ex.name}, set ${i + 1} of ${mine.length}${x.type !== 'normal' ? ` (${x.type})` : ''}: ${what}`;
}

export function activeText(s, session) {
  const sets = s.setsOf(session.id);
  const sum = summarize(session, sets);
  const cur = currentExercise(session, sets);
  const ticked = sets.filter((x) => x.done).length;
  return `Session in progress: ${session.title}, started ${timeText(session.startedAt, s.tz)} (${Math.round(elapsedMs(session, s.now) / 60000)} min), ${ticked} of ${sets.length} sets ticked, volume ${sum.volume.toLocaleString('en-US')} kg.${cur ? ` Now: ${nextSetText(cur, sets)}.` : ' Every set is ticked: finish it on the phone.'}`;
}

// ---- today --------------------------------------------------------------------------------------------------------

const weekOf = (s, dayType, date) => weekColumn(s.meta()?.firstSessions?.[dayType], date);

/** The days ahead from today, if each planned session happens on its day: [{date, kind, dayType}]. */
export const ahead = (s, n = 8) => projectRotation({ last: s.last(), days: s.days(), from: s.today, n });

/** "Coming up ...": dates and day types from the app's rotation, so nobody works out a weekday by hand. */
function comingUp(s, n = 8) {
  const list = ahead(s, n).filter((d) => d.date > s.today);
  return `Coming up, if each planned session happens on its day: ${list.map((d) => `${dayText(d.date, s.today)} ${d.kind === 'rest' ? 'rest' : `${LABEL[d.dayType]} (week ${weekOf(s, d.dayType, d.date)})`}`).join('; ')}.`;
}

function rotationLines(s) {
  const rot = s.rotation(); const t = rot.today; const days = s.days();
  const out = [];
  const nxt = rot.next;
  const wk = weekOf(s, nxt.dayType, nxt.date);
  if (t.kind === 'train') out.push(`Today: ${LABEL[t.dayType]} (week ${wk} column), not done yet.`);
  else if (t.kind === 'done') out.push(`Today: ${LABEL[t.dayType]} done. Next: ${LABEL[nxt.dayType]}, ${dayText(nxt.date, s.today)} (week ${wk} column).`);
  else out.push(`Today: rest (${t.reason === 'rotation' ? 'the rest day after Legs' : t.reason === 'moved' ? 'session moved to tomorrow at the check-in' : t.reason === 'rest-holds' ? 'rest and tendon holds, from the check-in' : 'a rest day he added'}). Next: ${LABEL[nxt.dayType]}, ${dayText(nxt.date, s.today)} (week ${wk} column).`);
  const hm = days[nxt.date]?.sessionTime;
  const pre = s.settings().notify.readinessMin;
  out.push(hm ? `Session time ${nxt.date === s.today ? 'today' : dayText(nxt.date, s.today)}: ${formatHm(hm)}, check-in ${formatHm(addMinutesHm(hm, -pre))}.` : `No session time set for ${nxt.date === s.today ? 'today' : dayText(nxt.date, s.today)} (he sets it on Train).`);
  const rd = days[s.today]?.readiness;
  if (t.kind !== 'rest' || rd) out.push(rd ? `Check-in today: rule ${rd.rule}, ${ACTION_TEXT[rd.action] || rd.action}${rd.lighterExercises?.length ? ` (${rd.lighterExercises.join(', ')})` : ''}` : 'Check-in today: not done.');
  const last = s.last();
  if (last) out.push(`Last rotation session: ${LABEL[last.dayType]}, ${dayText(last.date, s.today)}.`);
  out.push(comingUp(s));
  const modes = s.one('progression', 'modes');
  if (modeOf(modes, nxt.dayType) === 'comeback' && wk >= 5 && !isConfirmed(s.list('progression'), nxt.dayType, wk)) out.push(`Week ${wk} numbers for ${LABEL[nxt.dayType]} need his OK (Train > Review); until then the last confirmed numbers apply.`);
  return out;
}

function holdLines(s) {
  const areas = s.list('tendons').filter((a) => a.kind === 'area');
  const rot = s.rotation();
  const rounds = roundsByDate(areas, s.list('sessions'), s.list('sets'), s.one('bridge', 'last-loads'));
  const st = s.settings().notify;
  const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType: rot.today.kind === 'rest' ? null : rot.today.dayType, roundsToday: Object.fromEntries(Object.entries(rounds).map(([id, d]) => [id, d[s.today] || 0])), times: { morning: st.holdsMorning, evening: st.holdsEvening } });
  if (!slots.length) return ['Tendon holds today: none planned.'];
  return [`Tendon holds today: ${slots.map((x) => `${x.label} ${x.slot === 'after' ? 'after the session' : x.slot === 'rest' ? `rest day (${formatHm(x.time)})` : `${x.slot} ${formatHm(x.time)}`}: ${x.exercise}${x.also?.length ? ` + ${x.also.join(', ')}` : ''}, ${x.done ? 'DONE' : 'open'}`).join('; ')}.`];
}

function suppDayKind(s, date) {
  return dayKindFrom({ sessions: s.list('sessions'), bridge: s.one('bridge', 'last-loads'), days: s.list('days'), date, today: s.today, tz: s.tz });
}

function suppLine(s) {
  const supps = s.list('supplements'); const log = s.list('supp-log');
  const groups = checklist({ supps, log, date: s.today, dayKind: suppDayKind(s, s.today) });
  const items = groups.flatMap((g) => g.items);
  if (!items.length) return 'Supplements today: none scheduled.';
  const taken = items.filter((i) => i.entry?.status === 'taken').length;
  const skipped = items.filter((i) => i.entry?.status === 'skipped').length;
  const open = items.filter((i) => !i.entry).map((i) => i.supp.short || i.supp.name);
  return `Supplements today: ${taken} of ${items.length} taken${skipped ? `, ${skipped} skipped` : ''}${open.length ? `; open: ${open.join(', ')}` : ''}.`;
}

function foodLine(s) {
  const plan = s.one('fuel', 'plan') || {};
  const t = dayTotals(s.list('meals'), s.list('meal-estimates'), s.today);
  return `Food today: ${t.kcal.toLocaleString('en-US')} kcal of ${plan.kcal ? plan.kcal.toLocaleString('en-US') : '?'}, ${t.protein} g protein of ${plan.proteinG ?? '?'} g (${plural(t.meals, 'meal')}${t.estimated ? `, ${t.estimated} still estimates` : ''}${t.unread ? `, ${t.unread} being read` : ''}).`;
}

function scanLine(s) {
  const st = scanStatus({ plan: s.one('scan-plan', 'main') || {}, scans: s.list('body-scans'), today: s.today, last: s.last(), days: s.days() });
  if (st.next) return `Body scan: next ${dayText(st.next.date, s.today)}${st.next.date === s.today ? ' (TODAY, first thing at the gym)' : ''}, confirmed.`;
  return `Body scan: none confirmed; the app proposes ${dayText(st.proposal.date, s.today)}.`;
}

/** Everything that matters today, in lines (the 'today' tool). */
export function todayText(s) {
  const lines = [...rotationLines(s)];
  const active = s.active();
  if (active) lines.push(activeText(s, active));
  lines.push(...holdLines(s), suppLine(s), foodLine(s), scanLine(s));
  const neck = s.one('schedule', 'neck');
  if (s.list('routines').some((r) => r.dayType === 'neck')) {
    if (neck?.planned) {
      const t = s.rotation().today;
      const due = neckToday(neck, t.kind, t.dayType);
      const done = neckDoneOn(s.list('sessions'), s.today, s.date);
      lines.push(`Neck: his plan puts it ${placeLabel(neck.place).replace(/^\w/, (c) => c.toLowerCase())}${!due ? '.' : done ? '; done today.' : `; due today${t.kind === 'done' ? ', now' : t.dayType ? ` after ${LABEL[t.dayType]}` : ''} (Train offers it).`}`);
    } else if (neckAsk(neck, s.today)) lines.push('Neck: his Neck routine is still unplanned (the app asks once a week where it goes).');
  }
  const sauna = s.list('sauna').find((x) => x.status === 'active');
  if (sauna) lines.push(`Sauna session in progress (${stepText(sauna.stepIndex ?? 0)}).`);
  return lines.join('\n');
}

/** The context block of every message: the rotation and the session in progress (short; the 'today' tool has the rest). */
export function contextLine({ store, tz, now }) {
  const s = snapshot(store, { tz, now });
  const lines = [...rotationLines(s).slice(0, 3), comingUp(s, 6)];
  const active = s.active();
  if (active) lines.push(activeText(s, active));
  return lines.join('\n');
}

// ---- programme ----------------------------------------------------------------------------------------------------

function programmeText(s, { dayType = null, week = null } = {}) {
  const rot = s.rotation();
  const type = dayType || rot.next.dayType;
  const date = type === rot.next.dayType ? rot.next.date : ahead(s, 14).find((d) => d.kind !== 'rest' && d.dayType === type && d.date >= s.today)?.date || s.today;
  const wkNow = weekOf(s, type, date);
  const wk = week || wkNow;
  const modes = s.one('progression', 'modes');
  const mode = modeOf(modes, type);
  const routines = s.list('routines');
  const routine = routines.filter((r) => r.dayType === type && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((a, b) => a.order - b.order)[0] || routines.find((r) => r.dayType === type);
  if (!routine) return `No routine for ${LABEL[type] || type}.`;
  const progDocs = s.list('programme').filter((d) => d.kind === 'routine');
  const progress = s.list('progression');
  const lib = s.lib();
  const history = s.history();
  const st = s.settings();
  const rd = s.days()[s.today]?.readiness;
  const lighter = !week && rd && rd.dayType === type && (rd.action === 'lighter-all' || rd.action === 'lighter-area') ? { all: rd.action === 'lighter-all', names: rd.lighterExercises || [], params: rd.params, rule: rd.rule } : null;
  const head = `${routine.title}${mode === 'normal' ? ' (Normal programme)' : ''}, ${week ? `week ${wk} column (asked for)` : `${date === s.today ? 'today' : dayText(date, s.today)}, week ${wk} column`}${lighter ? `, lighter from today's check-in (rule ${lighter.rule})` : ''}. Loads are total kg.`;
  const lines = [head];
  if (!week || week === wkNow) {
    // Exactly what Start would give today (the same function as the phone's Start button).
    const { session, sets } = buildSession({
      routine, meta: s.meta(), programmeRoutines: progDocs, lib, history, today: date, now: s.now,
      smallestPlate: s.minPlate(), gym: null, warmupSteps: st.warmup.steps, sameRoutine: st.previousFrom === 'same-routine',
      bodyweightKg: currentBodyweight({ healthDocs: s.list('health'), manual: st.bodyweight, now: s.now })?.kg ?? null, progress, lighter,
    });
    session.exercises.forEach((ex, i) => {
      const mine = sets.filter((x) => x.exKey === ex.key);
      const work = mine.filter((x) => x.type !== 'warmup');
      const warm = mine.length - work.length;
      const t = ex.target || {};
      const kgv = t.kg ?? work.find((x) => x.kg != null)?.kg ?? null;
      const reps = t.reps || work[0]?.target?.reps;
      const load = t.bodyweight ? 'bodyweight' : t.added ? `+${k(kgv)} kg added` : kgv != null ? loadText(kgv, ex.barKg) : 'no load yet';
      const last = history.last(ex.name);
      lines.push(`${i + 1}. ${ex.name}: ${plural(work.length, 'set')}${warm ? ` (+${warm} warm-up)` : ''} × ${repsText(reps) || '?'} at ${load}${t.why ? `. Why: ${t.why}` : ''}${t.gated ? ' (gated on form on video)' : ''}${last ? `. Last: ${dayText(last.date, s.today)}, ${last.sets.filter((x) => x.type !== 'warmup').map((x) => setText(x, ex.type)).join(', ')}` : ''}.`);
    });
  } else {
    for (const [i, re] of routine.exercises.entries()) {
      const pe = re.plan ? progDocs.find((d) => d.id === re.plan.routine)?.exercises.find((e) => e.comebackName === re.plan.name) : null;
      const ex = lib.get(re.exerciseId) || { barKg: null };
      if (!pe) { lines.push(`${i + 1}. ${re.name}: not in the table (follows his last load).`); continue; }
      const last = history.last(re.name);
      const t = targetFor({ plan: pe, week: wk, last: last?.heaviest ? { ...last.heaviest, date: last.date } : null, barKg: ex.barKg ?? null, smallestPlate: s.minPlate(), progressKg: wk > 4 ? confirmedKg(progress, type, wk, pe.name)?.kg ?? null : null });
      const cell = pe.weeks?.find((w) => w.week === Math.min(4, wk));
      lines.push(`${i + 1}. ${re.name}: ${t.bodyweight ? 'bodyweight' : t.kg != null ? loadText(t.kg, ex.barKg) : '?'} × ${repsText(t.reps)}, ${plural(t.sets ?? 0, 'set')}. Why: ${t.why}.${cell ? ` Table: ${cell.text}.` : ''}`);
    }
  }
  return lines.join('\n');
}

// ---- tendons ------------------------------------------------------------------------------------------------------

function tendonsText(s) {
  const areas = s.list('tendons').filter((a) => a.kind === 'area');
  const rounds = roundsByDate(areas, s.list('sessions'), s.list('sets'), s.one('bridge', 'last-loads'));
  const lines = ['Tendon areas (from his tendon note and his decisions; the app adds no rehab advice):'];
  for (const a of areas) {
    const st = areaStatus(a, rounds[a.id] || {}, s.today);
    lines.push(`- ${a.label}: ${PHASE_TEXT[a.phase] || a.phase}. ${st.text}.${a.reported ? ` Reported: ${a.reported}` : ''}`);
    for (const h of a.holds || []) {
      const load = h.loadNote || (h.loadKg != null ? `${k(h.loadKg)} kg total` : h.load === 'full stack' ? `full stack${h.loadKgLogged != null ? ` (logged as ${k(h.loadKgLogged)} kg)` : ''}` : h.loadKgLogged != null ? `${k(h.loadKgLogged)} kg` : h.load || 'load not recorded');
      const when = Array.isArray(h.timing) ? h.timing.join(' and ') : h.when || '';
      lines.push(`  hold: ${h.exercise}, ${load}, ${h.sets ?? 3} × ${h.seconds ?? 30} s${h.where ? `, at ${h.where}` : ''}${when ? `, ${when}` : ''}.`);
    }
    if (a.loadsArea?.exercises?.length) lines.push(`  loads this area: ${a.loadsArea.exercises.join(', ')}.`);
  }
  lines.push(...holdLines(s));
  lines.push('Rules (his note): hold at least 30 s, 3 sets; pain during a hold may reach 3-4 out of 10 if it is not worse the next day; if it is, less weight or push less hard. Heal: 3 sets twice a day, then 3-4 times a week for 4-8 weeks. Maintenance: 5-10 minutes after a workout or one day a week.');
  const table = s.one('tendons', 'readiness');
  if (table) lines.push(`Readiness table: ${table.status === 'confirmed' ? `confirmed${table.confirmedOn ? ` ${dayText(table.confirmedOn, s.today)}` : ''}` : 'a DRAFT he has not confirmed yet (he confirms it on the check-in screen before its first use)'}. Asked: ${askedAreas(areas).map((a) => a.label).join(', ')}, legs/back by day type, energy.`);
  const rd = s.days()[s.today]?.readiness;
  if (rd) lines.push(`Today's check-in: rule ${rd.rule}, ${ACTION_TEXT[rd.action] || rd.action}.`);
  return lines.join('\n');
}

// ---- history ------------------------------------------------------------------------------------------------------

function sessionText(s, session, lib, { detail = true } = {}) {
  const sets = s.setsOf(session.id).filter((x) => x.done);
  const mins = session.endedAt ? Math.round(elapsedMs(session) / 60000) : null;
  const sum = summarize(session, sets);
  const head = `${whenText(session.startedAt, s.tz, s.today)} · ${session.title}${session.dayType ? '' : ''} (${SOURCE_LABEL[sourceOf(session)] || sourceOf(session)})${mins ? ` · ${mins} min` : ''} · ${sum.done} sets · ${sum.volume.toLocaleString('en-US')} kg volume${session.status === 'active' ? ' · IN PROGRESS' : ''}`;
  if (!detail) return head;
  const ex = (session.exercises || []).map((e) => {
    const mine = sets.filter((x) => x.exKey === e.key);
    return mine.length ? `  ${e.name}: ${mine.map((x) => setText(x, e.type)).join(', ')}${e.notes ? ` (note: ${e.notes})` : ''}` : null;
  }).filter(Boolean);
  return [head, ...ex, ...(session.note ? [`  Session note: ${session.note}`] : [])].join('\n');
}

function historyText(s, { exercise = null, from = null, to = null, dayType = null, limit = null }) {
  const lib = s.lib();
  if (exercise) {
    const history = s.history();
    const names = new Set();
    for (const x of s.list('sessions')) for (const e of x.exercises || []) names.add(e.name);
    for (const n of Object.keys(s.one('bridge', 'last-loads')?.exercises || {})) names.add(n);
    const { item, ambiguous } = findByName([...names].map((name) => ({ name })), exercise);
    if (!item) return ambiguous.length ? `Which one: ${ambiguous.join('; ')}?` : `No exercise in his history matches "${exercise}".`;
    const entries = history.all(item.name);
    const type = [...lib.values()].find((e) => e.name === item.name)?.type || 'weight_reps';
    const n = Math.min(limit || 8, 30);
    const lines = [`${item.name}: ${plural(entries.length, 'session')} in his history.`];
    for (const e of entries.slice(0, n)) lines.push(`${dayText(e.date, s.today)} (${SOURCE_LABEL[e.source] || e.source}): ${e.sets.map((x) => setText(x, type)).join(', ')}`);
    const pts = sessionPoints(entries, type);
    const rec = records(pts, type);
    if (rec.length) lines.push(`Records: ${rec.map((r) => `${r.label} ${k(r.value)}${r.unit ? ` ${r.unit}` : ''}${r.set ? ` (${setText(r.set, type)})` : ''}, ${dayText(r.date, s.today)}`).join('; ')}.`);
    const rr = repRecords(entries, 15);
    if (rr.length) lines.push(`Best weight by reps: ${rr.map((r) => `${r.reps}: ${k(r.kg)} kg`).join(', ')}.`);
    return lines.join('\n');
  }
  const end = to || s.today;
  const start = from || addDays(end, -13);
  let list = s.list('sessions').filter((x) => x.kind !== 'holds' && (x.status === 'done' || x.status === 'active'))
    .filter((x) => { const d = s.date(x.startedAt); return d >= start && d <= end; })
    .filter((x) => !dayType || x.dayType === dayType)
    .sort((a, b) => b.startedAt - a.startedAt);
  const total = list.length;
  list = list.slice(0, Math.min(limit || 12, 40));
  if (!total) return `No sessions from ${dayText(start, s.today)} to ${dayText(end, s.today)}${dayType ? ` (${LABEL[dayType]})` : ''}.`;
  return [`${plural(total, 'session')} from ${dayText(start, s.today)} to ${dayText(end, s.today)}, newest first${total > list.length ? ` (showing ${list.length})` : ''}:`, ...list.map((x, i) => sessionText(s, x, lib, { detail: i < 8 }))].join('\n');
}

// ---- calendar -----------------------------------------------------------------------------------------------------

function calendarText(s, { month = null, from = null, to = null }) {
  const ym = month || s.today.slice(0, 7);
  const [y, mo] = ym.split('-').map(Number);
  const monthEnd = addDays(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`, -1);
  const start = from || `${ym}-01`;
  const end = to || (month ? monthEnd : s.today);
  const supps = s.list('supplements'); const log = s.list('supp-log');
  const marks = dayMarks({ sessions: s.list('sessions'), sets: s.list('sets'), tz: s.tz, extra: [...squatMarks(s.list('squats'), s.tz), ...mealMarks(s.list('meals'), s.list('meal-estimates'), s.tz), ...suppMarks(supps, log), ...saunaMarks(s.list('sauna')), ...scanMarks(s.list('body-scans'))] });
  const days = s.days();
  const lines = [];
  for (let d = start; d <= end && lines.length < 62; d = addDays(d, 1)) {
    const m = marks.get(d);
    const parts = [];
    for (const w of m?.workouts || []) parts.push(`${w.title} (${SOURCE_LABEL[w.source] || w.source})`);
    if (m?.holds?.length) parts.push(`holds ×${m.holds.length}`);
    for (const e of m?.extra || []) parts.push(e.label);
    if (days[d]?.rest) parts.push(`rest day (${days[d].rest.reason})`);
    if (parts.length) lines.push(`${dayText(d, s.today)}: ${parts.join('; ')}`);
  }
  const dates = workoutDates(marks);
  const firstDay = s.settings().firstDayOfWeek;
  const streak = weekStreak(dates, s.today, firstDay);
  const per = sessionsPerWeek(marks, s.today, { firstDay, weeks: 4 });
  return [`From ${dayText(start, s.today)} to ${dayText(end, s.today)}:`, ...(lines.length ? lines : ['Nothing logged.']),
    `Week streak: ${streak.current} week${streak.current === 1 ? '' : 's'} in a row with a workout (best ${streak.best}). Sessions this week: ${per.thisWeek}; average over the ${per.weeks} weeks before: ${per.average}.`].join('\n');
}

// ---- health -------------------------------------------------------------------------------------------------------

function healthText(s, { days = 14 }) {
  const n = Math.min(Math.max(Number(days) || 14, 1), 120);
  const docs = s.list('health').filter((d) => d.date >= addDays(s.today, -(n - 1)) && d.date <= s.today).sort((a, b) => (a.date < b.date ? 1 : -1));
  const meta = s.one('health-meta', 'status');
  const lines = [meta?.last?.at ? `Apple Health: last file from the iPhone made ${whenText(meta.last.at, s.tz, s.today)}.` : 'Apple Health: no file from the iPhone yet (the Shortcut is his to set up).'];
  for (const d of docs) {
    const parts = [];
    if (d.steps != null) parts.push(`${Number(d.steps).toLocaleString('en-US')} steps`);
    if (d.sleep?.asleepMin || d.sleep?.inBedMin) parts.push(`slept ${hoursText(d.sleep.asleepMin || d.sleep.inBedMin)}${d.sleep.bed && d.sleep.wake ? ` (${timeText(d.sleep.bed, s.tz)} to ${timeText(d.sleep.wake, s.tz)})` : ''}`);
    if (d.weights?.length) parts.push(`weight ${k(d.weights.at(-1).kg)} kg`);
    for (const w of d.workouts || []) parts.push(`workout: ${w.activity || 'other'}${w.minutes ? ` ${Math.round(w.minutes)} min` : ''}${w.start ? ` at ${timeText(w.start, s.tz)}` : ''}`);
    if (parts.length) lines.push(`${dayText(d.date, s.today)}: ${parts.join(', ')}`);
  }
  const bw = currentBodyweight({ healthDocs: s.list('health'), manual: s.settings().bodyweight, now: s.now });
  if (bw) lines.push(`Bodyweight used for pull-ups: ${k(bw.kg)} kg (${bw.from === 'health' ? 'Apple Health' : 'typed in'}${bw.at ? `, ${whenText(bw.at, s.tz, s.today)}` : ''}).`);
  const shown = latestByField(s.list('measurements')).map((f) => `${f.label} ${k(f.value)}${f.kind === 'kg' ? ' kg' : f.kind === 'cm' ? ' cm' : f.kind === '%' ? '%' : ''} (${dayText(f.date, s.today)}${f.prev != null ? `; before ${k(f.prev)}` : ''})`);
  if (shown.length) lines.push(`Latest measurements: ${shown.join('; ')}.`);
  return lines.join('\n');
}

// ---- meals --------------------------------------------------------------------------------------------------------

export function mealsText(s, { date = null }) {
  const d = date || s.today;
  const meals = s.list('meals').filter((m) => m.date === d).sort((a, b) => a.at - b.at);
  const est = s.list('meal-estimates');
  const plan = s.one('fuel', 'plan') || {};
  const t = dayTotals(s.list('meals'), est, d);
  const lines = [`${dayText(d, s.today)}: ${t.kcal.toLocaleString('en-US')} kcal, ${t.protein} g protein (targets ${plan.kcal ?? '?'} kcal, ${plan.proteinG ?? '?'} g protein; his September plan).`];
  for (const m of meals) {
    const b = beforeItems(m, est);
    const l = leftovers(m, est);
    const eaten = b.items ? netItems(b.items, l.items) : null;
    const mt = mealTotals(m, est);
    lines.push(`- ${m.name} ${timeText(m.at, s.tz)} [id ${m.id}] (${STATE_SHORT[mealState(m, est, s.now)] || mealState(m, est, s.now)}${b.estimated && b.items ? ', estimate' : ''}): ${eaten ? eaten.map((x) => `${x.name} ${Math.round(x.grams)} g`).join(', ') || 'nothing' : 'being read'}${mt.known ? `; ${mt.kcal} kcal, ${mt.protein} g protein` : ''}${m.note ? `; note: ${m.note}` : ''}`);
  }
  if (!meals.length) lines.push('No meals logged.');
  if (plan.foods?.length) lines.push(`His usual foods: ${plan.foods.map((f) => f.name).join('; ')}.`);
  return lines.join('\n');
}

// ---- supplements --------------------------------------------------------------------------------------------------

function supplementsText(s, { date = null }) {
  const d = date || s.today;
  const supps = s.list('supplements'); const log = s.list('supp-log');
  const dayKind = suppDayKind(s, d);
  const groups = checklist({ supps, log, date: d, dayKind });
  const lines = [`Supplements for ${dayText(d, s.today)} (${dayKind === 'rest' ? 'rest day' : 'training day'}). He decides what he takes; never suggest a supplement or a dose.`];
  for (const g of groups) {
    lines.push(`${g.label}${g.time ? ` (${formatHm(g.time)})` : ''}: ${g.items.map((i) => `${i.supp.name} ${i.dose}: ${i.entry ? `${i.entry.status.toUpperCase()}${i.entry.reason ? ` (${i.entry.reason})` : ''} ${timeText(i.entry.at, s.tz)}` : 'open'}`).join('; ')}`);
  }
  const answers = s.list('supp-answers');
  lines.push('His list:');
  for (const x of supps.filter((y) => statusOn(y, s.today) !== 'removed').sort((a, b) => (a.order ?? 99) - (b.order ?? 99))) {
    const stock = stockStatus(x, log);
    const a7 = adherence(x, log, s.today, 7); const a30 = adherence(x, log, s.today, 30);
    lines.push(`- ${x.name} [id ${x.id}]: ${doseFor(x, dayKind)}${x.doseRest ? ` (rest days ${x.doseRest}, training days ${x.dose})` : ''}, ${x.time ? formatHm(x.time) : 'no time set'}, ${x.withFood ? FOOD_TEXT[x.withFood] : 'food not set'}, ${daysText(x.days)}${statusOn(x, s.today) === 'paused' ? ', PAUSED' : ''}; ${stock ? `${stock.left} servings left, ${lastsText(stock.days)}${stock.low ? ` LOW${lowAnswered(x, answers) ? ' (answered)' : ' (restock not asked yet)'}` : ''}` : 'stock not tracked'}; taken ${a7.pct ?? '-'}% of 7 days, ${a30.pct ?? '-'}% of 30.`);
  }
  const st = streak({ supps, log, today: s.today });
  lines.push(`Streak: ${plural(st.days, 'day')} in a row with everything taken.`);
  const cons = s.list('supp-considering').filter((c) => c.status === 'considering');
  lines.push(cons.length ? `Considering: ${cons.map((c) => `${c.name}${c.note ? ` (${c.note})` : ''}`).join('; ')}.` : 'Considering: nothing.');
  const weekly = answers.filter((a) => a.kind === 'weekly').sort((a, b) => b.at - a.at)[0];
  if (weekly) lines.push(`Last weekly planning answer: ${dayText(weekly.date, s.today)}, ${weekly.answer}${weekly.text ? ` (${weekly.text})` : ''}.`);
  return lines.join('\n');
}

// ---- body scans ---------------------------------------------------------------------------------------------------

function scansText(s) {
  const plan = s.one('scan-plan', 'main') || {};
  const scans = s.list('body-scans');
  const st = scanStatus({ plan, scans, today: s.today, last: s.last(), days: s.days() });
  const items = protocolOf(plan);
  const lines = ['Body scans (Evolt 360 at his gym; every 4 weeks, first thing at the gym before the workout, same conditions). Describe changes in numbers; never diagnose.'];
  lines.push(st.next ? `Next scan: ${dayText(st.next.date, s.today)} (confirmed)${st.onRest ? `; that is now a rest day in the rotation, the next training day is ${dayText(st.onRest.to, s.today)}` : ''}.` : `No date confirmed. Proposed: ${dayText(st.proposal.date, s.today)}${st.proposal.dayType ? ` (a ${LABEL[st.proposal.dayType]} day)` : ''}${st.proposal.lastDate ? `, 4 weeks after ${dayText(st.proposal.lastDate, s.today)}` : ', the first scan'}.`);
  if (st.missed) lines.push(`Missed: the scan confirmed for ${dayText(st.missed, s.today)} has no results.`);
  lines.push(plan.safety?.readAt ? `Safety notice read: ${whenText(plan.safety.readAt, s.tz, s.today)}.` : `Safety notice: not read yet. ${SAFETY_ASK}`);
  if (plan.staff?.length) lines.push(`What his gym's staff said: ${plan.staff.map((x) => x.text).join(' | ')}`);
  const rec = st.next ? scans.find((x) => x.date === st.next.date) : null;
  lines.push(`Preparation checklist${rec ? ` for ${dayText(rec.date, s.today)}` : ''}: ${items.map((i) => `${i.text}${rec?.prep?.ticks?.[i.id] ? ' [ticked]' : ''}`).join(' / ')}`);
  const done = scans.filter(isDone).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const x of done.slice(0, 4)) {
    const notes = conditionNotes(x, items);
    lines.push(`Scan ${dayText(x.date, s.today)}${x.at ? ` ${timeText(x.at, s.tz)}` : ''}${notes.length ? ` (different conditions: ${notes.join('; ')})` : ''}: ${(x.metrics || []).slice(0, 30).map((m) => `${m.label} ${m.text ?? m.value}${m.unit ? ` ${m.unit}` : ''}`).join('; ')}`);
  }
  if (!done.length) lines.push('No scan results yet.');
  const ch = latestChange(scans, items);
  if (ch?.lines?.length) lines.push(`Latest change over ${ch.days} days: ${ch.lines.map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l))).join('; ')}${ch.reasons?.length ? ` (not directly comparable: ${ch.reasons.join('; ')})` : ''}.`);
  return lines.join('\n');
}

// ---- sauna --------------------------------------------------------------------------------------------------------

function saunaText(s) {
  const sessions = s.list('sauna');
  const plan = s.one('sauna-plan', 'main') || {};
  const st = ladderState(sessions, s.today, plan);
  const lines = [`Sauna ladder (fixed rules in the app; never suggest more than this): today's step ${stepText(st.step)} (step ${st.step + 1} of ${LADDER.length}); ${st.passes} of ${PASSES_TO_UNLOCK} clean sessions in a row at this step.${st.reasons.length ? ` ${st.reasons.join(' ')}` : ''}`];
  const due = doctorDue(plan, st, st.step);
  const answers = plan.doctor || [];
  lines.push(`Doctor question ("${DOCTOR_QUESTION}"): ${answers.length ? `answered ${answers.map((a) => `${a.answer} (${dayText(s.date(a.at), s.today)}, ${a.context})`).join('; ')}` : 'not asked yet'}${due ? `; due again now (${due})` : ''}. The app records the answer and gives no other medical advice.`);
  const active = sessions.find((x) => x.status === 'active');
  if (active) {
    const ph = phaseOf(active, s.now);
    lines.push(`IN PROGRESS: ${stepText(active.stepIndex ?? 0)}; ${ph.phase === 'in' ? `in round ${ph.round}, planned out at ${timeText(ph.plannedEnd, s.tz)}${ph.overdue ? ', OVERDUE (alarm)' : ''}` : ph.phase === 'break' ? `break after round ${ph.round}${ph.answered ? ', answered no symptoms' : ', symptom question open'}` : ph.phase}.`);
  }
  const open = sessions.find((x) => x.status !== 'active' && x.after && !x.after.answeredAt);
  if (open) lines.push(`The question 15 minutes after the session of ${dayText(open.date, s.today)} is open${s.now >= open.after.dueAt ? ' (due now)' : ` (due ${timeText(open.after.dueAt, s.tz)})`}.`);
  for (const x of [...sessions].filter((y) => y.status !== 'active').sort((a, b) => b.startedAt - a.startedAt).slice(0, 5)) {
    const mins = (x.rounds || []).filter((r) => r.outAt).map((r) => Math.round((r.outAt - r.inAt) / 60000));
    lines.push(`- ${dayText(x.date, s.today)}: ${stepText(x.stepIndex ?? 0)}, did ${mins.join(', ') || 0} min${x.tempC ? `, ${x.tempC}°C` : ''}; ${hadSymptoms(x) ? `STOPPED, symptoms: ${[...(x.symptoms || []).flatMap((y) => y.what || []), ...(x.after?.what || [])].join(', ') || 'noted'}` : passed(x) ? 'clean' : x.status === 'ended' ? 'ended early (no symptoms)' : 'not completed as planned'}${x.note ? `; note: ${x.note}` : ''}`);
  }
  lines.push(`Before a session he ticks: ${CHECKLIST.map((c) => c.text.replace(/\.$/, '')).join(' / ')}. Never before lifting. Break ${BREAK_MIN} min; alarm ${OVERDUE_MIN} min past the round time. Any of these ends the round and the session: ${SYMPTOMS.join(', ')}. Then: ${GET_OUT}`);
  if (plan.saunaName || plan.usualTempC) lines.push(`His sauna: ${plan.saunaName || 'not named'}${plan.usualTempC ? `, usually ${plan.usualTempC}°C` : ''}.`);
  return lines.join('\n');
}

// ---- squat depth --------------------------------------------------------------------------------------------------

function squatText(s, { limit = 5 }) {
  const runs = s.list('squats').filter((r) => r.reps?.length).sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.min(Number(limit) || 5, 20));
  if (!runs.length) return 'No Squat Depth runs yet.';
  return [`Squat Depth runs (target ${runs[0].targetDeg ?? 75}°; thighs parallel is about 72°), newest first:`, ...runs.map((r) => `${whenText(r.startedAt, s.tz, s.today)}: ${runText(r)}${r.reps?.length ? ` (reps ${r.reps.map((x) => `${Math.round(x.minDeg)}°`).join(', ')})` : ''}${r.link?.sessionId ? ' · filled into a squat set' : ''}`)].join('\n');
}

// ---- notes --------------------------------------------------------------------------------------------------------

function notesText(s, { limit = 20 }) {
  const notes = s.list('coach-notes').sort((a, b) => b.at - a.at).slice(0, Math.min(Number(limit) || 20, 60));
  const rem = s.list('coach-reminders').filter((r) => !r.cancelledAt).sort((a, b) => a.at - b.at);
  const lines = [notes.length ? 'Notes, newest first:' : 'No notes yet.', ...notes.map((n) => `- ${whenText(n.at, s.tz, s.today)}${n.topic ? ` [${n.topic}]` : ''} [id ${n.id}]: ${n.text}`)];
  const upcoming = rem.filter((r) => r.at >= s.now - 3600000);
  if (upcoming.length) lines.push('Reminders set:', ...upcoming.map((r) => `- ${whenText(r.at, s.tz, s.today)} [id ${r.id}]: ${r.text}`));
  return lines.join('\n');
}

const read = (name, title, description, inputSchema, fn) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true }, run: async (args, ctx) => {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const text = fn(s, args || {});
  return { text, summary: text.split('\n')[0].slice(0, 120) };
} });

export const READ_TOOLS = [
  read('today', 'Today', "Everything about today: the rotation (today's day type, week column, or why it's a rest day, and the next session), the session time and check-in, the session in progress with the next set, tendon holds due, supplements, food so far, the next body scan. Call it first for any question about today or tomorrow.", obj(), (s) => todayText(s)),
  read('programme', 'Programme', "A day's routine with each exercise's target for the next session (exactly what Start gives: total kg with the bar and plates per side, reps, sets, and why: table, 30% cap, check-in), plus last time. dayType defaults to the next session; week shows another week's column.", obj({ dayType: DAY_TYPE, week: { type: 'integer', minimum: 1, maximum: 12 } }), (s, a) => programmeText(s, a)),
  read('tendons', 'Tendons', 'His tendon areas with their phase, holds (load, sets, seconds, where, when), what is done and due, his note\'s rules, the readiness table and today\'s check-in.', obj(), (s) => tendonsText(s)),
  read('history', 'History', "His training history (Strong, Hevy and Training HQ, all imported). With exercise: that exercise's sessions set by set, its records and best weight per rep count. Without: the sessions in a date range (default the last 14 days), set by set.", obj({ exercise: { type: 'string', description: 'what he calls it, e.g. "squat", "cable row"' }, from: ISO, to: ISO, dayType: DAY_TYPE, limit: { type: 'integer', minimum: 1, maximum: 40 } }), (s, a) => historyText(s, a)),
  read('calendar', 'Calendar', 'Day by day what happened: sessions, holds, meals, supplements, squat depth, sauna, body scans, rest days, plus the week streak. A month (YYYY-MM, default this month) or a date range.', obj({ month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, from: ISO, to: ISO }), (s, a) => calendarText(s, a)),
  read('health', 'Apple Health', 'Steps, sleep, weight and workouts per day from Apple Health (the iPhone Shortcut), the bodyweight used for pull-ups, and his latest body measurements.', obj({ days: { type: 'integer', minimum: 1, maximum: 120 } }), (s, a) => healthText(s, a)),
  read('meals', 'Meals', 'Meals on a day (default today) with items, grams, kcal and protein, their state, the day total against his targets, and his usual foods.', obj({ date: ISO }), (s, a) => mealsText(s, a)),
  read('supplements', 'Supplements', "His supplement list as he set it (dose, rest-day dose, time, with food, days, stock left), the checklist for a day (default today), streak, adherence, considering list and planning answers. Tracking only: never suggest a supplement or a dose.", obj({ date: ISO }), (s, a) => supplementsText(s, a)),
  read('body_scans', 'Body scans', 'The Evolt 360 scan plan: next date or proposal, safety notice, staff instructions, preparation checklist, past results with their conditions, the latest change.', obj(), (s) => scansText(s)),
  read('sauna', 'Sauna', "The sauna ladder (today's step, clean sessions needed), the doctor question, a session in progress, the last sessions with symptoms, and the fixed rules. The ladder and hard stops can't be changed.", obj(), (s) => saunaText(s)),
  read('squat_sessions', 'Squat Depth', 'Recent Squat Depth runs: good and shallow reps, the lowest angle, each rep.', obj({ limit: { type: 'integer', minimum: 1, maximum: 20 } }), (s, a) => squatText(s, a)),
  read('notes', 'Notes', 'Notes the coach wrote for him, and reminders set.', obj({ limit: { type: 'integer', minimum: 1, maximum: 60 } }), (s, a) => notesText(s, a)),
];

export { suppDayKind };
