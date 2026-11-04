// Thu 11/5 (the nightly review of Wednesday, his words on the 6:50 AM "Morning: Banana, bathroom, then stretch and get
// some sunlight... Gym 6:39 AM to 7:09 AM"): "How did you sleep?" at 5:39 AM and his body at 6:10 AM went unanswered,
// then the morning plan and the 7:10 AM scan checklist went out anyway, and the plan quoted a gym window that had
// already begun. He wants: with no answer to the sleep or body ask, the plan and scan checklist wait until he replies;
// never a session time that has already begun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { startNotifier, morningGate, noteAppOpen } from '../server/notify.mjs';
import { nudgeCandidates } from '../app/js/lib/nudges.js';

const TZ = 'Asia/Ho_Chi_Minh';
const Y = '2026-03-17';
const D = '2026-03-18';
const at = (d, hm) => Date.parse(`${d}T${hm}:00+07:00`);
const T = (hm) => at(D, hm);
const hmOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const ROUTINE = 'Banana, bathroom, then stretch and get some sunlight';

function wednesday() {
  const dir = mkdtempSync(join(tmpdir(), 'thq-morning-reply-'));
  const store = openStore(join(dir, 'db.sqlite'));
  store.writeLocal('settings', 'main', {
    notify: { movingDay: false, wakeHm: '05:30', bedHm: '22:00', nudgeEveryMin: 20, kinds: { walk: false }, morning: { text: ROUTINE, gymAfterMin: [60, 90] } },
  });
  store.writeLocal('scan-plan', 'main', { cadence: 'training', protocol: { items: [{ id: 'bath', when: 'day', text: 'Bathroom first.' }] } });
  // Pull yesterday: a training day today, no time set.
  store.writeLocal('sessions', 'pull', { id: 'pull', kind: 'workout', dayType: 'pull', status: 'done', startedAt: at(Y, '05:00'), endedAt: at(Y, '06:00'), exercises: [] });
  const sent = [];
  let now = T('05:00');
  const push = { list: () => [{}], notify: async (m) => { sent.push({ ...m, at: now }); return { sent: 1, failed: 0 }; } };
  const n = startNotifier({ store, push, tz: TZ, now: () => now, everyMs: 1e9 });
  n.stop();
  const run = async (from, to) => { for (let t = T(from); t <= T(to); t += 60000) { now = t; await n.tick(); } };
  const say = (hm, text) => { const t = T(hm); store.writeLocal('coach-messages', `u${t}`, { id: `u${t}`, role: 'user', text, at: t }); };
  const opens = (hm) => { store.writeLocal('here', 'iphone', { phone: true, tz: TZ, at: T(hm) }); noteAppOpen(store, T(hm), TZ); };
  const talk = () => store.listRecords('coach-messages').map((r) => r.data).filter((m) => m.role === 'assistant').sort((a, b) => a.at - b.at);
  const said = () => [...sent.map((m) => m.body), ...talk().map((m) => m.text)];
  const done = () => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  return { store, sent, run, say, opens, talk, said, done };
}

test('his Wednesday replayed: sleep and body asks unanswered, no morning plan, no scan checklist, nothing else, until he replies', async () => {
  const f = wednesday();
  try {
    f.opens('05:39');
    await f.run('05:39', '05:39');
    assert.ok(f.said().some((t) => /How did you sleep\?/.test(t)), f.said().join(' | '));
    await f.run('05:40', '06:30');
    assert.ok(f.sent.some((m) => /^How does your body feel today\?/.test(m.body)), 'the body question still comes after the sleep one is left');
    const before = f.said().length;
    await f.run('06:31', '11:00');
    assert.deepEqual(f.said().slice(before), [], 'nothing else while both questions wait, 4 hours on and more');
    assert.equal(morningGate(f.store, T('11:00'), TZ).hold, true);
    // He replies at 11:05 AM: the day goes on, the scan checklist with it (he hasn't trained yet).
    f.say('11:05', 'slept ok, body 0');
    await f.run('11:05', '12:00');
    assert.equal(morningGate(f.store, T('12:00'), TZ).hold, false);
    assert.ok(f.sent.some((m) => /^Body scan today, before you train/.test(m.body)), f.sent.map((m) => `${hmOf(m.at)} ${m.body}`).join(' | '));
    assert.equal(f.talk().filter((m) => /How did you sleep|How does your body/.test(m.text)).length, 2, 'each question once');
  } finally { f.done(); }
});

test('he answers both in time: the morning plan as before, with the gym window while it is still ahead', async () => {
  const f = wednesday();
  try {
    f.opens('05:39');
    await f.run('05:39', '05:39');
    f.say('05:41', 'slept 8 hours');
    f.store.writeLocal('sleep-log', D, { id: D, date: D, bed: at(Y, '21:30'), wake: T('05:30'), source: 'coach', at: T('05:41') });
    await f.run('05:40', '05:50');
    const body = f.said().find((t) => /How does your body feel today\?/.test(t));
    assert.ok(body, f.said().join(' | '));
    f.say('05:52', 'all 0');
    await f.run('05:51', '06:30');
    const plan = f.sent.find((m) => /^Morning: /.test(m.body));
    assert.ok(plan, f.sent.map((m) => `${hmOf(m.at)} ${m.body}`).join(' | '));
    // His sleep says he woke 5:30 AM: gym 6:30 to 7:00 AM, said before it begins.
    assert.ok(plan.at < T('06:30'));
    assert.match(plan.body, /Gym 6:30 AM to 7:00 AM\./);
  } finally { f.done(); }
});

test('the morning plan never quotes a gym window that has begun; the "no time set" ask neither', () => {
  const base = { tz: TZ, rot: { today: { kind: 'train', dayType: 'legs' } }, wakeHm: '05:30', bedHm: '22:00', sleepLogged: true, wokeAt: T('05:39'), morning: { text: ROUTINE, gymAfterMin: [60, 90] } };
  const morning = (hm) => nudgeCandidates({ ...base, now: T(hm) }).find((c) => c.key === 'morning')?.text;
  const open = (hm) => nudgeCandidates({ ...base, now: T(hm) }).find((c) => c.key.startsWith('session:'))?.text;
  assert.equal(morning('06:20'), `Morning: ${ROUTINE}. Gym 6:39 AM to 7:09 AM.`);
  assert.equal(morning('06:38'), `Morning: ${ROUTINE}. Gym 6:39 AM to 7:09 AM.`);
  for (const hm of ['06:39', '06:50', '07:05']) {
    assert.equal(morning(hm), `Morning: ${ROUTINE}.`, hm);
    assert.doesNotMatch(open(hm), /Your plan|6:39|7:09/, hm);
  }
  assert.match(open('06:20'), /Your plan: 6:39 AM to 7:09 AM\./);
});
