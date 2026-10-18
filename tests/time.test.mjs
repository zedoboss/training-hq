import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatTimeSec, formatDay, formatDate, weekdayShort, isoDate, daysBetween } from '../app/js/lib/time.js';

// UTC+7 fixture zone. 2026-10-16T21:05:12Z is Saturday 10/17, 4:05:12 AM there.
const TZ = 'Asia/Bangkok';
const early = new Date('2026-10-16T21:05:12Z');
const afternoon = new Date('2026-10-17T09:30:00Z');

test('times are H:MM AM/PM in the given zone', () => {
  assert.equal(formatTime(early, TZ), '4:05 AM');
  assert.equal(formatTime(afternoon, TZ), '4:30 PM');
  assert.equal(formatTimeSec(early, TZ), '4:05:12 AM');
});

test('days are weekday plus month/day, local date not UTC date', () => {
  assert.equal(formatDay(early, TZ), 'Saturday 10/17');
  assert.equal(formatDate(early, TZ), 'Saturday 10/17/2026');
  assert.equal(weekdayShort(early, TZ), 'SAT');
  assert.equal(isoDate(early, TZ), '2026-10-17');
});

test('day arithmetic', () => {
  assert.equal(daysBetween('2026-09-24', '2026-10-17'), 23);
  assert.equal(daysBetween('2026-10-17', '2026-10-17'), 0);
  assert.equal(daysBetween('2026-10-17', '2026-10-10'), -7);
});

test('ISO week and GMT offset', async () => {
  const { isoWeek, gmtOffset } = await import('../app/js/lib/time.js');
  assert.equal(isoWeek(new Date('2026-10-10T06:00:00Z'), TZ), 41);
  assert.equal(isoWeek(new Date('2026-10-17T06:00:00Z'), TZ), 42);
  assert.equal(isoWeek(new Date('2026-01-01T06:00:00Z'), TZ), 1);
  assert.equal(isoWeek(new Date('2027-01-01T06:00:00Z'), TZ), 53);
  assert.equal(gmtOffset(early, TZ), 'GMT+7');
});

test('clock times as stored ("HH:MM") and the moment they happen in a zone', async () => {
  const { formatHm, addMinutesHm, zonedTime, hmOf } = await import('../app/js/lib/time.js');
  assert.equal(formatHm('04:30'), '4:30 AM');
  assert.equal(formatHm('00:05'), '12:05 AM');
  assert.equal(formatHm('12:00'), '12:00 PM');
  assert.equal(formatHm('19:30'), '7:30 PM');
  assert.equal(formatHm('bad'), '');
  assert.equal(addMinutesHm('04:30', -30), '04:00');
  assert.equal(addMinutesHm('00:10', -30), '23:40');
  assert.equal(zonedTime('2026-10-19', '04:30', 'Asia/Ho_Chi_Minh'), Date.parse('2026-10-19T04:30:00+07:00'));
  assert.equal(zonedTime('2026-03-29', '04:30', 'Europe/Berlin'), Date.parse('2026-03-29T04:30:00+02:00'));
  assert.equal(zonedTime('2026-01-10', '23:15', 'America/New_York'), Date.parse('2026-01-10T23:15:00-05:00'));
  assert.equal(hmOf(new Date('2026-10-19T04:05:00+07:00'), 'Asia/Ho_Chi_Minh'), '04:05');
});
