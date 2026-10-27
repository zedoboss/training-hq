// Mon 10/26 (the nightly review of Sunday): after a pizza out at 4:30 PM, logged at 5:30 PM, "Back home yet? Take your
// supplements now..." went out 11 times from 5:42 PM to 11:55 PM, every 30 to 45 minutes, the same words. His rule:
// unanswered "back home" asks get about 3 check-ins, further apart, new words each, then quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nudgeCandidates, pickNudge, awaySuppsText, after2GapMin, AWAY_CHECK_MIN, AWAY_LATE_MIN, loggedLate, lateSuppsText } from '../app/js/lib/nudges.js';
import { openStore } from '../server/store.mjs';
import { dishesTick, nudgeTick } from '../server/notify.mjs';

const TZ = 'Asia/Bangkok';
const D = '2026-03-22';
const at = (hm) => Date.parse(`${D}T${hm}:00+07:00`);
const hmOf = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const facts = (body) => body.split(/(?<=[.?])\s/).slice(0, 2).join(' ');
const NAMES = ['Vitamin D3 + K2 (MK-7)', 'Omega-3 fish oil', 'Ashwagandha KSM-66'];

function setUp(store) {
  store.writeLocal('settings', 'main', { notify: { nudgeEveryMin: 20, wakeHm: '10:00', bedHm: '00:00' } });
  store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: at('12:00') });
  const supp = (id, name, short, afterMeal, order) => store.writeLocal('supplements', id, { id, kind: 'supplement', name, short, days: { type: 'daily' }, status: 'active', order, afterMeal, perTake: { train: 1, rest: 1 } });
  supp('supp.d3', NAMES[0], 'D3 + K2', 'first', 1);
  supp('supp.om', NAMES[1], 'omega-3', 'first', 2);
  supp('supp.ash', NAMES[2], 'ashwagandha', 'first', 3);
  supp('supp.co', 'Collagen peptides', 'collagen', 'second', 4);
}

test('the three check-ins: new words each, none after the last', () => {
  const texts = AWAY_CHECK_MIN.map((_, k) => awaySuppsText(k, NAMES));
  assert.equal(texts.length, 3);
  assert.equal(new Set(texts).size, 3);
  for (const t of texts) for (const n of NAMES) assert.ok(t.includes(n), `${t} names ${n}`);
  assert.equal(awaySuppsText(3, NAMES), null);
  assert.equal(awaySuppsText(1, ['collagen'], false), 'Home by now? Still open from your meal out: collagen. Take it once you\'re in.');
  // The second meal's spacing: 30 minutes, then further apart, then never.
  assert.deepEqual([0, 1, 2, 3].map((n) => after2GapMin({ everyMin: 30, n })), [30, 60, 60, Infinity]);
  assert.equal(after2GapMin({}), 5, 'at home: unchanged, every 5 minutes until ticked');
});

