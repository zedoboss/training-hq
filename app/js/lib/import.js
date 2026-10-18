// Importing workout history from other apps' CSV exports (Hevy and Strong), steps 3.1-3.5.
// Pure functions: the Mac server runs them for the preview and the import; tests run them in Node.
// Rules for the owner's own notes (which sets were holds, which blocks weren't done) are data, passed in from the
// settings doc 'import-rules'; only a generic "a note that says hold" rule is built in.
import { slug } from '../data/exercise-library.js';

// ---------- CSV ----------

/** Parse CSV text (quoted fields, separators and line breaks inside quotes). The separator is taken from the header line. */
export function parseCsv(text, sep = null) {
  const src = String(text).replace(/^﻿/, '');
  if (!sep) {
    const first = src.slice(0, src.indexOf('\n') + 1 || undefined);
    sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  }
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [header = [], ...body] = rows;
  const bad = body.filter((r) => r.length !== header.length && !(r.length === 1 && r[0] === ''));
  return {
    header,
    rows: body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))),
    badRows: bad.length,
  };
}

/** Which app wrote this file, from its columns. */
export function detectSource(header) {
  const h = new Set(header);
  if (h.has('exercise_title') && h.has('start_time') && h.has('set_index')) return 'hevy';
  if (h.has('Exercise Name') && h.has('Set Order') && h.has('Workout Name')) return 'strong';
  if (header.some((c) => /^date$/i.test(String(c).trim())) && header.filter((c) => measureColumn(c)).length >= 2) return 'hevy-measurements';
  return null;
}

// ---------- Hevy body measurements (3.10) ----------
// Hevy exports body measurements as their own CSV. No real one has been checked yet, so the column names come from
// Hevy's public API (date, weight_kg, lean_mass_kg, fat_percent, neck_cm ... right_calf) and are matched loosely:
// any case, spaces or dashes, with or without a unit (_cm, _in, _kg, _lb/_lbs, (cm), %). Inches and pounds become
// cm and kg. The preview lists the columns that were read and the ones that were not.
const MEASURE = {
  weight: 'weightKg', body_weight: 'weightKg', bodyweight: 'weightKg', lean_mass: 'leanMassKg', fat_percent: 'fatPercent',
  body_fat: 'fatPercent', fat: 'fatPercent', neck: 'neckCm', shoulder: 'shoulderCm', shoulders: 'shoulderCm', chest: 'chestCm',
  left_bicep: 'leftBicepCm', right_bicep: 'rightBicepCm', left_forearm: 'leftForearmCm', right_forearm: 'rightForearmCm',
  abdomen: 'abdomenCm', waist: 'waistCm', hips: 'hipsCm', left_thigh: 'leftThighCm', right_thigh: 'rightThighCm',
  left_calf: 'leftCalfCm', right_calf: 'rightCalfCm',
};
/** {field, unit} for a measurement column, or null. unit: 'kg' | 'lb' | 'cm' | 'in' | '%'. */
export function measureColumn(col) {
  let k = String(col || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[()]/g, '').replace(/_+$/, '');
  let unit = null;
  const u = k.match(/_(kg|lbs?|cm|in|percent|pct)$/);
  if (u && !(k === 'fat_percent')) { unit = u[1].startsWith('lb') ? 'lb' : u[1] === 'percent' || u[1] === 'pct' ? '%' : u[1]; k = k.slice(0, -u[0].length); }
  if (k.endsWith('%')) { unit = '%'; k = k.replace(/_?%$/, ''); }
  const field = MEASURE[k];
  if (!field) return null;
  if (!unit) unit = field === 'fatPercent' ? '%' : field.endsWith('Kg') ? 'kg' : 'cm';
  return { field, unit };
}
const fromUnit = (n, unit) => (n == null ? null : unit === 'lb' ? round2(n * LB) : unit === 'in' ? round2(n * 2.54) : n);

