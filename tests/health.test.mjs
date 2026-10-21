import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openHealth } from '../server/health.mjs';
import {
  num, parseWhen, sleepStage, cleanSample, parseHealthFile, healthDays, mergeDay, nightOf, sleepNight, stepsOfDay,
  weightSeries, dailyWeights, currentBodyweight, weightNear, hoursText,
} from '../app/js/lib/health.js';
import { zonedTime, isoDate } from '../app/js/lib/time.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (day, hm) => zonedTime(day, hm, TZ);
const iso = (day, hm) => `${day}T${hm}:00+07:00`;
const line = (o) => JSON.stringify(o);

test('numbers as the Shortcut writes them', () => {
  assert.equal(num('8423'), 8423);
  assert.equal(num('8,423'), 8423);
  assert.equal(num('12,345,678'), 12345678);
  assert.equal(num('78,4'), 78.4);
  assert.equal(num('78.4 kg'), 78.4);
  assert.equal(num('1.234,5'), 1234.5);
  assert.equal(num(' 1 234 '), 1234);
  assert.equal(num(''), null);
  assert.equal(num('kg'), null);
  assert.equal(num(72), 72);
});

test('dates: ISO with and without an offset, and the Shortcuts app wording, in his time zone', () => {
  const t = at('2026-10-18', '04:30');
  assert.equal(parseWhen('2026-10-18T04:30:00+07:00', TZ), t);
  assert.equal(parseWhen('2026-10-18T04:30:00+0700', TZ), t);
  assert.equal(parseWhen('2026-10-17T21:30:00Z', TZ), t);
  assert.equal(parseWhen('2026-10-18T04:30', TZ), t);
  assert.equal(parseWhen('2026-10-18 04:30:00 +0700', TZ), t);
  assert.equal(parseWhen('Oct 18, 2026 at 4:30 AM', TZ), t);
  assert.equal(parseWhen('October 18, 2026 at 4:30:00 AM', TZ), t);
  assert.equal(parseWhen('Sunday, October 18, 2026 at 4:30 AM', TZ), t);
  assert.equal(parseWhen('18 Oct 2026 at 04:30', TZ), t);
  assert.equal(parseWhen('10/18/26, 4:30 AM', TZ), t);
  assert.equal(parseWhen('Oct 18, 2026 at 4:30 PM', TZ), at('2026-10-18', '16:30'));
  assert.equal(parseWhen('Oct 18, 2026 at 12:05 AM', TZ), at('2026-10-18', '00:05'));
  assert.equal(parseWhen('Oct 18, 2026', TZ), at('2026-10-18', '00:00'));
  assert.equal(parseWhen('yesterday', TZ), null);
  assert.equal(parseWhen('', TZ), null);
});

test('sleep stages from words or HealthKit numbers', () => {
  assert.equal(sleepStage('In Bed'), 'inBed');
  assert.equal(sleepStage('Asleep (Unspecified)'), 'asleep');
  assert.equal(sleepStage('Core'), 'core');
  assert.equal(sleepStage('Deep'), 'deep');
  assert.equal(sleepStage('REM'), 'rem');
  assert.equal(sleepStage('Awake'), 'awake');
  assert.equal(sleepStage('4'), 'deep');
  assert.equal(sleepStage('banana'), null);
});

