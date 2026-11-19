// Fri 11/20, filed by the nightly review: Thu 11/19 6:59 AM the app said "Morning: Banana, bathroom, then stretch and get
// some sunlight. Coffee about 90 minutes after waking. Upper B at 1:00 PM...", though coffee came off his morning
// checklist on Thu 11/5 ("I don't drink coffee every day"). The checklist (settings.notify.morning.items) had changed;
// the morning nudge still read the old routine text. Now the nudge says his checklist when he has one. Made-up data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCandidates } from '../app/js/lib/nudges.js';
import { morningRoutineLine } from '../app/js/lib/morning.js';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-03-05';
const at = (hm) => Date.parse(`${D}T${hm}:00+07:00`);
const TEXT = 'Banana, bathroom, then stretch and get some sunlight. Coffee about 90 minutes after waking (after the Evolt on gym days)';
const base = { tz: TZ, rot: { today: { kind: 'train', dayType: 'upperB' } }, session: { started: false, done: false }, weighedToday: false,
  sleepLogged: true, wakeHm: '06:30', bedHm: '23:00', now: at('06:59'), wokeAt: at('06:30'), sessionHm: '13:00' };
const say = (morning, o = {}) => nudgeCandidates({ ...base, morning, ...o }).find((c) => c.key === 'morning')?.text;

test('his Thursday: checklist without coffee, old text with it: the morning nudge has no coffee', () => {
  const t = say({ text: TEXT, gymAfterMin: [60, 90], items: ['Banana', 'Bathroom', 'Stretch', 'Get some sunlight'] });
  assert.ok(t, 'the morning nudge still goes out');
  assert.match(t, /^Morning: Banana, bathroom, stretch, get some sunlight\./);
  assert.ok(!/coffee/i.test(t), t);
  assert.match(t, /at 1:00 PM\./, 'the session time stays');
});

test('no checklist of his own: the routine text as before (control)', () => {
  assert.match(say({ text: TEXT }), /^Morning: Banana, bathroom, then stretch and get some sunlight\. Coffee/);
});

test('an emptied checklist: no routine to say, no morning nudge', () => {
  assert.equal(say({ text: TEXT, items: [] }), undefined);
});

test('the line from his checklist: later items in lower case, names keep their capital', () => {
  assert.equal(morningRoutineLine({ items: ['Banana', 'Evolt scan', 'Get some sunlight'] }), 'Banana, Evolt scan, get some sunlight');
  assert.equal(morningRoutineLine({ items: ['Banana', 'Bathroom'], text: TEXT }), 'Banana, bathroom');
  assert.equal(morningRoutineLine({ text: TEXT + '.' }), TEXT);
  assert.equal(morningRoutineLine(null), null);
});
