// Thu 11/5, his words: "Also dive even deeper figure out more stuff regarding missing features", then "I haven't worked
// out in two weeks... Why is it recommending me to do more?" (Seated Leg Curl: TARGET 40 KG after 36 kg two weeks
// earlier, "+5 kg reaches the plan: 40 kg", a 30% CAP badge with no cap in play). Gaps, the honest plus, the badge only
// when the cap held the number, targets for exercises outside the programme, the swap for today, the form gate, pain per
// area with the repeat flag, and the check-in in his words.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { targetFor, freeTarget, comebackRatio, gapOf, GAP_DAYS } from '../app/js/lib/targets.js';
import { buildSession, swapEntry, latestFormCheck } from '../app/js/lib/session.js';
import { buildHistory } from '../app/js/lib/history.js';
import { routineFromLast } from '../app/js/lib/finish.js';
import { painEntries, painByArea, repeatFlags, areasIn, areaOf, ratingIn } from '../app/js/lib/pain.js';
import { ratingFromWords } from '../app/js/lib/readiness.js';
import { openStore } from '../server/store.mjs';
import { TOOLS, contextLine } from '../server/coach/tools.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const w = (kg, reps, sets, extra = {}) => ({ load: kg == null ? null : { type: 'total', kg, approx: false }, reps, sets, ...extra });
const curl = { capClass: 'main', weeks: [w(25, [10, 12], { count: 1 }), w(30, [10, 12], { count: 2 }), w(35, [8, 10], { count: 2 }), w(40, [6, 8], { count: 2 })] };
const LEVELS = ['none', 'slight (like the "5% sore" you trained through)', 'clearly sore, affects reps', 'very sore, hurts to move'];

test('his leg curl after 2 weeks off: repeat 36 kg and say why; no 30% CAP badge', () => {
  const t = targetFor({ plan: curl, week: 6, last: { kg: 36, reps: 12, date: '2026-10-22', dayType: 'legs' }, today: '2026-11-05', dayType: 'legs', name: 'Seated Leg Curl (Machine)' });
  assert.equal(t.kg, 36);
  assert.equal(t.why, '2 weeks since last Legs (Thursday 10/22): repeat 36 kg, no step up. Goal (The Comeback, week 4): 40 kg');
  assert.ok(!t.capped, 'the cap changed nothing');
  assert.equal(t.gap.days, 14);
});

test('no gap: the plus said is the plus done (36 -> 40 is +4 kg), and no badge when the plan, not the cap, stopped it', () => {
  const t = targetFor({ plan: curl, week: 4, last: { kg: 36, reps: 12, date: '2026-10-28', dayType: 'legs' }, today: '2026-11-05', dayType: 'legs', name: 'Seated Leg Curl (Machine)' });
  assert.equal(t.kg, 40);
  assert.equal(t.why, 'Last time 36 kg, +4 kg reaches the plan: 40 kg');
  assert.ok(!t.capped);
  // 9 days is no gap; 10 is.
  assert.equal(gapOf({ date: '2026-10-27' }, '2026-11-05'), null);
  assert.equal(GAP_DAYS, 10);
  assert.equal(gapOf({ date: '2026-10-26', dayType: 'legs' }, '2026-11-05', 'legs').text, '10 days since last Legs (Monday 10/26)');
  assert.equal(gapOf({ date: '2026-10-26', dayType: 'pull' }, '2026-11-05', 'legs').text, '10 days since you last did it (Monday 10/26)', 'done on another day type');
});

test('the 30% CAP badge shows only when the cap held the number down, with the reason', () => {
  const big = { capClass: 'main', weeks: [w(5, [10, 12]), w(10, [10, 12]), w(20, [10, 12]), w(50, [8, 10])] };
  const t = targetFor({ plan: big, week: 4, last: { kg: 10, reps: 12, date: '2026-11-01' }, today: '2026-11-05', name: 'Leg Extension (Machine)' });
  assert.equal(t.kg, 13, '10 + 5 is over 13 (the cap)');
  assert.equal(t.capped, true);
  assert.equal(t.why, 'Last time 10 kg, +3 kg reaches the 30% cap: 13 kg (a full +5 kg would pass it)');
  const light = targetFor({ plan: big, week: 4, last: { kg: 40, reps: 10, date: '2026-11-01' }, today: '2026-11-05', name: 'Leg Extension (Machine)' });
  assert.ok(!light.capped, 'a normal step: no badge');
});

