import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineReader, conversationOf, messagesOf, runAction, todayCounts, toolLabel, textHtml, MODEL_LABEL } from '../app/js/lib/coach.js';

test('the reply stream is split into events, whatever the chunk boundaries', () => {
  const got = [];
  const r = lineReader((e) => got.push(e));
  r.push('{"type":"user"}\n{"type":"te');
  r.push('xt","delta":"Hi"}\n\nnot json\n{"type":"do');
  r.push('ne"}');
  assert.deepEqual(got.map((e) => e.type), ['user', 'text']);
  r.end();
  assert.deepEqual(got.map((e) => e.type), ['user', 'text', 'done']);
});

test('the conversation: stored and live messages merged by id, after the last new-conversation marker', () => {
  const stored = [{ id: 'cm.1', role: 'user', text: 'old', at: 1 }, { id: 'cm.2', role: 'marker', at: 2 }, { id: 'cm.3', role: 'user', text: 'hi', at: 3 }];
  const live = [{ id: 'cm.4', role: 'assistant', text: 'Hey.', at: 4 }, { id: 'cm.3', role: 'user', text: 'hi', at: 3, device: 'x' }];
  assert.deepEqual(conversationOf(stored, live).map((m) => m.id), ['cm.3', 'cm.4']);
  assert.equal(conversationOf(stored, live)[0].device, 'x');
});

test('Talk by day: every message stays, markers included (Thu 10/22: past days showed "Nothing on this day")', () => {
  const stored = [{ id: 'cm.1', role: 'user', text: 'Wednesday', at: 1 }, { id: 'cm.2', role: 'marker', text: 'New day', at: 2 }, { id: 'cm.3', role: 'user', text: 'Thursday', at: 3 }];
  const live = [{ id: 'cm.3', role: 'user', text: 'Thursday', at: 3, device: 'x' }];
  assert.deepEqual(messagesOf(stored, live).map((m) => m.id), ['cm.1', 'cm.2', 'cm.3']);
  assert.equal(messagesOf(stored, live)[2].device, 'x');
});

test('phone actions: rest timer, sync and focus run here; open is a button', () => {
  const calls = [];
  const deps = { rest: { start: (s, l) => calls.push(['start', s, l]), adjust: (s) => calls.push(['adjust', s]), clear: () => calls.push(['clear']) }, sync: () => calls.push(['sync']), focus: (a) => calls.push(['focus', a.exKey]) };
  assert.equal(runAction({ kind: 'rest', seconds: 180, label: 'Squat' }, deps), true);
  runAction({ kind: 'rest-add', seconds: -15 }, deps);
  runAction({ kind: 'rest-skip' }, deps);
  runAction({ kind: 'sync' }, deps);
  runAction({ kind: 'focus', exKey: 'e2' }, deps);
  assert.equal(runAction({ kind: 'open', url: '#/x' }, deps), false);
  assert.equal(runAction({ kind: 'rest', seconds: 0 }, deps), false);
  assert.deepEqual(calls, [['start', 180, 'Squat'], ['adjust', -15], ['clear'], ['sync'], ['focus', 'e2']]);
});

test('today counts, tool labels, safe text', () => {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const t = Date.UTC(2026, 0, 20, 5);
  const msgs = [{ role: 'assistant', at: t, tools: [{ ok: true }, { ok: false }] }, { role: 'assistant', at: t, error: true }, { role: 'user', at: t }, { role: 'assistant', at: t - 86400000, tools: [{ ok: true }] }];
  assert.deepEqual(todayCounts(msgs, '2026-01-20', day), { turns: 2, tools: 2, errors: 2 });
  assert.equal(toolLabel({ name: 'log_set', title: 'Log a set' }), 'LOG A SET');
  assert.equal(textHtml('a <b>\nc'), 'a &lt;b&gt;<br>c');
  assert.equal(textHtml('- **Legs not done today:** Monday'), '- <b>Legs not done today:</b> Monday');
  assert.equal(textHtml('2 * 3 = 6 **'), '2 * 3 = 6 **');
  assert.equal(MODEL_LABEL.fast, 'SONNET 5.5 · MEDIUM');
});

test('the coach works the app (Tue 10/20): screens, the microphone, an update; only the app\'s own links', async () => {
  const { screenOf, safeHash, SCREENS } = await import('../app/js/lib/screens.js');
  const done = [];
  const deps = { go: (u) => done.push(['go', u]), micOff: () => done.push(['mic-off']), reload: () => done.push(['reload']) };
  assert.equal(runAction({ kind: 'go', url: '#/coach' }, deps), true);
  assert.equal(runAction({ kind: 'go', url: 'https://example.com' }, deps), false);
  assert.equal(runAction({ kind: 'go', url: '#/../x' }, deps), false);
  assert.equal(runAction({ kind: 'mic-off' }, deps), true);
  assert.equal(runAction({ kind: 'reload' }, deps), true);
  assert.equal(runAction({ kind: 'go', url: '#/coach' }, {}), false, 'a device without the dep does nothing');
  assert.deepEqual(done, [['go', '#/coach'], ['mic-off'], ['reload']]);
  assert.equal(safeHash('javascript:alert(1)'), null);
  assert.equal(screenOf('#/session/abc').id, 'session');
  assert.equal(screenOf('#/body/scan/r/2026-10-20').id, 'body_scan_results');
  assert.equal(screenOf('#/supps/plan').id, 'supplements_plan');
  assert.equal(screenOf('#/').id, 'today');
  assert.equal(new Set(SCREENS.map((s) => s.id)).size, SCREENS.length);
});
