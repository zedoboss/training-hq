// Fri 10/30, 6:15 AM (the nightly review, his words: "Body scan today, before you train: First thing at the gym, before
// the workout"): the checklist went out with the scan logged at 2:03 AM and Push done at 3:07 AM. On the moving schedule
// the day he was in was still 10/29, and the scan and workout carry the calendar's 10/30. He wants it never once today's
// scan is logged or the session is done; say nothing, or a short well done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { nudgeInputs } from '../server/notify.mjs';
import { nudgeCandidates } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const WED = '2026-03-18';
const THU = '2026-03-19';
const FRI = '2026-03-20';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);
const push = { today: { kind: 'train', dayType: 'push' } };
const items = { items: ['Bathroom first', 'Barefoot'] };
const keys = (o) => nudgeCandidates(o).map((c) => c.key);

test('the checklist waits for a workout not started, whatever else is true', () => {
  const base = { tz: TZ, now: at(FRI, '09:30'), rot: push, wakeHm: '09:00', bedHm: '00:00', scanToday: items };
  assert.ok(keys(base).includes('scan'));
  assert.ok(!keys({ ...base, session: { started: true } }).includes('scan'), 'started');
  assert.ok(!keys({ ...base, session: { started: true, done: true } }).includes('scan'), 'done');
  assert.ok(!keys({ ...base, session: { done: true } }).includes('scan'), 'done, no start on record');
  assert.ok(!nudgeCandidates({ ...base, session: { done: true } }).some((c) => /before you train/.test(c.text)));
});

function fixture(movingDay) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-after-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', { notify: { movingDay, wakeHm: '10:00', bedHm: '00:00', nudgeEveryMin: 20, kinds: { walk: false } } });
  store.writeLocal('scan-plan', 'main', { cadence: 'training', protocol: { items: [{ id: 'bath', when: 'day', text: 'Bathroom first.' }] } });
  // Pull on Wednesday, so a training day follows; signs of him from Thursday evening, up through the night.
  store.writeLocal('sessions', 'pull', { id: 'pull', kind: 'workout', dayType: 'pull', status: 'done', startedAt: at(WED, '18:00'), endedAt: at(WED, '19:00'), exercises: [] });
  const say = (t) => store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text: 'hi', at: t });
  const scan = (date, o = {}) => store.writeLocal('body-scans', `scan.${date}`, { id: `scan.${date}`, date, status: 'done', createdAt: o.at, ...o });
  const trained = (start, end, id = 'push') => store.writeLocal('sessions', id, { id, kind: 'workout', dayType: 'push', status: 'done', startedAt: start, endedAt: end, exercises: [] });
  return { store, say, scan, trained, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('moving schedule: scan and workout dated past the day he is in: no checklist, no Evolt ask, no after-gym ask', () => {
  const f = fixture(true);
  try {
    f.say(at(FRI, '02:00'));
    f.scan(FRI, { at: at(FRI, '02:03') });
    f.trained(at(FRI, '02:05'), at(FRI, '03:07'));
    f.say(at(FRI, '05:50'));
    for (const hm of ['03:30', '05:49', '06:15', '09:00']) {
      const i = nudgeInputs(f.store, at(FRI, hm), TZ);
      assert.notEqual(i.date, FRI, 'the day he is in runs behind the calendar (the moment he hit)');
      assert.equal(i.args.scanToday, null, hm);
      assert.equal(i.args.weighedToday, true, hm);
      assert.deepEqual(nudgeCandidates(i.args).filter((c) => /scan|evolt/i.test(`${c.key} ${c.text}`)).map((c) => c.key), [], hm);
      assert.deepEqual(i.args.reminders.filter((r) => r.kind === 'scan' && r.due), [], hm);
    }
  } finally { f.done(); }
});

test('moving schedule: scan logged, workout not started yet: no checklist', () => {
  const f = fixture(true);
  try {
    f.say(at(FRI, '01:50'));
    f.scan(FRI, { at: at(FRI, '01:55') });
    f.say(at(FRI, '01:58'));
    assert.equal(nudgeInputs(f.store, at(FRI, '02:00'), TZ).args.scanToday, null);
  } finally { f.done(); }
});

test('a scan with its results still coming counts as logged: a PDF being read, photos added', () => {
  const f = fixture(false);
  try {
    f.say(at(FRI, '10:00'));
    f.store.writeLocal('body-scans', `scan.${FRI}`, { id: `scan.${FRI}`, date: FRI, status: 'prep', pdfPending: true });
    assert.equal(nudgeInputs(f.store, at(FRI, '11:00'), TZ).args.scanToday, null, 'PDF being read');
    f.store.writeLocal('body-scans', `scan.${FRI}`, { id: `scan.${FRI}`, date: FRI, status: 'prep' });
    assert.ok(nudgeInputs(f.store, at(FRI, '11:00'), TZ).args.scanToday, 'a checklist half ticked is not a scan');
    f.store.writeLocal('scan-photos', 'p1', { id: 'p1', scanId: `scan.${FRI}` });
    assert.equal(nudgeInputs(f.store, at(FRI, '11:00'), TZ).args.scanToday, null, 'photos added');
  } finally { f.done(); }
});

test('fixed hours: scan logged, or workout done: no checklist; a day with neither still gets it', () => {
  const f = fixture(false);
  try {
    f.say(at(FRI, '10:00'));
    const open = nudgeInputs(f.store, at(FRI, '11:00'), TZ);
    assert.ok(open.args.scanToday, 'nothing done: it still comes');
    assert.ok(nudgeCandidates(open.args).some((c) => c.key === 'scan'));
    f.trained(at(FRI, '11:10'), at(FRI, '12:10'));
    assert.ok(!nudgeCandidates(nudgeInputs(f.store, at(FRI, '12:30'), TZ).args).some((c) => c.key === 'scan'), 'workout done, no scan');
  } finally { f.done(); }
});

test('moving schedule: yesterday\'s scan does not silence the next training day', () => {
  const f = fixture(true);
  try {
    f.say(at(THU, '18:00'));
    f.scan(THU, { at: at(THU, '18:10') });
    f.trained(at(THU, '18:15'), at(THU, '19:15'));
    f.say(at(THU, '22:00'));
    // Slept, up Friday 6:00 PM; his next workout (Legs) is ahead of him in this new stretch.
    f.say(at(FRI, '18:00'));
    f.say(at(FRI, '19:00'));
    const i = nudgeInputs(f.store, at(FRI, '19:05'), TZ);
    assert.equal(i.date, FRI);
    assert.equal(i.args.session.started, false);
    assert.ok(i.args.scanToday, 'the new day gets its checklist');
    assert.ok(nudgeCandidates({ ...i.args, sleepLogged: true }).some((c) => c.key === 'scan'));
  } finally { f.done(); }
});
