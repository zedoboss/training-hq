import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { openCoach, conversation, COL, PHOTOS, MAX_PHOTOS } from '../server/coach/index.mjs';
import { createApp } from '../server/app.mjs';
import { APP_DIR } from '../server/config.mjs';
import { systemPrompt, turnText, recapText, RULES } from '../server/coach/prompt.mjs';
import { readProfile } from '../server/coach/profile.mjs';

let dir; let store; let clock;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thq-coach-')); store = openStore(join(dir, 'db.sqlite')); clock = Date.UTC(2026, 9, 18, 9, 58); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

/** A fake process: answers with `reply(body)`, and can call the coach's tool server like Claude Code would. */
function fakeProcess(reply = () => 'Done.') {
  const p = { bodies: [], fresh: true, coachUrl: null };
  p.turn = async ({ content, onEvent }) => {
    const body = content({ fresh: p.fresh });
    p.fresh = false;
    p.bodies.push(body);
    const text = await reply(body, onEvent);
    onEvent({ type: 'text', delta: text });
    return { text, ms: 5, model: 'claude-sonnet-5-5' };
  };
  p.warm = () => true; p.stop = () => { p.fresh = true; return false; }; p.status = () => ({ running: true, busy: false }); p.close = () => {};
  return p;
}

const TOOL = {
  name: 'log_thing', title: 'Log a thing', description: 'x', inputSchema: { type: 'object', properties: {} },
  run: async (args, ctx) => { ctx.action({ kind: 'rest', seconds: 180 }); return { text: 'logged', summary: 'Squat 60 kg × 8', wrote: true }; },
};

test('a message and its reply are saved for every device, with the tools used and the phone actions', async () => {
  let coach;
  const proc = fakeProcess(async () => { await coach._callTool(TOOL, {}); return 'Logged: squat 60 kg for 8.'; });
  coach = openCoach({ store, tools: [TOOL], process: proc, now: () => clock++, tz: 'Asia/Ho_Chi_Minh' });
  const events = [];
  const msg = await coach.send({ text: '  60 for 8 ', deviceId: 'a1b2c3d4e5f6', emit: (e) => events.push(e) });
  assert.equal(msg.role, 'assistant');
  assert.equal(msg.text, 'Logged: squat 60 kg for 8.');
  assert.deepEqual(msg.tools.map((t) => [t.name, t.summary, t.ok, t.wrote]), [['log_thing', 'Squat 60 kg × 8', true, true]]);
  assert.deepEqual(msg.actions, [{ kind: 'rest', seconds: 180 }, { kind: 'sync' }], 'a write also tells the phone to sync');
  assert.deepEqual(events.map((e) => e.type), ['user', 'action', 'tool', 'action', 'text', 'done']);
  const saved = conversation(store);
  assert.deepEqual(saved.map((m) => [m.role, m.text]), [['user', '60 for 8'], ['assistant', 'Logged: squat 60 kg for 8.']]);
  assert.equal(saved[0].device, 'a1b2c3d4e5f6');
  assert.equal(saved[0].turnId, saved[1].turnId);
  assert.ok(saved[0].id < saved[1].id, 'ids sort in time order');
  // The context block carries the time with weekday, in his time zone.
  assert.match(proc.bodies[0], /^60 for 8\n\n<context>\nNow: Sunday 10\/18, 4:58 PM \(2026-10-18, time zone Asia\/Ho_Chi_Minh\)\.\n<\/context>$/);
  await coach.close();
});

test('a fresh process gets a recap of the conversation since the last "new conversation"', async () => {
  const proc = fakeProcess();
  const coach = openCoach({ store, process: proc, now: () => clock++, tz: 'UTC', context: () => 'Today: Legs.' });
  await coach.send({ text: 'first' });
  assert.doesNotMatch(proc.bodies[0], /earlier-conversation/, 'nothing to recap yet');
  assert.match(proc.bodies[0], /Today: Legs\./);
  proc.fresh = true; // e.g. a model switch restarted it
  await coach.send({ text: 'second' });
  assert.match(proc.bodies[1], /<earlier-conversation[^>]*>\nHe: first\nYou: Done\.\n<\/earlier-conversation>\n\nsecond/);
  coach.newConversation();
  await coach.send({ text: 'third' });
  assert.doesNotMatch(proc.bodies[2], /first/, 'the new conversation starts clean');
  assert.deepEqual(conversation(store).map((m) => m.text), ['third', 'Done.']);
  assert.equal(store.listRecords(COL).length, 7, 'older messages stay in the log');
  await coach.close();
});

