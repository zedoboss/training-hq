import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL, EVERY_DAYS, proposeNext, projectRotation, scanStatus, scanReminders, confirmDate, cancelDate, withTick, unticked,
  withProtocol, protocolOf, expectedOn, lastDone,
} from '../app/js/lib/scans.js';
import { remindersFor } from '../app/js/lib/reminders.js';
import { fixedReminders } from '../app/js/lib/backup-reminders.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso, hm) => Date.parse(`${iso}T${hm}:00+07:00`);
// Tuesday 1/20/2026: Push was done Monday 1/19, so today is Legs and Wednesday 1/21 is the rotation's rest day.
const today = '2026-01-20';
const last = { dayType: 'push', date: '2026-01-19' };
const done = (date) => ({ id: `scan.${date}`, date, status: 'done' });

test('the rotation ahead assumes each planned session happens', () => {
  const p = projectRotation({ last, days: {}, from: today, n: 6 });
  assert.deepEqual(p.map((x) => `${x.date.slice(5)} ${x.kind} ${x.dayType ?? ''}`.trim()),
    ['01-20 train legs', '01-21 rest', '01-22 train pull', '01-23 train push', '01-24 train legs', '01-25 rest']);
  assert.equal(expectedOn({ last, days: {}, today, date: '2026-01-21' }).kind, 'rest');
  assert.equal(expectedOn({ last, days: {}, today, date: '2026-01-19' }), null);
});

test('first scan: the next training day from tomorrow (tomorrow is the rotation rest day here)', () => {
  // Today's Legs is not done yet: Wednesday is rest if he trains today, Legs if it moves; Thursday is Pull or rest.
  // The scan goes on the first day he is at the gym either way: Friday (Pull if Legs moves, Push if done today).
  const p = proposeNext({ scans: [], today, last, days: {} });
  assert.deepEqual(p, { date: '2026-01-23', dayType: null, either: { ifMoved: 'pull', ifDone: 'push' }, base: '2026-01-21', shifted: true, baseMaybe: true, open: 'legs', lastDate: null });
  // Legs done today: Wednesday is the rest day for sure, Thursday Pull.
  const d = proposeNext({ scans: [], today, last: { dayType: 'legs', date: today }, days: {} });
  assert.deepEqual(d, { date: '2026-01-22', dayType: 'pull', either: null, base: '2026-01-21', shifted: true, baseMaybe: false, open: null, lastDate: null });
  // Tomorrow a training day: tomorrow.
  const p2 = proposeNext({ scans: [], today: '2026-01-21', last: { dayType: 'legs', date: '2026-01-20' }, days: {} });
  assert.equal(p2.date, '2026-01-22');
  assert.equal(p2.shifted, false);
});

test('next scan: 4 weeks after the last, the same weekday; a rest day moves it to the next training day', () => {
  const scans = [done('2026-01-22'), { id: 'scan.2026-01-10', date: '2026-01-10', status: 'prep' }];
  assert.equal(lastDone(scans).date, '2026-01-22');
  const l = { dayType: 'pull', date: '2026-01-22' };
  // Friday 1/23, Push done: Thursday 2/19 is Pull.
  const pushed = { dayType: 'push', date: '2026-01-23' };
  const p = proposeNext({ scans, today: '2026-01-23', last: pushed, days: {} });
  assert.equal(EVERY_DAYS, 28);
  assert.deepEqual(p, { date: '2026-02-19', dayType: 'pull', either: null, base: '2026-02-19', shifted: false, baseMaybe: false, open: null, lastDate: '2026-01-22' });
  // Push not done yet: 2/19 is Pull, or the rest day if Push moves, so Friday 2/20 (Pull if Push moves, Push if done today).
  const open = proposeNext({ scans, today: '2026-01-23', last: l, days: {} });
  assert.deepEqual([open.date, open.either, open.baseMaybe, open.open], ['2026-02-20', { ifMoved: 'pull', ifDone: 'push' }, true, 'push']);
  // He adds a rest day on Thursday 2/19: Friday 2/20 (Pull moves with it).
  const days = { '2026-02-19': { date: '2026-02-19', rest: { reason: 'added' } } };
  const p2 = proposeNext({ scans, today: '2026-01-23', last: pushed, days });
  assert.equal(p2.date, '2026-02-20');
  assert.equal(p2.dayType, 'pull');
  assert.equal(p2.shifted, true);
  // Overdue (no scan for 6 weeks): never before tomorrow.
  const p3 = proposeNext({ scans, today: '2026-03-05', last: { dayType: 'legs', date: '2026-03-05' }, days: {} });
  assert.equal(p3.date, '2026-03-07'); // Legs done Thursday 3/5, Friday the rotation's rest day
});

