// Thu 10/22 at the gym: the rest ended with no sound. The Mac sends "Rest over" to that phone; the phone plays timer
// sounds as a sound file through an unlocked audio element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openRestPush, restBody, META } from '../server/rest-push.mjs';
import { wavOf } from '../app/js/lib/sounds.js';

test('rest over: sent to that phone when the rest ends, moved by ±15 s, cancelled by skip, off with its switch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-rest-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let clock = 1_800_000_000_000;
    const sent = [];
    const push = { notify: async (m, o) => { sent.push({ ...m, deviceId: o.deviceId }); return { sent: 1 }; } };
    const r = openRestPush({ store, push, now: () => clock });
    assert.deepEqual(r.set('phone', { endsAt: clock + 90000, label: 'Squat (Smith Machine)', url: '#/session/s1' }), { endsAt: clock + 90000, label: 'Squat (Smith Machine)', url: '#/session/s1' });
    r.set('mac', { endsAt: clock + 60000, label: 'Bench', url: 'javascript:alert(1)' });
    assert.equal(r.list().mac.url, '#/train', 'only app screens');
    r.set('mac', { endsAt: null });
    assert.equal(r.list().mac, undefined, 'skip cancels');
    assert.equal(r.set('phone2', { endsAt: clock + 3 * 3600000 }), null, 'not hours ahead');
    clock += 89000;
    assert.equal(await r.tick(), 0);
    clock += 1500;
    assert.equal(await r.tick(), 1);
    assert.deepEqual(sent, [{ title: 'Rest over', body: 'Rest over. Squat (Smith Machine): next set.', url: '#/session/s1', tag: 'rest', deviceId: 'phone' }]);
    assert.equal(await r.tick(), 0, 'once');
    assert.deepEqual(store.getMeta(META), {});
    // A restart mid-rest: the alarm is in the database, a new sender sends it.
    r.set('phone', { endsAt: clock + 30000, label: 'Bench' });
    const again = openRestPush({ store, push, now: () => clock + 31000 });
    assert.equal(await again.tick(), 1);
    // Switched off in Settings, or minutes late: nothing.
    store.writeLocal('settings', 'main', { notify: { kinds: { rest: false } } });
    r.set('phone', { endsAt: clock + 1000 });
    clock += 2000;
    assert.equal(await r.tick(), 0);
    assert.equal(sent.length, 2);
    assert.equal(restBody(''), 'Rest over. Next set.');
    // Sat 10/24: the phone sends the set the rest leads to; that is what the notification says.
    r.set('phone', { endsAt: clock + 120000, label: 'Cupping', next: 'Crunch (Machine): set 1, 23 kg × 10-15', url: '#/session/s1' });
    assert.equal(r.list().phone.rest[0].body, 'Rest over. Crunch (Machine): set 1, 23 kg × 10-15.');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('timer sounds as a sound file: a 16-bit mono WAV of the notes, loud, silent at the end', () => {
  const b = wavOf([[0, 880, 0.22], [0.28, 880, 0.22], [0.56, 1320, 0.22]], 80, 22050);
  const v = new DataView(b);
  assert.equal(String.fromCharCode(...new Uint8Array(b.slice(0, 4))), 'RIFF');
  assert.equal(String.fromCharCode(...new Uint8Array(b.slice(8, 12))), 'WAVE');
  assert.equal(v.getUint32(24, true), 22050);
  assert.equal(v.getUint16(34, true), 16);
  const n = v.getUint32(40, true) / 2;
  assert.equal(n, Math.ceil((0.56 + 0.22 + 0.05) * 22050));
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(v.getInt16(44 + i * 2, true)));
  assert.ok(peak > 0.65 * 32767, `loud enough (${peak})`);
  assert.equal(v.getInt16(44 + (n - 1) * 2, true), 0, 'ends silent');
  assert.equal(wavOf([[0, 880, 0.2]], 0).byteLength > 44, true);
});

test('a hold: "go" when GET READY ends and "stop" at zero, sent to that phone; an early stop cancels both (Thu 10/22)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-hold-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    let clock = 1_800_000_000_000;
    const sent = [];
    const r = openRestPush({ store, push: { notify: async (m, o) => { sent.push(`${m.title}|${m.tag}|${o.deviceId}`); return { sent: 1 }; } }, now: () => clock });
    r.set('phone', { endsAt: clock + 120000, label: 'Squat' });
    r.setAlarms('phone', 'hold', [{ at: clock + 15000, title: 'Hold: go', body: 'Leg Extension Hold (Machine): hold 30 s now.' }, { at: clock + 45000, title: 'Hold: stop', body: 'Leg Extension Hold (Machine): 30 s done. Stop.' }]);
    clock += 15500; await r.tick();
    clock += 30000; await r.tick();
    assert.deepEqual(sent, ['Hold: go|hold|phone', 'Hold: stop|hold|phone']);
    assert.ok(r.list().phone.rest, 'the rest is still waiting');
    r.setAlarms('phone', 'hold', [{ at: clock + 15000, title: 'Hold: go', body: 'x' }]);
    r.setAlarms('phone', 'hold', []);
    clock += 20000; await r.tick();
    assert.equal(sent.length, 2, 'cancelled');
    assert.deepEqual(r.setAlarms('phone', 'sauna', [{ at: clock + 1000, title: 'x' }]), [], 'only known kinds');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
