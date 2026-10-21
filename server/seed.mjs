// Loads the programme, tendon rules, own exercises, the history bridge and starting settings from the private folder
// (data/seed/*.json) into the database.
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
  const ex = join(seedDir, 'exercises.json');
  if (existsSync(ex)) {
    for (const e of JSON.parse(readFileSync(ex, 'utf8'))) docs.push({ col: 'exercises', id: e.id, data: e });
  }
  const rt = join(seedDir, 'routines.json');
  if (existsSync(rt)) {
    const r = JSON.parse(readFileSync(rt, 'utf8'));
    for (const f of r.folders) docs.push({ col: 'folders', id: f.id, data: f });
    for (const x of r.routines) docs.push({ col: 'routines', id: x.id, data: x });
  }
  const bridge = join(seedDir, 'history-bridge.json');
  if (existsSync(bridge)) docs.push({ col: 'bridge', id: 'last-loads', data: JSON.parse(readFileSync(bridge, 'utf8')) });
  const settings = join(seedDir, 'settings.json');
  if (existsSync(settings)) {
    for (const [id, data] of Object.entries(JSON.parse(readFileSync(settings, 'utf8')))) docs.push({ col: 'settings', id, data });
  }
  // Step 6: his planned diet (targets, usual foods) and his supplement list, from the brief's section 3.
  // schedule.json: places he has given things in the week (e.g. where Neck goes), as {id: doc}.
  // recovery.json (A13): his recovery record's check-in questions, dates, things to do and photo poses, as {id: doc}.
  // coach-lines.json (A15): his coach's lines for sets and holds, by mood and moment, as {id: doc}.
  // questions.json (Wed 10/21): his open questions from the brief the coach still has to ask him, as {id: doc}.
  for (const [file, col] of [['fuel.json', 'fuel'], ['supplements.json', 'supplements'], ['schedule.json', 'schedule'], ['recovery.json', 'recovery'], ['coach-lines.json', 'coach-lines'], ['questions.json', 'coach-questions']]) {
    const f = join(seedDir, file);
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    for (const [id, data] of Object.entries(j)) docs.push({ col, id, data });
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
