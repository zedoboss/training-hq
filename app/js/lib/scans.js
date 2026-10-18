// Body scans (step 7, brief section 6 BODY SCAN, decision 22): the Evolt 360 at his gym. The app proposes the next
// scan date and he confirms it; a preparation checklist he ticks so every scan is taken the same way; reminders two
// evenings before (the alcohol rule), the evening before (the preparation list) and at his session time on the day
// (on arrival at the gym); the scanner's own safety notice read once and recorded. Pure helpers; the screen is
// views/body-scan.js, the reminders are planned in reminders.js and sent by the Mac.
//
// scan-plan   'main': {next: {date, confirmedAt, proposedDate, how: 'proposal'|'picked'} | null,
//             safety: {readAt} | null, staff: [{at, text}], protocol: {items: [{id, when, text}], changes: [{at, note}]}
//             | null (= the brief's protocol), log: [{at, what, date}]}
// body-scans  'scan.<date>': {id, date, status: 'prep'|'done', prep: {ticks: {<item id>: true}, items: [{id, when,
//             text}], at}, ... results added in 7.5}
import { addDays, rotationDay } from './rotation.js';
import { daysBetween, zonedTime, formatDay, hmOf, zoneOf } from './time.js';

/** Every 4 weeks (brief: scanning more often mostly measures day-to-day water changes). */
export const EVERY_DAYS = 28;

/** The starting protocol, in the brief's words (general guidance from gyms that use this scanner). His gym wins. */
export const PROTOCOL = [
  { id: 'no-alcohol', when: 'before', text: 'No alcohol in the 24 to 48 hours before.' },
  { id: 'as-usual', when: 'before', text: 'The day before: eat, salt and take supplements as usual.' },
  { id: 'first-thing', when: 'day', text: 'First thing at the gym, before the workout. No training beforehand.' },
  { id: 'fasted', when: 'day', text: 'Nothing eaten before the scan.' },
  { id: 'water', when: 'day', text: 'Normal water intake.' },
  { id: 'no-caffeine', when: 'day', text: 'No caffeine or pre-workout before the scan.' },
  { id: 'bathroom', when: 'day', text: 'Bathroom first.' },
  { id: 'barefoot', when: 'day', text: 'Barefoot.' },
];
export const WHEN = [['before', 'The day before'], ['day', 'On the day']];

/** The safety notice, asked once (brief): the app records that he read it and gives no other medical advice. */
export const SAFETY_TEXT = 'The scanner passes a small electrical current through the body. Gyms list pacemakers, other implanted electronic devices and pregnancy as reasons not to use it.';
export const SAFETY_ASK = "Read the scanner's own safety notice once (on the scanner or from the staff) before your first scan.";

/** Asked once of the staff (brief, and section 10): their instructions win over the starting protocol. */
export const STAFF_QUESTIONS = ['How do you want me to prepare for the Evolt 360 scan?', 'Can the results be exported (app, email or PDF) instead of photographed?'];

export const protocolOf = (plan) => (plan?.protocol?.items?.length ? plan.protocol.items : PROTOCOL);
export const isDone = (s) => s?.status === 'done';
export const scanId = (date) => `scan.${date}`;

/** The latest scan with results, or null. */
export const lastDone = (scans = []) => scans.filter(isDone).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;

/**
 * The rotation ahead: [{date, kind: 'train'|'rest'|'done', dayType}] for n days from `from`, assuming each planned
 * session happens on its day (as the backup reminders do) and rest days he already added stay.
 */
export function projectRotation({ last, days = {}, from, n }) {
  const out = [];
  let cur = last;
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const rot = rotationDay({ last: cur, today: date, days });
    out.push({ date, kind: rot.today.kind, dayType: rot.today.dayType });
    if (rot.today.kind === 'train') cur = { dayType: rot.today.dayType, date };
  }
  return out;
}

/** Day type the rotation expects on `date` ('train' with its day type, or 'rest'), or null when it is in the past. */
export function expectedOn({ last, days, today, date }) {
  if (date < today) return null;
  return projectRotation({ last, days, from: today, n: daysBetween(today, date) + 1 }).at(-1);
}