/** A calendar date "YYYY-MM-DD" from "2026-10-10", "10 Oct 2026", "10 Oct 2026, 04:53" or "Oct 10, 2026". */
export function measureDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = t.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  return null;
}

/** Rows of a measurements export: {rows: [{date, values}], read: [column], ignored: [column], badRows}. */
export function readMeasurements({ header, rows, badRows = 0 }) {
  const di = header.findIndex((c) => /^date$/i.test(String(c).trim()));
  const cols = header.map((c, i) => (i === di ? null : measureColumn(c)));
  const out = [];
  let bad = badRows;
  for (const r of rows) {
    const date = measureDate(r[header[di]]);
    if (!date) { bad++; continue; }
    const values = {};
    cols.forEach((c, i) => { if (c) { const v = fromUnit(num(r[header[i]]), c.unit); if (v != null && v > 0) values[c.field] = v; } });
    out.push({ date, values });
  }
  return {
    rows: out,
    read: header.filter((c, i) => cols[i]),
    ignored: header.filter((c, i) => i !== di && !cols[i]),
    badRows: bad,
  };
}

/**
 * Measurement records to add, one per date: id measure.hevy.<date>. Skipped: rows with no numbers, dates already
 * imported from Hevy, and dates that already have a measurement from somewhere else.
 * existing: [{id, date, source, deleted}]
 */
export function planMeasurements({ rows, existing = [], importId }) {
  const live = existing.filter((m) => !m.deleted);
  const byDate = new Map(live.map((m) => [m.date, m]));
  const records = []; const skipped = []; const seen = new Set();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const id = `measure.hevy.${r.date}`;
    const keys = Object.keys(r.values);
    if (!keys.length) { skipped.push({ date: r.date, reason: 'no numbers in the row' }); continue; }
    if (seen.has(r.date)) { skipped.push({ date: r.date, reason: 'the same date twice in the file' }); continue; }
    const have = byDate.get(r.date);
    if (have) { skipped.push({ date: r.date, reason: have.id === id ? 'already imported' : 'a measurement is already here for that date' }); continue; }
    seen.add(r.date);
    records.push({ id, date: r.date, source: 'hevy', importId, ...r.values });
  }
  return { records, skipped };
}

// ---------- dates and units ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/**
 * A local date-time from an export as "YYYY-MM-DDTHH:MM:SS" (no zone). Accepts Hevy's "10 Oct 2026, 04:53",
 * "Oct 10, 2026, 4:53 AM" and Strong's "2022-11-09 16:10:39". Null when it can't be read.
 */
export function wallTime(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad(m[4])}:${m[5]}:${m[6] || '00'}`;
  m = t.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) return build(m[3], MONTHS[m[2].toLowerCase()], m[1], m[4], m[5], m[6], m[7]);
  m = t.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) return build(m[3], MONTHS[m[1].toLowerCase()], m[2], m[4], m[5], m[6], m[7]);
  return null;
}
function build(y, mo, d, h, mi, s, ampm) {
  if (!mo) return null;
  let hh = Number(h);
  if (ampm) hh = (hh % 12) + (/pm/i.test(ampm) ? 12 : 0);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${mi}:${s || '00'}`;
}

function offsetMs(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** Milliseconds for a local wall time ("2026-10-10T04:53:00") in an IANA time zone. */
export function zonedToMs(wall, tz) {
  const [d, t] = wall.split('T');
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, day, h, mi, s || 0);
  let ms = asUtc - offsetMs(asUtc, tz);
  ms = asUtc - offsetMs(ms, tz);
  return ms;
}

