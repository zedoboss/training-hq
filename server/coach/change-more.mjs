#!/usr/bin/env node
// His words added while a change is being built (Fri 10/23, his words: "sometimes I'm gonna add more details while it's
// working... So I can add more details to the same task"). The coach adds them to the running request; the queue
// (changes.mjs) writes the ones the running chat hasn't seen to <id>.more.json. Claude Code runs this after every tool
// call of the builder or reviewer (PostToolUse) and when it is about to end (Stop): new words reach the chat as a note
// it must act on, and a Stop is blocked until it has. The answer it already wrote is set aside first (deleted), so the
// queue never takes an answer that misses them; it writes a fresh one when it's done.
// Usage: node change-more.mjs <moreFile> <seenFile> <answerFile>, with the hook's JSON on stdin.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How many of the added words the chat has been given. */
export function seenCount(seenFile) {
  try { return Math.max(0, parseInt(readFileSync(seenFile, 'utf8'), 10) || 0); } catch { return 0; }
}

/** The added words, oldest first: [{at, said, want, about, when}]. */
export function addedAsks(moreFile) {
  try { const j = JSON.parse(readFileSync(moreFile, 'utf8')); return Array.isArray(j.asks) ? j.asks : []; } catch { return []; }
}

/** The note for the chat: his new words, what to do with them, and that its answer was set aside. */
export function noteFor(asks, { setAside = false } = {}) {
  const lines = asks.map((a) => `- ${a.when ? `${a.when}: ` : ''}"${a.said}"${a.about ? `\n  What it is about: ${a.about}` : ''}${a.want ? `\n  What he wants: ${a.want}` : ''}`);
  return `HE ADDED MORE TO THIS REQUEST while you were working (the coach put it into this same request). It is part of his request now, the latest words win where they differ; work it in before you finish:\n${lines.join('\n')}${setAside ? '\nThe answer file you wrote was set aside: write it again when this is done too.' : ''}`;
}

/** Hands over the words not yet seen: the hook output for this event, or null when there are none. */
export function handOver({ hook_event_name: event = '' } = {}, { moreFile, seenFile, answerFile }) {
  const asks = addedAsks(moreFile);
  const seen = seenCount(seenFile);
  if (asks.length <= seen) return null;
  // Answer first, then the count: the queue reads the answer, then checks nothing is waiting, then that the answer is still there.
  const setAside = Boolean(answerFile && existsSync(answerFile));
  if (setAside) rmSync(answerFile, { force: true });
  const tmp = `${seenFile}.tmp`;
  writeFileSync(tmp, String(asks.length));
  renameSync(tmp, seenFile);
  const text = noteFor(asks.slice(seen), { setAside });
  if (event === 'Stop' || event === 'SubagentStop') return { decision: 'block', reason: text };
  return { hookSpecificOutput: { hookEventName: event || 'PostToolUse', additionalContext: text } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [moreFile, seenFile, answerFile] = process.argv.slice(2);
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const out = moreFile && seenFile ? handOver(input, { moreFile, seenFile, answerFile }) : null;
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
