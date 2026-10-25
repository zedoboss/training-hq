// Mon 10/26 (the nightly review of Sunday): he woke at 12:40 PM, so his gym plan (1 to 1.5 hours after waking, 1:40 to
// 2:10 PM) had passed before the first ask, yet "Push today and no time set. When are you going? Your plan: 1:40 PM to
// 2:10 PM. Evolt first when you get there." went out 6 times, 2:40 to 11:35 PM, the same words. His rule: a few
// check-ins in new words, no past plan times, then quiet; late in the evening the session rolls to tomorrow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nudgeCandidates, nudgeDue, pickNudge, sessionOpenText, lateEvening, SESSION_CHECKS } from '../app/js/lib/nudges.js';
import { heldOff } from '../app/js/lib/holdoffs.js';
import { openStore } from '../server/store.mjs';
import { nudgeTick } from '../server/notify.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-22';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const push = { today: { kind: 'train', dayType: 'push' } };
const base = { tz: TZ, rot: push, wakeHm: '10:00', bedHm: '00:00', sleepLogged: true, morning: { text: 'Banana', gymAfterMin: [60, 90] } };
const ask = (o) => nudgeCandidates(o).find((c) => c.key.startsWith('session'));

/** The nudge clock (every 20 minutes, as his settings) with only this nudge open: when each check-in goes out. */
function replay(o, from, to, sent = {}) {
  const out = []; let last = 0;
  for (let now = at(from); now <= at(to); now += 60000) {
    if (!nudgeDue({ now, everyMin: 20, lastNudgeAt: last })) continue;
    const pick = pickNudge(nudgeCandidates({ ...o, now, sent }), sent, now);
    if (!pick) continue;
    sent[pick.key] = now; last = now; out.push({ at: hmOf(now), ...pick });
  }
  return out;
}

test('three check-ins, new words each, none after the last', () => {
  const texts = [0, 1, 2].map((k) => sessionOpenText(k, 'Push'));
  assert.equal(SESSION_CHECKS.count, 3);
  assert.equal(new Set(texts).size, 3);
  for (const t of texts) assert.match(t, /Push/);
  assert.equal(sessionOpenText(3, 'Push'), null);
  assert.equal(sessionOpenText(0, 'Push', '1:40 PM to 2:10 PM'), 'Push today and no time set. When are you going? Your plan: 1:40 PM to 2:10 PM. Evolt first when you get there.');
  assert.match(texts[2], /move to tomorrow\?$/);
});

test('Sunday replayed: woke 12:40 PM, never answered: 3 check-ins, no past plan, quiet before the late evening', () => {
  const sent = replay({ ...base, wokeAt: at('12:40') }, '14:40', '23:59');
  assert.deepEqual(sent.map((x) => x.at), ['14:40', '16:10', '17:40']);
  assert.equal(new Set(sent.map((x) => x.text)).size, 3, 'new words each time');
  for (const x of sent) assert.doesNotMatch(x.text, /1:40 PM|2:10 PM|Your plan/, 'the plan had passed');
  assert.deepEqual(sent.map((x) => x.key), [0, 1, 2].map((k) => `session:${D}:${k}`));
});

test('his plan is said only while it is still ahead', () => {
  const o = { ...base, wokeAt: at('09:40') };
  assert.match(ask({ ...o, now: at('09:50') }).text, /Your plan: 10:40 AM to 11:10 AM\./);
  assert.match(ask({ ...o, now: at('11:00') }).text, /Your plan: 10:40 AM to 11:10 AM\./, 'inside the window: still current');
  assert.doesNotMatch(ask({ ...o, now: at('11:10') }).text, /Your plan/);
  assert.doesNotMatch(ask({ ...o, now: at('15:00') }).text, /Your plan|10:40|11:10/);
  // No sleep log: from his usual wake time (10:00): 11:00 to 11:30 AM.
  assert.match(ask({ ...base, now: at('10:30') }).text, /Your plan: 11:00 AM to 11:30 AM\./);
  assert.doesNotMatch(ask({ ...base, now: at('11:30') }).text, /Your plan/);
});