test('status: confirmed, missed, a rest day on the confirmed date, the prep record', () => {
  let plan = confirmDate({}, '2026-01-22', { proposedDate: '2026-01-22', at: 1 });
  assert.equal(plan.next.how, 'proposal');
  assert.deepEqual(plan.log, [{ at: 1, what: 'confirmed', date: '2026-01-22' }]);
  const prep = { id: 'scan.2026-01-22', date: '2026-01-22', status: 'prep' };
  let st = scanStatus({ plan, scans: [prep], today, last, days: {} });
  assert.equal(st.next.date, '2026-01-22');
  assert.equal(st.prep, prep);
  assert.equal(st.missed, null);
  assert.equal(st.onRest, null);
  // He adds a rest day on the scan date: offer the next training day.
  const days = { '2026-01-22': { date: '2026-01-22', rest: { reason: 'added' } } };
  st = scanStatus({ plan, scans: [], today, last, days });
  assert.deepEqual(st.onRest, { to: '2026-01-23', dayType: 'pull' });
  // The date passed with no results: missed, and a new proposal.
  st = scanStatus({ plan, scans: [prep], today: '2026-01-24', last: { dayType: 'legs', date: '2026-01-24' }, days: {} });
  assert.equal(st.next, null);
  assert.equal(st.missed, '2026-01-22');
  assert.equal(st.proposal.date, '2026-01-26'); // Sunday 1/25 is the rest day after Legs
  // Results on that date: nothing missed; the next proposal is 4 weeks on.
  st = scanStatus({ plan, scans: [done('2026-01-22')], today: '2026-01-24', last: { dayType: 'push', date: '2026-01-23' }, days: {} });
  assert.equal(st.missed, null);
  assert.equal(st.proposal.base, '2026-02-19');
  // Moved and cancelled are logged.
  plan = confirmDate(plan, '2026-01-23', { proposedDate: '2026-01-22', at: 2 });
  assert.equal(plan.next.how, 'picked');
  assert.equal(plan.log.at(-1).what, 'moved');
  plan = cancelDate(plan, 3);
  assert.equal(plan.next, null);
  assert.deepEqual(plan.log.at(-1), { at: 3, what: 'cancelled', date: '2026-01-23' });
});

test('checklist ticks keep the lines as they were that day; his own checklist wins', () => {
  let rec = withTick(null, '2026-01-22', PROTOCOL, 'barefoot', true, 5);
  assert.equal(rec.id, 'scan.2026-01-22');
  assert.equal(rec.status, 'prep');
  assert.deepEqual(rec.prep.ticks, { barefoot: true });
  assert.equal(rec.prep.items.length, PROTOCOL.length);
  assert.equal(unticked(rec, PROTOCOL).length, PROTOCOL.length - 1);
  rec = withTick(rec, '2026-01-22', PROTOCOL, 'barefoot', false);
  assert.deepEqual(rec.prep.ticks, {});
  for (const i of PROTOCOL) rec = withTick(rec, '2026-01-22', PROTOCOL, i.id, true);
  assert.equal(unticked(rec, PROTOCOL).length, 0);

  const own = [{ id: 'staff-1', when: 'day', text: ' Remove jewellery. ' }, { id: 'fasted', when: 'x', text: 'Nothing eaten.' }, { id: 'e', when: 'day', text: '  ' }];
  const plan = withProtocol({}, own, 'Added 1, changed 1 lines', 9);
  assert.deepEqual(protocolOf(plan), [{ id: 'staff-1', when: 'day', text: 'Remove jewellery.' }, { id: 'fasted', when: 'day', text: 'Nothing eaten.' }]);
  assert.deepEqual(plan.protocol.changes, [{ at: 9, note: 'Added 1, changed 1 lines' }]);
  assert.equal(protocolOf({}), PROTOCOL);
  // The ticked record keeps the brief's lines it was taken with.
  assert.equal(unticked(rec, protocolOf(plan)).length, 0);
});

