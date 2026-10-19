import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openImports } from '../server/imports.mjs';
import { openImportInbox } from '../server/import-inbox.mjs';

const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Pull+","19 Oct 2026, 10:20","19 Oct 2026, 12:12","","Pull Up (Weighted)",,"",0,"normal",10,8,,,
"Pull+","19 Oct 2026, 10:20","19 Oct 2026, 12:12","","Smith Machine Squat",,"",0,"normal",40,8,,,
`;

test("the Mac's import folder: a dropped Hevy export is imported, matches from the side file, the file moves to done/", () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-inbox-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    const imports = openImports({ store, importsDir: join(dir, 'imports') });
    const inbox = openImportInbox({ imports, dir: join(dir, 'imports', 'inbox'), tz: () => 'Asia/Ho_Chi_Minh' });
    assert.deepEqual(inbox.scan(), [], 'empty folder');
    writeFileSync(join(inbox.dir, 'workout_data.csv'), HEVY);
    writeFileSync(join(inbox.dir, 'workout_data.csv.matches.json'), JSON.stringify({ 'Smith Machine Squat': 'new' }));
    const [r] = inbox.scan();
    assert.equal(r.ok, true);
    assert.equal(r.source, 'hevy');
    assert.equal(r.summary.sessions, 1);
    assert.equal(store.listRecords('sessions').length, 1);
    assert.ok(!existsSync(join(inbox.dir, 'workout_data.csv')));
    assert.deepEqual(readdirSync(join(inbox.dir, 'done')).sort(), ['workout_data.csv', 'workout_data.csv.matches.json', 'workout_data.csv.result.json']);
    // The same file again: nothing new, reported, not thrown.
    writeFileSync(join(inbox.dir, 'again.csv'), HEVY);
    const [r2] = inbox.scan();
    assert.equal(r2.ok, false);
    assert.match(r2.error, /nothing new to import/);
    assert.equal(JSON.parse(readFileSync(join(inbox.dir, 'done', 'again.csv.result.json'), 'utf8')).ok, false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
