// Thu 11/5, 7:05 PM, his words: "I was talking and randomly it said the Mac was unavailable... prevents me mid-talking".
// The phone's Tailscale relay stalled about 35 s and came back by itself. A blip like that is ridden out: the clip is
// sent again, the screen says reconnecting (not unreachable) for the first minute, and sync tries again in seconds.
// Made-up data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sendRiding, RETRY_WAITS } from '../app/js/lib/dictate-keep.js';
import { macLink, nextSyncMs, BLIP_MS, downSinceNext } from '../app/js/lib/mac-reach.js';

const cut = () => { throw new Error('Mac unreachable. Try again when it is connected.'); };

test('a clip cut by a blip is sent again and its words come back, with no error', async () => {
  let calls = 0; const waited = []; const retries = [];
  const send = async () => { calls += 1; if (calls <= 2) cut(); return 'run 20 minutes after Pull'; };
  const text = await sendRiding(send, 'wav', { sleep: async (ms) => { waited.push(ms); }, onRetry: (n) => retries.push(n) });
  assert.equal(text, 'run 20 minutes after Pull');
  assert.equal(calls, 3);
  assert.deepEqual(waited, [2000, 4000]);
  assert.deepEqual(retries, [1, 2]);
});

test('the blip window covers a 35 s stall (about a minute in all), then the clip is kept as before', async () => {
  assert.ok(RETRY_WAITS.reduce((a, b) => a + b, 0) >= 45000);
  let calls = 0;
  await assert.rejects(sendRiding(async () => { calls += 1; cut(); }, 'wav', { sleep: async () => {} }), /unreachable/);
  assert.equal(calls, RETRY_WAITS.length + 1);
});

test('the Mac answering with its own error is not retried', async () => {
  let calls = 0;
  await assert.rejects(sendRiding(async () => { calls += 1; throw new Error('Whisper is not installed'); }, 'wav', { sleep: async () => {} }), /Whisper/);
  assert.equal(calls, 1);
});

test('the coach screen says reconnecting for the first minute of a drop, unreachable only after', () => {
  const t0 = 1_000_000;
  const down = downSinceNext(null, false, t0);
  assert.equal(macLink({ reachable: false, downSince: down, now: t0 + 35000 }), 'reconnecting');
  assert.equal(macLink({ reachable: false, downSince: down, now: t0 + BLIP_MS - 1 }), 'reconnecting');
  assert.equal(macLink({ reachable: false, downSince: down, now: t0 + BLIP_MS }), 'down');
  assert.equal(macLink({ reachable: true, downSince: null, now: t0 }), 'ok');
  assert.equal(macLink({ reachable: null, downSince: null, now: t0 }), 'ok', 'not checked yet: no alarm');
});

test('after a failed sync the next one comes in seconds, backing off to the usual 30 s', () => {
  assert.equal(nextSyncMs(true, 0), 30000);
  assert.deepEqual([1, 2, 3, 4, 10].map((n) => nextSyncMs(false, n)), [5000, 10000, 20000, 30000, 30000]);
});

test('while he records, the coach screen never says the Mac is unreachable', () => {
  const src = readFileSync(new URL('../app/js/views/coach.js', import.meta.url), 'utf8');
  const idle = src.slice(src.indexOf('const idleState'), src.indexOf('const drawModel'));
  assert.ok(idle.indexOf("micPhase === 'rec'") < idle.indexOf("'MAC UNREACHABLE'"), 'recording is checked first');
  assert.match(src, /d\.stop\(\{ onRetry/);
  assert.doesNotMatch(src, /catch\(\(\) => \{ if \(!busy\) setState\('MAC UNREACHABLE'/, 'one failed warm-up no longer flips it');
});
