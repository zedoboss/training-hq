// Voice (step 9): WAV helpers, the voice lock's decision, the voiceprint, and the voice routes with a fake engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav, decodeWav, resample, rms, normalise, pcm16ToFloat, VOICE_RATE } from '../app/js/lib/wav.js';
import { decide } from '../server/voice/gate.mjs';
import { openVoiceprint, scoreAgainst, summary, ROUND_MIN, STRICTNESS } from '../server/voice/voiceprint.mjs';
import { tagLevels, cosine } from '../server/voice/engine.mjs';
import { openVoice } from '../server/voice/index.mjs';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { APP_DIR } from '../server/config.mjs';

// A made-up clip: who is speaking is written into the samples as a level the fake engine reads back.
const clip = ({ who = 1, sec = 1.5, music = 0 } = {}) => {
  const s = new Float32Array(Math.round(VOICE_RATE * sec));
  s.fill(who / 100);
  s[50] = music / 2;
  return s;
};
const fakeEngine = () => ({
  status: () => ({ ready: true, missing: [], error: null }),
  analyse(samples) {
    const who = Math.round(samples[1000] * 100);
    const music = Math.round(samples[50] * 200) / 100;
    const emb = new Array(8).fill(0.02); emb[who % 8] = 1;
    const sec = samples.length / VOICE_RATE;
    return { sec, speechSec: sec, segments: 1, embedding: sec >= 0.3 ? emb : null, tags: { speech: 1 - music, music, singing: 0, top: [] }, ms: 1 };
  },
});

test('WAV: encode and decode round trip, resample, loudness', () => {
  const s = new Float32Array(1600).map((_, i) => Math.sin(i / 10) * 0.5);
  const back = decodeWav(encodeWav(s, 16000));
  assert.equal(back.sampleRate, 16000);
  assert.equal(back.samples.length, 1600);
  assert.ok(Math.abs(back.samples[123] - s[123]) < 1e-3);
  assert.equal(resample(s, 48000, 16000).length, 533);
  assert.equal(resample(s, 16000, 16000), s);
  assert.ok(Math.abs(rms(s) - 0.5 / Math.SQRT2) < 0.01);
  const loud = normalise(s);
  assert.ok(Math.abs(Math.max(...loud) - 0.9) < 0.01);
  assert.throws(() => decodeWav(new Uint8Array(20)), /not a WAV/);
  const pcm = new Uint8Array([0, 0x40, 0, 0xc0, 7]);
  assert.deepEqual(Array.from(pcm16ToFloat(pcm)), [0.5, -0.5]);
});

test('voice lock decision: noise, music, singing, not sure, not him, him', () => {
  const a = (speechSec, speech, music, singing = 0) => ({ speechSec, tags: { speech, music, singing } });
  assert.equal(decide(a(0.2, 0.9, 0), 0.9, 0.5).reason, 'noise');
  assert.equal(decide(a(2, 0.2, 0.7), 0.9, 0.5).reason, 'music');
  assert.equal(decide(a(2, 0.3, 0.4, 0.5), 0.9, 0.5).reason, 'music');
  assert.equal(decide(a(2, 0.05, 0.1), 0.9, 0.5).reason, 'music');
  assert.equal(decide(a(2, 0.8, 0), null, 0.5).reason, 'unsure');
  assert.deepEqual(decide(a(2, 0.8, 0.3), 0.41, 0.5), { ok: false, reason: 'not-you', score: 0.41 });
  // Him talking over music in the gym: speech beats music, so the voice check decides.
  assert.deepEqual(decide(a(2, 0.7, 0.5), 0.66, 0.5), { ok: true, reason: 'you', score: 0.66 });
});

