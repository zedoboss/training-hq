// The bundled USDA food values (A5) on the Mac: the same file the phone uses, read once from the app folder.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexFoods } from '../app/js/lib/foods.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'data', 'usda-foods.json');
let db = null;
/** The indexed database, or null if the file is missing (then meals keep the estimate as they did before). */
export function foodsDb(log = () => {}) {
  if (db) return db;
  try { db = indexFoods(JSON.parse(readFileSync(FILE, 'utf8'))); } catch (e) { log(`foods: ${e.message}`); return null; }
  return db;
}

/** His own foods with a USDA id (fuel plan), for matching first and naming items his way. */
export const myFoods = (plan) => (plan?.foods || []).filter((f) => f?.fdcId).map((f) => ({ fdcId: Number(f.fdcId), name: f.name }));
