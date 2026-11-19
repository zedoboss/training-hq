// Fri 11/20 (the nightly review of Thursday, his rule on unanswered asks): the Upper B check-in went out at 1:30 PM,
// then every 20 minutes until 8:10 PM, 21 times, the same words ("Upper B now" hours after 2:00 PM) with a push line
// ("Old you never skipped this", "Discipline. Now."). Now an unanswered check-in gets about 3 asks in all (the reminder
// and CHECKIN_CHECKS' follow-ups), further apart, each in new words, no push line; then quiet, and the session's
// "was due" asks don't take over. Answered but not trained: SESSION_DUE_CHECKS' few asks, then quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCandidates, nudgeDue, pickNudge, coachVoice, coachReminder, checkinAgainText, sessionDueText, CHECKIN_CHECKS, SESSION_DUE_CHECKS } from '../app/js/lib/nudges.js';
import { remindersFor } from '../app/js/lib/reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-01-20';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const areas = [{ kind: 'area', id: 'knees', label: 'Knees', phase: 'heal', holds: [{ exercise: 'Gym Hold', when: 'after Legs', where: 'gym' }], loadsArea: { exercises: [] } }];
const meta = { firstSessions: { pull: '2026-01-01', push: '2026-01-02', legs: '2026-01-03' } };
const last = { dayType: 'push', date: '2026-01-18', streak: 2 };
const legsDay = { today: { kind: 'train', dayType: 'legs' } };
// A bank that would add a push line to anything not calm.
const bank = { moods: { hype: { nudge: [[3, 'Discipline. Now.']] } } };

/** Today's check-in reminder for a 2:00 PM session (out at 1:30 PM), sent when it was due unless said otherwise. */
function checkin({ readiness = null, sentAt } = {}) {
  const days = { [D]: { date: D, sessionTime: '14:00', ...(readiness ? { readiness } : {}) } };
  const r = remindersFor({ tz: TZ, areas, table: { workingArea: { legs: ['L', 'B'] } }, meta, date: D, last, days }).find((i) => i.kind === 'readiness');
  return { ...r, sentAt: sentAt === undefined ? r.at : sentAt };
}

/** The nudge clock every 20 minutes (his setting), from..to: what went out about the check-in or the session. */
function replay(reminders, from, to) {
  const sent = {}; const out = []; let lastAt = 0;
  for (let now = at(from); now <= at(to); now += 60000) {
    if (!nudgeDue({ now, everyMin: 20, lastNudgeAt: lastAt })) continue;
    const pick = pickNudge(nudgeCandidates({ tz: TZ, rot: legsDay, sessionHm: '14:00', wakeHm: '07:00', bedHm: '22:00', reminders, now, sent }), sent, now);
    if (!pick) continue;
    sent[pick.key] = now; lastAt = now;
    out.push({ at: hmOf(now), key: pick.key, text: pick.text, body: coachVoice(pick.text, { bank, calm: pick.calm, rng: () => 0 }).body });
  }
  return out;
}

test('his Thursday replayed: never answered, 2 follow-ups after the 1:30 PM check-in, further apart, then quiet', () => {
  const r = checkin();
  assert.equal(hmOf(r.at), '13:30');
  const asks = replay([r], '13:30', '22:00').filter((x) => /^checkin:|^session:due:/.test(x.key));
  assert.deepEqual(asks.map((x) => x.at), ['14:15', '16:00'], 'two follow-ups, the second further from the first');
  assert.deepEqual(asks.map((x) => x.key), [`checkin:readiness-${D}:0`, `checkin:readiness-${D}:1`]);
  assert.equal(new Set(asks.map((x) => x.text)).size, 2, 'new words each time');
  for (const x of asks) {
    assert.doesNotMatch(x.text, /Sore, or good to go\?|Legs now/, 'not the reminder again');
    assert.equal(x.body, x.text, 'no push line');
  }
  assert.equal(asks[0].text, "Haven't heard back on your check-in, and Legs was due at 2:00 PM. Knees, legs, back: soreness or pain from 0 (none) to 3 (bad). Energy from 0 (drained) to 3 (high)?");
  assert.equal(asks[1].text, "Last ask on today's check-in. Legs later, a new time, or skipping it today?");
});