/**
 * The proposed next scan date. Rules (brief section 6, decision 22):
 * - 4 weeks after the last scan, so it falls on the same weekday; the first scan: tomorrow;
 * - never before tomorrow, so the evening-before reminder and the preparation can happen;
 * - on a training day (the scan is first thing at the gym, before the workout): a rest day in the rotation moves it to
 *   the next training day.
 * @returns {{date, dayType, base, shifted: boolean, lastDate: string|null}}
 */
export function proposeNext({ scans = [], today, last, days = {}, every = EVERY_DAYS }) {
  const prev = lastDone(scans);
  let base = prev ? addDays(prev.date, every) : addDays(today, 1);
  if (base <= today) base = addDays(today, 1);
  const ahead = projectRotation({ last, days, from: today, n: daysBetween(today, base) + 8 });
  const pick = ahead.find((p) => p.date >= base && p.kind === 'train');
  return { date: pick?.date || base, dayType: pick?.dayType || null, base, shifted: !!pick && pick.date !== base, lastDate: prev?.date || null };
}

/**
 * Where the planner stands today.
 * @returns {{next: object|null, missed: string|null, proposal: object, prep: object|null, onRest: object|null}}
 *   next: the confirmed scan (today or later, no results yet); missed: a confirmed date that passed with no scan;
 *   onRest: the confirmed date is a rest day in the rotation now, with the next training day to move it to.
 */
export function scanStatus({ plan = {}, scans = [], today, last, days = {} }) {
  const n = plan?.next?.date ? plan.next : null;
  const doneOn = (d) => scans.some((s) => s.date === d && isDone(s));
  const next = n && n.date >= today && !doneOn(n.date) ? n : null;
  const missed = n && n.date < today && !scans.some((s) => s.date >= n.date && isDone(s)) ? n.date : null;
  const proposal = proposeNext({ scans, today, last, days });
  let onRest = null;
  if (next) {
    const exp = expectedOn({ last, days, today, date: next.date });
    if (exp && exp.kind === 'rest') {
      const ahead = projectRotation({ last, days, from: today, n: daysBetween(today, next.date) + 8 });
      const to = ahead.find((p) => p.date > next.date && p.kind === 'train');
      onRest = to ? { to: to.date, dayType: to.dayType } : null;
    }
  }
  const prep = next ? scans.find((s) => s.date === next.date) || null : null;
  return { next, missed, proposal, prep, onRest };
}

/** The plan with a confirmed date (from the proposal or picked by him), dated in its log. */
export function confirmDate(plan = {}, date, { proposedDate = null, at = Date.now() } = {}) {
  const how = proposedDate && proposedDate === date ? 'proposal' : 'picked';
  return { ...plan, next: { date, confirmedAt: at, proposedDate, how }, log: [...(plan.log || []), { at, what: plan.next?.date ? 'moved' : 'confirmed', date }] };
}
export function cancelDate(plan = {}, at = Date.now()) {
  return { ...plan, next: null, log: [...(plan.log || []), { at, what: 'cancelled', date: plan.next?.date || null }] };
}

/** The scan record with one checklist line ticked or unticked; the item texts are kept as they were that day. */
export function withTick(rec, date, items, id, on, at = Date.now()) {
  const base = rec || { id: scanId(date), date, status: 'prep', createdAt: at };
  const ticks = { ...(base.prep?.ticks || {}) };
  if (on) ticks[id] = true; else delete ticks[id];
  return { ...base, prep: { ticks, items: items.map(({ id: i, when, text }) => ({ id: i, when, text })), at } };
}

/** Lines not ticked for a scan, from the items it was taken with. */
export function unticked(rec, items) {
  const list = rec?.prep?.items?.length ? rec.prep.items : items;
  return list.filter((i) => !rec?.prep?.ticks?.[i.id]);
}

/** The checklist with his changes (the gym's instructions win), dated. */
export function withProtocol(plan = {}, items, note = 'Edited', at = Date.now()) {
  const clean = items.map((i) => ({ id: i.id, when: i.when === 'before' ? 'before' : 'day', text: String(i.text || '').trim() })).filter((i) => i.text);
  return { ...plan, protocol: { items: clean, changes: [...(plan.protocol?.changes || []), { at, note }] } };
}