test('a gap never overrides pain or a skip, and a bar load repeats too', () => {
  const squat = { capClass: 'main', weeks: [w(40, [10, 12]), w(50, [8, 10]), w(65, [6, 8]), w(80, [6, 8])] };
  const pain = targetFor({ plan: squat, week: 4, last: { kg: 61.3, reps: 8, date: '2026-10-22' }, today: '2026-11-05', barKg: 11.3, notes: { pain: { note: 'lower back pain', kg: 61.3, prevGood: { kg: 51.8 } } } });
  assert.equal(pain.kg, 54.3, 'the pain rule still decides');
  const bar = targetFor({ plan: squat, week: 4, last: { kg: 51.8, reps: 8, date: '2026-10-20' }, today: '2026-11-05', barKg: 11.3, dayType: 'legs' });
  assert.equal(bar.kg, 51.8);
  assert.match(bar.why, /^2 weeks since last Legs \(Tuesday 10\/20\): repeat 51\.8 kg, no step up/);
  const calf = { capClass: 'light', override: { source: 'decision 3' }, weeks: [w(null, [15, 20]), w(null, [15, 20]), w(null, [15, 20]), w(null, [15, 20])] };
  const c = targetFor({ plan: calf, week: 4, last: { kg: 86, reps: 17, date: '2026-10-22' }, today: '2026-11-05', dayType: 'legs', name: 'Calf Raise (Horizontal Leg Press)' });
  assert.equal(c.kg, 86);
  assert.equal(c.why, '2 weeks since last Legs (Thursday 10/22): repeat 86 kg, no step up');
});

test('form gate (RDL, hip thrust): no step until his latest form check says consistent on video', () => {
  const hip = { capClass: 'main', weeks: [w(20, [10, 12]), w(25, [10, 12]), w(30, [8, 12]), w(40, [8, 12], { count: 2 }, { gate: 'form-on-video' })] };
  const last = { kg: 27.7, reps: 12, date: '2026-11-01' };
  const held = targetFor({ plan: hip, week: 4, last, today: '2026-11-05', name: 'Hip Thrust (Machine)' });
  assert.equal(held.kg, 27.7);
  assert.equal(held.formHold, true);
  assert.match(held.why, /^Next step only once your form is consistent on video/);
  assert.equal(targetFor({ plan: hip, week: 4, last, today: '2026-11-05', name: 'Hip Thrust (Machine)', formOk: { date: '2026-11-04', ok: false } }).kg, 27.7);
  assert.equal(targetFor({ plan: hip, week: 4, last, today: '2026-11-05', name: 'Hip Thrust (Machine)', formOk: { date: '2026-11-04', ok: true } }).kg, 32.7, 'his yes opens the step');
  const checks = [{ name: 'Hip Thrust (Machine)', date: '2026-11-01', at: 1, ok: true }, { name: 'Hip Thrust (Machine)', date: '2026-11-04', at: 2, ok: false }];
  assert.equal(latestFormCheck(checks, 'Hip Thrust (Machine)').ok, false, 'the latest wins');
});

const sess = (id, date, dayType, exercises, extra = {}) => ({ id, kind: 'workout', title: dayType, dayType, startedAt: Date.parse(`${date}T03:00:00Z`), status: 'done', exercises, ...extra });
const set = (id, sessionId, exKey, kg, reps, extra = {}) => ({ id, sessionId, exKey, order: 0, type: 'normal', kg, reps, done: true, ...extra });
const META = { firstSessions: { pull: '2026-09-24', push: '2026-09-27', legs: '2026-09-28' }, preLayoffCeilings: [{ name: 'Squat (Smith Machine)', kg: 105 }, { name: 'Seated Leg Curl (Machine)', kg: 50 }, { name: 'Leg Extension (Machine)', kg: 89 }] };

