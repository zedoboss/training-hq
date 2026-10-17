// Starts the Training HQ server on the Mac: opens the database, refreshes the app's offline file list,
// and listens on 127.0.0.1. Run by launchd at login (see scripts/install-mac-service.mjs).
import { paths, loadConfig, APP_DIR } from './config.mjs';
import { openStore } from './store.mjs';
import { createApp } from './app.mjs';
import { writePrecache } from '../scripts/precache.mjs';

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

const p = paths();
const config = loadConfig(p);
const store = openStore(p.dbFile);
const { version } = writePrecache(APP_DIR);

const server = createApp({ store, appDir: APP_DIR, allowedOrigins: config.allowedOrigins, log });
server.listen(config.port, '127.0.0.1', () => {
  log(`Training HQ server on http://127.0.0.1:${config.port} (app ${version}, data in ${p.dataDir})`);
});

const shutdown = (sig) => {
  log(`stopping (${sig})`);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
