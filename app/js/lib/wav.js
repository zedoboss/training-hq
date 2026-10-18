// Sound as numbers (step 9), shared by the phone and the Mac: 16-bit mono WAV files in and out, resampling to the
// 16 kHz that Whisper and the voice check use, and loudness. No browser or Node APIs here, so both sides use it.

export const VOICE_RATE = 16000;

/** Float samples (-1..1) to a 16-bit mono PCM WAV file. */
export function encodeWav(samples, sampleRate = VOICE_RATE) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * A WAV file (bytes) to {sampleRate, samples}. Reads 16-bit PCM and 32-bit float, mono or more channels (averaged).
 * Throws on anything else.
 */
export function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null; let data = null;
  for (let o = 12; o + 8 <= u8.length;) {
    const id = tag(o); const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    else if (id === 'data') { data = { start: o + 8, size: Math.min(size, u8.length - o - 8) }; break; }
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV file without sound');
  const { channels, bits, format } = fmt;
  const pcm16 = format === 1 && bits === 16;
  const f32 = (format === 3 || format === 0xfffe) && bits === 32;
  if (!pcm16 && !f32) throw new Error('WAV must be 16-bit PCM or 32-bit float');
  const step = (bits / 8) * channels;
  const frames = Math.floor(data.size / step);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = data.start + i * step + c * (bits / 8);
      sum += pcm16 ? v.getInt16(o, true) / 0x8000 : v.getFloat32(o, true);
    }
    out[i] = sum / channels;
  }
  return { sampleRate: fmt.sampleRate, samples: out };
}

/** Resample by linear interpolation with a simple box filter when going down (good enough for speech). */
export function resample(samples, from, to = VOICE_RATE) {
  if (from === to) return samples;
  const ratio = from / to;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  const box = ratio > 1 ? Math.floor(ratio) : 1;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    if (box > 1) {
      let s = 0; let k = 0;
      for (; k < box && j + k < samples.length; k++) s += samples[j + k];
      out[i] = k ? s / k : 0;
    } else {
      const f = pos - j;
      const a = samples[j] ?? 0; const b = samples[j + 1] ?? a;
      out[i] = a + (b - a) * f;
    }
  }
  return out;
}

/** Root mean square loudness of a stretch of samples. */
export function rms(samples, from = 0, to = samples.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += samples[i] * samples[i];
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

/** Scale so the loudest sample sits near full scale (gain capped, so silence isn't blown up into noise). */
export function normalise(samples, { target = 0.9, maxGain = 30 } = {}) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (!peak) return samples;
  const g = Math.min(maxGain, target / peak);
  if (Math.abs(g - 1) < 0.01) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/** 16-bit little-endian PCM bytes (the voice the Mac streams back) to float samples. A trailing odd byte is left. */
export function pcm16ToFloat(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.length / 2);
  const v = new DataView(u8.buffer, u8.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
  return out;
}
