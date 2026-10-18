// Today's target for a programme exercise, and the 30% guard.
// Rules (brief): the table is the plan, the 30% cap always wins (decision 7): target = min(table, last + 30%).
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
export function targetFor({ plan, week, last = null, barKg = null, smallestPlate = 1.25, progressKg = null }) {
  const doneBefore = !!last;
  const gatedNotStarted = plan.weeks && plan.weeks.some((w) => w.gate) && !doneBefore;
  const cell = weekCell(plan, gatedNotStarted ? 1 : week, progressKg);
  const rule = plan.override?.source || '';
  const out = {
    kg: null, approx: false, added: false, bodyweight: false, reps: cell?.reps ?? null, sets: setCount(cell?.sets, doneBefore),
    why: '', table: null, capKg: null, gated: cell?.gate ?? null, week: gatedNotStarted ? 1 : Math.min(Math.max(week || 1, 1), 4),
  };

  // Decision 3 (calf raises) and exercises without a table: the target is the last load.
  if (!cell || /decision 3/.test(rule) || cell.load == null) {
    out.kg = last?.kg ?? null;
    out.why = last ? `last load (${last.kg})` : 'no table target and no history yet';
    return out;
  }
  if (cell.load.type === 'bodyweight') { out.bodyweight = true; out.why = 'bodyweight'; return out; }
  if (cell.load.type === 'added') { out.added = true; out.kg = cell.load.kg; out.why = `${week > 4 && progressKg != null ? `week ${week} (confirmed)` : 'table'}: +${cell.load.kg} kg added`; return out; }

  const table = cell.load.kg;
  const src = week > 4 && progressKg != null ? `week ${week} (confirmed)` : 'table';
  out.table = table;
  out.approx = !!cell.load.approx;
  if (!last) {
    out.kg = loadable(table, { barKg, smallestPlate }) ?? table;
    out.why = gatedNotStarted ? 'week 1: not started yet, form focus' : `${src} (no previous load)`;
    return out;
  }
  if (last.kg >= table) {
    out.kg = last.kg;
    out.why = `ahead of the ${src} (${table}): hold at your last ${last.kg}`;
    return out;
  }
  if (plan.capClass === 'main') {
    out.capKg = capOf(last.kg);
    const capped = Math.min(table, out.capKg);
    out.kg = loadable(capped, { barKg, smallestPlate });
    out.why = out.capKg < table ? `${src} ${table}, capped: last ${last.kg} + 30%` : `${src} ${table} (within 30% of last ${last.kg})`;
    return out;
  }
  out.kg = loadable(table, { barKg, smallestPlate }) ?? table;
  out.why = `${src} ${table} (light work, no cap)`;
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
