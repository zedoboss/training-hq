// Thu 10/29, 12:00 AM, his words: "Walk: No step count from your phone since this morning... Go out for a walk now. You
// usually go around 8:00 PM. When are you going?", then check-ins at 12:21, 1:00 and 2:00 AM. He wants a walk ask that
// matches the clock and his usual walk time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkDue, withAsk, stepsText, walkSteps, dayPart, emptyWalk } from '../app/js/lib/walks.js';

const TZ = 'Asia/Bangkok';
const D = '2026-03-17';
const E = '2026-03-18';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, goal: 8000, wakeHm: '10:00', bedHm: '00:00' };

test('no step count at all is "yet today", never "since this morning", at any hour', () => {
  for (const hm of ['00:00', '09:00', '15:00', '23:30']) {
    const s = stepsText({ steps: null, goal: 8000, now: at(hm), tz: TZ });
    assert.equal(s, 'No step count from your phone yet today (opening the app sends it). Goal 8,000.');
  }
  assert.match(stepsText({ steps: { steps: 2000, asOf: at('11:00') }, goal: 8000, now: at('19:00'), tz: TZ }), /^No step count from your phone since 11:00 AM/);
});

test('his usual hour still ahead: asks if he goes then; near or past it: when he\'s going', () => {
  const ask = (hm, usualHm, o = {}) => walkDue({ ...base, now: at(hm), doc: null, usualHm, ...o }).text;
  const ahead = ask('14:00', '20:00');
  assert.equal(ahead, 'Walk: No step count from your phone yet today (opening the app sends it). Goal 8,000. You usually go around 8:00 PM. Going then, or another time?');
  assert.doesNotMatch(ahead, /now/);
  assert.match(ask('19:45', '20:00'), /Goal 8,000\. You usually go around 8:00 PM\. When are you going\?$/, 'within half an hour');
  assert.match(ask('22:00', '20:00'), /Goal 8,000\. You usually go around 8:00 PM; it's past that\. When are you going\?$/);
  assert.match(ask('14:00', null), /Goal 8,000\. When are you going\?$/, 'no usual hour');
  // Bed at 2:00 AM: 1:00 AM is still in his day, so an 8:00 PM habit is behind him, not ahead.
  assert.match(ask('00:30', '20:00', { bedHm: '02:00' }), /it's past that/);
  // Usual hour after his last ask time (woke 9:00 PM, usual 8:00 PM, bed 7:00 AM): not mentioned.
  const late = ask('22:30', '20:00', { wakeHm: '21:00', bedHm: '07:00' });
  assert.match(late, /Goal 8,000\. When are you going\?$/);
  assert.doesNotMatch(late, /usually/);
  assert.match(ask('14:00', '20:00', { fasting: true }), /^Fasting today, so moving is the job\. Walk: .* Going then, or another time\?$/);
});

test('the waking day\'s steps: past midnight, the day before plus the new calendar day', () => {
  const h = { [D]: { steps: 7337, fileAt: at('23:10') }, [E]: { steps: 400, fileAt: at('00:40', E) } };
  assert.deepEqual(walkSteps(D, E, (d) => h[d]), { steps: 7737, asOf: at('00:40', E) });
  assert.deepEqual(walkSteps(D, D, (d) => h[d]), { steps: 7337, asOf: at('23:10') });
  assert.deepEqual(walkSteps(D, E, (d) => (d === D ? h[D] : null)), { steps: 7337, asOf: at('23:10') });
  assert.equal(walkSteps(D, E, () => null), null);
});

test('moving schedule: what happened before he woke doesn\'t count for this stretch', () => {
  let doc = emptyWalk(D);
  for (const hm of ['00:00', '00:21', '01:00', '02:00']) doc = withAsk(doc, D, hm === '00:00' ? 'ask' : 'check', at(hm));
  doc = { ...doc, answeredAt: at('01:30'), plan: { at: at('03:00'), setAt: at('01:30') } };
  const v = dayPart(doc, at('17:56'));
  assert.deepEqual([v.asks, v.answeredAt, v.plan], [[], null, null]);
  assert.equal(doc.asks.length, 4, 'the record itself keeps them');
  assert.equal(dayPart(doc, null), doc);
  // Woke 5:56 PM, bed about 7:00 AM: the first ask an hour after he woke, at 6:56 PM, with 8:00 PM still ahead.
  const o = { tz: TZ, goal: 8000, wakeHm: '17:56', bedHm: '07:00', usualHm: '20:00' };
  assert.equal(walkDue({ ...o, now: at('18:56'), doc: v }).text, 'Walk: No step count from your phone yet today (opening the app sends it). Goal 8,000. You usually go around 8:00 PM. Going then, or another time?');
  assert.equal(walkDue({ ...o, now: at('18:56'), doc: { ...doc, answeredAt: null, plan: null } }), null, 'without it, last night\'s asks would have kept his evening silent');
  assert.match(walkDue({ ...o, now: at('18:56'), doc }).text, /^Walk time: you said 3:00 AM/, 'and a plan from last night would come back as his');
});

test('his night replayed through the Mac: still up past midnight, no new day\'s walk ask at 12:00 AM', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const { walkTick } = await import('../server/notify.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-walkday-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '10:00', bedHm: '02:00' }, body: { stepGoal: 8000 } });
    store.writeLocal('sleep-log', D, { date: D, bed: at('02:00'), wake: at('10:00') });
    store.setMeta('morning:state', { date: D, open: at('10:00') });
    store.setMeta('morning:state', { date: E, open: at('10:00', E) });
    // Two days before, two walks at 8:00 PM: his usual hour.
    for (const d of ['2026-03-15', '2026-03-16']) store.writeLocal('walks', d, { ...emptyWalk(d), walks: [{ at: at('20:05', d), minutes: 40 }] });
    store.writeLocal('health', D, { date: D, steps: 3000, fileAt: at('13:30') });
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: m.at }); return { sent: 1, failed: 0 }; } };
    const out = [];
    for (let t = at('11:00'); t <= at('01:59', E); t += 60000) {
      const r = await walkTick({ store, push, now: t, tz: TZ });
      if (r) out.push([new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }), r.key, r.body]);
    }
    assert.equal(out[0][1], 'walk:ask');
    assert.match(out[0][2], /You usually go around 8:00 PM\. Going then, or another time\?$/, 'early afternoon, 8:00 PM ahead: no "go now"');
    assert.doesNotMatch(out[0][2], /walk now|this morning/);
    assert.equal(out.filter((x) => x[1] === 'walk:ask').length, 1, `one ask all day and night: ${JSON.stringify(out)}`);
    assert.deepEqual(out.filter((x) => /^(12|1):\d\d AM$/.test(x[0])), [], 'nothing after midnight');
    assert.ok(store.getRecord('walks', E) == null, 'no record for the new calendar day while he is still up');
    assert.equal(store.getRecord('walks', D).data.asks.length, 4, 'the ask and its 3 check-ins, on his waking day');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
