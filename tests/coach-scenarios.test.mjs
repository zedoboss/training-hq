// Thu 10/22, his words: "think 100,000 steps ahead... imagine the scenarios... no mistakes". Every scenario he was
// promised for the change system and the memory, end to end through the coach's own tools, the queue and the nightly
// review (Claude and git are fakes; everything else is the real code).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openChanges, asksOf, builderPrompt, COL as CHANGES } from '../server/coach/changes.mjs';
import { openNightly } from '../server/coach/nightly.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { READ_TOOLS, contextLine } from '../server/coach/tools-read.mjs';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-19') => Date.parse(`${d}T${hm}:00+07:00`); // Thursday 3/19
let dir; let store; let clock; let heads; let edits;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-scenarios-')); store = openStore(join(dir, 'db.sqlite')); clock = at('16:20'); heads = { code: 'c0', private: 'p0' }; edits = []; });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => clock, action: () => {} });
const tool = (name) => [...WRITE_TOOLS, ...READ_TOOLS].find((t) => t.name === name);
const ask = (a) => tool('request_change').run(a, ctx());
const changes = () => store.listRecords(CHANGES).map((r) => r.data).filter(Boolean).sort((a, b) => a.at - b.at);
const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m?.kind === 'change' || m?.kind === 'nightly').sort((a, b) => a.at - b.at).map((m) => m.text);
const idIn = (text) => /\[(?:id )?(chg\.[^\],\s]+)/.exec(text)?.[1];
const say = (id, text, hm) => store.writeLocal('coach-messages', id, { id, role: 'user', text, at: at(hm), tz: TZ });

function mac() {
  const launched = []; const alive = new Set(); let restarts = 0;
  const q = openChanges({ store, codeDir: '/code', privateDir: dir, tz: () => TZ, now: () => clock, heads: () => heads, dirty: () => edits,
    launch: (a) => { launched.push(a); alive.add(launched.length); return launched.length; }, isAlive: (p) => alive.has(p), restart: () => { restarts++; } });
  return {
    q, launched, restarts: () => restarts,
    build: (c, r) => { writeFileSync(q.files(c.id).resultFile, JSON.stringify(r)); alive.clear(); },
    review: (c, r) => { writeFileSync(q.files(c.id).reviewFile, JSON.stringify(r)); alive.clear(); },
  };
}

test('three corrections in five minutes = one build, his latest words win', async () => {
  say('m1', 'Errands should always wait for my meal', '16:20');
  const first = await ask({ said: 'Errands should always wait for my meal', want: 'errands wait for the meal', auto: true });
  const id = idIn(first.text);
  clock = at('16:22');
  // The coach tries to file the correction as new: refused, with the list, so it amends.
  const refused = await ask({ said: 'No, only the ones that land while I eat' });
  assert.match(refused.text, /^Not filed yet/);
  assert.equal(idIn(refused.text.slice(refused.text.indexOf('['))), id);
  await ask({ said: 'No, only the ones that land while I eat', want: 'only reminders inside the meal wait', amends: id });
  clock = at('16:24');
  await ask({ said: 'And not for the cooking reminder itself', want: 'only errands inside the meal wait; the cooking reminder is on time', amends: id });
  assert.equal(changes().length, 1, 'one request');
  const c = changes()[0];
  assert.deepEqual(asksOf(c).map((a) => a.kind), ['ask', 'amend', 'amend']);
  assert.equal(c.want, 'only errands inside the meal wait; the cooking reminder is on time');
  const m = mac();
  await m.q.tick();
  assert.equal(m.launched.length, 1, 'one build');
  assert.match(m.launched[0].prompt, /His words, in order \(the latest wins where they differ\):\n1\. 4:20 PM, his request: "Errands should always wait for my meal"[\s\S]*2\. 4:22 PM, his correction: "No, only the ones that land while I eat"[\s\S]*3\. 4:24 PM, his correction: "And not for the cooking reminder itself"/);
});

test('"double check" after it is built = a check run that tests it end to end', async () => {
  const m = mac();
  const c = m.q.request({ said: 'Collagen after the second meal' });
  await m.q.tick();
  m.build(c, { status: 'done', said: 'Done: collagen after the second meal.', commits: [] });
  await m.q.tick();
  assert.deepEqual(talk(), ['Done: collagen after the second meal.']);
  clock = at('16:40');
  const r = await ask({ said: 'double check that collagen thing works', verify: c.id });
  assert.match(r.text, /^A check of /);
  const check = changes().find((x) => x.kind === 'check');
  assert.equal(check.checkOf, c.id);
  await m.q.tick();
  assert.match(m.launched.at(-1).prompt, /THIS IS A CHECK of change[\s\S]*test that it works the way he asked, end to end[\s\S]*He asked for this to be double-checked/);
  assert.equal(changes().length, 2, 'a check, not a rebuild of the same wish');
});

