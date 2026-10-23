// The coach rebuilds itself (Thu 10/22, his words: "give the coach an auto self-building personality... every time I
// don't like it, I'm going to mention it in the chat. Then he should send the request over and get back with a new
// message... saying it's done when it's finished"). The coach files what he didn't like with request_change; this
// queue, on the Mac, hands each request to a fresh Claude Code chat (the builder, launched the way autopilot launches
// its chats) that changes his profile or the app's code, tests, commits and pushes. A second chat (the reviewer)
// then checks the build against all his words before he hears "done" (Thu 10/22, 4:37 PM: "make it as smart as
// possible... no mistakes"). When it ends, the answer goes into Talk as a coach message and a notification. One build
// at a time; builders and reviewers run detached, so a server restart (its own, after a server change) never cuts
// them off: the next server picks up their result files.
//
// One wish = one request (Thu 10/22: a correction became a second build, "double check" a third). A record keeps
// every ask in order (asks: [{at, said, want, about, kind: ask|amend|verify|review}]): his corrections are merged into a
// queued request, a request being built gets them while it works (Fri 10/23, his words: "So I can add more details to
// the same task": change-more.mjs hands them to the running builder or reviewer; words that come after it ended get
// a correcting request right after it, corrects), "double check" sets verify on an open one or queues a check of a
// finished one (kind 'check', checkOf).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findClaude } from '../claude.mjs';
import { seenCount, addedAsks } from './change-more.mjs';
import { formatTime, formatDay, isoDate } from '../../app/js/lib/time.js';

export const COL = 'coach-changes';
export const MSGS = 'coach-messages';
export const KINDS = ['personality', 'behaviour', 'bug'];
/** 'check': he asked to double-check a finished change (verify on a done one). */
export const ALL_KINDS = [...KINDS, 'check'];
export const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
export const REVIEW_MODEL = { model: 'claude-opus-5-5', effort: 'medium' };
export const TIMEOUT_MS = 60 * 60000;
export const REVIEW_TIMEOUT_MS = 30 * 60000;
export const MAX_TRIES = 2;
/**
 * A build doesn't start while the code or his private folder has unsaved edits (Thu 10/22: Claude in a chat on the Mac
 * may be mid-change; a builder would test, commit or push half of it). It waits, at most this long.
 */
export const EDITS_WAIT_MS = 45 * 60000;
/** A new request while another is open or finished this recently must say how it relates (amends, verify, separate). */
export const RELATED_MS = 60 * 60000;
/** How long a build takes when there are none to measure yet. */
export const DEFAULT_BUILD_MS = 6 * 60000;
const OPEN = new Set(['queued', 'working']);
const FINISHED = new Set(['done', 'failed', 'question']);
export const isOpen = (c) => OPEN.has(c?.status);
export const isFinished = (c) => FINISHED.has(c?.status);

const rand = () => randomBytes(3).toString('hex');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** The conversation just before the request, as the builder reads it: times, who, words. */
export function excerptOf(messages = [], { tz = 'UTC', at = Date.now(), count = 14 } = {}) {
  return messages.filter((m) => m && m.at <= at && (m.role === 'user' || m.role === 'assistant') && m.text)
    .sort((a, b) => a.at - b.at).slice(-count)
    .map((m) => `${formatTime(new Date(m.at), tz)} ${m.role === 'user' ? `He${m.via === 'voice' ? ' (voice)' : ''}` : `Coach${m.kind ? ` (${m.kind}, sent by the app)` : ''}`}: ${clip(m.text, 900)}`)
    .join('\n');
}

const askOf = ({ at, said, want = '', about = '', kind = 'ask' }) => ({ at, said: clip(said, 2000), want: clip(want, 600), about: clip(about, 1200), kind });

/** Every ask of a request, oldest first (records filed before Thu 10/22, 4:37 PM have only said/want/about). */
export const asksOf = (c) => (Array.isArray(c?.asks) && c.asks.length ? c.asks : c?.said ? [askOf({ at: c.at, said: c.said, want: c.want, about: c.about })] : []);
/** Where a queued request stands in line: its own time, or right after the one it corrects or fixes. */
export const lineAtOf = (c) => c.lineAt ?? c.at;

/**
 * A new request, queued: his words, what it is about, what he wants instead, and the conversation up to it.
 * asks: earlier asks it carries on from (a correction of a request being built, a check of a finished one).
 */
