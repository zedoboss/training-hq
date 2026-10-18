// Meal photos read on the Mac (6.2, brief sections 6 FUEL and 7): for every meal photo that has no estimate yet, ask
// Claude (vision) for the scale reading, the items, grams, kcal and protein, or, for the after photo, what was left.
// The answer is written to 'meal-estimates' (<meal id>.before / .after) and reaches the phone by sync. The Mac never
// writes the meal itself, so his own edits on the phone can't be overwritten. Photos that arrive while the Mac was
// unreachable are simply read on the next sync. One photo at a time; a failed read is tried again up to 3 times.
import { runOnce, imageBlock, parseJsonAnswer, MODELS } from './claude.mjs';
import { cleanItems } from '../app/js/lib/meals.js';

export const MAX_TRIES = 3;
const RETRY_MS = 5 * 60000;

export const SYSTEM_BEFORE = `You read meal photos for a personal food log. Look at the photo and estimate what is on the plate.
- If a kitchen scale is visible, read its display in grams (scaleGrams). Assume the scale was zeroed with the plate on it, so the reading is the food only, and make the items' grams add up to it. No scale visible: scaleGrams null.
- One item per food. grams, kcal and protein (grams of protein) for the amount in the photo, from typical nutrition values. Cooked weights for cooked food.
- unsure: true when you are guessing what the food is or how much there is.
- notes: one short sentence only if something matters (for example "Scale shows 412 g including a bowl?"), else "".
Reply with JSON only, no other text:
{"scaleGrams": number|null, "items": [{"name": string, "grams": number, "kcal": number, "protein": number, "unsure": boolean}], "notes": string}`;

export const SYSTEM_AFTER = `You read the AFTER photo of a meal for a personal food log: what is left on the plate after eating.
You get the list of items that were on the plate before, numbered from 0. For each item with something left, give its index and the grams left (never more than it had). Items fully eaten are left out. An empty plate: "leftovers": [].
- If a kitchen scale is visible, read its display in grams (scaleGrams), assumed zeroed with the plate on it; then the leftovers add up to it. Else null.
- notes: one short sentence only if something matters, else "".
Reply with JSON only, no other text:
{"scaleGrams": number|null, "leftovers": [{"index": number, "name": string, "grams": number}], "notes": string}`;

/** The text sent with a photo: his usual foods (from the private data) and any note he added. */
export function promptText({ kind, meal, plan, before = [] }) {
  const lines = [];
  if (plan?.foods?.length) lines.push(`Foods he often eats (use these names when they match): ${plan.foods.map((f) => f.name).join('; ')}.`);
  if (kind === 'after') lines.push(`On the plate before:\n${before.map((x, i) => `${i}. ${x.name}: ${x.grams} g`).join('\n')}`);
  lines.push(kind === 'after' ? 'This is the after photo.' : 'This is the before photo.');
  if (meal.hint) lines.push(`His note about this meal. It overrides the photo and the list of usual foods: name the items and amounts the way he says.\n${meal.hint}`);
  return lines.join('\n\n');
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/** Check and tidy the answer. Throws when it isn't usable. */
export function readAnswer(kind, text, before = []) {
  const j = parseJsonAnswer(text);
  const scaleG = num(j.scaleGrams);
  const notes = String(j.notes || '').slice(0, 300);
  if (kind === 'before') {
    if (!Array.isArray(j.items)) throw new Error('no items in the answer');
    return { scaleG: scaleG && scaleG > 0 ? scaleG : null, items: cleanItems(j.items), notes };
  }
  if (!Array.isArray(j.leftovers)) throw new Error('no leftovers in the answer');
  const leftovers = j.leftovers.map((x) => {
    const i = Number.isInteger(Number(x.index)) ? Number(x.index) : before.findIndex((b) => b.name.toLowerCase() === String(x.name || '').toLowerCase());
    if (i < 0 || i >= before.length) return null;
    return { index: i, name: before[i].name, grams: Math.max(0, Math.min(before[i].grams, num(x.grams) ?? 0)) };
  }).filter((x) => x && x.grams > 0);
  return { scaleG: scaleG && scaleG > 0 ? scaleG : null, leftovers, notes };
}

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openStore>} o.store
 * @param {typeof runOnce} [o.run]   Claude call (tests pass a fake)
 */
