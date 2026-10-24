// Thu 10/22: the coach reviews each day at night: a diary, dated facts (old ones expired, never deleted), at most 3
// missed fixes (only his words or a clear mistake, never one already asked for), built quietly, and one morning message.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { openNightly, validate, correctionsOf, inputFor, fixedOnMacFrom, DIARY, SUMMARY_WORDS, SINCE, SYSTEM } from '../server/coach/nightly.mjs';
import { openChanges, COL as CHANGES } from '../server/coach/changes.mjs';
import { READ_TOOLS, contextLine } from '../server/coach/tools-read.mjs';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-17') => Date.parse(`${d}T${hm}:00+07:00`);
let dir; let store; let clock;
const w = (col, id, data) => store.writeLocal(col, id, data);
const msg = (id, role, text, hm, d = '2026-03-17', extra = {}) => w('coach-messages', id, { id, role, text, at: at(hm, d), tz: TZ, ...extra });
const recs = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
const talk = () => recs('coach-messages').filter((m) => m.kind === 'nightly' || m.kind === 'change').sort((a, b) => a.at - b.at);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-nightly-'));
  store = openStore(join(dir, 'db.sqlite'));
  clock = at('06:00', '2026-03-18');
  msg('m1', 'user', 'I eat beef at my last meal, always. Eggs are the first meal.', '16:37');
  msg('m2', 'assistant', 'Reminder set for 4:40 PM. It will remind you of the butter step for the eggs.', '16:37');
  msg('m3', 'user', 'From now on I walk at 4 PM every day.', '17:10');
  msg('m4', 'assistant', 'Walk at 4:00 PM, Wednesday 3/18.', '17:11');
  msg('m5', 'user', 'Stop telling me to drink water after every set, it is annoying.', '18:00');
  w('meals', 'meal1', { id: 'meal1', date: '2026-03-17', at: at('13:15'), name: 'Breakfast', before: { items: [{ name: 'Eggs', grams: 600, kcal: 858, protein: 75 }] } });
  w('coach-notes', 'note-old', { id: 'note-old', at: at('09:00', '2026-03-01'), date: '2026-03-01', from: '2026-03-01', text: 'He walks around 6 PM.', topic: 'learned', by: 'nightly' });
  w('coach-notes', 'note-mem', { id: 'note-mem', at: at('09:00', '2026-03-01'), date: '2026-03-01', text: 'Eggs: butter first.', topic: 'memory' });
  w('coach-changes', 'chg.water', { id: 'chg.water', at: at('18:01'), said: 'Stop telling me to drink water after every set', status: 'done', doneAt: at('18:10'), answer: 'Done: no water line after sets.', asks: [{ at: at('18:01'), said: 'Stop telling me to drink water after every set', kind: 'ask' }] });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ANSWER = {
  diary: { summary: 'Ate eggs at 1:15 PM. Said beef is always his last meal. Set his walk at 4 PM daily. Asked to stop the water line.', line: 'Eggs at 1:15 PM; walk moved to 4 PM daily.', words: [{ at: '5:10 PM', text: 'From now on I walk at 4 PM every day.' }, { at: '5:12 PM', text: 'I never said this.' }], decisions: ['Walk at 4 PM every day'], open: ['Beef meal not logged'] },
  facts: [
    { text: 'His last meal is beef; eggs are his first meal.', from: '2026-03-17', replaces: null, source: '4:37 PM, his words' },
    { text: 'He walks at 4 PM every day.', from: '2026-03-17', replaces: 'note-old', source: '5:10 PM, his words' },
  ],
  expire: [{ id: 'note-mem', why: 'not a learned fact' }],
  fixes: [
    { quote: 'It will remind you of the butter step for the eggs.', at: '4:37 PM', about: 'egg tip with the beef meal', want: 'tips only with the meal that has that food', kind: 'bug' },
    { quote: 'Stop telling me to drink water after every set', at: '6:00 PM', about: 'water line', want: 'no water line', kind: 'behaviour' },
    { quote: 'Add a heart-rate chart to the Body screen', at: '6:30 PM', about: 'a feature', want: 'a chart', kind: 'behaviour' },
  ],
  morning: 'Noted: beef is your last meal, eggs the first; walks at 4 PM. The egg tip with the beef meal is being fixed.',
};

