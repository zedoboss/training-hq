import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryReminders, checkInAgainText } from '../app/js/lib/recovery.js';
import { nudgeCandidates } from '../app/js/lib/nudges.js';

// Thu 10/29, his words: "Surgery recovery: weekly check-in... " went out at 5:05 AM as a reminder and again at 5:15 AM
// as a nudge, word for word. The check-in goes out once; a follow-up comes later and in new words. Made-up record.
const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const PLAN = {
  title: 'Knee recovery', since: '2026-01-05', until: '2026-03-31',
  checkIn: { from: '2026-02-01', everyDays: 7, askAgainDays: 2, questions: [
    { key: 'pain', label: 'Pain', ask: 'Pain when pressed, compared with last time?', choices: ['Gone', 'Less', 'Same', 'More'] },
    { key: 'swell', label: 'Swelling', ask: 'Swelling, compared with last time?', choices: ['Gone', 'Less', 'Same', 'More'] },
    { key: 'new', label: 'Anything new', ask: 'Anything new?', kind: 'text' },
  ] },
  tasks: [{ id: 'book', text: 'Book the checkup' }, { id: 'paper', text: 'Get the letter' }],
  photos: { poses: ['front', 'side'], minDays: 14, maxDays: 28, from: '2026-02-01', how: 'Same light.' },
};
const D = '2026-02-01';
const base = { tz: TZ, rot: null, wakeHm: '04:40', bedHm: '20:00' };
const rem = (date = D, extra = {}) => recoveryReminders({ date, tz: TZ, plan: PLAN, hm: '05:05' }).map((r) => ({ ...r, ...extra }));
const recNudges = (now, reminders, sent = {}) => nudgeCandidates({ ...base, now, reminders, sent }).filter((c) => c.key.startsWith('recovery:'));

test('the weekly check-in: no follow-up ten minutes after it went out, the one later is in new words', () => {
  const r = rem(D, { sentAt: at(D, '05:05') });
  const checkin = r.find((x) => x.tag === 'recovery-checkin');
  const said = `${checkin.title}. ${checkin.body}`;
  assert.deepEqual(recNudges(at(D, '05:15'), r), [], '5:15 AM: nothing, it just went out');
  assert.deepEqual(recNudges(at(D, '06:59'), r), [], 'not before its own 2 hours');
  const later = recNudges(at(D, '07:05'), r).find((c) => c.key === 'recovery:recovery-checkin');
  assert.ok(later, 'a follow-up from 7:05 AM');
  assert.equal(later.text, 'Knee recovery: no answer yet. Pain and swelling: gone, less, same or more? Anything new? One line does it.');
  assert.notEqual(later.text, said);
  assert.ok(!later.text.includes('compared with last time'), 'none of the check-in\'s own words');
  assert.ok(later.gapMin >= 18 * 60, 'one follow-up, not every 2 hours');
});

test('held for his morning: the follow-up waits from when the check-in really went out; not sent yet, none at all', () => {
  assert.deepEqual(recNudges(at(D, '07:30'), rem(D, { sentAt: at(D, '07:20') })), [], 'sent late at 7:20 AM: nothing at 7:30 AM');
  assert.equal(recNudges(at(D, '09:20'), rem(D, { sentAt: at(D, '07:20') })).length > 0, true);
  assert.deepEqual(recNudges(at(D, '09:20'), rem(D, { sentAt: null })), [], 'the check-in itself never went out');
});

test('answered, or the list and photos: the same, once, later, in their own words', () => {
  assert.deepEqual(recNudges(at(D, '08:00'), rem(D, { sentAt: at(D, '05:05'), due: false })), [], 'answered: nothing');
  // The list's own weekly reminder (no check-in running: a plan without one), Monday 2/2, four weeks from since.
  const day = '2026-02-02';
  const r0 = recoveryReminders({ date: day, tz: TZ, plan: { ...PLAN, checkIn: undefined }, hm: '05:05' }).map((x) => ({ ...x, sentAt: at(day, '05:05') }));
  const t = r0.find((x) => x.tag === 'recovery-tasks');
  assert.ok(t);
  assert.deepEqual(recNudges(at(day, '05:15'), r0), []);
  const c = recNudges(at(day, '07:10'), r0).find((x) => x.key === 'recovery:recovery-tasks');
  assert.equal(c.text, 'Knee recovery, your list is still open: book the checkup; get the letter. Done any of it? Tell me, or tick it in Body > Recovery.');
  assert.notEqual(c.text, `${t.title}. ${t.body}`);
  const r = rem(D, { sentAt: at(D, '05:10') });
  const ph = r.find((x) => x.tag === 'recovery-photos');
  assert.ok(ph);
  assert.deepEqual(recNudges(at(D, '05:20'), r), []);
  const p = recNudges(at(D, '07:15'), r).find((x) => x.key === 'recovery:recovery-photos');
  assert.equal(p.text, 'Knee recovery photos still not taken today. 2 quick shots in Body > Recovery.');
});

test('the follow-up words come from his own questions', () => {
  assert.equal(checkInAgainText('Recovery', [{ key: 'pain', label: 'Pain', choices: ['Less', 'Same', 'More'] }]), 'Recovery: no answer yet. Pain: less, same or more? One line does it.');
  assert.equal(checkInAgainText('Recovery', [{ key: 'new', label: 'Anything new', kind: 'text' }]), 'Recovery: no answer yet. Anything new? One line does it.');
});

test('other planned reminders: the first nudge waits its own gap after the reminder too', () => {
  const s = { id: 'supps-a', kind: 'supps', tag: 'supps-morning', at: at(D, '07:00'), sentAt: at(D, '07:00'), due: true, title: 'Morning supplements', body: 'Vitamin C.' };
  const k = (now) => nudgeCandidates({ ...base, now, reminders: [s] }).map((c) => c.key);
  assert.deepEqual(k(at(D, '07:10')), []);
  assert.deepEqual(k(at(D, '07:45')), ['supps:supps-morning']);
});