export function openMealVision({ store, run = runOnce, log = () => {}, now = () => Date.now() }) {
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  let busy = false; let again = false;

  /** Model for meal photos: Settings > Fuel (fast by default). */
  const modelFor = () => {
    const pick = one('settings', 'main')?.fuel?.visionModel;
    return MODELS[pick] || MODELS.fast;
  };

  /** The next photo to read: [{meal, kind, photo, before}] in time order. */
  function todo() {
    const out = [];
    const t = now();
    for (const { data: meal } of store.listRecords('meals')) {
      if (!meal) continue;
      for (const kind of ['before', 'after']) {
        const part = meal[kind];
        if (!part?.photoId || part.confirmedAt || part.none) continue;
        const est = one('meal-estimates', `${meal.id}.${kind}`);
        const fresh = est && est.photoId === part.photoId && (est.round ?? 0) >= (meal.round ?? 0);
        if (fresh && (est.status === 'done' || (est.tries || 0) >= MAX_TRIES || t - est.at < RETRY_MS)) continue;
        const photo = one('meal-photos', part.photoId);
        if (!photo?.dataUrl) continue; // not here yet: comes with a later sync
        let before = null;
        if (kind === 'after') {
          if (meal.before?.confirmedAt || !meal.before?.photoId) before = cleanItems(meal.before?.items);
          else {
            const eb = one('meal-estimates', `${meal.id}.before`);
            if (eb?.status !== 'done' || eb.photoId !== meal.before.photoId) continue; // the before photo first
            before = meal.before.edited ? cleanItems(meal.before.items) : cleanItems(eb.items);
          }
          if (!before.length) continue;
        }
        out.push({ meal, kind, photo, before, tries: fresh ? (est.tries || 0) : 0 });
      }
    }
    return out.sort((a, b) => a.photo.at - b.photo.at);
  }

  async function readOne({ meal, kind, photo, before, tries }) {
    const id = `${meal.id}.${kind}`;
    const { model, effort } = modelFor();
    const base = { id, mealId: meal.id, kind, photoId: photo.id, round: meal.round ?? 0, model };
    try {
      const plan = one('fuel', 'plan');
      const content = [imageBlock(photo.dataUrl), { type: 'text', text: promptText({ kind, meal, plan, before }) }];
      const res = await run({ system: kind === 'before' ? SYSTEM_BEFORE : SYSTEM_AFTER, content, model, effort });
      const ans = readAnswer(kind, res.text, before || []);
      store.writeLocal('meal-estimates', id, { ...base, status: 'done', at: now(), ms: res.ms, tries: tries + 1, ...ans });
      log(`meal ${id}: read in ${res.ms} ms (${kind === 'before' ? `${ans.items.length} items` : `${ans.leftovers.length} leftovers`})`);
      return true;
    } catch (e) {
      store.writeLocal('meal-estimates', id, { ...base, status: 'failed', at: now(), tries: tries + 1, error: e.message });
      log(`meal ${id}: not read (${e.message})`);
      return false;
    }
  }

  /** Read every photo waiting (one at a time). Calls while busy run once more afterwards. */
  async function kick() {
    if (busy) { again = true; return 0; }
    busy = true;
    let n = 0;
    try {
      do {
        again = false;
        for (let job = todo()[0]; job; job = todo()[0]) {
          await readOne(job);
          n++;
          if (n > 50) break;
        }
      } while (again);
    } finally { busy = false; }
    return n;
  }

  return { kick, todo, busy: () => busy };
}
