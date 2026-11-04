// The coach's body tools (Thu 11/5, his words: "What else cant u do? Figure it out and let the mac give U the tools"):
// what his Body, Sauna, classes, recovery, reminders, photo and stats screens can do that the coach had no tool for.
// Every write is used only on his words, never on the coach's own idea; deletions only when he says delete. They write
// the same records the screens write, with the app's own code: the sauna ladder and hard stops, the checklist gates
// and the readiness table are untouched (a session he tells about goes through the same ladder code as a real one).
import { snapshot, dayText, timeText, findByName, wrote, refuse, k, formatHm, plural } from './shared.mjs';
import { put, del, num } from './tools-write.mjs';
import { MEASURE_FIELDS, fieldOf, stored, filled, measureIdFor, latestByField, photoId, POSES } from '../../app/js/lib/body.js';
import { scanId, isDone } from '../../app/js/lib/scans.js';
import { LADDER, BREAK_MIN, AFTER_MIN, CHECKLIST, SYMPTOMS, GET_OUT, SAUNA_TIME, ladderState, todayStep, stepText, gates, doctorDue, hadSymptoms, passed } from '../../app/js/lib/sauna.js';
import { DISCIPLINE, COMBAT_IDS, kickTestNote, kickTestId, kickTests } from '../../app/js/lib/activities.js';
import { checkInNote, noteId as recoveryNoteId, checkIns, missingAnswers } from '../../app/js/lib/recovery.js';
import { withAnswer } from '../../app/js/lib/walks.js';
import { hoursText, withBodyweights, dailyWeights, weightSeries } from '../../app/js/lib/health.js';
import { setRows, PERIODS, periodRange, totals, distribution, weeklyVolume, changePct, monthReport, topExercises } from '../../app/js/lib/stats.js';
import { muscleLabel } from '../../app/js/lib/exercise-types.js';
import { zonedTime, hmOf } from '../../app/js/lib/time.js';
import { addDays } from '../../app/js/lib/rotation.js';
import { newId } from '../../app/js/lib/routines.js';
import { plan as notifyPlan, nextRepeatAt, repeatDays, SENT } from '../notify.mjs';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HM = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: '24-hour "HH:MM" in his time zone' };
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HIS_WORDS = 'Only when he tells you to (his words), never on your own idea.';
const snap = (ctx) => snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
const unitOf = (kind) => (kind === 'kg' ? 'kg' : kind === 'cm' ? 'cm' : '%');
const valueText = (f, v) => `${f.label} ${k(v)}${f.kind === '%' ? '%' : ` ${unitOf(f.kind)}`}`;
const findField = (q) => fieldOf(q) || findByName(MEASURE_FIELDS, q, (f) => f.label, (f) => [f.key.replace(/(Cm|Kg)$/, '').replace(/([A-Z])/g, ' $1')]).item;

// ---- body_log: measurements, steps and walks by hand -------------------------------------------------------------

function bodyLog(a, ctx) {
  const s = snap(ctx);
  const date = a.date || s.today;
  if (date > s.today) return refuse('Not a future date.');
  if (a.action === 'measurements') {
    // As Body > Measurements saves them: one entry per date (the one there, his or Hevy's), stored in kg, cm and %.
    const values = a.values || [];
    if (!values.length) return refuse('Which measurements? Give each as field (waist, chest, left biceps ...) and value.');
    const list = s.list('measurements');
    const id = measureIdFor(date, list);
    const cur = s.one('measurements', id);
    const next = { ...(cur || { id, date, source: 'manual' }) };
    const saved = []; const bad = [];
    for (const x of values) {
      const f = findField(x.field);
      if (!f) { bad.push(`"${x.field}" is not a measurement (${MEASURE_FIELDS.map((m) => m.label).join(', ')})`); continue; }
      const units = { weight: x.unit === 'lb' ? 'lb' : 'kg', body: x.unit === 'in' ? 'in' : 'cm' };
      const v = stored(f.kind, String(x.value), units);
      if (v == null || Number.isNaN(v)) { bad.push(`${f.label} ${x.value}${x.unit ? ` ${x.unit}` : ''} is out of range`); continue; }
      next[f.key] = v; saved.push(f);
    }
    if (bad.length) return refuse(`Nothing saved: ${bad.join('; ')}.`);
    if (a.note) next.note = String(a.note).slice(0, 400);
    next.updatedAt = s.now;
    if (date === s.today && !cur) next.at = s.now;
    const before = latestByField(list.filter((m) => m.date < date));
    put(s, 'measurements', id, next);
    const parts = saved.map((f) => { const b = before.find((x) => x.key === f.key); return `${valueText(f, next[f.key])}${b ? ` (was ${k(b.value)}, ${dayText(b.date, s.today)})` : ''}`; });
    return wrote(`Saved for ${dayText(date, s.today)}: ${parts.join('; ')}. On Body > Measurements.`, `measurements ${date}`);
  }
  if (a.action === 'steps') {
    const steps = num(a.steps);
    if (!(steps >= 0 && steps <= 100000)) return refuse('How many steps?');
    const cur = s.one('health', date);
    const had = cur?.steps;
    put(s, 'health', date, { ...(cur || { id: date, date, steps: null, sleep: null, weights: [], workouts: [] }), id: date, steps: Math.round(steps), stepsBy: 'coach', stepsAt: s.now, updatedAt: s.now });
    return wrote(`Steps for ${dayText(date, s.today)}: ${Math.round(steps).toLocaleString('en-US')}${had != null ? ` (Apple Health had ${Number(had).toLocaleString('en-US')})` : ''}. On Body's steps chart. A later Apple Health file that covers that whole day replaces it with Health's count.`, `steps ${date}`);
  }
  if (a.action === 'walk') {
    // A walk he did, on the day's walk record (the walk questions count it); a past day needs its time.
    if (date !== s.today && !a.time) return refuse('What time was the walk?');
    const at = a.time ? zonedTime(date, a.time, s.tz) : s.now;
    if (at > s.now) return refuse('That time has not come yet. For a walk he plans: the walk tool.');
    const minutes = num(a.minutes) ?? null; const steps = num(a.steps) ?? null;
    put(s, 'walks', date, withAnswer(s.one('walks', date), date, { action: 'done', minutes, steps }, at));
    return wrote(`Walk logged for ${dayText(date, s.today)}, ${timeText(at, s.tz)}${minutes ? `, ${minutes} min` : ''}${steps != null ? `, ${steps.toLocaleString('en-US')} steps` : ''}.${steps != null ? ' To put a day\'s step total on Body, use action steps.' : ''}`, `walk ${date}`);
  }
  return refuse('action is measurements, steps or walk.');
}

