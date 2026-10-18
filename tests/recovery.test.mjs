import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinceText, checkInStatus, checkIns, checkInNote, missingAnswers, openTasks, withTask, withCheckup, photoStatus, recoveryReminders, recoveryLines, endsOn, noteId } from '../app/js/lib/recovery.js';
import { remindersFor, reminderState } from '../app/js/lib/reminders.js';
import { posesShown } from '../app/js/lib/body.js';
import { systemPrompt, RULES } from '../server/coach/prompt.mjs';
import { openStore } from '../server/store.mjs';
import { TOOLS, contextLine } from '../server/coach/tools.mjs';

// Made-up record: a knee recovery, nothing from anyone's real data.
const PLAN = {
  title: 'Knee recovery', since: '2026-01-05', sinceText: 'the operation (Monday 1/5)', until: '2026-03-31', untilText: 'the 3-month checkup',
  checkIn: { from: '2026-02-01', everyDays: 7, askAgainDays: 2, questions: [
    { key: 'pain', label: 'Pain', ask: 'Pain, compared with last time?', choices: ['Gone', 'Less', 'Same', 'More'] },
    { key: 'new', label: 'Anything new', ask: 'Anything new?', kind: 'text' },
  ] },
  tasks: [{ id: 'book', text: 'Book the checkup', detail: 'End of March.', setsCheckup: true }, { id: 'paper', text: 'Get the letter' }],
  photos: { poses: ['front', 'side2'], minDays: 14, maxDays: 28, from: '2026-02-01', how: 'Same light.' },
  checkupQuestions: ['The swelling'],
};
const TZ = 'UTC';

test('recovery: days since, check-in due weekly from the first date until the checkup', () => {
  assert.equal(sinceText(PLAN, '2026-02-02'), '28 days (4 weeks)');
  assert.equal(sinceText(PLAN, '2026-02-04'), '30 days (4 weeks 2 days)');
  assert.equal(sinceText(PLAN, '2026-01-06'), '1 day');
  assert.equal(sinceText(PLAN, '2026-01-01'), null);
  let st = checkInStatus(PLAN, null, [], '2026-01-31');
  assert.deepEqual([st.active, st.due, st.dueOn], [true, false, '2026-02-01']);
  st = checkInStatus(PLAN, null, [], '2026-02-01');
  assert.equal(st.due, true);
  const note = checkInNote(PLAN, { pain: 'Less', new: '  a click on stairs ' }, { date: '2026-02-01', at: 1, by: 'app' });
  assert.equal(note.id, noteId('2026-02-01'));
  assert.equal(note.text, 'Knee recovery check-in: Pain less, anything new: a click on stairs.');
  assert.deepEqual(note.answers, { pain: 'Less', new: 'a click on stairs' });
  assert.equal(note.topic, 'recovery');
  st = checkInStatus(PLAN, null, [note], '2026-02-05');
  assert.deepEqual([st.due, st.dueOn, st.last.date], [false, '2026-02-08', '2026-02-01']);
  assert.equal(checkInStatus(PLAN, null, [note], '2026-02-08').due, true);
  // Ends at the plan's date, or at the checkup he booked.
  assert.equal(checkInStatus(PLAN, null, [], '2026-04-01').active, false);
  const booked = withCheckup(null, '2026-03-10', 'app', 5);
  assert.equal(endsOn(PLAN, booked), '2026-03-10');
  assert.equal(checkInStatus(PLAN, booked, [], '2026-03-11').active, false);
  assert.equal(withCheckup(booked, null).checkup, null);
});

test('recovery: answers checked against the choices; tasks tick and untick', () => {
  assert.deepEqual(missingAnswers(PLAN, {}), ['pain']);
  assert.deepEqual(missingAnswers(PLAN, { pain: 'Same' }), []);
  assert.deepEqual(checkInNote(PLAN, { pain: 'Worse' }, { date: '2026-02-01', at: 1 }).answers, {}, 'not one of the choices');
  assert.equal(checkIns([{ topic: 'recovery', date: '2026-02-01', answers: {} }, { topic: 'x', date: '2026-02-09', answers: {} }, { topic: 'recovery', date: '2026-02-08', answers: {} }])[0].date, '2026-02-08');
  let state = withTask(null, 'book', true, 'coach', 10);
  assert.deepEqual(openTasks(PLAN, state).map((t) => t.id), ['paper']);
  state = withTask(state, 'book', false);
  assert.equal(openTasks(PLAN, state).length, 2);
});