export function newChange({ said, about = '', want = '', kind = 'behaviour', at = Date.now(), tz = 'UTC', earlier = [], messages = [], asks = [], verify = false, auto = false, by = 'coach', corrects = null, checkOf = null, fixOf = null, followsOn = null, lineAt = null, review = null, quiet = false }) {
  const words = clip(said, 2000);
  if (!words) throw new Error('His words are missing.');
  const askKind = corrects ? 'amend' : checkOf ? 'verify' : fixOf ? 'review' : 'ask';
  return {
    id: `chg.${at.toString(36)}.${rand()}`, at, date: isoDate(new Date(at), tz), tz,
    said: words, about: clip(about, 1200), want: clip(want, 600), kind: ALL_KINDS.includes(kind) ? kind : 'behaviour',
    asks: [...(asks || []).map(askOf), askOf({ at, said: words, want, about, kind: askKind })],
    earlier: (earlier || []).map((x) => clip(x, 300)).slice(0, 5),
    context: excerptOf(messages, { tz, at: at + 1 }), status: 'queued', tries: 0,
    ...(verify ? { verify: true } : {}), ...(auto ? { auto: true } : {}), by,
    ...(corrects ? { corrects } : {}), ...(checkOf ? { checkOf } : {}), ...(fixOf ? { fixOf } : {}), ...(followsOn ? { followsOn } : {}),
    ...(lineAt != null ? { lineAt } : {}), ...(review ? { review } : {}), ...(quiet ? { quiet: true } : {}),
  };
}

/** More of his words for a request still waiting: same id, same place in line; the builder reads them all in order. */
export function amendChange(c, { said, want = '', about = '', at = Date.now(), messages = [], kind = 'amend' }) {
  return { ...c, asks: [...asksOf(c), askOf({ at, said, want, about, kind })], want: clip(want, 600) || c.want, context: excerptOf(messages, { tz: c.tz, at: at + 1 }), ...(kind === 'verify' ? { verify: true } : {}) };
}

// ---- line and time ------------------------------------------------------------------------------------------------

