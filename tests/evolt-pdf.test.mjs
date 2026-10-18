// A11: the Evolt results PDF read on the Mac (made-up report in the Evolt layout; his real one is checked in the
// private folder's tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfText } from '../server/pdf-text.mjs';
import { parseEvoltPdf, readValue } from '../server/evolt-pdf.mjs';
import { openEvoltImport } from '../server/evolt-import.mjs';
import { keyFor, cleanMetrics } from '../app/js/lib/scans.js';

const T = (x, y, size, text) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`;
const LABELS = [
  T(70, 809, 30, 'YOUR EVOLT 360 BODY SCAN'), T(15.7, 793.6, 9, 'DATE'), T(15.7, 756.7, 9, 'HEIGHT'), T(158.8, 756.7, 9, 'WEIGHT'), T(301.9, 756.7, 9, 'AGE'), T(445, 756.8, 9, 'GENDER'),
  T(15.7, 678.6, 6.5, '1.'), T(21.5, 678.6, 8.5, 'LEAN BODY MASS '), T(93.6, 681.4, 4.96, 'KG/LBS'),
  T(158.8, 678.6, 6.5, '6.'), T(165.9, 678.6, 8.5, 'BODY FAT MASS '), T(230.8, 681.4, 4.96, 'KG/LBS'),
  T(158.8, 638.4, 6.5, '7.'), T(165.1, 638.4, 8.5, 'SUBCUTANEOUS FAT MASS '), T(272.5, 641.3, 4.96, 'KG/LBS/%'),
  T(498.1, 662.9, 6.5, '16.'), T(507.8, 662.9, 8.5, 'BIO AGE'), T(490.7, 570.9, 6.5, '17.'), T(499.5, 570.9, 8.5, 'BWI SCORE'),
  T(301.9, 558.1, 6.5, '14.'), T(311.3, 558.1, 8.5, 'BMR'),
  T(219.3, 451, 6.5, 'UPPER - LOWER'), T(337.1, 451, 6.5, 'LEFT - RIGHT '), T(238.7, 437.3, 6.5, 'BALANCED'), T(322.7, 437.3, 6.5, 'BALANCED'), T(238.8, 420.1, 6.5, 'UNBALANCED'), T(314.1, 420.1, 6.5, 'UNBALANCED'),
  T(18.3, 396, 6, 'LEAN MASS '), T(133, 396, 6, 'FAT MASS '), T(211, 396, 6.5, 'LEFT ARM'), T(350.6, 396, 6.5, 'RIGHT ARM'), T(416.2, 396, 6, 'LEAN MASS '), T(536.2, 396, 6, 'FAT MASS '),
  T(350.7, 347.3, 6.5, '19.  ABDOMINAL CIRCUMFERENCE'), T(463.9, 347.3, 6.5, '20.  WAIST TO HIP RATIO'),
  T(51.7, 217.6, 6.5, '21.'), T(61.4, 217.6, 8.5, 'CALORIES'),
].join('\n');
const VALUES = [
  T(21, 776.5, 10, '05-01-2026 06:15'), T(21, 739.5, 10, '180 cm'), T(164, 739.5, 10, '80.4 kg'), T(307, 739.5, 10, '30'), T(450, 739.5, 10, 'Male'),
  T(21, 660.5, 10, '65.2 / Optimal'), T(104.7, 661.2, 8, '[55.9 - 68.3]'), T(164, 660.5, 10, '15.2 / High'), T(251.3, 661.2, 8, '[10.6 - 15.8]'),
  T(164, 620.5, 10, '12.0'), T(261.4, 621.2, 8, '[ 14.9% ]'), T(506, 620.9, 18, '31'), T(500.4, 538.9, 12, '7.9'), T(521.5, 525.9, 12, '10'),
  T(307, 540.5, 10, '1801 kCal'), T(365, 437.5, 10, 'X'), T(223, 420.3, 10, 'X'),
  T(23, 378.2, 8, '3.80 / Optimal'), T(92.1, 378.9, 6, '[3.05 - 3.72]'), T(138, 378.2, 8, '0.70 / Optimal'), T(209.3, 378.9, 6, '[0.61 - 0.91]'),
  T(355, 378.2, 8, '3.75 / Optimal'), T(424.1, 378.9, 6, '[3.05 - 3.72]'), T(469, 378.2, 8, '0.66 / Optimal'), T(540.3, 378.9, 6, '[0.61 - 0.91]'),
  T(355, 330.2, 8, '84.0 cm'), T(405.5, 330.9, 6, '(Less than 102 cm)'), T(469, 330.2, 8, '0.81 / Optimal'), T(541.6, 330.9, 6, '[0.75 - 0.9]'),
  T(57, 194.5, 10, '3000 - 3100'),
].join('\n');

/** A PDF like the Evolt app's: the template, then an incremental update adding a compressed stream of values. */
function evoltLikePdf() {
  const parts = []; const offsets = {};
  let out = '%PDF-1.7\n';
  const obj = (n, body) => { offsets[n] = Buffer.byteLength(out, 'latin1'); out += `${n} 0 obj\n${body}\nendobj\n`; };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Contents [5 0 R] /Resources << /Font << /F1 4 0 R >> >> >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(5, `<< /Length ${Buffer.byteLength(LABELS, 'latin1')} >>\nstream\n${LABELS}\nendstream`);
  out += 'trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n';
  // The update: page 3 again, now drawing stream 6 (deflated, its length in object 7).
  const z = deflateSync(Buffer.from(VALUES, 'latin1')).toString('latin1');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Contents [5 0 R 6 0 R] /Resources << /Font << /F1 4 0 R >> >> >>');
  obj(6, `<< /Filter /FlateDecode /Length 7 0 R >>\nstream\n${z}\nendstream`);
  obj(7, String(z.length));
  out += 'trailer\n<< /Root 1 0 R /Size 8 >>\n%%EOF\n';
  void parts; void offsets;
  return Buffer.from(out, 'latin1');
}

test('the PDF reader: text with positions, from the latest revision of the page, compressed or not', () => {
  const { pages } = pdfText(evoltLikePdf());
  assert.equal(pages.length, 1);
  const date = pages[0].runs.find((r) => r.text === '05-01-2026 06:15');
  assert.ok(date, 'the value added in the update is read');
  assert.equal(Math.round(date.x), 21); assert.equal(Math.round(date.y), 777);
  assert.ok(pages[0].runs.some((r) => r.text === 'LEAN BODY MASS '));
});

test('an Evolt report: every number under its label exactly as printed; recommendations left out', () => {
  const r = parseEvoltPdf(evoltLikePdf());
  assert.equal(r.ok, true);
  assert.deepEqual([r.date, r.hm, r.printedAt], ['2026-01-05', '06:15', '05-01-2026 06:15']);
  assert.deepEqual(r.info, { heightCm: 180, heightText: '180 cm', weightKg: 80.4, weightText: '80.4 kg', age: 30, gender: 'Male' });
  const by = Object.fromEntries(r.metrics.map((m) => [m.label, m]));
  assert.deepEqual(r.metrics.map((m) => m.label), ['Weight', 'Lean body mass', 'Body fat mass', 'Subcutaneous fat mass', 'BMR', 'Bio age', 'BWI score', 'Upper-lower body balance', 'Left-right body balance',
    'Lean mass (Left arm)', 'Fat mass (Left arm)', 'Lean mass (Right arm)', 'Fat mass (Right arm)', 'Abdominal circumference', 'Waist to hip ratio']);
  assert.deepEqual(by['Lean body mass'], { label: 'Lean body mass', text: '65.2', value: 65.2, unit: 'kg', printed: '65.2 / Optimal [55.9 - 68.3]', rating: 'Optimal', range: '55.9 - 68.3' });
  assert.equal(by['Body fat mass'].rating, 'High');
  assert.deepEqual([by['Subcutaneous fat mass'].text, by['Subcutaneous fat mass'].share], ['12.0', '14.9%']);
  assert.deepEqual([by.BMR.text, by.BMR.unit], ['1801', 'kcal']);
  assert.deepEqual([by['Bio age'].text, by['Bio age'].unit], ['31', 'years']);
  assert.deepEqual([by['BWI score'].text, by['BWI score'].unit], ['7.9', '/10']);
  assert.equal(by['Upper-lower body balance'].text, 'Unbalanced');
  assert.equal(by['Left-right body balance'].text, 'Balanced');
  assert.deepEqual([by['Fat mass (Right arm)'].text, by['Fat mass (Right arm)'].range], ['0.66', '0.61 - 0.91']);
  assert.deepEqual([by['Abdominal circumference'].text, by['Abdominal circumference'].unit, by['Abdominal circumference'].range], ['84.0', 'cm', 'Less than 102 cm']);
  assert.equal(by['Waist to hip ratio'].text, '0.81');
  assert.ok(!r.metrics.some((m) => /calorie/i.test(m.label)), 'no calorie recommendation');
  assert.deepEqual(r.problems, []);
});

test('values, keys and what is kept: printed text, rating, range; torso is the trunk', () => {
  assert.deepEqual(readValue(['15.0% / Optimal', '[15 - 20]']), { text: '15.0', value: 15, unit: '%', printed: '15.0% / Optimal [15 - 20]', rating: 'Optimal', range: '15 - 20' });
  assert.equal(keyFor('Lean mass (Torso)', 'kg'), 'leanTrunkKg');
  assert.equal(keyFor('Fat mass (Left leg)', 'kg'), 'fatLeftLegKg');
  const [m] = cleanMetrics([{ label: 'Lean body mass', text: '65.2', unit: 'kg', rating: 'Optimal', range: '55.9 - 68.3', printed: '65.2 / Optimal [55.9 - 68.3]' }]);
  assert.deepEqual(m, { key: 'leanMassKg', label: 'Lean body mass', value: 65.2, text: '65.2', unit: 'kg', rating: 'Optimal', range: '55.9 - 68.3', printed: '65.2 / Optimal [55.9 - 68.3]' });
  assert.equal(parseEvoltPdf(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')).ok, false);
});

test('the Mac keeps the original PDF once and refuses what is not an Evolt PDF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-evolt-'));
  try {
    const ev = openEvoltImport({ dir });
    const a = ev.read(evoltLikePdf());
    const b = ev.read(evoltLikePdf());
    assert.equal(a.file, b.file);
    assert.match(a.file, /^evolt-2026-01-05-[0-9a-f]{8}\.pdf$/);
    assert.deepEqual(readdirSync(dir), [a.file]);
    assert.throws(() => ev.read(Buffer.from('hello')), /not a PDF/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
