import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatTimeSec, formatDay, weekdayShort, isoDate, daysBetween } from '../app/js/lib/time.js';

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
  assert.equal(weekdayShort(early, TZ), 'SAT');
  assert.equal(isoDate(early, TZ), '2026-10-17');
});

test('day arithmetic', () => {
  assert.equal(daysBetween('2026-09-24', '2026-10-17'), 23);
  assert.equal(daysBetween('2026-10-17', '2026-10-17'), 0);
  assert.equal(daysBetween('2026-10-17', '2026-10-10'), -7);
});
