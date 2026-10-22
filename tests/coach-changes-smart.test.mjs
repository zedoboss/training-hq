// Thu 10/22, 4:37 PM: the change system made smarter. His words: "make it as smart as possible... even if I don't say
// [send it to the Mac]... auto-improving, auto-learning... no mistakes". One wish = one request (corrections merge,
// "double check" checks), a second chat reviews every build before "done", place in line and time, notes with ids.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openChanges, builderPrompt, whereText, buildMs, lineOf, asksOf, newChange, COL, DEFAULT_BUILD_MS } from '../server/coach/changes.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { READ_TOOLS, contextLine } from '../server/coach/tools-read.mjs';
import { changeView } from '../app/js/lib/coach.js';

const TZ = 'Asia/Bangkok';
const at = (hm, d = '2026-03-19') => Date.parse(`${d}T${hm}:00+07:00`);
let dir; let store; let clock; let heads;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-smart-')); store = openStore(join(dir, 'db.sqlite')); clock = at('16:20'); heads = { code: 'c0', private: 'p0' }; });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ store, tz: TZ, now: () => clock, action: () => {} });
const ask = (a) => WRITE_TOOLS.find((t) => t.name === 'request_change').run(a, ctx());
const note = (a) => WRITE_TOOLS.find((t) => t.name === 'write_note').run(a, ctx());
const read = (name, a = {}) => READ_TOOLS.find((t) => t.name === name).run(a, ctx());
const rec = (id) => store.getRecord(COL, id).data;
const recs = () => store.listRecords(COL).map((r) => r.data).sort((a, b) => a.at - b.at);
const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.kind === 'change').sort((a, b) => a.at - b.at).map((m) => m.text);
const idOf = (r) => /\[id (chg\.[^\]]+)\]/.exec(r.text)?.[1];

function queue(o = {}) {
  const launched = []; const alive = new Set(); const logs = []; let restarts = 0;
  const q = openChanges({
    store, codeDir: '/code', privateDir: dir, tz: () => TZ, now: () => clock, heads: () => heads, log: (m) => logs.push(m),
    launch: (a) => { launched.push(a); const pid = 2000 + launched.length; alive.add(pid); return pid; },
    isAlive: (pid) => alive.has(pid), restart: () => { restarts++; }, ...o,
  });
  const result = (c, r) => { writeFileSync(q.files(c.id).resultFile, JSON.stringify(r)); alive.clear(); };
  const review = (c, r) => { writeFileSync(q.files(c.id).reviewFile, JSON.stringify(r)); alive.clear(); };
  return { q, launched, alive, logs, result, review, restarts: () => restarts };
}

test('a correction of a queued request goes into it: same id, same place in line, his words in order, the latest wins', async () => {
  const first = await ask({ said: 'Errands should wait for my meal', want: 'errands after the meal', kind: 'behaviour' });
  const id = idOf(first);
  clock = at('16:21');
  const other = await ask({ said: 'The walk message is too long', separate: true });
  clock = at('16:24');
  const r = await ask({ said: 'Not always, only today because of the time frame', want: 'only reminders that land mid-meal wait', amends: id });
  assert.match(r.text, /^Added his words to chg\.[^ ]+ \(same place: next in line, about 6 minutes\)/);
  assert.equal(recs().length, 2, 'no second build for one wish');
  const c = rec(id);
  assert.deepEqual(asksOf(c).map((a) => [a.kind, a.said]), [['ask', 'Errands should wait for my meal'], ['amend', 'Not always, only today because of the time frame']]);
  assert.equal(c.want, 'only reminders that land mid-meal wait');
  assert.deepEqual(lineOf(recs()).map((x) => x.id), [id, idOf(other)]);
  const p = builderPrompt(c, { codeDir: '/code', privateDir: '/priv', resultFile: '/r.json' });
  assert.match(p, /His words, in order \(the latest wins where they differ\):\n1\. 4:20 PM, his request: "Errands should wait for my meal"[\s\S]*2\. 4:24 PM, his correction: "Not always, only today because of the time frame"\n   What he wants: only reminders that land mid-meal wait/);
});