test('late in the evening (3 hours before bed) it rolls to tomorrow: nothing, even with no check-in yet', () => {
  const o = { ...base, wokeAt: at('12:40') };
  assert.ok(ask({ ...o, now: at('20:59') }));
  for (const hm of ['21:00', '22:00', '23:35', '23:59']) assert.equal(ask({ ...o, now: at(hm) }), undefined, hm);
  // Woke late and first free at 8:40 PM: one check-in, then quiet from 9:00 PM.
  assert.deepEqual(replay(o, '20:40', '23:59').map((x) => x.at), ['20:40']);
  // Bed at his usual 10:00 PM: from 7:00 PM. A bedtime after midnight: later.
  assert.equal(lateEvening(at('18:59'), TZ, '22:00'), false);
  assert.equal(lateEvening(at('19:00'), TZ, '22:00'), true);
  assert.equal(lateEvening(at('22:30'), TZ, '02:00'), false);
  assert.equal(lateEvening(at('23:00'), TZ, '02:00'), true);
  assert.equal(lateEvening(at('10:00'), TZ, '00:00'), false, 'his morning');
});

test('a new day starts its own check-ins; yesterday\'s count does not carry over', () => {
  const D2 = '2026-03-23';
  const sent = Object.fromEntries([0, 1, 2].map((k) => [`session:${D}:${k}`, at(['14:40', '16:10', '17:40'][k])]));
  const c = ask({ ...base, wokeAt: at('10:00', D2), now: at('11:00', D2), sent });
  assert.equal(c.key, `session:${D2}:0`);
  assert.match(c.text, /^Push today and no time set\. When are you going\? Your plan: 11:00 AM to 11:30 AM\./);
});

test('unchanged around it: a time set, a session started, a rest day, a hold-off on training', () => {
  const o = { ...base, wokeAt: at('12:40') };
  assert.equal(ask({ ...o, now: at('15:30'), sessionHm: '16:00' }).key, 'session');
  assert.match(ask({ ...o, now: at('16:30'), sessionHm: '16:00' }).text, /^Push was due at 4:00 PM\. Go now/);
  assert.match(ask({ ...o, now: at('21:30'), sessionHm: '21:00' }).text, /was due at 9:00 PM/, 'a time he set still counts late');
  assert.equal(ask({ ...o, now: at('15:00'), session: { started: true } }), undefined);
  assert.equal(ask({ ...o, now: at('15:00'), rot: { today: { kind: 'rest' } } }), undefined);
  const hold = [{ areas: ['training'], at: at('14:00'), until: at('23:00') }];
  assert.equal(heldOff(`session:${D}:1`, hold, at('16:00')), true, '"hold off training" still covers it');
});

test('through the Mac\'s nudge clock: a push day, woke 12:40 PM, no time set, no answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-session-open-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { nudgeEveryMin: 20, wakeHm: '10:00', bedHm: '00:00', morning: { text: 'Banana', gymAfterMin: [60, 90] } } });
    store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: at('12:00') });
    store.writeLocal('sleep-log', D, { date: D, bed: at('04:00'), wake: at('12:40') });
    const sent = [];
    let now;
    const p = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
    for (now = at('14:40'); now <= at('23:59'); now += 60000) await nudgeTick({ store, push: p, now, tz: TZ });
    const s = sent.filter((m) => m.tag === 'nudge-session');
    assert.equal(s.length, 3, s.map((m) => `${hmOf(m.at)} ${m.body}`).join('\n'));
    assert.ok(s.every((m) => m.at < at('21:00')), 'none late in the evening');
    assert.equal(new Set(s.map((m) => m.body.split(/(?<=[.?])\s/)[0])).size, 3, 'new words each time');
    for (const m of s) assert.doesNotMatch(m.body, /Your plan|1:40 PM|2:10 PM/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('no time set, no day type: "your session" mid-sentence, lower case', async () => {
  const { sessionOpenText } = await import('../app/js/lib/nudges.js');
  assert.match(sessionOpenText(0), /^Your session today and no time set/);
  assert.equal(sessionOpenText(1), "Still no time for your session today. Tell me when you're going and I'll leave it till then.");
  assert.equal(sessionOpenText(2), 'Last check on your session today. Going later, or does it move to tomorrow?');
  assert.equal(sessionOpenText(3), null);
});
