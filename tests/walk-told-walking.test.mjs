// Tue 11/10 (his "????????" at 3:30 PM): at 2:47 PM he wrote "Im gonna walk around in the mall for a bit remind me
// supplements in 30mins"; the coach set the reminder but never recorded the walk, so at 3:30 PM the app sent "Walk time:
// you said "Probably after 3 p.m. for an actual work, or I might get most of my steps in the". Did you start walking?
// ... Rain chance is high, 88%". Now: words saying he's walking count as out walking (the coach's walk tool, and the
// Mac reads his messages too if the coach missed it); his words are quoted only short and whole, never an 80-character
// cut; an indoor walk gets no rain or sun lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkDue, walkingNow, quotable, withAnswer, withAsk, emptyWalk, walkLines } from '../app/js/lib/walks.js';
import { openStore } from '../server/store.mjs';
import { walkTick, toldWalking } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-11-10';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const CUT = 'Probably after 3 p.m. for an actual work, or I might get most of my steps in the';
const MALL = 'Im gonna walk around in the mall for a bit remind me supplements in 30mins';
// Rain 88% all afternoon, UV low.
const weather = { hours: ['14:00', '15:00', '16:00', '17:00'].map((h) => ({ at: at(h), uv: 1.5, rain: 88 })) };

test('walkingNow: walking now or about to, in his words; a later time, a maybe or a "not" is no walk now', () => {
  for (const [t, indoor] of [[MALL, true], ['going for a quick walk in the mall', true], ["I'm going for a walk", false], ['im walking now', false],
    ['Heading out to walk', false], ["I'm on a walk", false], ['im gonna walk around the shops', true], ['im going for a walk till 4', false],
    ['Going walking now and remind me at 4', false], ['On the treadmill, im walking', true]]) {
    assert.deepEqual(walkingNow(t), { indoor }, t);
  }
  for (const t of ["I'll walk at 5", 'gonna walk later', 'Im not gonna walk today', 'Im gonna go walk in an hour', 'Im gonna walk around the mall at 5',
    "I'm going to walk after lunch", 'Im gonna walk at 6pm', 'I might walk after dinner', 'Should I walk now?', 'It is raining, not walking',
    'walked 30 min', 'back from the walk', "I was gonna walk but it's raining", 'I was going to walk', 'going to the gym', `I don't know what I'm doing. ${CUT} gym.`, 'Not yet']) {
    assert.equal(walkingNow(t), null, t);
  }
});

test('his words are quoted only short and whole: a long message is never cut and quoted as "you said"', () => {
  assert.equal(quotable('after dinner'), 'after dinner');
  assert.equal(quotable(CUT), null);
  assert.equal(quotable(''), null);
  // The tool's plan keeps no long words; the old record (an 80-character cut already stored) is never quoted either.
  assert.equal(withAnswer(emptyWalk(D), D, { action: 'plan', at: at('15:30'), said: `I don't know what I'm doing. ${CUT} gym.` }, at('09:24')).plan.said, null);
  const old = { ...emptyWalk(D), answeredAt: at('09:24'), plan: { at: at('15:30'), said: CUT, setAt: at('09:24') } };
  const due = walkDue({ now: at('15:30'), tz: TZ, doc: old, goal: 8000, wakeHm: '07:00', bedHm: '23:00', steps: { steps: 2986, asOf: at('14:45') } });
  assert.equal(due.kind, 'plan');
  assert.match(due.text, /^Walk time: you said 3:30 PM\. Did you start walking\?/);
  assert.doesNotMatch(due.text, /Probably|actual work/);
  assert.doesNotMatch(walkLines([old], { today: D, now: at('15:00'), tz: TZ })[0], /Probably/);
  // Short words still come back to him.
  const mine = { ...old, plan: { ...old.plan, said: 'after 3' } };
  assert.match(walkDue({ now: at('15:30'), tz: TZ, doc: mine, goal: 8000, wakeHm: '07:00', bedHm: '23:00' }).text, /you said "after 3"/);
});

test('an indoor walk: no rain or sun lines at its time; outdoors the rain is still told as his risk', () => {
  const o = { now: at('15:30'), tz: TZ, goal: 8000, wakeHm: '07:00', bedHm: '23:00', weather, steps: { steps: 2986, asOf: at('14:45') } };
  const plan = (indoor) => ({ ...emptyWalk(D), answeredAt: at('12:00'), plan: { at: at('15:30'), said: 'in the mall', setAt: at('12:00'), ...(indoor ? { indoor: true } : {}) } });
  const outdoor = walkDue({ ...o, doc: plan(false) });
  assert.match(outdoor.text, /Rain chance is high, 88%/);
  const inside = walkDue({ ...o, doc: plan(true) });
  assert.equal(inside.kind, 'plan');
  assert.doesNotMatch(inside.text, /[Rr]ain|UV|sun|shade/);
  assert.equal(withAnswer(emptyWalk(D), D, { action: 'plan', at: at('15:30'), indoor: true }, at('12:00')).plan.indoor, true);
  const going = withAnswer(emptyWalk(D), D, { action: 'going', indoor: true }, at('14:47'));
  assert.deepEqual(going.going, { at: at('14:47'), indoor: true });
  assert.match(walkLines([going], { today: D, now: at('15:00'), tz: TZ })[0], /out walking since 2:47 PM \(indoors: no rain or sun lines\)/);
});

