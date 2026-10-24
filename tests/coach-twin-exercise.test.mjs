// Sat 10/24, his words: "I don't see a note on the cupping hold, add it there." Cupping was on his Pull card twice
// (rep sets, then the hold after Back Extension); correct_set always found the first and its note replaced the note on
// a rep set. Now the coach picks the right one (occurrence, or a hold), finds a one-arm set by round and arm, adds a
// set he did that was never logged, and a note is added to the one there, never replacing it. Made-up numbers.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { addNote } from '../server/coach/tools-write.mjs';
import { armOf } from '../app/js/lib/session.js';

const at = (hm) => Date.parse(`2026-03-17T${hm}:00Z`);
let dir; let store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-twin-')); store = openStore(join(dir, 'db.sqlite')); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const EXS = [{ key: 'c1', name: 'Cupping', type: 'weight_reps', notes: 'desna pa leva' }, { key: 'b', name: 'Back Extension', type: 'weight_reps' }, { key: 'c2', name: 'Cupping', type: 'weight_reps', notes: '' }];
function card(status) {
  store.writeLocal('sessions', 'p', { id: 'p', kind: 'workout', title: 'Pull', dayType: 'pull', startedAt: at('15:00'), endedAt: status === 'done' ? at('16:40') : null, pausedMs: 0, status, exercises: EXS });
  const put = (id, x) => store.writeLocal('sets', id, { id, sessionId: 'p', done: true, doneAt: at('16:00') + x.order * 60000, rpe: null, note: '', ...x });
  [0, 1, 2, 3].forEach((i) => put(`r${i}`, { exKey: 'c1', order: i, type: 'normal', kg: 9, reps: 15, note: i === 3 ? 'Round 2: no pain.' : '' }));
  put('b0', { exKey: 'b', order: 4, type: 'normal', kg: 5, reps: 12 });
  [0, 1, 2].forEach((i) => put(`h${i}`, { exKey: 'c2', order: 5 + i, type: 'hold', kg: 9, durationS: 30, note: i === 2 ? 'his own note' : '' }));
}
const ctx = (now = at('16:45')) => ({ store, tz: 'UTC', now: () => now, action: () => {} });
const fix = async (args) => { const r = await TOOLS.find((t) => t.name === 'correct_set').run(args, ctx()); return typeof r === 'string' ? r : r.text; };
const set = (id) => store.getRecord('sets', id)?.data;

test('addNote: added to the note there, never replacing it; no doubles', () => {
  assert.equal(addNote('', 'Left arm hurt.'), 'Left arm hurt.');
  assert.equal(addNote('Round 2: no pain.', 'Left arm hurt.'), 'Round 2: no pain. Left arm hurt.');
  assert.equal(addNote('his note', 'Left arm hurt.'), 'his note. Left arm hurt.');
  assert.equal(addNote('his note', 'his note'), 'his note');
  assert.equal(addNote('his note', 'his note. More.'), 'his note. More.');
  assert.equal(addNote('his note', ''), 'his note');
});

test('Cupping twice on a finished card: the name alone asks which; nothing is written', async () => {
  card('done');
  const t = await fix({ exercise: 'Cupping', note: 'Left arm hurt 3-4/10.' });
  assert.match(t, /on the card 2 times: occurrence 1 = Cupping \(4 rep sets\); occurrence 2 = Cupping \(3 holds\)/);
  assert.equal(set('r3').note, 'Round 2: no pain.');
  assert.equal(set('h2').note, 'his own note');
});

test('the hold by round and arm; a missing left arm is refused unless add: true, then logged ticked with the note', async () => {
  card('done');
  assert.match(await fix({ exercise: 'cupping hold', round: 2, arm: 'left', note: 'x' }), /no round 2, left arm of the holds\. If he did it, add: true logs it/);
  const t = await fix({ exercise: 'Cupping', type: 'hold', round: 2, arm: 'left', add: true, note: 'No support from the other hand on either arm, left arm hurt 3-4/10.' });
  assert.match(t, /Added to Pull \(finished\): Cupping round 2, left arm, hold 30 s at 9 kg, ticked, note: "No support/);
  const holds = store.listRecords('sets').map((r) => r.data).filter((x) => x.exKey === 'c2').sort((a, b) => a.order - b.order);
  assert.equal(holds.length, 4);
  const added = holds.at(-1);
  assert.equal(added.done, true); assert.equal(added.type, 'hold'); assert.equal(added.kg, 9); assert.equal(added.durationS, 30);
  assert.deepEqual(armOf(holds, added), { round: 2, arm: 'left' });
  // The rep sets and their notes are untouched.
  assert.equal(set('r3').note, 'Round 2: no pain.');
  // Asking again with add: true notes the set that is there now; the note is added, not doubled or replaced.
  await fix({ exercise: 'Cupping', occurrence: 2, round: 2, arm: 'left', add: true, note: 'Asked at 4:40 PM.' });
  assert.equal(store.listRecords('sets').map((r) => r.data).filter((x) => x.exKey === 'c2').length, 4);
  assert.equal(store.getRecord('sets', added.id).data.note, 'No support from the other hand on either arm, left arm hurt 3-4/10. Asked at 4:40 PM.');
});

test('a note on a set that has one is added to it; replace_note only when asked; occurrence 1 is the rep sets', async () => {
  card('done');
  const t = await fix({ exercise: 'Cupping', occurrence: 2, round: 2, arm: 'right', note: 'Left arm hurt.' });
  assert.match(t, /Cupping set 3 \(round 2, right arm\)/);
  assert.match(t, /added to the note already there/);
  assert.equal(set('h2').note, 'his own note. Left arm hurt.');
  await fix({ exercise: 'Cupping', occurrence: 1, set: 4, note: 'Elbow fine.' });
  assert.equal(set('r3').note, 'Round 2: no pain. Elbow fine.');
  await fix({ exercise: 'Cupping', occurrence: 1, set: 4, note: 'Round 2: no pain.', replace_note: true });
  assert.equal(set('r3').note, 'Round 2: no pain.');
  assert.match(await fix({ exercise: 'Cupping', occurrence: 3, note: 'x' }), /on the card 2 times/);
  // "cupping reps" picks the rep sets.
  await fix({ exercise: 'cupping reps', set: 1, note: 'first' });
  assert.equal(set('r0').note, 'first');
});

test('add: true never skips a set: round 3 left with round 2 left missing is refused', async () => {
  card('done');
  assert.match(await fix({ exercise: 'Cupping', type: 'hold', round: 3, arm: 'left', add: true }), /would skip 2 sets before it/);
  assert.equal(store.listRecords('sets').map((r) => r.data).filter((x) => x.exKey === 'c2').length, 3);
});

test('log_set during the workout: "Cupping" goes to the one with sets left; type hold picks the hold', async () => {
  card('active');
  store.writeLocal('sets', 'h3', { id: 'h3', sessionId: 'p', exKey: 'c2', order: 8, type: 'hold', kg: 9, durationS: 30, done: false, note: '' });
  const log = TOOLS.find((t) => t.name === 'log_set');
  const r = await log.run({ exercise: 'Cupping', seconds: 30, note: 'left arm hurt' }, ctx());
  assert.match(r.text, /Logged Cupping, set 4 of 4/);
  assert.equal(set('h3').done, true);
  assert.equal(set('h3').note, 'left arm hurt');
  assert.equal(set('r3').note, 'Round 2: no pain.');
});
