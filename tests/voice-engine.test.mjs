// The real voice engine on this Mac (step 9): skipped where the models or macOS voices aren't there (CI on Linux).
// Voices come from macOS's own speech (`say`): one voice is "him", others are other people and a singing voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openEngine } from '../server/voice/engine.mjs';
import { openVoiceprint, thresholdFor } from '../server/voice/voiceprint.mjs';
import { decide } from '../server/voice/gate.mjs';
import { decodeWav } from '../app/js/lib/wav.js';

const MODELS = process.env.THQ_VOICE_MODELS || join(homedir(), 'Documents', 'training-hq-private', 'models', 'voice');
const engine = openEngine({ modelsDir: MODELS });
const haveSay = process.platform === 'darwin' && spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout?.includes('Daniel');
const skip = !haveSay ? 'needs macOS voices' : engine.status().missing.length ? 'voice models not downloaded' : false;

const PHRASES = ['Eighty for eight', 'Next exercise', 'Start the timer', 'Took my creatine', 'Sixty two point five for ten', 'Skip the rest', 'Add fifteen seconds', 'What is my next set', 'Smith squat, sixty five for eight', 'How long have I been training today'];

test('real engine: his voice passes, other voices and singing are refused', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-voice-engine-'));
  try {
    const say = (voice, text) => {
      const f = join(dir, `${voice}-${Math.random().toString(36).slice(2)}.wav`);
      spawnSync('say', ['-v', voice, '-o', f, '--data-format=LEI16@16000', text]);
      return decodeWav(readFileSync(f)).samples;
    };
    const vp = openVoiceprint(join(dir, 'voice'));
    PHRASES.slice(0, 8).forEach((p, i) => {
      const s = say('Daniel', p);
      const r = vp.addSample({ condition: 'home', phrase: p, samples: s, analysis: engine.analyse(s), now: i + 1 });
      assert.equal(r.ok, true, `phrase ${p}: ${r.problem}`);
    });
    const th = thresholdFor('strict');
    const verdict = (voice, text) => { const s = say(voice, text); const a = engine.analyse(s); return decide(a, vp.score(a.embedding), th); };
    assert.equal(verdict('Daniel', 'Start the timer and log eighty for eight').reason, 'you');
    for (const other of ['Samantha', 'Fred', 'Karen', 'Rishi']) {
      const v = verdict(other, 'Start the timer and log eighty for eight');
      assert.notEqual(v.reason, 'you', `${other} scored ${v.score}`);
    }
    assert.notEqual(verdict('Cellos', 'eighty for eight, next exercise, start the timer now').reason, 'you');
    const a = engine.analyse(say('Daniel', 'Next exercise'));
    assert.ok(a.ms < 1000, `analysis took ${a.ms} ms`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
