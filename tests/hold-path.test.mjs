// Hold paths (Thu 10/22, his answers: 2 quiet Push days per stage, the app asks and he confirms, incline after flat,
// the new stage replaces the hold before it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathState, movePath, pathsOf, stageText } from '../app/js/lib/hold-path.js';
import { remindersFor } from '../app/js/lib/reminders.js';

const TZ = 'Asia/Bangkok';
const at = (d, hm = '10:00') => Date.parse(`${d}T${hm}:00+07:00`);
const dayOf = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
const path = {
  name: 'Bench hold path', passDays: 2,
  stages: [
    { label: 'Flat Smith', exercise: 'Bench Press (Smith Machine)', loadKg: 30 },
    { label: 'Flat dumbbells', exercise: 'Bench Press (Dumbbell)', loadKg: 20, loadNote: '2 × 10 kg' },
    { label: 'Flat barbell', exercise: 'Bench Press (Barbell)', loadKg: 20 },
  ],
};
const area = { kind: 'area', id: 'shoulder', label: 'Shoulder', phase: 'fix', holds: [{ exercise: 'Bench Press (Smith Machine)', loadKg: 30, path }] };
const push = (d) => ({ id: `w${d}`, kind: 'workout', dayType: 'push', status: 'done', startedAt: at(d, '09:00') });
const round = (d, name, pains) => ({
  session: { id: `h${d}`, kind: 'holds', area: 'shoulder', status: 'done', startedAt: at(d, '10:30'), exercises: [{ key: 'k', name }] },
  sets: pains.map((pain, i) => ({ id: `s${d}${i}`, sessionId: `h${d}`, exKey: 'k', type: 'hold', durationS: 30, done: true, pain })),
});

test('not started: nothing counts and nothing is asked; Start puts him on the first stage from today', () => {
  const st = pathState({ hold: area.holds[0], area, dayOf });
  assert.deepEqual([st.started, st.ready, st.stage.label], [false, false, 'Flat Smith']);
  const h = movePath(area.holds[0], 'start', '2026-03-10');
  assert.deepEqual([h.path.at, h.path.since, h.exercise], [0, '2026-03-10', 'Bench Press (Smith Machine)']);
});

test('two quiet Push days at a stage make it ready; a set over 4/10, a rest-day round or another stage does not count', () => {
  const hold = movePath(area.holds[0], 'start', '2026-03-10');
  const r1 = round('2026-03-11', 'Bench Press (Smith Machine)', [0, 2, 3]);
  const r2 = round('2026-03-13', 'Bench Press (Smith Machine)', [1, 5, 2]); // over his limit
  const r3 = round('2026-03-14', 'Bench Press (Smith Machine)', [0, 0, 0]); // a rest day: no Push that day
  const sessions = [push('2026-03-11'), push('2026-03-13'), r1.session, r2.session, r3.session];
  const sets = [...r1.sets, ...r2.sets, ...r3.sets];
  let st = pathState({ hold: { ...hold, path: hold.path }, area, sessions, sets, dayOf });
  assert.deepEqual([st.quietDays, st.ready], [['2026-03-11'], false]);
  const r4 = round('2026-03-15', 'Bench Press (Smith Machine)', [2, 2, 3]);
  st = pathState({ hold, area, sessions: [...sessions, push('2026-03-15'), r4.session], sets: [...sets, ...r4.sets], dayOf });
  assert.deepEqual([st.quietDays, st.ready, st.next.label], [['2026-03-11', '2026-03-15'], true, 'Flat dumbbells']);
  // The morning after: asked (and every morning until he answers); not on the day itself.
  const paths = pathsOf({ areas: [{ ...area, holds: [hold] }], sessions: [...sessions, push('2026-03-15'), r4.session], sets: [...sets, ...r4.sets], dayOf });
  const ask = (date) => remindersFor({ date, tz: TZ, last: null, paths }).find((i) => i.id.startsWith('hold-path:'));
  assert.equal(ask('2026-03-15'), undefined);
  const a = ask('2026-03-16');
  assert.equal(a.title, 'Shoulder: ready for flat dumbbells?');
  assert.equal(a.body, '2 quiet Push days on Flat Smith. Not worse this morning? Step up on Holds, or tell me.');
  // Not yet: one more quiet Push day first.
  const later = movePath(hold, 'not-yet', '2026-03-16');
  assert.equal(pathState({ hold: later, area, sessions: [...sessions, push('2026-03-15'), r4.session], sets: [...sets, ...r4.sets], dayOf }).ready, false);
});

test('step up replaces the hold with the next stage and counts from that day; back goes one stage back', () => {
  const up = movePath(movePath(area.holds[0], 'start', '2026-03-10'), 'up', '2026-03-16');
  assert.deepEqual([up.exercise, up.loadKg, up.loadNote, up.path.at, up.path.since], ['Bench Press (Dumbbell)', 20, '2 × 10 kg', 1, '2026-03-16']);
  assert.equal(stageText(up.path, up.path.at), 'Stage 2 of 3: Flat dumbbells (20 kg)');
  // A Smith round after the step up is not this stage.
  const r = round('2026-03-17', 'Bench Press (Smith Machine)', [0, 0, 0]);
  assert.deepEqual(pathState({ hold: up, area, sessions: [push('2026-03-17'), r.session], sets: r.sets, dayOf }).quietDays, []);
  const back = movePath(up, 'back', '2026-03-18');
  assert.deepEqual([back.exercise, back.path.at], ['Bench Press (Smith Machine)', 0]);
  assert.deepEqual(back.path.log.map((x) => x.how), ['start', 'up', 'back']);
});