const num = (v) => {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const LB = 0.45359237;
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const kgFrom = (v, unit) => { const n = num(v); return n == null ? null : unit === 'lb' ? round2(n * LB) : n; };
const metresFrom = (v, unit) => {
  const n = num(v);
  if (n == null) return null;
  return round2(n * ({ km: 1000, mi: 1609.344, ft: 0.3048, m: 1 }[unit] ?? 1));
};

/** Strong's workout length: seconds ("2723") or text ("1h 5m", "45m", "30s"). */
export function durationSeconds(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  let total = 0; let hit = false;
  for (const [, n, u] of s.matchAll(/(\d+)\s*([hms])/gi)) { hit = true; total += Number(n) * { h: 3600, m: 60, s: 1 }[u.toLowerCase()]; }
  return hit ? total : null;
}

// ---------- reading each app's rows into workouts ----------
// Workout: {key, title, start, end, note, blocks:[{name, note, supersetKey, sets:[{index, type, kg, reps, durationS, distanceM, rpe}]}]}
// start/end are local wall times. The same exercise can appear twice in a workout as separate blocks.

const cleanNote = (s) => (s ? String(s).replace(/\\n/g, '\n').trim() : '');
const SET_TYPE = { normal: 'normal', warmup: 'warmup', 'warm-up': 'warmup', failure: 'failure', dropset: 'dropset', drop: 'dropset' };

export function readHevy({ header, rows }) {
  const unitW = header.includes('weight_lbs') ? 'lb' : 'kg';
  const unitD = header.includes('distance_miles') ? 'mi' : 'km';
  const workouts = new Map();
  for (const r of rows) {
    const start = wallTime(r.start_time);
    if (!start) continue;
    const key = `${r.title}|${start}`;
    if (!workouts.has(key)) {
      workouts.set(key, { key, title: r.title || 'Workout', start, end: wallTime(r.end_time), note: cleanNote(r.description), blocks: [] });
    }
    const w = workouts.get(key);
    const index = Number(r.set_index);
    const last = w.blocks[w.blocks.length - 1];
    if (!last || last.name !== r.exercise_title || index === 0) {
      w.blocks.push({ name: r.exercise_title, note: cleanNote(r.exercise_notes), supersetKey: r.superset_id !== '' && r.superset_id != null ? String(r.superset_id) : null, sets: [] });
    }
    w.blocks[w.blocks.length - 1].sets.push({
      index,
      type: SET_TYPE[String(r.set_type).toLowerCase()] || 'normal',
      kg: kgFrom(unitW === 'lb' ? r.weight_lbs : r.weight_kg, unitW),
      reps: num(r.reps),
      durationS: num(r.duration_seconds),
      distanceM: metresFrom(unitD === 'mi' ? r.distance_miles : r.distance_km, unitD),
      rpe: num(r.rpe),
    });
  }
  return [...workouts.values()];
}

/** Strong: "Set Order" is 1, 2, 3… or W (warm-up), F (failure), D (drop set); a "Note" row holds the exercise note. */
export function readStrong({ header, rows }) {
  const wCol = header.find((h) => /^Weight( \((kg|lbs?)\))?$/i.test(h));
  const unitW = /lb/i.test(wCol || '') ? 'lb' : 'kg';
  const wUnitCol = header.includes('Weight Unit') ? 'Weight Unit' : null;
  const dCol = header.find((h) => /^Distance( \(.+\))?$/i.test(h));
  const dUnit = (h) => { const u = (/\((.+)\)/.exec(h || '') || [])[1]?.toLowerCase() || 'm'; return u.startsWith('met') ? 'm' : u.startsWith('mi') ? 'mi' : u.startsWith('f') ? 'ft' : u.startsWith('k') ? 'km' : 'm'; };
  const unitD = dUnit(dCol);
  const durCol = header.find((h) => /^Duration/i.test(h));
  const workouts = new Map();
  for (const r of rows) {
    const start = wallTime(r.Date);
    if (!start) continue;
    const key = `${r['Workout Name']}|${start}`;
    if (!workouts.has(key)) {
      const dur = durationSeconds(r[durCol]);
      workouts.set(key, { key, title: r['Workout Name'] || 'Workout', start, durationS: dur, end: null, note: cleanNote(r['Workout Notes']), blocks: [], _last: null });
    }
    const w = workouts.get(key);
    const order = String(r['Set Order'] ?? '').trim();
    const name = r['Exercise Name'];
    const last = w.blocks[w.blocks.length - 1];
    if (order.toLowerCase() === 'note') {
      if (last && last.name === name && !last.sets.length) last.note = cleanNote(r.Notes);
      else w.blocks.push({ name, note: cleanNote(r.Notes), supersetKey: null, sets: [] });
      continue;
    }
    const n = /^\d+$/.test(order) ? Number(order) : null;
    const prevN = last?.sets.length ? last.sets[last.sets.length - 1].n : null;
    // A new block when the exercise changes, or numbering starts again after the same exercise.
    if (!last || last.name !== name || (n != null && prevN != null && n <= prevN)) {
      w.blocks.push({ name, note: '', supersetKey: null, sets: [] });
    }
    const type = n != null ? 'normal' : ({ w: 'warmup', f: 'failure', d: 'dropset' }[order.toLowerCase()] || 'normal');
    const unit = wUnitCol ? (/lb/i.test(r[wUnitCol]) ? 'lb' : 'kg') : unitW;
    const kgRaw = kgFrom(r[wCol], unit);
    const secs = num(r.Seconds);
    const dist = metresFrom(r[dCol], unitD);
    w.blocks[w.blocks.length - 1].sets.push({
      index: w.blocks[w.blocks.length - 1].sets.length, n, type,
      kg: kgRaw, reps: num(r.Reps), durationS: secs || null, distanceM: dist || null, rpe: num(r.RPE),
    });
  }
  for (const w of workouts.values()) {
    delete w._last;
    if (w.durationS) {
      const ms = Date.UTC(...w.start.split(/[-T:]/).map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) + w.durationS * 1000;
      w.end = new Date(ms).toISOString().slice(0, 19);
    }
    // Strong writes 0 for empty weights on bodyweight exercises; keep what was written, drop note-only blocks.
    w.blocks = w.blocks.filter((b) => b.sets.length);
    for (const b of w.blocks) for (const s of b.sets) delete s.n;
  }
  return [...workouts.values()];
}

// ---------- rules: holds logged as ordinary sets, blocks that weren't done ----------

// A note like "30s hold" or "30 sec holds" marks a block of hold sets. "hold 3s on the last rep" (a pause) does not.
export const DEFAULT_RULES = { holdNote: '\\b\\d+\\s*(s|sec|secs|seconds?)\\s+holds?\\b', notDoneNote: null, holdSets: [], notDone: [] };

const re = (s) => (s ? new RegExp(s, 'i') : null);

function holdSetMatches(rule, set, block) {
  if (rule.exercise !== block.name) return false;
  if (rule.kg != null && set.kg !== rule.kg) return false;
  if (rule.minKg != null && !(set.kg >= rule.minKg)) return false;
  if (rule.reps != null && set.reps !== rule.reps) return false;
  if (rule.afterHeavier && !block.sets.some((o) => o.kg > set.kg && o.index < set.index)) return false;
  return true;
}

/**
 * Apply the rules to one workout (a copy is returned). Hold sets become type 'hold': the load is kept, the logged reps
 * are kept as importedAs ("x 10"), and the time is left empty unless the file had one (it was never recorded).
 */
export function applyRules(w, rules = DEFAULT_RULES) {
  const holdNote = re(rules.holdNote);
  const notDoneNote = re(rules.notDoneNote);
  const date = w.start.slice(0, 10);
  let holds = 0; let dropped = 0; const droppedBlocks = [];
  const blocks = [];
  for (const b of w.blocks) {
    const isHoldBlock = !!(holdNote && holdNote.test(b.note || ''));
    const notDone = (notDoneNote && notDoneNote.test(b.note || ''))
      || (rules.notDone || []).some((n) => n.date === date && n.exercise === b.name && (!n.holdBlock || isHoldBlock));
    if (notDone) { dropped++; droppedBlocks.push({ name: b.name, sets: b.sets.length, note: b.note }); continue; }
    const sets = b.sets.map((s) => {
      const hold = isHoldBlock || (rules.holdSets || []).some((h) => holdSetMatches(h, s, b));
      if (!hold) return { ...s };
      holds++;
      return { ...s, type: 'hold', reps: null, importedAs: s.reps != null ? `x ${s.reps}` : null };
    });
    blocks.push({ ...b, sets, holdBlock: isHoldBlock });
  }
  return { workout: { ...w, blocks }, holds, dropped, droppedBlocks };
}

// ---------- day types ----------

/** Pull, push, legs or neck from a workout title; mixed or other titles (Upper, Push+Legs) get none. */
export function dayTypeOf(title) {
  const t = String(title || '').toLowerCase();
  const found = new Set();
  if (/\bpull/.test(t)) found.add('pull');
  if (/\bpush/.test(t)) found.add('push');
  if (/\blegs?\b/.test(t) || /\blower\b/.test(t)) found.add('legs');
  if (/\bneck\b/.test(t)) found.add('neck');
  return found.size === 1 ? [...found][0] : null;
}

// ---------- exercise matching ----------

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w && !['the', 'na', 'a', 'of'].includes(w)));
function similarity(a, b) {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w) || B.has(w.replace(/s$/, '')) || B.has(`${w}s`)) both++;
  return both / (A.size + B.size - both);
}

