// Today's target for a programme exercise, and the 30% guard.
// Rules (brief): the table is the plan, the 30% cap always wins (decision 7). Decision 33 (Thu 10/22, his words after
// lower back pain at 61 kg on squat: "we should be pushing 2.5 kgs to 5 kgs more than the last workout... Same principle
// for every exercise. On machines it's probably going to be closer to 5"): target = last + one step, never above the
// table or the cap; the table is the goal, not the next number. A step: 2.5 kg on a bar (1.25 a side), 2.5 kg on
// dumbbells, 5 kg on machines and cables. Below the rep range last time: the same weight again.
// Ahead of the plan: hold at the last load (never go backwards). The guard checks load only, main lifts only,
// against the heaviest working set in the previous 7 days (decision 6); with nothing in the last 7 days it uses
// the last session (Training HQ decision, Sat 10/17). Loads are total kg including the bar.

export const CAP = 0.3;

/** Round down to a load that can actually be put on. Smith/bar: bar + 2 × multiples of the smallest plate. */
export function loadable(kg, { barKg = null, smallestPlate = 1.25, step = 0.5 } = {}) {
  if (kg == null || !Number.isFinite(kg)) return null;
  if (barKg != null) {
    if (kg <= barKg) return barKg;
    const perSide = Math.floor(((kg - barKg) / 2 + 1e-9) / smallestPlate) * smallestPlate;
    return Math.round((barKg + 2 * perSide) * 100) / 100;
  }
  return Math.round(Math.floor(kg / step + 1e-9) * step * 100) / 100;
}