test('outside the programme: from before the layoff only = an estimate (his 188 kg × 15 leg press), never the old load', () => {
  const sessions = [
    sess('old', '2024-08-03', 'legs', [{ key: 'p', name: 'Leg Press Horizontal (Machine)' }]),
    sess('l1', '2026-10-22', 'legs', [{ key: 's', name: 'Squat (Smith Machine)' }, { key: 'c', name: 'Seated Leg Curl (Machine)' }, { key: 'e', name: 'Leg Extension (Machine)' }]),
  ];
  const sets = [set('a', 'old', 'p', 188, 15), set('b', 'l1', 's', 51.8, 8), set('c', 'l1', 'c', 36, 12), set('d', 'l1', 'e', 50, 12)];
  const history = buildHistory({ sessions, sets });
  const ratio = comebackRatio({ meta: META, history, dayType: 'legs', since: '2026-09-24' });
  assert.equal(Math.round(ratio.value * 100), 56, 'median of 51.8/105, 36/50, 50/89');
  const ft = freeTarget({ entries: history.all('Leg Press Horizontal (Machine)'), today: '2026-11-05', dayType: 'legs', comebackStart: '2026-09-24', ratio, reps: [10, 12], name: 'Leg Press Horizontal (Machine)' });
  assert.equal(ft.kg, 105.5);
  assert.equal(ft.approx, true);
  assert.match(ft.why, /^Estimate: before the layoff 188 kg × 15 \(Saturday 8\/3\); your programme lifts are back to about 56% of their pre-layoff numbers, so 105\.5 kg$/);
  // In a routine: the rows get the estimate, not 188 + 5.
  const routine = { id: 'legs-x', dayType: 'legs', title: 'Legs', exercises: [{ key: 'r1', exerciseId: 'lp', name: 'Leg Press Horizontal (Machine)', sets: [{ type: 'warmup', kg: 100, reps: 10 }, { type: 'normal', kg: 188, reps: [10, 12] }, { type: 'normal', kg: 188, reps: [10, 12] }] }] };
  const built = buildSession({ routine, meta: META, lib: new Map(), history, today: '2026-11-05' });
  assert.deepEqual(built.sets.map((x) => [x.type, x.kg]), [['warmup', null], ['normal', 105.5], ['normal', 105.5]]);
  assert.equal(built.session.exercises[0].target.kg, 105.5);
  assert.equal(built.session.exercises[0].target.approx, true);
});

test('outside the programme since the comeback: + one step, none after a gap; the card says why', () => {
  const sessions = [sess('t', '2026-11-05', 'legs', [{ key: 'p', name: 'Leg Press Horizontal (Machine)' }])];
  const history = buildHistory({ sessions, sets: [set('a', 't', 'p', 109, 10)] });
  const routine = { id: 'legs-x', dayType: 'legs', title: 'Legs', exercises: [{ key: 'r1', exerciseId: 'lp', name: 'Leg Press Horizontal (Machine)', sets: [{ type: 'normal', kg: 109, reps: [10, 10] }] }] };
  const soon = buildSession({ routine, meta: META, lib: new Map(), history, today: '2026-11-09' });
  assert.equal(soon.sets[0].kg, 114);
  assert.equal(soon.session.exercises[0].target.why, 'Last time 109 kg × 10 (Thursday 11/5), +5 kg');
  const late = buildSession({ routine, meta: META, lib: new Map(), history, today: '2026-11-19' });
  assert.equal(late.sets[0].kg, 109);
  assert.equal(late.session.exercises[0].target.why, '2 weeks since last Legs (Thursday 11/5): repeat 109 kg, no step up');
});

test('swap for today: the card keeps the original, both histories show it, the next workout brings the original back', () => {
  const ex = { key: 'k', exerciseId: 'sq', name: 'Squat (Smith Machine)', type: 'weight_reps', capClass: 'main', target: { kg: 54.3 } };
  const swapped = swapEntry(ex, { id: 'lp', name: 'Leg Press Horizontal (Machine)', type: 'weight_reps' }, { kg: 105 });
  assert.deepEqual(swapped.swappedFrom, { exerciseId: 'sq', name: 'Squat (Smith Machine)' });
  assert.equal(swapEntry(swapped, { id: 'hp', name: 'Hack Squat (Machine)' }).swappedFrom.name, 'Squat (Smith Machine)', 'swapped twice: still the first');
  assert.equal(swapEntry(swapped, { id: 'sq', name: 'Squat (Smith Machine)' }).swappedFrom, null, 'swapped back: no swap');
  const last = sess('s1', '2026-11-05', 'legs', [swapped, { key: 'c', exerciseId: 'lc', name: 'Seated Leg Curl (Machine)' }]);
  const sets = [set('a', 's1', 'k', 105, 12), set('b', 's1', 'c', 36, 12)];
  const h = buildHistory({ sessions: [last], sets });
  assert.deepEqual(h.swaps('Squat (Smith Machine)').map((x) => [x.date, x.from, x.to]), [['2026-11-05', 'Squat (Smith Machine)', 'Leg Press Horizontal (Machine)']]);
  assert.equal(h.swaps('Leg Press Horizontal (Machine)').length, 1);
  assert.equal(h.last('Leg Press Horizontal (Machine)').swappedFrom, 'Squat (Smith Machine)');
  const routine = { id: 'legs-gbi', dayType: 'legs', exercises: [{ key: 'r1', exerciseId: 'sq', name: 'Squat (Smith Machine)', plan: { routine: 'x', name: 'Squat' }, sets: [] }, { key: 'r2', exerciseId: 'lc', name: 'Seated Leg Curl (Machine)', sets: [] }] };
  const next = routineFromLast(routine, last, sets);
  assert.equal(next.exercises[0].name, 'Squat (Smith Machine)');
  assert.deepEqual(next.exercises[0].plan, { routine: 'x', name: 'Squat' }, 'back on its programme target');
  assert.match(next.exercises[0].notes, /^Swapped for Leg Press Horizontal \(Machine\) last time \(.*\): back to Squat \(Smith Machine\)\.$/);
  assert.deepEqual(next.exercises[0].sets, [], 'not the leg press weights');
});

