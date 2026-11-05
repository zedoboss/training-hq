// Thu 11/5, his words: "when I stopped on the whisper mic, it said the Mac lost connection and after that it wasn't
// working. I restarted the app, nothing." The phone's own Tailscale link had dropped (the Mac saw the phone leave
// Tailscale and stayed up throughout); the clip went nowhere and was thrown away. Now a clip that can't reach the Mac
// is kept on this phone (Cache Storage, so closing the app doesn't lose it) and sent by itself, once, oldest first, as
// soon as the Mac answers again; its words go into the chat box like any dictation (nothing is sent to the coach until
// he taps Send).

export const KEEP_CACHE = 'dictation-kept-v1';
/** A clip the Mac answered but couldn't read is tried this many times, then kept and left alone. */
export const MAX_TRIES = 3;

/** The phone couldn't reach the Mac at all (as opposed to the Mac answering with an error). */
export const isUnreachable = (e) => /unreachable|failed to fetch|networkerror|load failed|network connection was lost|abort/i.test(String(e?.message || e || ''));

/** What he reads when the Mac can't be reached at the moment he stops the mic. */
export const KEPT_MESSAGE = 'Can\'t reach your Mac, most likely this phone\'s Tailscale dropped. Your recording is kept and goes in the box by itself once it\'s back. Not back in a minute? Open Tailscale, turn it off and on.';

/**
 * Send the kept clips, oldest first, each once. Stops at the first that can't reach the Mac (it and the rest wait for
 * the next try). A clip the Mac answers with an error stays kept with one more try counted; after MAX_TRIES it is left
 * alone (still kept). Returns {sent, waiting}.
 * @param {{list: () => Promise<Array<{id: string, at: number, tries: number, wav: any}>>,
 *   remove: (id: string) => Promise<void>, retry: (clip: object) => Promise<void>,
 *   send: (wav: any) => Promise<string>, onText: (text: string, at: number) => void, onFail?: (e: Error, at: number) => void}} io
 */
export async function flushKept({ list, remove, retry, send, onText, onFail }) {
  let sent = 0;
  const clips = (await list()).filter((c) => (c.tries || 0) < MAX_TRIES).sort((a, b) => a.at - b.at);
  for (const clip of clips) {
    let text;
    try {
      text = await send(clip.wav);
    } catch (e) {
      if (isUnreachable(e)) return { sent, waiting: true };
      await retry(clip);
      onFail?.(e, clip.at);
      continue;
    }
    await remove(clip.id);
    sent += 1;
    onText(String(text || '').trim(), clip.at);
  }
  return { sent, waiting: false };
}

/** Cache Storage on the phone: one entry per clip, its time and tries in the key. */
export function cacheStore(caches = globalThis.caches, origin = globalThis.location?.origin || 'http://localhost') {
  const keyOf = (at, tries) => `${origin}/__dictation/${at}?tries=${tries}`;
  const open = () => caches.open(KEEP_CACHE);
  return {
    async keep(at, wav) { await (await open()).put(keyOf(at, 0), new Response(wav, { headers: { 'content-type': 'audio/wav' } })); },
    async list() {
      const c = await open();
      const out = [];
      for (const req of await c.keys()) {
        const u = new URL(req.url);
        const at = Number(u.pathname.split('/').pop());
        if (!Number.isFinite(at)) continue;
        const res = await c.match(req);
        if (res) out.push({ id: req.url, at, tries: Number(u.searchParams.get('tries')) || 0, wav: await res.blob() });
      }
      return out;
    },
    async remove(id) { await (await open()).delete(id); },
    async retry(clip) { const c = await open(); await c.put(keyOf(clip.at, (clip.tries || 0) + 1), new Response(clip.wav, { headers: { 'content-type': 'audio/wav' } })); await c.delete(clip.id); },
    async count() { return (await (await open()).keys()).length; },
  };
}

/** The words of a kept clip, added to what is already in the chat box (the coach screen keeps its draft there). */
export const joinDraft = (draft, text) => (String(draft || '').trim() ? `${String(draft).trim()} ${text}` : text);
