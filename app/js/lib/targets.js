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

/** The highest load allowed by the cap, before rounding to a loadable weight. */
export const capOf = (lastKg) => Math.round(lastKg * (1 + CAP) * 100) / 100;

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
export function targetFor({ plan, week, last = null, barKg = null, smallestPlate = 1.25, progressKg = null, equipment = null, name = '' }) {
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
  // Below the bottom of the rep range last time: the same weight until he gets there.
  const short = last?.reps != null && Array.isArray(out.reps) && last.reps < out.reps[0];
  // Decision 3 (calf raises) and exercises without a table: one step up from the last load (decision 33).
  if (!cell || /decision 3/.test(rule) || cell.load == null) {
    out.kg = last?.kg != null ? (short ? last.kg : r2(last.kg + step)) : null;
    out.why = last?.kg != null ? (short ? `Same as last time (${last.kg} kg × ${last.reps}): get to ${out.reps[0]} reps first` : `Last time ${last.kg} kg, ${stepText}`) : 'No plan number and no history yet';
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
  if (last.kg >= table) {
    out.kg = last.kg;
    out.why = `You're ahead of the ${src} (${table} kg): stay at your last ${last.kg} kg`;
    return out;
  }
  if (plan.capClass === 'main') out.capKg = capOf(last.kg);
  const up = short ? last.kg : r2(last.kg + step);
  const ceiling = Math.min(table, out.capKg ?? Infinity);
  // A step on top of what he lifted is loadable as it is (1.25 a side more); a ceiling is rounded down to his plates.
  out.kg = up <= ceiling ? up : loadable(ceiling, { barKg, smallestPlate }) ?? ceiling;
  // Thu 10/22, his words: "why is it telling me to do 40?": the table's number is the goal, not today's load.
  const goal = week > 4 && progressKg != null ? `Goal (week ${week}, confirmed): ${table} kg` : `Goal (The Comeback, week ${out.week}): ${table} kg`;
  out.why = short ? `Same as last time (${last.kg} kg × ${last.reps}): get to ${out.reps[0]} reps first. ${goal}`
    : up <= ceiling ? `Last time ${last.kg} kg, ${stepText}. ${goal}`
      : `Last time ${last.kg} kg, ${stepText} reaches the ${table <= (out.capKg ?? Infinity) ? 'plan' : '30% cap'}: ${out.kg} kg`;
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
