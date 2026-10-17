// Where things live on the Mac. Personal data and keys are in the private folder, never in this repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_DIR = fileURLToPath(new URL('..', import.meta.url));
export const APP_DIR = join(CODE_DIR, 'app');

export function paths(privateDir = process.env.TRAINING_HQ_PRIVATE || join(homedir(), 'Documents', 'training-hq-private')) {
  return {
    privateDir,
    configDir: join(privateDir, 'config'),
    configFile: join(privateDir, 'config', 'server.json'),
    dataDir: join(privateDir, 'data'),
    dbFile: join(privateDir, 'data', 'training-hq.sqlite'),
    seedDir: join(privateDir, 'data', 'seed'),
    logsDir: join(privateDir, 'logs'),
  };
}

const DEFAULTS = { port: 4317, allowedOrigins: [] };

export function loadConfig(p = paths()) {
  for (const d of [p.configDir, p.dataDir, p.logsDir]) mkdirSync(d, { recursive: true });
  if (!existsSync(p.configFile)) {
    writeFileSync(p.configFile, `${JSON.stringify(DEFAULTS, null, 2)}\n`, { mode: 0o600 });
  }
  return { ...DEFAULTS, ...JSON.parse(readFileSync(p.configFile, 'utf8')) };
}
