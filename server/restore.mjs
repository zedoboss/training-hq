// Restore the Mac's database from a backup folder (2.21). Stop the server first:
//   launchctl bootout gui/$(id -u)/com.traininghq.server     (or: node scripts/install-mac-service.mjs --uninstall)
//   mv data/training-hq.sqlite* somewhere safe                (in the private folder)
//   node server/restore.mjs [backup folder]                   (default: data/backup; an older night: git checkout first)
//   start the server again (node scripts/install-mac-service.mjs)
// Records keep their change stamps, so the phone's copy and the restored one merge normally on the next sync.
import { join } from 'node:path';
import { paths, loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { readBackup } from './backup.mjs';

const p = paths();
loadConfig(p); // makes the data folder if it is missing
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(p.dataDir, 'backup');
const store = openStore(p.dbFile);
if (store.maxSeq() > 0 && !process.argv.includes('--into-existing')) {
  console.error(`The database at ${p.dbFile} is not empty. Move it aside first, or pass --into-existing to merge.`);
  store.close();
  process.exit(1);
}
const records = readBackup(dir);
const r = store.applyChanges(records, 'backup000000');
console.log(`Restored ${r.current} of ${records.length} records from ${dir} (${r.rejected.length} rejected).`);
if (r.rejected.length) console.log(JSON.stringify(r.rejected.slice(0, 5)));
store.close();
