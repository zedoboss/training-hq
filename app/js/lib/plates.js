// Plate maths and warm-up sets. Loads are total kg including the bar.
import { loadable } from './targets.js';

export const DEFAULT_PLATES = [20, 15, 10, 5, 2.5, 1.25];
export const DEFAULT_WARMUP_STEPS = [{ pct: 50, reps: 8 }, { pct: 75, reps: 4 }];

/**
 * Plates for one side, largest first, from an inventory (each size available as often as needed).
 * Returns the plates and the per-side weight actually reached (may be under the request).
 */
export function platesFor(perSideKg, plates = DEFAULT_PLATES) {
  const sizes = [...plates].sort((a, b) => b - a);
  let left = Math.round(perSideKg * 100) / 100;
  const out = [];
  for (const p of sizes) {
    while (left + 1e-9 >= p) { out.push(p); left = Math.round((left - p) * 100) / 100; }
  }
  const reached = Math.round(out.reduce((a, b) => a + b, 0) * 100) / 100;
  return { plates: out, reached, exact: Math.abs(reached - perSideKg) < 1e-9 };
}

/** Closest total you can actually load at or under a requested total, with the plates for it. */
export function nearestLoad(totalKg, barKg, plates = DEFAULT_PLATES) {
  if (totalKg <= barKg) return { total: barKg, perSide: 0, plates: [] };
  const want = (totalKg - barKg) / 2;
  const { plates: ps, reached } = platesFor(want, plates);
  return { total: Math.round((barKg + reached * 2) * 100) / 100, perSide: reached, plates: ps };
}

/**
 * Warm-up sets before a working weight: each step is a % of the working load, rounded down to something
 * loadable (never below the bar), duplicates dropped.
 */
export function warmupSets(workingKg, { barKg = null, steps = DEFAULT_WARMUP_STEPS, smallestPlate = 1.25 } = {}) {
  if (!workingKg) return [];
  const out = [];
  for (const s of steps) {
    const kg = loadable((workingKg * s.pct) / 100, { barKg, smallestPlate, step: 0.5 });
    if (kg == null || kg >= workingKg) continue;
    if (out.some((o) => o.kg === kg)) continue;
    out.push({ type: 'warmup', kg, reps: s.reps });
  }
  return out;
}
