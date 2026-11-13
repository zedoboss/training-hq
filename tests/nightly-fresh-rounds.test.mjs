// Fri 11/13 (the nightly review, about Thu 11/12): the night's morning text was written at 6:32 AM, held, and went out at
// 11:46 AM saying "Knee round before you leave, another before bed." He had logged the morning round 7:30 to 7:36 AM and
// was out. Now the text is rebuilt from today's records when it goes out: rounds already logged are dropped and only
// what's still due is named.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { snapshot } from '../server/coach/shared.mjs';
import { openNightly, freshRounds, DIARY } from '../server/coach/nightly.mjs';

const TZ = 'UTC';
const D = (day, h, m = 0) => Date.UTC(2026, 10, day, h, m); // 11/12 Thursday, 11/13 Friday
const NIGHT = 'Knee round before you leave, another before bed. Friday: Upper A with the bench hold on 10 kg dumbbells, run at 6 PM. Readiness table still needs your 2-min OK before Friday\'s check-in.';
let dir; let store;
const w = (col, id, data) => store.writeLocal(col, id, data);
const round = (id, area, day, from, to, extra = {}) => {
  w('sessions', id, { id, kind: 'holds', area, title: `${area} holds`, startedAt: D(day, ...from), endedAt: D(day, ...to), status: 'done', exercises: [{ key: 'k', name: area === 'knees' ? 'Toes Wall Squat Hold' : 'Wrist Hold', type: 'duration' }], ...extra });
  for (let i = 1; i <= 3; i++) w('sets', `${id}s${i}`, { id: `${id}s${i}`, sessionId: id, exKey: 'k', order: i, type: 'hold', durationS: 30, done: true, doneAt: D(day, to[0], to[1]) - (3 - i) * 120000, pain: 0 });
};
const snap = (now) => snapshot(store, { tz: TZ, now });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-freshrounds-'));
  store = openStore(join(dir, 'db.sqlite'));
  w('settings', 'main', { notify: { movingDay: false, holdsMorning: '06:35', holdsEvening: '20:30' } });
  w('tendons', 'area.knees', { kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Toes Wall Squat Hold', type: 'hold', load: 'bodyweight', sets: 3, seconds: 30, where: 'home' }] });
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test('his Thursday: the 6:32 AM text goes out at 11:46 AM after his 7:30 AM round: only the evening round is named', async () => {
  round('am', 'knees', 12, [7, 30], [7, 36], { round: 'morning' });
  w(DIARY, '2026-11-11', { id: '2026-11-11', date: '2026-11-11', status: 'done', at: D(12, 6, 32), morning: NIGHT, fixes: [], facts: [] });
  w('coach-messages', 'u1', { id: 'u1', role: 'user', text: 'How have i been doing with the holds past few days', at: D(12, 7, 36), tz: TZ });
  const n = openNightly({ store, privateDir: dir, tz: () => TZ, now: () => D(12, 11, 46) });
  await n.morning(D(12, 11, 46));
  const sent = store.listRecords('coach-messages').map((r) => r.data).filter((m) => m?.kind === 'nightly');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'Knees: evening round still due today. Friday: Upper A with the bench hold on 10 kg dumbbells, run at 6 PM. Readiness table still needs your 2-min OK before Friday\'s check-in.');
  assert.doesNotMatch(sent[0].text, /before you leave/);
});

test('no round logged yet when it goes out: the text stays as written', () => {
  assert.equal(freshRounds(NIGHT, snap(D(12, 6, 40))), NIGHT);
  // A round from yesterday isn't today's.
  round('wed', 'knees', 11, [10, 0], [10, 6]);
  assert.equal(freshRounds(NIGHT, snap(D(12, 6, 40))), NIGHT);
});

test('both rounds logged: the round sentence is dropped, nothing named, the rest kept', () => {
  round('am', 'knees', 12, [7, 30], [7, 36]);
  round('pm', 'knees', 12, [12, 0], [12, 6]);
  assert.equal(freshRounds(NIGHT, snap(D(12, 12, 30))), 'Friday: Upper A with the bench hold on 10 kg dumbbells, run at 6 PM. Readiness table still needs your 2-min OK before Friday\'s check-in.');
});

test('sentences about another day and the bench hold of a workout are kept; plain "knee holds" is rebuilt', () => {
  round('am', 'knees', 12, [7, 30], [7, 36]);
  const text = 'Yesterday: knee holds 2/2. Knee holds twice today, not back to back. Shoulder holds after Upper A tomorrow. Friday: the bench hold on 10 kg dumbbells.';
  assert.equal(freshRounds(text, snap(D(12, 11, 46))), 'Yesterday: knee holds 2/2. Knees: evening round still due today. Shoulder holds after Upper A tomorrow. Friday: the bench hold on 10 kg dumbbells.');
});

test('two areas: only the area with a logged round is rebuilt; one sentence naming both names what is due for both', () => {
  w('tendons', 'area.wrists', { kind: 'area', id: 'wrists', label: 'Wrists', phase: 'heal', holds: [{ exercise: 'Wrist Hold', type: 'hold', load: 'bodyweight', sets: 3, seconds: 30, where: 'home' }] });
  round('am', 'knees', 12, [7, 30], [7, 36]);
  assert.equal(freshRounds('Knee round before you leave. Wrist round before you leave too.', snap(D(12, 11, 46))),
    'Knees: evening round still due today. Wrist round before you leave too.');
  assert.equal(freshRounds('Knee and wrist rounds before you leave, again before bed.', snap(D(12, 11, 46))),
    'Knees: evening round still due today. Wrists: morning and evening rounds still due today.');
});

test('no tendon areas, or no text: untouched', () => {
  store.writeLocal('tendons', 'area.knees', { kind: 'other', id: 'knees' });
  assert.equal(freshRounds(NIGHT, snap(D(12, 11, 46))), NIGHT);
  assert.equal(freshRounds('', snap(D(12, 11, 46))), '');
});
