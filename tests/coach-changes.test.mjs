// Thu 10/22: the coach rebuilds itself. His complaint in Talk -> request_change -> the Mac's builder -> "Done" in Talk.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openChanges, builderPrompt, excerptOf, guardSettings, COL } from '../server/coach/changes.mjs';
import { refusal } from '../server/coach/change-guard.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { contextLine } from '../server/coach/tools-read.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-19') => Date.parse(`${d}T${hm}:00+07:00`);
let dir; let store; let clock;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-changes-')); store = openStore(join(dir, 'db.sqlite')); clock = at('09:24'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const tool = (name) => WRITE_TOOLS.find((t) => t.name === name);
const ctx = () => ({ store, tz: TZ, now: () => clock, action: () => {} });
const msg = (id, role, text, hm, extra = {}) => store.writeLocal('coach-messages', id, { id, role, text, at: at(hm), tz: TZ, ...extra });
const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.kind === 'change');

function queue(o = {}) {
  const launched = []; const pushed = []; let restarts = 0; const alive = new Set(); let workout = false;
  const q = openChanges({
    store, codeDir: '/code', privateDir: dir, tz: () => TZ, now: () => clock,
    push: { list: () => [{}], notify: async (n) => { pushed.push(n); return { sent: 1 }; } },
    launch: (a) => { launched.push(a); const pid = 1000 + launched.length; alive.add(pid); return pid; },
    isAlive: (pid) => alive.has(pid), restart: () => { restarts++; }, busy: () => workout, ...o,
  });
  return { q, launched, pushed, alive, restarts: () => restarts, training: (v) => { workout = v; } };
}

