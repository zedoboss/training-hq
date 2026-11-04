// Undo the coach's last change in one step (Thu 11/5, his words: "What else cant u do? Figure it out and let the mac
// give U the tools"; the coach's list had "Undo the last thing I did in one step"). Every tool call that changed his data
// keeps what each record was before ('coach-undo', written by the Mac); undo puts those back, newest first, only when
// nothing has changed the records since (his phone, another tool).
import { snapshot, wrote, refuse, timeText } from './shared.mjs';

export const UNDO = 'coach-undo';
const KEEP_MS = 24 * 3600 * 1000;
// Never undone: the chat itself, the changes on the Mac, the undo log.
const SKIP = new Set(['coach-messages', 'coach-photos', 'coach-changes', UNDO]);

/**
 * A view of the store that remembers, for each record a tool writes, what it was before (the first write wins) and
 * its version after (the last write wins).
 */
export function recordingStore(store) {
  const seen = new Map();
  const note = (col, id) => {
    const key = `${col}/${id}`;
    if (SKIP.has(col)) return null;
    if (!seen.has(key)) {
      const r = store.getRecord(col, id);
      seen.set(key, { col, id, before: r && !r.deleted ? r.data : null, beforeHlc: r?.hlc || null, after: null });
    }
    return seen.get(key);
  };
  const rec = ({ ...store,
    writeLocal(col, id, data, opts) {
      const n = note(col, id);
      const out = store.writeLocal(col, id, data, opts);
      if (n) n.after = out.hlc;
      return out;
    },
    writeLocalMany(items) {
      const ns = items.map((x) => note(x.col, x.id));
      const out = store.writeLocalMany(items);
      out.forEach((r, i) => { if (ns[i]) ns[i].after = r.hlc; });
      return out;
    },
  });
  return { store: rec, writes: () => [...seen.values()].filter((w) => w.after) };
}

/** Keep one tool call's changes so undo can put them back. */
export function saveUndo(store, { tool, title, summary, turnId = null, at, writes }) {
  if (!writes.length || tool === 'undo' || tool === 'request_change') return null;
  // Photos and other big records stay out of the log (it syncs to his phone).
  if (JSON.stringify(writes).length > 300000) return null;
  const id = `undo.${at.toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
  store.writeLocal(UNDO, id, { id, tool, title: title || tool, summary: String(summary || '').slice(0, 160), turnId, at, writes });
  // The log keeps a day.
  for (const r of store.listRecords(UNDO)) if (r.data && at - r.data.at > KEEP_MS) store.writeLocal(UNDO, r.id, null, { deleted: true });
  return id;
}

async function undo(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const open = s.list(UNDO).filter((u) => !u.undoneAt && s.now - u.at <= KEEP_MS).sort((x, y) => y.at - x.at);
  if (a.action === 'list') {
    if (!open.length) return { text: 'Nothing to undo: no change of mine in the last 24 hours.', summary: 'listed' };
    return { text: `My changes, newest first (undo puts back the newest): ${open.slice(0, 10).map((u) => `${timeText(u.at, s.tz)} ${u.title}: ${u.summary}`).join('; ')}.`, summary: 'listed' };
  }
  const u = open[0];
  if (!u) return refuse('Nothing to undo: no change of mine in the last 24 hours.');
  const moved = u.writes.filter((w) => ctx.store.getRecord(w.col, w.id)?.hlc !== w.after);
  if (moved.length) {
    return refuse(`Can't undo ${u.title} (${timeText(u.at, s.tz)}): ${moved.length === u.writes.length ? 'it was' : 'part of it was'} changed again since (on his phone or by another change). Fix it with the tool for it instead.`);
  }
  const items = u.writes.map((w) => (w.before == null ? { col: w.col, id: w.id, data: null, deleted: true } : { col: w.col, id: w.id, data: w.before }));
  const out = ctx.store.writeLocalMany(items);
  // An older change of the same record is undoable next: the record is back to where that change left it.
  const back = new Map(u.writes.map((w, i) => [`${w.col}/${w.id}`, { from: w.beforeHlc, to: out[i].hlc }]));
  const later = open.slice(1).map((o) => {
    let moved2 = false;
    const writes = o.writes.map((w) => { const b = back.get(`${w.col}/${w.id}`); if (b && b.from && w.after === b.from) { moved2 = true; return { ...w, after: b.to }; } return w; });
    return moved2 ? { col: UNDO, id: o.id, data: { ...o, writes } } : null;
  }).filter(Boolean);
  ctx.store.writeLocalMany([{ col: UNDO, id: u.id, data: { ...u, undoneAt: s.now } }, ...later]);
  return wrote(`Undone: ${u.title} at ${timeText(u.at, s.tz)} (${u.summary}). Everything it changed is back as it was.`, `undid ${u.tool}`);
}

export const UNDO_TOOLS = [
  { name: 'undo', title: 'Undo my last change', description: "Undo your own last change to his data in one step (the last tool call of yours that changed something, in the last 24 hours), only when he says so (\"undo that\", \"take it back\", \"that was wrong, put it back\"). Again = the one before. list = your changes you can still undo. Refused when it was changed again since (then fix it with the tool for it). Not for the changes he asked the Mac for.",
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['undo', 'list'] } }, additionalProperties: false }, run: undo },
];
