// Tue 11/10 after Push, his words: "When i finish last set last exercise there shouldnt be a timer with a skip Instead a
// finish button". Ticking the workout's last set starts no rest; the workout screen shows Finish instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restAfterSet, allTicked } from '../app/js/lib/session.js';
import { followRest } from '../app/js/lib/rest-follow.js';

const push = () => ([
  { key: 'bench', name: 'Bench Press (Smith Machine)', type: 'weight_reps' },
  { key: 'press', name: 'Shoulder Press (Machine)', type: 'weight_reps' },
  { key: 'lat', name: 'Lateral Raise (Dumbbell)', type: 'weight_reps' },
]);
const set = (id, exKey, order, done, type = 'normal') => ({ id, sessionId: 'w1', exKey, order, type, done, doneAt: done ? 1000 + order : null });
const allDone = () => [set('w', 'bench', 0, true, 'warmup'), set('b1', 'bench', 1, true), set('p1', 'press', 2, true), set('l1', 'lat', 3, true), set('l2', 'lat', 4, true), set('l3', 'lat', 5, true)];

test('his case: the last set of the last exercise ticked: no rest, every set ticked', () => {
  const ex = push(); const sets = allDone();
  assert.equal(restAfterSet(ex, sets, 'lat'), false);
  assert.equal(allTicked(ex, sets), true);
});

test('a set still to do anywhere (later set, next exercise, an earlier one left open, a warm-up) keeps the rest', () => {
  const ex = push();
  const open = (id) => allDone().map((x) => (x.id === id ? { ...x, done: false, doneAt: null } : x));
  assert.equal(restAfterSet(ex, open('l3'), 'lat'), true, 'set 3 of the lateral raise still to do');
  assert.equal(restAfterSet(ex, open('l1'), 'press'), true, 'next exercise still to do');
  assert.equal(restAfterSet(ex, open('b1'), 'lat'), true, 'an earlier exercise left open: still a rest, then that set');
  assert.equal(allTicked(ex, open('b1')), false);
  assert.equal(restAfterSet(ex, open('w'), 'lat'), true, 'a warm-up not ticked is still a set');
});

test('the rest exercises skipped count as done; a skipped exercise with open sets does not hold Finish back', () => {
  const ex = push().map((e) => (e.key === 'lat' ? { ...e, skipped: { at: 1, reason: 'shoulder' } } : e));
  const sets = allDone().map((x) => (x.exKey === 'lat' ? { ...x, done: false, doneAt: null } : x));
  assert.equal(restAfterSet(ex, sets, 'press'), false);
  assert.equal(allTicked(ex, sets), true);
});

test('mid-superset still never rests; an empty workout is not "every set ticked"', () => {
  const ex = push().map((e) => (e.key !== 'bench' ? { ...e, supersetId: 's1' } : e));
  const sets = allDone().map((x) => (x.exKey === 'lat' ? { ...x, done: false, doneAt: null } : x));
  assert.equal(restAfterSet(ex, sets, 'press'), false, 'press then lateral raise straight away');
  assert.equal(restAfterSet(ex, sets, 'lat'), true);
  assert.equal(allTicked(push(), []), false);
  assert.equal(allTicked([], []), false);
});

test('a rest already running when the last set is ticked (from the Mac or the coach) is ended, not retargeted', () => {
  const st = { endsAt: 9e12, label: 'Lateral Raise (Dumbbell)', next: 'Lateral Raise (Dumbbell): set 3', from: { sessionId: 'w1', exKey: 'lat' } };
  const session = { id: 'w1', status: 'active', kind: 'workout', exercises: push() };
  assert.deepEqual(followRest(st, [session], allDone()), { clear: true });
  const open = allDone().map((x) => (x.id === 'l3' ? { ...x, done: false, doneAt: null } : x));
  assert.ok(followRest(st, [session], open).next, 'a set left: the rest keeps going');
});

test('the workout screen: rest only via restAfterSet, a Finish bar to #/finish when every set is ticked, none when editing', () => {
  const src = readFileSync(new URL('../app/js/views/session.js', import.meta.url), 'utf8');
  assert.match(src, /restAfterSet\(session\.exercises, sets, ex\.key\)\) \{ rest\.start\(/);
  assert.doesNotMatch(src, /restAfter\(session\.exercises, ex\.key\)\) \{ rest\.start\(/);
  assert.match(src, /id="s-done"[\s\S]{0,300}href="#\/finish\/\$\{esc\(session\.id\)\}">Finish<\/a>/);
  assert.match(src, /\$\{editing \? '' : `<section class="rest-bar done-bar" id="s-done"/);
  assert.match(src, /bar\.hidden = !allTicked\(session\.exercises, sets\) \|\| Boolean\(rest\.status\(\)\)/);
});