// Fri 10/23, his words: "I want to be able to attach images here in this chat... photos of the meal".
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
test('photos sent in Talk: saved for every device, sent to Claude as images with their ids and his usual foods', async () => {
  store.writeLocal('fuel', 'plan', { kind: 'plan', foods: [{ name: 'Eggs', fdcId: 1 }, { name: 'Butter', cooks: { Eggs: 10 } }] });
  const proc = fakeProcess(() => 'Logged.');
  const coach = openCoach({ store, process: proc, now: () => clock++, tz: 'UTC' });
  const takenAt = clock - 10 * 60000;
  const events = [];
  await coach.send({ text: 'lunch', images: [{ dataUrl: JPEG, at: takenAt }], emit: (e) => events.push(e) });
  const [msg] = conversation(store);
  assert.equal(msg.photos.length, 1);
  assert.deepEqual(events[0].message.photos, msg.photos, 'the phone learns the photo ids at once');
  const photo = store.getRecord(PHOTOS, msg.photos[0]).data;
  assert.deepEqual([photo.messageId, photo.dataUrl, photo.at], [msg.id, JPEG, takenAt]);
  const body = proc.bodies[0];
  assert.ok(Array.isArray(body), 'content blocks, not a string');
  assert.deepEqual(body[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } });
  assert.equal(body[1].type, 'text');
  assert.match(body[1].text, new RegExp(`^\\[He attached a photo in Talk: ${photo.id.replace(/\./g, '\\.')} \\(taken 9:48 AM\\)\\. They are above\\. Sent 9:58 AM: a meal from them is logged at that time \\(leave time out\\), not when taken, unless he says he ate earlier\\.\\]`));
  assert.match(body[1].text, /Foods he often eats .*Eggs \[fdcId 1\]/);
  assert.match(body[1].text, /He cooks Eggs in about 10 g of Butter/);
  assert.match(body[1].text, /\nlunch\n\n<context>/);
  // A photo alone is a message; junk, too many and a camera clock in the future are cleaned up.
  await coach.send({ images: [JPEG, 'data:text/html;base64,PGI+', { dataUrl: JPEG, at: clock + 86400000 }, JPEG, JPEG, JPEG] });
  const two = conversation(store).at(-2);
  assert.equal(two.text, '');
  assert.equal(two.photos.length, MAX_PHOTOS - 1, 'the html one dropped, the sixth past the limit');
  assert.ok(two.photos.every((id) => store.getRecord(PHOTOS, id).data.at <= two.at), 'never taken after it was sent');
  await assert.rejects(coach.send({ text: ' ', images: ['nope'] }), /Nothing to send/);
  // A fresh process hears there were photos.
  proc.fresh = true;
  await coach.send({ text: 'and?' });
  assert.match(proc.bodies.at(-1), /He: \[sent a photo: cphoto\.[^\]]+\] lunch\n/);
  assert.match(proc.bodies.at(-1), /He: \[sent 3 photos: /);
  await coach.close();
});

test('an error becomes a saved reply marked as an error', async () => {
  const proc = fakeProcess();
  proc.turn = async () => { throw new Error('Claude Code on the Mac is not logged in. Open the Claude app on the Mac once.'); };
  const coach = openCoach({ store, process: proc, now: () => clock++ });
  const msg = await coach.send({ text: 'hi' });
  assert.equal(msg.error, true);
  assert.match(msg.text, /not logged in/);
  await assert.rejects(coach.send({ text: '   ' }), /Nothing to send/);
  await coach.close();
});