test('his complaint in Talk: the coach files it with his words and the conversation, and follows it already', async () => {
  msg('m1', 'user', 'Yo, I fell asleep before 12am and woke up before 9am', '09:15');
  msg('m2', 'assistant', 'Logged. Legs is up today and the check-in isn\'t done. Want to do it now?', '09:15');
  msg('m3', 'assistant', 'Sore, or good to go? Legs at 9:50 AM.', '09:24', { kind: 'reminder' });
  msg('m4', 'user', 'Why tell me the check-in right after I woke up? Say good morning first.', '09:24');
  const r = await tool('request_change').run({ said: 'Why tell me the check-in right after I woke up? Say good morning first.', about: '9:15 AM: check-in pushed right after logging sleep', want: 'good morning, name the session, one short question', kind: 'personality' }, ctx());
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Sent to the Mac \[id chg\./);
  const c = store.listRecords(COL)[0].data;
  assert.equal(c.status, 'queued');
  assert.equal(c.kind, 'personality');
  assert.match(c.context, /9:15 AM He: Yo, I fell asleep[\s\S]*9:24 AM Coach \(reminder, sent by the app\): Sore, or good to go\?[\s\S]*9:24 AM He: Why tell me/);
  const line = contextLine({ store, tz: TZ, now: clock });
  assert.match(line, /Changes he asked for, being built on the Mac \(follow them yourself already\): \[Thursday 3\/19 9:24 AM, waiting\] "Why tell me the check-in/);
  assert.match(RULES, /call request_change at once, without asking first/);
  assert.equal((await tool('request_change').run({ said: 'x' }, ctx())).text.startsWith('Sent to the Mac (1 ahead of it)'), true);
  const second = store.listRecords(COL).map((x) => x.data).find((x) => x.said === 'x');
  assert.match((await tool('request_change').run({ cancel: second.id }, ctx())).text, /^Cancelled/);
  assert.equal(store.getRecord(COL, second.id).data.status, 'cancelled');
});

test('the builder: started detached in the private folder with the guard; its answer lands in Talk and as a notification', async () => {
  const { q, launched, pushed, alive, restarts, training } = queue();
  msg('m1', 'user', 'Stop the supplement message after a snack', '09:22');
  const c = q.request({ said: 'Stop the supplement message after a snack', want: 'supplements after the first and second meal only', kind: 'behaviour' });
  await q.tick();
  assert.equal(launched.length, 1);
  assert.equal(launched[0].cwd, dir);
  assert.match(launched[0].prompt, /^COACH CHANGE chg\./);
  assert.match(launched[0].prompt, /His words: "Stop the supplement message after a snack"/);
  assert.match(launched[0].prompt, /Never weaken a safety rule/);
  assert.match(launched[0].prompt, new RegExp(`write ${q.files(c.id).resultFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(JSON.parse(launched[0].settings).hooks.PreToolUse[0].hooks[0].command, /change-guard\.mjs' '\/code'/);
  assert.equal(store.getRecord(COL, c.id).data.status, 'working');
  await q.tick();
  assert.equal(launched.length, 1, 'one builder at a time, and no second start while it runs');
  clock += 8 * 60000;
  writeFileSync(q.files(c.id).resultFile, JSON.stringify({ status: 'done', said: 'Done: no supplement message after a snack any more.', reload: true, commits: ['abc123 Supplements wait for a real meal'] }));
  alive.clear();
  training(true);
  await q.tick();
  const done = store.getRecord(COL, c.id).data;
  assert.equal(done.status, 'done');
  assert.equal(done.said, 'Stop the supplement message after a snack', 'his words stay');
  assert.equal(done.answer, 'Done: no supplement message after a snack any more.');
  assert.deepEqual(talk().map((m) => m.text), ['Done: no supplement message after a snack any more.']);
  assert.equal(talk()[0].ref, `change:${c.id}`);
  assert.deepEqual(pushed.map((p) => [p.title, p.url]), [['Coach', '#/coach']]);
  assert.equal(restarts(), 0, 'not while he trains');
  await q.tick();
  assert.equal(restarts(), 0);
  training(false);
  await q.tick();
  assert.equal(restarts(), 1, 'server code changed: the server restarts itself once the workout is over');
  assert.match(contextLine({ store, tz: TZ, now: clock }), /Changes finished in the last day[^\n]*\[Thursday 3\/19 9:32 AM, done\] "Stop the supplement message after a snack" -> Done: no supplement/);
});

test('a builder that stops without an answer runs once more, then he hears it failed; no daily limit', async () => {
  const { q, launched, alive } = queue();
  const c = q.request({ said: 'Talk less robotic' });
  await q.tick();
  alive.clear();
  await q.tick();
  assert.equal(store.getRecord(COL, c.id).data.status, 'working', 'started again after the first stop');
  assert.equal(store.getRecord(COL, c.id).data.tries, 2);
  assert.equal(launched.length, 2);
  alive.clear();
  await q.tick();
  assert.equal(store.getRecord(COL, c.id).data.status, 'failed');
  assert.match(talk()[0].text, /didn't finish on the Mac \(the builder stopped twice\)/);
  // Thu 10/22, his words: "Don't have a daily build limit": the next one starts straight away.
  q.request({ said: 'Another one' });
  await q.tick();
  assert.equal(launched.length, 3);
  assert.equal(existsSync(q.files(c.id).logFile), true);
});

test('the builder\'s prompt and hooks carry no personal details and quote the conversation', () => {
  const c = { id: 'chg.1', at: at('22:02', '2026-03-18'), tz: TZ, said: 'mark them as kept', kind: 'behaviour', context: excerptOf([{ role: 'user', text: 'I am not doing any tendons today', at: at('22:02', '2026-03-18') }, { role: 'assistant', text: 'Hold reminders are off until Thursday at 12:00 AM.', at: at('22:02', '2026-03-18') + 5000 }], { tz: TZ, at: at('22:03', '2026-03-18') }) };
  const p = builderPrompt(c, { codeDir: '/code', privateDir: '/priv', resultFile: '/priv/logs/coach-changes/chg.1.result.json' });
  assert.match(p, /10:02 PM He: I am not doing any tendons today\n10:02 PM Coach: Hold reminders are off/);
  assert.match(p, /Wednesday 3\/18, 10:02 PM/);
  assert.doesNotMatch(p, /Michael|zedoboss|Ho Chi Minh|Vinhomes/);
  assert.match(guardSettings({ node: '/usr/bin/node', guard: "/g/it's.mjs", codeDir: '/code', privateDir: '/priv' }), /'\/g\/it'\\\\''s\.mjs'/);
});

test('the guard refuses the read-only folders, the keys, the real database and server, force pushes', () => {
  const dirs = { codeDir: '/Users/x/Documents/training-hq', privateDir: '/Users/x/Documents/training-hq-private', home: '/Users/x' };
  const no = (tool_name, tool_input) => refusal({ tool_name, tool_input, cwd: dirs.privateDir }, dirs);
  assert.equal(no('Edit', { file_path: '/Users/x/Documents/training-hq/server/notify.mjs' }), '');
  assert.equal(no('Edit', { file_path: 'data/coach/profile.md' }), '');
  assert.equal(no('Write', { file_path: '/private/tmp/claude-501/x/scratchpad/devprivate/config/server.json' }), '');
  assert.match(no('Edit', { file_path: '/Users/x/Documents/Celestial Vault/Exercise/Tendons.md' }), /Read only/);
  assert.match(no('Write', { file_path: 'config/elevenlabs.json' }), /keys/);
  assert.match(no('Read', { file_path: '/Users/x/Documents/training-hq-private/config/vapid.json' }), /keys/);
  assert.match(no('Edit', { file_path: 'BRIEF.md' }), /his/);
  assert.match(no('Write', { file_path: '/Users/x/Desktop/a.txt' }), /Write only in/);
  assert.match(no('Bash', { command: 'cat config/elevenlabs.json' }), /keys/);
  assert.match(no('Bash', { command: 'ls ~/.celestial-globe' }), /alone/);
  assert.match(no('Bash', { command: 'launchctl kickstart -k gui/501/com.traininghq.server' }), /restart/);
  assert.match(no('Bash', { command: 'sqlite3 data/training-hq.sqlite "delete from records"' }), /database/);
  assert.equal(no('Bash', { command: 'sqlite3 -readonly data/training-hq.sqlite "select 1"' }), '');
  assert.match(no('Bash', { command: 'git push --force origin main' }), /force/);
  assert.equal(no('Bash', { command: 'git push origin main && mkdir -p $D/config' }), '');
  assert.equal(no('Bash', { command: 'npm test' }), '');
});
