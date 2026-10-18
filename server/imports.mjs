// Imports from Hevy and Strong on the Mac (step 3): preview, import, undo.
// The original file is kept in the private folder (imports/<app>/); the new records reach the phone by sync.
// Rules for the owner's own notes come from the settings doc 'import-rules'; remembered exercise matches live in
// 'import-matches' ({hevy: {file name: exercise id}, strong: {...}}).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectSource, matchExercises, newExerciseFromImport, parseCsv, planImport, readExport, summarizePlan } from '../app/js/lib/import.js';
import { mergeLibrary } from '../app/js/lib/library.js';
import { equipmentWithDefaults } from '../app/js/lib/settings.js';

const FILE_ID = /^(hevy|strong)\/[A-Za-z0-9._-]{1,120}\.csv$/;
const sha = (s) => createHash('sha256').update(s).digest('hex');

export class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ImportError'; this.status = status; }
}

function checkTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { throw new ImportError(`unknown time zone: ${tz}`); }
}

export function openImports({ store, importsDir, now = () => Date.now() }) {
  const doc = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const library = () => mergeLibrary(store.listRecords('exercises').map((r) => r.data), equipmentWithDefaults(doc('settings', 'equipment')));
  const rows = (col) => store.db.prepare('SELECT id, data, deleted FROM records WHERE col = ?').all(col);

  /** Keep the file in imports/<app>/ (once: the same content is found under any name) and return its id. */
  function keepFile(text, fileName = '') {
    const source = detectSource(parseCsv(text.slice(0, 2000)).header);
    if (!source) throw new ImportError('This file is not a Hevy or Strong workout export (its columns don\'t match).');
    const dir = join(importsDir, source);
    mkdirSync(dir, { recursive: true });
    const h = sha(text);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
      if (sha(readFileSync(join(dir, f), 'utf8')) === h) return { fileId: `${source}/${f}`, source, kept: false };
    }
    const base = String(fileName).replace(/\.csv$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
    const name = `${base}-${new Date(now()).toISOString().slice(0, 10)}-${h.slice(0, 8)}.csv`;
    writeFileSync(join(dir, name), text, { flag: 'wx' });
    return { fileId: `${source}/${name}`, source, kept: true };
  }

  function existingSessions() {
    return rows('sessions').map((r) => {
      if (r.deleted) return { id: r.id, deleted: true };
      const d = JSON.parse(r.data);
      return { id: r.id, title: d.title, source: d.source ?? 'training-hq', status: d.status, startedAt: d.startedAt, endedAt: d.endedAt ?? null };
    });
  }

  const importDocs = () => store.listRecords('imports').map((r) => r.data);
  const restorable = () => new Set(importDocs().filter((d) => d.undoneAt).flatMap((d) => d.sessionIds || []));

  /** Read the kept file and plan the import with the chosen matches ({file name: exercise id | 'new'}). */
  function build({ fileId, tz, matches = {}, importId = 'preview' }) {
    if (!FILE_ID.test(fileId || '')) throw new ImportError('unknown file');
    let text;
    try { text = readFileSync(join(importsDir, fileId), 'utf8'); } catch { throw new ImportError('file not found; choose it again'); }
    checkTz(tz);
    const r = readExport(text, { rules: doc('settings', 'import-rules') || {} });
    const lib = library();
    const byId = new Map(lib.map((e) => [e.id, e]));
    const stats = new Map();
    for (const w of r.workouts) {
      const seen = new Set();
      for (const b of w.blocks) {
        if (!stats.has(b.name)) stats.set(b.name, { sets: [], sessions: 0 });
        const st = stats.get(b.name);
        st.sets.push(...b.sets);
        if (!seen.has(b.name)) { st.sessions++; seen.add(b.name); }
      }
    }
    const remembered = doc('settings', 'import-matches')?.[r.source] || {};
    const auto = matchExercises([...stats.keys()], lib, remembered);
    const resolve = new Map();
    const newExercises = [];
    const exercises = auto.map((m) => {
      const choice = matches?.[m.name];
      const id = choice === 'new' ? null : (choice && byId.has(choice) ? choice : m.id);
      const base = { name: m.name, sets: stats.get(m.name).sets.length, sessions: stats.get(m.name).sessions, how: choice && choice !== m.id ? 'chosen' : m.how, suggestions: m.suggestions };
      if (id) {
        resolve.set(m.name, byId.get(id));
        return { ...base, id, matchName: byId.get(id).name };
      }
      const ex = newExerciseFromImport(m.name, stats.get(m.name).sets, { suggestion: m.suggestions[0], library: lib, source: r.source });
      if (byId.has(ex.id)) ex.id = `${ex.id}-${r.source}`;
      resolve.set(m.name, ex);
      newExercises.push(ex);
      return { ...base, how: 'new', id: null, matchName: null, newExercise: { id: ex.id, type: ex.type, primary: ex.primary, equipment: ex.equipment } };
    });
    const plan = planImport({ source: r.source, workouts: r.workouts, tz, resolve, existing: existingSessions(), restorable: restorable(), importId });
    const used = new Set(plan.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)));
    return { r, plan, exercises, newExercises: newExercises.filter((e) => used.has(e.id)) };
  }

  const slimSkipped = (list) => list.map(({ id, title, start, startedAt, reason, sets, clash }) => ({ id, title, start, startedAt, reason, sets, ...(clash ? { clash } : {}) }));

  function report(fileId, tz, b) {
    return {
      fileId, source: b.r.source, tz,
      summary: summarizePlan(b.plan, { newExercises: b.newExercises.length, notDone: b.r.notDone, badRows: b.r.badRows, fileSessions: b.r.workouts.length }),
      exercises: b.exercises,
      skipped: slimSkipped(b.plan.skipped),
    };
  }

  return {
    /** Keep the uploaded file and show what an import would do. Nothing is saved but the file. */
    preview({ text, fileName, tz }) {
      if (!text || !text.trim()) throw new ImportError('the file is empty');
      const { fileId, kept } = keepFile(text, fileName);
      return { ...report(fileId, tz, build({ fileId, tz })), fileName: fileName || null, keptNew: kept };
    },

    /** Same as preview for a file already kept, with the time zone and matches chosen so far. */
    plan({ fileId, tz, matches }) {
      return report(fileId, tz, build({ fileId, tz, matches }));
    },

    /** Save the sessions, sets and new exercises in one go; remember the matches. */
    commit({ fileId, tz, matches = {}, remember = true }) {
      const at = now();
      const source = String(fileId || '').split('/')[0];
      const importId = `imp.${source}.${at}`;
      const b = build({ fileId, tz, matches, importId });
      if (!b.plan.sessions.length) throw new ImportError('nothing new to import: every session in this file is already here or was skipped');
      const items = [
        ...b.newExercises.map((e) => ({ col: 'exercises', id: e.id, data: { ...e, createdAt: at } })),
        ...b.plan.sessions.map((s) => ({ col: 'sessions', id: s.id, data: s })),
        ...b.plan.sets.map((s) => ({ col: 'sets', id: s.id, data: s })),
      ];
      if (remember) {
        const cur = doc('settings', 'import-matches') || {};
        const mine = { ...(cur[b.r.source] || {}) };
        for (const e of b.exercises) {
          if (e.how === 'same name') continue;
          mine[e.name] = e.id ?? e.newExercise.id;
        }
        items.push({ col: 'settings', id: 'import-matches', data: { ...cur, [b.r.source]: mine } });
      }
      const summary = summarizePlan(b.plan, { newExercises: b.newExercises.length });
      const record = {
        id: importId, source: b.r.source, file: fileId, tz, at, summary,
        sessionIds: b.plan.sessions.map((s) => s.id), exercisesAdded: b.newExercises.map((e) => e.id),
        skipped: slimSkipped(b.plan.skipped), notDone: b.r.notDone, undoneAt: null,
      };
      items.push({ col: 'imports', id: importId, data: record });
      store.writeLocalMany(items);
      return record;
    },

    /** Remove everything an import added: its sessions and their sets, and exercises nothing else uses. */
    undo({ importId }) {
      const d = doc('imports', importId);
      if (!d) throw new ImportError('no such import', 404);
      if (d.undoneAt) throw new ImportError('this import was already undone');
      const ids = new Set(d.sessionIds);
      const live = rows('sessions').filter((r) => !r.deleted).map((r) => JSON.parse(r.data));
      const mine = live.filter((s) => ids.has(s.id) && s.importId === importId);
      const mineIds = new Set(mine.map((s) => s.id));
      const sets = rows('sets').filter((r) => !r.deleted && mineIds.has(JSON.parse(r.data).sessionId));
      const stillUsed = new Set([
        ...live.filter((s) => !mineIds.has(s.id)).flatMap((s) => (s.exercises || []).map((e) => e.exerciseId)),
        ...store.listRecords('routines').flatMap((r) => (r.data.exercises || []).map((e) => e.exerciseId)),
      ]);
      const exercises = (d.exercisesAdded || []).filter((id) => !stillUsed.has(id) && doc('exercises', id));
      store.writeLocalMany([
        ...sets.map((r) => ({ col: 'sets', id: r.id, deleted: true })),
        ...mine.map((s) => ({ col: 'sessions', id: s.id, deleted: true })),
        ...exercises.map((id) => ({ col: 'exercises', id, deleted: true })),
        { col: 'imports', id: importId, data: { ...d, undoneAt: now(), undone: { sessions: mine.length, sets: sets.length, exercises: exercises.length } } },
      ]);
      return { sessions: mine.length, sets: sets.length, exercises: exercises.length };
    },

    list: () => importDocs().sort((a, b) => b.at - a.at),
  };
}
