// Builds app/data/usda-foods.json: per-100 g nutrient values from USDA FoodData Central (public domain), SR Legacy
// and Foundation Foods, for offline use on the phone and the Mac. Run again for a newer Foundation Foods release.
//   node scripts/build-usda.mjs [work folder]     (downloads the two CSV zips into it if they aren't there)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'app', 'data', 'usda-foods.json');
const BASE = 'https://fdc.nal.usda.gov/fdc-datasets/';
const DATASETS = [
  { key: 'S', name: 'SR Legacy', release: '2018-04', zip: 'FoodData_Central_sr_legacy_food_csv_2018-04.zip', type: 'sr_legacy_food' },
  { key: 'F', name: 'Foundation Foods', release: '2026-04-30', zip: 'FoodData_Central_foundation_food_csv_2026-04-30.zip', type: 'foundation_food' },
];

// What is kept per food, per 100 g. ids are FoodData Central nutrient ids, the first one present wins.
export const NUTRIENTS = [
  ['kcal', 'Energy', 'kcal', [1008, 2048, 2047]],
  ['protein', 'Protein', 'g', [1003]],
  ['fat', 'Fat', 'g', [1004, 1085]],
  ['carbs', 'Carbohydrate', 'g', [1005, 1050]],
  ['fiber', 'Fiber', 'g', [1079]],
  ['sugars', 'Sugars', 'g', [2000]],
  ['satFat', 'Saturated fat', 'g', [1258]],
  ['vitA', 'Vitamin A (RAE)', 'mcg', [1106]], // no 1106: computed from retinol and carotenoids (raeFrom)
  ['vitD', 'Vitamin D', 'mcg', [1114]],
  ['vitE', 'Vitamin E', 'mg', [1109]],
  ['vitK1', 'Vitamin K1 (phylloquinone)', 'mcg', [1185]],
  ['vitC', 'Vitamin C', 'mg', [1162]],
  ['thiamin', 'Thiamin (B1)', 'mg', [1165]],
  ['riboflavin', 'Riboflavin (B2)', 'mg', [1166]],
  ['niacin', 'Niacin (B3)', 'mg', [1167]],
  ['pantothenic', 'Pantothenic acid (B5)', 'mg', [1170]],
  ['vitB6', 'Vitamin B6', 'mg', [1175]],
  ['folate', 'Folate (DFE)', 'mcg', [1190, 1177]],
  ['vitB12', 'Vitamin B12', 'mcg', [1178]],
  ['choline', 'Choline', 'mg', [1180]],
  ['calcium', 'Calcium', 'mg', [1087]],
  ['iron', 'Iron', 'mg', [1089]],
  ['magnesium', 'Magnesium', 'mg', [1090]],
  ['phosphorus', 'Phosphorus', 'mg', [1091]],
  ['potassium', 'Potassium', 'mg', [1092]],
  ['sodium', 'Sodium', 'mg', [1093]],
  ['zinc', 'Zinc', 'mg', [1095]],
  ['copper', 'Copper', 'mg', [1098]],
  ['manganese', 'Manganese', 'mg', [1101]],
  ['selenium', 'Selenium', 'mcg', [1103]],
  ['iodine', 'Iodine', 'mcg', [1100]],
  ['epa', 'EPA (20:5 n-3)', 'g', [1278]],
  ['dha', 'DHA (22:6 n-3)', 'g', [1272]],
];

// Vitamin A when an entry has no RAE value (nutrient 1106): many Foundation Foods entries give only retinol and the
// carotenoids (his Greek yogurt 2259794: retinol 38.13 mcg). RAE by its definition (IOM 2001): retinol + beta-carotene
// / 12 + alpha-carotene / 24 + beta-cryptoxanthin / 24; beta-carotene from its cis + trans parts when only those are given.
const RAE_PARTS = { retinol: 1105, betaCarotene: 1107, alphaCarotene: 1108, cryptoxanthin: 1120, cisBeta: 1159, transBeta: 2028 };
export function raeFrom(v) {
  const g = (id) => v[String(id)];
  const beta = g(RAE_PARTS.betaCarotene) ?? (g(RAE_PARTS.cisBeta) != null || g(RAE_PARTS.transBeta) != null ? (g(RAE_PARTS.cisBeta) || 0) + (g(RAE_PARTS.transBeta) || 0) : null);
  const retinol = g(RAE_PARTS.retinol); const carotenoids = [beta, g(RAE_PARTS.alphaCarotene), g(RAE_PARTS.cryptoxanthin)];
  const fromCarotenoids = (carotenoids[0] || 0) / 12 + (carotenoids[1] || 0) / 24 + (carotenoids[2] || 0) / 24;
  const anyCarotenoid = carotenoids.some((x) => x != null);
  // Retinol and carotenoids both measured: the sum. Only retinol, above 0 (an animal food): retinol. Only carotenoids,
  // above 0 (a plant): their share. Anything else (retinol 0 with no carotenoid data, as for some vegetables, or
  // carotenoids 0 with retinol not measured, as for egg yolk) stays unknown rather than 0.
  if (retinol != null && anyCarotenoid) return retinol + fromCarotenoids;
  if (retinol != null) return retinol > 0 ? retinol : null;
  return fromCarotenoids > 0 ? fromCarotenoids : null;
}

