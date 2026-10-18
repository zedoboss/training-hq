// One-time voice setup on the Mac (step 9). Run from the code folder:  node scripts/voice-setup.mjs
//  1. Downloads the voice models (public files from the sherpa-onnx project on GitHub) into the private folder's
//     models/voice: the speaker model, Silero VAD and the audio tagger. About 40 MB. Skipped when already there.
//  2. Copies the ElevenLabs key from ~/.celestial-globe/elevenlabs.json into the private config (config/elevenlabs.json,
//     readable by this user only), and the voice, model and Whisper paths from the Obsidian globe plugin's settings
//     into config/voice.json. Both sources are only read. The key is never printed.
// Set TRAINING_HQ_PRIVATE to use another private folder (a dev copy).
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { paths, loadConfig } from '../server/config.mjs';
import { DOWNLOADS } from '../server/voice/engine.mjs';

const p = paths();
const config = loadConfig(p);
const modelsDir = config.voiceModelsDir || p.voiceModelsDir;
mkdirSync(modelsDir, { recursive: true });

for (const d of DOWNLOADS) {
  const target = join(modelsDir, d.file);
  if (existsSync(target)) { console.log(`model: ${d.file} already there`); continue; }
  console.log(`model: downloading ${d.file} ...`);
  const res = await fetch(d.url, { redirect: 'follow' });
  if (!res.ok) { console.error(`  failed: HTTP ${res.status} for ${d.url}`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (d.archive) {
    const tmp = join(modelsDir, `${d.file}.tar.bz2`);
    writeFileSync(tmp, buf);
    const r = spawnSync('tar', ['xjf', tmp, '-C', modelsDir], { encoding: 'utf8' });
    rmSync(tmp, { force: true });
    if (r.status !== 0) { console.error(`  unpacking failed: ${r.stderr}`); process.exit(1); }
    // Only the small (int8) tagger and its labels are used.
    for (const extra of ['model.onnx', 'test_wavs']) rmSync(join(target, extra), { recursive: true, force: true });
  } else {
    writeFileSync(target, buf);
  }
  console.log(`  ok (${Math.round(buf.length / 1048576)} MB)`);
}

// The ElevenLabs key and voice (brief section 7): read from where the globe plugin keeps them, never printed.
const keySrc = join(homedir(), '.celestial-globe', 'elevenlabs.json');
const keyDst = join(p.configDir, 'elevenlabs.json');
try {
  const apiKey = JSON.parse(readFileSync(keySrc, 'utf8')).apiKey;
  if (typeof apiKey !== 'string' || apiKey.length < 10) throw new Error('no apiKey field');
  writeFileSync(keyDst, `${JSON.stringify({ apiKey })}\n`, { mode: 0o600 });
  console.log(`elevenlabs: key copied into ${keyDst} (not shown)`);
} catch (e) {
  console.log(`elevenlabs: key not copied (${e.code === 'ENOENT' ? 'no file at ~/.celestial-globe/elevenlabs.json' : e.message}); the coach will speak with the Mac's own voice`);
}

const pluginData = join(homedir(), 'Documents', 'Celestial Vault', '.obsidian', 'plugins', 'celestial-globe', 'data.json');
const voiceFile = join(p.configDir, 'voice.json');
try {
  const d = JSON.parse(readFileSync(pluginData, 'utf8'));
  let current = {};
  try { current = JSON.parse(readFileSync(voiceFile, 'utf8')); } catch { /* first time */ }
  const pick = { elevenVoiceId: d.elevenVoiceId, elevenModel: d.elevenModel, whisperPath: d.whisperPath, whisperModel: d.whisperModel };
  const out = { ...current };
  for (const [k, v] of Object.entries(pick)) if (typeof v === 'string' && v && !current[k]) out[k] = v;
  writeFileSync(voiceFile, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  console.log(`voice: ${voiceFile} has ${Object.keys(out).filter((k) => out[k]).join(', ') || 'nothing'}`);
} catch (e) {
  console.log(`voice: plugin settings not read (${e.code === 'ENOENT' ? 'not found' : e.message}); defaults are used`);
}
