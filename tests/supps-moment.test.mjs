// Thu 11/5, his words: "I just got informed about supplements. 4 out of 8 taken today... I literally just told it, not
// so long ago that I took 4 supplements, it should have ordered it differently. It could give me a suggestion when I
// should take them... magnesium, I should take it at the end, right before I sleep. So that shouldn't be even added
// here... the other ones, I'm probably going to take them after my second meal." At 7:18 AM, 24 minutes after he told
// the coach the 4 he took, "Supplements: 4 of 8 taken today. Still open: Magnesium bisglycinate, L-Carnitine
// L-Tartrate, Creatine monohydrate. Take them and tell me." Now each comes at its own moment and says what's next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checklist, nextSuppsText } from '../app/js/lib/supplements.js';
import { nudgeCandidates, SUPPS_AFTER_ANSWER_MIN } from '../app/js/lib/nudges.js';
import { suppReminders } from '../app/js/lib/fuel-reminders.js';
import { openStore } from '../server/store.mjs';
import { dishesTick, nudgeInputs, bedAtOf } from '../server/notify.mjs';

const TZ = 'Asia/Ho_Chi_Minh';
const D = '2026-01-20';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
const s = (id, name, short, extra = {}) => ({ id, kind: 'supplement', name, short, dose: '1', days: { type: 'daily' }, status: 'active', perTake: { train: 1, rest: 1 }, ...extra });
// His eight as he set them (7:31 AM): four after the first meal, three after the second, magnesium right before bed.
const HIS = [
  s('supp.c', 'Vitamin C', 'vitamin C', { order: 0, afterMeal: 'first' }),
  s('supp.d3', 'Vitamin D3 + K2 (MK-7)', 'D3 + K2', { order: 1, afterMeal: 'first' }),
  s('supp.mg', 'Magnesium bisglycinate', 'magnesium', { order: 2, atBed: true, dose: '375 mg', doseRest: '750 mg' }),
  s('supp.o3', 'Omega-3 fish oil', 'omega-3', { order: 3, afterMeal: 'first' }),
  s('supp.lclt', 'L-Carnitine L-Tartrate', 'carnitine', { order: 4, afterMeal: 'second' }),
  s('supp.cr', 'Creatine monohydrate', 'creatine', { order: 5, afterMeal: 'second' }),
  s('supp.col', 'Collagen peptides', 'collagen', { order: 6, afterMeal: 'second' }),
  s('supp.ash', 'Ashwagandha KSM-66', 'ashwagandha', { order: 7, afterMeal: 'first' }),
];
const took = (ids, hm) => ids.map((id) => ({ id: `${D}.${id}`, date: D, suppId: id, status: 'taken', at: at(D, hm) }));
const FIRST4 = ['supp.c', 'supp.d3', 'supp.o3', 'supp.ash'];

test('right before bed is its own group, after the meals; a time set on its page wins over it', () => {
  const g = checklist({ supps: HIS, log: took(FIRST4, '06:54'), date: D, dayKind: 'train' });
  assert.deepEqual(g.map((x) => x.label), ['After your first meal', 'After your second meal', 'Before bed']);
  assert.deepEqual(g.find((x) => x.bed).items.map((i) => i.dose), ['375 mg']);
  const timed = checklist({ supps: [s('supp.mg', 'Magnesium', 'magnesium', { atBed: true, time: '21:00' })], date: D, dayKind: 'train' });
  assert.equal(timed[0].bed, false);
  assert.equal(timed[0].time, '21:00');
  // Not in the evening round-up's "still open": it's asked at bedtime.
  assert.deepEqual(suppReminders({ date: D, tz: TZ, supps: HIS, log: took(FIRST4, '06:54') }).open, ['carnitine', 'creatine', 'collagen']);
});

test('what comes next, in the day\'s order, with when each is due', () => {
  const g = checklist({ supps: HIS, log: took(FIRST4, '06:54'), date: D, dayKind: 'train' });
  const bedAt = at(D, '23:38');
  assert.equal(nextSuppsText(g, { done: ['after-meal'], bedAt, tz: TZ }), 'Next: carnitine, creatine, collagen after your second meal; magnesium before bed, about 11:40 PM.');
  assert.equal(nextSuppsText(g, { done: ['after-meal', 'after-meal-2'], bedAt, tz: TZ }), 'Next: magnesium before bed, about 11:40 PM.');
  const all = checklist({ supps: HIS, log: took(HIS.map((x) => x.id), '22:00'), date: D, dayKind: 'train' });
  assert.equal(nextSuppsText(all, { done: [], bedAt, tz: TZ }), '', 'nothing open: nothing said');
  // A time of day only while it's still ahead.
  const t = checklist({ supps: [s('supp.x', 'Zinc', 'zinc', { time: '14:00' })], date: D, dayKind: 'train' });
  assert.equal(nextSuppsText(t, { nowHm: '09:00' }), 'Next: zinc at 2:00 PM.');
  assert.equal(nextSuppsText(t, { nowHm: '15:00' }), '');
});

