// The coach chat on the phone and in the Mac's browser (8.5). The conversation is the synced 'coach-messages'
// collection (written by the Mac); a reply also arrives as a stream of events while it is written. Pure helpers here;
// the screen is views/coach.js. Actions are what only this device can do for the coach: its rest timer, a sync,
// opening a screen, the microphone, an app update.
import { safeHash } from './screens.js';

export const MODEL_LABEL = { fast: 'SONNET 5.5 · MEDIUM', deep: 'OPUS 5.5 · HIGH' };

/** Splits a byte stream of JSON lines into events. push(text) as chunks arrive, end() at the end. */
export function lineReader(onEvent) {
  let buf = '';
  const take = (line) => { if (!line.trim()) return; let e; try { e = JSON.parse(line); } catch { return; } onEvent(e); };
  return {
    push(text) {
      buf += text;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); take(line); }
    },
    end() { const rest = buf; buf = ''; take(rest); },
  };
}

const byTime = (a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The current conversation: stored messages plus ones that arrived live and haven't synced yet (same id = one
 * message), after the last "new conversation" marker, oldest first.
 */
export function conversationOf(stored = [], live = []) {
  const all = messagesOf(stored, live);
  let from = 0;
  all.forEach((m, i) => { if (m.role === 'marker') from = i + 1; });
  return all.slice(from);
}

/**
 * Every message, markers included, merged by id, oldest first. Thu 10/22, his words: "I clicked yesterday, Wednesday.
 * Nothing on this day": Talk shows one day at a time, and each new day starts with a marker, so cutting at the last
 * marker hid every day before today. The day view uses this; the markers are drawn as a line.
 */
export function messagesOf(stored = [], live = []) {
  const map = new Map();
  for (const m of [...stored, ...live]) if (m?.id) map.set(m.id, { ...(map.get(m.id) || {}), ...m });
  return [...map.values()].sort(byTime);
}

/** Tool names as the design shows them: capitals, joined with a dot. */
export const toolLabel = (t) => String(t?.title || t?.name || '').toUpperCase();

/**
 * The tools of one answer as chips, each tool once in the order first used, with how many times (Thu 10/22, his
 * words: "Why are there multiple set a reminder... that's a glitch": three cancels showed as three chips).
 * [{label, count, ok, summary}]: ok only when every call went through; summary: each call's own, one per line.
 */
export function toolChips(tools = []) {
  const by = new Map();
  for (const t of tools) {
    const label = toolLabel(t);
    if (!label) continue;
    const c = by.get(label) || { label, count: 0, ok: true, summaries: [] };
    c.count++; c.ok = c.ok && Boolean(t.ok); if (t.summary) c.summaries.push(t.summary);
    by.set(label, c);
  }
  return [...by.values()].map(({ summaries, ...c }) => ({ ...c, summary: summaries.join('\n') }));
}

/** Today's numbers for the home screen corners: turns, tool calls, errors. */
export function todayCounts(messages = [], date, dayOf) {
  const mine = messages.filter((m) => m.role === 'assistant' && dayOf(m.at) === date);
  const tools = mine.flatMap((m) => m.tools || []);
  return { turns: mine.length, tools: tools.length, errors: tools.filter((t) => !t.ok).length + mine.filter((m) => m.error).length };
}

/**
 * Run what the coach asked this device to do. `deps` holds the rest timer, the sync and the focus event, so this
 * stays testable. Returns true when it was done here; 'open' actions are shown as buttons instead (in Talk; spoken
 * turns go there at once). Tue 10/20, the coach works the app: 'go' opens a screen, 'mic-off' stops listening on
 * this phone, 'reload' loads the newest version of the app.
 */
export function runAction(a, deps) {
  switch (a?.kind) {
    case 'go': {
      const url = safeHash(a.url); if (!url || !deps.go) return false;
      // Tue 10/20: the coach started Push and opened it before the phone had the new session ("Session not found").
      // Pull from the Mac first (at most 4 s), then open.
      if (!deps.pull) { deps.go(url); return true; }
      Promise.race([deps.pull(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {}).finally(() => deps.go(url));
      return true;
    }
    case 'mic-off': if (!deps.micOff) return false; deps.micOff(); return true;
    case 'reload': if (!deps.reload) return false; deps.reload(); return true;
    case 'rest': if (a.seconds > 0) { deps.rest.start(a.seconds, a.label || 'Rest'); return true; } return false;
    case 'rest-add': deps.rest.adjust(Number(a.seconds) || 0); return true;
    case 'rest-skip': deps.rest.clear(); return true;
    case 'sync': deps.sync(); return true;
    case 'focus': deps.focus(a); return true;
    default: return false;
  }
}

/** A coach message as HTML: escaped, line breaks kept, and **bold** shown bold (the coach writes it; raw asterisks
 *  looked broken on the phone, Sun 10/18). */
export const textHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
