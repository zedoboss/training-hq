// His profile for the coach (8.3): who he is, his goals, his decisions and how he wants to be spoken to, written from
// his brief. It is personal, so it lives in the private folder (data/coach/profile.md), never in this repo. Read
// again when the file changes; a change restarts the coach process before its next message.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A13: his recovery record (data/coach/recovery.md, also private) is read the same way and added after the profile.
export const PROFILE_FILE = ['coach', 'profile.md'];
export const RECOVERY_FILE = ['coach', 'recovery.md'];
export const MAX_PROFILE = 24000;

const cache = new Map();

function readText(file) {
  let st;
  try { st = statSync(file); } catch { return ''; }
  const c = cache.get(file);
  if (c && c.mtime === st.mtimeMs) return c.text;
  let text = '';
  try { text = readFileSync(file, 'utf8').slice(0, MAX_PROFILE); } catch { text = ''; }
  cache.set(file, { mtime: st.mtimeMs, text });
  return text;
}

/** The profile text, or '' when there is none yet. */
export const readProfile = (dataDir) => readText(join(dataDir, ...PROFILE_FILE));

/** His recovery record, or '' when there is none. */
export const readRecovery = (dataDir) => readText(join(dataDir, ...RECOVERY_FILE));
