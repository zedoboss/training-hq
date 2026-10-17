// Loads are stored and shown as total kg including the bar. These helpers give the bar-plus-plates split.

/** Round to 2 decimals and drop trailing zeros: 26.85, 25, 2.5. */
export const kg = (n) => String(Math.round(n * 100) / 100);

/** Plates per side for a total load on a bar. Null if the total is lighter than the bar. */
export function platesPerSide(totalKg, barKg) {
  if (totalKg == null || barKg == null || totalKg < barKg) return null;
  return Math.round(((totalKg - barKg) / 2) * 100) / 100;
}

/** Total load from plates per side. */
export function totalFromPlates(perSideKg, barKg) {
  return Math.round((perSideKg * 2 + barKg) * 100) / 100;
}

/** Equipment bar weight for an exercise name, from the programme's equipment settings. */
export function barFor(name, equipment = {}) {
  if (/smith/i.test(name) && equipment.smith?.barKg) return equipment.smith.barKg;
  return null;
}
