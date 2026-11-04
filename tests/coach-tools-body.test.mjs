// Thu 11/5, his words: "What else cant u do? Figure it out and let the mac give U the tools". The body tools: what his
// Body, Sauna, classes, recovery, reminders, photo and stats screens do, by talking. Made-up data only.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { autoSleep } from '../server/notify.mjs';
import { BODY_TOOLS } from '../server/coach/tools-body.mjs';
import { WRITE_TOOLS } from '../server/coach/tools-write.mjs';
import { APP_TOOLS } from '../server/coach/tools-app.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { ladderState } from '../app/js/lib/sauna.js';
import { activityReminders, kickTests } from '../app/js/lib/activities.js';
import { withSleepLog } from '../app/js/lib/health.js';
import { rearmRepeats, nextRepeatAt, startNotifier } from '../server/notify.mjs';

const TZ = 'UTC';
const NOW = Date.UTC(2026, 0, 20, 3, 0); // Tuesday 1/20, 3:00 AM
const at = (iso, hm = '03:00') => Date.parse(`${iso}T${hm}:00Z`);
let dir; let store; let actions; let clock;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-body-'));
  store = openStore(join(dir, 'db.sqlite'));
  actions = []; clock = NOW;
  const w = (col, id, data) => store.writeLocal(col, id, data);
  w('programme', 'meta', { kind: 'meta', firstSessions: { pull: '2026-01-01', push: '2026-01-02', legs: '2026-01-03' } });
  // Legs done this morning (so no lifting is left today); Push in December for the monthly report.
  w('sessions', 'legs', { id: 'legs', kind: 'workout', title: 'Legs', dayType: 'legs', startedAt: at('2026-01-20', '01:00'), endedAt: at('2026-01-20', '02:00'), pausedMs: 0, status: 'done', exercises: [{ key: 'a', exerciseId: 'test-squat', name: 'Test Squat', type: 'weight_reps' }] });
  w('sessions', 'push', { id: 'push', kind: 'workout', title: 'Push', dayType: 'push', startedAt: at('2025-12-10'), endedAt: at('2025-12-10', '04:00'), pausedMs: 0, status: 'done', exercises: [{ key: 'a', exerciseId: 'test-squat', name: 'Test Squat', type: 'weight_reps' }] });
  w('sets', 's1', { id: 's1', sessionId: 'legs', exKey: 'a', order: 0, type: 'normal', kg: 60, reps: 10, done: true });
  w('sets', 's2', { id: 's2', sessionId: 'legs', exKey: 'a', order: 1, type: 'normal', kg: 60, reps: 8, done: true });
  w('sets', 's3', { id: 's3', sessionId: 'push', exKey: 'a', order: 0, type: 'normal', kg: 50, reps: 10, done: true });
  w('days', '2026-01-20', { id: '2026-01-20', date: '2026-01-20', readiness: { ratings: { E: 3 } } });
  w('sauna-plan', 'main', { id: 'main', doctor: [{ at: NOW - 86400000, answer: 'yes', context: 'first' }] });
  w('recovery', 'main', { title: 'Test recovery', since: '2025-12-01', checkIn: { from: '2025-12-08', everyDays: 7, questions: [
    { key: 't', label: 'Tenderness', ask: 'Tenderness?', choices: ['Gone', 'Less', 'Same', 'More'] }, { key: 'n', label: 'Anything new', ask: 'Anything new?', kind: 'text' }] },
  photos: { poses: ['front', 'arms-up'] } });
  w('coach-photos', 'cphoto.a.0x', { id: 'cphoto.a.0x', messageId: 'm1', dataUrl: 'data:image/jpeg;base64,AAAA', at: NOW - 120000, sentAt: NOW - 60000 });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const ALL = [...BODY_TOOLS, ...WRITE_TOOLS, ...APP_TOOLS];
const call = (name, args = {}) => ALL.find((t) => t.name === name).run(args, { store, tz: TZ, now: () => clock, action: (a) => actions.push(a) });
const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);

test('names are new; every write says his words only; deletions only on his explicit words', () => {
  const others = TOOLS.filter((t) => !BODY_TOOLS.includes(t)).map((t) => t.name);
  for (const t of BODY_TOOLS) {
    assert.ok(!others.includes(t.name), `${t.name} clashes`);
    assert.equal(t.inputSchema.additionalProperties, false);
    if (!t.annotations?.readOnlyHint) assert.match(t.description, /his words/, t.name);
  }
  assert.match(BODY_TOOLS.find((t) => t.name === 'body_delete').description, /only when he says to delete/);
});

