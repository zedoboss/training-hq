import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remindersFor, dueNow } from '../app/js/lib/reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const areas = [
  { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Gym Hold', when: 'after Legs', where: 'gym' }, { exercise: 'Wall Hold', where: 'home' }], loadsArea: { exercises: [] } },
  { kind: 'area', id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Press Hold', timing: ['after Push'] }, { exercise: 'Raise Hold', timing: ['after Push', 'rest days'] }], loadsArea: { exercises: [] } },
];
const table = { workingArea: { legs: ['L', 'B'], pull: ['B'], push: [] } };
const meta = { firstSessions: { pull: '2026-01-01', push: '2026-01-02', legs: '2026-01-03' } };
const base = { tz: TZ, areas, table, meta };
const byKind = (items) => Object.fromEntries(items.map((i) => [i.id.split(':')[0], i]));

test('training day with a time: check-in 30 minutes before, session at its time, holds, evening round-up', () => {
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30' } };
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18' }, days });
  const k = byKind(items);
  assert.deepEqual(items.map((i) => i.id.split(':')[0]), ['readiness', 'session', 'holds-evening', 'evening']);
  assert.equal(k.readiness.at, at('2026-01-20', '04:00'));
  assert.equal(k.readiness.title, 'Sore, or good to go?');
  assert.equal(k.readiness.body, 'Legs at 4:30 AM, week 3 column. Knees, shoulder, legs, back, then energy. Zero to three.');
  assert.equal(k.readiness.url, '#/checkin');
  assert.equal(k.session.title, 'Legs at 4:30 AM');
  assert.equal(k.session.body, 'Tuesday 1/20. Week 3 column. Check-in still open.');
  assert.equal(k['holds-evening'].at, at('2026-01-20', '19:30'));
  assert.equal(k['holds-evening'].body, 'Knees: Wall Hold. 3 × 30 s each.');
  // Legs not done by the evening: it is still next tomorrow (decision 15), with no time set yet.
  assert.equal(k.evening.body, 'Still open: knees (Gym Hold), knees (Wall Hold). Tomorrow: Legs. No time set yet.');
  assert.equal(k.evening.at, at('2026-01-20', '20:30'));
});

test('done things switch reminders off: check-in in, session started, holds logged', () => {
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30', readiness: { action: 'train' } } };
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18' }, days, trainedDates: new Set(['2026-01-20']), rounds: { knees: { '2026-01-20': 2 } } });
  const k = byKind(items);
  assert.equal(k.readiness.due, false);
  assert.equal(k.session.due, false);
  assert.equal(k['holds-evening'].due, false);
  assert.equal(k.evening.body, 'Tomorrow: Legs. No time set yet.'); // the session is still running, nothing is open
  // Once Legs is finished today: no session reminders, and tomorrow is the rotation's rest day.
  const done = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'legs', date: '2026-01-20' }, days, rounds: { knees: { '2026-01-20': 2 } } });
  assert.deepEqual(done.map((i) => i.id.split(':')[0]), ['holds-evening']);
});

test('no time set: no check-in or session reminder; the evening nudges for tomorrow', () => {
  const items = remindersFor({ ...base, date: '2026-01-19', last: { dayType: 'pull', date: '2026-01-18' }, days: {}, rounds: { knees: { '2026-01-19': 2 }, shoulder: { '2026-01-19': 1 } } });
  assert.deepEqual(items.map((i) => i.id.split(':')[0]), ['holds-morning', 'holds-evening', 'evening']);
  // Push today (not done yet): tomorrow is still Push by the rotation, and has no time.
  assert.equal(byKind(items).evening.body, 'Tomorrow: Push. No time set yet.');
  assert.equal(byKind(items).evening.title, 'Tomorrow');
});

test('rest day: shoulder rest-day hold with the morning knee hold; tomorrow with its time', () => {
  const days = { '2026-01-21': { date: '2026-01-21', sessionTime: '05:00' } };
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'legs', date: '2026-01-19' }, days });
  const k = byKind(items);
  assert.equal(k['holds-morning'].title, 'Rest day holds');
  assert.equal(k['holds-morning'].body, 'Knees: Wall Hold. Shoulder: Raise Hold. 3 × 30 s each.');
  assert.match(k.evening.body, /Tomorrow: Pull at 5:00 AM, check-in at 4:30 AM\.$/);
});

test('settings: kinds switched off, own times', () => {
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30' } };
  const settings = { notify: { kinds: { session: false, evening: false }, readinessMin: 45, holdsEvening: '21:00' } };
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18' }, days, settings });
  assert.deepEqual(items.map((i) => i.id.split(':')[0]), ['readiness', 'holds-evening']);
  assert.equal(items[0].at, at('2026-01-20', '03:45'));
  assert.equal(items[1].at, at('2026-01-20', '21:00'));
});

