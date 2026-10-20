// The coach's voice player on the phone (9.6). Tue 10/20: the chip stuck on SPEAKING; whatever the network or the
// audio does, speaking must end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../app/js/lib/voice-player.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fake AudioContext whose clock is real time. */
function fakeContext({ failOn = null } = {}) {
  const t0 = Date.now();
  return {
    state: 'running', destination: {},
    get currentTime() { return (Date.now() - t0) / 1000; },
    createBuffer(ch, len, rate) { if (failOn === 'buffer') throw new Error('broken'); return { duration: len / rate, copyToChannel() {} }; },
    createBufferSource() { return { connect() {}, start() {}, stop() {}, onended: null }; },
  };
}

/** A speech answer we feed by hand: push(bytes), end(), or never. */
function stream() {
  let ctl;
  const body = new ReadableStream({ start(c) { ctl = c; } });
  return { res: new Response(body, { status: 200 }), push: (n = 480) => ctl.enqueue(new Uint8Array(n)), end: () => ctl.close() };
}

function setup(opts = {}) {
  const states = []; const asked = []; const streams = [];
  const player = createPlayer({
    context: () => opts.ctx || fakeContext(),
    fetchSpeech: (text, signal) => {
      asked.push(text);
      if (opts.never?.includes(text)) return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
      const s = stream(); streams.push(s);
      return Promise.resolve(s.res);
    },
    onState: (on) => states.push(on),
    stallMs: 80, firstByteMs: 120,
  });
  return { player, states, asked, streams };
}

test('one sentence: speaking, then done when its sound has played', async () => {
  const { player, states, streams } = setup();
  player.say('Go.');
  await sleep(10);
  assert.equal(player.speaking, true);
  streams[0].push(480); streams[0].end();
  await sleep(150);
  assert.equal(player.speaking, false);
  assert.deepEqual(states, [true, false]);
});

test('a sentence whose audio never comes is given up; the next one still plays and speaking ends', async () => {
  const { player, states, asked, streams } = setup({ never: ['Lost.'] });
  player.say('Lost.'); player.say('Next.');
  await sleep(20);
  assert.deepEqual(asked, ['Lost.', 'Next.']);
  streams[0].push(480); streams[0].end(); // "Next." arrives; "Lost." never does
  await sleep(300);
  assert.equal(player.speaking, false);
  assert.deepEqual(states, [true, false]);
});

test('a sentence that stops halfway is dropped after the stall time', async () => {
  const { player, states, streams } = setup();
  player.say('Half.');
  await sleep(10);
  streams[0].push(480); // then nothing, and the stream never ends
  await sleep(250);
  assert.equal(player.speaking, false);
  assert.deepEqual(states, [true, false]);
});

test('an audio error ends speaking instead of leaving it on; the player still works after', async () => {
  const bad = fakeContext({ failOn: 'buffer' });
  const { player, states, streams } = setup({ ctx: bad });
  player.say('Boom.');
  await sleep(10);
  streams[0].push(480); streams[0].end();
  await sleep(50);
  assert.equal(player.speaking, false);
  assert.deepEqual(states, [true, false]);
});

test('a sentence queued while the last one finishes plays too; stop() ends at once', async () => {
  const { player, states, asked, streams } = setup();
  player.say('One.');
  await sleep(10);
  streams[0].push(4800); streams[0].end(); // 100 ms of sound
  await sleep(30);
  player.say('Two.');
  await sleep(20);
  assert.deepEqual(asked, ['One.', 'Two.']);
  streams[1].push(480); streams[1].end();
  await sleep(250);
  assert.equal(player.speaking, false);
  assert.deepEqual(states, [true, false]);
  player.say('Three.');
  await sleep(10);
  player.stop();
  assert.equal(player.speaking, false);
  assert.deepEqual(states, [true, false, true, false]);
});
