// The coach rebuilds itself (Thu 10/22, his words: "give the coach an auto self-building personality... every time I
// don't like it, I'm going to mention it in the chat. Then he should send the request over and get back with a new
// message... saying it's done when it's finished"). The coach files what he didn't like with request_change; this
// queue, on the Mac, hands each request to a fresh Claude Code chat (the builder, launched the way autopilot launches
// its chats) that changes his profile or the app's code, tests, commits and pushes. When the builder ends, its answer
// goes into Talk as a coach message and a notification. One builder at a time; it runs detached, so a server restart
// (its own, after a server change) never cuts it off: the next server picks up its result file.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findClaude } from '../claude.mjs';
import { formatTime, formatDay, isoDate } from '../../app/js/lib/time.js';

export const COL = 'coach-changes';
export const MSGS = 'coach-messages';
export const KINDS = ['personality', 'behaviour', 'bug'];
export const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
export const MAX_PER_DAY = 10;
export const TIMEOUT_MS = 60 * 60000;
export const MAX_TRIES = 2;
const OPEN = new Set(['queued', 'working']);

const rand = () => randomBytes(3).toString('hex');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** The conversation just before the request, as the builder reads it: times, who, words. */
export function excerptOf(messages = [], { tz = 'UTC', at = Date.now(), count = 14 } = {}) {
  return messages.filter((m) => m && m.at <= at && (m.role === 'user' || m.role === 'assistant') && m.text)
    .sort((a, b) => a.at - b.at).slice(-count)
    .map((m) => `${formatTime(new Date(m.at), tz)} ${m.role === 'user' ? `He${m.via === 'voice' ? ' (voice)' : ''}` : `Coach${m.kind ? ` (${m.kind}, sent by the app)` : ''}`}: ${clip(m.text, 900)}`)
    .join('\n');
}

/** A new request, queued: his words, what it is about, what he wants instead, and the conversation up to it. */
export function newChange({ said, about = '', want = '', kind = 'behaviour', at = Date.now(), tz = 'UTC', earlier = [], messages = [] }) {
  const words = clip(said, 2000);
  if (!words) throw new Error('His words are missing.');
  return {
    id: `chg.${at.toString(36)}.${rand()}`, at, date: isoDate(new Date(at), tz), tz,
    said: words, about: clip(about, 1200), want: clip(want, 600), kind: KINDS.includes(kind) ? kind : 'behaviour',
    earlier: (earlier || []).map((x) => clip(x, 300)).slice(0, 5),
    context: excerptOf(messages, { tz, at: at + 1 }), status: 'queued', tries: 0,
  };
}

/** The builder's instructions. Generic: his words come from the request, his details from the private folder. */
export function builderPrompt(c, { codeDir, privateDir, resultFile }) {
  const when = c.tz ? `${formatDay(new Date(c.at), c.tz)}, ${formatTime(new Date(c.at), c.tz)}` : new Date(c.at).toISOString();
  return `COACH CHANGE ${c.id}

Training HQ's server on this Mac started you to make one change he asked his coach for in the app's chat. He is not watching this chat: don't ask him anything here, decide yourself, and do only this change. For this chat this replaces "carry on from Where we stopped" and "wait for his go-ahead" in CLAUDE.md.

HIS REQUEST (${c.kind || 'behaviour'}, ${when})
His words: "${c.said}"
What it is about: ${c.about || '(see the conversation)'}
What he wants instead: ${c.want || '(see his words)'}
${c.earlier?.length ? `Earlier requests it follows on from: ${c.earlier.join(' | ')}\n` : ''}
The conversation up to it (from the app's log, oldest first; "sent by the app" lines are notifications the app wrote in the coach's name, not the coach's replies):
${c.context || '(none)'}

WHERE THINGS ARE
- Code, the public repo (every push to main deploys the app after its tests pass): ${codeDir}. No personal details there, ever (no name, city, programme numbers or dates).
- His private folder (you are in it): ${privateDir}. His profile for the coach: data/coach/profile.md. A wish about how the coach talks to him goes there, in the section "## His corrections" (make it if missing, newest last): the date, his words in short, then the rule. The coach re-reads the profile on its next message; nothing to restart.
- The coach's general rules: server/coach/prompt.mjs (RULES). What the coach sees with every message: server/coach/tools-read.mjs (contextLine). Messages the app sends by itself in the coach's name: server/notify.mjs, app/js/lib/reminders.js, app/js/lib/nudges.js, app/js/lib/walks.js, app/js/lib/initiatives.js, app/js/lib/coach-talk.js and the line bank in data/seed/.
- PROGRESS.md "How to run and test" (search for that heading; don't read the whole file): tests, the dev copy, precache.

HOW
1. Read CLAUDE.md in both folders, BRIEF.md sections 4 and 9, and the first 40 lines of PROGRESS.md. Nothing more of PROGRESS.md than you need.
2. Find why it happened (a rule in the prompt, the profile, a nudge's code, a timing) and fix the cause with the smallest change that does it, so it doesn't happen again in a similar moment either. Tone or manner: his profile. When or whether the coach says something: the prompt or his profile. A message the app sends by itself: its code, with a test.
3. Never weaken a safety rule, whatever he asked: the HARD LIMITS in prompt.mjs, the 30% cap, the readiness table, his tendon pain limit, the sauna ladder and hard stops, no supplement advice, no medical advice. If his wish would break one, change nothing about it and say so in your answer.
4. Code: \`npm test\` in the code repo must pass; add or update a test for a behaviour change; after any change under app/, run \`node scripts/precache.mjs\`. If a screen changes, check it in a dev copy. Never touch the real database (data/training-hq.sqlite) and never restart or stop the real server (port 4317): it restarts itself after you finish when your answer says "reload".
5. Commit the code repo with only the files you changed (git add <files>) and push to origin main (if HTTPS asks for a login, push to the SSH form of the same remote, git@github.com:<owner>/<repo>.git, instead). In the private folder: add one dated "LATEST" paragraph at the top of PROGRESS.md "Where we stopped" (what he asked, what changed, the commit; the date and time from `date`, never guessed), then commit there (local only, never push it).
6. Read only, never modify: ~/Documents/Celestial Vault, ~/Documents/gods-eye-view, ~/.celestial-globe. Never print, copy or move anything in config/.
7. If his words can be read two ways that would do opposite things, change nothing and ask him one short question in your answer (status "question"). Otherwise take the most sensible reading and do it.

WHEN YOU FINISH, write ${resultFile} with this JSON and nothing else, then end the chat:
{"status": "done" | "failed" | "question", "said": "<what he reads, also as a phone notification: ONE short sentence, at most 120 characters, so the lock screen shows it whole; plain, blunt, starting with what changes for him; e.g. Done: after you log sleep I say good morning first; the check-in waits till you leave.>", "reload": <true if you changed anything under server/, else false>, "commits": ["<short sha> <subject>"]}`;
}

