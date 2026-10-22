import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remindersFor, dueNow, checkInLead } from '../app/js/lib/reminders.js';

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
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18', streak: 2 }, days });
  const k = byKind(items);
  assert.deepEqual(items.map((i) => i.id.split(':')[0]), ['readiness', 'session', 'holds-evening', 'evening']);
  assert.equal(k.readiness.at, at('2026-01-20', '04:00'));
  assert.equal(k.readiness.title, 'Sore, or good to go?');
  assert.equal(k.readiness.body, 'Legs at 4:30 AM, week 3 column. Knees, shoulder, legs, back, then energy. Zero to three.');
  assert.equal(k.readiness.url, '#/checkin');
  assert.equal(k.session.title, 'Legs at 4:30 AM');
  assert.equal(k.session.body, 'Tuesday 1/20. Week 3 column. Check-in still open.');
  assert.equal(k['holds-evening'].at, at('2026-01-20', '19:30'));
  assert.equal(k['holds-evening'].body, 'Knees: Wall Hold. 3 × 30 s each, about 6 min a round.');
  // Legs not done by the evening: it is still next tomorrow (decision 15), with no time set yet.
  assert.equal(k.evening.body, 'Still open: knees (Gym Hold), knees (Wall Hold). Tomorrow: Legs. No time set yet.');
  assert.equal(k.evening.at, at('2026-01-20', '20:30'));
});

test('session time set after the usual check-in time: the check-in reminder comes just before he leaves, not at once', () => {
  // Thu 10/22: at 9:23 AM he set Legs for 9:50 AM; the 9:20 AM check-in fired a minute later.
  const last = { dayType: 'push', date: '2026-01-18', streak: 2 };
  const late = { '2026-01-20': { date: '2026-01-20', sessionTime: '09:50', timeSetAt: at('2026-01-20', '09:23') } };
  const k = byKind(remindersFor({ ...base, date: '2026-01-20', last, days: late }));
  assert.equal(k.readiness.at, at('2026-01-20', '09:45'));
  assert.deepEqual(dueNow(Object.values(k), at('2026-01-20', '09:24')), []);
  assert.deepEqual(dueNow(Object.values(k), at('2026-01-20', '09:45')).map((i) => i.kind), ['readiness']);
  // Set in time: the usual 30 minutes before.
  const early = { '2026-01-20': { date: '2026-01-20', sessionTime: '09:50', timeSetAt: at('2026-01-20', '09:10') } };
  assert.equal(byKind(remindersFor({ ...base, date: '2026-01-20', last, days: early })).readiness.at, at('2026-01-20', '09:20'));
  // Set 3 minutes before the session: no check-in reminder; the session's own says the check-in is still open.
  const close = { '2026-01-20': { date: '2026-01-20', sessionTime: '09:50', timeSetAt: at('2026-01-20', '09:47') } };
  const k3 = byKind(remindersFor({ ...base, date: '2026-01-20', last, days: close }));
  assert.equal(k3.readiness, undefined);
  assert.match(k3.session.body, /Check-in still open/);
  assert.equal(checkInLead({ sessionTime: '09:50' }, '2026-01-20', TZ, 30), 30, 'no timeSetAt: the usual time');
});

test('done things switch reminders off: check-in in, session started, holds logged', () => {
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30', readiness: { action: 'train' } } };
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18', streak: 2 }, days, trainedDates: new Set(['2026-01-20']), rounds: { knees: { '2026-01-20': 2 } } });
  const k = byKind(items);
  assert.equal(k.readiness.due, false);
  assert.equal(k.session.due, false);
  assert.equal(k['holds-evening'].due, false);
  assert.equal(k.evening.body, 'Tomorrow: Legs. No time set yet.'); // the session is still running, nothing is open
  // Once Legs is finished today: no session reminders, and tomorrow is the rotation's rest day.
  const done = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'legs', date: '2026-01-20', streak: 3 }, days, rounds: { knees: { '2026-01-20': 2 } } });
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
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'legs', date: '2026-01-19', streak: 3 }, days });
  const k = byKind(items);
  assert.equal(k['holds-morning'].title, 'Rest day holds: what today?');
  assert.equal(k['holds-morning'].body, 'Knees: Wall Hold. 3 × 30 s each, about 6 min a round. Shoulder: the gym for the Raise Hold hold, another hold, or skip today?');
  assert.match(k.evening.body, /Tomorrow: Pull at 5:00 AM, check-in at 4:30 AM\.$/);
});