test('the same complaint twice without "send it" = filed once on its own, then amended', async () => {
  say('m1', 'Why did it tell me eggs, I am cooking beef', '16:36');
  const r1 = await ask({ said: 'Why did it tell me eggs, I am cooking beef', want: 'food tips only with the meal that has that food', kind: 'bug', auto: true });
  assert.match(r1.text, /he didn't ask: say you sent it yourself/);
  clock = at('16:50');
  say('m2', 'Again the eggs! The beef is my last meal', '16:50');
  const r2 = await ask({ said: 'Again the eggs! The beef is my last meal', auto: true });
  assert.match(r2.text, /^Not filed yet/);
  await ask({ said: 'Again the eggs! The beef is my last meal', amends: idIn(r1.text) });
  assert.equal(changes().length, 1);
  assert.equal(asksOf(changes()[0]).length, 2);
  assert.equal(changes()[0].auto, true);
});

test('a build that breaks a test or misses half the ask is fixed before he hears "done"', async () => {
  const m = mac();
  const c = m.q.request({ said: 'Remind me about collagen every 5 minutes until I take it, then the dishes' });
  await m.q.tick();
  heads = { code: 'c1', private: 'p0' };
  m.build(c, { status: 'done', said: 'Done: collagen reminder after the second meal.', commits: ['a1 Collagen'] });
  await m.q.tick();
  assert.deepEqual(talk(), [], 'not "done" while it is checked');
  // The reviewer: half the ask is missing (the repeats and the dishes): not done; one automatic fix runs first.
  m.review(c, { status: 'failed', said: 'The 5-minute repeats and the dishes after collagen are missing.', checked: 'a second meal at 4:30 PM' });
  await m.q.tick();
  assert.deepEqual(talk(), ['The 5-minute repeats and the dishes after collagen are missing. Fixing it now.']);
  const fix = changes().find((x) => x.fixOf === c.id);
  assert.equal(fix.status, 'working');
  heads = { code: 'c2', private: 'p0' };
  clock = at('16:40');
  m.build(fix, { status: 'done', said: 'Done: collagen every 5 minutes until ticked, then the dishes.', commits: ['a2 Repeats and dishes'] });
  await m.q.tick();
  // This time the reviewer finds a broken test and fixes it itself: done, with the reviewer's sentence.
  m.review(fix, { status: 'fixed', said: 'Done: collagen every 5 minutes until ticked, then the dishes.', checked: 'npm test (fixed a test); a second meal at 4:30 PM', commits: ['a3 Fix the meal test'] });
  await m.q.tick();
  assert.equal(talk().at(-1), 'Done: collagen every 5 minutes until ticked, then the dishes.');
  assert.deepEqual(changes().find((x) => x.id === fix.id).commits, ['a2 Repeats and dishes', 'a3 Fix the meal test']);
});

test('Claude editing on the Mac while he sends a request = it waits, and the coach can say why', async () => {
  edits = ['the code folder'];
  const m = mac();
  const r = await ask({ said: 'Shorter answers please' });
  await m.q.tick();
  assert.equal(m.launched.length, 0);
  const line = contextLine({ store, tz: TZ, now: clock });
  assert.match(line, /\[Thursday 3\/19 4:20 PM, next in line, about 6 minutes \(waiting: unsaved edits on the Mac in the code folder, at most 45 minutes\)\] "Shorter answers please"/);
  assert.match((await tool('changes').run({}, ctx())).text, /WAITING \(next in line, about 6 minutes \(waiting: unsaved edits on the Mac in the code folder/);
  edits = [];
  clock = at('16:30');
  await m.q.tick();
  assert.equal(m.launched.length, 1, 'saved: it starts');
  assert.equal(changes().find((x) => x.id === idIn(r.text)).waitingFor, undefined);
});

test('the Mac asleep at night = the missed days are reviewed when it wakes; their fixes come in one morning message', async () => {
  for (const d of ['2026-03-17', '2026-03-18']) store.writeLocal('coach-messages', `x${d}`, { id: `x${d}`, role: 'user', text: `Stop saying well done after every set ${d}`, at: at('10:00', d), tz: TZ });
  const runs = [];
  const n = openNightly({ store, privateDir: dir, since: '2026-03-01', tz: () => TZ, now: () => clock, push: null,
    run: async (a) => { runs.push(a); const d = /\((\d{4}-\d{2}-\d{2})\)/.exec(a.content)[1]; return { text: JSON.stringify({ diary: { summary: `Day ${d}` }, fixes: [{ quote: `Stop saying well done after every set ${d}`, want: 'no well done after a plain set', kind: 'personality' }], morning: d === '2026-03-18' ? 'No more "well done" after plain sets: being fixed.' : '' }) }; } });
  clock = at('09:00', '2026-03-19');
  store.writeLocal('coach-messages', 'wake', { id: 'wake', role: 'user', text: 'Morning', at: at('08:59'), tz: TZ });
  await n.tick(); await n.tick(); await n.tick();
  assert.equal(runs.length, 2, 'both missed days, once each');
  assert.equal(changes().filter((c) => c.by === 'nightly').length, 1, 'the same complaint on both days: one fix');
  assert.match(store.getRecord('coach-diary', '2026-03-18').data.dropped[0], /^asked for already/);
  assert.deepEqual(talk(), ['No more "well done" after plain sets: being fixed.\nBeing fixed now: no well done after a plain set.']);
  await n.tick();
  assert.equal(talk().length, 1, 'one morning message');
});

test('a fact that changes = the old one expired with a date, kept, and out of the coach\'s context', async () => {
  store.writeLocal('coach-notes', 'note-walk', { id: 'note-walk', at: at('02:00', '2026-03-10'), date: '2026-03-10', from: '2026-03-09', text: 'He walks at 6 PM.', topic: 'learned', by: 'nightly' });
  store.writeLocal('coach-messages', 'm', { id: 'm', role: 'user', text: 'I walk at 4 PM now', at: at('10:00', '2026-03-18'), tz: TZ });
  const n = openNightly({ store, privateDir: dir, since: '2026-03-01', tz: () => TZ, now: () => clock,
    run: async () => ({ text: JSON.stringify({ diary: { summary: 'Walk moved.' }, facts: [{ text: 'He walks at 4 PM.', from: '2026-03-18', replaces: 'note-walk', source: '10:00 AM, his words' }] }) }) });
  clock = at('06:00', '2026-03-19');
  await n.tick();
  const old = store.getRecord('coach-notes', 'note-walk').data;
  assert.equal(old.expiredOn, '2026-03-18');
  assert.equal(old.expiredAt, clock);
  assert.ok(old.replacedBy);
  assert.equal(store.getRecord('coach-notes', old.replacedBy).data.text, 'He walks at 4 PM.');
  const line = contextLine({ store, tz: TZ, now: at('10:00') });
  assert.match(line, /\[from Wednesday 3\/18\] He walks at 4 PM\./);
  assert.doesNotMatch(line, /6 PM\./);
  assert.match((await tool('timeline').run({ date: '2026-03-19', kinds: ['notes'] }, ctx())).text, /6:00 AM \[notes\] Fact expired \(replaced by note-learned-[^)]+\): He walks at 6 PM\./);
});

test('the nightly run can\'t file a big feature he never asked for', async () => {
  store.writeLocal('coach-messages', 'm', { id: 'm', role: 'user', text: 'Nice session today', at: at('10:00', '2026-03-18'), tz: TZ });
  store.writeLocal('coach-messages', 'c', { id: 'c', role: 'assistant', text: 'Logged. Legs done.', at: at('10:01', '2026-03-18'), tz: TZ });
  const n = openNightly({ store, privateDir: dir, since: '2026-03-01', tz: () => TZ, now: () => clock,
    run: async () => ({ text: JSON.stringify({ diary: { summary: 'Legs.' }, fixes: [
      { quote: 'Nice session today', want: 'Build a social feed to share sessions', kind: 'behaviour' },
      { quote: 'Logged. Legs done.', want: 'Add a heart-rate zone chart', kind: 'behaviour' },
      { quote: 'He would like a nutrition AI planner', want: 'a planner', kind: 'bug' },
    ] }) }) });
  clock = at('06:00', '2026-03-19');
  await n.tick();
  const filed = changes();
  // The first quotes his words, so it is filed, but the builder is told to do only what his words ask, and to change
  // nothing when they don't ask for a change; the other two never reach the queue.
  assert.equal(filed.length, 1);
  assert.match(builderPrompt(filed[0], { codeDir: '/c', privateDir: '/p', resultFile: '/r' }), /The coach filed this on its own \(the nightly review of his day\): he complained or corrected it without asking for a change\. Do only what his words ask; when they don't clearly ask for a change, change nothing and say so \(status "question"\)/);
  const d = store.getRecord('coach-diary', '2026-03-18').data;
  assert.match(d.dropped.join(' | '), /not his words and not a mistake: "Logged\. Legs done\."[\s\S]*fix quote not in the day's messages: "He would like a nutrition AI planner"/);
});

test('"what did I eat at 3 PM last Tuesday?" = exact from the timeline', async () => {
  store.writeLocal('meals', 'tue', { id: 'tue', date: '2026-03-17', at: at('15:05', '2026-03-17'), name: 'Lunch', before: { items: [{ name: 'Beef', grams: 500, kcal: 650, protein: 104 }, { name: 'Rice', grams: 400, kcal: 520, protein: 10 }] } });
  store.writeLocal('meals', 'wed', { id: 'wed', date: '2026-03-18', at: at('15:00', '2026-03-18'), name: 'Lunch', before: { items: [{ name: 'Eggs', grams: 600, kcal: 858, protein: 75 }] } });
  const r = await tool('timeline').run({ date: '2026-03-17', kinds: ['meals'] }, ctx());
  assert.equal(r.text, 'Timeline, Tuesday 3/17 (meals): 1 event, from the app\'s records (exact times).\nTuesday 3/17:\n3:05 PM [meals] Meal: Lunch: Beef 500 g, Rice 400 g; 1170 kcal, 114 g protein');
  assert.match(tool('timeline').description, /for 'what did I eat at 3 PM last Tuesday\?': that date with kinds \['meals'\]/);
});
