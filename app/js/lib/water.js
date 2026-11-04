// Water (Thu 11/5, his list of missing features: "No water tracking"). What he drinks, logged by tap (+250 ml,
// +500 ml on Fuel) or by telling the coach. A daily amount shows only when he sets one himself (settings
// fuel.waterMl); the app never proposes one. Pure functions; the screens and the coach pass the records in.
//
// water  {id, date (his waking day), at, ml, by: 'tap'|'coach'}

export const QUICK_ML = [250, 500];
export const MAX_ML = 3000;

/** A water entry; null when the amount isn't a sensible single drink (1 to 3,000 ml). */
export function waterEntry({ id, ml, at = Date.now(), date, by = 'tap' }) {
  const v = Math.round(Number(ml));
  if (!(v >= 1 && v <= MAX_ML) || !date) return null;
  return { id, date, at, ml: v, by };
}

/** Entries of one day, oldest first. */
export const waterOn = (entries = [], date) => entries.filter((e) => e && e.date === date && Number(e.ml) > 0).sort((a, b) => a.at - b.at);

/** {ml, count, last} for a day. */
export function waterTotal(entries = [], date) {
  const day = waterOn(entries, date);
  return { ml: day.reduce((a, e) => a + Number(e.ml), 0), count: day.length, last: day.at(-1) || null };
}

/** His own daily amount from settings, or null (none set: no target shown, nothing asked). */
export const waterTarget = (settings) => {
  const v = Number(settings?.fuel?.waterMl);
  return v >= 250 && v <= 10000 ? Math.round(v) : null;
};

/** "1,250 ml"; "2.5 L" from 2,500 up. */
export const mlText = (ml) => (ml >= 2500 ? `${Math.round(ml / 100) / 10} L` : `${Math.round(ml).toLocaleString('en-US')} ml`);