function nightly(o = {}) {
  const runs = [];
  const n = openNightly({ store, privateDir: dir, since: '2026-01-01', profile: () => '# Profile\n\n## His corrections\n- Thursday: no apology lines.\n\n## Open questions\n- x', tz: () => TZ, now: () => clock,
    push: { list: () => [{}], notify: async () => ({ sent: 1 }) },
    run: async (a) => { runs.push(a); return { text: JSON.stringify(o.answer ?? ANSWER), ms: 1000 }; }, ...o });
  return { n, runs };
}

test('a day is reviewed after it ends: input written, diary kept, dated facts with the old one expired, fixes filed quietly', async () => {
  const { n, runs } = nightly();
  clock = at('01:29', '2026-03-18');
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16'], 'Tuesday 3/17 not before 1:30 AM');
  clock = at('05:59', '2026-03-18');
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16'], 'no sign he slept: food until 6:00 AM still counts for Tuesday 3/17');
  clock = at('06:00', '2026-03-18');
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16', '2026-03-17']);
  await n.tick();
  assert.equal(runs.length, 1, 'the empty days are passed over without a run');
  assert.equal(store.getRecord(DIARY, '2026-03-15').data.status, 'empty');
  assert.equal(runs[0].model, 'claude-opus-5-5');
  const input = readFileSync(join(dir, 'logs', 'memory', '2026-03-17.txt'), 'utf8');
  assert.equal(runs[0].content, input);
  assert.match(input, /^DAY: Tuesday 3\/17 \(2026-03-17\), time zone Asia\/Bangkok\./);
  assert.match(input, /1:15 PM \[meals\] Meal: Breakfast: Eggs 600 g/);
  assert.match(input, /EVERY MESSAGE, IN FULL[^\n]*\n4:37 PM He: I eat beef at my last meal, always\./);
  assert.match(input, /Learned facts \(current; replaces or expire by id\): \[note-old\] \(from 2026-03-01\) He walks around 6 PM\./);
  assert.match(input, /His corrections in his profile \(rules already made\):\n- Thursday: no apology lines\.\n/);
  assert.match(input, /\[chg\.water\] done: "Stop telling me to drink water after every set" -> Done: no water line after sets\./);
  assert.match(input, /STATE NOW \(Wednesday 3\/18, 6:00 AM; the records, true now\):\nReminders still set \(not sent, not cancelled\): none\nHold-offs running: none\nChange requests not finished: none/);
  assert.ok(existsSync(join(dir, 'logs', 'memory', '2026-03-17.result.json')));
  const d = store.getRecord(DIARY, '2026-03-17').data;
  assert.equal(d.status, 'done');
  assert.deepEqual(d.words.map((x) => x.text), ['From now on I walk at 4 PM every day.'], 'only his own words');
  assert.equal(d.line, 'Eggs at 1:15 PM; walk moved to 4 PM daily.');
  const learned = recs('coach-notes').filter((x) => x.topic === 'learned' && !x.expiredAt);
  assert.deepEqual(learned.map((x) => [x.text, x.from, x.by]).sort(), [['He walks at 4 PM every day.', '2026-03-17', 'nightly'], ['His last meal is beef; eggs are his first meal.', '2026-03-17', 'nightly']]);
  const old = store.getRecord('coach-notes', 'note-old').data;
  assert.equal(old.expiredAt, clock, 'the old fact is expired, dated, never deleted');
  assert.equal(old.expiredOn, '2026-03-17');
  assert.equal(old.replacedBy, learned.find((x) => /4 PM/.test(x.text)).id);
  assert.equal(store.getRecord('coach-notes', 'note-mem').data.expiredAt, undefined, 'his coach\'s own notes are not the nightly\'s to expire');
  const filed = recs(CHANGES).filter((c) => c.by === 'nightly');
  assert.equal(filed.length, 1, 'the water one was asked for already; the chart is a feature nobody asked for');
  assert.equal(filed[0].said, 'It will remind you of the butter step for the eggs.');
  assert.equal(filed[0].auto, true);
  assert.equal(filed[0].kind, 'bug');
  assert.match(filed[0].about, /^A message at 4:37 PM on Tuesday 3\/17\. egg tip with the beef meal/);
  assert.match(d.dropped.join(' | '), /asked for already: "Stop telling me to drink water[\s\S]*fix quote not in the day's messages: "Add a heart-rate chart/);
  await n.tick();
  assert.equal(runs.length, 1, 'once per day');
});

