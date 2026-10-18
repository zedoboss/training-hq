import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotationDay, lastRotationSession, addDays, withRest, daysByDate, nextDayType } from '../app/js/lib/rotation.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm = '04:30') => new Date(`${iso}T${hm}:00+07:00`).getTime();
const done = (id, dayType, iso, extra = {}) => ({ id, kind: 'workout', status: 'done', dayType, startedAt: at(iso), ...extra });

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 2), '2027-01-02');
  assert.equal(addDays('2026-10-18', -18), '2026-09-30');
});

test('next day type comes from the last completed session, not the calendar (decision 15)', () => {
  const last = { dayType: 'push', date: '2026-10-12' };
  // Days without a session don't move it on: Legs is still next a week later.
  assert.deepEqual(rotationDay({ last, today: '2026-10-13' }).today, { kind: 'train', dayType: 'legs', reason: null });
  assert.deepEqual(rotationDay({ last, today: '2026-10-19' }).today, { kind: 'train', dayType: 'legs', reason: null });
  assert.equal(rotationDay({ last: null, today: '2026-10-19' }).today.dayType, 'pull');
});

test('the day after Legs is the rotation rest day; then Pull', () => {
  const last = { dayType: 'legs', date: '2026-10-17' };
  const sun = rotationDay({ last, today: '2026-10-18' });
  assert.deepEqual(sun.today, { kind: 'rest', dayType: null, reason: 'rotation' });
  assert.deepEqual(sun.next, { dayType: 'pull', date: '2026-10-19' });
  assert.deepEqual(rotationDay({ last, today: '2026-10-19' }).today, { kind: 'train', dayType: 'pull', reason: null });
  // Two days or more after Legs: the rest happened, Pull is due.
  assert.equal(rotationDay({ last, today: '2026-10-21' }).today.dayType, 'pull');
});

test('trained today: done, and the next session is tomorrow (or after the rest day when it was Legs)', () => {
  const pull = rotationDay({ last: { dayType: 'pull', date: '2026-10-19' }, today: '2026-10-19' });
  assert.deepEqual(pull.today, { kind: 'done', dayType: 'pull', reason: null });
  assert.deepEqual(pull.next, { dayType: 'push', date: '2026-10-20' });
  const legs = rotationDay({ last: { dayType: 'legs', date: '2026-10-21' }, today: '2026-10-21' });
  assert.deepEqual(legs.next, { dayType: 'pull', date: '2026-10-23' });
});

test('an added rest day: no session today, the same day type tomorrow, nothing made up', () => {
  const last = { dayType: 'pull', date: '2026-10-19' };
  const days = daysByDate([withRest(null, '2026-10-20', 'added', 1)]);
  const tue = rotationDay({ last, today: '2026-10-20', days });
  assert.deepEqual(tue.today, { kind: 'rest', dayType: null, reason: 'added' });
  assert.deepEqual(tue.next, { dayType: 'push', date: '2026-10-21' });
  assert.equal(rotationDay({ last, today: '2026-10-21', days }).today.dayType, 'push');
  // Marked in advance: the day after Pull is skipped when working out the next date.
  assert.deepEqual(rotationDay({ last, today: '2026-10-19', days }).next, { dayType: 'push', date: '2026-10-21' });
  // Taking the rest day back.
  const back = withRest(days['2026-10-20'], '2026-10-20', null);
  assert.equal(back.rest, undefined);
  assert.equal(rotationDay({ last, today: '2026-10-20', days: daysByDate([back]) }).today.kind, 'train');
});

test('last rotation session: imported and own sessions count, neck and holds rounds do not', () => {
  const sessions = [
    done('hevy.1', 'push', '2026-10-12', { source: 'hevy' }),
    done('s2', 'neck', '2026-10-14'),
    { id: 'h', kind: 'holds', status: 'done', area: 'knees', startedAt: at('2026-10-15') },
    { id: 'a', kind: 'workout', status: 'active', dayType: 'legs', startedAt: at('2026-10-16') },
    done('s3', null, '2026-10-15'),
  ];
  assert.deepEqual(lastRotationSession(sessions, null, TZ), { dayType: 'push', date: '2026-10-12', sessionId: 'hevy.1' });
  sessions.push(done('s4', 'legs', '2026-10-17'));
  assert.equal(lastRotationSession(sessions, null, TZ).dayType, 'legs');
});

test('last rotation session: the Hevy bridge until history is imported, own sessions when newer', () => {
  const bridge = { lastSessions: [{ dayType: 'push', date: '2026-10-12' }, { dayType: 'legs', date: '2026-10-10' }] };
  assert.deepEqual(lastRotationSession([], bridge, TZ), { dayType: 'push', date: '2026-10-12', sessionId: null });
  assert.equal(lastRotationSession([done('s', 'legs', '2026-10-13')], bridge, TZ).dayType, 'legs');
  assert.equal(lastRotationSession([done('s', 'legs', '2026-10-10')], bridge, TZ).dayType, 'push');
});

test('a session late in the evening counts on its own date in the given time zone', () => {
  const s = { id: 'x', kind: 'workout', status: 'done', dayType: 'pull', startedAt: new Date('2026-10-19T23:30:00+07:00').getTime() };
  assert.equal(lastRotationSession([s], null, TZ).date, '2026-10-19');
  assert.equal(lastRotationSession([s], null, 'UTC').date, '2026-10-19');
  assert.equal(nextDayType('neck'), 'pull');
});
