// The voice check on the Mac (step 9): is a clip speech, and whose voice is it. Runs locally with sherpa-onnx (an
// open-source speech toolkit; no account, no key, no audio leaves the Mac):
//  - Silero VAD finds the speech in a clip, so pauses and the music between words are left out of the voice check;
//  - a speaker model (3D-Speaker ERes2Net, trained on VoxCeleb) turns that speech into a vector: same voice, similar
//    vectors (cosine score near 1), different voices, low scores;
//  - an audio tagger (CED mini, trained on AudioSet) says how much a clip sounds like speech, music or singing.
// The model files are downloaded once by scripts/voice-setup.mjs into the private folder (models/voice). The native
// module is loaded on first use, so the rest of the server (and the tests) run without it.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_RATE } from '../../app/js/lib/wav.js';

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
export const SPEAKER_MODEL = '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx';
export const TAGGER_DIR = 'sherpa-onnx-ced-mini-audio-tagging-2024-04-19';

/** What scripts/voice-setup.mjs downloads (public model files). */
export const DOWNLOADS = [
  { file: SPEAKER_MODEL, url: `${RELEASES}/speaker-recongition-models/${SPEAKER_MODEL}` },
  { file: 'silero_vad.onnx', url: `${RELEASES}/asr-models/silero_vad.onnx` },
  { file: TAGGER_DIR, url: `${RELEASES}/audio-tagging-models/${TAGGER_DIR}.tar.bz2`, archive: true },
];

export const modelFiles = (dir) => ({
  speaker: join(dir, SPEAKER_MODEL),
  vad: join(dir, 'silero_vad.onnx'),
  tagger: join(dir, TAGGER_DIR, 'model.int8.onnx'),
  labels: join(dir, TAGGER_DIR, 'class_labels_indices.csv'),
});

// AudioSet class names, grouped.
const SPEECH = new Set(['Speech', 'Male speech, man speaking', 'Female speech, woman speaking', 'Child speech, kid speaking', 'Conversation', 'Narration, monologue', 'Speech synthesizer', 'Shout', 'Yell', 'Whispering']);
const SINGING = new Set(['Singing', 'Male singing', 'Female singing', 'Child singing', 'Choir', 'A capella', 'Vocal music', 'Rapping', 'Humming', 'Chant', 'Mantra', 'Yodeling', 'Beatboxing', 'Lullaby', 'Synthetic singing']);
const MUSIC = /music|musical|song|guitar|drum|piano|keyboard \(musical\)|orchestra|violin|fiddle|brass instrument|organ|synthesizer|techno|dubstep|disco|hip hop|jazz|trance|reggae|strum|percussion|cymbal|double bass|beatboxing/i;

/** Speech, music and singing levels (0..1) from the tagger's list of {name, prob}. */
export function tagLevels(events = []) {
  let speech = 0; let music = 0; let singing = 0;
  for (const { name, prob } of events) {
    if (SPEECH.has(name)) speech = Math.max(speech, prob);
    if (SINGING.has(name)) singing = Math.max(singing, prob);
    if (name !== 'Speech synthesizer' && (SINGING.has(name) || MUSIC.test(name))) music = Math.max(music, prob);
  }
  const top = [...events].sort((a, b) => b.prob - a.prob).slice(0, 3).map((e) => ({ name: e.name, prob: Math.round(e.prob * 100) / 100 }));
  return { speech, music, singing, top };
}

export const cosine = (a, b) => {
  let d = 0; let x = 0; let y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
};

/**
 * @param {object} o
 * @param {string} o.modelsDir  folder with the model files
 * @param {(m: string) => void} [o.log]
 */
export function openEngine({ modelsDir, log = () => {} }) {
  const files = modelFiles(modelsDir);
  let mod = null; let speaker = null; let tagger = null; let loadError = null;

  const missing = () => Object.entries(files).filter(([, f]) => !existsSync(f)).map(([k]) => k);

  function load() {
    if (speaker) return true;
    if (loadError) return false;
    const gone = missing();
    if (gone.length) { loadError = `voice models missing (${gone.join(', ')}): run node scripts/voice-setup.mjs`; return false; }
    try {
      mod = createRequire(import.meta.url)('sherpa-onnx-node');
      const t = Date.now();
      speaker = new mod.SpeakerEmbeddingExtractor({ model: files.speaker, numThreads: 2, debug: false });
      tagger = new mod.AudioTagging({ model: { ced: files.tagger, numThreads: 2, debug: false }, labels: files.labels });
      log(`voice engine: models loaded in ${Date.now() - t} ms`);
      return true;
    } catch (e) {
      loadError = `voice engine could not start: ${e.message}`;
      log(loadError);
      return false;
    }
  }

  const need = () => { if (!load()) throw Object.assign(new Error(loadError), { status: 503 }); };

  /** The stretches of speech in a clip (Silero VAD), joined, and how long they last. */
  function speechOf(samples) {
    need();
    const vad = new mod.Vad({ sileroVad: { model: files.vad, threshold: 0.5, minSilenceDuration: 0.25, minSpeechDuration: 0.15, windowSize: 512 }, sampleRate: VOICE_RATE, numThreads: 1, debug: false }, 30);
    const win = 512;
    const parts = [];
    const take = () => { while (!vad.isEmpty()) { const seg = vad.front(false); parts.push(Float32Array.from(seg.samples)); vad.pop(); } };
    for (let i = 0; i + win <= samples.length; i += win) { vad.acceptWaveform(samples.subarray(i, i + win)); take(); }
    vad.flush(); take();
    const n = parts.reduce((s, p) => s + p.length, 0);
    const speech = new Float32Array(n);
    let o = 0;
    for (const p of parts) { speech.set(p, o); o += p.length; }
    return { speech, speechSec: n / VOICE_RATE, segments: parts.length };
  }

  /** The speaker vector of a stretch of speech. */
  function embed(samples) {
    need();
    const st = speaker.createStream();
    st.acceptWaveform({ sampleRate: VOICE_RATE, samples });
    st.inputFinished();
    return Array.from(speaker.compute(st, false));
  }

  /** Speech, music and singing levels of a clip. */
  function tags(samples) {
    need();
    const st = tagger.createStream();
    st.acceptWaveform({ sampleRate: VOICE_RATE, samples });
    return tagLevels(tagger.compute(st, -1));
  }

  /** Everything the voice check needs from one clip (16 kHz floats). */
  function analyse(samples) {
    const t = Date.now();
    const level = tags(samples);
    const { speech, speechSec, segments } = speechOf(samples);
    // Too little speech gives an unreliable voice vector: the caller treats a missing one as "not sure".
    const embedding = speechSec >= 0.3 ? embed(speech) : null;
    return { sec: samples.length / VOICE_RATE, speechSec, segments, embedding, tags: level, ms: Date.now() - t };
  }

  return {
    files,
    status: () => ({ ready: !!speaker, missing: missing(), error: loadError }),
    load,
    speechOf,
    embed,
    tags,
    analyse,
  };
}