/** One step up from the last load (decision 33): 2 × the smallest plate on a bar, 2.5 kg dumbbells, 5 kg machines. */
export function stepFor({ barKg = null, equipment = null, name = '', smallestPlate = 1.25 } = {}) {
  const eq = equipment || (/smith/i.test(name) ? 'smith' : /\((barbell|ez bar)/i.test(name) ? 'barbell' : /\(dumbbell/i.test(name) ? 'dumbbell' : /machine|cable|leg press/i.test(name) ? 'machine' : null);
  if (barKg != null || eq === 'smith' || eq === 'barbell') return 2 * smallestPlate;
  if (eq === 'machine' || eq === 'cable') return 5;
  return 2.5;
}

/**
 * Pain written down for a session (Thu 10/22: "Lower back pain during set and after too..."), in his words: English, or
 * Macedonian in Latin letters, with or without the č/š/ž marks (his words: "I write both in English and Macedonian,
 * Latin alphabet"): boli, bolat, bolka, bolno, zabole, povreda, istegnato, ukočeno, pecka... A clause that says it
 * didn't hurt ("no pain", "ne boli", "bez bolka", "doesn't hurt") doesn't count. The lines the app adds itself
 * ("Skipped last time...") never count.
 */
export const PAIN_RE = /\b(pain\w*|hurt\w*|ach(e|es|ed|ing)|aching|sore\w*|tweak\w*|strain\w*|pinch\w*|injur\w*|cramp\w*|bol(i|at|ka|ki|ki|no|na|elo|ela|esh?e|eše|ev|e)?|zabol\w*|povred\w*|isteg\w*|uko(c|č|ch)\w*|pe(c|č|ch)k\w*|gr(c|č|ch)\w*|otok\w*|ote(c|č|ch)en\w*)\b/i;
const NOT_RE = /\b(no|not|without|never|didn'?t|doesn'?t|don'?t|isn'?t|wasn'?t|ne|nema|nemase|nemaše|bez|nikako)\b/i;
export function painIn(note) {
  const lines = String(note || '').split(/\n| \| /).filter((l) => !/^Skipped last time/.test(l.trim()));
  const hits = lines.flatMap((l) => l.split(/[.,;!?]+/)).map((c) => c.trim()).filter((c) => {
    const m = PAIN_RE.exec(c);
    return m && !NOT_RE.test(c.slice(0, m.index));
  });
  return hits.length ? lines.join(' ').trim() : '';
}

/**
 * What last time says about today (Thu 10/22, his words: "check my previous work... if I had back pain for squats...
 * you did 61 for the first set, and before that it was 51, so you added 10 kg: go lower... since you did 51 before the
 * 61, add 2.5 and do 54... you skipped that exercise last time, so just go with the same weight you did before that").
 * entries: history.all(name), newest first. skipped: {reason} when the last workout of this kind skipped it.
 * Returns {pain: {note, kg, prevGood}|null, skipped, jump?, others?} for targetFor (jump, others: jumpOf).
 */
export function lastNotes(entries = [], { skipped = null } = {}) {
  const [last, ...older] = entries;
  const note = last ? painIn(last.note) : '';
  const prevGood = older.find((e) => e.heaviest?.kg != null && !painIn(e.note))?.heaviest || null;
  return { pain: note && last?.heaviest?.kg != null ? { note, kg: last.heaviest.kg, prevGood } : null, skipped: skipped || null, ...jumpOf(last, older) };
}

/**
 * lastNotes over the last rep sessions (Sat 10/24: a hold-only session in between doesn't count), except pain written on
 * that hold session: it still holds today's rep weight at the last one, no step.
 */
export function repNotes(history, name, opts = {}) {
  const lifted = history.lifted(name);
  const latest = history.last(name);
  const held = latest && lifted[0] && latest !== lifted[0] && painIn(latest.note) ? [{ ...latest, heaviest: lifted[0].heaviest }] : [];
  return lastNotes([...held, ...lifted], opts);
}

/** Days without it that count as a gap (Thu 11/5: Legs after 2 weeks off still went up). The usual rotation brings each
 *  day type back within 4 to 8 days. */
export const GAP_DAYS = 10;
const DAY_NAMES = { legs: 'Legs', pull: 'Pull', push: 'Push' };
/** {days, text} when the last time he lifted it was GAP_DAYS or more before today, else null. */
export function gapOf(last, today, dayType = null) {
  if (!last?.date || !today) return null;
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last.date}T12:00:00Z`)) / 864e5);
  if (!(days >= GAP_DAYS)) return null;
  const span = days >= 14 ? `${Math.floor(days / 7)} weeks` : `${days} days`;
  const what = dayType && DAY_NAMES[dayType] && (!last.dayType || last.dayType === dayType) ? `last ${DAY_NAMES[dayType]}` : 'you last did it';
  return { days, since: last.date, text: `${span} since ${what} (${dayOf(last.date)})` };
}

/** The highest load allowed by the cap, before rounding to a loadable weight. */
export const capOf = (lastKg) => Math.round(lastKg * (1 + CAP) * 100) / 100;

const workSets = (e) => (e?.sets || []).filter((x) => x.kg != null && !x.hold && x.type !== 'warmup' && x.type !== 'hold' && x.type !== 'dropset');
/**
 * A jump last time (Sat 10/24, his words: "I accidentally did 50 last workout. He didn't check what I was doing before
 * that... he should have recommended me to go back lower"): last session's top load more than 30% over the heaviest of
 * the 4 weeks before it (else the session right before) is not his new start. One step is never a jump (7.5 -> 10 kg
 * dumbbells is 33%): jumpFrom checks it with the exercise's step. Also kept for targetFor: the other sets last time.
 */
export function jumpOf(last, older = []) {
  const top = last?.heaviest;
  if (top?.kg == null) return {};
  const sets = workSets(last);
  const i = sets.findIndex((x) => x.kg === top.kg);
  const second = sets.filter((_, j) => j !== i).reduce(bestSet, null);
  const out = second ? { others: second } : {};
  const from = new Date(`${last.date}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 28);
  const since = from.toISOString().slice(0, 10);
  const prior = older.filter((e) => e.heaviest?.kg != null && e.date < last.date);
  const window = prior.filter((e) => e.date >= since);
  const pool = window.length ? window : prior.slice(0, 1);
  if (!pool.length) return out;
  const b = pool.reduce((a, e) => (e.heaviest.kg > a.heaviest.kg ? e : a));
  if (top.kg <= capOf(b.heaviest.kg) + 1e-9) return out;
  return { ...out, jump: { kg: top.kg, reps: top.reps ?? null, date: last.date, basis: { kg: b.heaviest.kg, reps: b.heaviest.reps ?? null, date: b.date }, sets: sets.map((x) => ({ kg: x.kg, reps: x.reps ?? null })) } };
}

const bestSet = (m, x) => (!m || x.kg > m.kg || (x.kg === m.kg && (x.reps ?? 0) > (m.reps ?? 0)) ? { kg: x.kg, reps: x.reps ?? null } : m);
/**
 * The jump with this exercise's step, or null when it was one step or less. limit: the cap over the earlier load (at
 * least one step); base: his heaviest set last time inside it (rear delt fly 50 × 6, 36 × 12 after 29 -> 36 × 12), else
 * the earlier load.
 */
export function jumpFrom(jump, step) {
  if (!jump) return null;
  const limit = Math.max(capOf(jump.basis.kg), Math.round((jump.basis.kg + step) * 100) / 100);
  if (jump.kg <= limit + 1e-9) return null;
  const inside = jump.sets.filter((x) => x.kg <= limit + 1e-9).reduce(bestSet, null);
  const base = inside || { kg: jump.basis.kg, reps: jump.basis.reps };
  return { ...jump, limit, base, baseText: inside ? `your other set, ${setOf(base)}` : `your ${setOf(base)} on ${dayOf(jump.basis.date)}`, over: Math.round(((jump.kg - jump.basis.kg) / jump.basis.kg) * 100) };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const setOf = (x) => `${x.kg} kg${x.reps != null ? ` × ${x.reps}` : ''}`;

/**
 * Week cell from the programme: weeks 1-4. Past week 4: week 4's reps and sets with the number he confirmed for
 * that week (progressKg, decision 8), or week 4's own number until he has confirmed one.
 */
export function weekCell(planExercise, week, progressKg = null) {
  if (!planExercise?.weeks) return null;
  const w = Math.min(Math.max(week || 1, 1), 4);
  const cell = planExercise.weeks[w - 1];
  if (week > 4 && progressKg != null && cell?.load && cell.load.kg != null) return { ...cell, load: { ...cell.load, kg: progressKg } };
  return cell;
}

/** Number of working sets for a cell: "1st session: 1 set, after: 2 sets" depends on whether it was done before. */
export function setCount(sets, doneBefore) {
  if (!sets) return 2;
  if (sets.firstSession != null) return doneBefore ? sets.after : sets.firstSession;
  if (sets.count != null) return sets.count;
  return sets.max ?? sets.min ?? 2;
}

/**
 * @param {object} o
 * @param {object} o.plan     programme exercise (weeks, capClass, override)
 * @param {number} o.week     week column
 * @param {{kg:number, reps:number, date:string}|null} o.last  heaviest working set of the last session
 * @param {number|null} o.barKg
 * @param {number} [o.smallestPlate]  smallest plate he has (Settings), for rounding bar loads
 * @param {number|null} [o.progressKg]  week 5+: the number he confirmed for this week (decision 8)
 * @returns {{kg:number|null, approx:boolean, added:boolean, bodyweight:boolean, reps:[number,number]|null,
 *   sets:number, why:string, table:number|null, capKg:number|null, gated:string|null, week:number}}
 */
export function targetFor({ plan, week, last = null, barKg = null, smallestPlate = 1.25, progressKg = null, equipment = null, name = '', notes = null, today = null, dayType = null, formOk = null }) {
  const doneBefore = !!last;
  const gatedNotStarted = plan.weeks && plan.weeks.some((w) => w.gate) && !doneBefore;
  const cell = weekCell(plan, gatedNotStarted ? 1 : week, progressKg);
  const rule = plan.override?.source || '';
  const out = {
    kg: null, approx: false, added: false, bodyweight: false, reps: cell?.reps ?? null, sets: setCount(cell?.sets, doneBefore),
    why: '', table: null, capKg: null, gated: cell?.gate ?? null, week: gatedNotStarted ? 1 : Math.min(Math.max(week || 1, 1), 4),
  };

  const step = stepFor({ barKg, equipment, name: name || plan.name || '', smallestPlate });
  const r2 = (x) => Math.round(x * 100) / 100;
  const stepText = barKg != null ? `+${step} kg (${step / 2} a side)` : `+${step} kg`;
  // Thu 11/5, his words: "I haven't worked out in two weeks... Why is it recommending me to do more?": the plus said
  // is the plus done (36 -> 40 is +4 kg, not +5).
  const plusText = (to, from) => { const d = r2(to - from); return barKg != null ? `+${d} kg (${r2(d / 2)} a side)` : `+${d} kg`; };
  // Thu 11/5: a gap (10+ days since he last lifted it) means no step: repeat the last load, and say why.
  const gap = gapOf(last, today, dayType);
  if (gap) out.gap = gap;
  // Thu 11/5: a lift gated on filmed form (RDL, hip thrust) only steps up while his latest form check says his form
  // was consistent on video (formOk: {date, ok}, his tap or his words); no check yet or "not yet": it repeats.
  const formHold = !!(last && plan.weeks?.some((w) => w.gate) && !formOk?.ok);
  if (formHold) out.formHold = true;
  // Sat 10/24: a jump last time isn't the new start (jumpOf); today builds on the earlier history, under its cap.
  const jump = last && !notes?.pain && !notes?.skipped ? jumpFrom(notes?.jump, step) : null;
  const lead = jump ? `Last time's ${setOf(jump)} was a jump: ${jump.over}% over your ${jump.basis.kg} kg on ${dayOf(jump.basis.date)}, past the 30% cap, so not your new start. ` : '';
  if (jump) { last = { ...jump.base, date: jump.date }; out.jumpLast = true; }
  const jumpCap = jump ? loadable(jump.limit, { barKg, smallestPlate }) ?? jump.limit : Infinity;
  const fromText = jump ? `From ${jump.baseText}` : 'Last time';
  // Below the bottom of the rep range last time: the same weight until he gets there.
  const short = last?.reps != null && Array.isArray(out.reps) && last.reps < out.reps[0];
  // Decision 3 (calf raises) and exercises without a table: one step up from the last load (decision 33).
  if (!cell || /decision 3/.test(rule) || cell.load == null) {
    if (last?.kg != null && gap && !short) {
      out.kg = jump ? Math.min(last.kg, jumpCap) : last.kg;
      out.why = lead + `${gap.text}: repeat ${out.kg} kg, no step up`;
      return out;
    }
    out.kg = last?.kg != null ? (short ? last.kg : Math.min(r2(last.kg + step), Math.max(jumpCap, last.kg))) : null;
    if (last?.kg != null && !short && out.kg < r2(last.kg + step)) out.capped = true;
    out.why = last?.kg != null ? lead + (short ? `Same as ${jump ? 'that set' : 'last time'} (${last.kg} kg × ${last.reps}): get to ${out.reps[0]} reps first` : out.kg < r2(last.kg + step) ? `${fromText}, ${plusText(out.kg, last.kg)} reaches the 30% cap: ${out.kg} kg (a full ${stepText} would pass it)` : `${fromText} ${jump ? '' : `${last.kg} kg`}`.trim() + `, ${stepText}`) : 'No plan number and no history yet';
    return out;
  }
  if (cell.load.type === 'bodyweight') { out.bodyweight = true; out.why = 'bodyweight'; return out; }
  if (cell.load.type === 'added') { out.added = true; out.kg = cell.load.kg; out.why = `${week > 4 && progressKg != null ? `Week ${week} step (confirmed)` : 'Plan'}: bodyweight + ${cell.load.kg} kg`; return out; }

  const table = cell.load.kg;
  const src = week > 4 && progressKg != null ? `week ${week} (confirmed)` : 'table';
  const plan_ = week > 4 && progressKg != null ? `Week ${week} step (confirmed)` : 'Plan';
  out.table = table;
  out.approx = !!cell.load.approx;
  if (!last) {
    out.kg = loadable(table, { barKg, smallestPlate }) ?? table;
    out.why = gatedNotStarted ? 'Week 1: not started yet, form focus' : `${plan_}: ${table} kg (no previous load)`;
    return out;
  }
  // Ahead of the table with only one set: the others fell below it, so that one set isn't where he is (Sat 10/24).
  const lone = !jump && last.kg >= table && notes?.others && notes.others.kg < table ? notes.others : null;
  if (last.kg >= table && !lone) {
    out.kg = jump ? Math.min(last.kg, jumpCap) : last.kg;
    out.why = jump ? `${lead}${jump.baseText[0].toUpperCase()}${jump.baseText.slice(1)}, is at the ${src} (${table} kg): ${out.kg} kg today` : `You're ahead of the ${src} (${table} kg): stay at your last ${last.kg} kg`;
    return out;
  }
  if (lone) {
    out.kg = gap || formHold ? lone.kg : Math.min(r2(lone.kg + step), table);
    if (lone.reps != null && Array.isArray(out.reps) && lone.reps < out.reps[0]) out.kg = lone.kg;
    out.why = `Only one set at ${last.kg} kg last time, the other was ${setOf(lone)}: ${out.kg === lone.kg ? (lone.reps != null && Array.isArray(out.reps) && lone.reps < out.reps[0] ? `same weight, get to ${out.reps[0]} reps first` : gap ? `${gap.text}, same weight` : 'same weight till your form is consistent on video') : `${stepText} from there`}, ${out.kg} kg. Goal: ${table} kg`;
    out.loneLast = true;
    return out;
  }
  if (plan.capClass === 'main') out.capKg = capOf(last.kg);
  let up = short ? last.kg : r2(last.kg + step);
  // Last time hurt: back to the last load that didn't plus a step if it was a jump that hurt, else no step at all.
  // Skipped last time: the weight from before, no step.
  const pain = notes?.pain; const skip = notes?.skipped;
  if (pain) {
    const good = pain.prevGood?.kg;
    up = good != null && pain.kg > good + step + 1e-9 ? Math.min(r2(good + step), pain.kg) : Math.min(pain.kg, good ?? pain.kg);
    out.kg = up;
    out.why = `Last time ${pain.kg} kg hurt ("${pain.note.slice(0, 70)}"). ${good != null && pain.kg > good + step + 1e-9 ? `That was ${r2(pain.kg - good)} kg over ${good} kg: ${good} + ${step} = ${up} kg` : `Stay at ${up} kg, no step`}. Only if it doesn't hurt today; if it does, skip it`;
    out.painLast = true;
    return out;
  }
  if (skip) {
    out.kg = last.kg;
    out.why = `Skipped last time${skip.reason ? ` (${skip.reason})` : ''}: same as before, ${last.kg} kg`;
    out.skippedLast = true;
    return out;
  }
  const ceiling = Math.min(table, out.capKg ?? Infinity, jump ? jump.limit : Infinity);
  // Thu 10/22, his words: "why is it telling me to do 40?": the table's number is the goal, not today's load.
  const goal = week > 4 && progressKg != null ? `Goal (week ${week}, confirmed): ${table} kg` : `Goal (The Comeback, week ${out.week}): ${table} kg`;
  // A gap, or a form gate not yet passed: the last load again, no step (never over the cap or the table).
  if ((gap || formHold) && !short) {
    out.kg = Math.min(last.kg, jump ? Math.max(jump.base.kg, loadable(jump.limit, { barKg, smallestPlate }) ?? jump.limit) : Infinity);
    const reason = gap ? gap.text : 'Next step only once your form is consistent on video (tell me or tap Form OK)';
    out.why = lead + `${reason}: repeat ${out.kg} kg, no step up. ${goal}`;
    return out;
  }
  // A step on top of what he lifted is loadable as it is (1.25 a side more); a ceiling is rounded down to his plates.
  out.kg = up <= ceiling ? up : loadable(ceiling, { barKg, smallestPlate }) ?? ceiling;
  if (jump && out.kg < last.kg && !short) out.kg = last.kg;
  const capFirst = Math.min(out.capKg ?? Infinity, jump ? jump.limit : Infinity);
  // Thu 11/5: the 30% CAP badge only when the cap (not the plan) is what held the number down.
  if (!short && up > ceiling && capFirst < table) out.capped = true;
  out.why = lead + (short ? `Same as ${jump ? 'that set' : 'last time'} (${last.kg} kg × ${last.reps}): get to ${out.reps[0]} reps first. ${goal}`
    : up <= ceiling ? `${fromText}${jump ? '' : ` ${last.kg} kg`}, ${stepText}. ${goal}`
      : out.kg <= last.kg ? `${fromText}${jump ? '' : ` ${last.kg} kg`}: the next step you can load is over the ${table <= capFirst ? `plan (${table} kg)` : `30% cap (${capFirst} kg)`}, so stay at ${out.kg} kg`
        : `${fromText}${jump ? '' : ` ${last.kg} kg`}, ${plusText(out.kg, last.kg)} reaches the ${table <= capFirst ? 'plan' : '30% cap'}: ${out.kg} kg${table <= capFirst ? '' : ` (a full ${stepText} would pass it)`}`);
  return out;
}

/**
 * The 30% guard for an entered load. Returns null when fine.
 * history: [{date:'YYYY-MM-DD', kg}] heaviest working set per past session of this lift, any order.
 */
export function guardCheck({ kg, capClass, history, today, barKg = null, smallestPlate = 1.25 }) {
  if (capClass !== 'main' || kg == null || !history?.length) return null;
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const weekAgo = new Date(`${today}T12:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const since = weekAgo.toISOString().slice(0, 10);
  // history never contains the session being logged, so an earlier session today counts too.
  const recent = sorted.filter((h) => h.date >= since && h.date <= today);
  const basis = recent.length
    ? { kg: Math.max(...recent.map((h) => h.kg)), date: recent.reduce((a, b) => (b.kg > a.kg ? b : a)).date, window: '7 days' }
    : { kg: sorted[0].kg, date: sorted[0].date, window: 'last session' };
  const capKg = capOf(basis.kg);
  if (kg <= capKg + 1e-9) return null;
  return {
    over: Math.round(((kg - basis.kg) / basis.kg) * 100),
    basis,
    capKg,
    suggest: loadable(capKg, { barKg, smallestPlate }),
  };
}

/**
 * How far back his programme lifts are, against their pre-layoff numbers (meta.preLayoffCeilings): the median of last
 * load since the comeback / pre-layoff kg, over the lifts he has done since the comeback (same day type first). Used
 * only to estimate a start for an exercise outside the programme he last did before the layoff. null when none.
 */
export function comebackRatio({ meta, history, dayType = null, since = null }) {
  const pairs = [];
  for (const c of meta?.preLayoffCeilings || []) {
    if (!(c.kg > 0)) continue;
    const e = (history.all ? history.all(c.name) : []).find((x) => x.heaviest?.kg != null && (!since || x.date >= since));
    if (e) pairs.push({ name: c.name, ratio: e.heaviest.kg / c.kg, dayType: e.dayType ?? null });
  }
  const same = dayType ? pairs.filter((p) => p.dayType === dayType) : [];
  const pool = same.length ? same : pairs;
  if (!pool.length) return null;
  const sorted = pool.map((p) => p.ratio).sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { value: mid, names: pool.map((p) => p.name) };
}

/**
 * Today's target for an exercise outside the programme (Thu 11/5, his words: Leg Press Horizontal had no target; build
 * one from his history the way it's done for programme lifts). entries: history.all(name), newest first.
 * - Done since the comeback: last load + one step (decision 33) when he reached the bottom of the reps last time,
 *   else the same; a gap of GAP_DAYS or more: the same, with why. The 30% cap is the outer limit.
 * - Only from before the layoff: an estimate, his last pre-layoff load × how far back his programme lifts are
 *   (comebackRatio), rounded down to a loadable weight, marked approx.
 * Returns {kg, reps, why, approx?, estimate?, gap?, capKg} or null when he never did it.
 */
export function freeTarget({ entries = [], today = null, dayType = null, comebackStart = null, ratio = null, reps = null, barKg = null, equipment = null, name = '', smallestPlate = 1.25 }) {
  const lifted = entries.filter((e) => e.heaviest?.kg != null);
  const now = lifted.filter((e) => !comebackStart || e.date >= comebackStart);
  const r2 = (x) => Math.round(x * 100) / 100;
  if (now.length) {
    const e = now[0];
    const last = { ...e.heaviest, date: e.date, dayType: e.dayType ?? null };
    const step = stepFor({ barKg, equipment, name, smallestPlate });
    const gap = gapOf(last, today, dayType);
    const short = last.reps != null && Array.isArray(reps) && last.reps < reps[0];
    const capKg = capOf(last.kg);
    const kg = gap || short ? last.kg : Math.min(r2(last.kg + step), capKg);
    const why = gap ? `${gap.text}: repeat ${kg} kg, no step up`
      : short ? `Same as last time (${setOf(last)}): get to ${reps[0]} reps first`
        : `Last time ${setOf(last)} (${dayOf(last.date)}), +${r2(kg - last.kg)} kg`;
    return { kg, reps, why, capKg, ...(gap ? { gap } : {}) };
  }
  const old = lifted[0];
  if (!old) return null;
  if (!ratio?.value) return { kg: null, reps, why: `Last done before the layoff: ${setOf(old.heaviest)} (${dayOf(old.date)}). No start to estimate from yet`, approx: true };
  const kg = loadable(old.heaviest.kg * ratio.value, { barKg, smallestPlate });
  return { kg, reps, approx: true, estimate: true, why: `Estimate: before the layoff ${setOf(old.heaviest)} (${dayOf(old.date)}); your programme lifts are back to about ${Math.round(ratio.value * 100)}% of their pre-layoff numbers, so ${kg} kg` };
}
