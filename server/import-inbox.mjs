// The Mac's import folder (Mon 10/19): a Hevy or Strong export dropped into the private folder's imports/inbox/ is
// imported by the Mac itself, the same way as Settings > Import history (imports.mjs: kept under imports/<app>/,
// duplicates skipped, exercises matched by name or by the matches he chose before). He AirDrops the export from his
// iPhone to the Mac; nothing to tap on the phone. Optional "<file>.matches.json" next to a file: {file exercise name:
// exercise id | "new"}. Each file moves to inbox/done/ with "<file>.result.json" (what was imported, or the error).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {object} o
 * @param {ReturnType<import('./imports.mjs').openImports>} o.imports
 * @param {string} o.dir   the inbox folder
 * @param {() => string} o.tz  his zone (the phone's), for the export's local times
 * @returns {{scan: () => Array<object>, dir: string}}
 */
export function openImportInbox({ imports, dir, tz, log = () => {} }) {
  const done = join(dir, 'done');
  function scan() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const files = readdirSync(dir).filter((f) => /\.csv$/i.test(f) && !f.startsWith('.'))
      .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs })).sort((a, b) => a.at - b.at || a.f.localeCompare(b.f));
    const out = [];
    for (const { f } of files) {
      const path = join(dir, f);
      const side = join(dir, `${f}.matches.json`);
      let result;
      try {
        const matches = existsSync(side) ? JSON.parse(readFileSync(side, 'utf8')) : {};
        const zone = tz();
        const p = imports.preview({ text: readFileSync(path, 'utf8'), fileName: f, tz: zone });
        const c = imports.commit({ fileId: p.fileId, tz: zone, matches });
        result = { ok: true, file: f, source: p.source, importId: c.id, summary: c.summary, exercisesAdded: c.exercisesAdded || [] };
        log(`import inbox: ${f} (${p.source}): ${c.summary.sessions ?? c.summary.measurements} imported${c.summary.skipped ? `, ${c.summary.skipped} skipped` : ''}`);
      } catch (e) {
        result = { ok: false, file: f, error: e.message };
        log(`import inbox: ${f}: ${e.message}`);
      }
      mkdirSync(done, { recursive: true });
      renameSync(path, join(done, f));
      if (existsSync(side)) renameSync(side, join(done, `${f}.matches.json`));
      writeFileSync(join(done, `${f}.result.json`), `${JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2)}\n`);
      out.push(result);
    }
    return out;
  }
  return { scan, dir };
}
