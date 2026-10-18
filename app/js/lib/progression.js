// Weeks 5 and later (brief decision 8) and the switch to the Normal programme (decision 9). Pure helpers.
// Week 5+: the app proposes the same kg step as week 3 to week 4, never more than 30% and never above the pre-layoff
// number; he confirms each week. Confirmed numbers live in the synced collection 'progression', id '<dayType>.<week>'.
// Until a week is confirmed, targets stay on the last confirmed numbers (week 4's table at first).
// The 30% cap against his last load still applies on top (decision 7, targets.js).
import { loadable, CAP } from './targets.js';

export const progressId = (dayType, week) => `${dayType}.${week}`;

const cellKg = (cell) => (cell?.load && (cell.load.type === 'total' || cell.load.type === 'added') ? cell.load.kg ?? null : null);
const isAdded = (pe) => pe.weeks?.[3]?.load?.type === 'added';
const round2 = (n) => Math.round(n * 100) / 100;

/** Pre-layoff number for a programme exercise (total kg, or added kg for weighted pull-ups); null when none. */
export function ceilingFor(meta, pe) {
  const c = (meta?.preLayoffCeilings || []).find((x) => x.name === pe.comebackName || x.name === pe.name);
  if (!c) return null;
  return isAdded(pe) ? c.addedKg ?? null : c.kg ?? null;
}

/** The newest confirmed number for an exercise at or before a week (≥ 5): {week, kg} or null (= week 4 table). */
export function confirmedKg(progress, dayType, week, name) {
  let best = null;
  for (const d of progress || []) {
    if (d?.dayType !== dayType || !d.confirmedAt || !(d.week <= week)) continue;
    const e = d.exercises?.find((x) => x.name === name);
    if (e?.kg != null && (!best || d.week > best.week)) best = { week: d.week, kg: e.kg };
  }
  return best;
}

export const isConfirmed = (progress, dayType, week) => (progress || []).some((d) => d?.dayType === dayType && d.week === week && d.confirmedAt);

/**
 * Proposal for week N (N ≥ 5) of a Getting Back Into routine.
 * @param {object} o
 * @param {object} o.planRoutine  programme routine doc (weeks 1-4 per exercise)
 * @param {number} o.week
 * @param {Array} [o.progress]    progression docs
 * @param {object} [o.meta]       programme meta (pre-layoff ceilings)
 * @param {(pe:object) => number|null} [o.barKgOf]  bar weight for rounding to loadable weights
 * @param {number} [o.smallestPlate]
 * @returns {{dayType:string, week:number, items:Array<{name:string, kg:number|null, fromKg?:number, stepKg?:number,
 *   ceilingKg?:number|null, added?:boolean, why:string, skip?:boolean}>}}
 */
export function proposeWeek({ planRoutine, week, progress = [], meta = null, barKgOf = () => null, smallestPlate = 1.25 }) {
  const items = [];
  for (const pe of planRoutine.exercises || []) {
    const base = { name: pe.name, comebackName: pe.comebackName ?? pe.name };
    if (pe.weeks?.some((w) => w.gate)) { items.push({ ...base, kg: null, skip: true, why: 'Progress is gated on filmed form, not on the calendar.' }); continue; }
    const k4 = cellKg(pe.weeks?.[3]);
    if (k4 == null) { items.push({ ...base, kg: null, skip: true, why: 'No table load: follows your last load.' }); continue; }
    const k3 = cellKg(pe.weeks?.[2]) ?? k4;
    const added = isAdded(pe);
    const prev = confirmedKg(progress, planRoutine.dayType, week - 1, pe.name)?.kg ?? k4;
    const step = round2(Math.max(0, k4 - k3));
    const ceiling = ceilingFor(meta, pe);
    let raw = prev + step;
    let why = `${prev} + ${step} (the week 3 to 4 step)`;
    const cap = round2(prev * (1 + CAP));
    if (raw > cap) { raw = cap; why = `${prev} + 30% cap`; }
    if (ceiling != null && raw >= ceiling) { raw = ceiling; why = prev >= ceiling ? `at your pre-layoff ${ceiling}` : `${prev} + ${round2(ceiling - prev)}, up to your pre-layoff ${ceiling}`; }
    let kg = added ? Math.floor(raw / smallestPlate + 1e-9) * smallestPlate : loadable(raw, { barKg: barKgOf(pe), smallestPlate });
    kg = round2(kg);
    if (kg < prev) { kg = prev; why = `${prev}: the next loadable step is over the cap`; }
    items.push({ ...base, added, fromKg: prev, stepKg: step, ceilingKg: ceiling, kg, why });
  }
  return { dayType: planRoutine.dayType, week, items };
}

/** The doc saved when he confirms a week (his edits in `kgByName` win over the proposal). */
export function confirmWeek(proposal, kgByName = {}, { now = Date.now(), today } = {}) {
  const exercises = proposal.items.filter((i) => !i.skip).map((i) => {
    const kg = kgByName[i.name] != null && Number.isFinite(Number(kgByName[i.name])) ? Number(kgByName[i.name]) : i.kg;
    return { name: i.name, kg, proposedKg: i.kg, fromKg: i.fromKg, edited: kg !== i.kg };
  });
  return { dayType: proposal.dayType, week: proposal.week, exercises, confirmedAt: now, confirmedOn: today ?? null, source: 'decision 8: proposed by the app, confirmed by Michael' };
}

/**
 * Ready to switch a day type to its Normal programme (decision 9): every main lift with a week 4 load (lifts gated
 * on form left out) reached its week 4 number in each of its last `need` sessions of this day type.
 * @param {object} o
 * @param {object} o.planRoutine  Getting Back Into routine doc
 * @param {{all:(name:string)=>Array}} o.history  buildHistory() result
 * @param {number} [o.need]  sessions in a row (2 by default; decision 9 says 2 to 3)
 * @param {string|null} [o.since]  comeback start (YYYY-MM-DD): sessions before the layoff don't count
 */
export function normalReady({ planRoutine, history, need = 2, since = null }) {
  const lifts = [];
  for (const pe of planRoutine.exercises || []) {
    if (pe.capClass !== 'main' || pe.weeks?.some((w) => w.gate)) continue;
    const k4 = cellKg(pe.weeks?.[3]);
    if (k4 == null) continue;
    const recent = history.all(pe.name).filter((e) => e.dayType === planRoutine.dayType && e.heaviest?.kg != null && (!since || e.date >= since)).slice(0, need);
    const ok = recent.length === need && recent.every((e) => e.heaviest.kg >= k4);
    lifts.push({ name: pe.name, week4Kg: k4, recent: recent.map((e) => ({ date: e.date, kg: e.heaviest.kg })), ok });
  }
  return { ready: lifts.length > 0 && lifts.every((l) => l.ok), lifts, need };
}

/** Which version a day type runs: 'comeback' (Getting Back Into) until he confirms the switch. */
export const modeOf = (modes, dayType) => modes?.[dayType]?.mode || 'comeback';