test('body_log: measurements as the Measurements screen saves them, steps and a walk for a past day', async () => {
  store.writeLocal('measurements', 'measure.2026-01-10', { id: 'measure.2026-01-10', date: '2026-01-10', waistCm: 84, source: 'manual' });
  const r = await call('body_log', { action: 'measurements', values: [{ field: 'waist', value: 82 }, { field: 'left biceps', value: 14, unit: 'in' }] });
  assert.equal(r.wrote, true);
  assert.match(r.text, /^Saved for Tuesday 1\/20: Waist 82 cm \(was 84, Saturday 1\/10\); Left biceps 35\.56 cm\./);
  const m = one('measurements', 'measure.2026-01-20');
  assert.equal(m.waistCm, 82); assert.equal(m.leftBicepCm, 35.56); assert.equal(m.source, 'manual'); assert.equal(m.at, NOW);
  assert.match((await call('body_log', { action: 'measurements', values: [{ field: 'nose', value: 3 }] })).text, /^Nothing saved: "nose" is not a measurement/);
  assert.match((await call('body_log', { action: 'measurements', values: [{ field: 'waist', value: 900 }] })).text, /out of range/);
  assert.match((await call('body_log', { action: 'steps', date: '2026-01-21', steps: 5 })).text, /^Not a future date/);

  const st = await call('body_log', { action: 'steps', date: '2026-01-18', steps: 9120 });
  assert.match(st.text, /^Steps for Sunday 1\/18: 9,120\. On Body's steps chart\. A later Apple Health file/);
  assert.equal(one('health', '2026-01-18').steps, 9120);

  assert.match((await call('body_log', { action: 'walk', date: '2026-01-18', minutes: 30 })).text, /^What time was the walk/);
  const wk = await call('body_log', { action: 'walk', date: '2026-01-18', time: '17:30', minutes: 30 });
  assert.match(wk.text, /^Walk logged for Sunday 1\/18, 5:30 PM, 30 min\./);
  assert.deepEqual(one('walks', '2026-01-18').walks, [{ at: at('2026-01-18', '17:30'), minutes: 30, steps: null }]);
});

test('body_delete: a wrong weigh-in (other measurements stay), Health\'s own, a sleep entry, a day\'s scan', async () => {
  store.writeLocal('measurements', 'measure.2026-01-19', { id: 'measure.2026-01-19', date: '2026-01-19', weightKg: 91.2, fatPercent: 18, waistCm: 83, source: 'evolt' });
  const r = await call('body_delete', { action: 'weight', date: '2026-01-19' });
  assert.match(r.text, /^Deleted from Monday 1\/19: Weight 91\.2 kg, Body fat 18%\. Kept: Waist\./);
  assert.deepEqual(Object.keys(one('measurements', 'measure.2026-01-19')).filter((x) => /Kg|Cm|Percent/.test(x)), ['waistCm']);
  const all = await call('body_delete', { action: 'measurements', date: '2026-01-19' });
  assert.match(all.text, /^Deleted from Monday 1\/19: Waist 83 cm\./);
  assert.equal(one('measurements', 'measure.2026-01-19'), null, 'nothing left: the entry is gone');
  store.writeLocal('health', '2026-01-17', { id: '2026-01-17', date: '2026-01-17', steps: 100, weights: [{ at: at('2026-01-17'), kg: 90 }], workouts: [] });
  assert.match((await call('body_delete', { action: 'weight', date: '2026-01-17' })).text, /comes from Apple Health .* Health app/);

  // A nap the app took as the night.
  store.writeLocal('sleep-log', '2026-01-20', { id: '2026-01-20', date: '2026-01-20', bed: at('2026-01-19', '22:00'), wake: at('2026-01-20', '01:00'), inBedMin: 180, asleepMin: 180, source: 'auto', at: NOW });
  const sl = await call('body_delete', { action: 'sleep', date: '2026-01-20' });
  assert.match(sl.text, /^Deleted the sleep of the night to Tuesday 1\/20: 10:00 PM to 1:00 AM, 3 h \(the app worked it out from his activity\)\.$/);
  assert.equal(one('sleep-log', '2026-01-20'), null);
  // The app doesn't work that night out again from his activity.
  assert.equal(autoSleep(store, NOW, TZ, { asleep: false, gap: true, wokeAt: at('2026-01-20', '01:00'), nightBed: at('2026-01-19', '22:00'), nights: [{ wake: at('2026-01-20', '01:00') }] }), null);
  assert.equal(one('sleep-log', '2026-01-20'), null);
  assert.equal(withSleepLog([], list('sleep-log')).length, 0, 'gone from Body');
  assert.match((await call('body_delete', { action: 'sleep', date: '2026-01-20' })).text, /^No sleep saved/);

  store.writeLocal('body-scans', 'scan.2026-01-19', { id: 'scan.2026-01-19', date: '2026-01-19', status: 'done', metrics: [{ label: 'Weight', value: 91, text: '91', unit: 'kg' }] });
  store.writeLocal('scan-photos', 'p1', { id: 'p1', scanId: 'scan.2026-01-19', date: '2026-01-19', dataUrl: 'x' });
  const sc = await call('body_delete', { action: 'scan', date: '2026-01-19' });
  assert.match(sc.text, /^Deleted the body scan of Monday 1\/19 \(1 number\) and its 1 photo\./);
  assert.equal(one('body-scans', 'scan.2026-01-19'), null); assert.equal(one('scan-photos', 'p1'), null);
});

test('class_log: edit and delete a logged class; the kick test as data, counted by the weekly reminder', async () => {
  await call('activity_plan', { what: 'log_class', discipline: 'boxing', minutes: 60, date: '2026-01-18', time: '19:00' });
  const [c] = list('sessions').filter((x) => x.title === 'Boxing');
  const e = await call('class_log', { action: 'edit', date: '2026-01-18', minutes: 75, discipline: 'kickboxing', note: 'sparring' });
  assert.match(e.text, /^Changed the class \(Boxing, Sunday 1\/18, 60 min\) to: Kickboxing, Sunday 1\/18, 7:00 PM, 75 min \(sparring\)\./);
  const s2 = one('sessions', c.id);
  assert.equal(s2.exercises[0].exerciseId, 'kickboxing-class');
  assert.equal(s2.endedAt - s2.startedAt, 75 * 60000);
  assert.equal(list('sets').find((x) => x.sessionId === c.id).durationS, 4500);
  assert.match((await call('class_log', { action: 'edit', date: '2026-01-17' })).text, /^No class logged on Saturday 1\/17/);
  const d = await call('class_log', { action: 'delete', session: c.id });
  assert.match(d.text, /^Deleted the class: Kickboxing, Sunday 1\/18, 75 min\./);
  assert.equal(one('sessions', c.id), null);
  assert.equal(list('sets').filter((x) => x.sessionId === c.id).length, 0);

  await call('class_log', { action: 'kick_test', date: '2026-01-11', front_cm: 120, side_cm: 100 });
  const k = await call('class_log', { action: 'kick_test', front_cm: 124, side_cm: 98 });
  assert.match(k.text, /^Kick test saved for Tuesday 1\/20: front 124 cm \(\+4 cm\), side 98 cm \(−2 cm\), against Sunday 1\/11\./);
  assert.deepEqual(kickTests(list('coach-notes')), [{ date: '2026-01-11', frontCm: 120, sideCm: 100 }, { date: '2026-01-20', frontCm: 124, sideCm: 98 }]);
  // The weekly reminder (Sunday tests) sees it as a test, as the old text notes.
  const flexTests = list('coach-notes').filter((x) => /^flex/i.test(x.topic || '')).map((x) => x.date);
  const due = activityReminders({ date: '2026-01-25', tz: TZ, flex: { when: 'evening', hm: '20:00', testWeekday: 0 }, tests: flexTests });
  assert.ok(!due.some((x) => x.id.startsWith('flex-test')), 'tested 5 days before: not asked yet');
});

test('recovery_answers: fix one answer of a past check-in, delete one', async () => {
  await call('recovery_log', { action: 'check_in', answers: [{ question: 'Tenderness', answer: 'same' }, { question: 'Anything new', answer: '' }] });
  const e = await call('recovery_answers', { action: 'edit', date: '2026-01-20', answers: [{ question: 'tenderness', answer: 'less' }] });
  assert.match(e.text, /^Check-in of Tuesday 1\/20 now: Test recovery check-in: Tenderness less\. \(was: Test recovery check-in: Tenderness same\.\)/);
  assert.equal(one('coach-notes', 'recovery.2026-01-20').answers.t, 'Less');
  assert.match((await call('recovery_answers', { action: 'edit', date: '2026-01-20', answers: [{ question: 'tenderness', answer: 'better' }] })).text, /one of Gone, Less, Same, More/);
  assert.match((await call('recovery_answers', { action: 'delete', date: '2026-01-13' })).text, /^No check-in saved on Tuesday 1\/13\. His check-ins: Tuesday 1\/20/);
  assert.match((await call('recovery_answers', { action: 'delete', date: '2026-01-20' })).text, /^Deleted the check-in of Tuesday 1\/20/);
  assert.equal(one('coach-notes', 'recovery.2026-01-20'), null);
});

test('sauna_log: a session he did without the app goes through the ladder\'s own code; symptoms step it back', async () => {
  const ask = await call('sauna_log', { action: 'log', date: '2026-01-17', minutes: [10] });
  assert.match(ask.text, /^Ask him first whether he felt anything/);
  const a = await call('sauna_log', { action: 'log', date: '2026-01-17', time: '17:00', minutes: [10], symptoms: [] });
  assert.match(a.text, /^Logged the sauna of Saturday 1\/17, 5:00 PM: 1 round \(10 min\); his step then was 1 round of 10 minutes; clean\. Ladder now: 1 round of 10 minutes, 1 of 2 clean/);
  // More than his step counts as his step only; the second clean one unlocks the next step, as on the phone.
  const b = await call('sauna_log', { action: 'log', date: '2026-01-18', time: '17:00', minutes: [15], symptoms: [] });
  assert.match(b.text, /clean\. He did more than his step: the ladder counts it as 1 round of 10 minutes only\. .*Ladder now: 1 round of 12 minutes, 0 of 2 .*Two clean sessions in a row: the next step is unlocked\./);
  assert.match((await call('sauna_log', { action: 'log', date: '2026-01-18', minutes: [10], symptoms: [] })).text, /already logged .* again: true/);
  // Short of his step: not clean, and the run of clean sessions starts over.
  const c = await call('sauna_log', { action: 'log', date: '2026-01-19', minutes: [8], symptoms: [] });
  assert.match(c.text, /not completed as planned/);
  const d = await call('sauna_log', { action: 'log', date: '2026-01-19', time: '19:00', minutes: [12], symptoms: ['dizzy'], again: true });
  assert.match(d.text, /STOPPED \(symptoms: Dizzy\)\. Tell him: Get out, sit or lie down, cool down gradually and drink\. Ladder now: 1 round of 10 minutes/);
  const all = list('sauna');
  assert.equal(ladderState(all, '2026-01-20', one('sauna-plan', 'main')).step, 0, 'the ladder code itself puts him back a step');
  assert.ok(all.every((x) => x.told && x.status !== 'active'));
  assert.match((await call('sauna_log', { action: 'log', date: '2026-01-20', time: '02:58', minutes: [10], symptoms: [] })).text, /would end after now/);
});

test('sauna_log checklist: each line only as he says; the app\'s gates decide; start opens the run screen', async () => {
  const one1 = await call('sauna_log', { action: 'checklist', items: [{ item: 'fed', answer: 'yes' }] });
  assert.match(one1.text, /^Checklist so far: fed, energy ticked\. Energy 3 from today's check-in\. Not a go yet: Not ticked: No alcohol/);
  assert.equal(one1.wrote, true);
  const two = await call('sauna_log', { action: 'checklist', items: [{ item: 'clear', answer: 'yes' }, { item: 'kit', answer: 'yes' }, { item: 'company', answer: 'not-possible' }] });
  assert.match(two.text, /^Every line ticked: the app says go, 1 round of 10 minutes\. Never before lifting\./);
  assert.equal(list('sauna').length, 0, 'nothing starts without his word');
  const go = await call('sauna_log', { action: 'checklist', start: true });
  assert.match(go.text, /^Sauna started on his phone: 1 round of 10 minutes\./);
  const s = list('sauna')[0];
  assert.equal(s.status, 'active'); assert.equal(s.stepIndex, 0); assert.equal(s.plannedRounds, 1);
  assert.ok(actions.some((x) => x.url === `#/sauna/run/${s.id}`));
  // A low energy rating from the check-in can't be ticked away.
  store.writeLocal('sauna', s.id, null, { deleted: true });
  store.writeLocal('days', '2026-01-20', { id: '2026-01-20', date: '2026-01-20', readiness: { ratings: { E: 1 } } });
  const low = await call('sauna_log', { action: 'checklist', items: [{ item: 'energy', answer: 'yes' }], start: true });
  assert.match(low.text, /Your readiness energy rating today is 1\. The sauna needs 2 or 3\./);
  assert.equal(list('sauna').length, 0);
});

test('save_photo: a Talk photo as a progress, recovery or scan photo', async () => {
  const p = await call('save_photo', { photo: 'cphoto.a.0x', kind: 'progress', pose: 'front' });
  assert.match(p.text, /^Saved as his front progress photo of Tuesday 1\/20\./);
  assert.equal(one('body-photos', 'bodyphoto.2026-01-20.front').dataUrl, 'data:image/jpeg;base64,AAAA');
  assert.match((await call('save_photo', { photo: 'cphoto.a.0x', kind: 'progress', pose: 'front' })).text, /already has a front photo\. Replace it only if he says so/);
  assert.match((await call('save_photo', { photo: 'cphoto.a.0x', kind: 'recovery', pose: 'back' })).text, /^Which pose\? front \(Front\), arms-up \(Arms behind head\)/);
  assert.match((await call('save_photo', { photo: 'cphoto.a.0x', kind: 'recovery', pose: 'arms-up' })).text, /^Saved as his arms behind head recovery photo of Tuesday 1\/20 \(Body > Recovery counts it\)\./);
  const sc = await call('save_photo', { photo: 'cphoto.a.0x', kind: 'scan', date: '2026-01-19' });
  assert.match(sc.text, /^Saved as a photo of the body scan of Monday 1\/19\. The Mac reads its numbers/);
  const [sp] = list('scan-photos');
  assert.equal(sp.scanId, 'scan.2026-01-19');
  assert.equal(one('body-scans', 'scan.2026-01-19').status, 'prep');
  assert.match((await call('save_photo', { photo: 'cphoto.zzz', kind: 'scan' })).text, /^No photo cphoto\.zzz/);
});

test('reminders: a daily one goes out, and the Mac\'s notifier writes the next; weekdays skip the weekend; move; list', async () => {
  const r = await call('reminders', { action: 'repeat', every: 'daily', time: '09:00', text: 'Stretch your hips.' });
  assert.match(r.text, /^Repeating reminder set, every day at 9:00 AM: "Stretch your hips\."\. The first is Tuesday 1\/20, 9:00 AM\./);
  const [rem] = list('coach-reminders');
  assert.equal(rem.repeat, 'daily'); assert.equal(rem.at, at('2026-01-20', '09:00'));
  assert.match((await call('reminders', { action: 'list' })).text, /- Tuesday 1\/20, 9:00 AM: his reminder "Stretch your hips\." \(every day at 9:00 AM\) \[id rem-/);

  const sent = [];
  const n = startNotifier({ store, push: { list: () => [1], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } }, tz: TZ, now: () => clock, everyMs: 1e9 });
  n.stop();
  clock = at('2026-01-20', '09:00');
  await n.tick();
  assert.equal(sent.filter((m) => /Stretch your hips/.test(m.body)).length, 1);
  clock += 60000;
  await n.tick();
  const next = list('coach-reminders').find((x) => x.prevId === rem.id);
  assert.equal(next.at, at('2026-01-21', '09:00'), 'the next one, tomorrow at 9:00 AM');
  assert.equal(one('coach-reminders', rem.id).nextId, next.id);
  clock = at('2026-01-21', '09:00');
  await n.tick();
  assert.equal(sent.filter((m) => /Stretch your hips/.test(m.body)).length, 2, 'again the next day');
  clock += 60000; await n.tick();
  // Cancelling the waiting one ends the series.
  const third = list('coach-reminders').find((x) => x.prevId === next.id);
  await call('set_reminder', { cancel: third.id });
  clock = at('2026-01-23', '09:00'); await n.tick();
  assert.equal(list('coach-reminders').length, 3);

  // Missed with the Mac asleep: the next is written all the same. Weekdays skip Saturday and Sunday.
  const w = await call('reminders', { action: 'repeat', every: 'weekdays', time: '07:30', text: 'Water.' });
  assert.match(w.text, /every weekday at 7:30 AM: "Water\."\. The first is Monday 1\/26, 7:30 AM\./);
  const water = list('coach-reminders').find((x) => x.text === 'Water.');
  assert.equal(water.date, '2026-01-26', 'Friday after 7:30 AM: Monday next');
  const out = rearmRepeats(store, at('2026-01-26', '08:10'), TZ);
  assert.deepEqual(out.map((x) => x.date), ['2026-01-27']);
  assert.deepEqual(nextRepeatAt({ repeat: 'days', days: [2, 4], hm: '18:00' }, at('2026-01-22', '19:00'), TZ), { at: at('2026-01-27', '18:00'), date: '2026-01-27' });

  // Move one: for good, or only this time.
  const mv = await call('reminders', { action: 'move', id: water.id, time: '08:00' });
  assert.match(mv.text, /^Moved: "Water\." now Monday 1\/26, 8:00 AM, and every weekday at 8:00 AM from now on \(was 7:30 AM\)\./);
  assert.equal(one('coach-reminders', water.id).hm, '08:00');
  await call('set_reminder', { inMinutes: 30, text: 'Trash.' });
  const trash = list('coach-reminders').find((x) => x.text === 'Trash.');
  const m2 = await call('reminders', { action: 'move', id: trash.id, inMinutes: 90 });
  assert.match(m2.text, /^Moved: "Trash\." now Friday 1\/23, 10:30 AM \(was 9:30 AM\)\./);
  assert.match((await call('reminders', { action: 'move', id: rem.id, time: '10:00' })).text, /already gone out/);
});

test('stats: the Statistics screen and the Monthly report in words', async () => {
  const p = await call('stats', { action: 'period', period: '4w' });
  assert.match(p.text, /^Statistics, last 4 weeks \(Wednesday 12\/24\/2025 to today\): 1 session \(0% vs the 4 weeks before\), 1 h \(0% vs the 4 weeks before\), volume 1,080 kg \(\+116% vs the 4 weeks before\), 2 sets \(\+100% vs the 4 weeks before\)\.\nSets per muscle \(the 4 weeks before in brackets\): Other 2 \(was 1\)\.\nMost logged: Test Squat 2 sets in 1 session\.\nVolume by week \(from Monday\): .*Monday 1\/19 1,080 kg, 2 sets\./);
  const m = await call('stats', { action: 'month' });
  assert.match(m.text, /^Monthly report, January 2026: 1 session \(0% vs the month before\), 1 h \(0% vs the month before\), volume 1,080 kg \(\+116% vs the month before\), 2 sets \(\+100% vs the month before\)\./);
  assert.match(m.text, /Sessions: Tuesday 1\/20 Legs\./);
  assert.match(m.text, /Bests \(heaviest set above everything before\): Test Squat 60 kg \(was 50 kg\)\./);
  assert.match((await call('stats', { action: 'month', month: '2025-12' })).text, /^Monthly report, December 2025: 1 session,/);
});

test('open_screen: a past workout, a calendar day, the monthly report of a month, an exercise\'s demo', async () => {
  const w = await call('open_screen', { screen: 'workout_detail', date: '2025-12-10' });
  assert.match(w.text, /^Opened on his phone: Push, Wednesday 12\/10\/2025\./);
  assert.equal(actions.at(-1).url, '#/finish/push/h');
  assert.match((await call('open_screen', { screen: 'workout_detail', name: 'legs' })).text, /Legs, Tuesday 1\/20/);
  assert.match((await call('open_screen', { screen: 'workout_detail', date: '2026-01-05' })).text, /^No finished workout on Monday 1\/5/);
  await call('open_screen', { screen: 'calendar', date: '2026-01-18' });
  assert.equal(actions.at(-1).url, '#/calendar/2026-01-18');
  await call('open_screen', { screen: 'stats_month', date: '2025-12-03' });
  assert.equal(actions.at(-1).url, '#/stats/month/2025-12');
  await call('open_screen', { screen: 'calendar' });
  assert.equal(actions.at(-1).url, '#/calendar');
  store.writeLocal('exercises', 'test-squat', { id: 'test-squat', name: 'Test Squat', type: 'weight_reps', primary: 'quadriceps' });
  const d = await call('open_screen', { screen: 'demos', name: 'test squat' });
  assert.match(d.text, /Test Squat, its page with the demo at the top \(no demo for it yet/);
  assert.equal(actions.at(-1).url, '#/exercise/test-squat');
});
