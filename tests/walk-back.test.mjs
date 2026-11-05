// Thu 11/5 (his words: "see if something doesn't update accordingly instantly whenever I talk with you here in the
// chat"): "out walking since 6:06 AM" was still his state at 7:55 AM, though he had logged breakfast at 6:55 AM and been
// chatting since; the 6:47 AM "Back from the walk?" went unanswered and nothing closed the walk (and no walk question
// could come for the rest of the day). Now a walk he's clearly back from (something at home, a message after the
// "Back?" ask, steps flat, or 2 hours) is over at once: the coach never sees "out walking", the minutes are asked once
// if unknown, and the walk questions carry on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkDue, walkOverAt, settleWalk, withAsk, withAnswer, walkLines, emptyWalk } from '../app/js/lib/walks.js';
import { lastAnswerAt } from '../app/js/lib/silent.js';
import { openStore } from '../server/store.mjs';
import { settleWalks, walkSigns } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-11-05';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, goal: 8000, wakeHm: '04:00', bedHm: '18:00' };
// His morning: out walking at 6:06 AM (his message), "Back from the walk?" at 6:47 AM, unanswered.
const going = () => withAsk(withAnswer(emptyWalk(D), D, { action: 'going' }, at('06:06')), D, 'back', at('06:47'));
const reads = [{ steps: 2189, at: at('05:42') }, { steps: 4145, at: at('06:23') }, { steps: 4605, at: at('06:53') }];

test('walkOverAt: the signs he is back, the earliest wins; none while he is still out', () => {
  const g = { at: at('06:06') };
  const asks = going().asks;
  assert.equal(walkOverAt(g, { now: at('06:40') }), null, 'nothing yet');
  assert.deepEqual(walkOverAt(g, { now: at('07:00'), homeAt: at('06:55') }), { at: at('06:55'), why: 'home' });
  assert.equal(walkOverAt(g, { now: at('07:00'), homeAt: at('06:00') }), null, 'a meal before he went out says nothing');
  // His 6:18 AM message came mid-walk, before any "Back?": not a sign.
  assert.equal(walkOverAt(g, { now: at('06:30'), userAts: [at('06:18')], asks }), null);
  assert.deepEqual(walkOverAt(g, { now: at('07:30'), userAts: [at('06:18'), at('07:29'), at('07:30')], asks }), { at: at('07:29'), why: 'talk' }, 'the first message after "Back?"');
  // Steps: 4,145 at 6:23 to 4,605 at 6:53 is 16 a minute: stopped.
  assert.deepEqual(walkOverAt(g, { now: at('07:00'), steps: reads }), { at: at('06:23'), why: 'steps' });
  assert.equal(walkOverAt(g, { now: at('07:00'), steps: [{ steps: 2500, at: at('06:10') }, { steps: 5500, at: at('06:50') }] }), null, 'steps climbing: still out');
  assert.equal(walkOverAt(g, { now: at('06:30'), steps: [{ steps: 2500, at: at('06:07') }, { steps: 2600, at: at('06:25') }] }), null, 'too early in the walk to judge');
  assert.deepEqual(walkOverAt(g, { now: at('08:06') }), { at: at('08:06'), why: 'long' }, 'never open for hours');
  assert.equal(walkOverAt(g, { now: at('08:05') }), null);
  assert.deepEqual(walkOverAt(g, { now: at('08:30'), homeAt: at('06:55'), steps: reads }).why, 'steps', 'earliest');
});

test('his morning: breakfast at 6:55 AM closes the 6:06 AM walk; no second ask; the coach never sees "out walking"', () => {
  const doc = going();
  const signs = { homeAt: at('06:55'), userAts: [at('06:54'), at('07:55')], steps: reads };
  const lines = walkLines([doc], { today: D, now: at('07:55'), tz: TZ, steps: { steps: 4605, asOf: at('06:53') }, signs })[0];
  assert.doesNotMatch(lines, /out walking since/);
  assert.match(lines, /the walk from 6:06 AM is OVER, back by about 6:23 AM \(his steps went flat\)/);
  assert.match(lines, /already asked at 6:47 AM: don't ask again/);
  // Without the signs (the old way) it still read "out walking since 6:06 AM".
  assert.match(walkLines([doc], { today: D, now: at('07:55'), tz: TZ })[0], /out walking since 6:06 AM/);
  // "Back?" went out at 6:47 AM: no minutes ask on top of it.
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, homeAt: at('06:55'), readings: reads, ...o });
  assert.equal(due('07:55'), null);
  // The walk questions carry on once a step count after it is in (before: none for the rest of the day).
  assert.equal(due('09:00', { steps: { steps: 5000, asOf: at('08:50') } }).kind, 'ask');
});

