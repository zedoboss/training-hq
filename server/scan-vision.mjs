// Body scan photos read on the Mac (7.5, brief section 6 BODY SCAN): he photographs the Evolt 360 results screen or
// printout and Claude on the Mac reads every number off it; he confirms or corrects on the phone. The answer goes to
// 'scan-reads' (<photo id>) and reaches the phone by sync; the Mac never writes the scan itself, so his own numbers
// can't be overwritten. One photo at a time; a failed read is tried again up to 3 times, 5 minutes apart.
import { runOnce, imageBlock, parseJsonAnswer, MODELS } from './claude.mjs';
import { METRICS, cleanMetrics } from '../app/js/lib/scans.js';

export const MAX_TRIES = 3;
const RETRY_MS = 5 * 60000;

export const SYSTEM_SCAN = `You read the results of an Evolt 360 body composition scan (the scanner's screen, its app, or a printout) for a personal log.
Read every metric shown, exactly as reported: the label as printed, the number as printed, and its unit. Do not calculate, convert, round, estimate or add anything that is not shown. Leave out ranges, bars and "normal" bands; keep the measured value.
- Segmental values (arms, legs, trunk): put the section and the body part in the label, e.g. "Segmental lean · Right arm" or "Segmental fat · Left leg".
- key: when a metric is clearly one of these, its key, else null: ${METRICS.map((m) => `${m.key} (${m.label}${m.unit ? `, ${m.unit}` : ''})`).join('; ')}.
- text: the value exactly as printed (e.g. "18.2"); value: the same as a number, or null if it is not a number.
- unsure: true when a number is hard to read.
- scanDate (YYYY-MM-DD) and scanTime (HH:MM, 24-hour) only if the scan's own date or time is shown, else null.
- notes: one short sentence only if something matters (for example "Second page not in the photo"), else "".
Reply with JSON only, no other text:
{"scanDate": string|null, "scanTime": string|null, "metrics": [{"label": string, "text": string, "value": number|null, "unit": string, "key": string|null, "unsure": boolean}], "notes": string}`;

/** Check and tidy the answer. Throws when it isn't usable. */
export function readScanAnswer(text) {
  const j = parseJsonAnswer(text);
  if (!Array.isArray(j.metrics)) throw new Error('no metrics in the answer');
  const metrics = cleanMetrics(j.metrics);
  if (!metrics.length) throw new Error('no numbers could be read from the photo');
  const scanDate = /^\d{4}-\d{2}-\d{2}$/.test(j.scanDate || '') ? j.scanDate : null;
  const scanTime = /^\d{2}:\d{2}$/.test(j.scanTime || '') ? j.scanTime : null;
  return { metrics, scanDate, scanTime, notes: String(j.notes || '').slice(0, 300) };
}

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openStore>} o.store
 * @param {typeof runOnce} [o.run]   Claude call (tests pass a fake)
 */
export function openScanVision({ store, run = runOnce, log = () => {}, now = () => Date.now() }) {
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  let busy = false; let again = false;

  /** Model for scan photos: Settings > Body (Opus 5.5 high by default: every number counts, once in 4 weeks). */
  const modelFor = () => MODELS[one('settings', 'main')?.body?.scanModel] || MODELS.deep;

  /** Photos without a fresh read, oldest first. Photos of a scan he already confirmed are left alone. */
  function todo() {
    const t = now();
    const out = [];
    for (const { data: photo } of store.listRecords('scan-photos')) {
      if (!photo?.dataUrl || !photo.scanId) continue;
      const scan = one('body-scans', photo.scanId);
      if (scan?.status === 'done' && scan.confirmedAt && scan.confirmedAt > (photo.askedAt || photo.at)) continue;
      const read = one('scan-reads', photo.id);
      const fresh = read && (read.round ?? 0) >= (photo.round ?? 0);
      if (fresh && (read.status === 'done' || (read.tries || 0) >= MAX_TRIES || t - read.at < RETRY_MS)) continue;
      out.push({ photo, tries: fresh ? (read.tries || 0) : 0 });
    }
    return out.sort((a, b) => a.photo.at - b.photo.at);
  }

  async function readOne({ photo, tries }) {
    const { model, effort } = modelFor();
    const base = { id: photo.id, photoId: photo.id, scanId: photo.scanId, round: photo.round ?? 0, model };
    try {
      const content = [imageBlock(photo.dataUrl), { type: 'text', text: photo.hint ? `His note about this photo: ${photo.hint}` : 'Read every metric on this Evolt 360 result.' }];
      const res = await run({ system: SYSTEM_SCAN, content, model, effort, timeoutMs: 240000 });
      const ans = readScanAnswer(res.text);
      store.writeLocal('scan-reads', photo.id, { ...base, status: 'done', at: now(), ms: res.ms, tries: tries + 1, ...ans });
      log(`scan photo ${photo.id}: ${ans.metrics.length} metrics in ${res.ms} ms`);
      return true;
    } catch (e) {
      store.writeLocal('scan-reads', photo.id, { ...base, status: 'failed', at: now(), tries: tries + 1, error: e.message });
      log(`scan photo ${photo.id}: not read (${e.message})`);
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
          if (++n > 20) break;
        }
      } while (again);
    } finally { busy = false; }
    return n;
  }

  return { kick, todo, busy: () => busy };
}