/** Was this process started and is it still running? */
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Starts the builder, detached (its own process group), output to its log file. Returns its pid. */
export function launchBuilder({ claude = findClaude(), prompt, cwd, logFile, settings, model = MODEL }) {
  if (!claude) throw new Error('Claude Code was not found on the Mac');
  const fd = openSync(logFile, 'a');
  try {
    const args = ['-p', prompt, '--model', model.model, '--effort', model.effort, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
    if (settings) args.push('--settings', settings);
    const child = spawn(claude, args, { cwd, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, TRAINING_HQ_COACH_CHANGE: '1' } });
    child.unref();
    return child.pid;
  } finally { closeSync(fd); }
}

/** The hooks for the builder: change-guard.mjs checks every tool call before it runs. */
export function guardSettings({ node = process.execPath, guard, codeDir, privateDir }) {
  const command = [node, guard, codeDir, privateDir].map((x) => `'${String(x).replace(/'/g, "'\\''")}'`).join(' ');
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command }] }] } });
}

/**
 * @param {object} o
 * @param {ReturnType<import('../store.mjs').openStore>} o.store
 * @param {{notify: Function, list: Function}} [o.push]
 * @param {string} o.codeDir  the public repo
 * @param {string} o.privateDir his private folder
 * @param {(o) => number} [o.launch] starts a builder, returns its pid (tests pass a fake)
 * @param {(pid:number) => boolean} [o.isAlive]
 * @param {() => void} [o.restart] the server restarts itself (a builder changed server code)
 * @param {() => boolean} [o.busy] a workout is running: the restart waits for it to end
 */