test('samples are cleaned; units turned into kg and km; unusable lines refused', () => {
  const w = cleanSample({ type: 'Weight', value: '172.9', unit: 'lb', start: iso('2026-10-18', '06:55') }, TZ);
  assert.equal(w.kg, 78.43);
  assert.equal(cleanSample({ type: 'Body Mass', value: '78,4 kg', start: iso('2026-10-18', '06:55') }, TZ).kg, 78.4);
  assert.equal(cleanSample({ type: 'weight', value: '7', unit: 'kg', start: iso('2026-10-18', '06:55') }, TZ), null);
  assert.equal(cleanSample({ type: 'steps', value: 'x', start: iso('2026-10-18', '06:55') }, TZ), null);
  assert.equal(cleanSample({ type: 'steps', value: '10', start: 'soon' }, TZ), null);
  assert.equal(cleanSample({ type: 'heart rate', value: '60', start: iso('2026-10-18', '06:55') }, TZ), null);
  const wo = cleanSample({ type: 'workout', activity: 'Walking', start: iso('2026-10-18', '03:20'), end: iso('2026-10-18', '03:27'), kcal: '41 kcal', distance: '650 m' }, TZ);
  assert.deepEqual([wo.activity, wo.minutes, wo.kcal, wo.distanceKm], ['Walking', 7, 41, 0.65]);
  assert.equal(cleanSample({ type: 'workout', start: iso('2026-10-18', '03:20'), duration: '1:05:00' }, TZ).minutes, 65);
  assert.equal(cleanSample({ type: 'workout', start: iso('2026-10-18', '03:20'), duration: '35 min', distance: '2 mi' }, TZ).distanceKm, 3.22);
});

test('a file: one object per line, an export line, bad lines counted; arrays and {samples} too', () => {
  const text = [
    line({ type: 'export', at: iso('2026-10-18', '07:30') }),
    line({ type: 'steps', value: '8423', unit: 'count', start: iso('2026-10-17', '00:00'), end: iso('2026-10-18', '00:00'), source: 'iPhone' }),
    '{"type":"steps","value":"oops"',
    `${line({ type: 'weight', value: '78.4', unit: 'kg', start: iso('2026-10-18', '06:55') })},`,
    '',
  ].join('\n');
  const f = parseHealthFile(text, TZ);
  assert.equal(f.samples.length, 2);
  assert.equal(f.bad, 1);
  assert.equal(f.at, at('2026-10-18', '07:30'));
  const arr = parseHealthFile(JSON.stringify([{ type: 'steps', value: 5, start: iso('2026-10-17', '00:00') }]), TZ);
  assert.equal(arr.samples.length, 1);
  const obj = parseHealthFile(JSON.stringify({ at: iso('2026-10-18', '07:30'), samples: [{ type: 'steps', value: 5, start: iso('2026-10-17', '00:00') }] }), TZ);
  assert.equal(obj.samples.length, 1);
  assert.equal(obj.at, at('2026-10-18', '07:30'));
  // Two objects run together on one line (a Text action without line breaks).
  assert.equal(parseHealthFile('{"type":"steps","value":"1","start":"2026-10-17"}{"type":"steps","value":"2","start":"2026-10-16"}', TZ).samples.length, 2);
});

test('steps: Health day totals used as they are; raw samples from two devices are not added together', () => {
  const s = (v, src) => ({ type: 'steps', value: v, start: 0, end: 0, source: src });
  assert.equal(stepsOfDay([s(8423, '')]), 8423);
  assert.equal(stepsOfDay([s(3000, 'iPhone'), s(2000, 'iPhone'), s(4500, 'Watch')]), 5000);
  assert.equal(stepsOfDay([]), null);
});

test('sleep: the night is the day he woke up; asleep time is not counted twice; in bed and bed/wake times', () => {
  assert.equal(nightOf(at('2026-10-18', '02:40'), TZ), '2026-10-18');
  assert.equal(nightOf(at('2026-10-17', '21:30'), TZ), '2026-10-18');
  assert.equal(nightOf(at('2026-10-18', '15:00'), TZ), '2026-10-18');
  const sl = (stage, a, b, src = 'Watch') => ({ type: 'sleep', stage, start: a, end: b, source: src });
  const n = sleepNight([
    sl('inBed', at('2026-10-17', '20:30'), at('2026-10-18', '02:50'), 'iPhone'),
    sl('core', at('2026-10-17', '20:50'), at('2026-10-17', '23:00')),
    sl('deep', at('2026-10-17', '23:00'), at('2026-10-18', '00:00')),
    sl('awake', at('2026-10-18', '00:00'), at('2026-10-18', '00:10')),
    sl('rem', at('2026-10-18', '00:10'), at('2026-10-18', '02:40')),
    sl('asleep', at('2026-10-17', '21:00'), at('2026-10-18', '02:00'), 'AutoSleep'), // inside the Watch's: no extra time
  ]);
  assert.equal(n.asleepMin, 130 + 60 + 150 - 0 + 10); // 20:50-00:00 and 00:10-02:40, with the other app's 00:00-00:10 inside
  assert.equal(n.inBedMin, 380);
  assert.equal(n.bed, at('2026-10-17', '20:50'));
  assert.equal(n.wake, at('2026-10-18', '02:40'));
  assert.deepEqual(n.stages, { core: 130, deep: 60, rem: 150, awake: 10 });
  const onlyBed = sleepNight([sl('inBed', at('2026-10-17', '21:00'), at('2026-10-18', '03:00'), 'iPhone')]);
  assert.equal(onlyBed.asleepMin, null);
  assert.equal(onlyBed.inBedMin, 360);
  assert.equal(hoursText(445), '7 h 25 min');
  assert.equal(hoursText(45), '45 min');
});

