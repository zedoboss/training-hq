#!/usr/bin/env node
// The builder's guard (Thu 10/22, coach changes): Claude Code runs this before every tool call of a builder chat
// (a PreToolUse hook, see changes.mjs). It refuses what the builder must never do: write outside the code repo and
// the private folder, touch the read-only folders, read or print the private config (keys), write the real database,
// restart the real server or force-push. Exit code 2 refuses the call and tells the builder why. A guard, not a
// sandbox: the builder's own instructions say the same.
// Usage: node change-guard.mjs <codeDir> <privateDir>, with the hook's JSON on stdin.
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const READ_ONLY = ['Celestial Vault', 'gods-eye-view', '.celestial-globe'];

const under = (p, dir) => { const a = resolve(p); const d = resolve(dir); return a === d || a.startsWith(d + sep); };

/** Why this tool call is refused, or '' when it may run. */
export function refusal({ tool_name: tool, tool_input: input = {}, cwd = '' }, { codeDir, privateDir, home = homedir() }) {
  const config = resolve(privateDir, 'config');
  const file = input.file_path || input.notebook_path || input.path || '';
  const abs = file ? resolve(cwd || privateDir, String(file).replace(/^~(?=\/)/, home)) : '';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    if (!abs) return '';
    if (READ_ONLY.some((x) => abs.includes(x))) return `Read only, never modify: ${READ_ONLY.join(', ')}.`;
    if (under(abs, config)) return 'The private config holds keys: never write it.';
    if (/training-hq\.sqlite/.test(abs)) return 'Never write the real database.';
    if (abs === resolve(privateDir, 'BRIEF.md')) return 'BRIEF.md is his; never edit it.';
    if (!under(abs, codeDir) && !under(abs, privateDir) && !/^\/(private\/)?tmp\//.test(abs) && !abs.includes(`${sep}scratchpad${sep}`)) return `Write only in ${codeDir}, ${privateDir} or a temporary folder.`;
    return '';
  }
  if (['Read', 'Grep', 'Glob'].includes(tool)) {
    if (abs && under(abs, config)) return 'The private config holds keys: never read it.';
    return '';
  }
  if (tool === 'Bash') {
    const cmd = String(input.command || '');
    if (READ_ONLY.some((x) => cmd.includes(x))) return `Leave ${READ_ONLY.join(', ')} alone.`;
    if (cmd.includes(config) || cmd.includes('training-hq-private/config') || /(^|[\s'"=(;&|])\.?\/?config\//.test(cmd) || /elevenlabs\.json|vapid\.json/.test(cmd)) return 'The private config holds keys: never read, print or copy it.';
    if (/\blaunchctl\b|\bpkill\b|\bkillall\b/.test(cmd)) return 'Never restart or stop the real server: it restarts itself after you finish when your answer says "reload". Stop a dev copy with lsof and kill <pid>.';
    if (/training-hq\.sqlite/.test(cmd) && !/-readonly|\bcp\b|\.backup/.test(cmd) && !/devprivate|scratch|\/tmp\//.test(cmd)) return 'Never write the real database (sqlite3 -readonly to look).';
    if (/\bgit\s+push\b[^\n;&|]*(\s-f\b|--force|\s\+\w)/.test(cmd)) return 'Never force-push.';
    return '';
  }
  return '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [codeDir, privateDir] = process.argv.slice(2);
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const why = codeDir && privateDir ? refusal(input, { codeDir, privateDir }) : '';
  if (why) { process.stderr.write(`Refused by the coach-change guard: ${why}\n`); process.exit(2); }
  process.exit(0);
}
