// Starts the Training HQ server on the Mac: opens the database, refreshes the app's offline file list,
// and listens on 127.0.0.1. Run by launchd at login (see scripts/install-mac-service.mjs).
import { paths, loadConfig, APP_DIR } from './config.mjs';
import { openStore } from './store.mjs';
import { createApp } from './app.mjs';
import { writePrecache } from '../scripts/precache.mjs';
import { seedDocs, applySeed } from './seed.mjs';
import { openDemos } from './demos.mjs';
import { openImports } from './imports.mjs';
import { openImportInbox } from './import-inbox.mjs';
import { scheduleNightly } from './backup.mjs';
import { openPush, DEFAULT_SUBJECT } from './push.mjs';
import { startNotifier, phoneZone } from './notify.mjs';
import { openWeather } from './weather.mjs';
import { openArrive } from './arrive.mjs';
import { openEvoltImport } from './evolt-import.mjs';
import { openMealVision } from './meal-vision.mjs';
import { openScanVision } from './scan-vision.mjs';
import { findClaude } from './claude.mjs';
import { openHealth, defaultHealthDir } from './health.mjs';
import { openCoach } from './coach/index.mjs';
import { readProfile, readRecovery } from './coach/profile.mjs';
import { TOOLS, contextLine } from './coach/tools.mjs';
import { openEngine } from './voice/engine.mjs';
import { openVoice } from './voice/index.mjs';
import { openWhisper } from './voice/whisper.mjs';
import { openTts } from './voice/tts.mjs';
import { readFileSync } from 'node:fs';
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
// The Mac's import folder (Mon 10/19): Hevy or Strong exports dropped into imports/inbox/ are imported within a minute.
const inbox = openImportInbox({ imports, dir: join(p.importsDir, 'inbox'), tz: () => phoneZone(store), log });
const scanInbox = () => { try { inbox.scan(); } catch (e) { log(`import inbox: ${e.stack || e}`); } };
setTimeout(scanInbox, 4000).unref();
setInterval(scanInbox, 60000).unref();

// Web push (step 4): the Mac's VAPID keys live in config/vapid.json (made the first time, never in git).
const push = openPush({ store, vapidFile: join(p.configDir, 'vapid.json'), subject: config.pushSubject || DEFAULT_SUBJECT, log });
// UV and heat for planning walks (Wed 10/21): Open-Meteo, about once an hour (server/weather.mjs).
const weather = openWeather({ configDir: p.configDir, store, log });
weather.refresh().catch(() => {});
setInterval(() => { weather.refresh().catch(() => {}); }, 15 * 60000).unref();

// Reminders (step 4): checked once a minute, sent as push notifications.
// The coach is made further down; the notifier asks for it when it needs it (coach initiatives).
const notifier = startNotifier({ store, push, log, coach: () => { try { return coach; } catch { return null; } } });
// "When I arrive at the gym" (A10): the iPhone automation's call; days follow the phone's zone like the reminders.
const arrive = openArrive({ store, push, tz: () => phoneZone(store), log });
// Evolt results PDFs (A11): originals kept in imports/evolt/ in the private folder.
const evolt = openEvoltImport({ dir: join(p.importsDir, 'evolt'), log });

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
const coach = openCoach({ store, tools: TOOLS, profile: () => readProfile(p.dataDir), recovery: () => readRecovery(p.dataDir), context: contextLine, log });

// Voice (step 9): the voice lock runs here (speaker check, music check), his voiceprint stays in data/voice.
const engine = openEngine({ modelsDir: config.voiceModelsDir || p.voiceModelsDir, log });
let voiceConfig = {};
try { voiceConfig = JSON.parse(readFileSync(join(p.configDir, 'voice.json'), 'utf8')); } catch { /* defaults */ }
const whisper = openWhisper({ ...(voiceConfig.whisperPath ? { bin: voiceConfig.whisperPath } : {}), ...(voiceConfig.whisperModel ? { model: voiceConfig.whisperModel } : {}), ...(config.whisperPort ? { port: config.whisperPort } : {}), log });
const voice = openVoice({ store, dataDir: p.dataDir, engine, whisper, coach, log });
// The coach's voice: ElevenLabs with his key in config/elevenlabs.json (never sent to the phone), else the Mac's voice.
const tts = openTts({ configDir: p.configDir, log });
log(`voice: ${engine.status().missing.length ? `models missing (${engine.status().missing.join(', ')}): run node scripts/voice-setup.mjs` : 'models ready'}`);

const server = createApp({ store, appDir: APP_DIR, allowedOrigins: config.allowedOrigins, demos, imports, push, health, coach, voice, tts, arrive, evolt, onSync, log });
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
  whisper.stop('server stopping');
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