// ---- body_delete: a wrong weigh-in, sleep entry, measurements or body scan ---------------------------------------

const WEIGHT_KEYS = ['weightKg', 'fatPercent', 'leanMassKg'];

function bodyDelete(a, ctx) {
  const s = snap(ctx);
  const date = a.date;
  if (!date) return refuse('Which day?');
  const day = dayText(date, s.today);
  if (a.action === 'weight' || a.action === 'measurements') {
    const m = s.list('measurements').find((x) => x.date === date);
    const health = (s.one('health', date)?.weights || []).length;
    let keys;
    if (a.action === 'weight') keys = WEIGHT_KEYS;
    else if (a.fields?.length) {
      keys = [];
      for (const q of a.fields) { const f = findField(q); if (!f) return refuse(`"${q}" is not a measurement.`); keys.push(f.key); }
    } else keys = MEASURE_FIELDS.map((f) => f.key);
    const gone = m ? MEASURE_FIELDS.filter((f) => keys.includes(f.key) && m[f.key] != null) : [];
    if (!gone.length) {
      return refuse(health && a.action === 'weight'
        ? `The weigh-in of ${day} comes from Apple Health (his iPhone), not the app: it can only be deleted in the Health app on his iPhone.`
        : `Nothing to delete: no ${a.action === 'weight' ? 'weigh-in' : 'such measurement'} saved for ${day}.`);
    }
    const next = { ...m };
    for (const f of gone) delete next[f.key];
    if (filled(next).length) put(s, 'measurements', m.id, { ...next, updatedAt: s.now });
    else del(s, 'measurements', m.id);
    const scan = s.one('body-scans', scanId(date));
    const notes = [
      health ? 'Apple Health still has a weigh-in that day (delete it in the Health app if it is wrong too).' : '',
      a.action === 'weight' && isDone(scan) ? 'The body scan of that day keeps its own numbers (body_delete scan removes them).' : '',
    ].filter(Boolean).join(' ');
    return wrote(`Deleted from ${day}: ${gone.map((f) => valueText(f, m[f.key])).join(', ')}.${filled(next).length ? ` Kept: ${filled(next).map((f) => f.label).join(', ')}.` : ''}${notes ? ` ${notes}` : ''}`, `deleted ${a.action} ${date}`);
  }
  if (a.action === 'sleep') {
    // The night to the morning `date`. What Apple Health has stays (his iPhone); the app's or the coach's entry goes.
    const l = s.one('sleep-log', date);
    const health = s.one('health', date)?.sleep;
    if (!l) return refuse(health ? `The sleep of the night to ${day} comes from Apple Health: it can only be changed in the Health app on his iPhone.` : `No sleep saved for the night to ${day}.`);
    del(s, 'sleep-log', date);
    // He said it's wrong: the app doesn't work that night out again from his activity (server/notify.mjs autoSleep).
    put(s, 'sleep-dismissed', date, { id: date, date, wake: l.wake, at: s.now, by: 'coach' });
    return wrote(`Deleted the sleep of the night to ${day}: ${timeText(l.bed, s.tz)} to ${timeText(l.wake, s.tz)}, ${hoursText(l.asleepMin ?? l.inBedMin)}${l.source === 'auto' ? ' (the app worked it out from his activity)' : ''}.${health ? ' Apple Health\'s sleep for that night shows instead.' : ''}`, `deleted sleep ${date}`);
  }
  if (a.action === 'scan') {
    // As the Scan results screen's Delete: the day's scan, its numbers and its photos.
    const rec = s.one('body-scans', scanId(date));
    if (!rec) return refuse(`No body scan saved for ${day}.`);
    const photos = s.list('scan-photos').filter((p) => p.scanId === scanId(date));
    s.store.writeLocalMany([...photos.map((p) => ({ col: 'scan-photos', id: p.id, deleted: true })), { col: 'body-scans', id: scanId(date), deleted: true }]);
    return wrote(`Deleted the body scan of ${day}${(rec.metrics || []).length ? ` (${plural(rec.metrics.length, 'number')})` : ''}${photos.length ? ` and its ${plural(photos.length, 'photo')}` : ''}. The day's weigh-in on Body stays (body_delete weight removes it).`, `deleted scan ${date}`);
  }
  return refuse('action is weight, measurements, sleep or scan.');
}

// ---- class_log: a logged boxing / kickboxing class, the kick test -----------------------------------------------

const isClass = (x) => x?.kind === 'workout' && (x.exercises || []).some((e) => COMBAT_IDS.has(e.exerciseId));