const dayText = (iso) => formatDay(new Date(`${iso}T12:00:00Z`), 'UTC');
const joinTexts = (items) => items.map((i) => i.text.replace(/^The day before: (.)/, (_, c) => c.toUpperCase()).replace(/\.$/, '')).join('. ');

/**
 * Reminders for a day (brief section 6: the evening before with the preparation list, and on arrival at the gym).
 * A web app can't tell when he walks into the gym, so "on arrival" is his session time that day (he sets it the day
 * before, decision 15). Two evenings before, a heads-up for the no-alcohol line (24 to 48 hours).
 */
export function scanReminders({ date, tz, plan = {}, scans = [], days = {}, eveningHm = '20:00' }) {
  const d = plan?.next?.date;
  if (!d) return [];
  const due = !scans.some((s) => s.date === d && isDone(s));
  const items = protocolOf(plan);
  const base = { kind: 'scan', url: '#/body/scan', tag: `scan-${d}`, fixed: true, due };
  const hm = days[d]?.sessionTime || null;
  if (date === addDays(d, -2)) {
    const alcohol = items.find((i) => i.id === 'no-alcohol');
    return [{ ...base, id: `scan-alcohol:${d}`, at: zonedTime(date, eveningHm, tz), title: 'Body scan in two days', body: `${dayText(d)}, first thing at the gym.${alcohol ? ` ${alcohol.text}` : ''}` }];
  }
  if (date === addDays(d, -1)) {
    const before = items.filter((i) => i.when === 'before'); const on = items.filter((i) => i.when !== 'before');
    return [{
      ...base, id: `scan-eve:${d}`, at: zonedTime(date, eveningHm, tz), title: 'Body scan tomorrow',
      body: `${dayText(d)}.${before.length ? ` Tonight: ${joinTexts(before)}.` : ''}${on.length ? ` Tomorrow: ${joinTexts(on)}.` : ''}${hm ? '' : " Set tomorrow's session time so the gym reminder comes on time."}`,
    }];
  }
  if (date === d && hm) {
    return [{ ...base, id: `scan-arrive:${d}`, at: zonedTime(d, hm, tz), title: 'Body scan first', body: 'At the gym: scan before the workout. Tick the checklist.' }];
  }
  return [];
}

// ---- Results (7.5) ----
// A scan with results: 'body-scans' scan.<date> {..., status 'done', at (time of the scan), metrics: [{key, label,
// value, text, unit, unsure}], conditions: {fasted, trainedBefore, unusual, unticked: [ids]}, photos: [photo ids],
// source 'photo'|'manual', confirmedAt, note}. Every metric is stored exactly as the scanner reported it (label, the
// number as printed, unit); `key` links the usual ones across scans for the trends (7.6), others keep key null.
// Photos: 'scan-photos' {id, scanId, date, dataUrl, at}; what the Mac read: 'scan-reads' <photo id> (Mac only).

