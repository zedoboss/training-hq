// Body measurements and progress photos (step 7, P48 and P49). Pure helpers; the screens are views/body-measure.js
// and views/body-photos.js.
// Measurements: collection 'measurements', one record per date. Ones he enters are 'measure.<date>'; Hevy's import
// wrote 'measure.hevy.<date>' (3.10), and editing that date edits that record. Stored in kg, cm and %.
// Progress photos: collection 'body-photos', one per day per pose: 'bodyphoto.<date>.<pose>' {date, pose, dataUrl, at}.

export const WEIGHT_FIELDS = [
  { key: 'weightKg', label: 'Weight', kind: 'kg' },
  { key: 'leanMassKg', label: 'Lean mass', kind: 'kg' },
  { key: 'fatPercent', label: 'Body fat', kind: '%' },
];
// Hevy's 14 circumferences, in its order.
export const CIRCUMFERENCES = [
  ['neckCm', 'Neck'], ['shoulderCm', 'Shoulders'], ['chestCm', 'Chest'], ['leftBicepCm', 'Left biceps'], ['rightBicepCm', 'Right biceps'],
  ['leftForearmCm', 'Left forearm'], ['rightForearmCm', 'Right forearm'], ['abdomenCm', 'Abdomen'], ['waistCm', 'Waist'], ['hipsCm', 'Hips'],
  ['leftThighCm', 'Left thigh'], ['rightThighCm', 'Right thigh'], ['leftCalfCm', 'Left calf'], ['rightCalfCm', 'Right calf'],
].map(([key, label]) => ({ key, label, kind: 'cm' }));
export const MEASURE_FIELDS = [...WEIGHT_FIELDS, ...CIRCUMFERENCES];
export const fieldOf = (key) => MEASURE_FIELDS.find((f) => f.key === key) || null;

// A13: two more poses for a recovery record's photos (the other side, arms behind the head); shown when used.
export const POSES = [['front', 'Front'], ['side', 'Side'], ['side2', 'Other side'], ['back', 'Back'], ['arms-up', 'Arms behind head']];
export const BASE_POSES = ['front', 'side', 'back'];
/** The poses to offer: front, side and back, plus any pose a recovery record asks for or a photo already has. */
export const posesShown = (extra = [], photos = []) => POSES.filter(([p]) => BASE_POSES.includes(p) || extra.includes(p) || photos.some((x) => x?.pose === p));
const LB = 0.45359237;
const r2 = (n) => Math.round(n * 100) / 100;

/** A stored value shown in his units: kg -> lb, cm -> in when he chose them (Settings > Units). */
export function shown(kind, v, units = {}) {
  if (v == null) return null;
  if (kind === 'kg' && units.weight === 'lb') return Math.round((v / LB) * 10) / 10;
  if (kind === 'cm' && units.body === 'in') return Math.round((v / 2.54) * 10) / 10;
  return Math.round(v * 10) / 10;
}
/** A typed value back to kg / cm / %. Empty -> null; out of range -> NaN. */
export function stored(kind, text, units = {}) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  const v = kind === 'kg' && units.weight === 'lb' ? n * LB : kind === 'cm' && units.body === 'in' ? n * 2.54 : n;
  const [lo, hi] = kind === 'kg' ? [20, 400] : kind === '%' ? [1, 75] : [5, 300];
  return v >= lo && v <= hi ? r2(v) : NaN;
}
export const unitText = (kind, units = {}) => (kind === 'kg' ? units.weight || 'kg' : kind === 'cm' ? units.body || 'cm' : '%');

/** The record id for a date: the one already there (Hevy's or his), else a new 'measure.<date>'. */
export function measureIdFor(date, measurements = []) {
  return measurements.find((m) => m.date === date)?.id || `measure.${date}`;
}

/** Values that a record actually has (the fields with a number). */
export const filled = (m) => MEASURE_FIELDS.filter((f) => m && m[f.key] != null && Number.isFinite(Number(m[f.key])));

/** One field over time, oldest first: [{date, value}]. */
export function fieldSeries(measurements, key) {
  return measurements.filter((m) => m && m.date && m[key] != null).map((m) => ({ date: m.date, value: Number(m[key]), id: m.id, source: m.source || 'manual' }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** For each field with data: the latest value, its date, and the change since the entry before it. */
export function latestByField(measurements) {
  const out = [];
  for (const f of MEASURE_FIELDS) {
    const s = fieldSeries(measurements, f.key);
    if (!s.length) continue;
    const last = s.at(-1); const prev = s.at(-2) || null;
    out.push({ ...f, value: last.value, date: last.date, prev: prev ? prev.value : null, prevDate: prev?.date ?? null, count: s.length });
  }
  return out;
}

// ---- progress photos ----

export const photoId = (date, pose) => `bodyphoto.${date}.${pose}`;

/** The latest photo of a pose before a date (the faint overlay when taking the next one). */
export function lastPhoto(photos, pose, before = '9999-12-31') {
  return photos.filter((p) => p.pose === pose && p.date < before && p.dataUrl).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

/** Photos grouped by date, newest first: [{date, photos: {front, side, back}}]. */
export function photoDays(photos) {
  const m = new Map();
  for (const p of photos) {
    if (!p?.date) continue;
    if (!m.has(p.date)) m.set(p.date, { date: p.date, photos: {} });
    m.get(p.date).photos[p.pose || 'front'] = p;
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** One pose's photos, oldest first (the compare pickers; the default pair is the first and the latest). */
export const posePhotos = (photos, pose) => photos.filter((p) => p?.pose === pose && p.date && p.dataUrl).sort((a, b) => (a.date < b.date ? -1 : 1));

/** Width and height that fit a frame into `max` px on its longest side (never larger than it came). */
export function fitSize(w, h, max = 1280) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * s), Math.round(h * s)];
}
