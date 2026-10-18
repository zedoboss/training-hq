// The Evolt 360 results PDF (A11, his answer Sun 10/18: the results come as a PDF from the Evolt app). Every number is
// read from the PDF's own text, exactly as printed, by where it sits under its label: no reading by eye, no rounding.
// He checks them on the results screen and saves them (nothing is saved here). Recommendations printed on the report
// (calories, macros, supplements) are not results and are left out: the app never recommends.
import { pdfText } from './pdf-text.mjs';

const TITLE = {
  'LEAN BODY MASS': 'Lean body mass', 'SKELETAL MUSCLE MASS': 'Skeletal muscle mass', PROTEIN: 'Protein', MINERAL: 'Mineral',
  'TOTAL BODY WATER': 'Total body water', 'BODY FAT MASS': 'Body fat mass', 'SUBCUTANEOUS FAT MASS': 'Subcutaneous fat mass',
  'VISCERAL FAT MASS': 'Visceral fat mass', 'VISCERAL FAT AREA': 'Visceral fat area', 'TOTAL BODY FAT PERCENTAGE': 'Body fat percentage',
  'VISCERAL FAT LEVEL': 'Visceral fat level', 'INTRACELLULAR FLUID (ICF)': 'Intracellular fluid (ICF)', 'EXTRACELLULAR FLUID (ECF)': 'Extracellular fluid (ECF)',
  BMR: 'BMR', TEE: 'TEE', 'BIO AGE': 'Bio age', 'BWI® SCORE': 'BWI score', 'BWI SCORE': 'BWI score',
  'ABDOMINAL CIRCUMFERENCE': 'Abdominal circumference', 'WAIST TO HIP RATIO': 'Waist to hip ratio',
};
const SKIP = new Set([21, 22, 23, 24]); // the report's calorie and macro recommendations
const SEGMENTS = ['LEFT ARM', 'RIGHT ARM', 'TORSO', 'LEFT LEG', 'RIGHT LEG'];
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const clean = (t) => t.replace(/\s+/g, ' ').trim();