/**
 * Pair every exercise name in the file with the library.
 * remembered: {fileName: exerciseId} from earlier imports. Exact same name matches by itself; anything else
 * becomes a new exercise unless matched, with up to 3 suggestions.
 * @returns {Array<{name, id, matchName, how:'remembered'|'same name'|'new', suggestions:Array<{id,name,score}>}>}
 */
export function matchExercises(names, library, remembered = {}) {
  const byId = new Map(library.map((e) => [e.id, e]));
  const byNorm = new Map(library.map((e) => [norm(e.name), e]));
  return names.map((name) => {
    const suggestions = library.map((e) => ({ id: e.id, name: e.name, score: Math.round(similarity(name, e.name) * 100) / 100 }))
      .filter((x) => x.score >= 0.34 && norm(x.name) !== norm(name)).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3);
    const rem = remembered[name] && byId.get(remembered[name]);
    if (rem) return { name, id: rem.id, matchName: rem.name, how: 'remembered', suggestions };
    const same = byNorm.get(norm(name));
    if (same) return { name, id: same.id, matchName: same.name, how: 'same name', suggestions };
    return { name, id: null, matchName: null, how: 'new', suggestions };
  });
}

const REVIEW = { new: 0, chosen: 1, remembered: 2, 'same name': 3 };
/** Exercise matches in the order to look at them: new names first, then chosen, remembered, same name; most sets first. */
export const reviewOrder = (list) => [...list].sort((a, b) => (REVIEW[a.how] ?? 9) - (REVIEW[b.how] ?? 9) || b.sets - a.sets || a.name.localeCompare(b.name));