test('recovery: photos due every 2 weeks from the last set, overdue after 4', () => {
  assert.equal(photoStatus({ ...PLAN, photos: null }, [], '2026-02-01'), null);
  assert.deepEqual(photoStatus(PLAN, [], '2026-02-01'), { poses: ['front', 'side2'], last: null, dueOn: '2026-02-01', due: true, overdue: false, takenToday: false });
  const photos = [{ date: '2026-02-03', pose: 'side2', dataUrl: 'x' }, { date: '2026-02-05', pose: 'back', dataUrl: 'x' }];
  const p = photoStatus(PLAN, photos, '2026-02-10');
  assert.deepEqual([p.last, p.dueOn, p.due, p.overdue], ['2026-02-03', '2026-02-17', false, false]);
  assert.equal(photoStatus(PLAN, photos, '2026-03-04').overdue, true);
  assert.equal(photoStatus(PLAN, photos, '2026-02-03').takenToday, true);
  // The extra poses show only when a record asks for them or a photo has one.
  assert.deepEqual(posesShown().map(([x]) => x), ['front', 'side', 'back']);
  assert.deepEqual(posesShown(['side2', 'arms-up']).map(([x]) => x), ['front', 'side', 'side2', 'back', 'arms-up']);
  assert.deepEqual(posesShown([], [{ pose: 'arms-up' }]).map(([x]) => x), ['front', 'side', 'back', 'arms-up']);
});

test('recovery reminders: check-in on its day and every 2 days until answered, tasks, photos, the checkup eve', () => {
  const at = (date, ids) => recoveryReminders({ date, tz: TZ, plan: PLAN, state: null, notes: [], photos: [], hm: '20:15' }).map((r) => r.id.split(':')[0]).sort();
  assert.deepEqual(at('2026-01-31', ''), []);
  assert.deepEqual(at('2026-02-01'), ['recovery-checkin', 'recovery-photos']);
  assert.deepEqual(at('2026-02-02'), []);
  assert.deepEqual(at('2026-02-03'), ['recovery-checkin']);
  const r = recoveryReminders({ date: '2026-02-01', tz: TZ, plan: PLAN, hm: '20:15' });
  const ci = r.find((x) => x.kind === 'recovery' && x.id.startsWith('recovery-checkin'));
  assert.equal(ci.at, Date.parse('2026-02-01T20:15:00Z'));
  assert.equal(ci.url, '#/body/recovery');
  assert.equal(ci.title, 'Knee recovery: weekly check-in');
  assert.match(ci.body, /^Pain, compared with last time\? Anything new\? Still to do: book the checkup; get the letter\.$/);
  // Answered: the next one a week later; on days between, tasks alone weekly from the first date.
  const notes = [checkInNote(PLAN, { pain: 'Same' }, { date: '2026-02-01', at: 1 })];
  const ids = (date, state = null) => recoveryReminders({ date, tz: TZ, plan: PLAN, state, notes, photos: [{ date: '2026-02-01', pose: 'front', dataUrl: 'x' }] }).map((x) => x.id);
  assert.deepEqual(ids('2026-02-01').filter((x) => x.startsWith('recovery-checkin')), []);
  assert.deepEqual(ids('2026-02-08'), ['recovery-checkin:2026-02-08']);
  assert.deepEqual(ids('2026-02-15', withTask(withTask(null, 'book', true), 'paper', true)), ['recovery-photos:2026-02-15']);
  // After the checkup: no check-ins; open tasks weekly.
  const state = withCheckup(null, '2026-03-10');
  assert.deepEqual(recoveryReminders({ date: '2026-03-09', tz: TZ, plan: PLAN, state, notes, photos: [] }).map((x) => x.id).filter((x) => x.includes('checkup')), ['recovery-checkup:2026-03-10']);
  assert.match(recoveryReminders({ date: '2026-03-09', tz: TZ, plan: PLAN, state, notes }).find((x) => x.id.includes('checkup')).body, /Your list for it: The swelling\./);
  assert.deepEqual(recoveryReminders({ date: '2026-03-15', tz: TZ, plan: PLAN, state, notes, photos: [{ date: '2026-03-14', pose: 'front', dataUrl: 'x' }] }).map((x) => x.id), ['recovery-tasks:2026-03-15']);
  // Through the planner: a kind he can switch off.
  const base = reminderState({ settings: { notify: { recoveryHm: '19:00' } }, recoveryPlan: PLAN, notes: [], photos: [] }, TZ);
  const items = remindersFor({ ...base, date: '2026-02-01' }).filter((x) => x.kind === 'recovery');
  assert.equal(items.length, 2);
  assert.equal(items[0].at, Date.parse('2026-02-01T19:00:00Z'));
  const off = reminderState({ settings: { notify: { kinds: { recovery: false } } }, recoveryPlan: PLAN }, TZ);
  assert.equal(remindersFor({ ...off, date: '2026-02-01' }).filter((x) => x.kind === 'recovery').length, 0);
  assert.equal(remindersFor({ ...reminderState({}, TZ), date: '2026-02-01' }).filter((x) => x.kind === 'recovery').length, 0);
});