/** His afternoon in a dev store: the coach's 9:24 AM walk plan for 3:30 PM, his messages, rain 88%; ticks every minute. */
async function afternoon(msgs, { from = '14:48', to = '16:30', doc } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thq-told-walk-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '07:00', bedHm: '23:00' }, body: { stepGoal: 8000 } });
    store.writeLocal('sleep-log', D, { date: D, bed: at('23:00', '2026-11-09'), wake: at('07:00') });
    store.setMeta('morning:state', { date: D, open: at('07:00') });
    store.setMeta('weather', weather);
    store.writeLocal('health', D, { date: D, steps: 2986, fileAt: at('14:45') });
    store.writeLocal('walks', D, doc || { ...emptyWalk(D), answeredAt: at('09:24'), plan: { at: at('15:30'), said: CUT, setAt: at('09:24') } });
    msgs.forEach(([hm, text, role = 'user'], i) => store.writeLocal('coach-messages', `m${i}`, { id: `m${i}`, role, text, at: at(hm), tz: TZ }));
    const out = [];
    const push = { list: () => [{}], notify: async () => ({ sent: 1, failed: 0 }) };
    for (let t = at(from); t <= at(to); t += 60000) {
      const r = await walkTick({ store, push, now: t, tz: TZ });
      if (r) out.push([new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }), r.key, r.body]);
    }
    return { out, rec: store.getRecord('walks', D).data, store };
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('his afternoon: "gonna walk around in the mall" at 2:47 PM is a walk; no "Walk time" at 3:30 PM, no rain line', async () => {
  const { out, rec } = await afternoon([['14:47', MALL], ['15:18', 'Not yet']]);
  assert.deepEqual(rec.going, { at: at('14:47'), indoor: true }, 'out walking from his message, indoors');
  assert.equal(rec.plan, null, 'the 3:30 PM plan is answered by the walk');
  assert.equal(out.filter((x) => /Walk time|Did you start walking/.test(x[2])).length, 0, JSON.stringify(out));
  assert.equal(out.filter((x) => /[Rr]ain/.test(x[2])).length, 0, JSON.stringify(out));
  assert.deepEqual(out.map((x) => x[1]), ['walk:back'], 'one "Back from the walk?" and nothing else');
});

test('without his walking words the 3:30 PM ask still comes, with the time, never the cut piece', async () => {
  const { out } = await afternoon([['14:47', 'Remind me supplements in 30mins'], ['15:18', 'Not yet']], { to: '15:31' });
  assert.equal(out[0]?.[1], 'walk:plan', JSON.stringify(out));
  assert.match(out[0][2], /you said 3:30 PM\. Did you start walking\?/);
  assert.doesNotMatch(out[0][2], /Probably|actual work/);
});

test('the Mac reads his words only when the coach did not record them: no second walk, no walk from old words', async () => {
  // The coach recorded "going" at 2:48 PM: the walk stays as the coach set it.
  const byCoach = withAnswer({ ...emptyWalk(D), answeredAt: at('09:24'), plan: { at: at('15:30'), setAt: at('09:24') } }, D, { action: 'going', indoor: true }, at('14:48'));
  const a = await afternoon([['14:47', MALL]], { from: '14:50', to: '15:00', doc: byCoach });
  assert.deepEqual(a.rec.going, { at: at('14:48'), indoor: true });
  // He said it, then the coach recorded a later plan for the walk (answered after it): his message is no walk now.
  const later = { ...emptyWalk(D), answeredAt: at('14:48'), plan: { at: at('17:00'), setAt: at('14:48') } };
  const b = await afternoon([['14:47', MALL]], { from: '14:50', to: '15:30', doc: later });
  assert.equal(b.rec.going, null);
  assert.equal(b.out.length, 0);
  // A walk done after his words: not reopened.
  const done = withAnswer(withAnswer(emptyWalk(D), D, { action: 'going' }, at('14:47')), D, { action: 'done', minutes: 30 }, at('15:20'));
  const c = await afternoon([['14:47', MALL]], { from: '15:21', to: '15:40', doc: done });
  assert.equal(c.rec.going, null);
  assert.equal(c.rec.walks.length, 1);
  // Words from over 2 hours ago: not a walk now.
  const d = await afternoon([['12:00', MALL]], { from: '14:48', to: '14:50' });
  assert.equal(d.rec.going, null);
});

test('toldWalking: the latest walking words after the last walk answer; none while a walk is open', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-told-walk-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('coach-messages', 'a', { role: 'user', text: MALL, at: at('14:47') });
    store.writeLocal('coach-messages', 'b', { role: 'assistant', text: "I'm going for a walk", at: at('14:48') });
    assert.deepEqual(toldWalking(store, emptyWalk(D), at('15:00')), { at: at('14:47'), indoor: true });
    assert.equal(toldWalking(store, withAnswer(emptyWalk(D), D, { action: 'going' }, at('14:40')), at('15:00')), null);
    assert.equal(toldWalking(store, withAsk({ ...emptyWalk(D), answeredAt: at('14:50') }, D, 'ask', at('14:55')), at('15:00')), null);
    assert.equal(toldWalking(store, null, at('15:00')).at, at('14:47'), 'no record yet');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