test('tag levels group AudioSet names; cosine', () => {
  const l = tagLevels([{ name: 'Speech', prob: 0.6 }, { name: 'Music', prob: 0.3 }, { name: 'Male singing', prob: 0.2 }, { name: 'Speech synthesizer', prob: 0.8 }, { name: 'Computer keyboard', prob: 0.9 }]);
  assert.equal(l.speech, 0.8);
  assert.equal(l.music, 0.3);
  assert.equal(l.singing, 0.2);
  assert.equal(l.top[0].name, 'Computer keyboard');
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('voiceprint: rounds, odd ones out, scores, tests, start again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-voice-'));
  try {
    const vp = openVoiceprint(join(dir, 'voice'));
    const eng = fakeEngine();
    const add = (who, condition = 'home', t = 1000) => { const s = clip({ who }); return vp.addSample({ condition, samples: s, analysis: eng.analyse(s), now: t }); };
    assert.equal(add(1, 'home', 1).ok, true);
    assert.equal(vp.addSample({ condition: 'home', samples: clip({ sec: 0.2 }), analysis: eng.analyse(clip({ sec: 0.2 })) }).problem, 'too-short');
    assert.throws(() => add(1, 'car'), /home or gym/);
    for (let i = 2; i < ROUND_MIN; i++) add(1, 'home', i);
    // Someone else reading a phrase is refused once there are a few of his.
    assert.equal(add(3, 'home', 50).problem, 'not-like-the-others');
    let s = vp.summary('strict');
    assert.equal(s.rounds.home.count, ROUND_MIN - 1);
    assert.equal(s.calibrated, false);
    add(1, 'home', 100);
    s = vp.summary('strict');
    assert.equal(s.calibrated, true);
    assert.equal(s.canListen, false, 'listening stays off until a test passed');
    assert.equal(vp.read().calibratedAt, 100);
    assert.ok(readdirSync(join(dir, 'voice', 'samples')).length === ROUND_MIN);
    assert.equal((statSync(vp.file).mode & 0o777).toString(8), '600');
    // Scores: him near 1, someone else near 0.
    assert.ok(vp.score(eng.analyse(clip({ who: 1 })).embedding) > 0.9);
    assert.ok(vp.score(eng.analyse(clip({ who: 2 })).embedding) < 0.2);
    assert.equal(vp.score(null), null);
    vp.addTest({ kind: 'me', score: 0.95, threshold: 0.5, match: true, now: 200 });
    vp.addTest({ kind: 'other', score: 0.1, threshold: 0.5, match: false, now: 201 });
    s = vp.summary('strict');
    assert.equal(s.tested, true);
    assert.equal(s.canListen, true);
    assert.equal(s.tests.otherRejected, 1);
    assert.equal(s.self.missRate, 0);
    // A gym round adds to it without a new test.
    add(1, 'gym', 300);
    assert.equal(vp.summary().canListen, true);
    // Redoing the home round needs a new test.
    vp.removeSamples('home', 400);
    s = vp.summary();
    assert.equal(s.rounds.home.count, 0);
    assert.equal(s.rounds.gym.count, 1);
    assert.equal(s.canListen, false);
    assert.equal(vp.removeSamples(null, 500), 1);
    assert.equal(vp.summary().samples, 0);
    assert.equal(vp.read().tests.length, 0);
    assert.equal(readdirSync(join(dir, 'voice', 'samples')).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('score against: mean of the best three, skip one', () => {
  const samples = [{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [1, 0] }, { id: 'c', embedding: [0, 1] }, { id: 'd', embedding: [1, 0] }];
  assert.equal(scoreAgainst(samples, [1, 0]), 1);
  assert.equal(Math.round(scoreAgainst(samples, [1, 0], { skip: 'a' }) * 100) / 100, 0.67);
  assert.equal(scoreAgainst([], [1, 0]), null);
  assert.equal(summary({ samples: [] }, 'nonsense').strictness, 'strict');
  assert.equal(summary({ samples: [] }, 'relaxed').threshold, STRICTNESS.relaxed);
});

test('voice routes: status, calibration, test, forget; a token is needed; strictness from Settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-voice-'));
  const store = openStore(join(dir, 'db.sqlite'));
  const voice = openVoice({ store, dataDir: dir, engine: fakeEngine(), now: (() => { let t = 1000; return () => t++; })() });
  const server = createApp({ store, appDir: APP_DIR, voice });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { code } = store.createPairingCode();
    const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', body: JSON.stringify({ code, deviceId: 'a1b2c3d4e5f6', name: 'iPhone' }) })).json();
    const H = { authorization: `Bearer ${token}` };
    const wav = (o) => encodeWav(clip(o));
    const post = (path, body, type = 'audio/wav') => fetch(base + path, { method: 'POST', headers: { ...H, 'content-type': type }, body });
    assert.equal((await fetch(`${base}/api/voice/status`)).status, 401);
    let st = await (await fetch(`${base}/api/voice/status`, { headers: H })).json();
    assert.equal(st.calibrated, false);
    assert.equal(st.strictness, 'strict');
    assert.equal(st.engine.ready, true);
    // Testing before calibrating is refused.
    assert.equal((await post('/api/voice/test?kind=me', wav({ who: 1 }))).status, 409);
    for (let i = 0; i < ROUND_MIN; i++) {
      const r = await (await post(`/api/voice/enrol?condition=home&phrase=${encodeURIComponent('80 for 8')}`, wav({ who: 1 }))).json();
      assert.equal(r.ok, true);
    }
    assert.equal((await post('/api/voice/enrol?condition=home', new Uint8Array(30))).status, 400);
    let t = await (await post('/api/voice/test?kind=me', wav({ who: 1 }))).json();
    assert.equal(t.ok, true);
    assert.equal(t.reason, 'you');
    assert.equal(t.status.canListen, true);
    t = await (await post('/api/voice/test?kind=other', wav({ who: 2 }))).json();
    assert.equal(t.reason, 'not-you');
    t = await (await post('/api/voice/test?kind=me', wav({ who: 1, music: 0.9 }))).json();
    assert.equal(t.reason, 'music');
    // Strictness comes from his synced settings.
    store.writeLocal('settings', 'main', { voice: { strictness: 'relaxed' } });
    st = await (await fetch(`${base}/api/voice/status`, { headers: H })).json();
    assert.equal(st.strictness, 'relaxed');
    assert.equal(st.threshold, STRICTNESS.relaxed);
    const f = await (await post('/api/voice/forget', JSON.stringify({}), 'application/json')).json();
    assert.equal(f.removed, ROUND_MIN);
    assert.equal(f.status.calibrated, false);
    assert.ok(existsSync(join(dir, 'voice', 'voiceprint.json')));
  } finally {
    server.close(); store.close(); rmSync(dir, { recursive: true, force: true });
  }
});
