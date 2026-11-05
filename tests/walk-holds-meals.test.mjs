// Thu 11/5, his words: "Dig even further" (on 6:23 AM "Start cooking: first meal at 6:30 AM. 30 minutes to get it on
// the plate" and 6:30 AM "First meal time... Eaten, cooking, or skipping?", sent while he was out on the walk he had told
// the coach about at 6:06 AM). While he's out walking, start cooking, the meal ask and its check-ins wait until he's
// back (his "back", or the signs the app reads, from when it saw them); then the meal ask alone. No food nudge mid-walk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mealReminders } from '../app/js/lib/fuel-reminders.js';
import { dueNow } from '../app/js/lib/reminders.js';
import { withAnswer, emptyWalk, settleWalk } from '../app/js/lib/walks.js';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { startNotifier, walkSpans, afterWalks, WALK_HOLD } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-11-05';
const at = (hm) => Date.parse(`${D}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const mealTimes = [{ name: 'First meal', time: '06:30', latest: '08:00', cookMin: 15 }, { name: 'Last meal', time: '12:30', latest: '13:00', cookMin: 30 }];
const items = (meals = []) => mealReminders({ date: D, tz: TZ, meals, mealTimes });
const going = withAnswer(emptyWalk(D), D, { action: 'going' }, at('06:06'));
// What would go out at `now`, with the walk as it stood then (the planner's view).
const sendable = (doc, now, list = items()) => dueNow(afterWalks(list, walkSpans([doc], now), now), now).filter((i) => /^meal/.test(i.id));

test('out walking: start cooking, the meal ask and its check-ins wait; nothing before he is back', () => {
  for (const hm of ['06:15', '06:23', '06:30', '06:31', '06:50', '06:52']) assert.deepEqual(sendable(going, at(hm)).map((i) => i.id), [], hm);
  // Without the walk (the old way): 6:15 start cooking, 6:30 the ask, 6:50 the first check-in.
  assert.equal(dueNow(items(), at('06:15')).length, 1);
  assert.equal(dueNow(items(), at('06:30')).filter((i) => i.id.startsWith('meal:')).length, 1);
});

test('back (steps flat from 6:23 AM, seen at 6:53 AM): the meal ask alone 5 minutes after the app saw it', () => {
  const reads = [{ steps: 2189, at: at('05:42') }, { steps: 4145, at: at('06:23') }, { steps: 4605, at: at('06:53') }];
  const back = settleWalk(going, { now: at('06:53'), asks: [], steps: reads });
  assert.equal(back.walks[0].at, at('06:23'));
  assert.equal(back.walks[0].seenAt, at('06:53'));
  assert.deepEqual(sendable(back, at('06:57')), [], 'not before');
  const out = sendable(back, at('06:58'));
  assert.deepEqual(out.map((i) => i.id), [`meal:${D}:0630`], 'the ask, not "start cooking", not the 6:50 check-in');
  assert.equal(out[0].walk, 'after');
  assert.equal(out[0].heldAt, at('06:30'));
  // Its check-ins carry on after it: 7:30 AM and 8:30 AM, not the 6:50 AM one.
  const later = afterWalks(items(), walkSpans([back], at('07:30')), at('07:30')).filter((i) => i.group && i.due).map((i) => hmOf(i.at));
  assert.deepEqual(later, ['7:30 AM', '8:30 AM']);
});

test('his own "back" (walk done) at 6:40 AM: the ask at 6:45 AM; a walk with minutes only uses them for the start', () => {
  const done = withAnswer(going, D, { action: 'done', minutes: 30 }, at('06:40'));
  assert.equal(done.walks[0].from, at('06:06'), 'the start kept');
  assert.deepEqual(sendable(done, at('06:44')), []);
  assert.deepEqual(sendable(done, at('06:45')).map((i) => i.id), [`meal:${D}:0630`]);
  // "Back, walked 20 minutes" with no walk logged before: 6:20 to 6:40 AM; start cooking (6:15) went out before it.
  const told = withAnswer(emptyWalk(D), D, { action: 'done', minutes: 20 }, at('06:40'));
  assert.deepEqual(walkSpans([told], at('06:41')).map((s) => [hmOf(s.start), hmOf(s.end)]), [['6:20 AM', '6:40 AM']]);
  assert.deepEqual(sendable(told, at('06:15')).map((i) => i.id), [`meal-cook:${D}:0630`]);
  assert.deepEqual(sendable(told, at('06:45')).map((i) => i.id), [`meal:${D}:0630`]);
});

test('the cases around it: before the walk, after it, eaten on the way back, other reminders, an old open walk', () => {
  // A walk after the meal ask went out: nothing moves.
  const late = withAnswer(emptyWalk(D), D, { action: 'going' }, at('06:35'));
  assert.equal(sendable(late, at('06:30')).filter((i) => i.id.startsWith('meal:')).length, 1);
  // A walk over before start cooking: everything on time.
  const early = withAnswer(withAnswer(emptyWalk(D), D, { action: 'going' }, at('05:30')), D, { action: 'done' }, at('06:00'));
  assert.deepEqual(sendable(early, at('06:15')).map((i) => i.id), [`meal-cook:${D}:0630`]);
  // He logs the meal: nothing to ask, walk or not.
  const fed = items([{ id: 'm', date: D, at: at('06:55') }]);
  const back = settleWalk(going, { now: at('06:56'), asks: [], homeAt: at('06:55') });
  assert.deepEqual(sendable(back, at('07:00'), fed), []);
  // Holds, supplements and anything not a meal question keep their time mid-walk.
  const other = [{ id: `supps:${D}:0630`, kind: 'supps', at: at('06:30'), due: true, tag: 'supps' }, { id: `holds-morning:${D}`, kind: 'holds', at: at('06:30'), due: true, tag: 'h' }];
  assert.deepEqual(dueNow(afterWalks(other, walkSpans([going], at('06:30')), at('06:30')), at('06:30')).length, 2);
  // An open walk older than openMaxMin (never closed) holds nothing.
  assert.deepEqual(walkSpans([going], at('06:06') + WALK_HOLD.openMaxMin * 60000), []);
});

test('no food nudge while he is out walking', () => {
  const base = { tz: TZ, now: at('11:00'), wakeHm: '04:00', bedHm: '18:00', sleepLogged: true, eaten: { kcal: 0, protein: 0 }, targets: { kcal: 3174, protein: 242.5 },
    reminders: [{ id: `meal:${D}:0630`, kind: 'meals', at: at('06:30'), due: true }], workoutEndedAt: at('10:00') };
  const food = (o) => nudgeCandidates({ ...base, ...o }).filter((c) => /^(food|meal-after)/.test(c.key)).map((c) => c.key.split(':')[0]);
  assert.ok(food({ reminders: [] }).length > 0, 'without the walk a food nudge goes out');
  assert.deepEqual(food({ reminders: [], walkingSince: at('10:40') }), []);
  assert.deepEqual(food({ reminders: [], walkingSince: at('11:30') }), food({ reminders: [] }), 'a walk time after now is not a walk now');
  // After the gym, mid-walk: no "time for your first meal" either.
  const gym = { reminders: [], now: at('10:45'), targets: null, workoutEndedAt: at('10:00') };
  assert.deepEqual(food(gym), ['meal-after']);
  assert.deepEqual(food({ ...gym, walkingSince: at('10:30') }), []);
});

test('his Thursday replayed on the notifier: out walking 6:06 AM, steps in at 6:23 and 6:53 AM: the meal ask at 6:58 AM, nothing mid-walk', async () => {
  for (const ate of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'thq-walk-meals-'));
    const store = openStore(join(dir, 'db.sqlite'));
    try {
      store.writeLocal('settings', 'main', { fuel: { mealTimes }, notify: { movingDay: false, wakeHm: '04:00', bedHm: '18:00' } });
      store.setMeta('morning:state', { date: D, open: at('04:00') });
      store.writeLocal('health', D, { steps: 2189, fileAt: at('05:42') });
      let now = at('05:50');
      const sent = [];
      const push = { list: () => [{ deviceId: 'a1b2c3d4e5f6' }], notify: async (m) => { if (/^meal-|morning-plan/.test(m.tag || '')) sent.push({ at: now, body: m.body }); return { sent: 1, failed: 0, dropped: 0 }; } };
      const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
      n.stop();
      for (; now <= at('07:10'); now += 60000) {
        if (now === at('06:06')) store.writeLocal('walks', D, going);
        if (now === at('06:23')) store.writeLocal('health', D, { steps: 4145, fileAt: at('06:23') });
        if (now === at('06:53')) store.writeLocal('health', D, { steps: 4605, fileAt: at('06:53') });
        if (ate && now === at('06:55')) store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('06:55'), name: 'Breakfast', before: { items: [{ name: 'Beef', grams: 140 }] } });
        await n.tick();
      }
      const txt = sent.map((m) => `${hmOf(m.at)} ${m.body}`).join(' | ');
      if (ate) assert.deepEqual(sent, [], txt);
      else {
        assert.deepEqual(sent.map((m) => hmOf(m.at)), ['6:58 AM'], txt);
        assert.match(sent[0].body, /Eaten, cooking, or skipping\?/);
      }
      assert.equal(store.getRecord('walks', D).data.going, null, 'the walk is closed');
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