test('a correction while it is being built: a correcting request right after it, built on top of it', async () => {
  const { q, launched, result } = queue();
  const a = q.request({ said: 'Errands should wait for my meal' });
  clock = at('16:21');
  const b = q.request({ said: 'Shorter walk messages' });
  await q.tick();
  assert.equal(rec(a.id).status, 'working');
  clock = at('16:24');
  const r = await ask({ said: 'No, only the ones that land mid-meal', amends: a.id });
  assert.match(r.text, /is being built right now, so his correction is filed to build right after it, on top of it \(next in line, about 9 minutes\)/, '3 minutes left on the build, then its own 6');
  const c = recs().find((x) => x.corrects === a.id);
  assert.deepEqual(lineOf(recs()).map((x) => x.id), [c.id, b.id], 'ahead of the request filed before it');
  result(a, { status: 'done', said: 'Done: errands wait for your meal.', reload: false, commits: [] });
  await q.tick();
  await q.tick();
  assert.equal(launched.length, 2);
  assert.match(launched[1].prompt, new RegExp(`^COACH CHANGE ${c.id.replace(/\./g, '\\.')}`));
  assert.match(launched[1].prompt, /1\. 4:20 PM, his request: "Errands should wait for my meal"\n2\. 4:24 PM, his correction: "No, only the ones that land mid-meal"/);
  assert.match(launched[1].prompt, /This corrects change chg\.[^ ]+ \("Errands should wait for my meal", done 4:24 PM: "Done: errands wait for your meal\."\)[\s\S]*build on top of them/);
  assert.match(launched[1].prompt, /Other requests waiting on the Mac \(not yours[^)]*\): \[chg\.[^\]]+\] "Shorter walk messages"/);
  assert.match(launched[1].prompt, /Finished in the last day \(live now; don't undo them unless his words above say so\): \[chg\.[^,]+, 4:24 PM\] "Errands should wait for my meal"/);
});

