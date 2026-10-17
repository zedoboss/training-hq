// Back up the Mac's database now (same as the nightly 1:00 AM backup): node scripts/backup-now.mjs
// Safe while the server runs (the database allows a second reader and writer).
import { join } from 'node:path';
import { paths } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';
import { backupNow } from '../server/backup.mjs';

const p = paths();
const store = openStore(p.dbFile);
const outcome = backupNow({ store, privateDir: p.privateDir, backupDir: join(p.dataDir, 'backup'), log: (m) => console.log(m) });
store.close();
process.exit(/failed/.test(outcome) ? 1 : 0);
