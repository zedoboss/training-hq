// Fri 10/23: more words for a request while it's being built go into the same running build. His words: "sometimes I'm
// gonna add more details while it's working... So I can add more details to the same task. And the coach should be
// able to figure out if it should be sent in the same task or cue them in a new assignment." That day the coach said
// "I couldn't add it to the same task because the Mac was already working on it" and queued a second search.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.mjs';
import { openChanges, guardSettings, asksOf, lineOf, COL } from '../server/coach/changes.mjs';
import { handOver } from '../server/coach/change-more.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-20') => Date.parse(`${d}T${hm}:00+07:00`);
let dir; let store; let clock; let heads;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-live-')); store = openStore(join(dir, 'db.sqlite')); clock = at('17:56'); heads = { code: 'c0', private: 'p0' }; });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => clock, action: () => {} });
const ask = (a) => WRITE_TOOLS.find((t) => t.name === 'request_change').run(a, ctx());
const rec = (id) => store.getRecord(COL, id).data;
const recs = () => store.listRecords(COL).map((r) => r.data).sort((a, b) => a.at - b.at);
const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.kind === 'change').map((m) => m.text);

function queue() {
  const launched = []; const alive = new Set(); const logs = [];
  const q = openChanges({
    store, codeDir: '/code', privateDir: dir, tz: () => TZ, now: () => clock, heads: () => heads, log: (m) => logs.push(m),
    launch: (a) => { launched.push(a); const pid = 3000 + launched.length; alive.add(pid); return pid; },
    isAlive: (pid) => alive.has(pid),
  });
  const f = (c) => q.files(c.id);
  // The hooks of the running chat, as Claude Code calls them.
  const hook = (c, event, answerFile = f(c).resultFile) => handOver({ hook_event_name: event }, { moreFile: f(c).moreFile, seenFile: f(c).seenFile, answerFile });
  return { q, launched, alive, logs, f, hook };
}

const SEARCH = 'My Decathlon search went dry: find alternatives for the dip belt and the chalk.';
const MORE = 'Stores near Grand Park ideally, District 1 and 7 okay, I go Monday; Shopee if nothing. Same task, not the queue.';