test('"double check": an open request is tested end to end before done; a finished one gets a check run', async () => {
  const { q, launched, result, review } = queue();
  const a = q.request({ said: 'Collagen after the second meal' });
  const r1 = await ask({ said: 'double check that it actually works', verify: a.id });
  assert.match(r1.text, /will be tested end to end before he hears it's done/);
  assert.equal(rec(a.id).verify, true);
  assert.equal(recs().length, 1);
  await q.tick();
  assert.match(launched[0].prompt, /He asked for this to be double-checked: after the change, test it end to end/);
  assert.match(launched[0].prompt, /2\. 4:20 PM, he asked to double-check: "double check that it actually works"/);
  heads = { code: 'c1', private: 'p0' };
  result(a, { status: 'done', said: 'Done: collagen comes after the second meal.', reload: false, commits: ['a1 Collagen'] });
  await q.tick();
  assert.match(launched[1].prompt, /He asked for it to be double-checked: test it end to end/);
  review(a, { status: 'ok', said: 'Done.', checked: 'the 4:30 PM meal on a copy of today' });
  await q.tick();
  assert.equal(rec(a.id).status, 'done');
  // Later: "make sure it works" about the finished one.
  clock = at('16:50');
  const r2 = await ask({ said: 'make sure the collagen one really works', verify: a.id });
  assert.match(r2.text, /^A check of chg\.[^ ]+ is queued \(next in line, about \d+ minutes?\) \[id chg\./);
  const check = recs().find((x) => x.checkOf === a.id);
  assert.equal(check.kind, 'check');
  assert.equal(check.verify, true);
  await q.tick();
  assert.match(launched[2].prompt, /THIS IS A CHECK of change chg\.[^ ]+ \("Collagen after the second meal", done 4:20 PM: "Done: collagen comes after the second meal\."; commits a1 Collagen\)/);
  assert.match(launched[2].prompt, /If it already works, change nothing and say so/);
});

test('a new request while another is open or finished in the last hour: refused with the list until he says how it relates', async () => {
  const { q, result } = queue();
  const a = q.request({ said: 'Errands should wait for my meal', want: 'after the meal' });
  await q.tick();
  result(a, { status: 'done', said: 'Done: errands wait.', reload: false, commits: [] });
  await q.tick();
  clock = at('16:50');
  const r = await ask({ said: 'it still pinged me during dinner' });
  assert.equal(r.wrote, undefined);
  assert.match(r.text, /^Not filed yet: a change is open or finished in the last hour\. Decide how his words relate and call request_change again with one of: amends: <id> .* verify: <id> .* separate: true .*\[chg\.[^,]+, done Thursday 3\/19 4:20 PM\] his words: "Errands should wait for my meal" -> wants: after the meal/);
  assert.equal(recs().length, 1);
  // An hour after it finished: filed straight away.
  clock = at('17:21');
  assert.match((await ask({ said: 'Talk less robotic' })).text, /^Sent to the Mac/);
  assert.match((await ask({ said: 'x', amends: 'chg.nope' })).text, /^No change with id chg\.nope\. Open or recent: \[chg\./);
  assert.match((await ask({ said: 'x', amends: a.id, verify: a.id })).text, /^amends or verify, not both/);
});

test('filed on its own (he didn\'t say "send it to the Mac"): marked, and the builder only does what his words ask', async () => {
  const r = await ask({ said: 'Why did it tell me eggs, I am cooking beef', want: 'tips only for the meal I cook', auto: true });
  assert.match(r.text, /he didn't ask: say you sent it yourself/);
  const c = rec(idOf(r));
  assert.equal(c.auto, true);
  assert.equal(changeView(c).by, 'Filed by the coach from what you said');
  assert.match(builderPrompt(c, { codeDir: '/c', privateDir: '/p', resultFile: '/r' }), /The coach filed this on its own: he complained or corrected it without asking for a change\. Do only what his words ask/);
});

test('the review fixes a small gap: he hears the reviewer\'s sentence, the server restarts for its server fix', async () => {
  const { q, result, review, restarts } = queue();
  const a = q.request({ said: 'Dishes after collagen' });
  await q.tick();
  heads = { code: 'c1', private: 'p0' };
  result(a, { status: 'done', said: 'Done: dishes after collagen.', reload: false, commits: ['b1 Dishes'] });
  await q.tick();
  review(a, { status: 'fixed', said: 'Done: dishes after collagen, also on a fasting day.', reload: true, commits: ['b2 Fasting day too'], checked: 'npm test; a fasting day' });
  await q.tick();
  const c = rec(a.id);
  assert.equal(c.status, 'done');
  assert.equal(c.answer, 'Done: dishes after collagen, also on a fasting day.');
  assert.deepEqual(c.commits, ['b1 Dishes', 'b2 Fasting day too']);
  assert.equal(c.announce, 'after-restart', 'server code: he hears it after the restart');
  assert.equal(c.review.status, 'fixed');
  await q.tick();
  assert.equal(restarts(), 1);
});

test('the review finds a big miss: he hears it plainly, ONE automatic fix runs first in line; a second miss goes to him', async () => {
  const { q, launched, result, review, logs } = queue();
  const a = q.request({ said: 'Remind me about collagen after the second meal every 5 minutes' });
  clock = at('16:21');
  const b = q.request({ said: 'Another wish' });
  await q.tick();
  heads = { code: 'c1', private: 'p0' };
  result(a, { status: 'done', said: 'Done: collagen reminder.', reload: false, commits: ['c1 Collagen'] });
  await q.tick();
  review(a, { status: 'failed', said: 'Only the first reminder comes; the 5-minute repeats are missing.', checked: 'a second meal at 4:30 PM' });
  await q.tick();
  assert.equal(rec(a.id).status, 'failed');
  assert.deepEqual(talk(), ['Only the first reminder comes; the 5-minute repeats are missing. Fixing it now.']);
  const fix = recs().find((x) => x.fixOf === a.id);
  assert.equal(fix.auto, true);
  assert.equal(fix.by, 'review');
  assert.equal(rec(fix.id).status, 'working', 'the fix goes first: started in the same tick');
  assert.deepEqual(lineOf(recs()).map((x) => x.id), [b.id]);
  assert.ok(logs.some((l) => /review failed, fix chg\.\S+ queued first in line/.test(l)));
  assert.match(launched.at(-1).prompt, /A reviewer checked change chg\.[^ ]+ \("Remind me about collagen[\s\S]*and found it isn't right yet: "Only the first reminder comes; the 5-minute repeats are missing\." \(it checked: a second meal at 4:30 PM\)\. Fix exactly that/);
  assert.match(launched.at(-1).prompt, /\d+\. 4:\d\d PM, the reviewer found: "Remind me about collagen/);
  heads = { code: 'c2', private: 'p0' };
  clock = at('16:30');
  result(fix, { status: 'done', said: 'Done: repeats every 5 minutes.', reload: false, commits: ['c2 Repeats'] });
  await q.tick();
  review(fix, { status: 'failed', said: 'Repeats stop after one.' });
  await q.tick();
  assert.equal(talk().at(-1), 'Still not right after a second try: Repeats stop after one.');
  assert.equal(recs().filter((x) => x.fixOf).length, 1, 'never a third try on its own');
});

test('a reviewer that dies or runs over: he hears the build\'s answer, "not reviewed" in the log; nothing changed: no review', async () => {
  const { q, launched, result, alive, logs } = queue();
  const a = q.request({ said: 'Shorter answers' });
  await q.tick();
  heads = { code: 'c0', private: 'p1' };
  result(a, { status: 'done', said: 'Done: shorter answers.', reload: false, commits: [] });
  await q.tick();
  assert.equal(rec(a.id).stage, 'review', 'a profile commit moved the private head');
  alive.clear();
  await q.tick();
  assert.equal(rec(a.id).status, 'done');
  assert.equal(rec(a.id).reviewed, false);
  assert.deepEqual(talk(), ['Done: shorter answers.']);
  assert.ok(logs.some((l) => /not reviewed \(the reviewer stopped without an answer\)/.test(l)));
  // A build that changed nothing ("it already works") isn't reviewed.
  const b = q.request({ said: 'Check the walk times', separate: true });
  await q.tick();
  result(b, { status: 'done', said: 'Done: it already works; nothing changed.', reload: false, commits: [] });
  const before = launched.length;
  await q.tick();
  assert.equal(launched.length, before);
  assert.equal(rec(b.id).status, 'done');
  assert.equal(rec(b.id).reviewed, undefined);
});

test('place in line and time: the median of the last 8 builds; building, checking, waiting on unsaved edits', () => {
  const done = (min, i) => ({ id: `d${i}`, status: 'done', at: at('10:00') + i * 60000, startedAt: at('10:00') + i * 60000, doneAt: at('10:00') + i * 60000 + min * 60000 });
  assert.equal(buildMs([]), DEFAULT_BUILD_MS);
  const hist = [4, 10, 8, 6, 30].map(done);
  assert.equal(buildMs(hist), 8 * 60000);
  const w = { id: 'w', status: 'working', stage: 'build', at: at('16:00'), startedAt: at('16:00') };
  const q1 = { id: 'q1', status: 'queued', at: at('16:05') };
  const q2 = { id: 'q2', status: 'queued', at: at('16:06'), waitingFor: ['the code folder'] };
  const all = [...hist, w, q1, q2];
  const now = at('16:03');
  assert.equal(whereText(w, all, now), 'building now, about 5 minutes left');
  assert.equal(whereText(q1, all, now), 'next in line, about 13 minutes');
  assert.equal(whereText(q2, all, now), '2nd in line, about 21 minutes (waiting: unsaved edits on the Mac in the code folder, at most 45 minutes)');
  assert.equal(whereText({ ...w, stage: 'review' }, all, now), 'built, being checked before he hears done');
  assert.equal(whereText(w, all, at('16:30')), 'building now, done any minute');
});

test('records from before today\'s change still work: one ask from said/want/about', () => {
  const old = { id: 'chg.old', at: at('09:00'), tz: TZ, said: 'Say good morning first', want: 'good morning', about: '9:15 AM', status: 'done', doneAt: at('09:10'), answer: 'Done.' };
  assert.deepEqual(asksOf(old).map((a) => [a.kind, a.said, a.want]), [['ask', 'Say good morning first', 'good morning']]);
  assert.match(builderPrompt(old, { codeDir: '/c', privateDir: '/p', resultFile: '/r' }), /His words: "Say good morning first"\nWhat it is about: 9:15 AM\nWhat he wants instead: good morning/);
  const n = newChange({ said: 'x', at: at('09:20'), tz: TZ });
  assert.equal(n.by, 'coach');
  assert.equal(n.asks.length, 1);
});

test('the changes tool: open first with place and time, then finished ones with every ask, the answer, the check, the commits', async () => {
  const { q, result, review } = queue();
  const a = q.request({ said: 'Collagen after the second meal', want: 'collagen prompt after meal two' });
  await ask({ said: 'every 5 minutes until I take it', amends: a.id });
  await q.tick();
  heads = { code: 'c1', private: 'p0' };
  result(a, { status: 'done', said: 'Done: collagen after meal two.', commits: ['e1 Collagen'] });
  await q.tick();
  review(a, { status: 'ok', said: 'Done.', checked: 'the second meal at 4:30 PM, repeats every 5 minutes' });
  await q.tick();
  clock = at('16:40');
  await ask({ said: 'Walk messages too long', separate: true });
  const text = (await read('changes')).text;
  assert.match(text, /^Changes he asked for \(open first, in line order; then finished, oldest first\)\. Build time lately: about 6 minutes each\.\n- \[id chg\.[^\]]+\] Thursday 3\/19, 4:40 PM, behaviour: WAITING \(next in line, about 6 minutes\)\.\n  4:40 PM he asked: "Walk messages too long"/);
  assert.match(text, /- \[id chg\.[^\]]+\] Thursday 3\/19, 4:20 PM, behaviour: DONE Thursday 3\/19, 4:20 PM\.\n  4:20 PM he asked: "Collagen after the second meal" -> wants: collagen prompt after meal two\n  4:20 PM he corrected: "every 5 minutes until I take it"\n  Answer he got: "Done: collagen after meal two\."\n  Checked: the second meal at 4:30 PM, repeats every 5 minutes\n  Commits: e1 Collagen/);
  assert.equal(READ_TOOLS.find((t) => t.name === 'changes').annotations.readOnlyHint, true);
});

test('notes carry their ids into the context; a corrected note is replaced in place, the old wording kept and dated', async () => {
  const r = await note({ text: 'Errands always wait for the meal', topic: 'memory' });
  const id = /^Noted/.test(r.text) && store.listRecords('coach-notes')[0].data.id;
  assert.match(contextLine({ store, tz: TZ, now: clock }), new RegExp(`Your notes on him \\(your memory; use them, never ask again what they answer; when he corrects one, write_note replace: its id\\): \\[Thursday 3/19, memory\\] Errands always wait for the meal \\[id ${id}\\]`));
  clock = at('16:30');
  const r2 = await note({ text: 'Only reminders that land mid-meal wait', replace: id });
  assert.match(r2.text, /^Replaced note note/);
  const n = store.getRecord('coach-notes', id).data;
  assert.equal(n.text, 'Only reminders that land mid-meal wait');
  assert.equal(n.topic, 'memory');
  assert.deepEqual(n.replaced, [{ text: 'Errands always wait for the meal', from: at('16:20'), until: at('16:30') }]);
  assert.equal(store.listRecords('coach-notes').length, 1);
  assert.match((await note({ text: 'x', replace: 'note-nope' })).text, /^No note with id note-nope/);
  // An expired fact (the nightly run) stays in the data, out of the context.
  store.writeLocal('coach-notes', 'note-old', { id: 'note-old', at: at('09:00'), date: '2026-03-19', text: 'Old fact', topic: 'learned', expiredAt: at('16:00') });
  assert.doesNotMatch(contextLine({ store, tz: TZ, now: clock }), /Old fact/);
});

test('the Notes screen: being checked, waiting on unsaved edits, his later words, what was checked', () => {
  assert.deepEqual(changeView({ status: 'working', stage: 'review' }).label, 'BEING CHECKED ON THE MAC');
  assert.deepEqual(changeView({ status: 'working', stage: 'build' }).label, 'BEING BUILT ON THE MAC');
  assert.equal(changeView({ status: 'queued', waitingFor: ['the code folder'] }).label, 'WAITING: UNSAVED EDITS ON THE MAC');
  assert.equal(changeView({ status: 'queued', kind: 'check' }).label, 'CHECK · WAITING ON THE MAC');
  const v = changeView({ status: 'done', checked: 'a fasting day', by: 'nightly', auto: true, asks: [{ kind: 'ask', said: 'a', at: 1 }, { kind: 'amend', said: 'only today', at: 2 }, { kind: 'verify', said: 'double check', at: 3 }] });
  assert.equal(v.checked, 'Checked: a fasting day');
  assert.equal(v.by, 'Filed overnight from your day');
  assert.deepEqual(v.later.map((l) => l.text), ['You added: only today', 'You asked to double-check: double check']);
  assert.equal(v.cls, 'c-green');
});