/** The usual Evolt 360 metrics (for typing them in and for trends). Labels on his scanner may differ; any label works. */
export const METRICS = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', main: true, alias: ['weight', 'body weight', 'total weight', 'total body weight'] },
  { key: 'fatPercent', label: 'Body fat', unit: '%', main: true, alias: ['body fat', 'body fat percentage', 'body fat percent', 'percent body fat', 'pbf', 'fat percentage', 'fat percent', 'bf'] },
  { key: 'fatMassKg', label: 'Body fat mass', unit: 'kg', main: true, alias: ['body fat mass', 'fat mass', 'total fat mass', 'total body fat mass', 'bfm'] },
  { key: 'leanMassKg', label: 'Lean body mass', unit: 'kg', main: true, alias: ['lean body mass', 'lean mass', 'lbm', 'fat free mass', 'ffm', 'total lean mass'] },
  { key: 'muscleMassKg', label: 'Skeletal muscle mass', unit: 'kg', main: true, alias: ['skeletal muscle mass', 'skeletal muscle', 'smm', 'muscle mass'] },
  { key: 'waterL', label: 'Total body water', unit: 'L', main: true, alias: ['total body water', 'tbw', 'body water', 'water'] },
  { key: 'visceralFat', label: 'Visceral fat level', unit: '', main: true, alias: ['visceral fat level', 'visceral fat', 'visceral fat rating', 'vfl', 'visceral fat index'] },
  { key: 'bmrKcal', label: 'BMR', unit: 'kcal', main: true, alias: ['bmr', 'basal metabolic rate', 'resting metabolic rate', 'rmr'] },
  { key: 'icwL', label: 'Intracellular water', unit: 'L', alias: ['intracellular water', 'icw'] },
  { key: 'ecwL', label: 'Extracellular water', unit: 'L', alias: ['extracellular water', 'ecw'] },
  { key: 'ecwRatio', label: 'ECW/TBW', unit: '', alias: ['ecw tbw', 'ecw ratio', 'ecw tbw ratio', 'extracellular water ratio'] },
  { key: 'proteinKg', label: 'Protein', unit: 'kg', alias: ['protein', 'protein mass'] },
  { key: 'mineralKg', label: 'Minerals', unit: 'kg', alias: ['minerals', 'mineral', 'mineral mass', 'bone mineral content', 'bone mass', 'bmc'] },
  { key: 'subcutFatKg', label: 'Subcutaneous fat mass', unit: 'kg', alias: ['subcutaneous fat mass', 'subcutaneous fat', 'sfm'] },
  { key: 'visceralAreaCm2', label: 'Visceral fat area', unit: 'cm²', alias: ['visceral fat area', 'vfa'] },
  { key: 'bmi', label: 'BMI', unit: '', alias: ['bmi', 'body mass index'] },
  { key: 'bioAge', label: 'Biological age', unit: 'years', alias: ['biological age', 'bio age', 'metabolic age', 'body age'] },
  ...[['RightArm', 'right arm'], ['LeftArm', 'left arm'], ['Trunk', 'trunk'], ['RightLeg', 'right leg'], ['LeftLeg', 'left leg']].flatMap(([k, part]) => [
    { key: `lean${k}Kg`, label: `Lean mass · ${part[0].toUpperCase()}${part.slice(1)}`, unit: 'kg', part, seg: 'lean' },
    { key: `fat${k}Kg`, label: `Fat mass · ${part[0].toUpperCase()}${part.slice(1)}`, unit: 'kg', part, seg: 'fat' },
  ]),
];
export const metricOf = (key) => METRICS.find((m) => m.key === key) || null;
const KEYS = new Set(METRICS.map((m) => m.key));
const words = (s) => String(s || '').toLowerCase().replace(/\((kg|lbs?|%|l|kcal|cm2|cm²|level|years?|ratio)\)/g, ' ').replace(/[^a-z0-9%]+/g, ' ').trim();

/**
 * The usual metric a printed label stands for, or null. Segmental lines need the body part and lean/muscle or fat in
 * the label ("Segmental lean · Right arm"). A % unit on a fat label means body fat %, a kg unit fat mass.
 */
export function keyFor(label, unit = '') {
  const w = words(label); const u = String(unit || '').toLowerCase().trim();
  if (!w) return null;
  const seg = METRICS.find((m) => m.part && w.includes(m.part));
  if (seg) {
    if (u === '%') return null; // a segment's % of normal: kept, not trended
    const kind = /\bfat\b/.test(w) ? 'fat' : /\b(lean|muscle|ffm|fat free)\b/.test(w) ? 'lean' : null;
    return kind ? METRICS.find((m) => m.part === seg.part && m.seg === kind).key : null;
  }
  const exact = METRICS.find((m) => m.alias?.includes(w));
  if (exact) {
    if (exact.key === 'fatMassKg' && u === '%') return 'fatPercent';
    if (exact.key === 'fatPercent' && /^(kg|lb|lbs)$/.test(u)) return 'fatMassKg';
    return exact.key;
  }
  if (/\bfat\b/.test(w) && !/visceral|subcutaneous|free/.test(w)) return u === '%' || /%|percent/.test(w) ? 'fatPercent' : /^(kg|lb|lbs)$/.test(u) ? 'fatMassKg' : null;
  return null;
}