/** The median start-to-done time of the last 8 builds (review included), or 6 minutes. */
export function buildMs(all = []) {
  const d = all.filter((c) => c.status === 'done' && c.startedAt && c.doneAt > c.startedAt).sort((a, b) => b.doneAt - a.doneAt).slice(0, 8)
    .map((c) => c.doneAt - c.startedAt).sort((a, b) => a - b);
  if (!d.length) return DEFAULT_BUILD_MS;
  const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

/** The waiting requests in the order they start. */
export const lineOf = (all = []) => all.filter((c) => c.status === 'queued').sort((a, b) => lineAtOf(a) - lineAtOf(b) || a.at - b.at);

const minutes = (ms) => Math.max(1, Math.round(ms / 60000));
const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Where it stands, for the coach and him: "next in line, about 6 minutes", "building now, about 3 minutes left". */
export function whereText(c, all = [], now = Date.now()) {
  const med = buildMs(all);
  if (c.status === 'working') {
    if (c.stage === 'review') return 'built, being checked before he hears done';
    const left = med - (now - (c.startedAt || now));
    return left > 60000 ? `building now, about ${minutes(left)} minutes left` : 'building now, done any minute';
  }
  if (c.status !== 'queued') return c.status;
  const place = lineOf(all).findIndex((x) => x.id === c.id) + 1 || 1;
  const working = all.find((x) => x.status === 'working' && x.id !== c.id);
  const ahead = working ? Math.max(60000, med - (now - (working.startedAt || now))) : 0;
  const wait = c.waitingFor?.length ? ` (waiting: unsaved edits on the Mac in ${c.waitingFor.join(' and ')}, at most ${EDITS_WAIT_MS / 60000} minutes)` : '';
  return `${place === 1 ? 'next in line' : `${ordinal(place)} in line`}, about ${minutes(ahead + place * med)} minutes${wait}`;
}

/** Requests open, or finished in the last hour: a new one must say how it relates to these. */
export const relatedTo = (all = [], now = Date.now()) => all.filter((c) => isOpen(c) || (isFinished(c) && now - (c.doneAt || 0) < RELATED_MS));

// ---- the builder and the reviewer ---------------------------------------------------------------------------------

const ASK_LABEL = { ask: 'his request', amend: 'his correction', verify: 'he asked to double-check', review: 'the reviewer found' };

/** late: asks from this index on came after the builder had finished (the reviewer's prompt marks them). */
function wordsBlock(c, tz, late = Infinity) {
  const asks = asksOf(c);
  const t = (ms) => (tz ? formatTime(new Date(ms), tz) : new Date(ms).toISOString());
  if (asks.length <= 1) {
    return `His words: "${c.said}"\nWhat it is about: ${c.about || '(see the conversation)'}\nWhat he wants instead: ${c.want || '(see his words)'}`;
  }
  return `His words, in order (the latest wins where they differ):\n${asks.map((a, i) => `${i + 1}. ${t(a.at)}, ${ASK_LABEL[a.kind] || 'his words'}${i >= late ? ' (came after the builder had finished: if the build doesn\'t cover it, do it yourself)' : ''}: "${a.said}"${a.about ? `\n   What it is about: ${a.about}` : ''}${a.want ? `\n   What he wants: ${a.want}` : ''}`).join('\n')}`;
}

/** He may add words while a chat works on his request: they come in as a note after a tool call or when it tries to end. */
const LIVE_LINE = 'He may add more words while you work (Talk is open): they come in as a note starting "HE ADDED MORE TO THIS REQUEST" after a tool call or when you try to end. They are part of this request; work them in, the latest winning, and write the answer file again if the note says it was set aside.';

const refLine = (r, tz) => `${r.id} ("${clip(r.said, 200)}", ${r.status}${r.doneAt ? ` ${formatTime(new Date(r.doneAt), tz)}` : ''}${r.answer ? `: "${clip(r.answer, 200)}"` : ''}${r.commits?.length ? `; commits ${r.commits.join(', ')}` : ''})`;

/**
 * The builder's instructions. Generic: his words come from the request, his details from the private folder.
 * others: requests waiting (not this one); recent: finished in the last day; ref: the request it corrects, checks or
 * fixes.
 */
export function builderPrompt(c, { codeDir, privateDir, resultFile, others = [], recent = [], ref = null }) {
  const tz = c.tz || 'UTC';
  const when = c.tz ? `${formatDay(new Date(c.at), c.tz)}, ${formatTime(new Date(c.at), c.tz)}` : new Date(c.at).toISOString();
  const story = [
    c.kind === 'check' && ref ? `THIS IS A CHECK of change ${refLine(ref, tz)}. He asked to double-check it: test that it works the way he asked, end to end, in his real case; fix it if it doesn't. If it already works, change nothing and say so.` : '',
    c.corrects && ref ? `This corrects change ${refLine(ref, tz)}, which was ${ref.status === 'working' || ref.status === 'queued' ? 'being built' : 'built'} when he added his latest words. Its commits are in git (git log): build on top of them; keep what still stands, change what his latest words change.` : '',
    c.fixOf && ref ? `A reviewer checked change ${refLine(ref, tz)} and found it isn't right yet${c.review?.said ? `: "${c.review.said}"` : ''}${c.review?.checked ? ` (it checked: ${c.review.checked})` : ''}. Fix exactly that, on top of its commits.` : '',
    c.verify ? 'He asked for this to be double-checked: after the change, test it end to end the way he would meet it (a dev copy, or the real function with his real case from today), not only the unit tests, and say in "checked" what you verified.' : '',
    c.auto ? `The coach filed this on its own${c.by === 'nightly' ? ' (the nightly review of his day)' : ''}: he complained or corrected it without asking for a change. Do only what his words ask; when they don't clearly ask for a change, change nothing and say so (status "question").` : '',
  ].filter(Boolean).join('\n');
  return `COACH CHANGE ${c.id}

Training HQ's server on this Mac started you to make one change he asked his coach for in the app's chat. He is not watching this chat: don't ask him anything here, decide yourself, and do only this change. For this chat this replaces "carry on from Where we stopped" and "wait for his go-ahead" in CLAUDE.md.

HIS REQUEST (${c.kind || 'behaviour'}, ${when})
${wordsBlock(c, c.tz)}
${c.earlier?.length ? `Earlier requests it follows on from: ${c.earlier.join(' | ')}\n` : ''}${story ? `${story}\n` : ''}
The conversation up to it (from the app's log, oldest first; "sent by the app" lines are notifications the app wrote in the coach's name, not the coach's replies):
${c.context || '(none)'}
${others.length ? `\nOther requests waiting on the Mac (not yours; don't do them, another builder will): ${others.map((o) => `[${o.id}] "${clip(o.said, 160)}"${o.want ? ` -> wants: ${clip(o.want, 160)}` : ''}`).join(' | ')}\n` : ''}${recent.length ? `\nFinished in the last day (live now; don't undo them unless his words above say so): ${recent.map((o) => `[${o.id}, ${formatTime(new Date(o.doneAt), tz)}] "${clip(o.said, 160)}" -> ${clip(o.answer, 160)}`).join(' | ')}\n` : ''}
WHERE THINGS ARE
- Code, the public repo (every push to main deploys the app after its tests pass): ${codeDir}. No personal details there, ever (no name, city, programme numbers or dates).
- His private folder (you are in it): ${privateDir}. His profile for the coach: data/coach/profile.md. A wish about how the coach talks to him goes there, in the section "## His corrections" (make it if missing, newest last): the date, his words in short, then the rule. The coach re-reads the profile on its next message; nothing to restart.
- The coach's general rules: server/coach/prompt.mjs (RULES). What the coach sees with every message: server/coach/tools-read.mjs (contextLine). Messages the app sends by itself in the coach's name: server/notify.mjs, app/js/lib/reminders.js, app/js/lib/nudges.js, app/js/lib/walks.js, app/js/lib/initiatives.js, app/js/lib/coach-talk.js and the line bank in data/seed/.
- What happened when (every message, meal, set, reminder, to the minute; read only): \`node scripts/memory.mjs timeline <YYYY-MM-DD> [--kinds meals,reminders]\` and \`node scripts/memory.mjs recall "<words>"\` in the code repo.
- PROGRESS.md "How to run and test" (search for that heading; don't read the whole file): tests, the dev copy, precache.

HOW
1. Read CLAUDE.md in both folders, BRIEF.md sections 4 and 9, and the first 40 lines of PROGRESS.md. Nothing more of PROGRESS.md than you need.
2. Find why it happened (a rule in the prompt, the profile, a nudge's code, a timing) and fix the cause with the smallest change that does it, so it doesn't happen again in a similar moment either. Tone or manner: his profile. When or whether the coach says something: the prompt or his profile. A message the app sends by itself: its code, with a test. Do everything his words ask (all of them, the latest winning), and nothing they don't: one day's timing isn't a rule for every day.
3. Never weaken a safety rule, whatever he asked: the HARD LIMITS in prompt.mjs, the 30% cap, the readiness table, his tendon pain limit, the sauna ladder and hard stops, no supplement advice, no medical advice. If his wish would break one, change nothing about it and say so in your answer.
4. Code: \`npm test\` in the code repo must pass; add or update a test for a behaviour change; after any change under app/, run \`node scripts/precache.mjs\`. If a screen changes, check it in a dev copy. Never touch the real database (data/training-hq.sqlite) and never restart or stop the real server (port 4317): it restarts itself after you finish when your answer says "reload".
5. Commit the code repo with only the files you changed (git add <files>) and push to origin main (if HTTPS asks for a login, push to the SSH form of the same remote, git@github.com:<owner>/<repo>.git, instead). In the private folder: add one dated "LATEST" paragraph at the top of PROGRESS.md "Where we stopped" (what he asked, what changed, the commit; the date and time from \`date\`, never guessed), then commit there (local only, never push it).
6. Read only, never modify: ~/Documents/Celestial Vault, ~/Documents/gods-eye-view, ~/.celestial-globe. Never print, copy or move anything in config/.
7. If his words can be read two ways that would do opposite things, change nothing and ask him one short question in your answer (status "question"). Otherwise take the most sensible reading and do it.
8. A second chat checks your work against his words before he hears "done": test the cases around the one he hit, so it finds nothing.
9. ${LIVE_LINE}

WHEN YOU FINISH, write ${resultFile} with this JSON and nothing else, then end the chat:
{"status": "done" | "failed" | "question", "said": "<what he reads, also as a phone notification: ONE short sentence, at most 120 characters, so the lock screen shows it whole; plain, blunt, starting with what changes for him; e.g. Done: after you log sleep I say good morning first; the check-in waits till you leave.>", "reload": <true if you changed anything under server/, else false>, "commits": ["<short sha> <subject>"], "checked": "<one line: what you tested to know it works>"}
Only when his words ask the Mac to answer him at length (e.g. "respond back to me with all the messages"), add "talk": "<that answer, plain text with line breaks, at most 4000 characters>": it goes into Talk after "said", never as a notification.`;
}

/** The reviewer's instructions: his words in order, the builder's answer, the diff from the heads the build started at. */
export function reviewPrompt(c, { codeDir, privateDir, reviewFile, ref = null }) {
  const b = c.build || {};
  const h = c.startHeads || {};
  const range = (dir, head) => (head ? `in ${dir}: \`git log --oneline ${head}..HEAD\` and \`git diff ${head}..HEAD\` (plus \`git status\` for anything left uncommitted)` : `in ${dir}: the builder's commits listed above (\`git show <sha>\`)`);
  return `COACH CHANGE REVIEW ${c.id}

Training HQ's server on this Mac started you to check one change a builder chat just made for him, before he hears "done". He is not watching this chat: don't ask him anything, decide yourself. For this chat this replaces "carry on from Where we stopped" and "wait for his go-ahead" in CLAUDE.md.

HIS REQUEST (${c.kind || 'behaviour'})
${wordsBlock(c, c.tz, c.builderHeard ?? Infinity)}
${c.kind === 'check' && ref ? `It is a check of change ${refLine(ref, c.tz || 'UTC')}.\n` : ''}${c.verify ? 'He asked for it to be double-checked: test it end to end the way he would meet it (a dev copy, or the real function with his real case from today), not only the unit tests.\n' : ''}
The conversation up to it:
${c.context || '(none)'}

WHAT THE BUILDER SAID: "${b.said || ''}"${b.checked ? ` (it checked: ${b.checked})` : ''}; commits: ${(b.commits || []).join(', ') || 'none listed'}; reload: ${Boolean(b.reload)}.

WHAT TO DO
1. Read CLAUDE.md in both folders and BRIEF.md sections 4 and 9.
2. See what changed: ${range(codeDir, h.code)}; ${range(privateDir, h.private)}. Other chats may have committed in the same range: review only what concerns this change.
3. Run \`npm test\` in ${codeDir}.
4. Check it against every one of his words (the latest wins): does it do what he asked, all of it, and nothing he didn't (one day's timing isn't a rule for every day)? Check the cases around it: the same moment on another day or at another time, nothing logged yet, after midnight, a repeat, the phone offline, a message he'd read on the lock screen. Check that every message it touches still reads right (his tone rules: BRIEF.md section 4 and his profile), and that no safety rule got weaker (HARD LIMITS in server/coach/prompt.mjs, the 30% cap, the readiness table, his tendon pain limit, the sauna ladder and hard stops, no supplement or medical advice).
5. A small gap (a missed case, a wrong word, a missing test): fix it yourself the way the builder would: test, \`node scripts/precache.mjs\` after a change under app/, commit only your files and push the code repo (if HTTPS asks for a login, push to git@github.com:<owner>/<repo>.git); in the private folder commit locally, never push. A big miss (half his ask not done, his words read wrong, a safety rule weakened that a few lines can't restore): don't rebuild it; answer "failed" and say what is missing.
6. Never touch the real database (data/training-hq.sqlite), never restart or stop the real server (port 4317), never read or print anything in config/. Read only: ~/Documents/Celestial Vault, ~/Documents/gods-eye-view, ~/.celestial-globe.
7. ${LIVE_LINE} A small addition: do it yourself (status "fixed"); too big for a few lines: "failed" and say what is missing.

WHEN YOU FINISH, write ${reviewFile} with this JSON and nothing else, then end the chat:
{"status": "ok" | "fixed" | "failed", "said": "<ONE sentence for him, at most 120 characters: ok or fixed: what now works, starting with Done:; failed: what is still wrong, plainly>", "reload": <true if YOU changed anything under server/, else false>, "commits": ["<short sha> <subject>" of your own fixes], "checked": "<one line, at most 200 characters: what you checked>"}`;
}

/** Was this process started and is it still running? */
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Starts the builder (or reviewer), detached (its own process group), output to its log file. Returns its pid. */
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

/**
 * The hooks for the builder: change-guard.mjs checks every tool call before it runs; with more, change-more.mjs hands
 * over his words added while it works, after every tool call and when it tries to end.
 */
export function guardSettings({ node = process.execPath, guard, codeDir, privateDir, more = null }) {
  const sh = (args) => args.map((x) => `'${String(x).replace(/'/g, "'\\''")}'`).join(' ');
  const hooks = { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: sh([node, guard, codeDir, privateDir]) }] }] };
  if (more) {
    const command = sh([node, more.script, more.moreFile, more.seenFile, more.answerFile]);
    hooks.PostToolUse = [{ matcher: '*', hooks: [{ type: 'command', command }] }];
    hooks.Stop = [{ hooks: [{ type: 'command', command }] }];
  }
  return JSON.stringify({ hooks });
}

