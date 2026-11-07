// Sat 11/7, his words: "I just did the first round of holds. And then I came here to this chat to talk with the coach...
// I went back and it said that they are done, which they're not done." Leaving the hold timer mid-round never makes the
// round done; coming back to the timer picks up at the next hold; the round counts once all its holds are saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roundsByDate, roundSetsLeft, openRoundFor, holdSlots } from '../app/js/lib/holds.js';

const TZ = 'Asia/Ho_Chi_Minh';
process.env.TZ = TZ; // morning/evening and the day are the phone's own
const D = '2026-03-14';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const knees = { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', where: 'home', sets: 3, seconds: 30 }] };
const wrist = { kind: 'area', id: 'wrist', label: 'Wrist', phase: 'heal', holds: [{ exercise: 'Cupping', sides: ['Right arm', 'Left arm'] }] };
const areas = [knees, wrist];
const round = (id, hm, extra = {}) => ({ id, kind: 'holds', area: 'knees', status: 'active', startedAt: at(hm), round: Number(hm.slice(0, 2)) < 12 ? 'morning' : 'evening', exercises: [{ key: 'k', name: 'Toes Wall Squat Hold' }], ...extra });
const set = (sessionId, order, hm, extra = {}) => ({ id: `${sessionId}.${order}`, sessionId, exKey: 'k', order, type: 'hold', durationS: 30, done: true, doneAt: at(hm), pain: 1, ...extra });

test('his 9:41 AM round: 1 of 3 saved and the timer left: not done, 2 holds to go', () => {
  const s = round('r', '09:41');
  const sets = [set('r', 1, '09:41')];
  assert.equal(roundSetsLeft(s, sets, areas), 2);
  assert.deepEqual(roundsByDate(areas, [s], sets).knees, {});
  // The Holds screen's morning slot stays open (Start, not DONE).
  const rounds = roundsByDate(areas, [s], sets);
  const slots = holdSlots({ areas: [knees], dayKind: 'rest', dayType: null, roundsToday: { knees: rounds.knees[D] || 0 }, times: { morning: '09:30', evening: '20:00' } });
  assert.ok(slots.filter((x) => x.area === 'knees').length >= 1);
  assert.equal(slots.find((x) => x.area === 'knees' && x.slot === 'morning')?.done, false);
});

test('2 of 3: still open; all 3 saved: one round, open or closed', () => {
  const s = round('r', '09:41');
  assert.deepEqual(roundsByDate(areas, [s], [set('r', 1, '09:41'), set('r', 2, '09:50')]).knees, {});
  const all = [1, 2, 3].map((n) => set('r', n, '09:5' + n));
  assert.equal(roundsByDate(areas, [s], all).knees[D], 1);
  assert.equal(roundsByDate(areas, [{ ...s, status: 'done' }], all).knees[D], 1);
  // A round he ended himself with End round still counts as he chose.
  assert.equal(roundsByDate(areas, [{ ...s, status: 'done' }], all.slice(0, 1)).knees[D], 1);
});

test('a hold of 2 sets needs 2; an arm-by-arm hold needs every arm of every set', () => {
  const two = [{ ...knees, holds: [{ ...knees.holds[0], sets: 2 }] }];
  const s = round('r', '09:41');
  assert.equal(roundsByDate(two, [s], [set('r', 1, '09:41'), set('r', 2, '09:45')]).knees[D], 1);
  const c = { id: 'c', kind: 'holds', area: 'wrist', status: 'active', startedAt: at('09:00'), exercises: [{ key: 'k', name: 'Cupping' }] };
  const arms = [1, 1.1, 2, 2.1, 3].map((o) => set('c', o, '09:10'));
  assert.equal(roundSetsLeft(c, arms, areas), 1);
  assert.deepEqual(roundsByDate(areas, [c], arms).wrist, {});
  assert.equal(roundsByDate(areas, [c], [...arms, set('c', 3.1, '09:20')]).wrist[D], 1);
});

test('back on the timer: it picks up at the next hold of the open round', () => {
  const s = round('r', '09:41');
  const o = openRoundFor([s], [set('r', 1, '09:41')], 'knees', 'Toes Wall Squat Hold', { now: at('09:46') });
  assert.equal(o.session.id, 'r');
  assert.equal(o.nextSet, 2);
  assert.equal(openRoundFor([s], [set('r', 1, '09:41'), set('r', 2, '09:50')], 'knees', 'Toes Wall Squat Hold', { now: at('09:55') }).nextSet, 3);
  // Arm by arm: set 2's left arm not saved yet: set 2 again.
  const c = { id: 'c', kind: 'holds', area: 'wrist', status: 'active', startedAt: at('09:00'), exercises: [{ key: 'k', name: 'Cupping' }] };
  assert.equal(openRoundFor([c], [1, 1.1, 2].map((x) => set('c', x, '09:10')), 'wrist', 'Cupping', { now: at('09:20'), sides: 2 }).nextSet, 2);
});

test('no pick-up: a finished round, no holds saved, another hold, yesterday, or this morning\'s round in the evening', () => {
  const one = [set('r', 1, '09:41')];
  const name = 'Toes Wall Squat Hold';
  assert.equal(openRoundFor([round('r', '09:41', { status: 'done' })], one, 'knees', name, { now: at('09:46') }), null);
  assert.equal(openRoundFor([round('r', '09:41')], [], 'knees', name, { now: at('09:46') }), null);
  assert.equal(openRoundFor([round('r', '09:41')], one, 'knees', 'Wall Sit', { now: at('09:46') }), null);
  assert.equal(openRoundFor([round('r', '09:41')], one, 'wrist', name, { now: at('09:46') }), null);
  assert.equal(openRoundFor([round('r', '09:41')], one, 'knees', name, { now: at('09:46', '2026-03-15') }), null);
  assert.equal(openRoundFor([round('r', '09:41')], one, 'knees', name, { now: at('19:00') }), null);
  // The newest open round of the same morning wins.
  const o = openRoundFor([round('a', '09:00'), round('b', '09:41')], [set('a', 1, '09:01'), set('b', 1, '09:41'), set('b', 2, '09:44')], 'knees', name, { now: at('09:50') });
  assert.equal(o.session.id, 'b');
  assert.equal(o.nextSet, 3);
});

test('the hold timer screen carries on the open round instead of starting at set 1', () => {
  const src = readFileSync(new URL('../app/js/views/holds.js', import.meta.url), 'utf8');
  assert.match(src, /openRoundFor\(/);
  assert.match(src, /session = open\.session; setNo = open\.nextSet/);
});