function classLog(a, ctx) {
  const s = snap(ctx);
  if (a.action === 'kick_test') {
    const front = num(a.front_cm) ?? null; const side = num(a.side_cm) ?? null;
    if (front == null && side == null) return refuse('Which heights? front_cm and side_cm, as he read them off the wall.');
    const date = a.date || s.today;
    if (date > s.today) return refuse('Not a future date.');
    const notes = s.list('coach-notes');
    const prev = kickTests(notes).filter((t) => t.date < date).at(-1);
    const doc = kickTestNote({ date, frontCm: front, sideCm: side, note: a.note ? String(a.note).slice(0, 200) : '', at: date === s.today ? s.now : zonedTime(date, '12:00', s.tz), by: 'coach' });
    put(s, 'coach-notes', kickTestId(date), doc);
    const diff = (now, before) => (now == null || before == null ? '' : ` (${now - before >= 0 ? '+' : '−'}${k(Math.abs(now - before))} cm)`);
    return wrote(`Kick test saved for ${dayText(date, s.today)}: ${[front != null ? `front ${k(front)} cm${diff(front, prev?.frontCm)}` : '', side != null ? `side ${k(side)} cm${diff(side, prev?.sideCm)}` : ''].filter(Boolean).join(', ')}${prev ? `, against ${dayText(prev.date, s.today)}` : ', his first with heights'}. The weekly kick test reminder counts it.`, `kick test ${date}`);
  }
  const classes = s.list('sessions').filter(isClass).sort((p, q) => q.startedAt - p.startedAt);
  let c = a.session ? classes.find((x) => x.id === a.session) : null;
  if (!c) {
    const day = a.date ? classes.filter((x) => s.date(x.startedAt) === a.date) : classes;
    // (On edit, discipline is the new one: only a delete narrows by it.)
    const pick = a.discipline && a.action === 'delete' ? day.filter((x) => x.exercises.some((e) => e.exerciseId === `${a.discipline}-class`)) : day;
    if (!pick.length) return refuse(a.date ? `No class logged on ${dayText(a.date, s.today)}.` : 'No class logged yet.');
    if (!a.date && !a.session) return refuse(`Which class? Give its date. The last ones: ${classes.slice(0, 5).map((x) => `${x.title}, ${dayText(s.date(x.startedAt), s.today)} [id ${x.id}]`).join('; ')}.`);
    if (pick.length > 1) return refuse(`Which one: ${pick.map((x) => `${x.title} at ${timeText(x.startedAt, s.tz)} [id ${x.id}]`).join('; ')}? Give its id as session.`);
    c = pick[0];
  }
  const sets = s.list('sets').filter((x) => x.sessionId === c.id);
  const minutesOf = (x) => Math.round((x.endedAt - x.startedAt - (x.pausedMs || 0)) / 60000);
  const what = `${c.title}, ${dayText(s.date(c.startedAt), s.today)}, ${minutesOf(c)} min`;
  if (a.action === 'delete') {
    s.store.writeLocalMany([...sets.map((x) => ({ col: 'sets', id: x.id, deleted: true })), { col: 'sessions', id: c.id, deleted: true }]);
    return wrote(`Deleted the class: ${what}. Gone from his calendar.`, `class deleted ${s.date(c.startedAt)}`);
  }
  if (a.action === 'edit') {
    const minutes = num(a.minutes) ?? minutesOf(c);
    if (!(minutes > 0 && minutes <= 240)) return refuse('How many minutes was the class?');
    const date = a.date_to || s.date(c.startedAt);
    if (date > s.today) return refuse('Not a future date.');
    const startHm = a.time || hmOf(new Date(c.startedAt), s.tz);
    const startedAt = zonedTime(date, startHm, s.tz);
    const endedAt = startedAt + minutes * 60000;
    if (endedAt > s.now + 60000) return refuse('That class would end after now.');
    const disc = a.discipline || (c.exercises.find((e) => COMBAT_IDS.has(e.exerciseId))?.exerciseId || 'boxing-class').replace(/-class$/, '');
    const name = DISCIPLINE[disc] || c.title;
    const exercises = c.exercises.map((e) => (COMBAT_IDS.has(e.exerciseId) && /-class$/.test(e.exerciseId) ? { ...e, exerciseId: `${disc}-class`, name: `${name} (Class)` } : e));
    const session = { ...c, title: name, startedAt, endedAt, pausedMs: 0, exercises, ...(a.note != null ? { note: String(a.note).slice(0, 500) } : {}) };
    const writes = sets.map((x) => ({ col: 'sets', id: x.id, data: { ...x, doneAt: endedAt, ...(x.durationS != null ? { durationS: minutes * 60 } : {}) } }));
    s.store.writeLocalMany([...writes, { col: 'sessions', id: c.id, data: session }]);
    return wrote(`Changed the class (${what}) to: ${name}, ${dayText(date, s.today)}, ${timeText(startedAt, s.tz)}, ${minutes} min${session.note ? ` (${session.note})` : ''}.`, `class edited ${date}`);
  }
  return refuse('action is edit, delete or kick_test.');
}

// ---- recovery_answers: fix or delete a past weekly check-in ----------------------------------------------------