test('rest day (A2): his answer drives the reminder; a skip drops the shoulder from it and from the evening list', () => {
  const day = (restHolds) => ({ '2026-01-20': { date: '2026-01-20', restHolds } });
  const run = (restHolds) => byKind(remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'legs', date: '2026-01-19', streak: 3 }, days: day(restHolds) }));
  let k = run({ shoulder: { choice: 'gym', at: 1 } });
  assert.equal(k['holds-morning'].title, 'Rest day holds');
  assert.equal(k['holds-morning'].body, 'Knees: Wall Hold. Shoulder: Raise Hold. 3 × 30 s each, about 6 min a round.');
  k = run({ shoulder: { choice: 'other', holdName: 'Band hold', at: 1 } });
  assert.equal(k['holds-morning'].body, 'Knees: Wall Hold. Shoulder: Band hold. 3 × 30 s each, about 6 min a round.');
  k = run({ shoulder: { choice: 'skip', at: 1 } });
  assert.equal(k['holds-morning'].body, 'Knees: Wall Hold. 3 × 30 s each, about 6 min a round.');
  assert.doesNotMatch(k.evening.body, /shoulder/);
});

test('settings: kinds switched off, own times', () => {
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30' } };
  const settings = { notify: { kinds: { session: false, evening: false }, readinessMin: 45, holdsEvening: '21:00' } };
  const items = remindersFor({ ...base, date: '2026-01-20', last: { dayType: 'push', date: '2026-01-18', streak: 2 }, days, settings });
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
    // Mon 10/19: the coach says it: title Coach, the reminder's title first, one short line (the plain bank's here).
    assert.equal(sent[1].title, 'Coach');
    assert.equal(sent[1].body, 'Legs at 4:30 AM. Tuesday 1/20. Week 3 column. Get it done.');
    assert.ok(store.listRecords('coach-messages').some((r) => r.data.kind === 'reminder' && r.data.text === sent[1].body), 'it also shows in Talk');
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
  const all = remindersFor({ ...base, date, last: null, settings, meals: [breakfast] }).filter((i) => i.kind === 'meals');
  let items = all.filter((i) => !i.group);
  const k = byKind(items);
  assert.equal(items.length, 3);
  // Thu 10/22, his words: "He should remind me every 5 minutes if I haven't responded": every 5 minutes for 2 hours.
  const again = all.filter((i) => i.group === `meal-again:${date}:1230`);
  assert.equal(again.length, 24);
  assert.deepEqual([again[0].at, again[23].at], [at(date, '13:20'), at(date, '15:15')]);
  assert.equal(again[0].body, 'Asked at 1:15 PM. Eaten, cooking, or skipping?');
  assert.ok(again.every((i) => i.due) && all.filter((i) => i.group === `meal-again:${date}:0730`).every((i) => !i.due), 'breakfast was logged');
  const lunch = items.find((i) => i.id === `meal:${date}:1230`);
  assert.equal(lunch.at, at(date, '13:15'));
  assert.equal(lunch.title, 'Lunch time');
  assert.equal(lunch.body, '1:15 PM, nothing logged since your 7:40 AM meal. Eaten, cooking, or skipping?');
  assert.equal(lunch.url, `#/fuel/check/${date}/1230`);
  assert.equal(lunch.due, true);
  assert.equal(items.find((i) => i.id === `meal:${date}:0730`).due, false);
  assert.equal(k['meal-after'].at, at(date, '08:05'));
  assert.equal(k['meal-after'].due, true);
  // Cooking (Thu 10/22, his words): checked back 15 minutes after the answer, "to see if you have eaten it so you can
  // log it", then every 5 minutes until a meal is logged.
  const checks = [{ id: `${date}.1230`, date, slot: '12:30', answer: 'cooking', at: at(date, '13:16') }];
  items = mealReminders({ date, tz: TZ, meals: [breakfast], checks, mealTimes: settings.fuel.mealTimes });
  assert.equal(items.find((i) => i.id === `meal:${date}:1230`).due, false);
  assert.ok(items.filter((i) => i.group === `meal-again:${date}:1230`).every((i) => !i.due), 'answered: no more repeats');
  const cooking = items.find((i) => i.id.startsWith('meal-cooking'));
  assert.equal(cooking.at, at(date, '13:31'));
  assert.equal(cooking.title, 'Lunch: eaten?');
  assert.equal(cooking.due, true);
  assert.deepEqual(items.filter((i) => i.group === `meal-cooking:${date}:1230`).slice(1, 3).map((i) => i.at), [at(date, '13:36'), at(date, '13:41')]);
  // About to cook: asked again in 5 minutes, "cooking yet?".
  const soon = mealReminders({ date, tz: TZ, meals: [breakfast], checks: [{ ...checks[0], answer: 'soon' }], mealTimes: settings.fuel.mealTimes }).find((i) => i.id.startsWith('meal-soon'));
  assert.deepEqual([soon.at, soon.title, soon.due], [at(date, '13:21'), 'Lunch: cooking yet?', true]);
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
  let items = remindersFor({ ...base, date, last: { dayType: 'legs', date: '2026-01-19', streak: 3 }, supplements });
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
  items = remindersFor({ ...base, date, last: { dayType: 'legs', date: '2026-01-19', streak: 3 }, supplements, suppLog: log });
  assert.equal(items.filter((i) => i.id.startsWith(`supps-again:${date}:0700`)).every((i) => !i.due), true);
  assert.equal(items.find((i) => i.id === `supps-again:${date}:2100:1`).due, true);
  // Switched off in Settings: none, and nothing in the evening round-up.
  items = remindersFor({ ...base, date, last: { dayType: 'legs', date: '2026-01-19', streak: 3 }, supplements, settings: { notify: { kinds: { supps: false } } } });
  assert.equal(items.filter((i) => i.kind === 'supps').length, 0);
  assert.doesNotMatch(items.find((i) => i.kind === 'evening')?.body || '', /Supplements/);
});

