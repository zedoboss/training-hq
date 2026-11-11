// The bundled USDA food values (A5) on the Mac: the same file the phone uses, read once from the app folder.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexFoods, valuesFor, sameFood } from '../app/js/lib/foods.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'data', 'usda-foods.json');
let db = null;
/** The indexed database, or null if the file is missing (then meals keep the estimate as they did before). */
export function foodsDb(log = () => {}) {
  if (db) return db;
  try { db = indexFoods(JSON.parse(readFileSync(FILE, 'utf8'))); } catch (e) { log(`foods: ${e.message}`); return null; }
  return db;
}

export { myFoods } from '../app/js/lib/foods.js';

/**
 * Carbs and fat of meal items (Wed 11/11, his words: "When u respond back like this logging a meal i should also see
 * carbs fats and the total for the end too"). Items keep only kcal and protein, so these come from the same source as
 * their kcal: his pack's label for a 'label' item, else USDA for its fdcId and grams. Foods with no value (his own
 * typed numbers, a USDA food without one) are named in missing, never guessed. {carbs, fat, missing: [names]}
 */
export function itemMacros(items = [], { mine = [], db = foodsDb() } = {}) {
  const out = { carbs: 0, fat: 0, missing: [], counted: 0 };
  const r1 = (x) => Math.round(x * 10) / 10;
  for (const x of items || []) {
    const g = Number(x.grams) || 0;
    if (!g) continue;
    out.counted++;
    let v = null;
    const lab = x.source === 'label' ? mine.find((m) => m.label && (sameFood(m.name, x.name || '') || (x.fdcId && Number(m.fdcId) === Number(x.fdcId))))?.label : null;
    if (lab) {
      const f = g / (lab.perGrams || 100);
      // A label without carbs or fat (his collagen): 0 when its protein explains its kcal, else unknown.
      const rest = (Number(lab.kcal) || 0) - 4 * (Number(lab.protein) || 0);
      const zero = rest <= Math.max(2, 0.1 * (Number(lab.kcal) || 0));
      v = { carbs: lab.carbs != null ? lab.carbs * f : zero ? 0 : null, fat: lab.fat != null ? lab.fat * f : zero ? 0 : null };
    } else if (x.source !== 'typed' && x.fdcId && db?.byId.get(Number(x.fdcId))) {
      const all = valuesFor(db, db.byId.get(Number(x.fdcId)), g);
      v = { carbs: all.carbs, fat: all.fat };
    }
    if (!v || v.carbs == null || v.fat == null) { if (!out.missing.includes(x.name)) out.missing.push(x.name); }
    out.carbs += v?.carbs || 0; out.fat += v?.fat || 0;
  }
  return { carbs: r1(out.carbs), fat: r1(out.fat), missing: out.missing, none: out.counted > 0 && out.missing.length >= out.counted };
}

/** "120.5 g carbs, 80.2 g fat" (plus the foods without a value), for a meal's or a day's items. */
export function macrosText(items, opts) {
  const m = itemMacros(items, opts);
  if (m.none) return `carbs and fat unknown (no value for ${m.missing.join(', ')})`;
  return `${m.carbs} g carbs, ${m.fat} g fat${m.missing.length ? ` (no carbs/fat value for ${m.missing.join(', ')})` : ''}`;
}