test('the check-in reminder itself has no push line either', () => {
  assert.equal(coachVoice('Go now.', { bank, rng: () => 0 }).body, 'Go now. Discipline. Now.', 'the bank does add one when not calm');
  const r = checkin();
  assert.equal(r.calm, true);
  const v = coachReminder(r, { bank, rng: () => 0 });
  assert.doesNotMatch(v.body, /Discipline/);
  assert.match(v.body, /^Sore, or good to go\? Legs at 2:00 PM/);
});

test('before the session time the first follow-up names the session, not a passed time', () => {
  const r = checkin();
  assert.match(checkinAgainText(0, r, at('13:50')), /^Haven't heard back on your check-in for Legs\. /);
  assert.equal(checkinAgainText(2, r, at('20:00')), null, 'nothing after the last');
  assert.equal(CHECKIN_CHECKS.afterMin.length, 2, 'three asks in all with the reminder');
  assert.ok(CHECKIN_CHECKS.afterMin[1] - CHECKIN_CHECKS.afterMin[0] > CHECKIN_CHECKS.afterMin[0], 'further apart');
});

test('the Mac asleep through the first follow-up: only the last one, once', () => {
  const r = checkin();
  const c = (now, sent = {}) => nudgeCandidates({ tz: TZ, rot: legsDay, sessionHm: '14:00', bedHm: '22:00', reminders: [r], now, sent }).filter((x) => /^checkin:|^session:due:/.test(x.key));
  assert.deepEqual(c(at('17:00')).map((x) => x.key), [`checkin:readiness-${D}:1`]);
  // Sent: never again that day (gap of 18 hours), and no "was due" after it.
  const sent = { [`checkin:readiness-${D}:1`]: at('17:00') };
  for (const hm of ['17:20', '18:00', '19:00', '21:00']) assert.equal(pickNudge(c(at(hm), sent), sent, at(hm)), null, hm);
});

test('answered the check-in, never started: two "was due" asks, 90+ minutes apart, new words, then quiet', () => {
  const r = checkin({ readiness: { at: at('13:40') } });
  assert.equal(r.due, false);
  const asks = replay([r], '13:30', '22:00').filter((x) => /^checkin:|^session:due:/.test(x.key));
  assert.deepEqual(asks.map((x) => x.key), [`session:due:${D}:0`, `session:due:${D}:1`]);
  assert.deepEqual(asks.map((x) => x.at), ['14:00', '15:30']);
  assert.match(asks[0].text, /^Legs was due at 2:00 PM\. Go now, or tell me the new time\./);
  assert.equal(asks[1].text, 'Last check on Legs today: going later, a new time, or skipping it?');
  assert.equal(sessionDueText(SESSION_DUE_CHECKS.count, 'Legs', '14:00'), null);
});

test('no check-in reminder went out (time set too late): the "was due" asks speak, still only two', () => {
  const asks = replay([], '14:00', '22:00').filter((x) => /^checkin:|^session:due:/.test(x.key));
  assert.equal(asks.length, 2);
});

test('started the workout: nothing about the check-in or the session', () => {
  const r = { ...checkin(), due: false };
  const c = nudgeCandidates({ tz: TZ, rot: legsDay, sessionHm: '14:00', bedHm: '22:00', reminders: [r], session: { started: true }, now: at('15:00'), sent: {} });
  assert.equal(c.filter((x) => /^checkin:|^session/.test(x.key)).length, 0);
});

test('never said when due (his own reminder said it): the first nudge is the check-in itself, then 2 follow-ups from it', () => {
  const r = { ...checkin(), unsaid: true };
  const c = (now, sent) => nudgeCandidates({ tz: TZ, rot: legsDay, sessionHm: '14:00', bedHm: '22:00', reminders: [r], now, sent }).filter((x) => /^checkin:/.test(x.key));
  const first = c(at('14:20'), {});
  assert.deepEqual(first.map((x) => x.key), [`checkin:readiness-${D}:said`]);
  assert.match(first[0].text, /^Sore, or good to go\? Legs now, week 3 column\. Knees, legs, back: soreness or pain, 0 = none, 3 = bad\./);
  assert.equal(first[0].calm, true);
  const sent = { [`checkin:readiness-${D}:said`]: at('14:20') };
  assert.equal(c(at('15:00'), sent).length, 0, 'nothing till 45 minutes after it');
  assert.deepEqual(c(at('15:05'), sent).map((x) => x.key), [`checkin:readiness-${D}:0`]);
  assert.deepEqual(c(at('16:50'), sent).map((x) => x.key), [`checkin:readiness-${D}:1`]);
});