test('his 7:18 AM: no "4 of 8, take the rest" right after he told me 4; the ones with no moment wait and say what\'s next', () => {
  const base = { tz: TZ, rot: null, wakeHm: '04:00', bedHm: '22:00', eaten: { kcal: 3000, protein: 230 }, targets: { kcal: 3174, protein: 242.5 } };
  // All of them with their own moment: nothing from the "no time set" nudge at all.
  assert.equal(nudgeCandidates({ ...base, now: at(D, '07:18'), suppsUntimed: null }).some((x) => x.key === 'supps-untimed'), false);
  // One left with no moment (vitamin C), his answer at 6:54 AM: not within SUPPS_AFTER_ANSWER_MIN of it.
  const next = 'Next: carnitine, creatine, collagen after your second meal; magnesium before bed, about 11:40 PM.';
  const suppsUntimed = { total: 8, taken: 4, open: ['Vitamin C'], lastAt: at(D, '06:54'), next };
  assert.equal(nudgeCandidates({ ...base, now: at(D, '07:18'), suppsUntimed }).some((x) => x.key === 'supps-untimed'), false);
  const c = nudgeCandidates({ ...base, now: at(D, '06:54') + SUPPS_AFTER_ANSWER_MIN * 60000, suppsUntimed }).find((x) => x.key === 'supps-untimed');
  assert.equal(c.text, `Vitamin C: still open today, and it has no set moment. Take it when it suits you, or tell me when you take it (after a meal, before bed) and I'll ask then. ${next}`);
  assert.doesNotMatch(c.text, /of 8|Take them and tell me/);
});

test('right before bed: about 30 minutes before his bedtime, once more after it if still open, then quiet', () => {
  const bedAt = at(D, '23:38');
  const base = { tz: TZ, rot: null, wakeHm: '04:00', bedHm: '23:38', suppsBed: { open: ['Magnesium bisglycinate 375 mg'], bedAt, dayKey: D } };
  const bed = (hm, o = {}) => nudgeCandidates({ ...base, ...o, now: at(D, hm) }).find((x) => x.key.startsWith('supps-bed:'));
  assert.equal(bed('07:18'), undefined, 'not in the morning');
  assert.equal(bed('23:07'), undefined);
  assert.equal(bed('23:08').key, `supps-bed:${D}:0`);
  assert.equal(bed('23:08').text, "Bedtime's about 11:40 PM. Right before you sleep: Magnesium bisglycinate 375 mg. Tell me when it's down.");
  assert.equal(bed('23:08').url, '#/supps');
  assert.equal(nudgeCandidates({ ...base, now: at('2026-01-21', '00:08') }).find((x) => x.key.startsWith('supps-bed:')).text,
    'Magnesium bisglycinate 375 mg still open. Take it right before you sleep, then tell me.');
  assert.equal(nudgeCandidates({ ...base, now: at('2026-01-21', '02:40') }).some((x) => x.key.startsWith('supps-bed:')), false, 'the night is over');
  assert.equal(bed('23:30', { suppsBed: { ...base.suppsBed, open: [] } }), undefined, 'taken');
  assert.equal(bed('23:30', { fasting: true }), undefined, 'a fasting day');
});

test('the Mac: bedtime from Settings or the moving schedule; first and second meal asks say what\'s next; bed ones not in the no-time list', async () => {
  // Settings: wake 7:00 AM, bed 1:00 AM, so tonight's bed is after midnight.
  assert.equal(bedAtOf({ wakeHm: '07:00', bedHm: '01:00' }, at(D, '20:00'), TZ), at('2026-01-21', '01:00'));
  assert.equal(bedAtOf({ wakeHm: '07:00', bedHm: '01:00' }, at('2026-01-21', '00:30'), TZ), at('2026-01-21', '01:00'), 'after midnight, still that day');
  assert.equal(bedAtOf({ clock: { bedAt: at(D, '23:38') }, wakeHm: '07:00', bedHm: '22:00' }, at(D, '20:00'), TZ), at(D, '23:38'), 'the moving one');

  const dir = mkdtempSync(join(tmpdir(), 'thq-supps-moment-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    store.writeLocal('settings', 'main', { notify: { movingDay: false, wakeHm: '06:00', bedHm: '23:30' } });
    for (const x of HIS) store.writeLocal('supplements', x.id, x);
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push(m); return { sent: 1, failed: 0 }; } };
    await dishesTick({ store, push, now: at(D, '06:30'), tz: TZ });
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at(D, '06:55'), name: 'Breakfast', source: 'manual', before: { items: [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }] } });
    await dishesTick({ store, push, now: at(D, '06:55'), tz: TZ });
    assert.match(sent[0].body, /^Breakfast logged\. Take your supplements now: Vitamin C, Vitamin D3 \+ K2 \(MK-7\), Omega-3 fish oil, Ashwagandha KSM-66\. Next: carnitine, creatine, collagen after your second meal; magnesium before bed, about 11:30 PM\./);
    for (const e of took(FIRST4, '06:56')) store.writeLocal('supp-log', e.id, e);
    const inp = nudgeInputs(store, at(D, '07:18'), TZ).args;
    assert.equal(inp.suppsUntimed, null, 'nothing without a moment: no "X of 8" list');
    assert.deepEqual(inp.suppsBed.open, ['Magnesium bisglycinate 375 mg']);
    assert.equal(inp.suppsBed.bedAt, at(D, '23:30'));
    assert.equal(nudgeCandidates({ ...inp, now: at(D, '07:18') }).some((x) => /^supps-(untimed|bed)/.test(x.key)), false, 'nothing about supplements at 7:18 AM');
    await dishesTick({ store, push, now: at(D, '07:00'), tz: TZ }); // breakfast's dishes
    sent.length = 0;
    store.writeLocal('meals', 'm2', { id: 'm2', date: D, at: at(D, '13:00'), name: 'Lunch', source: 'manual', before: { items: [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }] } });
    await dishesTick({ store, push, now: at(D, '13:30'), tz: TZ });
    assert.match(sent[0].body, /^Lunch done\. Get up and take your carnitine, creatine, collagen now\. I'll ask again every 5 minutes until you tick it\. Next: magnesium before bed, about 11:30 PM\./);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
