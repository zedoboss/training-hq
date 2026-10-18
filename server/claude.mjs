// Claude on the Mac: the Claude Code that comes with the Claude app, run in print mode (no API key; brief section 7).
// runOnce() is one question, one answer, no tools, nothing saved: used for reading meal photos (6.2) and scale or
// scan screens later. The long-lived coach process (step 8) is launched the same way.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const MODELS = {
  fast: { model: 'claude-sonnet-5-5', effort: 'low', label: 'Sonnet 5.5 · low' },
  deep: { model: 'claude-opus-5-5', effort: 'high', label: 'Opus 5.5 · high' },
};

const numeric = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** The newest Claude Code inside the Claude app, or $CLAUDE_PATH, or null. */
export function findClaude(env = process.env) {
  if (env.CLAUDE_PATH && existsSync(env.CLAUDE_PATH)) return env.CLAUDE_PATH;
  const root = join(env.HOME || homedir(), 'Library', 'Application Support', 'Claude', 'claude-code');
  if (!existsSync(root)) return null;
  for (const ver of readdirSync(root).sort(numeric).reverse()) {
    let builds = [];
    try { builds = readdirSync(join(root, ver)).sort(numeric).reverse(); } catch { continue; }
    for (const build of builds) {
      const p = join(root, ver, build, 'claude.app', 'Contents', 'MacOS', 'claude');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** The text of the first JSON object in an answer (code fences and words around it are ignored). */
export function parseJsonAnswer(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no JSON in the answer');
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('unfinished JSON in the answer');
}

/**
 * One turn with Claude Code. content: a string, or message content blocks (text and base64 images).
 * Resolves to {text, model, ms}; rejects with a plain message (not found, not logged in, timed out, ...).
 */
export function runOnce({ system, content, model = MODELS.fast.model, effort = MODELS.fast.effort, timeoutMs = 120000, claude = findClaude() }) {
  return new Promise((resolve, reject) => {
    if (!claude) { reject(new Error('Claude Code was not found on the Mac (open the Claude app once)')); return; }
    const started = Date.now();
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort,
      '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--system-prompt', system];
    let child;
    try {
      child = spawn(claude, args, { cwd: tmpdir(), env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { reject(new Error(`Claude Code could not start: ${e.message}`)); return; }
    let out = ''; let err = ''; let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* gone */ } fn(v); };
    const timer = setTimeout(() => finish(reject, new Error(`Claude did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    child.stdout.on('data', (d) => {
      out += d;
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl); out = out.slice(nl + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type !== 'result') continue;
        if (msg.is_error || msg.subtype !== 'success') {
          const why = String(msg.result || msg.subtype || 'error');
          finish(reject, new Error(/log ?in|auth/i.test(why) ? 'Claude Code on the Mac is not logged in' : `Claude answered with an error: ${why.slice(0, 200)}`));
        } else finish(resolve, { text: String(msg.result ?? ''), model, ms: Date.now() - started });
      }
    });
    child.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    child.on('error', (e) => finish(reject, new Error(`Claude Code could not start: ${e.message}`)));
    child.on('close', (code) => finish(reject, new Error(`Claude Code stopped (${code})${err.trim() ? `: ${err.trim().split('\n').pop().slice(0, 200)}` : ''}`)));
    const message = { type: 'user', message: { role: 'user', content: typeof content === 'string' ? content : content } };
    child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

/** A base64 image block for runOnce from a data: URL. */
export function imageBlock(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('not an image');
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}
