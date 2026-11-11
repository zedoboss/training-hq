// Wed 11/11, 3:33 PM: "I'll stick with... Fuck it, I'll go now." was logged as out walking ("Got it, you're out walking
// from 3:33 PM... I'll check in around 4:15 PM to see if you're back"). His words at 3:34 PM: "I'm not walking right now.
// Give me a bit. I'll tell you when I'm walking." About to go is a short plan; out walking only once he says he's walking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkingNow, emptyWalk } from '../app/js/lib/walks.js';
import { openStore } from '../server/store.mjs';
import { toldWalking } from '../server/notify.mjs';
import { RULES } from '../server/coach/prompt.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';

const D = '2026-11-11';
const at = (hm) => Date.parse(`${D}T${hm}:00+07:00`);
const HIS = [['15:31', 'Later in 30 mins'], ['15:31', 'And now? No rain risk?'],
  ['15:32', "It's not raining and it's not really that cloudy. I see a bit of the sky mostly."],
  ['15:33', "I'll stick with... Fuck it, I'll go now."],
  ['15:34', "I'm not walking right now. Give me a bit. I'll tell you when I'm walking. But just be aware that I'm going to start walking soon."]];

test('about to go is no walk now: his afternoon, and the cases around it', () => {
  for (const [, t] of HIS) assert.equal(walkingNow(t), null, t);
  for (const t of ["I'm about to walk", 'about to go for a walk', 'Im gonna walk soon', "I'll tell you when I'm walking", 'Give me a bit then im walking',
    'Once im walking ill tell you', 'Shower first, then im going for a walk', "I'll go now", 'going soon', 'Im walking in a bit']) {
    assert.equal(walkingNow(t), null, t);
  }
  // Still a walk now when he says he's walking (Tue 11/10's mall line stays live).
  for (const [t, indoor] of [["Ok I'm walking now", false], ['Im out walking', false], ['im walking', false], ['Im gonna walk around in the mall for a bit remind me supplements in 30mins', true]]) {
    assert.deepEqual(walkingNow(t), { indoor }, t);
  }
});

test('his afternoon replayed: nothing marks him out walking until he says he is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-about-to-walk-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    HIS.forEach(([hm, text], i) => store.writeLocal('coach-messages', `m${i}`, { role: 'user', text, at: at(hm) + i }));
    assert.equal(toldWalking(store, emptyWalk(D), at('15:40')), null);
    store.writeLocal('coach-messages', 'go', { role: 'user', text: "Ok I'm walking now", at: at('15:45') });
    assert.deepEqual(toldWalking(store, emptyWalk(D), at('15:46')), { at: at('15:45'), indoor: false });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the coach: "I\'ll go now" is a 15-minute plan, going only once he says he is walking', () => {
  assert.match(RULES, /About to go is not walking \(his words, Wed 11\/11[^\n]*"I'll go now"[^\n]*inMinutes 15[^\n]*until he says he's walking or out/);
  assert.doesNotMatch(RULES, /walking now or about to/);
  const walk = WRITE_TOOLS.find((t) => t.name === 'walk');
  assert.match(walk.description, /About to go is a plan, not going: 'I'll go now'[^"]*inMinutes 15[^"]*going only once he says he's walking/);
  assert.doesNotMatch(walk.description, /walking now or about to/);
});