test('neck: once a week on the chosen weekday while unplanned', () => {
  const sun = '2026-01-25';
  const mk = (neck, date = sun) => remindersFor({ ...base, date, last: null, days: {}, neck, settings: { notify: { kinds: { holds: false, evening: false } } } });
  assert.equal(mk({ planned: false }).length, 1);
  assert.equal(mk({ planned: false }, '2026-01-24').length, 0);
  assert.equal(mk({ planned: true }).length, 0);
  assert.equal(mk({ planned: false, lastAskedOn: '2026-01-22' }).length, 0);
  assert.equal(mk({ planned: false, lastAskedOn: '2026-01-19' }).length, 0);
  assert.equal(mk({ planned: false, lastAskedOn: '2026-01-18' }).length, 1);
});

test('due now: time reached, within 30 minutes, not sent before', () => {
  const items = [{ id: 'a', at: 1000, due: true }, { id: 'b', at: 1000, due: false }, { id: 'c', at: 5000, due: true }, { id: 'd', at: -2e6, due: true }];
  assert.deepEqual(dueNow(items, 2000).map((i) => i.id), ['a']);
  assert.deepEqual(dueNow(items, 2000, { a: 1500 }).map((i) => i.id), []);
  assert.deepEqual(dueNow(items, 6000).map((i) => i.id), ['a', 'c']);
});