test('supplements (6.7): running low asks every evening until answered for that count; weekly planning on Sundays', async () => {
  const { logEntry } = await import('../app/js/lib/supplements.js');
  const date = '2026-01-18'; // a Sunday
  const cr = { id: 'cr', name: 'Creatine monohydrate', short: 'creatine', dose: '5 g', time: null, days: { type: 'daily' }, history: [{ on: '2026-01-01', status: 'active' }], stock: { servings: 8, countedAt: at('2026-01-15', '00:00') }, perTake: { train: 1, rest: 1 } };
  const log = [logEntry({ supp: cr, date: '2026-01-17', dayKind: 'train', status: 'taken', at: at('2026-01-17', '08:00') })];
  let items = remindersFor({ ...base, date, last: null, supplements: [cr], suppLog: log }).filter((i) => i.kind === 'supps');
  const low = items.find((i) => i.id.startsWith('supps-low:cr'));
  assert.equal(low.body, 'Creatine: 7 servings left, about a week. Restocking?');
  assert.equal(low.at, at(date, '20:40'));
  assert.equal(low.url, '#/supps/plan/cr');
  assert.equal(low.due, true);
  const plan = items.find((i) => i.id === `supps-plan:${date}`);
  assert.equal(plan.at, at(date, '20:45'));
  assert.equal(plan.due, true);
  const answers = [{ kind: 'low', suppId: 'cr', countedAt: cr.stock.countedAt, answer: 'restock', date }, { kind: 'weekly', date: '2026-01-13', answer: 'nothing' }];
  items = remindersFor({ ...base, date, last: null, supplements: [cr], suppLog: log, suppAnswers: answers }).filter((i) => i.kind === 'supps');
  assert.equal(items.find((i) => i.id.startsWith('supps-low:cr')).due, false);
  assert.equal(items.find((i) => i.id === `supps-plan:${date}`).due, false);
  // Not on other weekdays; a new count after restocking starts over.
  assert.equal(remindersFor({ ...base, date: '2026-01-19', last: null, supplements: [cr] }).some((i) => i.id.startsWith('supps-plan')), false);
});

test('sauna (6.9): planned day with the step and checklist, overdue backup at round + 5 min, the question 15 minutes after', () => {
  const date = '2026-01-20';
  const t = at(date, '17:00');
  const plan = { planned: [{ date, time: '17:00' }] };
  let items = remindersFor({ ...base, date, last: null, sauna: [], saunaPlan: plan }).filter((i) => i.kind === 'sauna');
  assert.equal(items.length, 1);
  assert.equal(items[0].at, t);
  assert.equal(items[0].title, 'Sauna today');
  assert.match(items[0].body, /^1 round of 10 minutes\. Checklist first: .*Never before lifting\.$/);
  assert.equal(items[0].fixed, true);
  const active = { id: 'sa', date, status: 'active', plannedRounds: 1, rounds: [{ n: 1, planned: 10, inAt: t + 60000, outAt: null }], after: null };
  items = remindersFor({ ...base, date, last: null, sauna: [active], saunaPlan: plan }).filter((i) => i.kind === 'sauna');
  const over = items.find((i) => i.id === 'sauna-overdue:sa:1');
  assert.equal(over.at, t + 16 * 60000);
  assert.equal(over.body, 'Round 1 was 10 minutes. Get out now and tap OUT.');
  assert.equal(over.due, true);
  assert.equal(items.find((i) => i.id === `sauna-day:${date}`).due, false);
  const done = { ...active, status: 'done', rounds: [{ ...active.rounds[0], outAt: t + 11 * 60000 }], endedAt: t + 11 * 60000, after: { dueAt: t + 26 * 60000, answeredAt: null } };
  items = remindersFor({ ...base, date, last: null, sauna: [done] }).filter((i) => i.kind === 'sauna');
  assert.deepEqual(items.map((i) => [i.id, i.due]), [['sauna-after:sa', true]]);
  assert.equal(items[0].at, t + 26 * 60000);
});