/** A number as printed ("82,4", "18.2 %", "1,845") or null. */
export function numberOf(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const m = /^[<>~≈]?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return null;
  const t = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(m[1]) ? m[1].replace(/,/g, '') : m[1].replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Metrics tidied: label as reported, the number as printed (text) and as a number, unit, key (checked or found). */
export function cleanMetrics(list = []) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const label = String(m?.label ?? '').trim().slice(0, 80);
    const text = String(m?.text ?? (m?.value ?? '')).trim().slice(0, 40);
    if (!label || !text) continue;
    const unit = String(m?.unit ?? '').trim().slice(0, 16);
    const value = Number.isFinite(Number(m?.value)) && m?.value !== '' && m?.value !== null ? Number(m.value) : numberOf(text);
    const key = KEYS.has(m?.key) ? m.key : keyFor(label, unit);
    out.push({ key: key || null, label, value, text, unit, ...(m?.unsure ? { unsure: true } : {}) });
  }
  // One metric per key: the first one wins, a later duplicate keeps its label but loses the key.
  const seen = new Set();
  return out.map((m) => { if (!m.key) return m; if (seen.has(m.key)) return { ...m, key: null }; seen.add(m.key); return m; });
}

/** Everything the Mac read from his photos of one scan, in photo order, duplicates (same key or label) left out. */
export function mergeReads(reads = []) {
  const out = []; const keys = new Set(); const labels = new Set();
  for (const r of reads.filter((x) => x?.status === 'done')) {
    for (const m of cleanMetrics(r.metrics)) {
      const l = words(m.label);
      if ((m.key && keys.has(m.key)) || labels.has(l)) continue;
      if (m.key) keys.add(m.key);
      labels.add(l);
      out.push(m);
    }
  }
  return out;
}

/** The conditions a scan starts with, from its checklist ticks: fasted, trained before, the lines left unticked. */
export function conditionsFrom(rec, items) {
  const ticks = rec?.prep?.ticks || {};
  const has = (id) => (rec?.prep?.items?.length ? rec.prep.items : items).some((i) => i.id === id);
  return {
    fasted: has('fasted') ? (ticks.fasted ? true : null) : null,
    trainedBefore: has('first-thing') ? (ticks['first-thing'] ? false : null) : null,
    unusual: '',
    unticked: unticked(rec, items).map((i) => i.id),
  };
}

/** Conditions that differ from the protocol, in words (empty = taken the usual way). */
export function conditionNotes(scan, items) {
  const c = scan?.conditions || {};
  const out = [];
  if (c.fasted === false) out.push('not fasted');
  if (c.trainedBefore === true) out.push('trained before');
  const byId = new Map((scan?.prep?.items?.length ? scan.prep.items : items).map((i) => [i.id, i]));
  if (c.unticked?.length && c.unticked.length >= byId.size) out.push('checklist not ticked');
  else if (c.unticked?.length) out.push(`not ticked: ${c.unticked.map((id) => byId.get(id)?.text.replace(/\.$/, '') || id).join('; ')}`);
  if (c.unusual) out.push(c.unusual);
  return out;
}

/** The scan record with its results saved (status 'done'). */
export function withResults(rec, { date, at, metrics, conditions, photos = [], source, note = '' }, now = Date.now()) {
  const base = rec || { id: scanId(date), date, createdAt: now };
  return { ...base, id: scanId(date), date, status: 'done', at, metrics: cleanMetrics(metrics), conditions, photos, source, note: String(note || '').trim(), confirmedAt: now };
}

/** A usual metric's value on a scan, or null. */
export const metricValue = (scan, key) => scan?.metrics?.find((m) => m.key === key && m.value != null)?.value ?? null;

/** Calendar markers: one per scan with results. */
export function scanMarks(scans = []) {
  return scans.filter(isDone).map((s) => {
    const parts = [['weightKg', 'kg'], ['fatPercent', '% fat'], ['muscleMassKg', 'kg muscle']].map(([k, u]) => { const v = metricValue(s, k); return v == null ? null : `${v} ${u}`.replace(' %', '%'); }).filter(Boolean);
    return { date: s.date, kind: 'scan', id: s.id, label: `Body scan${parts.length ? `: ${parts.join(' · ')}` : ''}` };
  });
}

