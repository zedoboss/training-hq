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

/** Smith bar weight for an exercise name: the Smith bar on the Settings screen, else the programme's equipment. */
export function barFor(name, equipment = {}, bars = []) {
  if (!/smith/i.test(name)) return null;
  return (bars || []).find((b) => b.equipment === 'smith' && b.kg > 0)?.kg ?? equipment?.smith?.barKg ?? null;
}
