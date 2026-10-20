// The coach's Claude (8.1): the Claude Code that comes with the Claude app, run as ONE long-lived process in print
// mode with stream-json in and out and partial messages, its own system prompt, a model and an effort flag, every
// built-in tool switched off and the coach's own tools from the local MCP server (brief section 7; the same launch as
// the celestial-globe plugin, reference/reference-implementation-notes.md). One message at a time: the next waits in a
// queue. A different model, or a changed system prompt, restarts the process before the next turn (the conversation
// is lost then; the coach layer hands the new process a recap). Idle for an hour: stopped, started again on demand.
import { spawn as nodeSpawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { findClaude, COACH_MODELS as MODELS } from '../claude.mjs';

export const TURN_TIMEOUT_MS = { fast: 180000, deep: 420000 };
export const IDLE_MS = 60 * 60000;
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The command line, exactly as the reference launches it (no web search here: the coach has only its own tools). */
export function coachArgs({ system, mcpUrl, model, effort }) {
  return ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages',
    '--system-prompt', system,
    '--mcp-config', JSON.stringify({ mcpServers: { thq: { type: 'http', url: mcpUrl } } }), '--strict-mcp-config',
    '--setting-sources', '', '--allowedTools', 'mcp__thq', '--tools', '',
    '--model', model, '--effort', effort, '--no-session-persistence'];
}

const plainError = (why) => (/log ?in|auth|credential/i.test(why) ? 'Claude Code on the Mac is not logged in. Open the Claude app on the Mac once.' : `Claude answered with an error: ${String(why).slice(0, 200)}`);

/**
 * @param {object} o
 * @param {() => string} o.system      the system prompt (read before every turn; a change restarts the process)
 * @param {() => string} o.mcpUrl      the local MCP server's address
 * @param {() => string|null} [o.claude]  path of Claude Code (null: not installed)
 * @param {typeof nodeSpawn} [o.spawn]  tests pass a fake
 */
