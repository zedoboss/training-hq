// Fri 10/30, his words (Sat 10/31): "Walk: 6,665 of 8,000 steps as of 5:52 AM: 1,335 to go, about 15 minutes of walking. Go
// out for a walk now. When are you going?", three hours after "no go now" was done; the 7:05 AM check-in added "Move." He
// wants the walk asks to ask if he's going at a time, no "go now" or "Move".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkDue, withAsk, withAnswer } from '../app/js/lib/walks.js';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { walkTick } from '../server/notify.mjs';
import { systemPrompt } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, goal: 8000, wakeHm: '10:00', bedHm: '00:00' };
const steps = (n, hm) => ({ steps: n, asOf: at(hm) });
const ORDER = /\bgo now\b|\bgo out\b|\bgo for a walk\b|\bwalk \d+ minutes\b|\bmove[.!]?(\s|$)|\bget moving\b/i;
const hour = (hm, uv, rain = 0) => ({ at: at(hm), uv, feels: 30, rain });

test('every walk message the walk coach can send: no order, no matter the moment', () => {
  const said = [];
  const say = (o) => { const d = walkDue({ ...base, steps: steps(3000, '14:00'), doc: null, ...o }); assert.ok(d, JSON.stringify(o.now)); said.push(d); return d; };
  // First ask: no usual hour, usual ahead, just ahead, just past, long past, after his last ask time, no steps, fasting.
  for (const usualHm of [null, '20:00', '14:45', '14:15', '10:00']) assert.match(say({ now: at('14:30'), usualHm }).text, /\?$/);
  assert.match(say({ now: at('22:30'), usualHm: '20:00', wakeHm: '21:00', bedHm: '07:00', steps: steps(3000, '22:00') }).text, /When are you going\?$/);
  assert.match(say({ now: at('14:30'), steps: null }).text, /When are you going\?$/);
  assert.match(say({ now: at('14:30'), fasting: true }).text, /^Fasting today, so moving is the job\. Walk: .*When are you going\?$/);
  // UV 3 to 6 with nothing better left, rain, his own time, the app's own time, the check-ins on all of them.
  const late = { hours: ['20:00', '21:00', '22:00', '23:00'].map((h) => hour(h, 4)) };
  say({ now: at('20:10'), steps: steps(3000, '20:00'), weather: late });
  say({ now: at('18:11'), weather: { hours: [hour('18:00', 0.1, 55), hour('19:00', 0, 30)] } });
  for (const by of [null, 'coach']) {
    let doc = withAnswer(withAsk(null, D, 'ask', at('14:00')), D, { action: 'plan', at: at('18:00'), ...(by ? { by } : { said: 'at 6' }) }, at('14:02'));
    for (const hm of ['18:00', '18:20', '19:00', '20:00']) {
      const d = say({ now: at(hm), doc, steps: steps(3000, '17:00'), lastUserAt: at('13:00') });
      doc = withAsk(doc, D, d.kind, at(hm));
    }
  }
  // No plan: the ask's three check-ins, and the ones after he answers something else.
  let doc = withAsk(null, D, 'ask', at('14:00'));
  for (const hm of ['14:20', '15:00', '16:00']) { const d = say({ now: at(hm), doc, lastUserAt: at('13:00') }); doc = withAsk(doc, D, d.kind, at(hm)); }
  say({ now: at('14:40'), doc: { ...withAsk(null, D, 'ask', at('14:00')), answeredAt: at('14:05') } });
  for (const d of said) assert.doesNotMatch(d.text, ORDER, d.text);
  assert.equal(said.length, 22);
});

test('Friday replayed through the Mac, a push line bank in place: the ask and its check-ins take none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-walkask-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '05:00', bedHm: '22:00' }, body: { stepGoal: 8000 } });
    store.writeLocal('health', D, { date: D, steps: 6665, fileAt: at('05:52') });
    store.setMeta('morning:state', { date: D, open: at('05:00') });
    // A bank of nothing but push lines: any walk message that takes one fails below.
    store.writeLocal('coach-lines', 'bank', { moods: { hype: { nudge: [[3, 'You got this. Move!']] }, commander: { nudge: [[3, 'Are you going to let your future self be weaker? Move.']] } } });
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m.body); return { sent: 1, failed: 0 }; } };
    for (let t = at('06:05'); t <= at('12:00'); t += 60000) {
      if (t === at('06:47')) store.writeLocal('health', D, { date: D, steps: 7144, fileAt: at('06:47') });
      await walkTick({ store, push, now: t, tz: TZ });
    }
    assert.equal(sent.length, 4, `the ask and 3 check-ins: ${JSON.stringify(sent)}`);
    assert.equal(sent[0], 'Walk: 6,665 of 8,000 steps as of 5:52 AM: 1,335 to go, about 15 minutes of walking. When are you going?');
    assert.match(sent[1], /^No answer on the walk\. When are you going\? Tell me a time and I leave you alone until then\.$/);
    assert.match(sent[2], /^Still no time for your walk\. .* One time, and I stop asking\.$/);
    for (const b of sent) assert.doesNotMatch(b, /future self|Move|You got this/, b);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('steps behind with the walk coach off: asked too, no "Walk 15 minutes"', () => {
  const c = nudgeCandidates({ now: at('14:00'), tz: TZ, steps: steps(1200, '13:30'), stepGoal: 8000, wakeHm: '07:00', bedHm: '23:00' }).find((x) => x.key === 'steps');
  assert.equal(c.text, 'Steps: 1,200 by 1:30 PM, goal 8,000. When are you walking?');
});

test('the coach\'s own words on walks: asks, never orders', () => {
  const p = systemPrompt();
  assert.doesNotMatch(p, /Push him to go/);
  assert.match(p, /Ask when he's going, never order it/);
});