function recoveryAnswers(a, ctx) {
  const s = snap(ctx);
  const plan = s.one('recovery', 'main');
  if (!plan) return refuse('No recovery record in the app.');
  const past = checkIns(s.list('coach-notes'));
  const note = a.date ? s.one('coach-notes', recoveryNoteId(a.date)) : null;
  if (!note) return refuse(`${a.date ? `No check-in saved on ${dayText(a.date, s.today)}.` : 'Which day?'} His check-ins: ${past.slice(0, 6).map((n) => `${dayText(n.date, s.today)}: ${n.text}`).join(' | ') || 'none yet'}.`);
  if (a.action === 'delete') {
    del(s, 'coach-notes', note.id);
    return wrote(`Deleted the check-in of ${dayText(note.date, s.today)}: ${note.text}`, `check-in deleted ${note.date}`);
  }
  if (a.action === 'edit') {
    const qs = plan.checkIn?.questions || [];
    const answers = { ...(note.answers || {}) };
    for (const x of a.answers || []) {
      const q = findByName(qs, x.question, (y) => y.label, (y) => [y.key]).item;
      if (!q) return refuse(`Not a check-in question: ${x.question}. Questions: ${qs.map((y) => y.label).join(', ')}.`);
      if (q.choices) {
        const c = q.choices.find((y) => y.toLowerCase() === String(x.answer || '').trim().toLowerCase());
        if (!c) return refuse(`${q.label}: answer with one of ${q.choices.join(', ')} (his word for it).`);
        answers[q.key] = c;
      } else answers[q.key] = String(x.answer || '').trim();
    }
    if (!(a.answers || []).length) return refuse('Which answers change?');
    const missing = missingAnswers(plan, answers);
    if (missing.length) return refuse(`Still missing: ${missing.join(', ')}.`);
    const next = { ...checkInNote(plan, answers, { date: note.date, at: note.at, by: note.by || 'coach' }), edited: s.now, was: note.text };
    put(s, 'coach-notes', note.id, next);
    return wrote(`Check-in of ${dayText(note.date, s.today)} now: ${next.text} (was: ${note.text})`, `check-in edited ${note.date}`);
  }
  return refuse('action is edit or delete.');
}

// ---- sauna_log: a session he did without the app, the checklist by voice ----------------------------------------

const CHECK_IDS = CHECKLIST.map((c) => c.id);

