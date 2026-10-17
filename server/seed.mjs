// Loads the programme and tendon rules from the private folder (data/seed/*.json) into the database.
// A seed document is written if it is missing. If the seed file changes later, a document is refreshed only
// if nobody has edited it in the app since it was seeded, so changes made in the app are never overwritten.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Turn the seed files into {col, id, data} documents. */
export function seedDocs(seedDir) {
  const docs = [];
  const prog = join(seedDir, 'programme.json');
  if (existsSync(prog)) {
    const p = JSON.parse(readFileSync(prog, 'utf8'));
    docs.push({ col: 'programme', id: 'meta', data: p.meta });
    for (const r of p.routines) docs.push({ col: 'programme', id: `routine.${r.id}`, data: r });
  }
  const tend = join(seedDir, 'tendons.json');
  if (existsSync(tend)) {
    const t = JSON.parse(readFileSync(tend, 'utf8'));
    docs.push({ col: 'tendons', id: 'meta', data: { kind: 'meta', sources: t.sources, notice: t.notice, changes: t.changes } });
    docs.push({ col: 'tendons', id: 'rules', data: t.rules });
    for (const a of t.areas) docs.push({ col: 'tendons', id: `area.${a.id}`, data: a });
    docs.push({ col: 'tendons', id: 'readiness', data: t.readiness });
  }
  return docs;
}

/** @returns {{written: number, refreshed: number, kept: number}} */
export function applySeed(store, docs) {
  let written = 0; let refreshed = 0; let kept = 0;
  for (const d of docs) {
    const key = `seed:${d.col}:${d.id}`;
    const h = hash(d.data);
    const cur = store.getRecord(d.col, d.id);
    const stamp = store.getMeta(key);
    if (!cur) {
      const rec = store.writeLocal(d.col, d.id, d.data);
      store.setMeta(key, { hash: h, hlc: rec.hlc });
      written++;
    } else if (stamp && cur.hlc === stamp.hlc && stamp.hash !== h) {
      const rec = store.writeLocal(d.col, d.id, d.data);
      store.setMeta(key, { hash: h, hlc: rec.hlc });
      refreshed++;
    } else {
      kept++;
    }
  }
  return { written, refreshed, kept };
}