const MUSCLE_WORDS = [
  [/neck/, 'neck'], [/wrist|cupping|forearm|grip/, 'forearms'], [/calf|calves/, 'calves'], [/leg curl|hamstring|rdl|romanian/, 'hamstrings'],
  [/hip thrust|glute/, 'glutes'], [/abduct/, 'abductors'], [/adduct/, 'adductors'], [/squat|leg press|leg extension|lunge/, 'quadriceps'],
  [/crunch|leg raise|plank|\bab\b|abs\b|sit up/, 'abdominals'], [/back extension|hyperextension|good morning/, 'lower_back'],
  [/shrug/, 'traps'], [/pulldown|pull up|chin up|pullover/, 'lats'], [/row|rear delt|reverse fly|face pull/, 'upper_back'],
  [/triceps?|pushdown|skull|dip|kickback/, 'triceps'], [/curl/, 'biceps'], [/lateral raise|shoulder|overhead press|military|arnold|front raise|upright/, 'shoulders'],
  [/bench|chest|fly|push up|pec/, 'chest'], [/deadlift/, 'full_body'], [/run|walk|cycl|treadmill|rowing machine|bike/, 'cardio'],
];
const EQUIP_WORDS = [[/smith/, 'smith'], [/barbell|ez bar|\bez\b/, 'barbell'], [/dumbbell/, 'dumbbell'], [/cable|pushdown/, 'cable'], [/machine|plates/, 'machine'], [/band/, 'band'], [/kettlebell/, 'kettlebell']];