test('reminders: two evenings before (alcohol), the evening before (the list), at the session time on the day', () => {
  const plan = confirmDate({}, '2026-01-22', { proposedDate: '2026-01-22' });
  const days = { '2026-01-22': { date: '2026-01-22', sessionTime: '04:30' } };
  const two = scanReminders({ date: today, tz: TZ, plan, days });
  assert.equal(two.length, 1);
  assert.equal(two[0].id, 'scan-alcohol:2026-01-22');
  assert.equal(two[0].at, at(today, '20:00'));
  assert.equal(two[0].body, 'Thursday 1/22, first thing at the gym. No alcohol in the 24 to 48 hours before.');
  const eve = scanReminders({ date: '2026-01-21', tz: TZ, plan, days, eveningHm: '19:45' });
  assert.equal(eve[0].title, 'Body scan tomorrow');
  assert.equal(eve[0].at, at('2026-01-21', '19:45'));
  assert.equal(eve[0].body, 'Thursday 1/22. Tonight: No alcohol in the 24 to 48 hours before. Eat, salt and take supplements as usual. Tomorrow: First thing at the gym, before the workout. No training beforehand. Nothing eaten before the scan. Normal water intake. No caffeine or pre-workout before the scan. Bathroom first. Barefoot.');
  assert.equal(eve[0].fixed, true);
  assert.equal(eve[0].url, '#/body/scan');
  const day = scanReminders({ date: '2026-01-22', tz: TZ, plan, days });
  assert.equal(day[0].id, 'scan-morning:2026-01-22');
  assert.equal(day[0].at, at('2026-01-22', '04:00'));
  assert.equal(day[0].body, 'First thing at the gym, before the workout. No training beforehand. Nothing eaten before the scan. Normal water intake. No caffeine or pre-workout before the scan. Bathroom first. Barefoot.');
  assert.equal(day[1].id, 'scan-arrive:2026-01-22');
  assert.equal(day[1].at, at('2026-01-22', '04:30'));
  assert.equal(day[1].due, true);
  // A10: three days before; the gym one stands down once the arrival automation asked.
  const three = scanReminders({ date: '2026-01-19', tz: TZ, plan, days });
  assert.equal(three[0].id, 'scan-3days:2026-01-22');
  assert.equal(three[0].title, 'Body scan in three days');
  assert.equal(three[0].body, 'Thursday 1/22, first thing at the gym, before the workout. Coming up: No alcohol in the 24 to 48 hours before. Eat, salt and take supplements as usual.');
  assert.equal(scanReminders({ date: '2026-01-22', tz: TZ, plan, days: { '2026-01-22': { ...days['2026-01-22'], arrivedAt: 1 } } })[1].due, false);
  // No session time: the evening one asks for it, and nothing on the day.
  assert.match(scanReminders({ date: '2026-01-21', tz: TZ, plan, days: {} })[0].body, /Set tomorrow's session time/);
  assert.deepEqual(scanReminders({ date: '2026-01-22', tz: TZ, plan, days: {} }), []);
  // Results in: not due. No plan: nothing.
  assert.equal(scanReminders({ date: '2026-01-22', tz: TZ, plan, days, scans: [done('2026-01-22')] })[0].due, false);
  assert.deepEqual(scanReminders({ date: '2026-01-21', tz: TZ, plan: {}, days }), []);
});

test('scan reminders join the day plan (kind scan, can be switched off) and the backup Reminders', () => {
  const plan = confirmDate({}, '2026-01-22', { proposedDate: '2026-01-22' });
  const dayDocs = { '2026-01-22': { date: '2026-01-22', sessionTime: '04:30' } };
  const items = remindersFor({ tz: TZ, date: '2026-01-21', last: { dayType: 'legs', date: '2026-01-20' }, days: dayDocs, scanPlan: plan });
  assert.ok(items.some((i) => i.id === 'scan-eve:2026-01-22' && i.kind === 'scan'));
  const off = remindersFor({ tz: TZ, date: '2026-01-21', last: { dayType: 'legs', date: '2026-01-20' }, days: dayDocs, scanPlan: plan, settings: { notify: { kinds: { scan: false } } } });
  assert.ok(!off.some((i) => i.kind === 'scan'));
  const state = { tz: TZ, last, days: dayDocs, areas: [], rounds: {}, scanPlan: plan, scans: [] };
  const fixed = fixedReminders(state, today, 3, at(today, '00:00'));
  assert.deepEqual(fixed.filter((r) => r.kind === 'scan').map((r) => r.id.split(':')[0]), ['scan-alcohol', 'scan-eve', 'scan-morning', 'scan-arrive']);
});

test('arrival at the gym (A10): the scan first on a scan day with results still to come; else nothing', async () => {
  const { arrivalMessage } = await import('../app/js/lib/scans.js');
  const plan = confirmDate({}, '2026-01-22', { proposedDate: '2026-01-22' });
  const m = arrivalMessage({ plan, date: '2026-01-22' });
  assert.equal(m.title, 'Body scan first'); assert.equal(m.url, '#/body/scan');
  assert.match(m.body, /^You're at the gym: scan before the workout\. First thing at the gym/);
  assert.equal(arrivalMessage({ plan, date: '2026-01-21' }), null);
  assert.equal(arrivalMessage({ plan, date: '2026-01-22', scans: [done('2026-01-22')] }), null);
});

test('results: labels matched to the usual metrics, numbers as printed, photos merged without duplicates', async () => {
  const { keyFor, numberOf, cleanMetrics, mergeReads } = await import('../app/js/lib/scans.js');
  assert.equal(keyFor('Body Fat (%)', '%'), 'fatPercent');
  assert.equal(keyFor('Fat', 'kg'), 'fatMassKg');
  assert.equal(keyFor('Fat Mass (Left Leg)', 'kg'), 'fatLeftLegKg');
  assert.equal(keyFor('Segmental Lean · Trunk', 'kg'), 'leanTrunkKg');
  assert.equal(keyFor('Right arm', '%'), null);
  assert.equal(keyFor('Visceral Fat Level', ''), 'visceralFat');
  assert.equal(keyFor('Hydration', ''), null);
  assert.deepEqual(['82,4', '1,845', '18.2 %', '<5', 'Good', ''].map(numberOf), [82.4, 1845, 18.2, 5, null, null]);
  const c = cleanMetrics([{ label: ' Weight ', text: '82,4', unit: 'kg' }, { label: 'Body weight', text: '82.5', unit: 'kg' }, { label: '', text: '1' }, { label: 'Note', text: '' }]);
  assert.deepEqual(c, [{ key: 'weightKg', label: 'Weight', value: 82.4, text: '82,4', unit: 'kg' }, { key: null, label: 'Body weight', value: 82.5, text: '82.5', unit: 'kg' }]);
  const m = mergeReads([
    { status: 'done', metrics: [{ label: 'Weight', text: '82.4', unit: 'kg' }, { label: 'BMR', text: '1845', unit: 'kcal' }] },
    { status: 'failed', metrics: [{ label: 'Protein', text: '9', unit: 'kg' }] },
    { status: 'done', metrics: [{ label: 'weight', text: '82.4', unit: 'kg' }, { label: 'Protein', text: '11.6', unit: 'kg' }] },
  ]);
  assert.deepEqual(m.map((x) => x.label), ['Weight', 'BMR', 'Protein']);
});

test('results saved with the conditions; different conditions named; calendar marker', async () => {
  const { conditionsFrom, withResults, conditionNotes, metricValue, scanMarks, isDone } = await import('../app/js/lib/scans.js');
  let rec = null;
  for (const i of PROTOCOL.filter((x) => x.id !== 'barefoot')) rec = withTick(rec, '2026-01-22', PROTOCOL, i.id, true);
  const cond = conditionsFrom(rec, PROTOCOL);
  assert.deepEqual(cond, { fasted: true, trainedBefore: false, unusual: '', unticked: ['barefoot'] });
  assert.deepEqual(conditionsFrom(null, PROTOCOL), { fasted: null, trainedBefore: null, unusual: '', unticked: PROTOCOL.map((i) => i.id) });
  const done = withResults(rec, { date: '2026-01-22', at: 5, metrics: [{ label: 'Weight', text: '82.4', unit: 'kg' }, { label: 'Body Fat', text: '18.2', unit: '%' }], conditions: { ...cond, unusual: 'Slept badly' }, photos: ['p1'], source: 'photo' }, 9);
  assert.equal(isDone(done), true);
  assert.equal(done.confirmedAt, 9);
  assert.equal(done.prep.ticks.fasted, true, 'the ticks stay on the record');
  assert.equal(metricValue(done, 'fatPercent'), 18.2);
  assert.equal(metricValue(done, 'muscleMassKg'), null);
  assert.deepEqual(conditionNotes(done, PROTOCOL), ['not ticked: Barefoot', 'Slept badly']);
  assert.deepEqual(conditionNotes({ conditions: { fasted: false, trainedBefore: true, unticked: [] } }, PROTOCOL), ['not fasted', 'trained before']);
  assert.deepEqual(conditionNotes({ conditions: { unticked: PROTOCOL.map((i) => i.id) } }, PROTOCOL), ['checklist not ticked']);
  assert.deepEqual(scanMarks([done, { date: '2026-01-01', status: 'prep' }]), [{ date: '2026-01-22', kind: 'scan', id: 'scan.2026-01-22', label: 'Body scan: 82.4 kg · 18.2% fat' }]);
});

test('trends: metrics across scans, flagged when not comparable, changes told as numbers', async () => {
  const { metricsAvailable, scanSeries, notComparable, changeLines, latestChange } = await import('../app/js/lib/scans.js');
  const at = (iso, h, m) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };
  const usual = { fasted: true, trainedBefore: false, unusual: '', unticked: [] };
  const scan = (date, h, metrics, conditions = usual) => ({ id: `scan.${date}`, date, status: 'done', at: at(date, h, 30), metrics, conditions });
  const M = (label, text, unit) => ({ label, text, unit, value: Number(text.replace(',', '.')), key: undefined });
  const { cleanMetrics } = await import('../app/js/lib/scans.js');
  const a = scan('2026-10-22', 4, cleanMetrics([M('Weight', '82.4', 'kg'), M('Body Fat %', '18.2', '%'), M('Skeletal Muscle Mass', '38.1', 'kg'), M('Hydration Score', '7', '')]));
  const b = scan('2026-11-19', 4, cleanMetrics([M('Weight', '81.6', 'kg'), M('Body Fat %', '17.5', '%'), M('Skeletal Muscle Mass', '38.6', 'kg'), M('Hydration Score', '8', '')]));
  const c = scan('2026-12-17', 9, cleanMetrics([M('Weight', '81.6', 'kg'), M('Body Fat %', '17.9', '%')]), { ...usual, fasted: false });
  const av = metricsAvailable([c, a, b, { status: 'prep' }]);
  assert.deepEqual(av.map((m) => [m.id, m.count]), [['weightKg', 3], ['fatPercent', 3], ['muscleMassKg', 2], ['label:hydration score', 2]]);
  assert.equal(av[1].label, 'Body fat');
  const s = scanSeries([c, a, b], 'fatPercent');
  assert.deepEqual(s.map((p) => [p.date, p.value, p.notes]), [['2026-10-22', 18.2, []], ['2026-11-19', 17.5, []], ['2026-12-17', 17.9, ['not fasted']]]);
  assert.deepEqual(scanSeries([a, b], 'label:hydration score').map((p) => p.text), ['7', '8']);
  assert.deepEqual(notComparable(a, b), []);
  const nc = notComparable(b, c);
  assert.equal(nc.length, 2);
  assert.match(nc[0], /^\w+day 12\/17: not fasted$/);
  assert.equal(nc[1], 'a different time of day');
  assert.deepEqual(changeLines(a, b).map((l) => l.text), [
    'Weight: 82.4 kg to 81.6 kg (−0.8 kg)', 'Body fat: 18.2% to 17.5% (−0.7 points)', 'Skeletal muscle mass: 38.1 kg to 38.6 kg (+0.5 kg)']);
  assert.equal(changeLines(b, c)[0].text, 'Weight: 81.6 kg to 81.6 kg (no change)');
  const ch = latestChange([a, c, b]);
  assert.equal(ch.prev.date, '2026-11-19');
  assert.equal(ch.days, 28);
  assert.equal(ch.reasons.length, 2);
  assert.equal(latestChange([a]), null);
});

test('the arrival link (A10): only its secret works; the day is noted; the scan message is pushed once in 30 minutes', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const { openArrive } = await import('../server/arrive.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-arrive-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let t = at('2026-01-22', '04:20');
    const sent = [];
    const push = { list: () => [1], notify: async (m) => { sent.push(m); return { sent: 1 }; } };
    const a = openArrive({ store, push, tz: TZ, now: () => t });
    const { path } = a.link();
    const k = new URL(`http://x${path}`).searchParams.get('k');
    assert.equal(a.link().path, path, 'the same link until renewed');
    await assert.rejects(a.arrive('nope'), /wrong link/);
    // Not a scan day: noted, nothing sent.
    let r = await a.arrive(k);
    assert.deepEqual([r.date, r.message, r.sent], ['2026-01-22', null, 0]);
    assert.ok(store.getRecord('days', '2026-01-22').data.arrivedAt);
    // A scan day: "Body scan first" once; again within 30 minutes: quiet.
    store.writeLocal('scan-plan', 'main', confirmDate({}, '2026-01-23', { proposedDate: '2026-01-23' }));
    t = at('2026-01-23', '04:20');
    r = await a.arrive(k);
    assert.equal(r.message, 'Body scan first'); assert.equal(sent[0].url, '#/body/scan');
    t += 10 * 60000;
    r = await a.arrive(k);
    assert.equal(r.repeat, true); assert.equal(sent.length, 1);
    // Renewed: the old link stops working.
    const k2 = new URL(`http://x${a.link({ renew: true }).path}`).searchParams.get('k');
    assert.notEqual(k2, k);
    await assert.rejects(a.arrive(k), /wrong link/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
