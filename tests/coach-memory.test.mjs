// Thu 10/22: the coach's memory of every day. His words: "it remembers for each day what I've done, what hour, 1 minute,
// everything... every note I've written". A made-up fixture day; the timeline and recall read it live.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { timelineText, timelineEvents, windowOf, recallHits, recallText, fold, lightFold } from '../server/coach/memory.mjs';
import { READ_TOOLS } from '../server/coach/tools-read.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-17') => Date.parse(`${d}T${hm}:00+07:00`); // Tuesday 3/17
let dir; let store;
const w = (col, id, data) => store.writeLocal(col, id, data);
const s = (now = at('23:00')) => snapshot(store, { tz: TZ, now });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-memory-'));
  store = openStore(join(dir, 'db.sqlite'));
  w('sleep-log', '2026-03-17', { id: '2026-03-17', date: '2026-03-17', bed: at('23:50', '2026-03-16'), wake: at('08:10'), inBedMin: 500, asleepMin: 480, note: 'Woke once at 5' });
  w('coach-messages', 'm1', { id: 'm1', role: 'user', text: 'Morning. Slept ok, the Čevapi last night were heavy.', at: at('08:12') });
  w('coach-messages', 'm2', { id: 'm2', role: 'assistant', text: 'Good morning. Pull today at 9:30 AM.', at: at('08:12') + 9000, tools: [{ name: 'log_sleep', summary: 'sleep logged' }] });
  w('coach-messages', 'm3', { id: 'm3', role: 'assistant', kind: 'reminder', text: 'Sore, or good to go? Pull at 9:30 AM.', at: at('09:00') });
  w('coach-messages', 'm4', { id: 'm4', role: 'user', via: 'voice', text: 'ова е белешка за рамото', at: at('09:05') });
  w('supplements', 'supp.c', { id: 'supp.c', name: 'Vitamin C', short: 'vitamin C' });
  w('supp-log', 'x1', { id: 'x1', date: '2026-03-17', suppId: 'supp.c', status: 'taken', dose: '1,000 mg', at: at('15:20') });
  w('supp-log', 'x2', { id: 'x2', date: '2026-03-17', suppId: 'supp.d', status: 'skipped', reason: 'Ran out', at: at('15:21') });
  w('sessions', 'w1', { id: 'w1', kind: 'workout', title: 'Pull', dayType: 'pull', week: 3, startedAt: at('09:31'), endedAt: at('10:40'), pausedMs: 0, status: 'done', note: 'Grip gave out', exercises: [
    { key: 'a', name: 'Pull Up', notes: 'Slow negatives' }, { key: 'b', name: 'Cable Row' }, { key: 'c', name: 'Shrug', skipped: { at: at('10:30'), reason: 'neck tight' } }] });
  w('sets', 's1', { id: 's1', sessionId: 'w1', exKey: 'a', order: 0, type: 'warmup', kg: 0, reps: 5, done: true, doneAt: at('09:35') });
  w('sets', 's2', { id: 's2', sessionId: 'w1', exKey: 'a', order: 1, type: 'normal', kg: 5, reps: 8, rpe: 8, done: true, doneAt: at('09:40'), note: 'elbow fine' });
  w('sets', 's3', { id: 's3', sessionId: 'w1', exKey: 'b', order: 2, type: 'normal', kg: 45, reps: 10, done: true, doneAt: at('09:52') });
  w('sets', 's4', { id: 's4', sessionId: 'w1', exKey: 'b', order: 3, type: 'normal', kg: 47.5, reps: 10, done: false });
  w('sessions', 'h1', { id: 'h1', kind: 'holds', area: 'knees', round: 'evening', startedAt: at('21:00'), endedAt: at('21:06'), status: 'done', exercises: [{ key: 'k', name: 'Toes Wall Squat' }] });
  w('sets', 'hs1', { id: 'hs1', sessionId: 'h1', exKey: 'k', order: 0, type: 'hold', durationS: 30, pain: 3, shaking: 2, done: true, doneAt: at('21:01') });
  w('sessions', 'old', { id: 'old', kind: 'workout', title: 'Legs', source: 'hevy', startedAt: at('05:00', '2026-03-10'), endedAt: at('06:00', '2026-03-10'), status: 'done', exercises: [{ key: 'q', name: 'Squat (Smith Machine)' }] });
  w('sets', 'o1', { id: 'o1', sessionId: 'old', exKey: 'q', order: 0, type: 'normal', kg: 43.8, reps: 8, done: true });
  w('sets', 'o2', { id: 'o2', sessionId: 'old', exKey: 'q', order: 1, type: 'normal', kg: 43.8, reps: 8, done: true });
  w('meals', 'meal1', { id: 'meal1', date: '2026-03-17', at: at('15:05'), name: 'Lunch', note: 'chevapi again', before: { photoId: 'p1', items: [{ name: 'Beef', grams: 500, kcal: 650, protein: 104 }, { name: 'Rice', grams: 400, kcal: 520, protein: 10 }] }, after: { at: at('15:40'), none: true } });
  w('meal-checks', '2026-03-17.1430', { id: '2026-03-17.1430', date: '2026-03-17', slot: '14:30', name: 'Last meal', answer: 'cooking', at: at('14:40') });
  w('days', '2026-03-17', { date: '2026-03-17', sessionTime: '09:30', timeSetAt: at('08:15'), readiness: { at: at('09:10'), dayType: 'pull', ratings: { T: { shoulder: 1 }, W: { shoulder: false }, B: 0, E: 2 }, action: 'train' } });
  w('walks', '2026-03-17', { id: '2026-03-17', date: '2026-03-17', plan: { at: at('18:00'), said: 'after dinner', setAt: at('16:00') }, walks: [{ at: at('18:40'), minutes: 30 }], skips: [], goalAt: at('18:45') });
  w('coach-reminders', 'r1', { id: 'r1', at: at('17:00'), createdAt: at('16:10'), text: 'Buy water', firedAt: at('17:00') });
  w('coach-reminders', 'r2', { id: 'r2', at: at('19:00'), createdAt: at('16:11'), text: 'Call home', cancelledAt: at('16:30') });
  w('coach-holds', 'ho1', { id: 'ho1', areas: ['sauna'], until: at('23:59'), reason: 'busy tonight', at: at('16:20') });
  w('coach-notes', 'n1', { id: 'n1', at: at('12:00'), date: '2026-03-17', text: 'Errands wait only when they land mid-meal', topic: 'memory', edited: at('12:30'), replaced: [{ text: 'Errands always wait for the meal', from: at('12:00'), until: at('12:30') }] });
  w('coach-changes', 'chg.1', { id: 'chg.1', at: at('12:01'), said: 'Errands should wait', status: 'done', doneAt: at('12:20'), answer: 'Done: errands wait.', asks: [{ at: at('12:01'), said: 'Errands should wait', kind: 'ask' }, { at: at('12:05'), said: 'only mid-meal', kind: 'amend' }] });
  w('measurements', 'measure.2026-03-17', { id: 'measure.2026-03-17', date: '2026-03-17', at: at('09:20'), weightKg: 75.1, source: 'evolt' });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test('the timeline of a day: every event to the minute, oldest first, from the app\'s own records', () => {
  const text = timelineText(s(), { date: '2026-03-17' });
  const lines = text.split('\n');
  assert.match(lines[0], /^Timeline, Tuesday 3\/17: \d+ events, from the app's records \(exact times\)\.$/);
  const want = [
    '8:10 AM [sleep] Woke up: 8 h asleep. Woke once at 5',
    '8:12 AM [messages] He: "Morning. Slept ok, the Čevapi last night were heavy."',
    '8:12 AM [messages] Coach: "Good morning. Pull today at 9:30 AM." [sleep logged]',
    '8:15 AM [days] Session time for 2026-03-17 set: 9:30 AM',
    '9:00 AM [notifications] Sent to him (reminder): "Sore, or good to go? Pull at 9:30 AM."',
    '9:05 AM [messages] He (voice): "ова е белешка за рамото"',
    '9:10 AM [checkins] Readiness check-in (Pull): shoulder 1, back 0, energy 2 -> train',
    '9:20 AM [scans] Weigh-in (evolt): 75.1 kg',
    '9:31 AM [workouts] Workout: Pull (week 3) started',
    '9:31 AM [workouts] Note on Pull Up: Slow negatives',
    '9:35 AM [workouts] Pull Up warm-up: 0 kg × 5',
    '9:40 AM [workouts] Pull Up set 1: 5 kg × 8, RPE 8. Note: elbow fine',
    '9:52 AM [workouts] Cable Row set 1: 45 kg × 10',
    '10:30 AM [workouts] Skipped Shrug: neck tight',
    '10:40 AM [workouts] Workout: Pull (week 3) ended: 69 min, 2 sets. Note: Grip gave out',
    '12:00 PM [notes] Coach note (memory): Errands wait only when they land mid-meal',
    '12:01 PM [changes] He asked for a change: "Errands should wait" [chg.1]',
    '12:05 PM [changes] He added to his change request: "only mid-meal" [chg.1]',
    '12:20 PM [changes] Change done: Done: errands wait. [chg.1]',
    '12:30 PM [notes] Note n1 reworded (was: Errands always wait for the meal)',
    '2:40 PM [meals] Meal answer (Last meal): cooking',
    '3:05 PM [meals] Meal: Lunch: Beef 500 g, Rice 400 g; 1170 kcal, 114 g protein; before photo. Note: chevapi again',
    '3:20 PM [supplements] Supplement taken: vitamin C (1,000 mg)',
    '3:21 PM [supplements] Supplement skipped: supp.d, reason: Ran out',
    '3:40 PM [meals] After the lunch: ate it all',
    '4:00 PM [walks] Walk planned for 6:00 PM ("after dinner")',
    '4:10 PM [reminders] Reminder set for 5:00 PM: "Buy water" [r1]',
    '4:11 PM [reminders] Reminder set for 7:00 PM: "Call home" [r2]',
    '4:20 PM [holdoffs] He asked the app to hold off sauna until 11:59 PM ("busy tonight")',
    '4:30 PM [reminders] Reminder cancelled: "Call home" [r2]',
    '5:00 PM [reminders] Reminder went off [r1]',
    '6:40 PM [walks] Walk done: 30 min',
    '6:45 PM [walks] Step goal reached',
    '9:00 PM [holds] Holds round (knees, evening) started',
    '9:01 PM [holds] Toes Wall Squat set 1: 30 s (hold), pain 3/10, shaking 2',
    '9:06 PM [holds] Holds round (knees, evening) ended: 6 min, 1 set',
  ];
  assert.deepEqual(lines.slice(2), want);
  assert.equal(lines[1], 'Tuesday 3/17:');
  assert.doesNotMatch(text, /47\.5/, 'a set not ticked is not something he did');
});

test('"what did I eat at 3 PM last Tuesday?": exact from the timeline, narrowed by kinds or a window', () => {
  const later = s(at('10:00', '2026-03-22'));
  const meals = timelineText(later, { date: '2026-03-17', kinds: ['meals'] });
  assert.match(meals, /^Timeline, Tuesday 3\/17 \(meals\): 3 events/);
  assert.match(meals, /3:05 PM \[meals\] Meal: Lunch: Beef 500 g, Rice 400 g; 1170 kcal, 114 g protein/);
  const around = timelineText(later, { from: '2026-03-17 14:30', to: '2026-03-17 15:30' });
  assert.match(around, /^Timeline, Tuesday 3\/17, 2:30 PM to Tuesday 3\/17, 3:30 PM: 4 events/);
  assert.doesNotMatch(around, /Workout/);
  assert.match(timelineText(later, { from: '2026-03-17 15:00' }), /^Timeline, Tuesday 3\/17, 3:00 PM to Tuesday 3\/17, 4:00 PM/, 'a from time alone: the hour after it');
  // Imported sessions have no set times: one line per exercise at the start, marked.
  assert.match(timelineText(later, { date: '2026-03-10' }), /5:00 AM \[workouts\] Workout: Legs started \(from Hevy\)\n5:00 AM \[workouts\] \(no set times\) Squat \(Smith Machine\) set 1: 43\.8 kg × 8; Squat \(Smith Machine\) set 2: 43\.8 kg × 8/);
  assert.equal(timelineText(later, { date: '2026-03-12' }), 'Nothing recorded Thursday 3/12.');
});

test('windows: a date, from/to with times, at most 7 days, bad input explained', () => {
  const o = { tz: TZ, today: '2026-03-17' };
  assert.deepEqual(windowOf({}, o), { from: at('00:00'), to: at('00:00', '2026-03-18') });
  assert.deepEqual(windowOf({ from: '2026-03-15', to: '2026-03-17' }, o), { from: at('00:00', '2026-03-15'), to: at('00:00', '2026-03-18') });
  assert.match(windowOf({ from: '2026-03-01', to: '2026-03-17' }, o).error, /At most 7 days/);
  assert.match(windowOf({ date: '17/3' }, o).error, /Not a date/);
  assert.match(windowOf({ from: '2026-03-17 10:00', to: '2026-03-17 09:00' }, o).error, /to is before from/);
  assert.equal(timelineEvents(s(), { from: at('09:00'), to: at('09:10') }).length, 2);
});

test('recall: everything he wrote and was told, case and accents aside, Macedonian in Latin or Cyrillic letters', () => {
  assert.equal(fold('Čevapi'), 'cevapi');
  assert.equal(fold('chevapi'), 'cevapi');
  assert.equal(fold('ЧЕВАПИ'), 'cevapi');
  assert.equal(lightFold('Ž'), 'z');
  const one = (q, a = {}) => recallHits(s(), { query: q, ...a });
  // Č, ch and c alike; his message and the meal note both found, the exact spelling first, then newest.
  assert.deepEqual(one('cevapi').hits.map((h) => h.src), ['he wrote', 'meal (Lunch)']);
  assert.deepEqual(one('Čevapi').hits.map((h) => h.src), ['he wrote', 'meal (Lunch)']);
  assert.deepEqual(one('chevapi').hits.map((h) => h.src), ['meal (Lunch)', 'he wrote']);
  // Macedonian in Cyrillic, found with Latin letters.
  assert.deepEqual(one('beleshka ramoto').hits.map((h) => h.src), ['he said (voice)']);
  // Notes of every kind: set, exercise, session, skip reason, old wording of a note, a change he asked for, a supplement reason.
  assert.deepEqual(one('elbow').hits.map((h) => h.src), ['set note (Pull Up, Pull)']);
  assert.deepEqual(one('negatives').hits.map((h) => h.src), ['exercise note (Pull Up, Pull)']);
  assert.deepEqual(one('grip').hits.map((h) => h.src), ['Pull note']);
  assert.deepEqual(one('neck tight').hits.map((h) => h.src), ['skipped Shrug (Pull)']);
  assert.deepEqual(one('always wait').hits.map((h) => h.src), ['coach note, old wording']);
  assert.deepEqual(one('only mid-meal').hits.map((h) => h.src), ['change he asked for', 'coach note (memory)'], 'the exact phrase first');
  assert.deepEqual(one('ran out').hits.map((h) => h.src), ['supplement skipped (supp.d)']);
  assert.equal(one('cevapi', { from: '2026-03-18' }).total, 0, 'from/to narrow it');
  const text = recallText(s(), { query: 'errands wait' });
  assert.match(text, /^Matches for "errands wait" \(\d+\), exact matches first, then newest first:\n- Tuesday 3\/17, 12:\d\d PM · /);
  assert.match(recallText(s(), { query: 'zebra' }), /^Nothing he wrote or was told matches "zebra"/);
  assert.match(recallText(s(), { query: 'zebra grip' }), /^No record has all of "zebra grip"; records with some of the words \(1\), most words first:\n- Tuesday 3\/17, 10:40 AM · Pull note: Grip gave out/);
});

test('the coach has both tools, read only, and the rule to look things up instead of guessing', async () => {
  const ctx = { store, tz: TZ, now: () => at('10:00', '2026-03-22'), action: () => {} };
  const tl = READ_TOOLS.find((x) => x.name === 'timeline');
  const rc = READ_TOOLS.find((x) => x.name === 'recall');
  assert.equal(tl.annotations.readOnlyHint, true);
  assert.equal(rc.annotations.readOnlyHint, true);
  assert.match((await tl.run({ date: '2026-03-17', kinds: ['walks'] }, ctx)).text, /6:45 PM \[walks\] Step goal reached/);
  assert.match((await rc.run({ query: 'buy water' }, ctx)).text, /reminder: Buy water/);
  assert.match(RULES, /the timeline tool has everything that happened, to the minute; recall finds anything he wrote or was told/);
});

test('Sun 10/25: a walk time the app picked is never his words, also in records from before "by"', () => {
  w('walks', '2026-03-17', { id: '2026-03-17', date: '2026-03-17', asks: [], walks: [], skips: [], plan: { at: at('18:00'), said: 'planned by the coach for cooler weather', setAt: at('14:02') } });
  const ev = timelineText(s(), { date: '2026-03-17', kinds: ['walks'] });
  assert.match(ev, /Walk planned for 6:00 PM \(by the app, for the weather\)/);
  assert.doesNotMatch(ev, /planned by the coach/);
  assert.equal(recallHits(s(), { query: 'cooler weather' }).total, 0, 'not recalled as something he said');
});
