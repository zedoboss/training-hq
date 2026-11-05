// Thu 11/5, his words: "once the limit resets, I can say continue and it will... even if I don't say continue, it will
// automatically retry again... every 30 minutes"; "an update... Wi-Fi being cut off or some other stuff should also all
// be taken into account without resetting". A build cut off from outside waits and picks up where it stopped.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openChanges, cutOffOf, lastTry, whereText, COL } from '../server/coach/changes.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { contextLine } from '../server/coach/tools-read.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-19') => Date.parse(`${d}T${hm}:00+07:00`);
let dir; let store; let clock;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-resume-')); store = openStore(join(dir, 'db.sqlite')); clock = at('07:56'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const rec = (id) => store.getRecord(COL, id).data;
const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.kind === 'change').sort((a, b) => a.at - b.at).map((m) => m.text);
const tool = (name) => WRITE_TOOLS.find((t) => t.name === name);

// Claude Code's own stream-json events, as in the 8:20 AM log.
const ev = (o) => JSON.stringify(o);
const LIMIT_RESET = at('09:00');
const limitLines = (resetsAt = LIMIT_RESET) => [
  ev({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
  ev({ type: 'user', message: { content: [{ type: 'tool_result', content: 'usage limit reached? fetch failed? (only words a tool printed)' }] } }),
  ev({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: resetsAt / 1000, rateLimitType: 'five_hour' } }),
  ev({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your 5-hour limit · resets 9am (Asia/Saigon)" }] }, error: 'rate_limit', is_api_error_message: true, api_error_status: 429, api_error: 'usage_limit_reached' }),
  ev({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your 5-hour limit · resets 9am (Asia/Saigon)" }),
].join('\n');
const netLines = () => [
  ev({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Connection error.' }] }, error: 'unknown', is_api_error_message: true, api_error_status: null }),
  ev({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: Connection error.' }),
].join('\n');

function mac(o = {}) {
  const launched = []; const pushed = []; const alive = new Set();
  let edits = []; let editedAgo = 0; let booted = 0;
  const q = openChanges({
    store, codeDir: '/code', privateDir: dir, tz: () => TZ, now: () => clock, heads: () => ({ code: 'c0', private: 'p0' }),
    push: { list: () => [{}], notify: async (n) => { pushed.push(n.body); return { sent: 1 }; } },
    launch: (a) => { launched.push(a); const pid = 1000 + launched.length; alive.add(pid); return pid; },
    isAlive: (pid) => alive.has(pid), dirty: () => edits, editedAgo: () => editedAgo, bootedAt: () => booted, ...o,
  });
  return {
    q, launched, pushed, alive,
    edits: (e, ago = 0) => { edits = e; editedAgo = ago; },
    reboot: () => { booted = clock; },
    /** The running chat writes these lines to its log and stops. */
    stop: (c, lines = '', file = 'logFile') => { if (lines) appendFileSync(q.files(c.id)[file], `${lines}\n`); alive.clear(); },
  };
}

test('cutOffOf reads only Claude Code\'s own events: the limit with its reset, the internet, never tool output', () => {
  assert.deepEqual(cutOffOf(limitLines()), { why: 'limit', resetsAt: LIMIT_RESET });
  assert.deepEqual(cutOffOf(netLines()), { why: 'network' });
  assert.deepEqual(cutOffOf(ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 529 overloaded' }] }, is_api_error_message: true, api_error_status: 529 })), { why: 'network' });
  assert.equal(cutOffOf(`${netLines()}\n${ev({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'carrying on' }] } })}`), null, 'it got past the error');
  assert.equal(cutOffOf(ev({ type: 'user', message: { content: [{ type: 'tool_result', content: "You've hit your 5-hour limit, API Error: Connection error" }] } })), null, 'words a tool printed');
  assert.equal(cutOffOf(ev({ type: 'result', is_error: false, result: 'usage limit reached' })), null);
  assert.equal(cutOffOf(ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'API Error: 401 not logged in' }] }, is_api_error_message: true, api_error_status: 401 })), null, 'signed out is not a cut-off');
  assert.equal(cutOffOf('garbage\n{not json'), null);
  assert.equal(lastTry('coach change x, try 1\nA\ncoach change x, try 2\nB'), 'coach change x, try 2\nB');
});

test('his Thursday: the limit at 8:20 AM, a retry at the reset, the Mac restarting at 9:20 AM: nothing lost, it finishes', async () => {
  const m = mac();
  const c = m.q.request({ said: 'One meal time per meal everywhere' });
  await m.q.tick();
  assert.equal(m.launched.length, 1);
  clock = at('08:20');
  m.edits(['the code folder']); // the half-done edits it leaves
  m.stop(c, limitLines());
  await m.q.tick();
  let r = rec(c.id);
  assert.equal(r.status, 'queued');
  assert.equal(r.tries, 0, 'a cut-off is not a try');
  assert.equal(r.pause.why, 'limit');
  assert.equal(r.pause.until, at('08:50'), 'every 30 minutes, at most');
  assert.deepEqual(talk(), ["Claude limit hit, the Mac paused. Nothing's lost: it retries every 30 minutes and at the 9:00 AM reset, or say continue."]);
  assert.ok(talk()[0].length <= 120, 'the lock screen shows it whole');
  assert.match(whereText(r, [r], clock), /^paused \(the Claude usage limit, resets 9:00 AM; nothing lost, it picks up where it stopped\): it tries again by itself at 8:50 AM \(every 30 minutes\), or at once when he says continue \(mac_queue\)/);
  assert.match(contextLine({ store, tz: TZ, now: clock }), /being built on the Mac[^\n]*paused \(the Claude usage limit/);
  clock = at('08:49'); await m.q.tick();
  assert.equal(m.launched.length, 1, 'waits out the pause');
  // 8:50 AM: its own leftover edits (still fresh) don't hold it.
  clock = at('08:50'); await m.q.tick();
  assert.equal(m.launched.length, 2, 'retried at 8:50 AM, no 45-minute wait on its own edits');
  assert.match(m.launched[1].prompt, /CARRY ON WHERE IT STOPPED: an earlier try of this change was cut off \(the Claude usage limit at 8:20 AM\)[\s\S]*don't start over and don't throw its edits away/);
  assert.match(m.launched[1].prompt, /Unsaved edits were already in the code folder when you started \(probably your earlier try's: pick them up\)/);
  // Still limited: paused again, quietly, till a minute after the reset.
  m.stop(c, limitLines());
  await m.q.tick();
  r = rec(c.id);
  assert.equal(r.pause.until, at('09:01'));
  assert.equal(talk().length, 1, 'no second pause message');
  clock = at('09:01'); await m.q.tick();
  assert.equal(m.launched.length, 3, 'right after the reset');
  clock = at('09:02'); await m.q.tick();
  assert.equal(talk().length, 1, 'not "building again" before it has really run');
  clock = at('09:03'); await m.q.tick();
  assert.deepEqual(talk().slice(1), ['The Mac is building again, picking up where it stopped.']);
  clock = at('09:10'); await m.q.tick();
  assert.equal(talk().length, 2, 'once');
  // 9:20 AM: a software update restarts the Mac. Its pid may belong to something else now.
  clock = at('09:25'); m.reboot(); clock = at('09:27');
  await m.q.tick();
  r = rec(c.id);
  assert.equal(m.launched.length, 4, 'picked up as soon as the Mac is back');
  assert.equal(r.status, 'working');
  assert.equal(r.tries, 1);
  assert.match(m.launched[3].prompt, /cut off \(the Claude usage limit at 8:20 AM; the Claude usage limit at 8:50 AM; the Mac restarted at 9:27 AM\)/);
  clock = at('09:35');
  writeFileSync(m.q.files(c.id).resultFile, JSON.stringify({ status: 'question', said: 'Which meal first?' }));
  m.alive.clear();
  await m.q.tick();
  assert.equal(rec(c.id).status, 'question');
  assert.deepEqual(talk(), ["Claude limit hit, the Mac paused. Nothing's lost: it retries every 30 minutes and at the 9:00 AM reset, or say continue.", 'The Mac is building again, picking up where it stopped.', 'Which meal first?']);
  assert.doesNotMatch(talk().join(' '), /stopped twice|check it|console/);
});

test('he says "continue": mac_queue ends the pause at once and the next tick starts it, unsaved edits or not', async () => {
  const m = mac();
  const c = m.q.request({ said: 'Morning plan follows the session time' });
  const second = m.q.request({ said: 'Another', at: clock + 1 });
  await m.q.tick();
  clock = at('08:20');
  m.stop(c, limitLines(at('12:00')));
  await m.q.tick();
  assert.equal(rec(c.id).pause.until, at('08:50'));
  assert.match(talk()[0], /retries every 30 minutes and at the 12:00 PM reset, or say continue\.$/);
  assert.match(whereText(rec(second.id), [rec(c.id), rec(second.id)], clock), /^2nd in line, after the pause: paused/);
  clock = at('08:31');
  const ctx = { store, tz: TZ, now: () => clock, action: () => {} };
  const r = await tool('mac_queue').run({}, ctx);
  assert.equal(r.wrote, true);
  assert.match(r.text, /^The Mac starts again now, within a minute: "Morning plan follows the session time", picking up where it stopped, then 1 more\. If his limit is still used up, it pauses again and retries every 30 minutes by itself\. Tell him in one short line; nothing for him to do on the Mac\./);
  m.edits(['the private folder'], 0);
  await m.q.tick();
  assert.equal(m.launched.length, 2, 'started at once');
  assert.match((await tool('mac_queue').run({}, ctx)).text, /^The Mac is already working: "Morning plan/);
  writeFileSync(m.q.files(c.id).resultFile, JSON.stringify({ status: 'done', said: 'Done.' })); m.alive.clear();
  await m.q.tick();
  assert.equal(m.launched.length, 3, '"continue" also stops the next one waiting on fresh edits');
  writeFileSync(m.q.files(second.id).resultFile, JSON.stringify({ status: 'done', said: 'Done 2.' })); m.alive.clear();
  await m.q.tick();
  assert.match((await tool('mac_queue').run({}, ctx)).text, /^Nothing is waiting on the Mac/);
  assert.match(RULES, /call mac_queue at once/);
  assert.match(RULES, /Never tell him to check the Mac, open a console, a terminal or a chat on the Mac/);
});

test('leftover edits nobody has touched for 10 minutes don\'t hold the next change; edits still being made do', async () => {
  const m = mac();
  m.edits(['the code folder'], 15 * 60000);
  const c = m.q.request({ said: 'Shorter food nudges' });
  await m.q.tick();
  assert.equal(m.launched.length, 1, 'no 45-minute wait on stale leftovers');
  assert.match(m.launched[0].prompt, /Unsaved edits were already in the code folder when you started \(left by an earlier build that was cut off\)\. Leave them alone: never git add, commit, stash, checkout or reset them/);
  assert.doesNotMatch(m.launched[0].prompt, /CARRY ON WHERE IT STOPPED/);
  writeFileSync(m.q.files(c.id).resultFile, JSON.stringify({ status: 'question', said: 'Q?' })); m.alive.clear();
  await m.q.tick();
  m.edits(['the code folder'], 2 * 60000);
  m.q.request({ said: 'Another' });
  await m.q.tick();
  assert.equal(m.launched.length, 1, 'someone is still editing: it waits');
  clock += 9 * 60000; m.edits(['the code folder'], 11 * 60000);
  await m.q.tick();
  assert.equal(m.launched.length, 2, 'the edits went quiet: it starts');
});

test('the internet drops mid-build: back in 2 minutes, no message, not a try; 5 in a row = every 30 minutes', async () => {
  const m = mac();
  const c = m.q.request({ said: 'Walk asks' });
  await m.q.tick();
  for (let i = 1; i <= 6; i++) {
    m.stop(c, netLines());
    await m.q.tick();
    const r = rec(c.id);
    assert.equal(r.pause.why, 'network');
    assert.equal(r.pause.until - clock, i > 5 ? 30 * 60000 : 2 * 60000, `cut ${i}`);
    assert.equal(r.tries, 0);
    clock = r.pause.until; await m.q.tick();
    assert.equal(m.launched.length, i + 1);
  }
  assert.deepEqual(talk(), [], 'he hears nothing about a short drop');
});

test('the check cut off by the limit runs again on the same build once it can; he never hears "not checked"', async () => {
  const m = mac();
  const c = m.q.request({ said: 'Supplement asks' });
  await m.q.tick();
  writeFileSync(m.q.files(c.id).resultFile, JSON.stringify({ status: 'done', said: 'Done: supplements.', commits: ['abc Supps'] }));
  m.alive.clear();
  await m.q.tick();
  assert.equal(rec(c.id).stage, 'review');
  assert.match(m.launched[1].prompt, /^COACH CHANGE REVIEW/);
  clock = at('08:20');
  m.stop(c, limitLines(), 'reviewLog');
  await m.q.tick();
  let r = rec(c.id);
  assert.equal(r.status, 'queued');
  assert.equal(r.reviewAgain, true);
  assert.equal(r.build.said, 'Done: supplements.', 'the build is kept');
  assert.equal(talk().length, 1);
  clock = at('08:50'); await m.q.tick();
  assert.equal(m.launched.length, 3);
  assert.match(m.launched[2].prompt, /^COACH CHANGE REVIEW/, 'the check again, not a new build');
  r = rec(c.id);
  assert.equal(r.status, 'working');
  assert.equal(r.stage, 'review');
  assert.equal(r.reviewAgain, undefined);
  writeFileSync(m.q.files(c.id).reviewFile, JSON.stringify({ status: 'ok', said: 'Done: supplements.', checked: 'ran it' })); m.alive.clear();
  await m.q.tick();
  r = rec(c.id);
  assert.equal(r.status, 'done');
  assert.equal(r.reviewed, true);
  assert.equal(talk().at(-1), 'Done: supplements.');
});

test('the Mac restarted while a reviewer ran: the check runs again at once', async () => {
  const m = mac();
  const c = m.q.request({ said: 'Holds' });
  await m.q.tick();
  writeFileSync(m.q.files(c.id).resultFile, JSON.stringify({ status: 'done', said: 'Done: holds.', commits: ['abc Holds'] }));
  m.alive.clear();
  await m.q.tick();
  clock += 5 * 60000; m.reboot(); clock += 60000;
  await m.q.tick();
  assert.equal(m.launched.length, 3);
  assert.match(m.launched[2].prompt, /^COACH CHANGE REVIEW/);
  assert.equal(rec(c.id).stage, 'review');
  assert.deepEqual(talk(), []);
});

test('Mac status in plain words (Thu 11/5 9:02 AM: "I didn\'t get much from the message... 9.45am, I\'m confused")', () => {
  // The rule: working or paused, why in one line, when it carries on, what he has to do; none of the Mac's own words.
  assert.match(RULES, /Mac status in plain words/);
  assert.match(RULES, /1\) working or paused/);
  assert.match(RULES, /2\) only when paused, why in one simple line/);
  assert.match(RULES, /3\) when it carries on/);
  assert.match(RULES, /4\) what he has to do, normally "Nothing for you to do\."/);
  assert.match(RULES, /no edits, half-saved, unsaved, leftovers, queue, builder/);
  assert.match(RULES, /Never a time without what happens at it/);
  // What the coach reads about a change held behind a cut-off build's leftovers: plain, and nothing for him to do.
  const now = Date.parse('2026-11-05T02:00:00Z');
  const q = { id: 'q', status: 'queued', at: now - 60000, waitingFor: ['the code folder'] };
  const w = whereText(q, [q], now);
  assert.match(w, /a build that was cut off/);
  assert.match(w, /starts by itself/);
  assert.match(w, /nothing for him to do/);
  assert.doesNotMatch(w, /unsaved edits on the Mac|code folder/);
});