test('a discarded session does not count as trained: the day keeps its check-in and session reminders', async () => {
  const { reminderState } = await import('../app/js/lib/reminders.js');
  const st = reminderState({ sessions: [{ id: 'x', kind: 'workout', status: 'discarded', startedAt: at('2026-01-20', '05:00') }], days: [] }, TZ);
  assert.equal(st.trainedDates.has('2026-01-20'), false);
  const st2 = reminderState({ sessions: [{ id: 'y', kind: 'workout', status: 'active', startedAt: at('2026-01-20', '05:00') }], days: [] }, TZ);
  assert.equal(st2.trainedDates.has('2026-01-20'), true);
});

test('meals with a latest time and cook minutes (Tue 10/20): cook reminder, asked at the meal time, the latest named', async () => {
  const { mealReminders, mealTimesOf } = await import('../app/js/lib/fuel-reminders.js');
  const date = '2026-01-21';
  const mealTimes = [{ name: 'First meal', time: '12:30', latest: '14:00', cookMin: 30 }, { name: 'Last meal', time: '16:30', latest: '17:00', cookMin: 30 }];
  const items = mealReminders({ date, tz: base.tz, meals: [], mealTimes });
  const id = (x) => items.find((i) => i.id === x);
  const cook = id(`meal-cook:${date}:1230`);
  assert.equal(cook.kind, 'cook');
  assert.equal(cook.at, at(date, '12:00'));
  assert.equal(cook.title, 'Start cooking: first meal at 12:30 PM');
  assert.equal(cook.body, '30 minutes to get it on the plate; 2:00 PM at the latest.');
  const ask = id(`meal:${date}:1230`);
  assert.equal(ask.at, at(date, '12:30'), 'asked at the meal time, not 45 minutes later');
  assert.equal(ask.body, '12:30 PM, nothing logged yet today. 2:00 PM at the latest. Eaten, cooking, or skipping?');
  assert.equal(ask.latestAt, at(date, '14:00'));
  assert.equal(id(`meal-cook:${date}:1630`).at, at(date, '16:00'));
  const eaten = mealReminders({ date, tz: base.tz, meals: [{ id: 'm', date, at: at(date, '12:20'), name: 'First meal' }], mealTimes });
  assert.equal(eaten.find((i) => i.id === `meal-cook:${date}:1230`).due, false, 'eaten: no cook reminder');
  assert.equal(eaten.find((i) => i.id === `meal:${date}:1230`).due, false);
  assert.deepEqual(mealTimesOf([{ name: 'X', time: '12:00', latest: '11:00' }])[0].latest, null, 'a latest before the meal time is ignored');
});

test('a meal asked again every 5 minutes; after the Mac slept, only the latest repeat is sent (Thu 10/22)', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const { startNotifier } = await import('../server/notify.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-meal-again-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { fuel: { mealTimes: [{ name: 'First meal', time: '12:30', latest: '14:00' }] }, notify: { wakeHm: '09:00' } });
    let now = at('2026-01-20', '12:30');
    const sent = [];
    const push = { list: () => [{ deviceId: 'a1b2c3d4e5f6' }], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0, dropped: 0 }; } };
    const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
    n.stop();
    const ids = async () => (await n.tick()).map((i) => i.id || '').filter((id) => /^meal(-again)?:/.test(id));
    assert.deepEqual(await ids(), ['meal:2026-01-20:1230']);
    now = at('2026-01-20', '12:35');
    assert.deepEqual(await ids(), ['meal-again:2026-01-20:1230:1']);
    // Asleep 12:36-12:51: one repeat, the latest, not three at once; the skipped ones never come.
    now = at('2026-01-20', '12:51');
    assert.deepEqual(await ids(), ['meal-again:2026-01-20:1230:4']);
    now = at('2026-01-20', '12:52');
    assert.deepEqual(await ids(), []);
    assert.equal(sent.at(-1).tag, 'meal-2026-01-20-1230');
    // He answers: no more.
    store.writeLocal('meal-checks', '2026-01-20.1230', { id: '2026-01-20.1230', date: '2026-01-20', slot: '12:30', answer: 'skipped', at: at('2026-01-20', '12:53') });
    now = at('2026-01-20', '12:55');
    assert.deepEqual(await ids(), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
