// Speech to text on the Mac (9.5): the whisper-server already installed for his voice assistant, started by
// Training HQ as its own process (its own port, so the two never clash), with the plugin's settings: English, about
// 10 s per request at most, no temperature fallback. Started on first use, stopped after 20 minutes without voice.
// cleanTranscript (9.4) drops what Whisper writes for music or noise ("[Music]", "♪", "Thanks for watching").
import { spawn as spawnProc } from 'node:child_process';
import { existsSync } from 'node:fs';
import { encodeWav } from '../../app/js/lib/wav.js';

export const DEFAULT_BIN = '/opt/homebrew/bin/whisper-server';
// The model file is his (config/voice.json whisperModel, from scripts/voice-setup.mjs); no default path here.
export const DEFAULT_MODEL = null;
export const DEFAULT_PORT = 8179;

// Lines Whisper is known to make up from silence, noise or music.
const MADE_UP = [/^thanks? (you )?for watching/i, /^thank you for watching/i, /^subtitles? by/i, /^please subscribe/i, /^(and )?(see|bye) you (next time|in the next)/i, /^you$/i, /^\.+$/];
// A15: grunts, effort sounds and breathing as Whisper writes them. A clip of only these is not words from him, so it
// never stops the coach mid-set or reaches it ("ow" and "ouch" are words: pain).
const GRUNT = /^(u+g+h+|u+h+|u+m+|a+h+|o+h+|h+m+|m+h*m+|h+u+h+|h+a+(h+a+)*|a+r+g+h*|g+r+|h*n+g+h*|p+h+e+w+|w+h+e+w+|o+o+f+|h+u+|e+h+|g+a+h+|r+a+h+|h+h+)$/i;
export const onlyGrunts = (t) => { const w = String(t || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean); return w.length > 0 && w.every((x) => GRUNT.test(x)); };

/**
 * Whisper's text, cleaned. Returns '' when nothing he could have said is left (music, noise, a made-up line, or the
 * vocabulary hint repeated back).
 */
export function cleanTranscript(text, hint = '') {
  let t = String(text ?? '')
    .replace(/[♪♫🎵🎶]+[^♪♫🎵🎶]*[♪♫🎵🎶]+/g, ' ')
    .replace(/[♪♫🎵🎶]/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  if (MADE_UP.some((re) => re.test(t))) return '';
  if (onlyGrunts(t)) return '';
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Whisper sometimes writes a short command twice ("Start the timer. Start the timer."): once is what he said.
  const parts = t.match(/[^.!?]+[.!?]*/g) || [t];
  t = parts.filter((p, i) => i === 0 || norm(p) !== norm(parts[i - 1])).join('').replace(/\s+/g, ' ').trim();
  const h = norm(hint);
  // Several of the hint's sentences in a row is Whisper repeating its prompt; one short command is him.
  if (h && t.split(/[.!?]+/).filter((x) => x.trim()).length >= 2 && h.includes(norm(t))) return '';
  return t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} [o.bin] whisper-server
 * @param {string} [o.model] the ggml model file
 * @param {number} [o.port]
 */
export function openWhisper({ bin = DEFAULT_BIN, model = DEFAULT_MODEL, port = DEFAULT_PORT, threads = 8, idleMs = 20 * 60000, log = () => {}, spawn = spawnProc, fetchFn = fetch }) {
  let child = null; let starting = null; let idle = null; let lastError = null;
  const base = `http://127.0.0.1:${port}`;

  const up = async () => { try { const r = await fetchFn(`${base}/`, { signal: AbortSignal.timeout(1000) }); return r.status < 500; } catch { return false; } };

  function touch() {
    clearTimeout(idle);
    idle = setTimeout(() => stop('idle'), idleMs);
    idle.unref?.();
  }

  async function start() {
    if (await up()) return; // already running (started earlier, or left over from a restart)
    if (!existsSync(bin)) throw Object.assign(new Error(`whisper-server not found at ${bin}`), { status: 503 });
    if (!model || !existsSync(model)) throw Object.assign(new Error(model ? `Whisper model not found at ${model}` : 'no Whisper model set (whisperModel in config/voice.json: run node scripts/voice-setup.mjs)'), { status: 503 });
    const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-t', String(threads), '-l', 'en', '-ac', '512', '-bo', '1', '-nf'];
    const t = Date.now();
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    child.stderr?.on('data', (d) => { tail = (tail + d).slice(-800); });
    child.on('exit', (code) => { if (child) log(`whisper: exited (${code})${code ? `: ${tail.trim().split('\n').at(-1)}` : ''}`); child = null; });
    for (let i = 0; i < 160; i++) {
      if (await up()) {
        log(`whisper: ready on port ${port} in ${Date.now() - t} ms`);
        // A first tiny request loads everything, so his first words aren't slow.
        await transcribeRaw(encodeWav(new Float32Array(16000))).catch(() => {});
        return;
      }
      if (!child) break;
      await sleep(250);
    }
    stop('did not start');
    throw Object.assign(new Error(`whisper-server did not start${tail ? `: ${tail.trim().split('\n').at(-1)}` : ''}`), { status: 503 });
  }

  async function ensure() {
    touch();
    if (!starting) starting = start().catch((e) => { lastError = e.message; throw e; }).finally(() => { starting = null; });
    return starting;
  }

  async function transcribeRaw(wav, prompt = '') {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (prompt) form.append('prompt', prompt);
    const res = await fetchFn(`${base}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Whisper answered ${res.status}`);
    const j = await res.json();
    return String(j.text ?? '').trim();
  }

  /** The words in a 16 kHz WAV clip (raw, before cleaning). */
  async function transcribe(wav, prompt = '') {
    await ensure();
    const t = Date.now();
    const text = await transcribeRaw(wav, prompt);
    touch();
    lastError = null;
    return { text, ms: Date.now() - t };
  }

  function stop(why = 'stopped') {
    clearTimeout(idle);
    if (child) { log(`whisper: stopping (${why})`); const c = child; child = null; c.kill('SIGTERM'); }
  }

  return {
    ensure,
    transcribe,
    stop,
    status: () => ({ running: !!child, starting: !!starting, port, error: lastError, bin: existsSync(bin), model: !!model && existsSync(model) }),
  };
}