function saunaLog(a, ctx) {
  const s = snap(ctx);
  const sessions = s.list('sauna');
  const plan = s.one('sauna-plan', 'main') || {};
  const active = sessions.find((x) => x.status === 'active');
  if (a.action === 'log') {
    const date = a.date || s.today;
    if (date > s.today) return refuse('Not a future date.');
    if (!Array.isArray(a.symptoms)) return refuse('Ask him first whether he felt anything during it, in the breaks or after (light-headed, dizzy, sick, headache, cramps, heart racing, chest, vision, confused, "off"). symptoms: what he felt, [] only when he says nothing at all.');
    const mins = (Array.isArray(a.minutes) ? a.minutes : []).map(Number).filter((m) => m > 0 && m <= 90);
    if (!mins.length) return refuse('How many minutes was each round? minutes: one number per round.');
    const startAt = zonedTime(date, a.time || plan.time || SAUNA_TIME, s.tz);
    let t = startAt;
    const rounds = mins.map((m, i) => { const r = { n: i + 1, inAt: t, outAt: t + m * 60000 }; t = r.outAt + BREAK_MIN * 60000; return r; });
    const endAt = rounds.at(-1).outAt;
    if (endAt > s.now) return refuse('That session would end after now. For a session now: sauna_session start.');
    if (active && date === s.today) return refuse('A sauna session is running on his phone: that one is logged there.');
    const same = sessions.filter((x) => x.date === date && x.status !== 'active');
    if (same.length && !a.again) return refuse(`A sauna session on ${dayText(date, s.today)} is already logged (${same.map((x) => timeText(x.startedAt, s.tz)).join(', ')}). Log a second one only if he did two: again: true.`);
    // The ladder as it stood before this session (every session before it, the same code as the check screen).
    const st = ladderState(sessions.filter((x) => x.startedAt < startAt), date, plan);
    const step = todayStep(st, { hotter: Boolean(a.hotter) });
    const L = LADDER[step];
    const words = a.symptoms.map((x) => String(x).trim()).filter(Boolean).map((x) => SYMPTOMS.find((y) => y.toLowerCase().replace(/"/g, '') === x.toLowerCase().replace(/"/g, '')) || x.slice(0, 60));
    const sick = words.length > 0;
    const full = rounds.length >= L.rounds && rounds.every((r) => r.outAt - r.inAt >= (L.min * 60 - 30) * 1000);
    const id = newId('sauna');
    const doc = {
      id, date, startedAt: startAt, endedAt: endAt, stepIndex: step, proposedStep: step, plannedRounds: L.rounds, roundMin: L.min, hotter: Boolean(a.hotter), tempC: num(a.tempC) ?? null,
      saunaName: plan.saunaName || '', status: sick ? 'stopped' : full ? 'done' : 'ended', checklist: null, energy: null,
      rounds: rounds.map((r) => ({ ...r, planned: L.min })),
      breaks: rounds.slice(0, -1).map((r, i) => ({ after: i + 1, startAt: r.outAt, endAt: r.outAt + BREAK_MIN * 60000, symptoms: sick ? null : false })),
      symptoms: sick ? [{ at: endAt, when: 'told', what: words }] : [],
      after: { dueAt: endAt + AFTER_MIN * 60000, answeredAt: s.now, symptoms: sick, what: sick ? words : [] },
      weighIn: null, note: a.note ? String(a.note).slice(0, 300) : '', told: { at: s.now, by: 'coach' },
    };
    put(s, 'sauna', id, doc);
    const now = ladderState([...sessions, doc], s.today, plan);
    const over = rounds.length > L.rounds || mins.some((m) => m > L.min);
    const result = hadSymptoms(doc) ? `STOPPED (symptoms: ${words.join(', ')})` : passed(doc) ? 'clean' : 'not completed as planned (doesn\'t count as clean)';
    const doc2 = doctorDue(plan, now, now.step);
    return wrote([
      `Logged the sauna of ${dayText(date, s.today)}, ${timeText(startAt, s.tz)}: ${plural(rounds.length, 'round')} (${mins.join(', ')} min)${doc.hotter ? ', a clearly hotter sauna (two steps back, doesn\'t count towards the next step)' : ''}; his step then was ${stepText(step)}; ${result}.`,
      over ? `He did more than his step: the ladder counts it as ${stepText(step)} only. Tell him the ladder's step for next time; never suggest more.` : '',
      sick ? `Tell him: ${GET_OUT}` : '',
      `Ladder now: ${stepText(now.step)}, ${now.passes} of 2 clean sessions in a row at this step.${now.reasons.length ? ` ${now.reasons.join(' ')}` : ''}`,
      doc2 ? 'The doctor question is due before his next session (sauna tool).' : '',
    ].filter(Boolean).join(' '), `sauna logged ${date}`);
  }
  if (a.action === 'checklist') {
    // His ticks, only as he says each is done; the app's gates decide whether today is a go.
    if (active) return refuse('A sauna session is already running on his phone.');
    const docId = s.today;
    const cur = s.one('sauna-checks', docId) || { id: docId, date: s.today, ticks: {} };
    const ticks = { ...cur.ticks };
    for (const x of a.items || []) {
      const c = CHECKLIST.find((y) => y.id === x.item);
      if (!c) return refuse(`Checklist items: ${CHECKLIST.map((y) => `${y.id} (${y.text})`).join('; ')}.`);
      if (c.optional) ticks[c.id] = x.answer === 'not-possible' ? 'not-possible' : x.answer === 'no' ? null : 'yes';
      else ticks[c.id] = x.answer !== 'no';
    }
    const energy = s.days()[s.today]?.readiness?.ratings?.E ?? null;
    if (energy != null) ticks.energy = energy >= 2;
    const liftingLeft = s.rotation().today.kind === 'train';
    const st = ladderState(sessions, s.today, plan);
    // A clearly hotter sauna he mentioned once stays: two steps back (never forgotten on the next call).
    const hotter = a.hotter != null ? Boolean(a.hotter) : Boolean(cur.hotter);
    const step = todayStep(st, { hotter });
    const why = gates({ ticks, energy, liftingLeft });
    const docDue = doctorDue(plan, st, step);
    put(s, 'sauna-checks', docId, { ...cur, ticks, hotter, at: s.now, by: 'coach' });
    const ticked = CHECKLIST.filter((c) => ticks[c.id] === true || ticks[c.id] === 'yes' || ticks[c.id] === 'not-possible').map((c) => c.id);
    if (why.length || docDue) {
      return wrote(`Checklist so far: ${ticked.join(', ') || 'nothing'} ticked.${energy != null ? ` Energy ${energy} from today's check-in.` : ''} ${why.length ? `Not a go yet: ${why.join(' ')}` : ''}${docDue ? ' The doctor question must be answered first (sauna tool, sauna_plan doctor).' : ''} Only what he says is done gets ticked; if any line can't be ticked, today is a skip (his rule).`, 'sauna checklist');
    }
    if (!a.start) return wrote(`Every line ticked: the app says go, ${stepText(step)}${hotter ? ' (hotter sauna: two steps back)' : ''}. Never before lifting. When he says he's going in, call again with start: true and the run screen opens on his phone.`, 'sauna checklist: go');
    const L = LADDER[step];
    const id = newId('sauna');
    put(s, 'sauna', id, { id, date: s.today, startedAt: s.now, endedAt: null, stepIndex: step, proposedStep: step, plannedRounds: L.rounds, roundMin: L.min, hotter, tempC: num(a.tempC) ?? plan.usualTempC ?? null,
      saunaName: plan.saunaName || '', status: 'active', checklist: { ...ticks }, energy, rounds: [], breaks: [], symptoms: [], after: null, weighIn: null, note: '' });
    ctx.action({ kind: 'open', url: `#/sauna/run/${id}`, label: 'Open the sauna screen' });
    return wrote(`Sauna started on his phone: ${stepText(step)}. He taps Going in on the run screen; the alarm, breaks and symptom questions run there. ANY symptom: sauna_session symptoms at once.`, 'sauna started');
  }
  return refuse('action is log or checklist.');
}

// ---- save_photo: a photo he sent in Talk as a progress, recovery or scan photo ----------------------------------

function savePhoto(a, ctx) {
  const s = snap(ctx);
  const p = a.photo ? s.one('coach-photos', a.photo) : null;
  if (!p?.dataUrl) return refuse(`No photo ${a.photo || ''} from Talk. Use the id his message gives.`);
  const date = a.date || s.date(p.sentAt ?? p.at ?? s.now);
  if (date > s.today) return refuse('Not a future date.');
  if (a.kind === 'scan') {
    const sid = scanId(date);
    if (s.list('scan-photos').some((x) => x.from === p.id)) return refuse('That photo is already with the scan.');
    const pid = `photo-${s.now.toString(36)}-${p.id.slice(-5)}`;
    const writes = [];
    if (!s.one('body-scans', sid)) writes.push({ col: 'body-scans', id: sid, data: { id: sid, date, status: 'prep', createdAt: s.now, tz: s.tz } });
    writes.push({ col: 'scan-photos', id: pid, data: { id: pid, scanId: sid, date, dataUrl: p.dataUrl, at: s.now, from: p.id } });
    s.store.writeLocalMany(writes);
    return wrote(`Saved as a photo of the body scan of ${dayText(date, s.today)}. The Mac reads its numbers within a few minutes; he checks and saves them on the Scan results screen (or read them yourself and save them with body_scan record_results).`, `scan photo ${date}`);
  }
  if (a.kind === 'progress' || a.kind === 'recovery') {
    const rec = s.one('recovery', 'main');
    const allowed = a.kind === 'recovery' ? rec?.photos?.poses || [] : ['front', 'side', 'back'];
    if (a.kind === 'recovery' && !allowed.length) return refuse('No recovery record with photos in the app.');
    const pose = a.pose || (allowed.length === 1 ? allowed[0] : null);
    const name = Object.fromEntries(POSES);
    if (!pose || !allowed.includes(pose)) return refuse(`Which pose? ${allowed.map((x) => `${x} (${name[x] || x})`).join(', ')}.`);
    const id = photoId(date, pose);
    if (s.one('body-photos', id) && !a.replace) return refuse(`${dayText(date, s.today)} already has a ${(name[pose] || pose).toLowerCase()} photo. Replace it only if he says so: replace: true.`);
    put(s, 'body-photos', id, { id, date, pose, dataUrl: p.dataUrl, at: s.now, source: 'talk', camera: null, from: p.id });
    return wrote(`Saved as his ${(name[pose] || pose).toLowerCase()} ${a.kind === 'recovery' ? 'recovery' : 'progress'} photo of ${dayText(date, s.today)}${a.kind === 'recovery' ? ' (Body > Recovery counts it)' : ''}. On Body > Progress photos, private.`, `${a.kind} photo ${pose} ${date}`);
  }
  return refuse('kind is progress, recovery or scan.');
}

// ---- reminders: all that's coming, repeating ones, moving one ---------------------------------------------------

const repeatText = (r) => (r.repeat === 'daily' ? 'every day' : r.repeat === 'weekdays' ? 'every weekday' : r.repeat === 'days' ? `every ${repeatDays(r).map((d) => WEEKDAY_NAMES[d][0].toUpperCase() + WEEKDAY_NAMES[d].slice(1)).join(', ')}` : '');

function reminders(a, ctx) {
  const s = snap(ctx);
  const rems = s.list('coach-reminders');
  if (a.action === 'list') {
    const sent = s.store.getMeta?.(SENT) || {};
    const ids = new Map(rems.map((r) => [`coach:${r.id}`, r]));
    const items = notifyPlan(s.store, s.now, s.tz).filter((i) => i.due && i.at >= s.now - 60000 && !sent[i.id]).sort((p, q) => p.at - q.at);
    const end = zonedTime(addDays(s.today, 2), '00:00', s.tz);
    const later = rems.filter((r) => !r.cancelledAt && !r.firedAt && !r.trigger && r.at >= end).sort((p, q) => p.at - q.at);
    const triggers = rems.filter((r) => !r.cancelledAt && !r.firedAt && r.trigger === 'session-start');
    const line = (at, title, body, r) => `- ${dayText(s.date(at), s.today)}, ${timeText(at, s.tz)}: ${r ? `his reminder "${r.text}"${r.repeat ? ` (${repeatText(r)} at ${formatHm(r.hm)})` : ''} [id ${r.id}]` : `${title}${body ? `: ${String(body).slice(0, 90)}` : ''}`}`;
    const out = [...items.slice(0, 40).map((i) => line(i.at, i.title, i.body, ids.get(i.id))), ...later.slice(0, 20).map((r) => line(r.at, null, null, r)),
      ...triggers.map((r) => `- when he starts his workout log, ${dayText(r.date, s.today)} or later: his reminder "${r.text}" [id ${r.id}]`)];
    return { text: out.length ? `Coming up (the app's reminders today and tomorrow, and his own; times as they will go out):\n${out.join('\n')}` : 'Nothing coming up today or tomorrow.', summary: `${out.length} reminders` };
  }
  if (a.action === 'repeat') {
    if (!a.text || !a.time) return refuse('A repeating reminder needs what to say and a time (HH:MM).');
    const days = (a.days || []).map((d) => WEEKDAY_NAMES.indexOf(String(d).toLowerCase())).filter((d) => d >= 0);
    const repeat = a.every === 'weekdays' ? 'weekdays' : a.every === 'days' || days.length ? 'days' : 'daily';
    if (repeat === 'days' && !days.length) return refuse('Which days? days: weekday names.');
    const id = newId('rem');
    const base = { id, series: id, hm: a.time, repeat, ...(repeat === 'days' ? { days } : {}), text: String(a.text).slice(0, 200), ...(a.meal ? { meal: a.meal } : {}), createdAt: s.now, by: 'coach' };
    const first = nextRepeatAt(base, s.now, s.tz);
    if (!first) return refuse('No day fits.');
    put(s, 'coach-reminders', id, { ...base, at: first.at, date: first.date });
    return wrote(`Repeating reminder set, ${repeatText(base)} at ${formatHm(a.time)}: "${base.text}". The first is ${dayText(first.date, s.today)}, ${timeText(first.at, s.tz)}. Each comes as a notification from Coach and shows in Talk; cancel it with set_reminder cancel [id ${id}], which ends the series.`, `${repeat} ${a.time}`);
  }
  if (a.action === 'move') {
    const r = rems.find((x) => x.id === a.id);
    if (!r) return refuse(`No reminder with id ${a.id}. reminders list gives the ids.`);
    if (r.cancelledAt) return refuse('That reminder is cancelled.');
    if (r.firedAt) return refuse('That reminder has already gone out. Set a new one.');
    if (r.trigger) {
      if (!a.date) return refuse('A workout-start reminder moves by date only.');
      put(s, 'coach-reminders', r.id, { ...r, date: a.date, movedAt: s.now });
      return wrote(`Moved: "${r.text}" now comes when he starts his workout log on ${dayText(a.date, s.today)} or later.`, 'reminder moved');
    }
    let at; let hm;
    if (a.inMinutes) { at = s.now + Math.round(a.inMinutes) * 60000; hm = hmOf(new Date(at), s.tz); }
    else {
      if (!a.time && !a.date) return refuse('To when? time (HH:MM), date, or inMinutes.');
      hm = a.time || r.hm || hmOf(new Date(r.at), s.tz);
      at = zonedTime(a.date || r.date || s.date(r.at), hm, s.tz);
    }
    if (at <= s.now) return refuse('That time has passed.');
    const series = r.repeat && !a.once;
    put(s, 'coach-reminders', r.id, { ...r, at, date: s.date(at), ...(series || !r.repeat ? { hm } : {}), movedAt: s.now });
    return wrote(`Moved: "${r.text}" now ${dayText(s.date(at), s.today)}, ${timeText(at, s.tz)}${r.repeat ? (series ? `, and ${repeatText(r)} at ${formatHm(hm)} from now on` : `; the next ones stay at ${formatHm(r.hm)}`) : ''} (was ${timeText(r.at, s.tz)}).`, 'reminder moved');
  }
  return refuse('action is list, repeat or move.');
}

// ---- stats: what Statistics and the Monthly report show ---------------------------------------------------------

function statsText(s, a) {
  const st = s.settings();
  const daily = dailyWeights(weightSeries(s.list('health'), s.list('measurements')));
  const sessions = withBodyweights(s.list('sessions'), daily);
  const rows = setRows({ sessions, sets: s.list('sets'), lib: s.lib(), countWarmups: st.warmup?.countInStats, tz: s.tz });
  const firstDay = st.firstDayOfWeek ?? 1;
  const hm = (ms) => hoursText(Math.round(ms / 60000));
  const vs = (now, before, what) => { const p = changePct(now, before); return p == null ? '' : ` (${p > 0 ? '+' : ''}${p}% vs ${what})`; };
  const tot = (t, p, what) => `${plural(t.sessions, 'session')}${vs(t.sessions, p.sessions, what)}, ${hm(t.durationMs)}${vs(t.durationMs, p.durationMs, what)}, volume ${t.volume.toLocaleString('en-US')} kg${vs(t.volume, p.volume, what)}, ${plural(t.sets, 'set')}${vs(t.sets, p.sets, what)}`;
  const sets = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const muscles = (list) => list.filter((m) => m.now || m.before).slice(0, 12).map((m) => `${muscleLabel(m.muscle)} ${sets(m.now)}${m.before !== m.now ? ` (was ${sets(m.before)})` : ''}`).join(', ');
  const foot = `Sets: primary muscle 1, each secondary 0.5; holds never count; warm-ups ${st.warmup?.countInStats ? 'count as sets' : 'don\'t count'}. Volume = total kg × reps (bodyweight included for pull-ups and dips). Hevy and Strong history included.`;
  if (a.action === 'month') {
    const month = /^\d{4}-\d{2}$/.test(a.month || '') ? a.month : s.today.slice(0, 7);
    const r = monthReport({ sessions, rows, month, tz: s.tz });
    const name = new Date(`${month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return [
      `Monthly report, ${name}: ${tot(r.totals, r.previous, 'the month before')}.`,
      r.sessions.length ? `Sessions: ${r.sessions.map((x) => `${dayText(x.date, s.today)} ${x.title}`).join('; ')}.` : 'No sessions this month.',
      r.topExercises.length ? `Most sets: ${r.topExercises.map((x) => `${x.name} ${x.sets}`).join(', ')}.` : '',
      r.muscles.length ? `Sets per muscle (the month before in brackets): ${muscles(r.muscles)}.` : '',
      r.bests.length ? `Bests (heaviest set above everything before): ${r.bests.map((b) => `${b.name} ${k(b.kg)} kg (was ${k(b.previous)} kg)`).join('; ')}.` : 'No new bests this month.',
      foot,
    ].filter(Boolean).join('\n');
  }
  const key = PERIODS[a.period] ? a.period : '4w';
  const r = periodRange(key, s.today);
  const what = `the ${PERIODS[key].label} before`;
  const weeks = weeklyVolume(rows, { weeks: 6, today: s.today, firstDay });
  const top = topExercises(rows, r.from, r.to, 6);
  return [
    `Statistics, last ${PERIODS[key].label} (${dayText(r.from, s.today)} to today): ${tot(totals(sessions, rows, r.from, r.to, s.tz), totals(sessions, rows, r.prevFrom, r.prevTo, s.tz), what)}.`,
    `Sets per muscle (${what} in brackets): ${muscles(distribution(rows, r)) || 'none'}.`,
    top.length ? `Most logged: ${top.map((x) => `${x.name} ${plural(x.sets, 'set')} in ${plural(x.sessions, 'session')}`).join('; ')}.` : '',
    `Volume by week (from ${firstDay === 1 ? 'Monday' : firstDay === 0 ? 'Sunday' : 'Saturday'}): ${weeks.map((w) => `${dayText(w.start, s.today)} ${w.volume.toLocaleString('en-US')} kg, ${w.sets} sets`).join('; ')}.`,
    foot,
  ].filter(Boolean).join('\n');
}

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const read = (name, title, description, inputSchema, fn) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true }, run: async (args, ctx) => {
  const text = fn(snap(ctx), args || {});
  return { text, summary: text.split('\n')[0].slice(0, 120) };
} });

const FIELD_NAMES = MEASURE_FIELDS.map((f) => f.label).join(', ');

export const BODY_TOOLS = [
  write('body_log', 'Body: log by hand', `${HIS_WORDS} measurements: body measurements as Body > Measurements saves them (one entry per day; values: field = ${FIELD_NAMES}; value in cm, kg or %, unit 'in' or 'lb' when he gave those). For his weigh-in use log_weight. steps: a day's step total he gives (a past day, or the phone was left behind); a later Apple Health file covering that whole day replaces it. walk: a walk he did (date, time for a past day, minutes, steps). Date default today, never the future.`,
    obj({ action: { type: 'string', enum: ['measurements', 'steps', 'walk'] }, date: ISO, values: { type: 'array', items: obj({ field: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string', enum: ['cm', 'in', 'kg', 'lb', '%'] } }, ['field', 'value']) }, note: { type: 'string' }, steps: { type: 'integer', minimum: 0, maximum: 100000 }, time: HM, minutes: { type: 'integer', minimum: 1, maximum: 600 } }, ['action']), bodyLog),
  write('body_delete', 'Body: delete', `Deletes only when he says to delete it (his words, explicitly), never on your own idea. weight: a wrong weigh-in (weight, body fat and lean mass of that day; other measurements stay). measurements: fields of that day's measurements (fields: names), or the whole entry without fields. sleep: the sleep entry of the night to that morning (the coach's or the one the app worked out, e.g. a nap taken as the night); to fix the times instead, log_sleep with his real times replaces it. scan: the day's body scan, its numbers and photos (as the Scan results Delete). What came from Apple Health can only be changed in the Health app.`,
    obj({ action: { type: 'string', enum: ['weight', 'measurements', 'sleep', 'scan'] }, date: ISO, fields: { type: 'array', items: { type: 'string' } } }, ['action', 'date']), bodyDelete),
  write('class_log', 'Classes and the kick test', `${HIS_WORDS} A boxing / kickboxing class he logged (activity_plan log_class logs a new one): edit (minutes, time = its start HH:MM, date_to = move it to another day, discipline, note) or delete (only on his explicit words). Find it by date (and discipline), or session = its id. kick_test: the weekly kick test as data, front_cm and side_cm as he read them off the wall (date default today).`,
    obj({ action: { type: 'string', enum: ['edit', 'delete', 'kick_test'] }, session: { type: 'string' }, date: ISO, date_to: ISO, time: HM, minutes: { type: 'integer', minimum: 5, maximum: 240 }, discipline: { type: 'string', enum: Object.keys(DISCIPLINE) }, note: { type: 'string' }, front_cm: { type: 'number', minimum: 10, maximum: 260 }, side_cm: { type: 'number', minimum: 10, maximum: 260 } }, ['action']), classLog),
  write('recovery_answers', 'Fix a recovery check-in', `${HIS_WORDS} A past weekly recovery check-in (recovery_log saves new ones): edit = change the answers he corrects (date = the check-in's day; answers: question and his answer, choice questions with one of their choices), the rest stay; delete = remove that check-in (only on his explicit words). His words only, no advice.`,
    obj({ action: { type: 'string', enum: ['edit', 'delete'] }, date: ISO, answers: { type: 'array', items: obj({ question: { type: 'string' }, answer: { type: 'string' } }, ['question', 'answer']) } }, ['action', 'date']), recoveryAnswers),
  write('sauna_log', 'Sauna: log and checklist', `${HIS_WORDS} The ladder and hard stops are fixed rules and decide here exactly as on the phone. log: a session he did without the app (date, time = start HH:MM, minutes = one number per round, symptoms = everything he felt during, in the breaks or after; [] only when he says nothing; hotter, tempC): saved like a real one and counted by the ladder's own code (his step then, clean only if every round of his step was done in full with no symptom; any symptom counts as a symptom session; more than his step counts as his step only). checklist: tick the before-session lines as he says each is done (items: fed, clear, energy, kit, company with answer yes / no / not-possible); never tick one he didn't confirm; energy comes from today's check-in when he did one. The app's gates say go or skip; with every line ticked and his word that he's going in, start: true starts the session on his phone at the ladder's step.`,
    obj({ action: { type: 'string', enum: ['log', 'checklist'] }, date: ISO, time: HM, minutes: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'number', minimum: 1, maximum: 90 } }, symptoms: { type: 'array', items: { type: 'string' } }, hotter: { type: 'boolean' }, tempC: { type: 'number', minimum: 40, maximum: 130 }, note: { type: 'string' }, again: { type: 'boolean' }, items: { type: 'array', items: obj({ item: { type: 'string', enum: CHECK_IDS }, answer: { type: 'string', enum: ['yes', 'no', 'not-possible'] } }, ['item']) }, start: { type: 'boolean' } }, ['action']), saunaLog),
  write('save_photo', 'Save a Talk photo', `${HIS_WORDS} Keeps a photo he sent in Talk (photo = its id, cphoto....): progress = a progress photo (pose front, side or back), recovery = a recovery record photo (a pose the recovery tool lists), scan = a photo of a body scan's results (the Mac reads its numbers). date default the day he sent it. replace: true only when he says to replace that day's photo of that pose.`,
    obj({ photo: { type: 'string' }, kind: { type: 'string', enum: ['progress', 'recovery', 'scan'] }, pose: { type: 'string', enum: POSES.map(([p]) => p) }, date: ISO, replace: { type: 'boolean' } }, ['photo', 'kind']), savePhoto),
  write('reminders', 'Reminders', `list: everything coming up, the app's own reminders today and tomorrow and his own (with ids), at the times they will go out. repeat (${HIS_WORDS}): a reminder that comes again, every: daily, weekdays (Monday to Friday) or days (days: weekday names), at time HH:MM, text in his words; meal as in set_reminder; cancel it with set_reminder cancel (ends the series). move (${HIS_WORDS}): one of his reminders (id) to another time (time, date, or inMinutes); a repeating one moves for good unless once: true (only that one).`,
    obj({ action: { type: 'string', enum: ['list', 'repeat', 'move'] }, text: { type: 'string' }, time: HM, every: { type: 'string', enum: ['daily', 'weekdays', 'days'] }, days: { type: 'array', items: { type: 'string', enum: WEEKDAY_NAMES } }, meal: { type: 'string', enum: ['wait', 'on-time'] }, id: { type: 'string' }, date: ISO, inMinutes: { type: 'integer', minimum: 1, maximum: 2880 }, once: { type: 'boolean' } }, ['action']), reminders),
  read('stats', 'Statistics', "What his Statistics screen and Monthly report show, from the app's own stats code (Training HQ plus Hevy and Strong history): period (4w, 3m, 12m; default 4w): sessions, time, volume and sets against the period before, sets per muscle, most-logged exercises, volume by week. month (YYYY-MM, default this month): the monthly report with its sessions, totals against the month before, top exercises, sets per muscle and bests. Volumes are total kg.",
    obj({ action: { type: 'string', enum: ['period', 'month'] }, period: { type: 'string', enum: Object.keys(PERIODS) }, month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } }), statsText),
];