test('his case: more details while it is being built go into the same running build; no second request', async () => {
  const { q, launched, f, hook } = queue();
  const a = q.request({ said: SEARCH, kind: 'bug' });
  await q.tick();
  assert.equal(rec(a.id).briefed, 1);
  assert.match(launched[0].prompt, /HE ADDED MORE TO THIS REQUEST/, 'the builder knows words may come in');
  clock = at('17:57');
  const r = await ask({ said: MORE, want: 'stores near Grand Park first, D1/D7 fine, Monday; Shopee as fallback', amends: a.id });
  assert.match(r.text, /^Added his words to chg\.\S+, the same request, while it's being built \(building now, about 5 minutes left\)/);
  assert.match(r.text, /in the same task, nothing more/);
  assert.equal(recs().length, 1, 'not queued as a follow-up');
  assert.equal(hook(a, 'PostToolUse'), null, 'nothing handed over before the queue writes it');
  await q.tick();
  const added = JSON.parse(readFileSync(f(a).moreFile, 'utf8')).asks;
  assert.equal(added.length, 1);
  assert.equal(added[0].when, '5:57 PM');
  const out = hook(a, 'PostToolUse');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /^HE ADDED MORE TO THIS REQUEST[\s\S]*- 5:57 PM: "Stores near Grand Park ideally[\s\S]*What he wants: stores near Grand Park first/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /set aside/);
  assert.equal(hook(a, 'PostToolUse'), null, 'handed over once');
  assert.equal(hook(a, 'Stop'), null, 'nothing new: it may end');
  // It finishes with everything: the reviewer sees both asks, none marked late; one answer for him.
  heads = { code: 'c0', private: 'p1' };
  writeFileSync(f(a).resultFile, JSON.stringify({ status: 'done', said: 'Chalk: Grand Park pickup. Belt: Tiki.', reload: false, commits: ['p1 Progress'] }));
  await q.tick();
  assert.equal(rec(a.id).stage, 'review');
  assert.equal(rec(a.id).builderHeard, 2);
  assert.match(launched[1].prompt, /1\. 5:56 PM, his request: "My Decathlon search[\s\S]*2\. 5:57 PM, his correction: "Stores near Grand Park/);
  assert.doesNotMatch(launched[1].prompt, /came after the builder had finished/);
  writeFileSync(f(a).reviewFile, JSON.stringify({ status: 'ok', said: 'Done.', checked: 'stores' }));
  await q.tick();
  assert.equal(rec(a.id).status, 'done');
  assert.deepEqual(talk(), ['Chalk: Grand Park pickup. Belt: Tiki.']);
  assert.equal(recs().length, 1, 'no correction afterwards either');
});

test('his words land after the builder wrote its answer but before it ended: the answer is set aside, it carries on', async () => {
  const { q, launched, f, hook } = queue();
  const a = q.request({ said: SEARCH });
  await q.tick();
  writeFileSync(f(a).resultFile, JSON.stringify({ status: 'done', said: 'First answer', reload: false, commits: ['x'] }));
  clock = at('17:57');
  await ask({ said: MORE, amends: a.id });
  heads = { code: 'c1', private: 'p0' };
  await q.tick();
  assert.equal(rec(a.id).stage, 'build', 'the answer without his new words is not taken while the builder still runs');
  assert.equal(launched.length, 1);
  const out = hook(a, 'Stop');
  assert.equal(out.decision, 'block', 'it may not end before it has his words');
  assert.match(out.reason, /Stores near Grand Park[\s\S]*The answer file you wrote was set aside: write it again/);
  assert.equal(existsSync(f(a).resultFile), false);
  await q.tick();
  assert.equal(rec(a.id).stage, 'build');
  writeFileSync(f(a).resultFile, JSON.stringify({ status: 'done', said: 'Answer with stores', reload: false, commits: ['x'] }));
  await q.tick();
  assert.equal(rec(a.id).stage, 'review');
  assert.equal(rec(a.id).build.said, 'Answer with stores');
});

test('the builder ended before it got them: the reviewer gets them marked, and does them', async () => {
  const { q, launched, alive, f } = queue();
  const a = q.request({ said: SEARCH });
  await q.tick();
  writeFileSync(f(a).resultFile, JSON.stringify({ status: 'done', said: 'First answer', reload: false, commits: ['x'] }));
  alive.clear();
  clock = at('17:57');
  await ask({ said: MORE, amends: a.id });
  heads = { code: 'c1', private: 'p0' };
  await q.tick();
  assert.equal(rec(a.id).stage, 'review');
  assert.match(launched[1].prompt, /2\. 5:57 PM, his correction \(came after the builder had finished: if the build doesn't cover it, do it yourself\): "Stores near Grand Park/);
  const hooks = JSON.parse(launched[1].settings).hooks;
  assert.match(hooks.Stop[0].hooks[0].command, /change-more\.mjs'.*\.more\.json'.*\.more\.seen'.*\.review\.json'$/, 'the reviewer gets later words too; its own answer is the one set aside');
});

test('words while it is being checked reach the reviewer; words after it all ended: a correction first in line', async () => {
  const { q, launched, alive, f, hook, logs } = queue();
  const a = q.request({ said: SEARCH });
  await q.tick();
  clock = at('17:57');
  const other = q.request({ said: 'Shorter walk messages' });
  heads = { code: 'c1', private: 'p0' };
  writeFileSync(f(a).resultFile, JSON.stringify({ status: 'done', said: 'Answer', reload: false, commits: ['x'] }));
  await q.tick();
  assert.equal(rec(a.id).stage, 'review');
  clock = at('17:58');
  const r = await ask({ said: 'Also check Lazada', amends: a.id });
  assert.match(r.text, /while it's being checked \(built, being checked before he hears done\)/);
  await q.tick();
  assert.match(hook(a, 'PostToolUse', f(a).reviewFile).hookSpecificOutput.additionalContext, /"Also check Lazada"/);
  // Then one more after the reviewer wrote its answer and ended: he still gets it, built right after.
  writeFileSync(f(a).reviewFile, JSON.stringify({ status: 'fixed', said: 'Done: stores and Lazada.', checked: 'x' }));
  alive.clear();
  clock = at('17:59');
  await ask({ said: 'And Shopee Mall only', amends: a.id });
  await q.tick();
  assert.equal(rec(a.id).status, 'done');
  const fix = recs().find((x) => x.corrects === a.id);
  assert.ok(fix, 'his last words are not lost');
  assert.equal(fix.said, 'And Shopee Mall only');
  assert.deepEqual(asksOf(fix).map((x) => x.said), [SEARCH, 'Also check Lazada', 'And Shopee Mall only']);
  assert.equal(rec(fix.id).status, 'working', 'first in line: started in the same tick, ahead of the request filed before it');
  assert.deepEqual(lineOf(recs()).map((x) => x.id), [other.id]);
  assert.ok(logs.some((l) => /his words came after it ended; correction chg\.\S+ queued first in line/.test(l)));
  assert.match(launched.at(-1).prompt, /3\. 5:59 PM, his correction: "And Shopee Mall only"/);
});

test('a builder that stopped without an answer runs again with all his words in its prompt', async () => {
  const { q, launched, alive } = queue();
  const a = q.request({ said: SEARCH });
  await q.tick();
  clock = at('17:57');
  await ask({ said: MORE, amends: a.id });
  alive.clear();
  await q.tick(); // stopped: queued again
  await q.tick();
  assert.equal(launched.length, 2);
  assert.match(launched[1].prompt, /2\. 5:57 PM, his correction: "Stores near Grand Park/);
  assert.equal(rec(a.id).briefed, 2);
});

test('the coach decides: the same wish goes into the running task, a different one is its own request', async () => {
  assert.match(RULES, /amends with its id, also while it's being built \(the Mac works them into the running build; never say it can't\)\. Decide yourself: the same wish = amends, a different one = separate\./);
  const { q } = queue();
  const a = q.request({ said: SEARCH });
  await q.tick();
  assert.match((await ask({ said: 'The walk message is too long' })).text, /^Not filed yet[\s\S]*building now/, 'it must say how new words relate');
  assert.match((await ask({ said: 'The walk message is too long', separate: true })).text, /^Sent to the Mac \(next in line/);
  assert.equal(recs().length, 2);
  assert.equal(asksOf(rec(a.id)).length, 1);
});

test('the hook as Claude Code runs it: words in, JSON out; the hooks are installed on the builder', async () => {
  const { q, launched, f } = queue();
  const a = q.request({ said: SEARCH });
  await q.tick();
  const hooks = JSON.parse(launched[0].settings).hooks;
  assert.match(hooks.PreToolUse[0].hooks[0].command, /change-guard\.mjs/, 'the guard stays');
  assert.match(hooks.PostToolUse[0].hooks[0].command, /change-more\.mjs'.*\.result\.json'$/);
  assert.equal(hooks.PostToolUse[0].matcher, '*');
  assert.equal(hooks.Stop[0].hooks[0].command, hooks.PostToolUse[0].hooks[0].command);
  clock = at('17:57');
  await ask({ said: MORE, amends: a.id });
  await q.tick();
  const script = fileURLToPath(new URL('../server/coach/change-more.mjs', import.meta.url));
  const run = (event) => execFileSync(process.execPath, [script, f(a).moreFile, f(a).seenFile, f(a).resultFile], { input: JSON.stringify({ hook_event_name: event, stop_hook_active: false }), encoding: 'utf8' });
  const out = JSON.parse(run('PostToolUse'));
  assert.match(out.hookSpecificOutput.additionalContext, /Stores near Grand Park/);
  assert.equal(run('Stop'), '', 'nothing new: no output, it may end');
  assert.equal(guardSettings({ guard: '/g.mjs', codeDir: '/c', privateDir: '/p' }).includes('PostToolUse'), false, 'no words file, no extra hooks');
});