/** A folder's git HEAD, or null. */
export function gitHead(dir) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', timeout: 10000 }).trim() || null; } catch { return null; }
}

/** Did the build change anything (commits listed, or either repo's HEAD moved)? */
const changedSince = (start, end, commits = []) => commits.length > 0 || Boolean(start && end && ((start.code && end.code && start.code !== end.code) || (start.private && end.private && start.private !== end.private)));

/**
 * @param {object} o
 * @param {ReturnType<import('../store.mjs').openStore>} o.store
 * @param {{notify: Function, list: Function}} [o.push]
 * @param {string} o.codeDir  the public repo
 * @param {string} o.privateDir his private folder
 * @param {(o) => number} [o.launch] starts a builder or reviewer, returns its pid (tests pass a fake)
 * @param {(pid:number) => boolean} [o.isAlive]
 * @param {() => void} [o.restart] the server restarts itself (a builder changed server code)
 * @param {() => boolean} [o.busy] the coach is answering: the restart waits
 * @param {() => {code: string|null, private: string|null}} [o.heads] both repos' git HEADs
 */
export function openChanges({ store, push = null, codeDir, privateDir, launch = launchBuilder, isAlive = alive, restart = () => {}, busy = () => false, dirty = () => [], heads = null, log = () => {}, now = () => Date.now(), tz = () => 'UTC', timeoutMs = TIMEOUT_MS, reviewTimeoutMs = REVIEW_TIMEOUT_MS, guard = fileURLToPath(new URL('./change-guard.mjs', import.meta.url)), moreScript = fileURLToPath(new URL('./change-more.mjs', import.meta.url)) }) {
  const dir = join(privateDir, 'logs', 'coach-changes');
  const headsNow = heads || (() => ({ code: gitHead(codeDir), private: gitHead(privateDir) }));
  const all = () => store.listRecords(COL).map((r) => r.data).filter(Boolean).sort((a, b) => a.at - b.at);
  const one = (id) => (id ? all().find((x) => x.id === id) || null : null);
  // His words the coach added while this tick worked on an older copy of the record are kept.
  const put = (c) => {
    const cur = one(c.id);
    const rec = cur && asksOf(cur).length > asksOf(c).length ? { ...c, asks: cur.asks, want: cur.want, context: cur.context, ...(cur.verify ? { verify: true } : {}) } : c;
    store.writeLocal(COL, rec.id, rec);
    return rec;
  };
  const files = (id) => ({ logFile: join(dir, `${id}.log`), resultFile: join(dir, `${id}.result.json`), reviewLog: join(dir, `${id}.review.log`), reviewFile: join(dir, `${id}.review.json`), moreFile: join(dir, `${id}.more.json`), seenFile: join(dir, `${id}.more.seen`) });
  const messages = () => store.listRecords(MSGS).map((r) => r.data).filter(Boolean);

  // ---- his words added while a chat works on the request (change-more.mjs hands them over) ----
  const writeAtomic = (file, text) => { writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); };
  /** How many of his asks the running chat has: those in its prompt (briefed) plus those handed over since. */
  const heardOf = (c) => (c.briefed == null ? asksOf(c).length : c.briefed + seenCount(files(c.id).seenFile));
  /** A fresh start for the chat about to run: nothing added yet, nothing seen. */
  function resetMore(c) {
    const { moreFile, seenFile } = files(c.id);
    writeAtomic(moreFile, JSON.stringify({ asks: [] }));
    rmSync(seenFile, { force: true });
  }
  /** The asks added since the running chat started, where its hooks read them. */
  function syncMore(c) {
    if (c.briefed == null) return;
    const added = asksOf(c).slice(c.briefed);
    const { moreFile } = files(c.id);
    if (added.length === addedAsks(moreFile).length) return;
    writeAtomic(moreFile, JSON.stringify({ asks: added.map((a) => ({ ...a, when: formatTime(new Date(a.at), c.tz || tz()) })) }));
    log(`coach change ${c.id}: his added words go to the running ${c.stage === 'review' ? 'reviewer' : 'builder'}`);
  }
  const moreHooks = (c, answerFile) => { const { moreFile, seenFile } = files(c.id); return { script: moreScript, moreFile, seenFile, answerFile }; };
  /** The chat has written its answer: take it only when it has everything he added and the answer is still there. */
  function answerReady(c, file, pid) {
    const latest = one(c.id) || c;
    if (asksOf(latest).length > heardOf(latest) && isAlive(pid)) { syncMore(latest); return false; }
    return existsSync(file);
  }
  let ticking = false;
  let restartDue = false;
  let editsSince = 0; // when the folders were first seen with unsaved edits while a request waited
  // When this server started: a change built before it is live now (Thu 10/22, his words, "fix the not fixed part":
  // "done" used to come before the restart that makes server changes live).
  const bootAt = now();

  function sayInTalk(c, text, kind = 'change', at = now()) {
    const id = `cm.${String(at).padStart(13, '0')}.${rand()}`;
    store.writeLocal(MSGS, id, { id, role: 'assistant', text, at, tz: c.tz || tz(), kind, ref: `change:${c.id}` });
  }

  /**
   * The builder's longer answer for Talk, after the short one (result.json "talk"; Fri 10/23, his words: "let the Mac
   * respond back to me with how he thinks this should be, with a proper response, with all the messages"). Talk only:
   * the notification stays the short one.
   */
  function talkOf(c) {
    try { const t = JSON.parse(readFileSync(files(c.id).resultFile, 'utf8')).talk; return typeof t === 'string' ? t.trim().slice(0, 4000) : ''; } catch { return ''; }
  }

  async function tell(c, text, { done = false } = {}) {
    const at = now();
    sayInTalk(c, text, 'change', at);
    const more = done ? talkOf(c) : '';
    if (more) sayInTalk(c, more, 'change', at + 1);
    try { if (push?.list?.().length) await push.notify({ title: 'Coach', body: text, url: '#/coach', tag: `change-${c.id}` }); } catch (e) { log(`coach change ${c.id}: notification: ${e.message}`); }
  }

  /** File one request (the coach's tool writes the same record straight into the store). */
  function request(o) {
    const c = put(newChange({ ...o, at: o.at ?? now(), tz: o.tz || tz(), messages: messages() }));
    log(`coach change ${c.id} queued${c.auto ? ` (filed on its own${c.by ? `, ${c.by}` : ''})` : ''}: ${clip(c.said, 120)}`);
    return c;
  }

  function cancel(id) {
    const c = one(id);
    if (!c || c.status !== 'queued') return null;
    return put({ ...c, status: 'cancelled', doneAt: now() });
  }

  /** Requests the coach should follow already (still being built), and the ones finished in the last day. */
  function forContext(t = now()) {
    return { open: all().filter(isOpen), recent: all().filter((c) => isFinished(c) && t - (c.doneAt || 0) < 86400000) };
  }

  /**
   * The end of a request: what he hears, and when (server code: after the restart that makes it live).
   * extra: what the review added (review, checked, reviewed).
   */
  async function finish(c, result, extra = {}) {
    const status = ['done', 'failed', 'question'].includes(result?.status) ? result.status : 'failed';
    const answer = clip(result?.said, 300) || (status === 'done' ? 'Done: the change you asked for is in.' : 'That change didn\'t go through.');
    const reload = Boolean(result?.reload);
    // Filed by the nightly review: built while he sleeps, told in the morning message (nightly.mjs), not at 2 AM.
    const quiet = c.by === 'nightly' || Boolean(c.quiet);
    const afterRestart = status === 'done' && reload && !quiet;
    const commits = Array.isArray(result?.commits) ? result.commits.slice(0, 10).map((x) => clip(x, 120)) : [];
    const checked = clip(extra.checked ?? result?.checked, 300);
    const { checked: _, ...more } = extra;
    put({ ...c, status, stage: null, doneAt: now(), answer, reload, ...(quiet ? { announce: 'morning' } : afterRestart ? { announce: 'after-restart' } : {}), commits, ...(checked ? { checked } : {}), ...more });
    // Server code: he hears it once the restart has made it live (announced()); the rest is live now.
    if (!afterRestart && !quiet) await tell(c, answer, { done: status === 'done' });
    log(`coach change ${c.id}: ${status}${extra.reviewed === false ? ' (not reviewed)' : extra.review ? ` (review: ${extra.review.status})` : ''}${reload ? ', server restarts' : ''}${afterRestart ? ', then he hears it' : quiet ? ', told in the morning' : ''}`);
    if (reload && (status === 'done' || extra.review)) restartDue = true;
    // His words that came in after the chat had ended: a correcting request right after it, built on top of it.
    const latest = one(c.id) || c;
    const left = c.status === 'working' ? asksOf(latest).slice(heardOf(latest)) : [];
    if (left.length) {
      const last = left.at(-1);
      const n = put(newChange({ said: last.said, want: last.want, about: last.about, kind: c.kind === 'check' ? 'bug' : c.kind, at: now(), tz: c.tz || tz(), asks: asksOf(latest).slice(0, -1), corrects: c.id, followsOn: c.id, auto: Boolean(c.auto), earlier: [`"${clip(c.said, 200)}" -> ${answer}`], lineAt: lineAtOf(c) + 1, quiet, messages: messages() }));
      log(`coach change ${c.id}: his words came after it ended; correction ${n.id} queued first in line`);
    }
  }

  /** The build is done: a second chat checks it against his words before he hears it. */
  function startReview(c, build) {
    mkdirSync(dir, { recursive: true });
    const { reviewLog, reviewFile } = files(c.id);
    const latest = one(c.id) || c;
    // The reviewer's prompt has all his words; those the builder never got are marked for it.
    const withBuild = { ...latest, build, builderHeard: heardOf(latest), briefed: asksOf(latest).length };
    const prompt = reviewPrompt(withBuild, { codeDir, privateDir, reviewFile, ref: one(c.checkOf) });
    writeFileSync(reviewLog, `coach change review ${c.id}, ${new Date(now()).toISOString()}\n`, { flag: 'a' });
    const pid = launch({ prompt, cwd: privateDir, logFile: reviewLog, settings: guardSettings({ guard, codeDir, privateDir, more: moreHooks(c, reviewFile) }), model: REVIEW_MODEL });
    resetMore(c); // after the launch: if it fails, what the builder heard still counts
    put({ ...withBuild, stage: 'review', reviewPid: pid, reviewStartedAt: now() });
    log(`coach change ${c.id}: built, reviewer started (pid ${pid})`);
  }

  async function afterBuild(c, result) {
    const status = ['done', 'failed', 'question'].includes(result?.status) ? result.status : 'failed';
    const build = { status, said: clip(result?.said, 300), reload: Boolean(result?.reload), commits: Array.isArray(result?.commits) ? result.commits.slice(0, 6).map((x) => clip(x, 120)) : [], checked: clip(result?.checked, 300) };
    if (status === 'done' && changedSince(c.startHeads, headsNow(), build.commits)) {
      try { startReview(c, build); return; } catch (e) { log(`coach change ${c.id}: the reviewer couldn't start (${e.message}); not reviewed`); await finish(c, build, { reviewed: false }); return; }
    }
    await finish(c, build);
  }

  /** The reviewer's answer: ok or fixed = done; failed = he hears it plainly and ONE automatic fix is queued. */
  async function afterReview(c, r) {
    const b = c.build || { status: 'done' };
    const status = ['ok', 'fixed', 'failed'].includes(r?.status) ? r.status : null;
    if (!status) { log(`coach change ${c.id}: the reviewer's answer had no status; not reviewed`); await finish(c, b, { reviewed: false }); return; }
    const review = { status, said: clip(r.said, 300), checked: clip(r.checked, 300), reload: Boolean(r.reload), commits: Array.isArray(r.commits) ? r.commits.slice(0, 6).map((x) => clip(x, 120)) : [], at: now() };
    const merged = { status: 'done', said: status === 'fixed' && review.said ? review.said : b.said || review.said, reload: Boolean(b.reload || review.reload), commits: [...(b.commits || []), ...review.commits] };
    const checked = review.checked || b.checked || '';
    if (status !== 'failed') { await finish(c, merged, { review, checked, reviewed: true }); return; }
    // Failed: one follow-up fix, right at the front of the line; a follow-up that fails again goes to him.
    const again = !c.fixOf;
    const said = review.said || 'The check on the Mac found the change isn\'t right yet.';
    await finish(c, { ...merged, status: 'failed', said: again ? `${said.replace(/[.\s]+$/, '')}. Fixing it now.` : `Still not right after a second try: ${said}` }, { review, checked, reviewed: true });
    if (again) {
      const n = put(newChange({ said: c.said, want: c.want, about: c.about, kind: c.kind === 'check' ? 'bug' : c.kind, at: now(), tz: c.tz || tz(), asks: asksOf(one(c.id) || c), auto: true, by: 'review', fixOf: c.id, followsOn: c.id, lineAt: lineAtOf(c) + 1, verify: c.verify, review: { said: review.said, checked: review.checked }, quiet: c.by === 'nightly' || Boolean(c.quiet), messages: messages() }));
      log(`coach change ${c.id}: review failed, fix ${n.id} queued first in line`);
    }
  }

  async function checkReview(c) {
    const { reviewFile } = files(c.id);
    if (existsSync(reviewFile)) {
      if (!answerReady(c, reviewFile, c.reviewPid)) return;
      let r = null;
      try { r = JSON.parse(readFileSync(reviewFile, 'utf8')); } catch (e) { log(`coach change ${c.id}: the reviewer's answer couldn't be read (${e.message})`); }
      await afterReview(c, r);
      return;
    }
    const over = now() - (c.reviewStartedAt || 0) > reviewTimeoutMs;
    if (isAlive(c.reviewPid) && !over) return;
    if (over && isAlive(c.reviewPid)) { try { process.kill(-c.reviewPid, 'SIGTERM'); } catch { /* gone */ } }
    log(`coach change ${c.id}: not reviewed (${over ? 'the reviewer ran over 30 minutes' : 'the reviewer stopped without an answer'})`);
    await finish(c, c.build || { status: 'done' }, { reviewed: false });
  }

  async function check(c) {
    if (c.stage === 'review') { await checkReview(c); return; }
    const { resultFile, logFile } = files(c.id);
    if (existsSync(resultFile)) {
      if (!answerReady(c, resultFile, c.pid)) return;
      let result = null;
      try { result = JSON.parse(readFileSync(resultFile, 'utf8')); } catch (e) { result = { status: 'failed', said: `The builder's answer couldn't be read (${e.message}).` }; }
      await afterBuild(c, result);
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
    const everything = all();
    const others = lineOf(everything).filter((x) => x.id !== c.id);
    const recent = everything.filter((x) => x.status === 'done' && now() - (x.doneAt || 0) < 86400000);
    const prompt = builderPrompt(c, { codeDir, privateDir, resultFile, others, recent, ref: one(c.corrects || c.checkOf || c.fixOf) });
    writeFileSync(logFile, `coach change ${c.id}, try ${(c.tries || 0) + 1}, ${new Date(now()).toISOString()}\n`, { flag: 'a' });
    resetMore(c);
    const settings = guardSettings({ guard, codeDir, privateDir, more: moreHooks(c, resultFile) });
    // The heads the build starts from (kept across a second try): the reviewer reads the diff from here.
    const startHeads = c.startHeads || headsNow();
    const pid = launch({ prompt, cwd: privateDir, logFile, settings, model: MODEL });
    const { waitingFor, waitingSince, ...rest } = c;
    // briefed: how many of his asks are in its prompt; the ones he adds later are handed over while it works.
    put({ ...rest, status: 'working', stage: 'build', pid, startedAt: now(), tries: (c.tries || 0) + 1, startHeads, briefed: asksOf(c).length });
    log(`coach change ${c.id}: builder started (pid ${pid})`);
  }

  /** Changes built before this server started: live now, so he hears them now. */
  async function announced() {
    for (const c of all().filter((x) => x.announce === 'after-restart' && (x.doneAt || 0) < bootAt)) {
      put({ ...c, announce: 'done', announcedAt: now() });
      await tell(c, c.answer, { done: c.status === 'done' });
    }
  }

  /** Once every few seconds: finish what ended, start the next one. */
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await announced();
      const working = all().filter((c) => c.status === 'working');
      for (const c of working) { syncMore(c); await check(c); }
      // New server code is live only after a restart: right away, mid-workout too (Thu 10/22, his words: "even mid workout
      // it can restart... as long as it saves": the phone saves on its own), but not while the coach is answering.
      if (restartDue && !busy()) { restartDue = false; restart(); return; }
      if (all().some((c) => c.status === 'working')) return;
      // No daily limit (Thu 10/22, his words: "Don't have a daily build limit. Make it unlimited"): one at a time.
      const next = lineOf(all())[0];
      if (!next) { editsSince = 0; return; }
      const edits = dirty();
      if (edits.length) {
        if (!editsSince) { editsSince = now(); log(`coach change ${next.id}: waits, unsaved edits in ${edits.join(', ')}`); put({ ...next, waitingFor: edits, waitingSince: editsSince }); }
        if (now() - editsSince < EDITS_WAIT_MS) return;
        log(`coach change ${next.id}: edits still unsaved after ${Math.round(EDITS_WAIT_MS / 60000)} minutes; starting anyway`);
      }
      editsSince = 0;
      try { start(next); } catch (e) {
        log(`coach change ${next.id}: ${e.message}`);
        await finish(next, { status: 'failed', said: `I couldn't start the change on the Mac: ${e.message}.` });
      }
    } finally { ticking = false; }
  }

  return { request, cancel, tick, list: all, forContext, files, _finish: finish };
}
