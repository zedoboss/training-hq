// Claude Code's own sign-in (Thu 11/5): the server hands every Claude it starts the 1-year token from
// scripts/claude-login.mjs, says plainly how to sign in again, and warns 14 days before the token runs out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeToken, claudeEnv, signInWarning, isSignedOut, SIGNED_OUT, SIGN_IN_CMD } from '../server/claude.mjs';
import { openCoachProcess } from '../server/coach/process.mjs';

const DAY = 86400000;

test('claudeToken reads the saved file; a missing, broken or empty one is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-tok-'));
  const f = join(dir, 'claude-token.json');
  assert.equal(claudeToken(f), null);
  writeFileSync(f, '{nope');
  assert.equal(claudeToken(f), null);
  writeFileSync(f, JSON.stringify({ token: '' }));
  assert.equal(claudeToken(f), null);
  writeFileSync(f, JSON.stringify({ token: 'sk-ant-oat01-abc', expiresAt: 5 }));
  assert.deepEqual(claudeToken(f), { token: 'sk-ant-oat01-abc', expiresAt: 5 });
});

test('claudeEnv adds the token, keeps extras, never overrides a token already set', () => {
  const token = { token: 'sk-ant-oat01-saved' };
  const env = claudeEnv({ ENABLE_TOOL_SEARCH: 'false' }, { base: { HOME: '/h' }, token });
  assert.deepEqual(env, { HOME: '/h', ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-saved' });
  assert.equal(claudeEnv({}, { base: { CLAUDE_CODE_OAUTH_TOKEN: 'mine' }, token }).CLAUDE_CODE_OAUTH_TOKEN, 'mine');
  assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in claudeEnv({}, { base: {}, token: null }), false);
});

test('signed out: the message names the command, not "open the Claude app"', () => {
  assert.ok(isSignedOut('Not logged in · Please run /login'));
  assert.ok(isSignedOut('OAuth token has expired'));
  assert.ok(isSignedOut('Invalid authentication credentials'));
  assert.equal(isSignedOut('Prompt is too long'), false);
  assert.match(SIGNED_OUT, /not logged in/);
  assert.ok(SIGNED_OUT.includes(SIGN_IN_CMD));
  assert.doesNotMatch(SIGNED_OUT, /Open the Claude app/);
});

test('warning: none until 14 days before, then days left, then "ran out"', () => {
  const now = Date.UTC(2027, 9, 1, 3);
  const t = (days) => ({ token: 'x', expiresAt: now + days * DAY });
  assert.equal(signInWarning(null, now), null);
  assert.equal(signInWarning({ token: 'x' }, now), null);
  assert.equal(signInWarning(t(30), now), null);
  assert.equal(signInWarning(t(15), now), null);
  assert.match(signInWarning(t(14), now), /runs out in 14 days/);
  assert.match(signInWarning(t(1.5), now), /runs out tomorrow/);
  assert.match(signInWarning(t(-1), now), /ran out/);
  assert.ok(signInWarning(t(3), now).includes(SIGN_IN_CMD));
});

test('the coach process starts Claude with the saved token in its environment', async () => {
  const calls = [];
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Writable } = await import('node:stream');
  const spawn = (path, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.stdin = new Writable({ write(chunk, enc, cb) { proc.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' })}\n`); cb(); } });
    proc.kill = () => {};
    calls.push(opts);
    return proc;
  };
  const p = openCoachProcess({ system: () => 's', mcpUrl: () => 'http://x', claude: () => '/fake/claude', spawn });
  const r = await p.turn({ content: 'hi' });
  assert.equal(r.text, 'OK');
  assert.equal(calls[0].env.ENABLE_TOOL_SEARCH, 'false');
  // Whatever the Mac has saved (or nothing): the same as claudeEnv gives.
  assert.equal(calls[0].env.CLAUDE_CODE_OAUTH_TOKEN, claudeEnv().CLAUDE_CODE_OAUTH_TOKEN);
  p.stop?.();
});
