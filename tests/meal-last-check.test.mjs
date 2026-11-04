// Thu 11/5, his words: "Still nothing on your first meal of the day. 12:40 PM was the latest you set. Eat now, or skip
// it?" (1:10 PM Wed 11/4). He never set 12:40 PM (the moving schedule moved his 5:00 PM), and a new first-meal chase had
// started at 11:40 AM after the 10:10 AM "Last check on your first meal". Never "you set"; after a last check, no new
// chase for the same unanswered first meal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mealReminders } from '../app/js/lib/fuel-reminders.js';
import { openStore } from '../server/store.mjs';
import { startNotifier } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const date = '2026-01-21';
const at = (hm) => Date.parse(`${date}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
// Wednesday's times, as the app had them on his body clock.
const mealTimes = [{ name: 'First meal', time: '08:10', latest: '09:40', cookMin: 30 }, { name: 'Last meal', time: '12:10', latest: '12:40', cookMin: 30 }];
const due = (list, slot) => list.filter((i) => i.id.includes(`:${slot}`) && i.due);

test('his Wednesday replayed: one first-meal chase to its last check, then nothing more about it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-meal-last-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { fuel: { mealTimes }, notify: { movingDay: false, wakeHm: '05:00', bedHm: '19:00' } });
    store.setMeta('morning:state', { date, open: at('05:00') });
    let now = at('07:00');
    const sent = [];
    const push = { list: () => [{ deviceId: 'a1b2c3d4e5f6' }], notify: async (m) => { if (/^meal-/.test(m.tag || '')) sent.push({ at: now, body: m.body }); return { sent: 1, failed: 0, dropped: 0 }; } };
    const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
    n.stop();
    for (; now <= at('18:00'); now += 5 * 60000) await n.tick();
    assert.deepEqual(sent.map((m) => hmOf(m.at)), ['7:40 AM', '8:10 AM', '8:30 AM', '9:10 AM', '10:10 AM'], sent.map((m) => m.body).join(' | '));
    assert.match(sent.at(-1).body, /^Last check on your first meal\./);
    assert.match(sent[3].body, /^Still nothing on your first meal\. 9:40 AM is the latest\. When are you eating/);
    assert.ok(sent.every((m) => !/you set/i.test(m.body)));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the cases around it: answered, eaten, or a chase cut short still bring the later meal', () => {
  const items = (meals = [], checks = [], times = mealTimes) => mealReminders({ date, tz: TZ, meals, checks, mealTimes: times });
  // Quiet all morning: nothing at all for the later meal time (no start cooking, ask or check-ins).
  assert.deepEqual(due(items(), '1210'), []);
  // A third meal time, still nothing eaten and no answer: quiet too.
  const three = [...mealTimes, { name: 'Snack', time: '16:00', latest: '16:30' }];
  assert.deepEqual(due(items([], [], three), '1600'), []);
  // He said "skipped" to the first meal: the later one is his first meal of the day and asks as usual.
  const skipped = due(items([], [{ id: `${date}.0810`, answer: 'skipped', at: at('10:20') }]), '1210');
  assert.deepEqual(skipped.map((i) => hmOf(i.at)), ['11:40 AM', '12:10 PM', '12:30 PM', '1:10 PM', '2:10 PM']);
  assert.equal(skipped[0].title, 'Nothing eaten yet today');
  assert.equal(skipped[3].body, '12:40 PM was the latest. Eat now, or skip it?');
  // He ate late (10:30 AM, after the last check): the later meal asks as his last meal.
  const ate = due(items([{ id: 'm', date, at: at('10:30') }]), '1210');
  assert.equal(ate.find((i) => i.id.startsWith('meal:')).title, 'Last meal time');
  // The first meal's check-ins were cut short by the next meal time (no last check sent): the later meal still asks.
  const close = [{ name: 'First meal', time: '08:10', latest: '09:40' }, { name: 'Last meal', time: '10:30', latest: '11:00', cookMin: 30 }];
  const cut = items([], [], close);
  assert.ok(!cut.some((i) => i.id === `meal-again:${date}:0810:3` && i.at < at('10:00')), 'no last check before 10:00 AM cooking');
  assert.equal(due(cut, '1030')[0].title, 'Nothing eaten yet today');
  // Never "you set", early or late.
  const all = items([], [{ id: `${date}.0810`, answer: 'skipped', at: at('10:20') }]);
  assert.ok(all.every((i) => !/you set/i.test(`${i.title} ${i.body}`)));
});
