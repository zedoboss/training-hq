// Wed 11/25, from Tuesday: Upper B ended 3:28 PM, the after-workout holds never started, and "Evolt scan? Do it before
// you leave the gym" came at 3:39 PM, 11 minutes later. Then "Evolt number from today? Tell me the weight (and body fat
// if you have it)." at 4:39, 5:19 and 6:19 PM, twice in the same words, with push lines ("Nobody's coming to do it for
// you.", "You got this. Move!"). His rule: the scan ask while he's still at the gym; then about 3 asks in all, further
// apart, new words each, no push line, then quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCandidates, pickNudge, coachVoice, EVOLT_CHECKS } from '../app/js/lib/nudges.js';
import { remindersFor, reminderState } from '../app/js/lib/reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
process.env.TZ = TZ;
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const tendons = [{ kind: 'area', id: 'wrist', label: 'Wrist', phase: 'fix', holds: [{ exercise: 'Cupping', timing: ['after Pull', 'after Legs'] }] }];
const scanPlan = { id: 'main', cadence: 'training' };
const pull = { id: 'w', kind: 'workout', status: 'done', dayType: 'pull', startedAt: at('14:44'), endedAt: at('15:28'), exercises: [{ key: 'a', name: 'Lat Pulldown (Cable)', exerciseId: 'lat-pulldown-cable' }] };
const sets = [{ sessionId: 'w', exKey: 'a', done: true }];
const planned = (extra = {}) => remindersFor({ date: D, ...reminderState({ sessions: [pull], sets, tendons, scanPlan, ...extra }, TZ) });

test('the scan ask comes a minute after the workout, not after holds he never started', () => {
  const ask = planned().find((r) => r.id === `scan-after:${D}`);
  assert.equal(ask.at, at('15:29'));
  assert.ok(ask.due);
  assert.equal(ask.body, 'Do it before you leave the gym, then add the results (photo or PDF).');
  assert.equal(planned().find((r) => r.id === `home:${D}`).at, at('15:54'), '"head home" keeps its time (the 10 minutes for holds he might start)');
});

const base = { tz: TZ, wakeHm: '04:00', bedHm: '20:30', sleepLogged: true, rot: { today: { kind: 'done', dayType: 'pull' } }, session: { started: true, done: true },
  workoutEndedAt: at('15:28'), weighedToday: false, eaten: { kcal: 3000, protein: 240 }, lastMealAt: at('15:50') };
const scanAsk = (sentAt) => ({ id: `scan-after:${D}`, kind: 'scan', at: at('15:29'), due: true, sentAt });

/** Every Evolt nudge from `from` to `to`, a tick a minute, as the Mac's nudge picker sends them. */
function run(o, from = '15:48', to = '20:00') {
  const sent = {};
  const out = [];
  for (let t = at(from); t <= at(to); t += 60000) {
    const c = nudgeCandidates({ ...base, ...o, now: t, sent }).filter((x) => x.key.startsWith('evolt'));
    const pick = pickNudge(c, sent, t);
    if (pick) { sent[pick.key] = t; out.push({ at: t, ...pick }); }
  }
  return out;
}

test('his Tuesday replayed: after the 3:29 PM reminder, two asks an hour and more apart, new words, calm, then quiet', () => {
  const out = run({ reminders: [scanAsk(at('15:29'))] });
  assert.deepEqual(out.map((x) => x.at), [at('15:29') + EVOLT_CHECKS.afterMin[0] * 60000, at('15:29') + EVOLT_CHECKS.afterMin[1] * 60000]);
  assert.deepEqual(out.map((x) => x.at), [at('16:29'), at('17:59')]);
  const words = out.map((x) => x.text);
  assert.equal(new Set(words).size, 2, words.join(' | '));
  assert.ok(words.every((w) => !/Evolt scan\? Do it before/.test(w) && !/Evolt number from today\?/.test(w)), 'not the reminder\'s words again');
  assert.match(words[1], /^Last ask/);
  for (const x of out) {
    assert.equal(x.calm, true);
    const bank = { lines: [{ text: "Nobody's coming to do it for you." }, { text: 'You got this. Move!' }] };
    assert.equal(coachVoice(x.text, { calm: x.calm, bank, intensity: 5, moods: { commander: 5 } }).body, x.text, 'no push line');
  }
});

test('no after-gym reminder (not a scan day in the planner): three asks in all, each its own words', () => {
  const out = run({ reminders: [] }, '15:48', '18:28');
  assert.deepEqual(out.map((x) => x.at), [at('15:48'), at('16:48'), at('18:18')]);
  assert.equal(new Set(out.map((x) => x.text)).size, 3);
  assert.equal(out[0].text, 'Evolt number from today? Tell me the weight (and body fat if you have it).');
});

test('the reminder still to go out: nothing before it; not sent within its half hour: the nudge asks once itself', () => {
  assert.equal(run({ reminders: [{ ...scanAsk(null), at: at('15:50') }] }, '15:48', '15:58').length, 0);
  const late = run({ reminders: [scanAsk(null)] }, '15:48', '16:10');
  assert.deepEqual(late.map((x) => [x.at, x.key]), [[at('15:59'), `evolt:${D}:said`]]);
  // Hushed (he'd gone quiet, the reminder counted but never said): the nudge's own first ask.
  assert.equal(run({ reminders: [{ ...scanAsk(at('15:29')), unsaid: true }] }, '16:00', '16:00')[0].key, `evolt:${D}:said`);
});

test('quiet once he gave a weight, while scans are paused, and 3 hours after the workout', () => {
  assert.equal(run({ reminders: [scanAsk(at('15:29'))], weighedToday: true }).length, 0);
  assert.equal(run({ reminders: [scanAsk(at('15:29'))], scanPaused: true }).length, 0);
  // A reminder held 40 minutes by a hold round: the last ask would fall past 3 hours, so only one more.
  const held = run({ reminders: [{ ...scanAsk(at('16:09')), at: at('16:09') }] }, '16:10');
  assert.deepEqual(held.map((x) => x.at), [at('17:09')]);
});
