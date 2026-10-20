import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedReminders, shortcutPayload, shortcutUrl, icsFor, icsName } from '../app/js/lib/backup-reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const areas = [
  { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Gym Hold', when: 'after Legs', where: 'gym' }, { exercise: 'Wall Hold', where: 'home' }] },
  { kind: 'area', id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Raise Hold', timing: ['after Push', 'rest days'] }] },
];
const state = (o = {}) => ({ tz: TZ, areas, rounds: {}, settings: null, meta: null, table: null, trainedDates: new Set(), neck: null, days: {}, ...o });

test('the next days: the rotation moves on as planned; only fixed reminders, only future ones', () => {
  const days = { '2026-01-21': { date: '2026-01-21', sessionTime: '04:30' } };
  // Legs today (not done yet), so: Tue 1/20 Legs, Wed 1/21 rest, Thu 1/22 Pull, Fri 1/23 Push.
  const items = fixedReminders(state({ last: { dayType: 'push', date: '2026-01-19', streak: 2 }, days }), '2026-01-20', 4, at('2026-01-20', '12:00'));
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, [
    'holds-evening:2026-01-20',
    'holds-morning:2026-01-21', 'holds-evening:2026-01-21',
    'holds-morning:2026-01-22', 'holds-evening:2026-01-22',
    'holds-morning:2026-01-23', 'holds-evening:2026-01-23',
  ]);
  assert.equal(items[1].title, 'Rest day holds: what today?');
  assert.ok(items.every((i) => i.fixed && i.kind !== 'evening'));
});

test('session and check-in times go in when set; today\'s done ones stay out', () => {
  const days = { '2026-01-20': { date: '2026-01-20', sessionTime: '04:30' }, '2026-01-22': { date: '2026-01-22', sessionTime: '05:00' } };
  const items = fixedReminders(state({ last: { dayType: 'push', date: '2026-01-19', streak: 2 }, days, rounds: { knees: { '2026-01-20': 2 } } }), '2026-01-20', 3, at('2026-01-20', '03:00'));
  assert.deepEqual(items.map((i) => i.id), [
    'readiness:2026-01-20', 'session:2026-01-20',
    'holds-morning:2026-01-21', 'holds-evening:2026-01-21',
    'readiness:2026-01-22', 'session:2026-01-22', 'holds-morning:2026-01-22', 'holds-evening:2026-01-22',
  ]);
  assert.equal(items[5].title, 'Pull at 5:00 AM');
});

test('Shortcut input and link; calendar file', () => {
  const items = [{ id: 'session:2026-01-22', at: at('2026-01-22', '05:00'), title: 'Pull at 5:00 AM', body: 'Thursday 1/22. Week 3 column, then holds; check-in.' }];
  const p = JSON.parse(shortcutPayload(items, TZ));
  assert.deepEqual(p, { list: 'Training HQ', items: [{ title: 'Pull at 5:00 AM', notes: 'Thursday 1/22. Week 3 column, then holds; check-in.', due: 'January 22, 2026 at 5:00 AM', day: 'Thursday 1/22', id: 'session:2026-01-22' }] });
  const url = shortcutUrl(shortcutPayload(items, TZ));
  assert.match(url, /^shortcuts:\/\/run-shortcut\?name=Training%20HQ%20Reminders&input=text&text=%7B/);
  const ics = icsFor(items, Date.UTC(2026, 0, 20));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20260121T220000Z\r\n/);
  assert.match(ics, /\r\nUID:session-2026-01-22@training-hq\r\n/);
  assert.match(ics, /DESCRIPTION:Thursday 1\/22. Week 3 column\\, then holds\\; check-in./);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT0M/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  assert.equal(icsName('2026-01-20'), 'training-hq-reminders-2026-01-20.ics');
});
