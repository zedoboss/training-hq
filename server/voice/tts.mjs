// The coach's voice (9.6): the Mac turns a sentence into speech and streams it to the phone as raw 24 kHz 16-bit
// audio. ElevenLabs with his own key, voice and model (copied into the private config by scripts/voice-setup.mjs;
// the key never leaves the Mac). Without a key, or if ElevenLabs fails, the Mac's own voice (macOS `say`) answers
// instead, so the coach is never silent.
import { readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnProc } from 'node:child_process';
import { speechText } from '../../app/js/lib/voice-text.js';

export const RATE = 24000;
export const MAX_TEXT = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.configDir  the private config folder (elevenlabs.json, voice.json)
 */
export function openTts({ configDir, log = () => {}, fetchFn = fetch, spawn = spawnProc, sayBin = '/usr/bin/say' }) {
  const cache = new Map();
  const readJson = (name) => {
    const f = join(configDir, name);
    try {
      const m = statSync(f).mtimeMs;
      const c = cache.get(f);
      if (c && c.m === m) return c.v;
      const v = JSON.parse(readFileSync(f, 'utf8'));
      cache.set(f, { m, v });
      return v;
    } catch { return null; }
  };
  const eleven = () => {
    const key = readJson('elevenlabs.json')?.apiKey;
    const v = readJson('voice.json') || {};
    return key && v.elevenVoiceId ? { key, voice: v.elevenVoiceId, model: v.elevenModel || 'eleven_turbo_v2_5' } : null;
  };
  let inFlight = 0;
  let lastError = null;

  async function viaEleven(cfg, text, onChunk, signal) {
    // ElevenLabs allows few requests at once: wait for a free slot, retry a busy answer before any audio arrives.
    while (inFlight >= 2) { if (signal?.aborted) return 0; await sleep(50); }
    inFlight++;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voice)}/stream?output_format=pcm_${RATE}`, {
          method: 'POST',
          headers: { 'xi-api-key': cfg.key, 'content-type': 'application/json', accept: 'audio/pcm' },
          body: JSON.stringify({ text, model_id: cfg.model }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        });
        if (res.status === 429 && attempt < 2) { await sleep(400 * (attempt + 1)); continue; }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`ElevenLabs answered ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
        }
        let bytes = 0;
        for await (const chunk of res.body) { bytes += chunk.length; onChunk(Buffer.from(chunk)); }
        return bytes;
      }
      return 0;
    } finally { inFlight--; }
  }

  function viaMac(text, onChunk) {
    return new Promise((resolve, reject) => {
      const dir = mkdtempSync(join(tmpdir(), 'thq-say-'));
      const f = join(dir, 'say.wav');
      const p = spawn(sayBin, ['-o', f, `--data-format=LEI16@${RATE}`, text], { stdio: 'ignore' });
      p.on('error', (e) => { rmSync(dir, { recursive: true, force: true }); reject(e); });
      p.on('exit', (code) => {
        try {
          if (code !== 0) throw new Error(`say exited ${code}`);
          const wav = readFileSync(f);
          // Skip the WAV header: find the 'data' chunk.
          const at = wav.indexOf('data');
          const pcm = at >= 0 ? wav.subarray(at + 8) : wav.subarray(44);
          onChunk(pcm);
          resolve(pcm.length);
        } catch (e) { reject(e); } finally { rmSync(dir, { recursive: true, force: true }); }
      });
    });
  }

  /**
   * Speak one sentence: raw PCM chunks go to onChunk as they arrive. Returns which voice spoke.
   * @returns {Promise<{engine: 'elevenlabs'|'mac', bytes: number}>}
   */
  async function speak(text, onChunk, { signal } = {}) {
    const words = speechText(text).slice(0, MAX_TEXT);
    if (!words) return { engine: 'none', bytes: 0 };
    const cfg = eleven();
    if (cfg) {
      let sent = 0;
      try {
        const bytes = await viaEleven(cfg, words, (c) => { sent += c.length; onChunk(c, 'elevenlabs'); }, signal);
        lastError = null;
        return { engine: 'elevenlabs', bytes };
      } catch (e) {
        if (signal?.aborted) return { engine: 'elevenlabs', bytes: sent };
        lastError = e.message;
        log(`tts: ${e.message}${sent ? '' : '; the Mac voice answers instead'}`);
        if (sent) return { engine: 'elevenlabs', bytes: sent };
      }
    }
    return { engine: 'mac', bytes: await viaMac(words, (c) => onChunk(c, 'mac')) };
  }

  return { speak, status: () => ({ elevenlabs: !!eleven(), error: lastError, rate: RATE }) };
}