test('Sunday replayed: pizza out at 4:30 PM, logged 5:30 PM, never answered: 3 check-ins, then quiet till midnight', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-away-checks-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    setUp(store);
    const sent = [];
    const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
    let now = at('16:00');
    const run = async (from, to) => { for (now = at(from); now <= at(to); now += 60000) { await dishesTick({ store, push, now, tz: TZ }); await nudgeTick({ store, push, now, tz: TZ }); } };
    await run('16:00', '17:29');
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('16:30'), name: 'Lunch', source: 'manual', away: true, before: { items: [{ name: 'Pizza', grams: 380, kcal: 1028, protein: 40 }] } });
    await run('17:30', '23:59');
    assert.match(sent.find((m) => m.tag === 'supps-after-meal').body, /You ate out, so take your supplements when you're back home/);
    const home = sent.filter((m) => m.tag === 'nudge-supps-after-meal');
    assert.deepEqual(home.map((m) => hmOf(m.at)), ['18:00', '19:00', '20:00'], 'first 30 minutes after he logged it, then an hour apart');
    assert.equal(new Set(home.map((m) => facts(m.body))).size, 3, 'new words each time');
    assert.match(home[0].body, /^Back home yet\?/);
    assert.match(home[2].body, /^Last check on your supplements from the meal out/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the second meal out (collagen): the "done" message, 3 check-ins in new words, then quiet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-away-checks2-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    setUp(store);
    for (const id of ['supp.d3', 'supp.om', 'supp.ash']) store.writeLocal('supp-log', `${D}:${id}`, { id: `${D}:${id}`, date: D, suppId: id, status: 'taken', at: at('13:00') });
    const sent = [];
    let now = at('12:00');
    const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
    const run = async (from, to) => { for (now = at(from); now <= at(to); now += 60000) await dishesTick({ store, push, now, tz: TZ }); };
    await run('12:00', '12:00');
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('12:30'), name: 'Lunch', source: 'manual', before: { items: [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }] } });
    await run('12:31', '20:59');
    store.writeLocal('meals', 'm2', { id: 'm2', date: D, at: at('21:00'), name: 'Dinner', source: 'manual', away: true, before: { items: [{ name: 'Pho', grams: 500, kcal: 600, protein: 30 }] } });
    await run('21:00', '23:59');
    const two = sent.filter((m) => m.tag === 'supps-after-meal-2');
    assert.deepEqual(two.map((m) => hmOf(m.at)), ['21:00', '21:30', '22:30', '23:30']);
    assert.match(two[0].body, /I'll remind you in 30 minutes/);
    assert.equal(two[1].body, 'Back home yet? Take your collagen now.');
    assert.equal(new Set(two.map((m) => m.body)).size, 4, 'new words each time');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a check-in held back (a session, a quiet spell) does not bunch with the next', () => {
  const base = { now: 0, tz: TZ, wakeHm: '00:00', bedHm: '23:59', sleepLogged: true };
  const sa = { open: NAMES, mealAt: at('16:30'), toldAt: at('17:30'), away: true };
  const c = (hm) => nudgeCandidates({ ...base, now: at(hm), suppsAfterMeal: sa }).find((x) => x.key.startsWith('supps-after-meal:'));
  assert.equal(c('17:59'), undefined, 'not before 30 minutes after he logged it');
  assert.equal(c('18:00').key, `supps-after-meal:${at('16:30')}:0`);
  assert.equal(c('19:00').key, `supps-after-meal:${at('16:30')}:1`);
  assert.equal(c('20:00').key, `supps-after-meal:${at('16:30')}:2`);
  // The first went out late, at 6:40 PM: the second waits 45 minutes from it, not 7:00 PM.
  const sentByKey = { [`supps-after-meal:${at('16:30')}:0`]: at('18:40') };
  assert.equal(pickNudge([c('19:00')], sentByKey, at('19:00')), null);
  assert.ok(pickNudge([c('19:25')], sentByKey, at('19:25')));
  // All three out: nothing more, however late.
  const all = Object.fromEntries([0, 1, 2].map((k) => [`supps-after-meal:${at('16:30')}:${k}`, at(['18:00', '19:00', '20:00'][k])]));
  assert.equal(pickNudge([c('23:55')], all, at('23:55')), null);
  // Ticked: nothing at all.
  assert.equal(nudgeCandidates({ ...base, now: at('19:00'), suppsAfterMeal: { ...sa, open: [] } }).some((x) => x.key.startsWith('supps-after-meal')), false);
  // At home: unchanged (the meal-time ask straight after the meal, every 30 minutes until ticked).
  const hm = nudgeCandidates({ ...base, now: at('17:00'), suppsAfterMeal: { ...sa, away: false } }).find((x) => x.key === 'supps-after-meal');
  assert.match(hm.text, /^First meal logged: take your supplements now/);
  assert.equal(hm.gapMin, 30);
});

