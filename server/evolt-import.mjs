// Evolt PDFs sent from the phone (A11): the original is kept in the private imports folder (imports/evolt/), and the
// numbers read from it go back to the phone to check. Nothing is saved to his scans here: he confirms on the phone.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEvoltPdf } from './evolt-pdf.mjs';

export function openEvoltImport({ dir, log = () => {} }) {
  return {
    read(buf) {
      if (!buf?.length || buf.slice(0, 5).toString('latin1') !== '%PDF-') { const e = new Error('That is not a PDF.'); e.status = 400; throw e; }
      const r = parseEvoltPdf(buf);
      if (!r.ok) { const e = new Error(r.problems?.[0] || 'No Evolt results found in that PDF.'); e.status = 422; throw e; }
      // Keep the original once (same bytes = same file), named by the scan's date.
      mkdirSync(dir, { recursive: true });
      const sha = createHash('sha256').update(buf).digest('hex');
      const same = readdirSync(dir).find((f) => f.endsWith(`-${sha.slice(0, 8)}.pdf`) || f === `evolt-${r.date}.pdf`);
      const file = same || `evolt-${r.date}-${sha.slice(0, 8)}.pdf`;
      if (!existsSync(join(dir, file))) writeFileSync(join(dir, file), buf);
      log(`evolt pdf ${r.date}: ${r.metrics.length} numbers (${file})`);
      return { ...r, file, sha: sha.slice(0, 16) };
    },
  };
}