test('recovery: the coach gets the day count and what is due; the record follows the profile in its instructions', () => {
  const lines = recoveryLines({ plan: PLAN, date: '2026-02-01' });
  assert.match(lines[0], /^Knee recovery: today is 27 days \(3 weeks 6 days\) since the operation \(Monday 1\/5\)\. Use only what his record marks CURRENT/);
  assert.match(lines[1], /Weekly recovery check-in DUE \(last: none yet\)\. Ask it briefly when the moment fits \(not during a set, a hold or the sauna\)/);
  assert.ok(lines.some((l) => l === 'Still to do (his list): Book the checkup (End of March.); Get the letter.'));
  assert.ok(lines.some((l) => /^Recovery photos due \(none yet\)/.test(l)));
  const later = recoveryLines({ plan: PLAN, notes: [checkInNote(PLAN, { pain: 'Less' }, { date: '2026-02-01', at: 1 })], date: '2026-02-03' });
  assert.equal(later[1], 'Weekly recovery check-in: done Sunday 2/1; next Sunday 2/8.');
  assert.deepEqual(recoveryLines({ plan: null, date: '2026-02-01' }), []);
  assert.equal(systemPrompt({}), RULES);
  const sp = systemPrompt({ profile: 'Name: X', recovery: '# Record\n- CURRENT: y' });
  assert.ok(sp.indexOf('HIS PROFILE') < sp.indexOf('HIS RECOVERY RECORD'));
  assert.match(sp, /HIS RECOVERY RECORD[^\n]*CURRENT[^\n]*EXPIRED[^\n]*\n# Record\n- CURRENT: y$/);
});

test('recovery tools: the coach saves a check-in, ticks a task, sets the checkup; the context line carries it', async () => {
  const store = openStore(':memory:');
  store.writeLocal('recovery', 'main', PLAN);
  const now = Date.parse('2026-02-01T09:00:00Z');
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const ctx = { store, tz: TZ, now: () => now, action: () => {} };
  let r = await tool('recovery_log').run({ action: 'check_in', answers: [{ question: 'new', answer: 'nothing' }] }, ctx);
  assert.match(r.text, /^Still to ask: Pain, compared with last time\?/);
  r = await tool('recovery_log').run({ action: 'check_in', answers: [{ question: 'pain', answer: 'worse' }] }, ctx);
  assert.match(r.text, /one of Gone, Less, Same, More/);
  r = await tool('recovery_log').run({ action: 'check_in', answers: [{ question: 'pain', answer: 'less' }, { question: 'anything new', answer: '' }] }, ctx);
  assert.equal(r.wrote, true);
  const note = store.getRecord('coach-notes', 'recovery.2026-02-01').data;
  assert.deepEqual([note.answers, note.by, note.tz], [{ pain: 'Less' }, 'coach', 'UTC']);
  r = await tool('recovery_log').run({ action: 'set_checkup', date: '2026-03-12' }, ctx);
  assert.match(r.text, /^Checkup: Thursday 3\/12\./);
  const st = store.getRecord('recovery', 'state').data;
  assert.equal(st.checkup.date, '2026-03-12');
  assert.ok(st.tasks.book.doneAt, 'booking the date ticks "book the checkup"');
  r = await tool('recovery_log').run({ action: 'task_done', task: 'letter' }, ctx);
  assert.equal(r.text, 'Get the letter: done.');
  const ctxText = contextLine({ store, tz: TZ, now });
  assert.match(ctxText, /Knee recovery: today is 27 days/);
  assert.match(ctxText, /Weekly recovery check-in: done Sunday 2\/1; next Sunday 2\/8\./);
  assert.match(ctxText, /Check-ins run until his checkup, Thursday 3\/12\./);
  const read = await tool('recovery').run({}, ctx);
  assert.match(read.text, /Check-in questions: Pain \(Gone \/ Less \/ Same \/ More\); Anything new \(his words\)\./);
  assert.match(read.text, /Check-ins, newest first: Sunday 2\/1: Knee recovery check-in: Pain less\./);
  assert.match(read.text, /His list for the checkup: The swelling\./);
  store.close?.();
});