test('the Mac asleep at night: on wake the missed days are caught up, oldest first, the last 3 at most', async () => {
  const { n, runs } = nightly();
  for (const d of ['2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16']) msg(`x${d}`, 'user', `Hello on ${d}`, '10:00', d);
  clock = at('09:00', '2026-03-18');
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16', '2026-03-17']);
  await n.tick(); await n.tick(); await n.tick();
  assert.deepEqual(runs.map((r) => /^DAY: .* \((\S+)\)/.exec(r.content)[1]), ['2026-03-15', '2026-03-16', '2026-03-17']);
  assert.deepEqual(n.dueDays(), []);
  assert.ok(!store.getRecord(DIARY, '2026-03-14'), 'older days are left');
});

test('a day with nothing in it is not sent to Claude; a failed run is tried again after 20 minutes, 3 times at most', async () => {
  store.writeLocal('coach-messages', 'm1', null, { deleted: true });
  for (const id of ['m2', 'm3', 'm4', 'm5']) store.writeLocal('coach-messages', id, null, { deleted: true });
  store.writeLocal('meals', 'meal1', null, { deleted: true });
  store.writeLocal('coach-changes', 'chg.water', null, { deleted: true });
  let fails = 0;
  msg('y1', 'user', 'Hi', '10:00', '2026-03-16');
  const { n, runs } = nightly({ run: async () => { fails++; throw new Error('Claude did not answer'); } });
  await n.tick();
  assert.equal(store.getRecord(DIARY, '2026-03-15').data.status, 'empty');
  assert.equal(store.getRecord(DIARY, '2026-03-16').data.status, 'failed');
  assert.equal(fails, 1);
  assert.equal(runs.length, 0);
  await n.tick();
  assert.equal(store.getRecord(DIARY, '2026-03-17').data.status, 'empty', 'the next day goes on while the failed one waits');
  await n.tick();
  assert.equal(fails, 1, 'not again within 20 minutes');
  clock += 21 * 60000; await n.tick();
  clock += 21 * 60000; await n.tick();
  clock += 21 * 60000; await n.tick();
  assert.equal(fails, 3);
  assert.equal(store.getRecord(DIARY, '2026-03-16').data.tries, 3);
  // A broken answer is a failed run too.
  const bad = nightly({ answer: { diary: {} } });
  store.writeLocal(DIARY, '2026-03-16', null, { deleted: true });
  await bad.n.tick();
  assert.match(store.getRecord(DIARY, '2026-03-16').data.error, /didn't pass the checks: the answer has no diary summary/);
});

test('the checks: the summary at most 250 words, at most 3 fixes, his words only, a big feature he never asked for is never filed', () => {
  const s = snapshot(store, { tz: TZ, now: clock });
  const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
  const v = validate({ diary: { summary: long }, fixes: [
    { quote: 'I eat beef at my last meal, always.', want: 'a', kind: 'behaviour' },
    { quote: 'From now on I walk at 4 PM every day.', want: 'b', kind: 'behaviour' },
    { quote: 'Walk at 4:00 PM, Wednesday 3/18.', want: 'c', kind: 'bug' },
    { quote: 'Stop telling me to drink water after every set', want: 'd' },
    { quote: 'Walk at 4:00 PM, Wednesday 3/18.', want: 'a big new screen', kind: 'behaviour' },
  ] }, { s, date: '2026-03-17' });
  assert.equal(v.diary.summary.split(' ').length, SUMMARY_WORDS);
  assert.match(v.diary.summary, /…$/);
  assert.deepEqual(v.fixes.map((f) => [f.want, f.fromHim]), [['a', true], ['b', true], ['c', false]]);
  assert.match(v.dropped.join(' | '), /more than 3 fixes/);
  const v2 = validate({ diary: { summary: 'x' }, fixes: [{ quote: 'Walk at 4:00 PM, Wednesday 3/18.', want: 'a big new screen', kind: 'behaviour' }] }, { s, date: '2026-03-17' });
  assert.deepEqual(v2.fixes, [], 'a coach line that is not a mistake is never a reason to build');
  assert.match(v2.dropped[0], /not his words and not a mistake/);
  assert.throws(() => validate({ diary: {} }, { s, date: '2026-03-17' }), /no diary summary/);
  assert.deepEqual(validate({ diary: { summary: 'x' }, facts: [{ text: 'He walks around 6 PM.' }] }, { s, date: '2026-03-17' }).facts, [], 'a fact it knows already');
  assert.equal(validate({ diary: { summary: 'x' }, facts: [{ text: 'New', from: '2026-03-20', replaces: 'note-mem' }] }, { s, date: '2026-03-17' }).facts[0].from, '2026-03-17', 'never from a later day; a memory note is not replaced');
});

test('fixes filed at night build quietly; one morning message once he is up, then later ones on their own', async () => {
  const { n } = nightly();
  await n.tick();
  const fix = recs(CHANGES).find((c) => c.by === 'nightly');
  // The queue builds and reviews it at 2 AM: no message in Talk, no notification at night.
  const launched = []; const alive = new Set();
  const q = openChanges({ store, codeDir: '/code', privateDir: dir, tz: () => TZ, now: () => clock, heads: () => ({ code: 'c', private: 'p' }),
    launch: (a) => { launched.push(a); alive.add(launched.length); return launched.length; }, isAlive: (p) => alive.has(p) });
  clock = at('06:30', '2026-03-18');
  await q.tick();
  assert.match(launched[0].prompt, /The coach filed this on its own \(the nightly review of his day\)/);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(q.files(fix.id).resultFile, JSON.stringify({ status: 'done', said: 'Done: a food tip only goes with the meal that has the food.', reload: true, commits: [] }));
  alive.clear();
  await q.tick();
  assert.equal(store.getRecord(CHANGES, fix.id).data.announce, 'morning');
  assert.deepEqual(talk(), [], 'nothing while he sleeps');
  await n.tick();
  assert.deepEqual(talk(), [], 'he is asleep');
  // 9:05 AM: he writes. The morning message comes once, with what was learned and fixed.
  clock = at('09:05', '2026-03-18');
  msg('m9', 'user', 'Morning', '09:05', '2026-03-18');
  const busy = nightly({ busy: () => true });
  await busy.n.tick();
  assert.deepEqual(talk(), [], 'not while the coach answers or a workout runs');
  await n.tick();
  const t1 = talk();
  assert.equal(t1.length, 1);
  assert.equal(t1[0].text, 'Noted: beef is your last meal, eggs the first; walks at 4 PM. The egg tip with the beef meal is being fixed.\nFixed overnight: Done: a food tip only goes with the meal that has the food.');
  assert.equal(store.getRecord(CHANGES, fix.id).data.announce, 'done');
  assert.ok(store.getRecord(DIARY, '2026-03-17').data.morningAt);
  await n.tick();
  assert.equal(talk().length, 1, 'once');
  // A quiet one that finishes after the morning message is told on its own.
  clock = at('09:20', '2026-03-18');
  w(CHANGES, 'chg.late', { id: 'chg.late', at: clock, said: 'x', status: 'done', doneAt: clock, answer: 'Done: the late one.', by: 'nightly', announce: 'morning' });
  await n.tick();
  assert.deepEqual(talk().map((m) => m.text).slice(1), ['Done: the late one.']);
});

test('a hold-off on everything keeps the morning message back', async () => {
  const { n } = nightly();
  await n.tick();
  clock = at('09:05', '2026-03-18');
  msg('m9', 'user', 'Morning', '09:05', '2026-03-18');
  w('coach-holds', 'h', { id: 'h', areas: ['all'], until: at('12:00', '2026-03-18'), at: clock });
  await n.tick();
  assert.deepEqual(talk(), []);
  clock = at('12:01', '2026-03-18');
  await n.tick();
  assert.equal(talk().length, 1);
});

test('the coach\'s context: learned facts dated, the last days in a line each, the diary tool, expired facts kept apart', async () => {
  const { n } = nightly();
  await n.tick();
  clock = at('10:00', '2026-03-18');
  const line = contextLine({ store, tz: TZ, now: clock });
  assert.match(line, /What you learned about him \(the nightly review, dated; current only; true unless he says otherwise\): .*\[from Tuesday 3\/17\] He walks at 4 PM every day\./);
  assert.doesNotMatch(line, /walks around 6 PM/, 'the expired fact is not in the context');
  assert.match(line, /Your diary, the last days \(the diary tool has more\): Tuesday 3\/17: Eggs at 1:15 PM; walk moved to 4 PM daily\./);
  assert.match(line, /Your notes on him [^\n]*Eggs: butter first\./);
  assert.doesNotMatch(/Your notes on him[^\n]*/.exec(line)[0], /learned|4 PM every day/);
  const ctx = { store, tz: TZ, now: () => clock, action: () => {} };
  const diary = (a) => READ_TOOLS.find((x) => x.name === 'diary').run(a, ctx);
  assert.match((await diary({ date: '2026-03-17' })).text, /^Diary for Tuesday 3\/17 \(written Wednesday 3\/18, 6:00 AM\):\nAte eggs[\s\S]*His words that mattered: 5:10 PM "From now on I walk at 4 PM every day\."[\s\S]*Learned: [\s\S]*Fixes it filed: "It will remind you of the butter step for the eggs\." -> queued/);
  assert.match((await diary({})).text, /^The nightly diary, newest first:\n- Tuesday 3\/17: Eggs at 1:15 PM/);
  assert.match((await diary({ date: '2026-03-18' })).text, /No diary for Wednesday 3\/18: the day isn't over/);
  const notes = (await READ_TOOLS.find((x) => x.name === 'notes').run({}, ctx)).text;
  assert.match(notes, /Expired \(kept for the record, NOT true now\):\n- He walks around 6 PM\. \(expired Wednesday 3\/18, 6:00 AM, replaced by note-learned-/);
});

test('his corrections come from his profile; the input says what the coach knows', () => {
  assert.equal(correctionsOf('# P\n\n## His corrections\n- a\n- b\n\n## Open questions\n- c'), '- a\n- b');
  assert.equal(correctionsOf('## His corrections\n- last section'), '- last section');
  assert.equal(correctionsOf('# no section'), '');
  const input = inputFor(snapshot(store, { tz: TZ, now: clock }), '2026-03-17');
  assert.match(input, /The coach's notes: \[note-mem\] Eggs: butter first\./);
  assert.doesNotMatch(input, /\[messages\]|\[notifications\]/, 'messages come once, in full');
});

test('switched on today: the days before are left alone (their fixes were made outside the queue); fixes made on the Mac that day are in the input', () => {
  const n = openNightly({ store, privateDir: dir, tz: () => TZ, now: () => at('16:00', '2026-03-17'), run: async () => ({ text: '{}' }) });
  assert.equal(store.getMeta(SINCE), '2026-03-17');
  clock = at('09:00', '2026-03-20');
  const later = openNightly({ store, privateDir: dir, tz: () => TZ, now: () => clock, run: async () => ({ text: '{}' }) });
  assert.deepEqual(later.dueDays(), ['2026-03-17', '2026-03-18', '2026-03-19']);
  clock = at('09:00', '2026-03-18');
  assert.deepEqual(later.dueDays(), ['2026-03-17']);
  assert.ok(n);
  const progress = '# P\n\n## Where we stopped\n\nNEXT: x\n\nLATEST (Tue 3/17, 4:41 PM): NO EGG TIP WITH THE BEEF MEAL (abc). Fixed.\n\nLATEST (Mon 3/16, 9:00 PM): OTHER.\n\nLATEST (Tue 3/17, 2:10 PM): DISHES. Fixed too.\n\n## Steps\nLATEST (Tue 3/17, 1:00 PM): not in the section';
  assert.equal(fixedOnMacFrom(progress, '2026-03-17'), 'LATEST (Tue 3/17, 4:41 PM): NO EGG TIP WITH THE BEEF MEAL (abc). Fixed.\nLATEST (Tue 3/17, 2:10 PM): DISHES. Fixed too.');
  assert.match(inputFor(snapshot(store, { tz: TZ, now: clock }), '2026-03-17', { fixedOnMac: 'LATEST (Tue 3/17, 4:41 PM): NO EGG TIP' }), /FIXED THAT DAY IN CHATS ON THE MAC \(from the build log; already done, never a fix again\):\nLATEST \(Tue 3\/17, 4:41 PM\): NO EGG TIP/);
});

test('the input says how things stand now: a reminder the coach once called cancelled but still set is listed as set', () => {
  w('coach-reminders', 'r1', { id: 'r1', at: at('17:00', '2026-03-18'), createdAt: at('12:06'), text: 'Mall run', meal: 'wait', restoredAt: at('16:33') });
  w('coach-reminders', 'r2', { id: 'r2', at: at('17:15', '2026-03-18'), createdAt: at('12:10'), text: 'Water', cancelledAt: at('16:24') });
  w('coach-holds', 'h', { id: 'h', areas: ['sauna'], until: at('23:00', '2026-03-18'), reason: 'busy', at: at('16:00') });
  const input = inputFor(snapshot(store, { tz: TZ, now: at('01:30', '2026-03-18') }), '2026-03-17');
  assert.match(input, /Reminders still set \(not sent, not cancelled\): \[r1\] Wednesday 3\/18 5:00 PM \(waits until his meal is done if it lands in one\): "Mall run"\n/);
  assert.doesNotMatch(/STATE NOW[\s\S]*?\n\n/.exec(input)[0], /\[r2\]/, 'a cancelled one is in the timeline, not in how things stand');
  assert.match(input, /Hold-offs running: sauna until Wednesday 3\/18 11:00 PM \("busy"\)/);
});

test('Sat 10/24: a meal eaten after midnight before he slept is in that day\'s review; the review waits until his waking day is over', async () => {
  store.writeLocal('meals', 'meal1', null, { deleted: true });
  w('fuel', 'plan', { id: 'plan', kcal: 3174, proteinG: 242.5 });
  const meal = (id, name, hm, d, kcal, protein) => w('meals', id, { id, date: '2026-03-17', at: at(hm, d), name, before: { items: [{ name, grams: 100, kcal, protein }] } });
  meal('ml1', 'Last meal', '16:59', '2026-03-17', 1199, 95);
  meal('ml2', 'Snack', '17:31', '2026-03-17', 146, 4);
  const { n, runs } = nightly();
  clock = at('01:30', '2026-03-18');
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16'], 'still up at 1:30 AM as far as the app knows: not yet');
  await n.tick();
  assert.equal(runs.length, 0);
  // 2:40 AM: he eats his second meal before sleeping; the app puts it on Tuesday 3/17 at its real time.
  meal('ml3', 'Second meal', '02:40', '2026-03-18', 1282, 115.1);
  clock = at('05:59', '2026-03-18');
  assert.deepEqual(n.dueDays(), [], 'the empty days are done; Tuesday 3/17 still his day');
  clock = at('06:00', '2026-03-18');
  await n.tick();
  assert.equal(runs.length, 1);
  assert.match(runs[0].content, /FOOD THAT DAY \(his waking day, as the Fuel screen counts it; the day's only food numbers\): 2,627 kcal of 3,174, 214\.1 g protein of 242\.5 g \(Last meal 4:59 PM 1,199 kcal; Snack 5:31 PM 146 kcal; Second meal 2:40 AM Wednesday 3\/18 1,282 kcal\)\./);
  assert.match(SYSTEM, /Food for the day \(diary, facts, morning\): the totals and meals in FOOD THAT DAY, never added up from the timeline/);
  // The next day's review doesn't count it again: its timeline says whose day it is, its food line leaves it out.
  const next = inputFor(snapshot(store, { tz: TZ, now: at('06:00', '2026-03-19') }), '2026-03-18');
  assert.match(next, /FOOD THAT DAY [^\n]*: 0 kcal of 3,174, 0 g protein of 242\.5 g \(no meals logged\)\./);
  assert.match(next, /2:40 AM \[meals\] Meal: Second meal: [^\n]*\(for 2026-03-17, his waking day\)/);
});

test('the review of a day comes before 6:00 AM once he slept and got up (sleep logged, or a workout started)', () => {
  const { n } = nightly();
  clock = at('04:31', '2026-03-18');
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16']);
  w('sleep-log', '2026-03-18', { id: '2026-03-18', date: '2026-03-18', bed: at('22:30'), wake: at('04:30', '2026-03-18') });
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16', '2026-03-17'], 'woke at 4:30 AM');
  store.writeLocal('sleep-log', '2026-03-18', null, { deleted: true });
  w('sessions', 's1', { id: 's1', kind: 'workout', startedAt: at('04:20', '2026-03-18') });
  assert.deepEqual(n.dueDays(), ['2026-03-15', '2026-03-16', '2026-03-17'], 'an early workout started');
});