test('back with the minutes unknown: one ask for the minutes (not "Back?"), right away, then never again', () => {
  let doc = withAnswer(emptyWalk(D), D, { action: 'going' }, at('06:06'));
  const due = (hm) => walkDue({ ...base, now: at(hm), doc, homeAt: at('06:30') });
  const a = due('06:31');
  assert.deepEqual(a, { kind: 'minutes', text: 'Your walk from 6:06 AM is logged as done. How many minutes did you go?' });
  doc = withAsk(settleWalk(doc, { now: at('06:31'), homeAt: at('06:30') }), D, 'minutes', at('06:31'));
  assert.equal(due('06:50'), null, 'once');
  assert.equal(due('07:20'), null, 'and no "Back?" either');
  // He tells the coach: the minutes fill in that walk, no second walk.
  const told = withAnswer(doc, D, { action: 'done', minutes: 20 }, at('07:30'));
  assert.equal(told.walks.length, 1);
  assert.deepEqual(told.walks[0], { at: at('06:30'), from: at('06:06'), minutes: 20, steps: null });
  // "Still out": the walk reopens from when he left.
  const out = withAnswer(doc, D, { action: 'going' }, at('06:40'));
  assert.deepEqual(out.going, { at: at('06:06'), since: at('06:40') });
  assert.equal(out.walks.length, 0);
});

test('a walk the app closed is not an answer from him (quiet-mode count), and the timeline keeps the start', () => {
  const doc = settleWalk(withAnswer(emptyWalk(D), D, { action: 'going' }, at('06:06')), { now: at('08:30') });
  assert.equal(doc.walks[0].auto, 'long');
  assert.equal(lastAnswerAt({ walks: [{ ...doc, answeredAt: null }] }), 0);
});

test('the Mac closes the record on its own the moment he is back, and the coach context follows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-walkback-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('walks', D, going());
    // An older day's walk left open (Tue 10/20 had one): closed too, in the same pass.
    store.writeLocal('walks', '2026-11-03', withAnswer(emptyWalk('2026-11-03'), '2026-11-03', { action: 'going' }, at('17:00', '2026-11-03')));
    const old = settleWalks(store, at('06:50'), TZ);
    assert.deepEqual(old.map((x) => x.auto), ['long'], 'only the old one; still out at 6:50 AM');
    assert.equal(store.getRecord('walks', '2026-11-03').data.going, null);
    assert.ok(store.getRecord('walks', D).data.going);
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('06:55'), name: 'Breakfast', before: { items: [{ name: 'Beef', grams: 140 }] } });
    assert.deepEqual(walkSigns(store, at('06:06'), at('06:56'), TZ).homeAt, at('06:55'));
    const [w, more] = settleWalks(store, at('06:56'), TZ);
    assert.equal(more, undefined);
    assert.deepEqual(w, { at: at('06:55'), from: at('06:06'), minutes: null, steps: null, auto: 'home', seenAt: at('06:56') });
    const rec = store.getRecord('walks', D).data;
    assert.equal(rec.going, null);
    assert.equal(rec.walks.length, 1);
    assert.deepEqual(settleWalks(store, at('07:55'), TZ), [], 'closed once');
    const line = walkLines([rec], { today: D, now: at('07:55'), tz: TZ })[0];
    assert.doesNotMatch(line, /out walking since|get a time from him/, '"Back?" is not a walk ask to chase');
    assert.match(line, /the walk from 6:06 AM is OVER, back by about 6:55 AM \(he did something at home: a meal/);
  } finally {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('"still out" after the app closed the walk: it stays open, one more "Back?" later', () => {
  let d = settleWalk(going(), { now: at('06:50'), userAts: [at('06:49')], asks: going().asks, steps: [], homeAt: 0 });
  assert.equal(d.going, null, 'his 6:49 AM message after "Back?" closed it');
  d = withAnswer(d, D, { action: 'going' }, at('06:50'));
  assert.equal(d.going.at, at('06:06'), 'still from when he left');
  const sig = (now) => ({ now, userAts: [at('06:49'), at('06:50')], asks: d.asks, steps: reads, homeAt: 0 });
  assert.equal(settleWalk(d, sig(at('06:55'))).going?.at, at('06:06'), 'the same signs never close it again');
  assert.equal(walkDue({ ...base, now: at('07:00'), doc: d }), null, 'no new "Back?" right away');
  assert.equal(walkDue({ ...base, now: at('07:31'), doc: d })?.kind, 'back', 'one more "Back?" later');
  assert.equal(settleWalk(d, sig(at('08:50'))).going, null, 'never open for hours after that either');
});
