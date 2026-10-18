// His profile for the coach (8.3): who he is, his goals, his decisions and how he wants to be spoken to, written from
// his brief. It is personal, so it lives in the private folder (data/coach/profile.md), never in this repo. Read
// again when the file changes; a change restarts the coach process before its next message.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PROFILE_FILE = ['coach', 'profile.md'];
export const MAX_PROFILE = 24000;

let cache = { file: null, mtime: 0, text: '' };

/** The profile text, or '' when there is none yet. */
export function readProfile(dataDir) {
  const file = join(dataDir, ...PROFILE_FILE);
  let st;
  try { st = statSync(file); } catch { return ''; }
  if (cache.file === file && cache.mtime === st.mtimeMs) return cache.text;
  let text = '';
  try { text = readFileSync(file, 'utf8').slice(0, MAX_PROFILE); } catch { text = ''; }
  cache = { file, mtime: st.mtimeMs, text };
  return text;
}