// ---- Trends (7.6) ----
// Each metric across scans, beside body weight and training volume (separate charts, one scale each). A scan taken
// under different conditions is flagged as not directly comparable. Changes are told as numbers, never judged.

/** How a metric is followed across scans: its key, else its printed label (lower case words). */
const idOf = (m) => m.key || `label:${words(m.label)}`;

/** Metrics with a number in any scan: [{id, label, unit, count}], the usual ones in their order first. */
export function metricsAvailable(scans = []) {
  const seen = new Map();
  for (const s of scans.filter(isDone)) {
    for (const m of s.metrics || []) {
      if (m.value == null) continue;
      const id = idOf(m);
      const cur = seen.get(id) || { id, label: metricOf(m.key)?.label || m.label, unit: m.unit || metricOf(m.key)?.unit || '', count: 0 };
      cur.count++;
      seen.set(id, cur);
    }
  }
  const order = (x) => { const i = METRICS.findIndex((m) => m.key === x.id); return i < 0 ? 1000 : i; };
  return [...seen.values()].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label));
}

/** One metric across scans, oldest first: [{date, at, value, text, unit, notes}] (notes: why not comparable). */
export function scanSeries(scans = [], id, items = PROTOCOL) {
  return scans.filter(isDone).sort((a, b) => (a.date < b.date ? -1 : 1)).flatMap((s) => {
    const m = (s.metrics || []).find((x) => idOf(x) === id && x.value != null);
    return m ? [{ date: s.date, at: s.at, tz: s.tz ?? null, value: m.value, text: m.text, unit: m.unit, notes: conditionNotes(s, items), scan: s }] : [];
  });
}

/** Minutes after midnight of a scan's time, on the clock where it was taken (A3). */
const minuteOfDay = (scan) => { const [h, m] = hmOf(new Date(scan.at), zoneOf(scan)).split(':').map(Number); return h * 60 + m; };
export const TIME_SLACK_MIN = 120;

/**
 * Why two scans are not directly comparable (empty = comparable): either was taken under different conditions, or
 * at a different time of day (more than 2 hours apart; the protocol says the same time of day every time).
 */
export function notComparable(a, b, items = PROTOCOL) {
  const out = [];
  for (const s of [a, b]) {
    const n = conditionNotes(s, items);
    if (n.length) out.push(`${formatDay(new Date(`${s.date}T12:00:00`))}: ${n.join('; ')}`);
  }
  if (a?.at && b?.at && Math.abs(minuteOfDay(a) - minuteOfDay(b)) > TIME_SLACK_MIN) out.push('a different time of day');
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

/** "Body fat: 18.2% to 17.5% (−0.7 points)" for each usual main metric both scans have. */
export function changeLines(prev, cur, ids = METRICS.filter((m) => m.main).map((m) => m.key)) {
  const out = [];
  for (const id of ids) {
    const a = (prev.metrics || []).find((m) => idOf(m) === id && m.value != null);
    const b = (cur.metrics || []).find((m) => idOf(m) === id && m.value != null);
    if (!a || !b) continue;
    const unit = b.unit || metricOf(id)?.unit || '';
    const d = r1(b.value - a.value);
    const sp = unit && unit !== '%' ? ' ' : '';
    out.push({ id, text: `${metricOf(id)?.label || b.label}: ${a.text}${sp}${unit} to ${b.text}${sp}${unit} (${d === 0 ? 'no change' : `${signed(d)}${unit === '%' ? ' points' : unit ? ` ${unit}` : ''}`})` });
  }
  return out;
}

/** The latest scan against the one before: {cur, prev, days, lines, reasons}, or null with fewer than two scans. */
export function latestChange(scans = [], items = PROTOCOL) {
  const list = scans.filter(isDone).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (list.length < 2) return null;
  const cur = list.at(-1); const prev = list.at(-2);
  return { cur, prev, days: daysBetween(prev.date, cur.date), lines: changeLines(prev, cur), reasons: notComparable(prev, cur, items) };
}