/** "63.9 / Optimal" + "[55.9 - 68.3]" -> {text: '63.9', value: 63.9, unit, rating, range, share, printed}. */
export function readValue(parts, unitHint = '') {
  const printed = clean(parts.join(' '));
  const main = clean(parts.find((p) => !/^[[(]/.test(p.trim())) || '');
  const extra = parts.filter((p) => /^[[(]/.test(p.trim())).map((p) => clean(p).replace(/^[[(]\s*|\s*[\])]$/g, ''));
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(%|kCal|kcal|cm2|cm|kg|lbs?)?\s*(?:\/\s*(.+))?$/i.exec(main);
  if (!m) return { text: main, value: null, unit: '', printed };
  const raw = m[2] || '';
  const unit = /^kcal$/i.test(raw) ? 'kcal' : raw === 'cm2' ? 'cm²' : raw || unitHint;
  const out = { text: m[1], value: Number(m[1].replace(',', '.')), unit, printed };
  if (m[3]) out.rating = clean(m[3]);
  for (const e of extra) { if (/%$/.test(e) && !/-/.test(e)) out.share = e; else out.range = e; }
  return out;
}

const unitOf = (hint) => (/KG\/LBS/.test(hint || '') ? 'kg' : /cm2/.test(hint || '') ? 'cm²' : '');

/**
 * Parse the report. Returns {ok, date: 'YYYY-MM-DD', hm: 'HH:MM', printedAt, info: {heightCm, weightKg, age, gender},
 * metrics: [{label, text, value, unit, rating?, range?, share?, printed}], template, problems: []}.
 */
export function parseEvoltPdf(buf) {
  const { pages } = pdfText(buf);
  const p = pages[0];
  if (!p) return { ok: false, problems: ['No pages in the file.'] };
  const runs = p.runs.map((r) => ({ ...r, text: r.text.replace(/ /g, ' ') }));
  const all = runs.map((r) => r.text).join(' ');
  if (!/EVOLT|VOLT 360/i.test(all) || !/LEAN BODY MASS/.test(all)) return { ok: false, problems: ['This is not an Evolt 360 results PDF.'] };
  const sameLine = (a, b) => Math.abs(a.y - b.y) < 2.5;
  const problems = [];

  // Labels: "1." + "LEAN BODY MASS " (two runs), or "19.  ABDOMINAL CIRCUMFERENCE" (one run).
  const labels = [];
  for (const r of runs) {
    const one = /^(\d{1,2})\.\s+(.+)$/.exec(clean(r.text));
    if (one) { labels.push({ n: Number(one[1]), name: clean(one[2]), x: r.x, y: r.y }); continue; }
    if (/^\d{1,2}\.$/.test(clean(r.text))) {
      const name = runs.filter((q) => q !== r && sameLine(q, r) && q.x > r.x && q.x - r.x < 16 && q.size > 6).sort((a, b) => a.x - b.x)[0];
      if (name) labels.push({ n: Number(clean(r.text).slice(0, -1)), name: clean(name.text), x: r.x, y: r.y });
    }
  }
  const valueRuns = runs.filter((r) => r.size >= 5.8 && !/^(KG\/LBS|KG\/LBS\/%|cm2)$/.test(clean(r.text)));
  const hintFor = (l) => runs.filter((q) => Math.abs(q.y - l.y) < 4 && q.x > l.x && q.x - l.x < 160 && q.size < 6 && /KG|cm2/.test(q.text)).sort((a, b) => a.x - b.x)[0]?.text || '';
  const metrics = [];
  for (const l of labels) {
    if (SKIP.has(l.n) || l.n === 18) continue;
    const label = TITLE[l.name] || cap(l.name);
    const gauge = l.n === 16 || l.n === 17;
    const next = labels.filter((q) => q !== l && sameLine(q, l) && q.x > l.x).sort((a, b) => a.x - b.x)[0];
    const x1 = Math.min(l.x + (gauge ? 60 : 135), next ? next.x - 3 : Infinity);
    const inside = valueRuns.filter((r) => r.x >= l.x - (gauge ? 12 : 3) && r.x < x1 && r.y < l.y - (gauge ? 4 : 8) && r.y > l.y - (gauge ? 60 : 25) && !labels.some((q) => q.x === r.x && q.y === r.y))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    if (!inside.length) { problems.push(`No value under ${label}.`); continue; }
    let v;
    if (l.n === 17) v = { ...readValue([inside[0].text]), unit: inside[1] && /^\d+$/.test(clean(inside[1].text)) ? `/${clean(inside[1].text)}` : '', printed: inside.map((x) => clean(x.text)).join(' / ') };
    else if (l.n === 16) v = { ...readValue([inside[0].text]), unit: 'years' };
    else v = readValue(inside.sort((a, b) => a.x - b.x).map((x) => x.text), unitOf(hintFor(l)));
    metrics.push({ label, ...v, n: l.n });
  }

  // Segmental analysis: rows headed "LEAN MASS  FAT MASS  LEFT ARM | RIGHT ARM  LEAN MASS  FAT MASS".
  const mid = p.width / 2;
  for (const seg of runs.filter((r) => SEGMENTS.includes(clean(r.text)))) {
    const side = seg.x < mid ? 'left' : 'right';
    const below = valueRuns.filter((r) => r.y < seg.y - 6 && r.y > seg.y - 25 && (r.x < mid) === (side === 'left'));
    const mains = below.filter((r) => /\//.test(r.text) || /^\d/.test(clean(r.text))).filter((r) => !/^[[(]/.test(clean(r.text))).sort((a, b) => a.x - b.x);
    if (mains.length < 2) { problems.push(`Segmental ${cap(clean(seg.text))}: values not found.`); continue; }
    const brackets = below.filter((r) => /^[[(]/.test(clean(r.text)));
    mains.slice(0, 2).forEach((m, i) => {
      const br = brackets.filter((b) => b.x > m.x && (i === 1 || b.x < mains[1].x));
      metrics.push({ label: `${i === 0 ? 'Lean mass' : 'Fat mass'} (${cap(clean(seg.text))})`, ...readValue([m.text, ...br.map((b) => b.text)], 'kg'), n: 18 + (SEGMENTS.indexOf(clean(seg.text)) * 2 + i + 1) / 100 });
    });
  }

  // Body balance: an X beside BALANCED or UNBALANCED; left of the middle = upper-lower, right = left-right.
  const marks = runs.filter((r) => clean(r.text) === 'X' && r.size >= 8);
  for (const [name, left] of [['Upper-lower body balance', true], ['Left-right body balance', false]]) {
    const words = runs.filter((r) => /^(UN)?BALANCED$/.test(clean(r.text)) && (r.x < mid) === left);
    const hit = marks.map((mk) => ({ mk, w: words.find((w) => Math.abs(w.y - mk.y) < 3) })).find((h) => h.w && (h.mk.x < mid) === left && Math.abs(h.mk.x - h.w.x) < 60);
    if (hit) metrics.push({ label: name, text: cap(clean(hit.w.text)), value: null, unit: '', printed: `X ${clean(hit.w.text)}`, n: left ? 18.001 : 18.002 });
  }

  // The header: DATE "27-10-2024 05:30", HEIGHT, WEIGHT, AGE, GENDER.
  const head = (word) => {
    const l = runs.find((r) => clean(r.text) === word);
    if (!l) return null;
    const v = runs.filter((r) => r.y < l.y - 6 && r.y > l.y - 25 && r.x >= l.x - 3 && r.x < l.x + 130 && r.size >= 8).sort((a, b) => a.x - b.x)[0];
    return v ? clean(v.text) : null;
  };
  const printedAt = head('DATE');
  const dm = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(printedAt || '');
  const date = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
  const hm = dm && dm[4] ? `${dm[4].padStart(2, '0')}:${dm[5]}` : null;
  if (!date) problems.push('No scan date found on the report.');
  const weight = head('WEIGHT'); const height = head('HEIGHT');
  const info = {
    heightCm: height ? Number(/[\d.]+/.exec(height)?.[0]) || null : null, heightText: height,
    weightKg: weight ? Number(/[\d.]+/.exec(weight)?.[0]) || null : null, weightText: weight,
    age: Number(head('AGE')) || null, gender: head('GENDER'),
  };
  if (weight) {
    const w = readValue([weight]);
    metrics.push({ label: 'Weight', ...w, unit: w.unit || 'kg', n: 0 });
  }
  // In the report's own order: weight, 1 to 20, the segmental values after 18.
  const ordered = metrics.sort((a, b) => a.n - b.n).map(({ n, ...m }) => m);
  return { ok: !!date && ordered.length > 5, date, hm, printedAt, info, metrics: ordered, template: 'Evolt 360 results PDF', problems };
}