test('pain per area: his lower back on squats Thu 10/22 and Thu 11/5 is flagged; "from squats" on another card counts for squats', () => {
  const sessions = [
    sess('a', '2026-10-22', 'legs', [{ key: 's', name: 'Squat (Smith Machine)' }, { key: 'h', name: 'Hip Thrust (Machine)', skipped: { reason: 'Lower back pain from squats' } }]),
    sess('b', '2026-11-05', 'legs', [
      { key: 's', name: 'Squat (Smith Machine)', skipped: { reason: 'Lower back somewhat sore, tiny pain on bodyweight squat warm-up' } },
      { key: 'r', name: 'RDL (Dumbbell)', skipped: { reason: 'Lower back somewhat sore, tiny pain on bodyweight squat warm-up' } },
      { key: 'k', name: 'Leg Extension Hold (Machine)', skipped: { reason: 'Ill do at home' } },
      { key: 'c', name: 'Seated Leg Curl (Machine)', notes: 'Skipped last time (Thursday 10/22): Lower back pain' },
    ]),
  ];
  const sets = [set('x', 'a', 's', 61.3, 8, { note: 'Lower back pain during set and after too' })];
  const entries = painEntries({ sessions, sets, log: [{ id: 'p1', date: '2026-11-06', at: Date.parse('2026-11-06T03:00:00Z'), area: 'lower-back', rating: 2, lift: null }, { id: 'p2', date: '2026-11-07', at: Date.parse('2026-11-07T03:00:00Z'), area: 'lower-back', rating: 1 }] });
  assert.ok(entries.every((e) => e.area === 'lower-back'), 'only the lower back; "Ill do at home" and the app\'s own "Skipped last time" line are no pain');
  assert.ok(!entries.some((e) => e.lift === 'RDL (Dumbbell)' || e.lift === 'Hip Thrust (Machine)'), 'the squat hurt, not the RDL or hip thrust');
  const flags = repeatFlags(entries);
  assert.deepEqual(flags, [{ lift: 'Squat (Smith Machine)', area: 'lower-back', label: 'Lower back', dates: ['2026-11-05', '2026-10-22'] }]);
  const [back] = painByArea(entries);
  assert.equal(back.label, 'Lower back');
  assert.deepEqual(back.days.map((d) => d.date), ['2026-11-07', '2026-11-06', '2026-11-05', '2026-10-22']);
  assert.equal(back.trend, 'better', '2 -> 1');
  assert.deepEqual(areasIn('lower back and left knee'), ['lower-back', 'knee']);
  assert.deepEqual(areasIn('boli me krstata'), ['lower-back'], 'Macedonian');
  assert.equal(areaOf('back'), 'back');
  assert.equal(ratingIn('pain 3/10 on the way down'), 3);
  assert.equal(ratingIn('a tiny bit'), null, 'no number when he gave none');
});