/** A new exercise for a name that matched nothing: type from the logged sets; muscle from words in the name, else a close library match. */
export function newExerciseFromImport(name, sets, { suggestion = null, library = [], source = null } = {}) {
  const n = norm(name);
  const any = (f) => sets.some(f);
  let type = 'weight_reps';
  if (any((s) => s.distanceM)) type = any((s) => s.kg) ? 'weight_distance' : 'distance_duration';
  else if (any((s) => s.durationS && s.type !== 'hold')) type = any((s) => s.kg) ? 'weight_duration' : 'duration';
  else if (/\bassisted\b/.test(n)) type = 'assisted_bodyweight';
  else if (/\bweighted\b/.test(n) && !/\bneck\b/.test(n)) type = 'weighted_bodyweight';
  else if (!any((s) => s.kg)) type = 'reps_only';
  const base = suggestion && suggestion.score >= 0.5 ? library.find((e) => e.id === suggestion.id) : null;
  // The name wins: "Shrugs Na Incline Bench Machine" is a shrug, though its closest library name is a bench press.
  const primary = MUSCLE_WORDS.find(([r]) => r.test(n))?.[1] ?? base?.primary ?? 'other';
  const equipment = EQUIP_WORDS.find(([r]) => r.test(n))?.[1] ?? base?.equipment ?? (type === 'reps_only' || type === 'weighted_bodyweight' ? 'bodyweight' : 'other');
  return { id: slug(name), name, type, primary, secondary: base?.secondary ? [...base.secondary] : [], equipment, source: 'import', importedFrom: source };
}

// ---------- planning an import ----------

