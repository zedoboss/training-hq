// Thu 11/5, his words: "when I stopped on the whisper mic, it said the Mac lost connection and after that it wasn't
// working. I restarted the app, nothing." A clip that can't reach the Mac is kept on the phone and sent by itself,
// once, when the Mac answers again; the words go into the chat box. Made-up data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flushKept, cacheStore, isUnreachable, joinDraft, KEPT_MESSAGE, MAX_TRIES } from '../app/js/lib/dictate-keep.js';

// Cache Storage as the phone has it, in memory.
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async put(url, res) { m.set(String(url), await res.arrayBuffer()); },
        async keys() { return [...m.keys()].map((url) => ({ url })); },
        async match(req) { const b = m.get(req.url); return b ? new Response(b) : undefined; },
        async delete(url) { return m.delete(String(url)); },
      };
    },
  };
}
const clip = (s) => new TextEncoder().encode(s);
const UNREACHABLE = () => { throw new Error('Mac unreachable. Try again when it is connected.'); };

test('the messages the phone throws when the Mac is out of reach count as unreachable; the Mac\'s own errors don\'t', () => {
  for (const m of ['Mac unreachable. Try again when it is connected.', 'Failed to fetch', 'Load failed', 'The network connection was lost.', 'The operation was aborted.']) assert.ok(isUnreachable(new Error(m)), m);
  for (const m of ['Mac answered 500', 'Whisper could not start', 'Pair with your Mac first (Settings).']) assert.ok(!isUnreachable(new Error(m)), m);
  assert.ok(KEPT_MESSAGE.length <= 200);
  assert.match(KEPT_MESSAGE, /Tailscale/);
  assert.match(KEPT_MESSAGE, /kept/);
  assert.match(KEPT_MESSAGE, /turn it off and on/);
});

test('his case: Mac out of reach for half an hour, clip kept through an app restart, sent once when it is back', async () => {
  const caches = fakeCaches();
  const box = []; const sent = [];
  let reachable = false;
  const send = async (wav) => { if (!reachable) UNREACHABLE(); sent.push(new TextDecoder().decode(await new Response(wav).arrayBuffer())); return ` words ${sent.length} `; };
  // He stops the mic twice while the phone's Tailscale is down.
  await cacheStore(caches).keep(1000, clip('first'));
  await cacheStore(caches).keep(2000, clip('second'));
  // Retries while it's still down: nothing lost, nothing sent.
  for (let i = 0; i < 3; i++) {
    const r = await flushKept({ ...cacheStore(caches), send, onText: (t) => box.push(t) });
    assert.deepEqual(r, { sent: 0, waiting: true });
  }
  assert.equal(await cacheStore(caches).count(), 2, 'both kept');
  // App restarted (a new store over the same Cache Storage), then the Mac answers again.
  reachable = true;
  const st = cacheStore(caches);
  const r = await flushKept({ ...st, send, onText: (t, at) => box.push([t, at]) });
  assert.deepEqual(r, { sent: 2, waiting: false });
  assert.deepEqual(sent, ['first', 'second'], 'oldest first');
  assert.deepEqual(box, [['words 1', 1000], ['words 2', 2000]], 'trimmed words with when he said them');
  assert.equal(await st.count(), 0);
  // Sent once: another try sends nothing more.
  assert.deepEqual(await flushKept({ ...st, send, onText: (t) => box.push(t) }), { sent: 0, waiting: false });
  assert.equal(sent.length, 2);
});

test('the Mac drops again halfway: what went through is out, the rest stays kept in order', async () => {
  const caches = fakeCaches(); const st = cacheStore(caches);
  await st.keep(3000, clip('c')); await st.keep(1000, clip('a')); await st.keep(2000, clip('b'));
  let n = 0; const box = [];
  const send = async () => { n += 1; if (n === 2) UNREACHABLE(); return `w${n}`; };
  assert.deepEqual(await flushKept({ ...st, send, onText: (t) => box.push(t) }), { sent: 1, waiting: true });
  assert.deepEqual(box, ['w1']);
  assert.deepEqual((await st.list()).map((c) => c.at).sort(), [2000, 3000]);
});

test('the Mac answers but can\'t read a clip: tried 3 times, then kept and left alone; the others still go', async () => {
  const caches = fakeCaches(); const st = cacheStore(caches);
  await st.keep(1000, clip('bad')); await st.keep(2000, clip('good'));
  const fails = []; const box = [];
  const send = async (wav) => { const s = new TextDecoder().decode(await new Response(wav).arrayBuffer()); if (s === 'bad') throw new Error('Mac answered 500'); return 'fine'; };
  let r = await flushKept({ ...st, send, onText: (t) => box.push(t), onFail: (e, at) => fails.push(at) });
  assert.deepEqual(r, { sent: 1, waiting: false });
  assert.deepEqual(box, ['fine']);
  for (let i = 1; i < MAX_TRIES + 2; i++) r = await flushKept({ ...st, send, onText: (t) => box.push(t), onFail: (e, at) => fails.push(at) });
  assert.equal(fails.length, MAX_TRIES, 'no endless retries');
  const left = await st.list();
  assert.equal(left.length, 1, 'never thrown away');
  assert.equal(left[0].tries, MAX_TRIES);
});

test('the words join what is already in the box', () => {
  assert.equal(joinDraft('', 'hello'), 'hello');
  assert.equal(joinDraft(null, 'hello'), 'hello');
  assert.equal(joinDraft('Legs today ', 'and knees at 1'), 'Legs today and knees at 1');
});

test('wiring: the mic keeps an unreachable clip, the app watches from start, the chat box shows the words', () => {
  const dict = readFileSync(new URL('../app/js/lib/dictate.js', import.meta.url), 'utf8');
  assert.match(dict, /if \(!isUnreachable\(e\)\) throw e;\s*await store\(\)\.keep\(Date\.now\(\), wav\);/);
  assert.match(dict, /thq\.coach\.draft/);
  const main = readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /watchKept\(/);
  const coach = readFileSync(new URL('../app/js/views/coach.js', import.meta.url), 'utf8');
  assert.match(coach, /const DRAFT = 'thq\.coach\.draft'/, 'same draft key as the mic');
  assert.match(coach, /addEventListener\('thq:dictation'/);
  assert.match(coach, /removeEventListener\('thq:dictation'/);
});