test('check-in in his words: "somewhat sore and a tiny tiny pain" is a 1, for him to confirm', () => {
  assert.deepEqual(ratingFromWords("I cant rate it... somewhat sore and a tiny tiny pain", 'B', LEVELS), { rating: 1, level: LEVELS[1], why: 'slight' });
  assert.equal(ratingFromWords('fine', 'L').rating, 0);
  assert.equal(ratingFromWords('not sore at all', 'B').rating, 0);
  assert.equal(ratingFromWords('sore', 'B').rating, 2);
  assert.equal(ratingFromWords('really sore, hurts to move', 'L').rating, 3);
  assert.equal(ratingFromWords('about 3/10', 'T').rating, 2, 'his T scale: 3-4/10 is at the limit');
  assert.equal(ratingFromWords('kinda tired', 'E').rating, 1);
  assert.equal(ratingFromWords('good', 'E').rating, 2);
  assert.equal(ratingFromWords('banana', 'B'), null);
});

// ---- the coach's tools ---------------------------------------------------------------------------------------------
const TZ = 'UTC';
const NOW = Date.UTC(2026, 10, 5, 4, 0); // Thursday 11/5, 4:00 AM
let dir; let store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-mft-'));
  store = openStore(join(dir, 'db.sqlite'));
  const put = (col, id, data) => store.writeLocal(col, id, data);
  put('programme', 'meta', { kind: 'meta', ...META });
  put('exercises', 'sq', { id: 'sq', name: 'Squat (Smith Machine)', type: 'weight_reps' });
  put('exercises', 'ht', { id: 'ht', name: 'Hip Thrust (Machine)', type: 'weight_reps' });
  put('sessions', 'a', sess('a', '2026-10-22', 'legs', [{ key: 's', name: 'Squat (Smith Machine)', notes: 'Lower back pain during set' }]));
  put('sets', 'x', set('x', 'a', 's', 61.3, 8));
  put('tendons', 'readiness', { status: 'confirmed', ratings: [{ key: 'B', label: 'Back', levels: LEVELS }] });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const call = (name, args = {}) => TOOLS.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => NOW, action: () => {} });

test('coach: pain_log on his words flags the repeat; pain reads it; the context carries it', async () => {
  const r = await call('pain_log', { action: 'log', area: 'lower back', lift: 'squat', rating: 2, said: 'back hurts on the squat again' });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Logged: Lower back 2\/10 on Squat \(Smith Machine\), Thursday 11\/5/);
  assert.match(r.text, /Flag: Squat \(Smith Machine\) has hurt his lower back 2 times \(Thursday 11\/5, Thursday 10\/22\)/);
  const doc = store.listRecords('pain-log').map((x) => x.data)[0];
  assert.equal(doc.area, 'lower-back');
  const p = await call('pain', {});
  assert.match(p.text, /Lower back: Thursday 11\/5 2\/10 \(Squat \(Smith Machine\)\); Thursday 10\/22 \(Squat \(Smith Machine\)\)/);
  assert.match(p.text, /Same lift, same area again: Squat \(Smith Machine\) and lower back/);
  assert.match(contextLine({ store, tz: TZ, now: NOW }), /Pain log, last 21 days .*Lower back: Thursday 11\/5 2\/10/);
  assert.match((await call('pain_log', { action: 'log', area: 'spleen' })).text, /^Which area\?/);
  const d = await call('pain_log', { action: 'delete', id: doc.id });
  assert.match(d.text, /^Deleted: Lower back/);
});

test('coach: rate_words gives the number for him to confirm; form_check saves his verdict', async () => {
  const r = await call('rate_words', { key: 'B', words: 'somewhat sore and a tiny tiny pain' });
  assert.match(r.text, /reads as 1 for back: "slight \(like the "5% sore" you trained through\)" in his table\. Ask him to confirm/);
  assert.match((await call('rate_words', { key: 'B', words: 'banana' })).text, /gives no number for back\. Ask him once/);
  const f = await call('form_check', { exercise: 'Hip Thrust (Machine)', ok: true, said: 'form looked the same every rep' });
  assert.match(f.text, /^Hip Thrust \(Machine\): form consistent on video \(his call, Thursday 11\/5\)\. Its next target steps up again/);
  assert.deepEqual(store.listRecords('form-checks').map((x) => [x.id, x.data.name, x.data.ok]), [['form.hip-thrust-machine.2026-11-05', 'Hip Thrust (Machine)', true]], 'a synced id (letters, dots, dashes)');
});

test('the coach is told: confirm a rating from words, the form gate is his call, no advice', () => {
  assert.match(RULES, /rate_words maps it to his table's 0-3; ask him to confirm that number/);
  assert.match(RULES, /form_check with his verdict, never your own/);
});