const fileText = () => [
  line({ type: 'export', at: iso('2026-10-18', '07:30') }),
  ...['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((d, i) => line({ type: 'steps', value: String(5000 + i * 1000), start: iso(d, '00:00'), end: iso(d, '23:59') })),
  line({ type: 'sleep', value: 'Core', start: iso('2026-10-16', '21:00'), end: iso('2026-10-17', '03:00') }),
  line({ type: 'sleep', value: 'Core', start: iso('2026-10-17', '21:00'), end: iso('2026-10-18', '02:30') }),
  line({ type: 'weight', value: '78.4', unit: 'kg', start: iso('2026-10-16', '06:55') }),
  line({ type: 'weight', value: '78.1', unit: 'kg', start: iso('2026-10-18', '06:50') }),
  line({ type: 'workout', activity: 'Walking', start: iso('2026-10-17', '03:20'), end: iso('2026-10-17', '03:27') }),
].join('\n');

test('days from a file, with which types cover each whole day', () => {
  const days = healthDays(parseHealthFile(fileText(), TZ).samples, TZ);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  const [d15, d16, d17, d18] = days;
  assert.equal(d15.steps, 5000);
  assert.equal(d15.covered.steps, undefined); // the first day may be cut off by the date range
  assert.equal(d16.covered.steps, true);
  assert.equal(d17.sleep.asleepMin, 360);
  assert.equal(d17.covered.sleep, undefined);
  assert.equal(d18.covered.sleep, true);
  assert.deepEqual(d16.weights.map((w) => w.kg), [78.4]);
  assert.equal(d17.covered.weight, true);
  assert.deepEqual(d17.workouts.map((w) => w.activity), ['Walking']);
  assert.equal(d18.covered.workout, true);
  assert.equal(d18.workouts.length, 0);
});

test('merge: covered parts replace, partial parts only add; nothing changed = null', () => {
  const stored = { date: '2026-10-18', steps: 2000, sleep: { asleepMin: 300 }, weights: [{ at: 1000 * 60000, kg: 78 }], workouts: [{ start: 5 * 60000, activity: 'Walking' }] };
  const covered = mergeDay(stored, { date: '2026-10-18', steps: 1500, sleep: null, weights: [], workouts: [], covered: { steps: true, sleep: true, weight: true, workout: true } });
  assert.deepEqual([covered.steps, covered.sleep, covered.weights.length, covered.workouts.length], [1500, null, 0, 0]);
  const partial = mergeDay(stored, { date: '2026-10-18', steps: 1500, sleep: { asleepMin: 200 }, weights: [{ at: 1001 * 60000, kg: 78.2 }], workouts: [{ start: 5 * 60000, activity: 'Walking' }], covered: {} });
  assert.deepEqual([partial.steps, partial.sleep.asleepMin, partial.weights.length, partial.workouts.length], [2000, 300, 2, 1]);
  assert.equal(mergeDay(stored, { ...stored, covered: {} }), null);
  assert.equal(mergeDay(null, { date: 'x', steps: 1, sleep: null, weights: [], workouts: [], covered: {} }).steps, 1);
});

test('weights for the screens; bodyweight for pull-ups: the newest of Health and the one he typed', () => {
  const docs = [{ date: '2026-10-16', weights: [{ at: at('2026-10-16', '06:55'), kg: 78.4 }] }, { date: '2026-10-18', weights: [{ at: at('2026-10-18', '06:00'), kg: 78.3 }, { at: at('2026-10-18', '06:50'), kg: 78.1 }] }];
  const series = weightSeries(docs, [{ date: '2026-09-01', weightKg: 80, source: 'hevy' }]);
  assert.deepEqual(series.map((w) => w.kg), [80, 78.4, 78.3, 78.1]);
  assert.deepEqual(dailyWeights(series).map((w) => w.kg), [80, 78.4, 78.1]);
  const now = at('2026-10-18', '12:00');
  assert.deepEqual(currentBodyweight({ healthDocs: docs, manual: { kg: 77, at: at('2026-10-10', '12:00') }, now }), { kg: 78.1, at: at('2026-10-18', '06:50'), from: 'health' });
  assert.equal(currentBodyweight({ healthDocs: docs, manual: { kg: 77, at: at('2026-10-18', '08:00') }, now }).from, 'manual');
  assert.equal(currentBodyweight({ healthDocs: docs, manual: null, now: at('2026-12-30', '12:00') }), null); // too old
  assert.equal(currentBodyweight({ healthDocs: docs, manual: { kg: 77, at: 1 }, now: at('2026-12-30', '12:00') }).kg, 77);
  assert.equal(weightNear(dailyWeights(series), '2026-09-10'), 80);
  assert.equal(weightNear(dailyWeights(series), '2026-06-01'), null);
});

// ---- the Mac side ----
let dir; let store; let clock;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-health-')); store = openStore(join(dir, 'db.sqlite')); clock = at('2026-10-18', '07:31'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const day = (d) => store.getRecord('health', d)?.data;

test('the Mac reads new files in the folder once, stores a record per day and a status', () => {
  const folder = join(dir, 'Training HQ');
  const h = openHealth({ store, dir: folder, tz: TZ, now: () => clock });
  assert.equal(h.scan().folderFound, false);
  mkdirSync(folder);
  writeFileSync(join(folder, 'health.json'), fileText());
  writeFileSync(join(folder, 'notes.md'), 'ignored');
  const s = h.scan();
  assert.equal(s.folderFound, true);
  assert.equal(s.files, 1);
  assert.equal(s.last.samples, 9);
  assert.deepEqual(s.last.range, ['2026-10-15', '2026-10-18']);
  assert.equal(day('2026-10-17').steps, 7000);
  assert.equal(day('2026-10-18').weights[0].kg, 78.1);
  assert.equal(day('2026-10-18').fileAt, at('2026-10-18', '07:30'));
  assert.equal(store.getRecord('health-meta', 'status').data.last.name, 'health.json');
  const seq = store.maxSeq();
  h.scan();
  assert.equal(store.maxSeq(), seq, 'unchanged file: nothing written');
  // The evening run overwrites the file: today's steps go up; yesterday is untouched.
  const evening = fileText().replace(iso('2026-10-18', '07:30'), iso('2026-10-18', '21:30')).replace('"8000"', '"12500"');
  writeFileSync(join(folder, 'health.json'), evening);
  utimesSync(join(folder, 'health.json'), new Date(), new Date(Date.now() + 5000));
  h.scan();
  assert.equal(day('2026-10-18').steps, 12500);
  assert.equal(day('2026-10-17').steps, 7000);
});

test('an older file arriving late only adds; a phone upload goes through the same reader', () => {
  const h = openHealth({ store, dir: null, tz: TZ, now: () => clock });
  assert.match(h.scan().error, /No Health folder/);
  const newer = fileText().replace(iso('2026-10-18', '07:30'), iso('2026-10-18', '21:30')).replace('"8000"', '"12500"');
  h.upload(newer, 'evening.json');
  const older = fileText().replace('"7000"', '"1"');
  const out = h.upload(older, 'morning.json');
  assert.equal(out.from, 'phone');
  assert.equal(day('2026-10-18').steps, 12500);
  assert.equal(day('2026-10-17').steps, 7000);
  assert.equal(store.getRecord('health-meta', 'status').data.last.name, 'morning.json');
});

test('the Shortcut sends its file straight to the Mac; the late iCloud copy only adds (Wed 10/21)', async () => {
  const { createApp } = await import('../server/app.mjs');
  const folder = join(dir, 'Training HQ');
  mkdirSync(folder);
  const h = openHealth({ store, dir: folder, tz: TZ, now: () => clock });
  const server = createApp({ store, appDir: dir, health: h });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { path } = h.link();
    assert.equal(h.link().path, path, 'the same link until renewed');
    const send = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
    // The morning file came through iCloud.
    writeFileSync(join(folder, 'health.txt'), fileText());
    utimesSync(join(folder, 'health.txt'), new Date(), new Date(at('2026-10-18', '07:30')));
    h.scan();
    // Evening, out walking: the Shortcut sends straight to the Mac.
    const evening = fileText().replace(iso('2026-10-18', '07:30'), iso('2026-10-18', '21:30')).replace('"8000"', '"12500"');
    assert.equal((await send(path.replace(/k=.*/, 'k=nope'), evening)).status, 403);
    assert.equal((await send('/api/apple-health/push', evening)).status, 403);
    assert.equal(day('2026-10-18').steps, 8000, 'a wrong link changes nothing');
    const res = await send(path, evening);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, samples: 9, changed: 1 });
    assert.equal(day('2026-10-18').steps, 12500);
    let st = store.getRecord('health-meta', 'status').data.last;
    assert.deepEqual([st.from, st.at], ['shortcut', at('2026-10-18', '21:30')]);
    // An hour later iCloud brings the same file to the folder: nothing changes and the status keeps the Shortcut's send.
    writeFileSync(join(folder, 'health.txt'), evening);
    utimesSync(join(folder, 'health.txt'), new Date(), new Date(at('2026-10-18', '21:30')));
    h.scan();
    assert.equal(day('2026-10-18').steps, 12500);
    st = store.getRecord('health-meta', 'status').data.last;
    assert.equal(st.from, 'shortcut');
    assert.equal((await send(path, '')).status, 400, 'an empty body is refused');
    // A paired phone gets the link; a new link stops the old one.
    assert.equal((await fetch(`${base}/api/apple-health/link`, { method: 'POST' })).status, 401);
    const renewed = h.link({ renew: true }).path;
    assert.notEqual(renewed, path);
    assert.equal((await send(path, evening)).status, 403);
  } finally { server.close(); }
});

