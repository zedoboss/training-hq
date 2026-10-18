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
import { startNotifier } from './notify.mjs';
import { openMealVision } from './meal-vision.mjs';
import { openScanVision } from './scan-vision.mjs';
import { findClaude } from './claude.mjs';
import { openHealth, defaultHealthDir } from './health.mjs';
import { openCoach } from './coach/index.mjs';
import { readProfile } from './coach/profile.mjs';
import { TOOLS, contextLine } from './coach/tools.mjs';
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

// Reminders (step 4): checked once a minute, sent as push notifications.
const notifier = startNotifier({ store, push, log });

// Meal photos (6.2): read by Claude on the Mac after each sync that brings one, at start, and every 2 minutes (retries).
const vision = openMealVision({ store, log });
log(`claude: ${findClaude() || 'not found (meal photos wait until the Claude app is installed)'}`);
const kickVision = () => vision.kick().catch((e) => log(`meal vision: ${e.stack || e}`));
// Body scan result photos (7.5): the same way, into 'scan-reads'.
const scanVision = openScanVision({ store, log });
const kickScans = () => scanVision.kick().catch((e) => log(`scan vision: ${e.stack || e}`));
setTimeout(() => { kickVision(); kickScans(); }, 3000).unref();
const visionTimer = setInterval(() => { kickVision(); kickScans(); }, 2 * 60000);
visionTimer.unref();
const onSync = (cols) => {
  if (cols.has('meals') || cols.has('meal-photos')) kickVision();
  if (cols.has('scan-photos') || cols.has('body-scans')) kickScans();
};

// Apple Health (step 7): the iPhone Shortcut's file in iCloud Drive, read at start and every 5 minutes.
const health = openHealth({ store, dir: config.healthDir || defaultHealthDir(), log });
let healthError = null;
const scanHealth = () => { try { const s = health.scan(); if (s.error !== healthError && s.error) log(`health: ${s.error}`); healthError = s.error ?? null; } catch (e) { log(`health: ${e.stack || e}`); } };
setTimeout(scanHealth, 2000).unref();
const healthTimer = setInterval(scanHealth, 5 * 60000);
healthTimer.unref();
log(`health: reading ${health.dir}`);

// The coach (step 8): Claude Code as one long-lived process, started on the first message (or when the chat opens),
// with its tools on a local MCP server. His profile is read from data/coach/profile.md in the private folder.
const coach = openCoach({ store, tools: TOOLS, profile: () => readProfile(p.dataDir), context: contextLine, log });

const server = createApp({ store, appDir: APP_DIR, allowedOrigins: config.allowedOrigins, demos, imports, push, health, coach, onSync, log });
server.listen(config.port, '127.0.0.1', () => {
  log(`Training HQ server on http://127.0.0.1:${config.port} (app ${version}, data in ${p.dataDir})`);
});

const shutdown = (sig) => {
  log(`stopping (${sig})`);
  stopBackup();
  notifier.stop();
  clearInterval(visionTimer);
  clearInterval(healthTimer);
  coach.close().catch(() => {});
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