export function openCoachProcess({ system, mcpUrl, claude = findClaude, spawn = nodeSpawn, log = () => {}, now = () => Date.now(), idleMs = IDLE_MS, timeouts = TURN_TIMEOUT_MS }) {
  let child = null;          // {proc, key, model, sysHash, startedAt, turns, buf, err, exited}
  let current = null;        // the turn in flight: {resolve, reject, onEvent, text, timer, started, child}
  let queue = Promise.resolve();
  let idleTimer = null;
  let lastUsed = 0;

  const kill = (why) => {
    if (!child) return;
    const c = child; child = null;
    log(`coach: stopping Claude (${why})`);
    try { c.proc.stdin.end(); } catch { /* gone */ }
    try { c.proc.kill(); } catch { /* gone */ }
  };

  const failTurn = (err) => {
    if (!current) return;
    const t = current; current = null;
    clearTimeout(t.timer);
    t.reject(err);
  };

  function onLine(c, line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (c !== child || !current) return;
    const t = current;
    if (msg.type === 'stream_event') {
      const ev = msg.event || {};
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
        if (t.text) { t.text += '\n\n'; t.onEvent({ type: 'text', delta: '\n\n' }); }
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        t.text += ev.delta.text;
        t.onEvent({ type: 'text', delta: ev.delta.text });
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        t.onEvent({ type: 'tool-start', name: String(ev.content_block.name || '').replace(/^mcp__thq__/, '') });
      }
      return;
    }
    if (msg.type !== 'result') return;
    current = null;
    clearTimeout(t.timer);
    c.turns++;
    if (msg.is_error || msg.subtype !== 'success') {
      const why = String(msg.result || (msg.errors || []).join('; ') || msg.subtype || 'error');
      if (/log ?in|auth|credential/i.test(why)) kill('not logged in');
      t.reject(new Error(plainError(why)));
      return;
    }
    // The streamed text is what he saw; the result's own text is the fallback when no deltas came.
    const text = (t.text || String(msg.result ?? '')).trim();
    t.resolve({ text, ms: now() - t.started, model: c.model, usage: msg.usage || null, cost: msg.total_cost_usd ?? null });
  }

  function start(key) {
    const path = claude();
    if (!path) throw new Error('Claude Code was not found on the Mac. Open the Claude app once.');
    const m = MODELS[key] || MODELS.fast;
    const sys = system();
    const proc = spawn(path, coachArgs({ system: sys, mcpUrl: mcpUrl(), model: m.model, effort: m.effort }), {
      cwd: tmpdir(), env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const c = { proc, key, model: m.model, sysHash: sha(sys), startedAt: now(), turns: 0, buf: '', err: '' };
    child = c;
    proc.stdout.setEncoding?.('utf8');
    proc.stdout.on('data', (d) => {
      c.buf += d;
      let nl;
      while ((nl = c.buf.indexOf('\n')) >= 0) { const line = c.buf.slice(0, nl); c.buf = c.buf.slice(nl + 1); if (line.trim()) onLine(c, line); }
    });
    proc.stderr.on('data', (d) => { c.err = (c.err + d).slice(-4000); });
    proc.stdin.on?.('error', () => { /* the process went away; 'close' reports it */ });
    const gone = (why) => {
      if (child === c) child = null;
      if (current?.child === c) failTurn(new Error(`Claude Code stopped (${why})${c.err.trim() ? `: ${c.err.trim().split('\n').pop().slice(0, 200)}` : ''}`));
    };
    proc.on('error', (e) => gone(e.message));
    proc.on('close', (code) => gone(code ?? 'closed'));
    log(`coach: Claude started (${m.label})`);
    return c;
  }

  function ensure(key) {
    const sysHash = sha(system());
    if (child && (child.key !== key || child.sysHash !== sysHash)) kill(child.key !== key ? `switching to ${MODELS[key]?.label || key}` : 'system prompt changed');
    return child || start(key);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!current && now() - lastUsed >= idleMs - 1000) kill('idle'); }, idleMs);
    idleTimer.unref?.();
  }

  /**
   * One turn. content: a string, message content blocks, or ({fresh}) => either, worked out when the turn starts
   * (fresh: this process has no conversation yet). Resolves {text, ms, model}; rejects with a plain message.
   * onEvent receives {type:'text', delta} and {type:'tool-start', name} while it runs.
   */
  function turn({ content, model = 'fast', onEvent = () => {} }) {
    const run = () => new Promise((resolve, reject) => {
      let c;
      try { c = ensure(MODELS[model] ? model : 'fast'); } catch (e) { reject(e); return; }
      lastUsed = now();
      const ms = timeouts[c.key] || TURN_TIMEOUT_MS.fast;
      current = { resolve, reject, onEvent, text: '', started: now(), timer: null, child: c };
      current.timer = setTimeout(() => { kill('no answer in time'); failTurn(new Error(`Claude did not answer within ${Math.round(ms / 1000)} s`)); }, ms);
      current.timer.unref?.();
      try {
        const body = typeof content === 'function' ? content({ fresh: c.turns === 0, model: c.key }) : content;
        c.proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: body } })}\n`);
      } catch (e) { failTurn(new Error(`Claude Code could not take the message: ${e.message}`)); }
    }).finally(() => { lastUsed = now(); armIdle(); });
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  return {
    turn,
    /** Start the process ahead of the first message (opening the chat), without a turn. */
    warm(model = 'fast') { try { if (!current) ensure(MODELS[model] ? model : 'fast'); armIdle(); return true; } catch { return false; } },
    /** Stop now: the turn in flight ends with "stopped"; the next message starts a fresh process. */
    stop(why = 'stopped') { const busy = !!current; kill(why); failTurn(new Error('Stopped.')); return busy; },
    /** Will the next turn start a fresh process (no conversation yet)? */
    fresh: (model = 'fast') => !child || child.key !== model || child.turns === 0 || child.sysHash !== sha(system()),
    status: () => ({ running: !!child, model: child?.key ?? null, label: child ? (MODELS[child.key]?.label ?? null) : null, busy: !!current, turns: child?.turns ?? 0, startedAt: child?.startedAt ?? null }),
    close() { clearTimeout(idleTimer); kill('server stopping'); failTurn(new Error('Stopped.')); },
  };
}