test('the days are counted in his time zone, whatever zone the tests run in', () => {
  const docs = healthDays(parseHealthFile(line({ type: 'steps', value: '10', start: '2026-10-17T23:30:00Z' }), TZ).samples, TZ);
  assert.equal(docs[0].date, isoDate(new Date('2026-10-17T23:30:00Z'), TZ));
  assert.equal(docs[0].date, '2026-10-18');
});

test('imported sessions without a bodyweight get the nearest weigh-in (in memory only)', async () => {
  const { withBodyweights } = await import('../app/js/lib/health.js');
  const daily = [{ date: '2026-10-01', kg: 79 }, { date: '2026-10-15', kg: 78 }];
  const ses = [
    { id: 'a', startedAt: at('2026-10-14', '04:30') },
    { id: 'b', startedAt: at('2026-10-14', '04:30'), bodyweightKg: 80 },
    { id: 'c', startedAt: at('2025-01-01', '04:30') },
  ];
  const out = withBodyweights(ses, daily);
  assert.deepEqual(out.map((s) => s.bodyweightKg ?? null), [78, 80, null]);
  assert.equal(out[0].bodyweightFrom, 'health');
  assert.equal(ses[0].bodyweightKg, undefined);
  assert.equal(withBodyweights(ses, []), ses);
});
