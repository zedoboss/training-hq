// Starts the Training HQ server on the Mac: opens the database, refreshes the app's offline file list,
// and listens on 127.0.0.1. Run by launchd at login (see scripts/install-mac-service.mjs).
import { paths, loadConfig, APP_DIR } from './config.mjs';
import { openStore } from './store.mjs';
import { createApp } from './app.mjs';
import { writePrecache } from '../scripts/precache.mjs';
import { seedDocs, applySeed } from './seed.mjs';
import { openDemos } from './demos.mjs';
import { openImports } from './imports.mjs';
import { scheduleNightly } from './backup.mjs';
import { openPush, DEFAULT_SUBJECT } from './push.mjs';
import { join } from 'node:path';

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const p = paths();
const config = loadConfig(p);
const store = openStore(p.dbFile);
const { version } = writePrecache(APP_DIR);
const seeded = applySeed(store, seedDocs(p.seedDir));
log(`seed: ${seeded.written} written, ${seeded.refreshed} refreshed, ${seeded.kept} unchanged`);

const demos = openDemos(p.demosDir, store);
const scan = demos.rescan();
log(`demos: ${scan.clips} clips (${scan.added} new, ${scan.removed} gone) in ${p.demosDir}`);

// Nightly backup at 1:00 AM into data/backup, committed to the private folder's git (2.21).
const stopBackup = scheduleNightly({ store, privateDir: p.privateDir, backupDir: join(p.dataDir, 'backup'), hour: 1, log });

const imports = openImports({ store, importsDir: p.importsDir });

// Web push (step 4): the Mac's VAPID keys live in config/vapid.json (made the first time, never in git).
const push = openPush({ store, vapidFile: join(p.configDir, 'vapid.json'), subject: config.pushSubject || DEFAULT_SUBJECT, log });

const server = createApp({ store, appDir: APP_DIR, allowedOrigins: config.allowedOrigins, demos, imports, push, log });
server.listen(config.port, '127.0.0.1', () => {
  log(`Training HQ server on http://127.0.0.1:${config.port} (app ${version}, data in ${p.dataDir})`);
});

const shutdown = (sig) => {
  log(`stopping (${sig})`);
  stopBackup();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