test('the rules come from the brief and his profile is added from the private folder', () => {
  for (const s of ['Lead with the answer', 'H:MM AM or PM', 'total kg including the bar', 'rating out of 10', 'Never recommend a supplement or a dose', 'never suggest one more round', 'not a medical app']) {
    assert.ok(RULES.includes(s) || RULES.toLowerCase().includes(s.toLowerCase()), s);
  }
  assert.equal(systemPrompt({ profile: '' }), RULES);
  assert.match(systemPrompt({ profile: 'Name: X' }), /HIS PROFILE[^\n]*\nName: X$/);
  assert.equal(readProfile(dir), '');
  mkdirSync(join(dir, 'coach'));
  writeFileSync(join(dir, 'coach', 'profile.md'), 'He trains at 4 AM.');
  assert.equal(readProfile(dir), 'He trains at 4 AM.');
  assert.equal(recapText([{ role: 'user', text: 'a\n b' }, { role: 'assistant', text: 'x', error: true }, { role: 'marker', text: 'New' }]), 'He: a b');
  assert.match(turnText({ text: 'hi', now: Date.UTC(2026, 0, 1, 0, 5), tz: 'UTC' }), /Now: Thursday 1\/1, 12:05 AM \(2026-01-01/);
});

test('the chat routes: streamed reply, status, new conversation; a token is needed', async () => {
  const proc = fakeProcess(async (body, onEvent) => { onEvent({ type: 'text', delta: 'Hi' }); return 'Hi.'; });
  const coach = openCoach({ store, process: proc, now: () => clock++ });
  const server = createApp({ store, appDir: APP_DIR, coach });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { code } = store.createPairingCode();
  const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, deviceId: 'a1b2c3d4e5f6', name: 'iPhone' }) })).json();
  const post = (path, body, t = token) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await post('/api/coach/send', { text: 'hi' }, 'nope')).status, 401);
  assert.equal((await post('/api/coach/send', { text: ' ' })).status, 400);
  assert.equal((await post('/api/coach/send', { text: ' ', images: [JPEG] })).status, 200, 'a photo alone is sent');
  const res = await post('/api/coach/send', { text: 'hi', model: 'deep', tz: 'Asia/Ho_Chi_Minh' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /ndjson/);
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.type), ['user', 'text', 'text', 'done']);
  assert.equal(lines.at(-1).message.text, 'Hi.');
  assert.equal(lines.at(-1).message.model, 'deep');
  assert.equal(lines[0].message.device, 'a1b2c3d4e5f6');
  const st = await (await fetch(`${base}/api/coach/status`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(st.models.fast, 'Sonnet 5.5 · medium');
  assert.equal(st.models.deep, 'Opus 5.5 · high');
  assert.equal((await (await post('/api/coach/new', {})).json()).marker.role, 'marker');
  assert.equal((await (await post('/api/coach/warm', { model: 'fast' })).json()).started, true);
  server.close();
  await coach.close();
});

test('a new day is a fresh chat with the day before in short (Tue 10/20)', async () => {
  const { daySummary } = await import('../server/coach/prompt.mjs');
  const proc = fakeProcess();
  clock = Date.UTC(2026, 0, 20, 10, 0);
  const coach = openCoach({ store, process: proc, now: () => clock, tz: 'UTC' });
  await coach.send({ text: 'I had eggs' }); clock += 60000;
  await coach.send({ text: '80 for 8' }); clock += 60000;
  // Next day, 10:00 AM: the process is stopped, a marker with the summary is saved, and the fresh body carries it.
  clock = Date.UTC(2026, 0, 21, 10, 0);
  await coach.send({ text: 'morning' });
  const marker = store.listRecords(COL).map((r) => r.data).find((m) => m.role === 'marker');
  assert.equal(marker.text, 'New day');
  assert.match(marker.summary, /^Tuesday 1\/20: 4 messages\.\nHe said \(latest last\): "I had eggs" · "80 for 8"\nYour last words to him: "Done\."$/);
  assert.match(proc.bodies.at(-1), /The day before, in short:\nTuesday 1\/20: 4 messages/);
  assert.doesNotMatch(proc.bodies.at(-1), /He: I had eggs/, 'the raw day-before messages are not replayed');
  assert.deepEqual(conversation(store).map((m) => m.text), ['morning', 'Done.']);
  // The same day again: no new marker.
  clock += 60000;
  await coach.send({ text: 'again' });
  assert.equal(store.listRecords(COL).map((r) => r.data).filter((m) => m.role === 'marker').length, 1);
  assert.equal(daySummary([]), '');
  await coach.close();
});
