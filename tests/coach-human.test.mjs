// Wed 10/21: the coach as a human coach: a fast he announces, hold-offs, coach initiatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fastingOn, withFast } from '../app/js/lib/fast.js';
import { heldOff, itemHeld } from '../app/js/lib/holdoffs.js';
import { openItems, initiativePrompt } from '../app/js/lib/initiatives.js';
import { remindersFor } from '../app/js/lib/reminders.js';
import { nudgeCandidates } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Bangkok';
const D = '2026-03-18';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);

test('a fast: on until a meal after it; no meal-time, cook or supplement reminders; no food or supplement nudges', () => {
  const days = { [D]: withFast(null, D, { on: true, said: 'Today I fast' }, at('15:49')) };
  assert.equal(fastingOn(days, D), true);
  assert.equal(fastingOn(days, D, [{ date: D, at: at('18:00') }]), false, 'a meal after it ends the fast');
  assert.equal(fastingOn({ [D]: withFast(days[D], D, { on: false }, at('17:00')) }, D), false);
  const settings = { fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }] } };
  const supplements = [{ id: 's1', name: 'Creatine', dose: '5 g', days: { type: 'daily' }, status: 'active', time: '13:00' }];
  const kinds = (d) => remindersFor({ date: D, tz: TZ, last: null, days: d, settings, supplements }).map((r) => r.kind);
  assert.ok(kinds({}).includes('cook') && kinds({}).includes('meals') && kinds({}).includes('supps'));
  assert.ok(!kinds(days).some((k) => ['cook', 'meals', 'supps'].includes(k)));
  const args = { now: at('16:00'), tz: TZ, wakeHm: '10:00', bedHm: '00:00', eaten: { kcal: 0, protein: 0 }, targets: { kcal: 3174, protein: 242.5 }, suppsUntimed: { total: 5, open: ['Vitamin C'] } };
  const keys = (o) => nudgeCandidates({ ...args, ...o }).map((c) => c.key);
  assert.ok(keys({}).includes('food') && keys({}).includes('supps-untimed'));
  assert.deepEqual(keys({ fasting: true }).filter((k) => ['food', 'supps-untimed'].includes(k)), []);
});

test('hold-offs: by area until a time; the sauna alarms and his own reminders never wait', () => {
  const holds = [{ id: 'h1', areas: ['walk', 'sauna'], until: at('18:00'), at: at('12:00') }, { id: 'h2', areas: ['all'], until: at('09:00'), at: at('08:00') }];
  assert.equal(heldOff('walk:ask', holds, at('15:00')), true);
  assert.equal(heldOff('walk:ask', holds, at('18:01')), false, 'over at its time');
  assert.equal(heldOff('food', holds, at('15:00')), false);
  assert.equal(itemHeld({ id: `sauna-day:${D}`, kind: 'sauna' }, holds, at('15:00')), true);
  assert.equal(itemHeld({ id: 'sauna-overdue:x:1', kind: 'sauna' }, holds, at('15:00')), false, 'safety');
  assert.equal(itemHeld({ id: 'sauna-after:x', kind: 'sauna' }, holds, at('08:30')), false, 'safety, even under all');
  assert.equal(itemHeld({ id: 'coach:rem-1', kind: 'coach' }, holds, at('08:30')), false, 'reminders he asked for');
  assert.equal(itemHeld({ id: `meal:${D}:1230`, kind: 'meals' }, holds, at('08:30')), true, 'all');
  assert.equal(heldOff('walk', [{ ...holds[0], cancelledAt: at('13:00') }], at('15:00')), false);
});

test('initiatives: neck planned and skipped, holds behind, the table a draft, sauna never started; most important first', () => {
  const dayOf = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
  const sessions = [{ id: 'p1', dayType: 'push', status: 'done', startedAt: at('11:30', '2026-03-17') }];
  const areas = [{ kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Wall Hold', where: 'home' }] }];
  const items = openItems({ today: D, sessions, neck: { planned: true, place: 'after-push', on: '2026-03-15' }, areas, readiness: { status: 'draft' }, scanPlan: { safety: null }, dayOf });
  assert.deepEqual(items.map((i) => i.key), ['holds-knees', 'neck', 'readiness', 'sauna', 'scan-safety']);
  assert.match(items.find((i) => i.key === 'neck').facts, /puts it after push\. Never done yet\. Push days without it: 2026-03-17\./);
  assert.match(items[0].facts, /0 rounds in the last 7 days/);
  assert.equal(openItems({ today: D, sessions: [...sessions, { id: 'n1', dayType: 'neck', status: 'done', startedAt: at('12:30', '2026-03-17') }], neck: { planned: true, place: 'after-push', on: '2026-03-15' }, dayOf }).some((i) => i.key === 'neck'), false, 'neck done: nothing to raise');
  assert.equal(openItems({ today: D, saunaPlan: { askAfter: '2026-03-25' }, dayOf }).some((i) => i.key === 'sauna'), false, '"not this week" holds');
  assert.match(initiativePrompt(items[1]), /^\[From the app, not from him\.[\s\S]*Reply exactly SKIP only when he already answered this topic/);
});

test('initiative tick: the coach writes it, pushed and in Talk; one per 3 hours; never while he talks; SKIP sends nothing', async () => {
  const { openStore } = await import('../server/store.mjs');
  const { initiativeTick } = await import('../server/notify.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-init-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { wakeHm: '10:00', bedHm: '00:00' } });
    store.writeLocal('schedule', 'neck', { planned: true, place: 'after-push', on: '2026-03-15' });
    store.writeLocal('sessions', 'p1', { id: 'p1', dayType: 'push', status: 'done', startedAt: at('11:30', '2026-03-17'), endedAt: at('12:30', '2026-03-17') });
    const sent = []; const asked = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
    let reply = "We still haven't started neck. It fits after Push on Saturday: 10 minutes. Want to start then?";
    const coach = { initiate: async (o) => { asked.push(o); if (/^SKIP/.test(reply)) return null; const msg = { id: 'm1', role: 'assistant', text: reply, kind: 'initiative', at: Date.now() }; store.writeLocal('coach-messages', msg.id, msg); return msg; } };
    const tick = (hm) => initiativeTick({ store, push, coach, now: at(hm), tz: TZ });
    assert.equal(await tick('10:30'), null, 'not in the first hour after he wakes');
    const r = await tick('15:00');
    assert.equal(r.key, 'init:neck');
    assert.match(asked[0].instruction, /Neck: his plan since 2026-03-15 puts it after push/);
    assert.equal(sent[0].body, reply);
    assert.equal(sent[0].url, '#/coach');
    assert.equal(await tick('16:00'), null, 'one per 3 hours');
    store.writeLocal('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'Saturday works', at: at('18:05') });
    assert.equal(await tick('18:10'), null, 'never while he is talking to the coach');
    reply = 'SKIP';
    store.writeLocal('tendons', 'readiness', { kind: 'readiness', status: 'draft' });
    assert.equal(await tick('18:30'), null, 'the coach may decide not to');
    assert.equal(sent.length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
