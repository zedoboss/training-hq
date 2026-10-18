// The coach on the Mac (step 8): one conversation, shared by the phone and the Mac's browser. Every message is a
// record in 'coach-messages' (written by the Mac only), so both devices show the same chat after a sync and a reply
// is never lost when the phone drops off half-way: the turn runs to the end on the Mac and is saved there.
// A turn: his words plus the current time (and, for a fresh Claude process, a recap of the recent conversation) go
// to the long-lived Claude Code process; its tool calls arrive through the local MCP server and run here, against
// the Mac's database; the reply streams back as events. Things only the phone can do (start its rest timer, sync,
// open a screen) travel to the phone as 'action' events and are kept with the reply.
import { randomBytes } from 'node:crypto';
import { openCoachProcess } from './process.mjs';
import { openMcp } from './mcp.mjs';
import { systemPrompt, turnText, recapText } from './prompt.mjs';
import { MODELS } from '../claude.mjs';
import { deviceTimeZone } from '../../app/js/lib/time.js';

export const COL = 'coach-messages';
export const MAX_TEXT = 4000;
export const RECAP_MESSAGES = 16;

const rand = () => randomBytes(3).toString('hex');
export const messageId = (at) => `cm.${String(at).padStart(13, '0')}.${rand()}`;

/** Messages of the current conversation (after the last "new conversation" marker), oldest first. */
export function conversation(store) {
  const all = store.listRecords(COL).map((r) => r.data).filter(Boolean).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  let from = 0;
  all.forEach((m, i) => { if (m.role === 'marker') from = i + 1; });
  return all.slice(from);
}

/**
 * @param {object} o
 * @param {ReturnType<import('../store.mjs').openStore>} o.store
 * @param {Array} o.tools          tool definitions (tools.mjs)
 * @param {() => string} [o.profile] his own profile text (private folder)
 * @param {(o: {store, tz, now}) => string} [o.context] today's state for the context block of every message
 * @param {object} [o.process]     a process from openCoachProcess (tests pass a fake)
 */
export function openCoach({ store, tools = [], profile = () => '', context = null, process = null, log = () => {}, now = () => Date.now(), tz = deviceTimeZone() }) {
  let active = null; // the turn whose tool calls are arriving now (one at a time)

  const mcp = openMcp({ tools, log, onCall: (tool, args) => callTool(tool, args) });
  const proc = process || openCoachProcess({ system: () => systemPrompt({ profile: profile() }), mcpUrl: () => mcp.url(), log, now });

  const save = (m) => { store.writeLocal(COL, m.id, m); return m; };

  async function callTool(tool, args) {
    const t = active;
    const ctx = {
      store, now, tz: t?.tz || tz, deviceId: t?.deviceId || null, turnId: t?.turnId || null,
      /** Something only the phone can do: sent to it now and kept with the reply. */
      action(a) { if (!t) return; t.actions.push(a); t.emit({ type: 'action', action: a }); },
    };
    const started = now();
    let out;
    try {
      const r = await tool.run(args, ctx);
      out = typeof r === 'string' ? { text: r } : (r || { text: '' });
    } catch (e) {
      log(`coach tool ${tool.name}: ${e.stack || e}`);
      out = { text: `Error: ${e.message}`, isError: true };
    }
    const entry = { name: tool.name, title: tool.title, summary: String(out.summary || (out.isError ? out.text : '') || '').slice(0, 160), ok: !out.isError, ms: now() - started, wrote: !!out.wrote };
    if (t) {
      t.tools.push(entry);
      t.emit({ type: 'tool', tool: entry });
      // A tool changed his data on the Mac: the phone pulls it now rather than at its next sync.
      if (out.wrote && !t.actions.some((a) => a.kind === 'sync')) ctx.action({ kind: 'sync' });
    }
    log(`coach tool ${tool.name} ${JSON.stringify(args).slice(0, 200)} -> ${out.isError ? 'error' : 'ok'} (${entry.ms} ms)`);
    return out;
  }

  /**
   * Send one message and wait for the reply. emit receives: {type:'user', message}, {type:'text', delta},
   * {type:'tool-start', name}, {type:'tool', tool}, {type:'action', action}, {type:'done', message}.
   */
  async function send({ text, model = 'fast', deviceId = null, tz: tzIn = null, emit = () => {} }) {
    const words = String(text ?? '').trim().slice(0, MAX_TEXT);
    if (!words) throw new Error('Nothing to send.');
    const key = MODELS[model] ? model : 'fast';
    const zone = tzIn || tz;
    const at = now();
    const turnId = `turn.${at.toString(36)}.${rand()}`;
    const earlier = conversation(store);
    const userMsg = save({ id: messageId(at), role: 'user', text: words, at, device: deviceId, turnId, model: key });
    emit({ type: 'user', message: userMsg });
    const t = { turnId, tz: zone, deviceId, tools: [], actions: [], emit };
    let reply;
    try {
      const res = await proc.turn({
        model: key,
        onEvent: (e) => emit(e),
        content: ({ fresh }) => {
          active = t;
          const recap = fresh ? recapText(earlier.slice(-RECAP_MESSAGES)) : '';
          let extra = '';
          try { extra = context ? context({ store, tz: zone, now: now() }) : ''; } catch (e) { log(`coach context: ${e.stack || e}`); }
          return turnText({ text: words, now: now(), tz: zone, recap, extra });
        },
      });
      reply = { role: 'assistant', text: res.text || '(no answer)', model: key, ms: res.ms };
    } catch (e) {
      reply = { role: 'assistant', text: e.message, error: true, model: key };
    } finally {
      if (active === t) active = null;
    }
    const doneAt = now();
    const msg = save({ id: messageId(Math.max(doneAt, at + 1)), at: Math.max(doneAt, at + 1), turnId, tools: t.tools, actions: t.actions, ...reply });
    emit({ type: 'done', message: msg });
    return msg;
  }

  return {
    send,
    ready: mcp.ready,
    warm: (model = 'fast') => proc.warm(MODELS[model] ? model : 'fast'),
    stop: () => proc.stop('stopped from the app'),
    /** A new conversation: the process starts over and earlier messages stay in the log, out of the recap. */
    newConversation() {
      proc.stop('new conversation');
      const at = now();
      return save({ id: messageId(at), role: 'marker', text: 'New conversation', at });
    },
    status: () => ({ ...proc.status(), models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, m.label])) }),
    close: async () => { proc.close(); await mcp.close(); },
    _callTool: callTool,
  };
}
