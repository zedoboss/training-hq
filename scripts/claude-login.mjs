#!/usr/bin/env node
// Signs in the Claude Code that the Mac server starts (coach, meal and scan photos, nightly review, coach changes).
// That Claude Code never gets the Claude app's own login, and its keychain login runs out after about 30 days. This
// runs `claude setup-token` (a browser sign-in that makes a 1-year token), checks the token answers, and saves it to
// the private config (config/claude-token.json, never in git, never sent to the phone). The token is never printed.
// Run on the Mac, in Terminal: node ~/Documents/training-hq/scripts/claude-login.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findClaude, tokenFile } from '../server/claude.mjs';

const YEAR_MS = 365 * 86400000;
const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/;

/** This process's environment without the Claude app's own session settings (when run from its Terminal panel). */
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|__CF)/.test(k)) env[k] = v;
  return env;
}

/** Does Claude Code answer with this token? true, or the reason it didn't. */
export function check(claude, token, env = cleanEnv()) {
  const r = spawnSync(claude, ['-p', 'Reply with the single word OK.', '--model', 'claude-sonnet-5-5', '--effort', 'low', '--tools', '',
    '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json'],
  { cwd: tmpdir(), env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: token }, encoding: 'utf8', timeout: 120000 });
  try {
    const j = JSON.parse(String(r.stdout).trim().split('\n').pop());
    return !j.is_error && j.subtype === 'success' ? true : String(j.result || j.subtype || 'error').slice(0, 200);
  } catch { return (r.stderr || r.error?.message || `exit ${r.status}`).trim().split('\n').pop().slice(0, 200); }
}

/** The token typed or pasted at a hidden prompt ('' when nothing). */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) { let s = ''; stdin.on('data', (d) => { s += d; }); stdin.on('end', () => resolve(s.trim())); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let s = '';
    const onData = (d) => {
      for (const ch of d) {
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(s.trim()); return; }
        if (ch === '\u007f') s = s.slice(0, -1); else s += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const claude = findClaude();
  if (!claude) { console.log('Claude Code was not found on this Mac. Open the Claude app once, then run this again.'); process.exit(1); }
  const env = cleanEnv();
  console.log('\nTraining HQ: sign Claude in on this Mac (once a year).\n');
  console.log('1. A browser page opens. Sign in to your Claude account there and allow access.');
  console.log('2. Come back here. The rest is automatic.\n');

  // Recorded through `script` so the token can be picked up without anyone copying it; the record is deleted at once.
  const dir = mkdtempSync(join(tmpdir(), 'thq-login-'));
  const rec = join(dir, 'rec');
  let token = '';
  try {
    spawnSync('/usr/bin/script', ['-q', rec, claude, 'setup-token'], { stdio: 'inherit', env });
    // eslint-disable-next-line no-control-regex
    const text = (() => { try { return readFileSync(rec, 'utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); } catch { return ''; } })();
    token = (TOKEN_RE.exec(text) || [''])[0];
  } finally { rmSync(dir, { recursive: true, force: true }); }

  let ok = token ? check(claude, token, env) : 'no token found';
  while (ok !== true) {
    if (token) console.log(`\nThat token didn't work (${ok}).`);
    console.log('\nCopy the token Claude showed above (it starts with sk-ant-oat01-).');
    token = await askHidden('Paste it here and press Return (nothing shows while you paste, that is normal): ');
    if (!token) { console.log('Nothing pasted. Run this again when ready.'); process.exit(1); }
    if (!TOKEN_RE.test(token)) { console.log('That is not a Claude token (it should start with sk-ant-oat01-).'); token = ''; continue; }
    console.log('Checking it...');
    ok = check(claude, token, env);
  }

  const file = tokenFile();
  mkdirSync(dirname(file), { recursive: true });
  const now = Date.now();
  writeFileSync(file, `${JSON.stringify({ token, createdAt: now, expiresAt: now + YEAR_MS, by: 'scripts/claude-login.mjs' }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  const until = new Date(now + YEAR_MS).toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', year: 'numeric' });
  console.log(`\nDone. Claude on the Mac is signed in until ${until}. The coach works again; nothing to restart.`);
  console.log('Training HQ reminds you 14 days before it runs out.\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