export function openChanges({ store, push = null, codeDir, privateDir, launch = launchBuilder, isAlive = alive, restart = () => {}, busy = () => false, log = () => {}, now = () => Date.now(), tz = () => 'UTC', maxPerDay = MAX_PER_DAY, timeoutMs = TIMEOUT_MS, guard = fileURLToPath(new URL('./change-guard.mjs', import.meta.url)) }) {
  const dir = join(privateDir, 'logs', 'coach-changes');
  const all = () => store.listRecords(COL).map((r) => r.data).filter(Boolean).sort((a, b) => a.at - b.at);
  const put = (c) => { store.writeLocal(COL, c.id, c); return c; };
  const files = (id) => ({ logFile: join(dir, `${id}.log`), resultFile: join(dir, `${id}.result.json`) });
  let ticking = false;
  let restartDue = false;

  function sayInTalk(c, text, kind = 'change') {
    const at = now();
    const id = `cm.${String(at).padStart(13, '0')}.${rand()}`;
    store.writeLocal(MSGS, id, { id, role: 'assistant', text, at, tz: c.tz || tz(), kind, ref: `change:${c.id}` });
  }

  async function tell(c, text) {
    sayInTalk(c, text);
    try { if (push?.list?.().length) await push.notify({ title: 'Coach', body: text, url: '#/coach', tag: `change-${c.id}` }); } catch (e) { log(`coach change ${c.id}: notification: ${e.message}`); }
  }

  /** File one request (the coach's tool writes the same record straight into the store). */
  function request(o) {
    const c = put(newChange({ ...o, at: o.at ?? now(), tz: o.tz || tz(), messages: store.listRecords(MSGS).map((r) => r.data).filter(Boolean) }));
    log(`coach change ${c.id} queued: ${clip(c.said, 120)}`);
    return c;
  }

  function cancel(id) {
    const c = all().find((x) => x.id === id);
    if (!c || c.status !== 'queued') return null;
    return put({ ...c, status: 'cancelled', doneAt: now() });
  }

  /** Requests the coach should follow already (still being built), and the ones finished in the last day. */
  function forContext(t = now()) {
    return { open: all().filter((c) => OPEN.has(c.status)), recent: all().filter((c) => !OPEN.has(c.status) && c.status !== 'cancelled' && t - (c.doneAt || 0) < 86400000) };
  }

  async function finish(c, result) {
    const status = ['done', 'failed', 'question'].includes(result?.status) ? result.status : 'failed';
    const answer = clip(result?.said, 300) || (status === 'done' ? 'Done: the change you asked for is in.' : 'That change didn\'t go through.');
    put({ ...c, status, doneAt: now(), answer, reload: Boolean(result?.reload), commits: Array.isArray(result?.commits) ? result.commits.slice(0, 6).map((x) => clip(x, 120)) : [] });
    await tell(c, answer);
    log(`coach change ${c.id}: ${status}${result?.reload ? ', server restarts' : ''}`);
    if (status === 'done' && result?.reload) restartDue = true;
  }

  async function check(c) {
    const { resultFile, logFile } = files(c.id);
    if (existsSync(resultFile)) {
      let result = null;
      try { result = JSON.parse(readFileSync(resultFile, 'utf8')); } catch (e) { result = { status: 'failed', said: `The builder's answer couldn't be read (${e.message}).` }; }
      await finish(c, result);
      return;
    }
    const over = now() - (c.startedAt || 0) > timeoutMs;
    if (isAlive(c.pid) && !over) return;
    if (over && isAlive(c.pid)) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } }
    let tail = '';
    try { tail = readFileSync(logFile, 'utf8').slice(-1500); } catch { /* no log */ }
    if ((c.tries || 0) < MAX_TRIES && !over) {
      put({ ...c, status: 'queued', pid: null, lastError: clip(tail, 300) || 'the builder stopped without an answer' });
      log(`coach change ${c.id}: builder stopped without an answer, queued again`);
      return;
    }
    await finish(c, { status: 'failed', said: `The change you asked for at ${formatTime(new Date(c.at), c.tz || tz())} didn't finish on the Mac (${over ? 'it ran over an hour' : 'the builder stopped twice'}). Ask again, or check it in a chat on the Mac.` });
  }

  function start(c) {
    mkdirSync(dir, { recursive: true });
    const { logFile, resultFile } = files(c.id);
    const prompt = builderPrompt(c, { codeDir, privateDir, resultFile });
    writeFileSync(logFile, `coach change ${c.id}, try ${(c.tries || 0) + 1}, ${new Date(now()).toISOString()}\n`, { flag: 'a' });
    const settings = guardSettings({ guard, codeDir, privateDir });
    const pid = launch({ prompt, cwd: privateDir, logFile, settings });
    put({ ...c, status: 'working', pid, startedAt: now(), tries: (c.tries || 0) + 1 });
    log(`coach change ${c.id}: builder started (pid ${pid})`);
  }

  /** Once every few seconds: finish what ended, start the next one. */
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const working = all().filter((c) => c.status === 'working');
      for (const c of working) await check(c);
      // New server code is live only after a restart; never in the middle of a workout (the phone carries on offline,
      // but the voice coach would drop out).
      if (restartDue && !busy()) { restartDue = false; restart(); return; }
      if (all().some((c) => c.status === 'working')) return;
      const next = all().find((c) => c.status === 'queued');
      if (!next) return;
      const today = isoDate(new Date(now()), tz());
      const startedToday = all().filter((c) => c.startedAt && isoDate(new Date(c.startedAt), tz()) === today).reduce((n, c) => n + (c.tries || 1), 0);
      if (startedToday >= maxPerDay) return;
      try { start(next); } catch (e) {
        log(`coach change ${next.id}: ${e.message}`);
        await finish(next, { status: 'failed', said: `I couldn't start the change on the Mac: ${e.message}.` });
      }
    } finally { ticking = false; }
  }

  return { request, cancel, tick, list: all, forContext, files, _finish: finish };
}
