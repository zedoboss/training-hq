import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { openCoachProcess, coachArgs } from '../server/coach/process.mjs';

const say = (proc, obj) => proc.stdout.write(`${JSON.stringify(obj)}\n`);
const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const blockStart = (type = 'text', name) => ({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type, ...(name ? { name } : {}) } } });
const ok = (result = '') => ({ type: 'result', subtype: 'success', is_error: false, result });

/** A fake Claude Code: `script(msg, proc, n)` answers each user message written to stdin. */
function fake(script = (m, proc) => { say(proc, blockStart()); say(proc, delta('Hi ')); say(proc, delta('there.')); say(proc, ok('Hi there.')); }) {
  const calls = [];
  const spawn = (path, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    const c = { path, args, opts, proc, msgs: [], killed: false };
    proc.stdin = new Writable({
      write(chunk, enc, cb) {
        for (const line of String(chunk).split('\n').filter(Boolean)) { const m = JSON.parse(line); c.msgs.push(m); setImmediate(() => script(m, proc, c.msgs.length)); }
        cb();
      },
    });
    proc.kill = () => { if (c.killed) return; c.killed = true; setImmediate(() => proc.emit('close', null)); };
    calls.push(c);
    return proc;
  };
  return { spawn, calls };
}

const open = (f, extra = {}) => openCoachProcess({ system: () => 'SYSTEM', mcpUrl: () => 'http://127.0.0.1:1/mcp/x', claude: () => '/fake/claude', spawn: f.spawn, ...extra });
const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('the command line matches the reference: print mode, stream-json both ways, own tools only', () => {
  const a = coachArgs({ system: 'S', mcpUrl: 'http://127.0.0.1:9/mcp/abc', model: 'claude-sonnet-5-5', effort: 'low' });
  for (const f of ['-p', '--verbose', '--include-partial-messages', '--strict-mcp-config', '--no-session-persistence']) assert.ok(a.includes(f), f);
  assert.equal(argAfter(a, '--input-format'), 'stream-json');
  assert.equal(argAfter(a, '--output-format'), 'stream-json');
  assert.equal(argAfter(a, '--tools'), '', 'built-in tools off');
  assert.equal(argAfter(a, '--allowedTools'), 'mcp__thq');
  assert.equal(argAfter(a, '--setting-sources'), '');
  assert.equal(argAfter(a, '--model'), 'claude-sonnet-5-5');
  assert.equal(argAfter(a, '--effort'), 'low');
  assert.deepEqual(JSON.parse(argAfter(a, '--mcp-config')), { mcpServers: { thq: { type: 'http', url: 'http://127.0.0.1:9/mcp/abc' } } });
});

test('one process for many turns; the reply streams; content is worked out when the turn starts', async () => {
  const f = fake();
  const p = open(f);
  const seen = [];
  const fresh = [];
  const r1 = await p.turn({ content: ({ fresh: x }) => { fresh.push(x); return 'one'; }, onEvent: (e) => seen.push(e) });
  assert.equal(r1.text, 'Hi there.');
  assert.equal(r1.model, 'claude-sonnet-5-5');
  assert.deepEqual(seen.map((e) => e.delta), ['Hi ', 'there.']);
  await p.turn({ content: ({ fresh: x }) => { fresh.push(x); return 'two'; } });
  assert.equal(f.calls.length, 1, 'the same process answered both');
  assert.deepEqual(fresh, [true, false]);
  assert.deepEqual(f.calls[0].msgs.map((m) => m.message.content), ['one', 'two']);
  assert.equal(f.calls[0].opts.env.ENABLE_TOOL_SEARCH, 'false');
  assert.equal(p.status().turns, 2);
  p.close();
});

test('text blocks around a tool call are joined with a blank line; tool starts are reported', async () => {
  const f = fake((m, proc) => {
    say(proc, blockStart()); say(proc, delta('Checking.'));
    say(proc, blockStart('tool_use', 'mcp__thq__today'));
    say(proc, blockStart()); say(proc, delta('Legs today.'));
    say(proc, ok('Legs today.'));
  });
  const p = open(f);
  const ev = [];
  const r = await p.turn({ content: 'x', onEvent: (e) => ev.push(e) });
  assert.equal(r.text, 'Checking.\n\nLegs today.');
  assert.ok(ev.some((e) => e.type === 'tool-start' && e.name === 'today'));
  p.close();
});

test('messages wait their turn: the second is written only after the first is answered', async () => {
  let release;
  const f = fake((m, proc, n) => {
    if (n === 1) release = () => say(proc, ok('first'));
    else say(proc, ok('second'));
  });
  const p = open(f);
  const a = p.turn({ content: 'a' });
  const b = p.turn({ content: 'b' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.calls[0].msgs.length, 1, 'b is not sent while a is open');
  release();
  assert.equal((await a).text, 'first');
  assert.equal((await b).text, 'second');
  p.close();
});

test('another model or a changed system prompt restarts the process', async () => {
  const f = fake();
  let sys = 'A';
  const p = open(f, { system: () => sys });
  await p.turn({ content: 'x' });
  assert.equal(p.fresh('deep'), true);
  const r = await p.turn({ content: 'y', model: 'deep' });
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].killed, true);
  assert.equal(argAfter(f.calls[1].args, '--effort'), 'high');
  sys = 'B';
  assert.equal(p.fresh('deep'), true);
  await p.turn({ content: 'z', model: 'deep' });
  assert.equal(f.calls.length, 3);
  assert.equal(argAfter(f.calls[2].args, '--system-prompt'), 'B');
  p.close();
});

test('not logged in: a plain message and the process is stopped', async () => {
  const f = fake((m, proc) => say(proc, { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' }));
  const p = open(f);
  await assert.rejects(p.turn({ content: 'x' }), /not logged in/);
  assert.equal(f.calls[0].killed, true);
  p.close();
});

test('no answer in time, or the process dies mid-turn: the turn fails and the next one starts fresh', async () => {
  const silent = fake(() => {});
  const p = open(silent, { timeouts: { fast: 40, deep: 40 } });
  await assert.rejects(p.turn({ content: 'x' }), /did not answer within/);
  assert.equal(silent.calls[0].killed, true);
  p.close();

  const dying = fake((m, proc, n) => { if (n === 1) { proc.stderr.write('boom\n'); proc.emit('close', 1); } });
  const q = open(dying);
  await assert.rejects(q.turn({ content: 'x' }), /stopped \(1\): boom/);
  q.close();
  const healthy = fake();
  const q2 = open(healthy);
  assert.equal((await q2.turn({ content: 'y' })).text, 'Hi there.');
  q2.close();
});

test('stop ends the turn in flight; Claude Code missing is a plain message', async () => {
  const f = fake(() => {});
  const p = open(f);
  const t = p.turn({ content: 'x' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(p.status().busy, true);
  assert.equal(p.stop(), true);
  await assert.rejects(t, /Stopped/);
  assert.equal(p.status().running, false);
  const none = openCoachProcess({ system: () => 'S', mcpUrl: () => 'u', claude: () => null, spawn: f.spawn });
  await assert.rejects(none.turn({ content: 'x' }), /not found on the Mac/);
  assert.equal(none.warm(), false);
});

test('warm starts the process without a turn; idle stops it', async () => {
  const f = fake();
  const p = open(f, { idleMs: 30 });
  assert.equal(p.warm('fast'), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].msgs.length, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(p.status().running, false);
  p.close();
});