/** Short stable hash (cyrb53) as hex, for ids that are the same every time the same file is imported. */
export function hashId(str) {
  let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export const sessionIdFor = (source, w) => `${source}.${hashId(`${w.title}|${w.start}`)}`;

const OVERLAP_MS = 30 * 60000;
function overlaps(a, b) {
  if (Math.abs(a.startedAt - b.startedAt) < OVERLAP_MS) return true;
  const aEnd = a.endedAt ?? a.startedAt; const bEnd = b.endedAt ?? b.startedAt;
  return a.startedAt < bEnd && b.startedAt < aEnd;
}

/** Read a file into workouts with the rules applied. */
export function readExport(text, { rules = DEFAULT_RULES } = {}) {
  const csv = parseCsv(text);
  const source = detectSource(csv.header);
  if (!source) throw new Error('This file is not a Hevy or Strong workout export (its columns don\'t match).');
  const raw = source === 'hevy' ? readHevy(csv) : readStrong(csv);
  let holds = 0; let dropped = 0; const notDone = [];
  const workouts = raw.map((w) => {
    const r = applyRules(w, { ...DEFAULT_RULES, ...rules });
    holds += r.holds; dropped += r.dropped;
    for (const b of r.droppedBlocks) notDone.push({ title: w.title, start: w.start, ...b });
    return r.workout;
  });
  return { source, header: csv.header, badRows: csv.badRows, workouts, holds, dropped, notDone };
}

/**
 * Turn workouts into Training HQ sessions and sets, skipping what is already there.
 * @param {object} o
 * @param {'hevy'|'strong'} o.source
 * @param {Array} o.workouts  from readExport
 * @param {string} o.tz       time zone the file's local times are in
 * @param {Map<string,object>} o.resolve  file exercise name -> library exercise {id, name, type, capClass, barKg}
 * @param {Array} o.existing  sessions already stored: {id, startedAt, endedAt, source, title, deleted, status}
 * @param {Set<string>} [o.restorable] ids deleted by an undone import (may come back)
 * @param {string} o.importId
 */
export function planImport({ source, workouts, tz, resolve, existing = [], restorable = new Set(), importId }) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  // Only sessions stored before this import count as clashes: two workouts in the same file are both real.
  const live = existing.filter((s) => !s.deleted && s.startedAt != null && s.status !== 'active');
  const sessions = []; const sets = []; const skipped = [];
  for (const w of [...workouts].sort((a, b) => a.start.localeCompare(b.start))) {
    const id = sessionIdFor(source, w);
    const startedAt = zonedToMs(w.start, tz);
    let endedAt = w.end ? zonedToMs(w.end, tz) : null;
    if (endedAt != null && endedAt < startedAt) endedAt = null;
    const what = { id, title: w.title, start: w.start, startedAt };
    const nSets = w.blocks.reduce((a, b) => a + b.sets.length, 0);
    const cur = byId.get(id);
    if (cur && !cur.deleted) { skipped.push({ ...what, reason: 'already imported', sets: nSets }); continue; }
    if (cur && cur.deleted && !restorable.has(id)) { skipped.push({ ...what, reason: 'deleted in Training HQ', sets: nSets }); continue; }
    if (!nSets) { skipped.push({ ...what, reason: 'no sets done', sets: 0 }); continue; }
    const me = { startedAt, endedAt };
    const clash = live.find((s) => s.id !== id && overlaps(me, s));
    if (clash) {
      skipped.push({ ...what, reason: 'same time as a session already in Training HQ', sets: nSets, clash: { id: clash.id, title: clash.title, source: clash.source ?? 'training-hq', startedAt: clash.startedAt } });
      continue;
    }
    const exercises = [];
    let order = 0;
    w.blocks.forEach((b, i) => {
      const ex = resolve.get(b.name) || { id: slug(b.name), name: b.name, type: 'weight_reps' };
      const key = `k${i}`;
      exercises.push({
        key, exerciseId: ex.id, name: ex.name, ...(ex.name !== b.name ? { importedName: b.name } : {}), type: ex.type || 'weight_reps',
        capClass: ex.capClass ?? null, barKg: ex.barKg ?? null, restSeconds: null, notes: b.note || '', role: null,
        supersetId: b.supersetKey != null ? `${id}.ss${b.supersetKey}` : null, target: null,
      });
      for (const s of b.sets) {
        sets.push({
          id: `${id}.${order}`, sessionId: id, exKey: key, order: order++, done: true, doneAt: null, rpe: s.rpe ?? null, note: '',
          type: s.type, kg: s.kg ?? null, reps: s.reps ?? null, durationS: s.durationS ?? null, distanceM: s.distanceM ?? null,
          ...(s.importedAs ? { importedAs: s.importedAs } : {}), target: null,
        });
      }
    });
    const session = {
      id, kind: 'workout', title: w.title, routineId: null, dayType: dayTypeOf(w.title), week: null,
      startedAt, endedAt, pausedMs: 0, pausedAt: null, status: 'done', note: w.note || '', photos: [], gym: null, bodyweightKg: null,
      source, importId, exercises,
    };
    sessions.push(session);
  }
  return { sessions, sets, skipped };
}

/** Counts for the preview: sessions and sets to add, date range, and skipped sessions by reason. */
export function summarizePlan(plan, extra = {}) {
  const dates = plan.sessions.map((s) => s.startedAt).sort((a, b) => a - b);
  const reasons = {};
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  return {
    sessions: plan.sessions.length,
    sets: plan.sets.length,
    holds: plan.sets.filter((s) => s.type === 'hold').length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    skipped: plan.skipped.length,
    reasons,
    ...extra,
  };
}