// Wed 10/28: udon out at 7:00 PM, logged by the coach at 12:32 AM on his word, after hours off the phone. "You ate out, so
// take your supplements when you're back home... I'll remind you later" made no sense. His words: "You obviously ate
// earlier, and I assume you did not take the supplements. Let me know if I'm wrong."
test('a meal out logged hours after he ate it: one question, no "back home", no check-ins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-away-late-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    setUp(store);
    store.writeLocal('settings', 'main', { notify: { nudgeEveryMin: 20, wakeHm: '10:00', bedHm: '02:00' } });
    const sent = [];
    let now;
    const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
    const run = async (from, to) => { for (now = from; now <= to; now += 60000) { await dishesTick({ store, push, now, tz: TZ }); await nudgeTick({ store, push, now, tz: TZ }); } };
    await run(at('18:00'), at('18:00'));
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('19:00'), name: 'First meal', source: 'manual', by: 'coach', away: true, before: { items: [{ name: 'Udon', grams: 375, kcal: 500, protein: 20 }] } });
    const logged = at('19:00') + (5 * 60 + 32) * 60000; // 12:32 AM
    await run(logged, logged + 3 * 3600000);
    const ask = sent.filter((m) => m.tag === 'supps-after-meal');
    assert.equal(ask.length, 1);
    assert.equal(ask[0].body, `First meal logged. You ate a while ago, so I'm guessing your supplements aren't taken yet: ${NAMES.join(', ')}. Am I wrong?`);
    assert.doesNotMatch(ask[0].body, /back home|remind you/);
    assert.deepEqual(sent.filter((m) => /supps-after-meal/.test(m.tag) && m !== ask[0]), [], 'no "back home yet?" afterwards');
    assert.equal(sent.some((m) => /back home|home by now|meal out/i.test(m.body)), false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a meal out logged soon after: unchanged, "when you\'re back home" and the check-ins', () => {
  assert.equal(AWAY_LATE_MIN, 120);
  assert.equal(loggedLate(at('16:30'), at('18:29')), false);
  assert.equal(loggedLate(at('16:30'), at('18:30')), true);
  assert.equal(loggedLate(at('16:30'), null), false, 'not known when it was logged: the usual way');
  const base = { tz: TZ, wakeHm: '00:00', bedHm: '23:59', sleepLogged: true };
  const c = (told, hm) => nudgeCandidates({ ...base, now: at(hm), suppsAfterMeal: { open: NAMES, mealAt: at('16:30'), toldAt: at(told), away: true } }).filter((x) => x.key.startsWith('supps-after-meal'));
  assert.equal(c('17:30', '18:00').length, 1, 'logged an hour after: "back home yet?" as before');
  assert.deepEqual(c('19:00', '19:30'), [], 'logged 2.5 hours after: no check-in');
  assert.deepEqual(c('19:00', '22:00'), []);
  // At home, logged late: unchanged (take them now).
  const home = nudgeCandidates({ ...base, now: at('19:30'), suppsAfterMeal: { open: NAMES, mealAt: at('16:30'), toldAt: at('19:00'), away: false } });
  assert.match(home.find((x) => x.key === 'supps-after-meal').text, /^First meal logged: take your supplements now/);
  assert.equal(lateSuppsText('Dinner', ['collagen']), 'Dinner logged. You ate a while ago, so I\'m guessing your collagen isn\'t taken yet. Am I wrong?');
});

test('the second meal out logged hours later: one question, no check-ins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-away-late2-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    setUp(store);
    for (const id of ['supp.d3', 'supp.om', 'supp.ash']) store.writeLocal('supp-log', `${D}:${id}`, { id: `${D}:${id}`, date: D, suppId: id, status: 'taken', at: at('13:00') });
    const sent = [];
    let now = at('12:00');
    const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
    const run = async (from, to) => { for (now = at(from); now <= at(to); now += 60000) await dishesTick({ store, push, now, tz: TZ }); };
    await run('12:00', '12:00');
    store.writeLocal('meals', 'm1', { id: 'm1', date: D, at: at('12:30'), name: 'Lunch', source: 'manual', before: { items: [{ name: 'Rice', grams: 200, kcal: 260, protein: 5 }] } });
    await run('12:31', '19:59');
    store.writeLocal('meals', 'm2', { id: 'm2', date: D, at: at('17:30'), name: 'Dinner', source: 'manual', away: true, before: { items: [{ name: 'Pho', grams: 500, kcal: 600, protein: 30 }] } });
    await run('20:00', '23:59');
    const two = sent.filter((m) => m.tag === 'supps-after-meal-2');
    assert.deepEqual(two.map((m) => [hmOf(m.at), m.body]), [['20:00', 'Dinner logged. You ate a while ago, so I\'m guessing your collagen isn\'t taken yet. Am I wrong?']]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
