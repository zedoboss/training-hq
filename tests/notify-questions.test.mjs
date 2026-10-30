// Thu 10/22, 4:54 PM (his words: "all logs obv wrong"): "Reminder. 4:40 PM. Started cooking? Are you going to let your
// future self be weaker? Move." and, while he was already cooking, "Back from the walk? How many minutes did you go?
// You got this. Move!". A push line never follows a question; his own reminders come as written; the walk question
// stops once he's shown he's home. And the backup calendar keeps when the iPhone last fetched it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coachVoice, coachReminder } from '../app/js/lib/nudges.js';
import { walkDue, withAnswer, emptyWalk } from '../app/js/lib/walks.js';
import { openStore } from '../server/store.mjs';
import { homeSince } from '../server/notify.mjs';
import { openCalendar, FETCHED } from '../server/calendar.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const bank = { moods: { hype: { nudge: [[3, 'You got this. Move!']] } } };
const fixed = () => 0;

test('a push line follows a call to act, never a question to him', () => {
  assert.equal(coachVoice('Legs was due at 6:00 AM. Go now.', { bank, rng: fixed }).body, 'Legs was due at 6:00 AM. Go now. You got this. Move!');
  assert.equal(coachVoice('Last meal: cooking yet? Cooking, eaten, or skipping?', { bank, rng: fixed }).body, 'Last meal: cooking yet? Cooking, eaten, or skipping?');
  assert.equal(coachVoice('Back from the walk? How many minutes did you go? ', { bank, rng: fixed }).body, 'Back from the walk? How many minutes did you go?');
});

test('a reminder the coach set for him comes in its own words: no "Reminder." in front, no push line', () => {
  const item = { id: 'coach:r1', kind: 'coach', title: 'Reminder', body: '4:40 PM. Started cooking?' };
  assert.deepEqual(coachReminder(item, { bank, rng: fixed }), { title: 'Coach', body: '4:40 PM. Started cooking?' });
  assert.deepEqual(coachReminder({ ...item, body: 'Buy water while you are out.' }, { bank, rng: fixed }), { title: 'Coach', body: 'Buy water while you are out.' });
  // The app's own planned reminders keep their title and the line.
  assert.equal(coachReminder({ id: 'holds-evening', kind: 'holds', title: 'Evening holds', body: 'Knees: three holds.' }, { bank, rng: fixed }).body, 'Evening holds. Knees: three holds. You got this. Move!');
});

test('out walking: no "Back from the walk?" once he has said he is cooking, eaten or started a workout since', () => {
  const doc = withAnswer(emptyWalk(D), D, { action: 'going' }, at('16:12'));
  const base = { tz: TZ, goal: 8000, wakeHm: '08:00', bedHm: '23:30', doc, steps: { steps: 4508, asOf: at('16:47') } };
  assert.equal(walkDue({ ...base, now: at('16:54') }).kind, 'back', 'nothing since: the question comes');
  assert.equal(walkDue({ ...base, now: at('16:54'), homeAt: at('16:51') }), null, 'he said cooking at 4:51 PM');
  assert.equal(walkDue({ ...base, now: at('16:54'), homeAt: at('16:00') }).kind, 'back', 'something before he went out does not count');
  const dir = mkdtempSync(join(tmpdir(), 'thq-home-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('meal-checks', `${D}.1630`, { id: `${D}.1630`, date: D, slot: '16:30', answer: 'cooking', at: at('16:51') });
    store.writeLocal('meal-checks', `${D}.1230`, { id: `${D}.1230`, date: D, slot: '12:30', answer: 'skipped', at: at('16:52') });
    store.writeLocal('meals', 'm0', { id: 'm0', date: D, at: at('13:15'), name: 'Breakfast' });
    assert.equal(homeSince(store, at('16:12')), at('16:51'), 'a skip says nothing about where he is; an earlier meal is before the walk');
    assert.equal(homeSince(store, at('17:00')), 0);
    store.writeLocal('sessions', 'w', { id: 'w', kind: 'workout', startedAt: at('17:05') });
    assert.equal(homeSince(store, at('17:00')), at('17:05'));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the backup calendar keeps when it was last fetched, and by what', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-calfetch-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let clock = at('16:00');
    const cal = openCalendar({ store, tz: TZ, now: () => clock });
    const k = new URL(cal.link().path, 'http://x').searchParams.get('k');
    cal.ics(k, { agent: 'iOS/26.0 (23A341) dataaccessd/1.0' });
    clock = at('16:15');
    cal.ics(k, { agent: 'iOS/26.0 (23A341) dataaccessd/1.0' });
    assert.deepEqual(store.getMeta(FETCHED), { at: at('16:15'), agent: 'iOS/26.0 (23A341) dataaccessd/1.0', count: 2 });
    assert.throws(() => cal.ics('nope'));
    assert.equal(store.getMeta(FETCHED).count, 2, 'a wrong link is not a fetch');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
