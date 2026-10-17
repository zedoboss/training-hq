import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, formatHlc, parseHlc, newer, newDeviceId, isDeviceId } from '../app/js/lib/hlc.js';
import { openRepo, memoryAdapter } from '../app/js/lib/repo.js';

const DEV_A = 'aaaaaaaaaaaa';
const DEV_B = 'bbbbbbbbbbbb';

test('clock stamps always increase, even if the wall clock goes backwards', () => {
  let t = 1_000_000;
  const c = createClock(DEV_A, undefined, () => t);
  const s1 = c.tick();
  t -= 5000; // phone clock jumps back 5 s
  const s2 = c.tick();
  const s3 = c.tick();
  assert.ok(s1 < s2 && s2 < s3);
  assert.equal(parseHlc(s3).counter, 2);
});

test('clock moves past stamps from a device whose clock is ahead', () => {
  let t = 1_000_000;
  const c = createClock(DEV_A, undefined, () => t);
  const ahead = formatHlc(9_000_000, 4, DEV_B);
  c.receive(ahead);
  assert.ok(c.tick() > ahead);
});

test('clock resumes from saved state after a reload', () => {
  const t = 1_000_000;
  const c1 = createClock(DEV_A, undefined, () => t);
  c1.tick(); c1.tick();
  const c2 = createClock(DEV_A, c1.state(), () => t);
  assert.ok(c2.tick() > formatHlc(t, 1, DEV_A));
});

test('device ids are 12 lowercase hex characters', () => {
  const id = newDeviceId();
  assert.ok(isDeviceId(id), id);
  assert.throws(() => createClock('short'));
});

test('merge rule: newer stamp wins; device id breaks a tie on the same millisecond and counter', () => {
  const a = { hlc: formatHlc(5, 0, DEV_A) };
  const b = { hlc: formatHlc(5, 0, DEV_B) };
  assert.equal(newer(b, a), true);
  assert.equal(newer(a, b), false);
  assert.equal(newer(a, undefined), true);
});

test('local write lands in records and outbox together; ack clears the outbox', async () => {
  const repo = await openRepo(memoryAdapter());
  await repo.put('sets', 's1', { kg: 43.8, reps: 8 });
  assert.deepEqual(await repo.get('sets', 's1'), { kg: 43.8, reps: 8 });
  const out = await repo.outbox();
  assert.equal(out.length, 1);
  assert.equal(out[0].rec.device, repo.device);
  await repo.ack(out.map((o) => o.key));
  assert.equal(await repo.pendingCount(), 0);
  assert.deepEqual(await repo.get('sets', 's1'), { kg: 43.8, reps: 8 }, 'data stays after ack');
});

test('delete is a tombstone, not an erase', async () => {
  const adapter = memoryAdapter();
  const repo = await openRepo(adapter);
  await repo.put('sets', 's1', { kg: 40 });
  await repo.remove('sets', 's1');
  assert.equal(await repo.get('sets', 's1'), null);
  assert.deepEqual(await repo.list('sets'), []);
  const raw = await adapter.getRecord('sets', 's1');
  assert.equal(raw.deleted, true);
  assert.equal(await repo.pendingCount(), 2, 'both the write and the delete are queued for the Mac');
});

test('an older remote version never overwrites a newer local edit', async () => {
  const repo = await openRepo(memoryAdapter());
  const local = await repo.put('sets', 's1', { kg: 45 });
  const olderRemote = { col: 'sets', id: 's1', data: { kg: 40 }, deleted: false, hlc: formatHlc(1, 0, DEV_B), device: DEV_B };
  await repo.applyRemote([olderRemote]);
  assert.deepEqual(await repo.get('sets', 's1'), { kg: 45 });
  assert.ok(local.hlc > olderRemote.hlc);
});

test('a newer remote version replaces the local one and later local stamps beat it', async () => {
  const repo = await openRepo(memoryAdapter());
  await repo.put('sets', 's1', { kg: 45 });
  const future = Date.now() + 3_600_000;
  const newerRemote = { col: 'sets', id: 's1', data: { kg: 47.5 }, deleted: false, hlc: formatHlc(future, 0, DEV_B), device: DEV_B };
  const cols = await repo.applyRemote([newerRemote]);
  assert.deepEqual(cols, ['sets']);
  assert.deepEqual(await repo.get('sets', 's1'), { kg: 47.5 });
  const next = await repo.put('sets', 's1', { kg: 50 });
  assert.ok(next.hlc > newerRemote.hlc, 'clock moved past the remote stamp');
});

test('device id and clock survive reopening the same storage', async () => {
  const adapter = memoryAdapter();
  const r1 = await openRepo(adapter);
  const w1 = await r1.put('x', '1', {});
  const r2 = await openRepo(adapter);
  assert.equal(r2.device, r1.device);
  const w2 = await r2.put('x', '2', {});
  assert.ok(w2.hlc > w1.hlc);
});

test('change listeners hear local and remote changes', async () => {
  const repo = await openRepo(memoryAdapter());
  const heard = [];
  const origins = [];
  repo.onChange((cols, origin) => { heard.push(...cols); origins.push(origin); });
  await repo.put('a', '1', {});
  await repo.applyRemote([{ col: 'b', id: '1', data: {}, deleted: false, hlc: formatHlc(Date.now() + 9e6, 0, DEV_B), device: DEV_B }]);
  assert.deepEqual(heard, ['a', 'b']);
  assert.deepEqual(origins, ['local', 'remote']);
});