/** Rows of a CSV file as objects (quoted fields, doubled quotes). */
function* csvRows(text) {
  let i = 0; let head = null;
  const n = text.length;
  while (i < n) {
    const row = [];
    for (;;) {
      let v = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q < 0) { v += text.slice(i); i = n; break; }
          v += text.slice(i, q); i = q + 1;
          if (text[i] === '"') { v += '"'; i++; } else break;
        }
      } else {
        let j = i;
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
        v = text.slice(i, j); i = j;
      }
      row.push(v);
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '\r') i++;
      if (text[i] === '\n') i++;
      break;
    }
    if (!head) { head = row; continue; }
    if (row.length === 1 && row[0] === '') continue;
    yield Object.fromEntries(head.map((h, k) => [h, row[k] ?? '']));
  }
}

const read = (dir, file) => readFileSync(join(dir, file), 'utf8');
const sig = (x) => (x == null ? null : Number(x.toPrecision(4)));

async function download(work, ds) {
  const zip = join(work, ds.zip);
  if (!existsSync(zip)) {
    console.log(`downloading ${ds.zip}`);
    const r = await fetch(BASE + ds.zip);
    if (!r.ok) throw new Error(`${ds.zip}: HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(zip));
  }
  const dir = join(work, ds.zip.replace(/\.zip$/, ''));
  if (!existsSync(dir)) execFileSync('unzip', ['-q', '-o', zip, '-d', work]);
  // The zip holds one folder named like the zip.
  return existsSync(join(dir, 'food.csv')) ? dir : join(work, readdirSync(work).find((d) => d.startsWith(ds.zip.replace(/\.zip$/, '').slice(0, 30)) && !d.endsWith('.zip')));
}

async function main() {
  const work = process.argv[2] || '/tmp/thq-usda';
  mkdirSync(work, { recursive: true });
  const categories = [];
  const catIndex = new Map();
  const foods = [];
  for (const ds of DATASETS) {
    const dir = await download(work, ds);
    const cats = new Map([...csvRows(read(dir, 'food_category.csv'))].map((r) => [r.id, r.description]));
    const keep = new Map();
    for (const r of csvRows(read(dir, 'food.csv'))) if (r.data_type === ds.type) keep.set(r.fdc_id, r);
    const values = new Map();
    const wanted = new Set([...NUTRIENTS.flatMap(([, , , ids]) => ids.map(String)), ...Object.values(RAE_PARTS).map(String)]);
    for (const r of csvRows(read(dir, 'food_nutrient.csv'))) {
      if (!keep.has(r.fdc_id) || !wanted.has(r.nutrient_id) || r.amount === '') continue;
      if (!values.has(r.fdc_id)) values.set(r.fdc_id, {});
      values.get(r.fdc_id)[r.nutrient_id] = Number(r.amount);
    }
    const units = new Map([...csvRows(read(dir, 'measure_unit.csv'))].map((r) => [r.id, r.name]));
    const portions = new Map();
    for (const r of csvRows(read(dir, 'food_portion.csv'))) {
      if (!keep.has(r.fdc_id) || !Number(r.gram_weight)) continue;
      const unit = units.get(r.measure_unit_id);
      const amount = r.amount === '' ? '' : String(Number(r.amount));
      const label = [amount, unit && unit !== 'undetermined' ? unit : '', r.modifier || r.portion_description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (!label) continue;
      if (!portions.has(r.fdc_id)) portions.set(r.fdc_id, []);
      const list = portions.get(r.fdc_id);
      if (list.length < 8 && !list.some(([, l]) => l === label)) list.push([sig(Number(r.gram_weight)), label]);
    }
    for (const [id, f] of keep) {
      const v = values.get(id) || {};
      const row = NUTRIENTS.map(([key, , , ids]) => sig(ids.map((x) => v[String(x)]).find((x) => x != null) ?? (key === 'vitA' ? raeFrom(v) : null)));
      if (row[0] == null && row[1] == null) continue; // nothing usable
      const cat = cats.get(f.food_category_id) || 'Other';
      if (!catIndex.has(cat)) { catIndex.set(cat, categories.length); categories.push(cat); }
      foods.push([Number(id), f.description, ds.key, catIndex.get(cat), row, portions.get(id) || []]);
    }
    console.log(`${ds.name}: ${keep.size} foods`);
  }
  foods.sort((a, b) => a[0] - b[0]);
  const out = {
    source: {
      name: 'USDA FoodData Central', url: 'https://fdc.nal.usda.gov/', license: 'Public domain (CC0 1.0)',
      datasets: DATASETS.map(({ key, name, release }) => ({ key, name, release })), builtAt: new Date().toISOString().slice(0, 10),
      basis: 'per 100 g of the food as described (raw unless the description says cooked)',
    },
    nutrients: NUTRIENTS.map(([key, name, unit, ids]) => ({ key, name, unit, ids })),
    categories,
    foods,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}: ${foods.length} foods, ${(readFileSync(OUT).length / 1e6).toFixed(2)} MB`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