test('the Mac notifier: sends what is due once, skips what is stale, nothing without a subscribed device', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const { startNotifier, plan } = await import('../server/notify.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-notify-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('programme', 'meta', meta);
    for (const a of areas) store.writeLocal('tendons', `area.${a.id}`, a);
    store.writeLocal('tendons', 'readiness', { kind: 'readiness', ...table });
    store.writeLocal('sessions', 'hevy.x', { id: 'hevy.x', kind: 'workout', status: 'done', dayType: 'push', startedAt: at('2026-01-18', '05:00') });
    store.writeLocal('days', '2026-01-20', { date: '2026-01-20', sessionTime: '04:30' });
    let now = at('2026-01-20', '04:01');
    const sent = [];
    let devices = [];
    const push = { list: () => devices, notify: async (m) => { sent.push(m); return { sent: devices.length, failed: 0, dropped: 0 }; } };
    const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
    n.stop();
    assert.deepEqual(await n.tick(), []); // no device yet
    devices = [{ deviceId: 'a1b2c3d4e5f6' }];
    assert.deepEqual((await n.tick()).map((i) => i.id), ['readiness:2026-01-20']);
    assert.equal(sent[0].url, '#/checkin');
    assert.deepEqual(await n.tick(), []); // not twice
    // He checks in on the phone (it syncs): the session reminder still comes, without "check-in still open".
    store.writeLocal('days', '2026-01-20', { date: '2026-01-20', sessionTime: '04:30', readiness: { action: 'train' } });
    now = at('2026-01-20', '04:30');
    const s = await n.tick();
    assert.deepEqual(s.map((i) => i.id), ['session:2026-01-20']);
    assert.equal(sent[1].body, 'Tuesday 1/20. Week 3 column.');
    // The Mac was asleep through the evening holds time: 40 minutes late is skipped, the round-up still comes.
    now = at('2026-01-20', '20:31');
    assert.deepEqual((await n.tick()).map((i) => i.id), ['evening:2026-01-20']);
    assert.ok(plan(store, now, TZ).some((i) => i.id === 'holds-evening:2026-01-20'));
    assert.ok(Object.keys(store.getMeta('notify:sent')).length === 3);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('meals (6.3): nothing logged near a meal time asks 45 minutes later; cooking asks again; after photo at 25 min', async () => {
  const { mealReminders } = await import('../app/js/lib/fuel-reminders.js');
  const date = '2026-01-20';
  const settings = { fuel: { mealTimes: [{ name: 'Breakfast', time: '07:30' }, { name: 'Lunch', time: '12:30' }] } };
  const breakfast = { id: 'm1', date, at: at(date, '07:40'), name: 'Breakfast', source: 'photo', before: { photoId: 'p1', at: at(date, '07:40') }, after: null };
  let items = remindersFor({ ...base, date, last: null, settings, meals: [breakfast] }).filter((i) => i.kind === 'meals');
  const k = byKind(items);
  assert.equal(items.length, 3);
  const lunch = items.find((i) => i.id === `meal:${date}:1230`);
  assert.equal(lunch.at, at(date, '13:15'));
  assert.equal(lunch.title, 'Lunch time');
  assert.equal(lunch.body, '1:15 PM, nothing logged since breakfast. Eaten, cooking, or skipping?');
  assert.equal(lunch.url, `#/fuel/check/${date}/1230`);
  assert.equal(lunch.due, true);
  assert.equal(items.find((i) => i.id === `meal:${date}:0730`).due, false);
  assert.equal(k['meal-after'].at, at(date, '08:05'));
  assert.equal(k['meal-after'].due, true);
  // Cooking: no lunch reminder, a follow-up 30 minutes after the answer until a meal is logged.
  const checks = [{ id: `${date}.1230`, date, slot: '12:30', answer: 'cooking', at: at(date, '13:16') }];
  items = mealReminders({ date, tz: TZ, meals: [breakfast], checks, mealTimes: settings.fuel.mealTimes });
  assert.equal(items.find((i) => i.id === `meal:${date}:1230`).due, false);
  const again = items.find((i) => i.id.startsWith('meal-cooking'));
  assert.equal(again.at, at(date, '13:46'));
  assert.equal(again.due, true);
  const lunchMeal = { id: 'm2', date, at: at(date, '13:40'), name: 'Lunch', source: 'manual', before: { photoId: null } };
  items = mealReminders({ date, tz: TZ, meals: [breakfast, lunchMeal], checks, mealTimes: settings.fuel.mealTimes });
  assert.equal(items.find((i) => i.id.startsWith('meal-cooking')).due, false);
  // No meal times set: only the after photo. Switched off: nothing.
  assert.deepEqual(remindersFor({ ...base, date, last: null, meals: [breakfast] }).filter((i) => i.kind === 'meals').map((i) => i.id), ['meal-after:m1']);
  assert.equal(remindersFor({ ...base, date, last: null, meals: [breakfast], settings: { notify: { kinds: { meals: false } } } }).filter((i) => i.kind === 'meals').length, 0);
  assert.equal(dueNow(items, at(date, '13:20')).length, 0);
});

test('supplements (6.6): at his times, again every 45 minutes until answered, open ones in the evening', async () => {
  const { logEntry } = await import('../app/js/lib/supplements.js');
  const date = '2026-01-20';
  const s = (id, extra) => ({ id, name: id, short: id, dose: '5 g', time: '07:00', days: { type: 'daily' }, history: [{ on: '2026-01-01', status: 'active' }], order: 0, ...extra });
  const supplements = [s('creatine', { order: 0 }), s('vitamin C', { dose: '1,000 mg', order: 1 }), s('magnesium', { time: '21:00', dose: '375 mg', doseRest: '750 mg' }), s('collagen', { time: null })];
  let items = remindersFor({ ...base, date, last: { dayType: 'legs', date: '2026-01-19' }, supplements });
  const sup = items.filter((i) => i.kind === 'supps');
  assert.deepEqual(sup.map((i) => i.id), [`supps:${date}:0700`, `supps-again:${date}:0700:1`, `supps-again:${date}:0700:2`, `supps-again:${date}:0700:3`,
    `supps:${date}:2100`, `supps-again:${date}:2100:1`, `supps-again:${date}:2100:2`, `supps-again:${date}:2100:3`]);
  assert.equal(sup[0].at, at(date, '07:00'));
  assert.equal(sup[0].title, 'Morning supplements');
  assert.equal(sup[0].body, 'Creatine 5 g, Vitamin C 1,000 mg. Tap to tick them off.');
  assert.equal(sup[0].fixed, true);
  assert.equal(sup[1].at, at(date, '07:45'));
  assert.equal(sup[1].body, "Morning stack's still open: creatine, vitamin C. Taken or skipped?");
  // The day after Legs is the rotation's rest day: magnesium's rest-day dose.
  assert.equal(sup[5].body, "Magnesium still unticked. It's a rest day, so 750 mg.");
  const evening = items.find((i) => i.kind === 'evening');
  assert.match(evening.body, /Supplements still open: creatine, vitamin C, magnesium, collagen\./);
  assert.equal(evening.url, '#/holds');
  // Answered: no more asking; skipped counts as answered.
  const log = [logEntry({ supp: supplements[0], date, dayKind: 'rest', status: 'taken', at: 1 }), logEntry({ supp: supplements[1], date, dayKind: 'rest', status: 'skipped', reason: 'ran out', at: 1 })];
  items = remindersFor({ ...base, date, last: { dayType: 'legs', date: '2026-01-19' }, supplements, suppLog: log });
  assert.equal(items.filter((i) => i.id.startsWith(`supps-again:${date}:0700`)).every((i) => !i.due), true);
  assert.equal(items.find((i) => i.id === `supps-again:${date}:2100:1`).due, true);
  // Switched off in Settings: none, and nothing in the evening round-up.
  items = remindersFor({ ...base, date, last: { dayType: 'legs', date: '2026-01-19' }, supplements, settings: { notify: { kinds: { supps: false } } } });
  assert.equal(items.filter((i) => i.kind === 'supps').length, 0);
  assert.doesNotMatch(items.find((i) => i.kind === 'evening')?.body || '', /Supplements/);
});
