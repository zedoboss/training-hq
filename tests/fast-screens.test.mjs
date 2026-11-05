// Thu 11/5 (opening an exercise and going back to the workout took about a second): the repo keeps read collections
// in memory, in step with every write and every change from the Mac, and dates reuse their formatters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRepo, memoryAdapter } from '../app/js/lib/repo.js';
import { isoDate, formatDay, formatTime, deviceTimeZone, formatterFor } from '../app/js/lib/time.js';
import { formatHlc } from '../app/js/lib/hlc.js';

const counted = () => {
  const a = memoryAdapter();
  const n = { list: 0 };
  const listRecords = a.listRecords.bind(a);
  a.listRecords = async (col) => { n.list++; return listRecords(col); };
  return { a, n };
};

test('a collection is read from storage once, then from memory', async () => {
  const { a, n } = counted();
  const r = await openRepo(a);
  await r.put('sets', 's1', { id: 's1', kg: 40 });
  await r.list('sets'); await r.list('sets'); await r.get('sets', 's1');
  assert.equal(n.list, 1);
});

test('the kept list follows puts and removes made after it was read', async () => {
  const r = await openRepo(memoryAdapter());
  await r.put('sets', 's1', { id: 's1', kg: 40 });
  assert.deepEqual((await r.list('sets')).map((x) => x.kg), [40]);
  await r.put('sets', 's1', { id: 's1', kg: 42.5 });
  await r.put('sets', 's2', { id: 's2', kg: 45 });
  assert.deepEqual((await r.list('sets')).map((x) => x.kg).sort(), [42.5, 45]);
  assert.equal((await r.get('sets', 's1')).kg, 42.5);
  await r.remove('sets', 's1');
  assert.deepEqual((await r.list('sets')).map((x) => x.id), ['s2']);
  assert.equal(await r.get('sets', 's1'), null);
});

test('a write while the first read is still in flight is not lost', async () => {
  const r = await openRepo(memoryAdapter());
  await r.put('sets', 's1', { id: 's1', kg: 40 });
  const first = r.list('sets');
  await r.put('sets', 's2', { id: 's2', kg: 50 });
  await first;
  assert.deepEqual((await r.list('sets')).map((x) => x.id).sort(), ['s1', 's2']);
});

test('changes from the Mac replace the kept list', async () => {
  const { a, n } = counted();
  const r = await openRepo(a);
  await r.put('sessions', 'x', { id: 'x', title: 'Legs' });
  await r.list('sessions');
  await r.applyRemote([{ col: 'sessions', id: 'x', data: { id: 'x', title: 'Legs (Mac)' }, deleted: false, hlc: formatHlc(Date.now() + 60000, 0, 'bbbbbbbbbbbb'), device: 'bbbbbbbbbbbb' }]);
  assert.equal((await r.list('sessions'))[0].title, 'Legs (Mac)');
  assert.equal((await r.get('sessions', 'x')).title, 'Legs (Mac)');
  assert.equal(n.list, 2);
  r.forget(['sessions']);
  await r.list('sessions');
  assert.equal(n.list, 3);
});

test('what a screen changes in its copy never touches the kept one', async () => {
  const r = await openRepo(memoryAdapter());
  const data = { id: 's1', kg: 40, target: { kg: 40 } };
  await r.put('sets', 's1', data);
  data.kg = 99;
  const [x] = await r.list('sets');
  x.kg = 1; x.target.kg = 1;
  (await r.get('sets', 's1')).target.kg = 2;
  const [y] = await r.list('sets');
  assert.equal(y.kg, 40);
  assert.equal(y.target.kg, 40);
});

test('photo collections are always read from storage', async () => {
  const { a, n } = counted();
  const r = await openRepo(a);
  await r.put('meal-photos', 'p', { id: 'p' });
  await r.list('meal-photos'); await r.list('meal-photos');
  assert.equal(n.list, 2);
});

test('dates: kept formatters give the same answers, per zone', () => {
  const t = Date.UTC(2026, 10, 4, 23, 30);
  assert.equal(isoDate(new Date(t), 'Asia/Ho_Chi_Minh'), '2026-11-05');
  assert.equal(isoDate(new Date(t), 'America/New_York'), '2026-11-04');
  assert.equal(formatDay(new Date(t), 'Asia/Ho_Chi_Minh'), 'Thursday 11/5');
  assert.equal(formatTime(new Date(t), 'Asia/Ho_Chi_Minh'), '6:30 AM');
  assert.equal(formatTime(new Date(t), 'America/New_York'), '6:30 PM');
  assert.equal(formatterFor('UTC', { year: 'numeric' }), formatterFor('UTC', { year: 'numeric' }));
  assert.throws(() => isoDate(new Date(t), 'Not/AZone'));
  assert.equal(deviceTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
});

// A small stand-in for the browser's Cache Storage.
function fakeCaches() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async keys() { return [...m.keys()].map((url) => ({ url })); },
        async match(url) { return m.get(url) ?? undefined; },
        async put(url, res) { m.set(url, res); },
        async delete(req) { return m.delete(typeof req === 'string' ? req : req.url); },
      };
    },
  };
}

test('every demo is kept on the phone, each fetched from the Mac once, a changed one again', async () => {
  globalThis.caches = fakeCaches();
  const { keepAllDemos, cachedClip, keptIds } = await import('../app/js/lib/demos.js');
  const recs = [{ id: 'leg-press', type: 'text/html', updatedAt: 1 }, { id: 'hip-thrust-machine', type: 'text/html', updatedAt: 1 }];
  const asked = [];
  const fetchOne = async (id) => { asked.push(id); return new Blob([`<html>${id}</html>`], { type: 'text/html' }); };
  assert.equal(await keepAllDemos(recs, fetchOne), 2);
  assert.equal(await keepAllDemos(recs, fetchOne), 0);
  assert.deepEqual(asked, ['leg-press', 'hip-thrust-machine']);
  assert.equal(await (await cachedClip('leg-press', recs[0])).text(), '<html>leg-press</html>');
  // The Mac changed one: only that one comes again, and the old copy goes.
  const changed = [{ ...recs[0], updatedAt: 2 }, recs[1]];
  assert.equal(await keepAllDemos(changed, fetchOne), 1);
  assert.equal(await cachedClip('leg-press', recs[0]), null);
  assert.ok(await cachedClip('leg-press', changed[0]));
  assert.deepEqual([...(await keptIds())].sort(), ['hip-thrust-machine', 'leg-press']);
});

test('Mac not reachable: keeps what it has and stops, the next call finishes the rest', async () => {
  globalThis.caches = fakeCaches();
  const { keepAllDemos } = await import('../app/js/lib/demos.js');
  const recs = ['a', 'b', 'c'].map((id) => ({ id, type: 'text/html', updatedAt: 1 }));
  let up = false;
  const fetchOne = async (id) => { if (!up && id === 'b') throw new Error('Mac unreachable.'); return new Blob([id]); };
  assert.equal(await keepAllDemos(recs, fetchOne), 1);
  up = true;
  assert.equal(await keepAllDemos(recs, fetchOne), 2);
  assert.equal(await keepAllDemos(recs, fetchOne, { stillOk: () => false }), 0);
});
