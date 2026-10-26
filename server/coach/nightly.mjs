// The coach reviews each day at night (Thu 10/22, his words: "make it as smart as possible... auto-improving,
// auto-learning... as up-to-date as possible, self-learning"). Once a day, after it ends (1:30 AM at the earliest, and
// only once his waking day is over: he slept and got up, or 6:00 AM, lib/waking-day.js; a day missed while
// the Mac slept is caught up when it wakes, the last 3 at most), one Claude run reads the whole day (the timeline to the
// minute and every message) and answers with JSON that the server checks before anything is kept:
// - the day's diary (coach-diary/<date>): a summary, his words that mattered, his decisions, the threads left open;
// - learned facts: dated notes (topic 'learned', with the day they come from); a fact that changed expires the old one
//   (expiredAt, replacedBy), never deleted (design: ~/Documents/autopilot-kit/ASSISTANT-DESIGN.md, section 5);
// - missed fixes: at most 3 a night, only his own words or a clear mistake quoted from the day, never one already
//   asked for; filed as change requests (auto, by 'nightly') that build and are reviewed overnight, quietly;
// - one morning message once he is up: what was learned and fixed overnight.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOnce, parseJsonAnswer } from '../claude.mjs';
import { snapshot } from './shared.mjs';
import { timelineText, fold } from './memory.mjs';
import { newChange, asksOf, COL as CHANGES, MSGS } from './changes.mjs';
import { formatDay, formatTime, isoDate, zonedTime } from '../../app/js/lib/time.js';
import { addDays } from '../../app/js/lib/rotation.js';
import { heldOff } from '../../app/js/lib/holdoffs.js';
import { wakingDay } from '../../app/js/lib/waking-day.js';
import { dayTotals, mealTotals } from '../../app/js/lib/meals.js';

export const DIARY = 'coach-diary';
/** The first day the nightly review covers (meta). */
export const SINCE = 'nightly:since';
export const NOTES = 'coach-notes';
export const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
/** The run for a day starts this long after it ends (his time) at the earliest, and not before his waking day is over. */
export const RUN_HM = '01:30';
export const CATCH_UP_DAYS = 3;
export const MAX_TRIES = 3;
export const MAX_FIXES = 3;
export const MAX_FACTS = 8;
export const SUMMARY_WORDS = 250;
export const TIMEOUT_MS = 15 * 60000;
export const RETRY_MS = 20 * 60000;
const KINDS = ['personality', 'behaviour', 'bug'];

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const words = (s, n) => { const w = String(s ?? '').trim().split(/\s+/).filter(Boolean); return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' '); };
/** The morning text without its sentences about fixes (Tue 10/27: written at night as "being fixed", told hours later
 *  next to the same fixes done): the app names each fix itself, once, in its state when he reads it. */
const FIX_TALK = /\b(being fixed|fixed overnight|fix(es|ing)? (is|are|was|were|filed|queued|coming|in progress)|fixing|fix(es)? for)\b/i;
export const withoutFixes = (s) => String(s ?? '').trim().split(/(?<=[.!?])\s+/).filter((x) => x && !FIX_TALK.test(x)).join(' ');
/** A fix's answer as one line: "Done:" said once, by the line's own head. */
const fixLine = (head, s) => `${head}: ${clip(String(s ?? '').replace(/^\s*(done|fixed|not fixed|question)\s*:\s*/i, ''), 120)}`;
const dayName = (date) => formatDay(new Date(`${date}T12:00:00Z`), 'UTC');
const rand = () => Math.random().toString(36).slice(2, 7);

export const SYSTEM = `You are the nightly review of the coach inside Training HQ, a personal training app with one user. Each night you read one day: everything that happened, to the minute, and every message between him and his coach (and the notifications the app sent in the coach's name). You write the day's diary, update what the coach knows about him, and name the fixes the day shows were missed. Nobody reads your answer but the app: answer with one JSON object and nothing else.

RULES
- Only what the day shows: his words, what he logged, what the app and the coach said and did. Never invent, never guess a number.
- The records win: where a message (the coach's, the app's, a line of the build log) says something the timeline or STATE NOW contradicts (a reminder "cancelled" that is still set, a set "logged" at another weight), go by the records, and name the difference only if it matters to him.
- Food for the day (diary, facts, morning): the totals and meals in FOOD THAT DAY, never added up from the timeline. A meal eaten after midnight before he slept counts for the day he woke up on (his waking day), wherever its time falls.
- diary.summary: at most ${SUMMARY_WORDS} words, plain: what he did (training, food, supplements, walks, sleep, holds), what he asked for, what went wrong, how the day ended. diary.line: the day in one or two short sentences, for the coach's memory. diary.words: up to 12 of his own sentences that matter (a decision, a preference, a complaint, a plan), copied exactly from his messages, with their time. diary.decisions: what he decided, one line each. diary.open: threads left open (a question not answered, something he said he'd do, a problem not fixed yet).
- facts: lasting things about him the coach should know from now on (a habit, a preference, his schedule, how he wants things done, what he eats at which meal), one line each, with the date of the day they come from and the source (his words or what happened, with the time). Not one-day events (the timeline keeps those) and not what the coach's notes or his corrections below already say. When a learned fact below is no longer true, give the new one with replaces: its id. A learned fact that is simply no longer true, with nothing new: expire, with why. At most ${MAX_FACTS}; none is fine.
- fixes: something he said should change about how the coach or the app talks or behaves, a wrong message or a bug, that no change request below already covers; or a clear mistake of the coach or the app in the day's messages (a wrong date, time or number, a message that contradicts what he had just said, a reminder at the wrong moment). At most ${MAX_FIXES}, the clearest first; none is fine and most days have none. quote: his words, or the wrong message, copied exactly from the day's messages. Never a new feature he didn't ask for, never a rule made from one day's timing, never anything that weakens a safety rule (the 30% cap, the readiness table, his tendon pain limit, the sauna ladder and hard stops, no supplement advice, no medical advice).
- morning: one short message for him when he wakes (at most 200 characters, plain and blunt, no greeting formula): what you learned that changes something for him. Never the fixes (yours or any change request): the app adds each one, once, in the state it is in when he reads it. Only what the records show now; never tell him something was cancelled, missed or not done unless STATE NOW or the timeline says so. Empty when nothing is worth his time.

ANSWER (JSON only):
{"diary": {"summary": "...", "line": "...", "words": [{"at": "H:MM AM", "text": "..."}], "decisions": ["..."], "open": ["..."]},
 "facts": [{"text": "...", "from": "YYYY-MM-DD", "replaces": null, "source": "..."}],
 "expire": [{"id": "...", "why": "..."}],
 "fixes": [{"quote": "...", "at": "H:MM AM", "about": "<the message(s) it is about and what was wrong>", "want": "<what should happen instead, one line>", "kind": "behaviour" | "bug" | "personality"}],
 "morning": "..."}`;

/** The section "## His corrections" of his profile, or ''. */
export function correctionsOf(profile = '') {
  const m = /^## His corrections\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(profile || ''));
  return m ? m[1].trim() : '';
}

const notesOf = (s) => s.list(NOTES).filter((n) => !n.expiredAt);
const learnedOf = (s) => notesOf(s).filter((n) => n.topic === 'learned');

/** What the night's run reads: the day to the minute, every message in full, what the coach already knows. */
export function inputFor(s, date, { profile = '', fixedOnMac = '' } = {}) {
  const from = zonedTime(date, '00:00', s.tz); const to = zonedTime(addDays(date, 1), '00:00', s.tz);
  const t = (ms) => formatTime(new Date(ms), s.tz);
  const timeline = timelineText(s, { date, kinds: ['sleep', 'meals', 'supplements', 'workouts', 'holds', 'checkins', 'health', 'walks', 'scans', 'sauna', 'squats', 'notes', 'reminders', 'changes', 'holdoffs', 'days'] });
  const msgs = s.list(MSGS).filter((m) => m.at >= from && m.at < to && m.text && (m.role === 'user' || m.role === 'assistant')).sort((a, b) => a.at - b.at)
    .map((m) => `${t(m.at)} ${m.role === 'user' ? `He${m.via === 'voice' ? ' (voice)' : ''}: ${clip(m.text, 3000)}` : m.kind ? `App (${m.kind}, in the coach's name): ${clip(m.text, 600)}` : `Coach: ${clip(m.text, 1500)}`}`);
  const changes = s.list(CHANGES).filter((c) => c.status !== 'cancelled' && (c.doneAt || c.at) >= zonedTime(addDays(date, -2), '00:00', s.tz))
    .sort((a, b) => a.at - b.at).map((c) => `[${c.id}] ${c.status}: ${asksOf(c).map((a) => `"${clip(a.said, 300)}"`).join(' + ')}${c.answer ? ` -> ${clip(c.answer, 200)}` : ''}`);
  const corrections = correctionsOf(profile);
  // How things stand now (the review runs after the day ends): what is still set, open or held off.
  const reminders = s.list('coach-reminders').filter((r) => !r.cancelledAt && (r.trigger ? !r.firedAt : r.at > s.now - 6 * 3600000 && !r.firedAt)).sort((a, b) => (a.at || 0) - (b.at || 0))
    .map((r) => `[${r.id}] ${r.trigger ? 'when he starts his workout log' : `${formatDay(new Date(r.at), s.tz)} ${t(r.at)}`}${r.meal === 'wait' ? ' (waits until his meal is done if it lands in one)' : ''}: "${clip(r.text, 160)}"`);
  const holds = s.list('coach-holds').filter((h) => !h.cancelledAt && h.until > s.now).map((h) => `${(h.areas || []).join(', ')} until ${formatDay(new Date(h.until), s.tz)} ${t(h.until)}${h.reason ? ` ("${clip(h.reason, 100)}")` : ''}`);
  const openChanges = s.list(CHANGES).filter((c) => c.status === 'queued' || c.status === 'working').map((c) => `[${c.id}] ${c.status}: "${clip(c.said, 160)}"`);
  return [
    `DAY: ${dayName(date)} (${date}), time zone ${s.tz}.`,
    '', foodOf(s, date),
    '', 'THE DAY, TO THE MINUTE (from the app\'s records; the messages follow in full below):', timeline,
    '', 'EVERY MESSAGE, IN FULL (oldest first):', msgs.join('\n') || '(none)',
    '', 'WHAT THE COACH ALREADY KNOWS (don\'t give these as new facts):',
    `Learned facts (current; replaces or expire by id): ${learnedOf(s).map((n) => `[${n.id}] (from ${n.from || n.date}) ${clip(n.text, 300)}`).join(' | ') || 'none yet'}`,
    `The coach's notes: ${notesOf(s).filter((n) => n.topic !== 'learned').map((n) => `[${n.id}] ${clip(n.text, 300)}`).join(' | ') || 'none'}`,
    corrections ? `His corrections in his profile (rules already made):\n${corrections}` : '',
    '', `STATE NOW (${formatDay(new Date(s.now), s.tz)}, ${t(s.now)}; the records, true now):`,
    `Reminders still set (not sent, not cancelled): ${reminders.join(' | ') || 'none'}`,
    `Hold-offs running: ${holds.join(' | ') || 'none'}`,
    `Change requests not finished: ${openChanges.join(' | ') || 'none'}`,
    '', `CHANGES HE ASKED FOR, that day and the 2 days before (a fix must not repeat one of these):\n${changes.join('\n') || 'none'}`,
    fixedOnMac ? `\nFIXED THAT DAY IN CHATS ON THE MAC (from the build log; already done, never a fix again):\n${fixedOnMac}` : '',
  ].filter((x) => x !== null).join('\n');
}

/**
 * Sat 10/24 (his words: "We literally logged the extra meal... and that's not registered here"): the day's food as the
 * Fuel screen counts it: every meal logged to that day (his waking day), also one eaten after midnight before he slept.
 */
export function foodOf(s, date) {
  const plan = s.one('fuel', 'plan') || {};
  const meals = s.list('meals').filter((m) => m.date === date).sort((a, b) => a.at - b.at);
  const t = dayTotals(meals, s.list('meal-estimates'), date);
  const n = (x) => Math.round(x).toLocaleString('en-US');
  const each = meals.map((m) => {
    const one = mealTotals(m, s.list('meal-estimates'));
    const night = isoDate(new Date(m.at), s.tz) !== date ? ` ${formatDay(new Date(m.at), s.tz)}` : '';
    return `${m.name || 'meal'} ${formatTime(new Date(m.at), s.tz)}${night} ${one.known ? `${n(one.kcal)} kcal` : 'being read'}`;
  });
  return `FOOD THAT DAY (his waking day, as the Fuel screen counts it; the day's only food numbers): ${n(t.kcal)} kcal of ${plan.kcal ? n(plan.kcal) : '?'}, ${t.protein} g protein of ${plan.proteinG ?? '?'} g${meals.length ? ` (${each.join('; ')})` : ' (no meals logged)'}${t.estimated ? `, ${t.estimated} still estimates` : ''}.`;
}

/**
 * What chats on the Mac fixed that day: the "LATEST (<weekday> <M/D>, ...)" paragraphs of PROGRESS.md's "Where we
 * stopped" for that date, each cut to 700 characters.
 */
export function fixedOnMacFrom(progress = '', date) {
  const [, m, d] = String(date).split('-').map(Number);
  const tag = new RegExp(`^LATEST \\(\\w{3} ${m}/${d},`);
  const where = /^## Where we stopped\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(progress || ''))?.[1] || '';
  return where.split(/\n(?=LATEST \()/).map((p) => p.trim()).filter((p) => tag.test(p)).map((p) => clip(p, 700)).join('\n');
}

/** Was this exact text (case, accents and spacing aside) said in these messages? */
const saidIn = (text, pool) => { const f = fold(text); return f.length >= 4 && pool.some((p) => p.includes(f)); };

/** Does a quote repeat a change he already asked for (his words overlap)? */
function alreadyAsked(quote, changes) {
  const q = fold(quote); const qw = new Set(q.split(' ').filter((w) => w.length > 3));
  return changes.some((c) => asksOf(c).some((a) => {
    const f = fold(a.said);
    if (!f) return false;
    if (f.includes(q) || q.includes(f)) return true;
    const fw = new Set(f.split(' ').filter((w) => w.length > 3));
    const both = [...qw].filter((w) => fw.has(w)).length;
    return qw.size >= 4 && both / Math.min(qw.size, fw.size || 1) >= 0.6;
  }));
}

/**
 * The run's answer, checked before anything is kept: the diary within its limits, his words only if he said them,
 * facts that are new and dated, expiries of learned facts only, at most 3 fixes quoting the day and not asked before.
 * Returns {diary, facts, expire, fixes, morning, dropped: [why...]}.
 */
export function validate(answer, { s, date }) {
  const dropped = [];
  const a = answer && typeof answer === 'object' ? answer : {};
  const from = zonedTime(date, '00:00', s.tz); const to = zonedTime(addDays(date, 1), '00:00', s.tz);
  const msgs = s.list(MSGS).filter((m) => m.at >= from && m.at < to && m.text);
  const his = msgs.filter((m) => m.role === 'user').map((m) => fold(m.text));
  const any = msgs.map((m) => fold(m.text));
  const d = a.diary && typeof a.diary === 'object' ? a.diary : {};
  const summary = words(d.summary, SUMMARY_WORDS);
  if (!summary) throw new Error('the answer has no diary summary');
  const list = (x, n, len) => (Array.isArray(x) ? x : []).map((y) => clip(typeof y === 'string' ? y : y?.text, len)).filter(Boolean).slice(0, n);
  const hisWords = (Array.isArray(d.words) ? d.words : []).filter((w) => {
    const ok = w && saidIn(w.text, his);
    if (w && !ok) dropped.push(`not his words: "${clip(w.text, 80)}"`);
    return ok;
  }).slice(0, 12).map((w) => ({ at: clip(w.at, 12), text: clip(w.text, 600) }));
  const diary = { summary, line: clip(d.line || summary, 240), words: hisWords, decisions: list(d.decisions, 10, 300), open: list(d.open, 10, 300) };

  const current = learnedOf(s);
  const known = notesOf(s).map((n) => fold(n.text));
  const facts = [];
  for (const f of (Array.isArray(a.facts) ? a.facts : []).slice(0, MAX_FACTS * 2)) {
    const text = clip(f?.text, 300);
    if (!text) continue;
    if (known.includes(fold(text)) || facts.some((x) => fold(x.text) === fold(text))) { dropped.push(`known already: "${clip(text, 80)}"`); continue; }
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(f.from || '') && f.from <= date ? f.from : date;
    const replaces = f.replaces && current.some((n) => n.id === f.replaces) ? f.replaces : null;
    if (f.replaces && !replaces) dropped.push(`replaces an unknown or non-learned note: ${f.replaces}`);
    facts.push({ text, from: fromDate, replaces, source: clip(f.source, 300) });
    if (facts.length >= MAX_FACTS) break;
  }
  const replaced = new Set(facts.map((f) => f.replaces).filter(Boolean));
  const expire = (Array.isArray(a.expire) ? a.expire : []).filter((x) => {
    const ok = x?.id && current.some((n) => n.id === x.id) && !replaced.has(x.id);
    if (x?.id && !ok) dropped.push(`expire: not a current learned fact: ${x.id}`);
    return ok;
  }).map((x) => ({ id: x.id, why: clip(x.why, 200) }));

  const recent = s.list(CHANGES).filter((c) => c.status !== 'cancelled' && (c.doneAt || c.at) >= zonedTime(addDays(date, -2), '00:00', s.tz));
  const fixes = [];
  for (const f of Array.isArray(a.fixes) ? a.fixes : []) {
    if (fixes.length >= MAX_FIXES) { dropped.push('more than 3 fixes'); break; }
    const quote = clip(f?.quote, 2000);
    const want = clip(f?.want, 300);
    if (!quote || !want) { dropped.push('a fix without a quote or a want'); continue; }
    const fromHim = saidIn(quote, his);
    // Only his words, or a clear mistake quoted from the coach's or the app's own messages that day.
    if (!fromHim && !saidIn(quote, any)) { dropped.push(`fix quote not in the day's messages: "${clip(quote, 80)}"`); continue; }
    if (!fromHim && f.kind !== 'bug') { dropped.push(`not his words and not a mistake: "${clip(quote, 80)}"`); continue; }
    if (alreadyAsked(quote, recent) || fixes.some((x) => fold(x.quote) === fold(quote))) { dropped.push(`asked for already: "${clip(quote, 80)}"`); continue; }
    fixes.push({ quote, at: clip(f.at, 12), about: clip(f.about, 1200), want, kind: KINDS.includes(f.kind) ? f.kind : 'behaviour', fromHim });
  }
  return { diary, facts, expire, fixes, morning: clip(withoutFixes(a.morning), 200), dropped };
}

/**
 * @param {object} o
 * @param {ReturnType<import('../store.mjs').openStore>} o.store
 * @param {string} o.privateDir   logs/memory/<date>.txt and .result.json go there
 * @param {() => string} [o.profile]  his profile text (for his corrections)
 * @param {(o) => Promise<{text, ms}>} [o.run]  one Claude run (tests pass a fake)
 * @param {() => boolean} [o.busy]  a workout running or the coach answering: the morning message waits
 */
export function openNightly({ store, privateDir, profile = () => '', fixedOnMac = () => '', run = runOnce, push = null, busy = () => false, log = () => {}, now = () => Date.now(), tz = () => 'UTC', runHm = RUN_HM, since = null }) {
  const dir = join(privateDir, 'logs', 'memory');
  let running = false;
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const put = (col, id, data) => { store.writeLocal(col, id, data); return data; };
  // The first day it reviews: the day it was switched on (days before it had their fixes made in chats on the Mac,
  // outside the change queue, so a review of them would file those again).
  const first = since || store.getMeta(SINCE) || (() => { const d = isoDate(new Date(now()), tz()); store.setMeta(SINCE, d); return d; })();

  /**
   * Days due: ended at least until runHm of the next day and his waking day over (Sat 10/24: a meal he ate at 2:40 AM
   * before sleeping counts for the day before, so its review waits until he slept and got up, or 6:00 AM), the last 3
   * at most, oldest first, not done yet.
   */
  function dueDays(t = now()) {
    const zone = tz();
    const today = isoDate(new Date(t), zone);
    const awakeDay = wakingDay(t, { tz: zone, sleepLog: one('sleep-log', today), health: one('health', today), sessions: store.listRecords('sessions').map((r) => r.data).filter(Boolean) });
    const out = [];
    for (let i = CATCH_UP_DAYS; i >= 1; i--) {
      const date = addDays(today, -i);
      if (date < first || t < zonedTime(addDays(date, 1), runHm, zone) || date >= awakeDay) continue;
      const d = one(DIARY, date);
      if (d && (d.status === 'done' || d.status === 'empty' || (d.tries || 0) >= MAX_TRIES)) continue;
      // A failed run is tried again after 20 minutes, 3 times at most.
      if (d?.status === 'failed' && t - (d.at || 0) < RETRY_MS) continue;
      out.push(date);
    }
    return out;
  }

  /** One day: its input, one Claude run, the answer checked, then kept. Returns false when the day was empty (no run). */
  async function review(date) {
    const t0 = now();
    const s = snapshot(store, { tz: tz(), now: t0 });
    const from = zonedTime(date, '00:00', s.tz); const to = zonedTime(addDays(date, 1), '00:00', s.tz);
    const hasMessages = s.list(MSGS).some((m) => m.role === 'user' && m.at >= from && m.at < to);
    const prior = one(DIARY, date);
    if (!hasMessages && /^Nothing recorded/.test(timelineText(s, { date }))) {
      put(DIARY, date, { id: date, date, status: 'empty', at: t0 });
      log(`nightly ${date}: nothing happened that day`);
      return false;
    }
    const input = inputFor(s, date, { profile: profile(), fixedOnMac: fixedOnMac(date) });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${date}.txt`), input);
    let res;
    try {
      res = await run({ system: SYSTEM, content: input, model: MODEL.model, effort: MODEL.effort, timeoutMs: TIMEOUT_MS });
    } catch (e) {
      put(DIARY, date, { id: date, date, status: 'failed', at: now(), tries: (prior?.tries || 0) + 1, error: clip(e.message, 300) });
      log(`nightly ${date}: the run failed (${e.message})`);
      return null;
    }
    writeFileSync(join(dir, `${date}.result.json`), String(res.text || ''));
    let v;
    try { v = validate(parseJsonAnswer(res.text), { s: snapshot(store, { tz: s.tz, now: now() }), date }); } catch (e) {
      put(DIARY, date, { id: date, date, status: 'failed', at: now(), tries: (prior?.tries || 0) + 1, error: `the answer didn't pass the checks: ${clip(e.message, 200)}` });
      log(`nightly ${date}: the answer didn't pass the checks (${e.message})`);
      return null;
    }
    return keep(date, v, { ms: res.ms });
  }

  /** The checked answer, kept: facts (old ones expired), fixes filed, the diary. */
  function keep(date, v, { ms = null } = {}) {
    const t = now();
    const zone = tz();
    const factIds = [];
    const expired = [];
    for (const f of v.facts) {
      const id = `note-learned-${date}-${rand()}`;
      put(NOTES, id, { id, at: t, date: isoDate(new Date(t), zone), from: f.from, text: f.text, topic: 'learned', by: 'nightly', source: f.source, nightOf: date, tz: zone, ...(f.replaces ? { replaces: f.replaces } : {}) });
      factIds.push(id);
      if (f.replaces) {
        const old = one(NOTES, f.replaces);
        if (old) { put(NOTES, old.id, { ...old, expiredAt: t, expiredOn: date, replacedBy: id, why: `replaced by what ${dayName(date)} showed` }); expired.push(old.id); }
      }
    }
    for (const x of v.expire) {
      const old = one(NOTES, x.id);
      if (old && !old.expiredAt) { put(NOTES, old.id, { ...old, expiredAt: t, expiredOn: date, why: x.why }); expired.push(old.id); }
    }
    const fixIds = [];
    const messages = store.listRecords(MSGS).map((r) => r.data).filter(Boolean);
    v.fixes.forEach((f, i) => {
      const c = newChange({ said: f.quote, about: `${f.fromHim ? 'His words' : 'A message'} at ${f.at} on ${dayName(date)}. ${f.about}`, want: f.want, kind: f.kind, at: t + i, tz: zone, auto: true, by: 'nightly', messages: messages.filter((m) => m.at <= zonedTime(addDays(date, 1), '00:00', zone)) });
      put(CHANGES, c.id, c);
      fixIds.push(c.id);
    });
    const diary = put(DIARY, date, { id: date, date, status: 'done', at: t, ...v.diary, facts: factIds, expired, fixes: fixIds, morning: v.morning, foodKcal: kcalOf(date), dropped: v.dropped, ms });
    log(`nightly ${date}: diary written, ${factIds.length} facts, ${expired.length} expired, ${fixIds.length} fixes filed${v.dropped.length ? `; dropped: ${v.dropped.slice(0, 5).join('; ')}` : ''}`);
    return diary;
  }

  /** He is up today: he wrote, he logged his wake, a workout started, or the phone opened the app after 4 AM. */
  function awake(t) {
    const zone = tz();
    const today = isoDate(new Date(t), zone);
    const dawn = zonedTime(today, '04:00', zone);
    const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
    const wake = one('sleep-log', today)?.wake;
    return (wake && wake <= t && wake >= dawn - 3 * 3600000)
      || list(MSGS).some((m) => m.role === 'user' && m.at >= dawn && m.at <= t)
      || list('sessions').some((x) => x.startedAt >= dawn && x.startedAt <= t)
      || list('here').some((h) => h.phone && h.at >= dawn && h.at <= t);
  }

  async function tell(text, short, ref) {
    const t = now();
    const id = `cm.${String(t).padStart(13, '0')}.${rand()}`;
    store.writeLocal(MSGS, id, { id, role: 'assistant', text, at: t, tz: tz(), kind: 'nightly', ref });
    try { if (push?.list?.().length) await push.notify({ title: 'Coach', body: short || text, url: '#/coach', tag: ref }); } catch (e) { log(`nightly: notification: ${e.message}`); }
  }

  /** The day's food kcal as the Fuel screen counts it (meals logged to that day). */
  const kcalOf = (date) => Math.round(dayTotals(store.listRecords('meals').map((r) => r.data).filter((m) => m && !m.deleted), store.listRecords('meal-estimates').map((r) => r.data).filter(Boolean), date).kcal);

  /** The changes filed or fixed quietly overnight and not told yet. */
  const quietDone = () => store.listRecords(CHANGES).map((r) => r.data).filter((c) => c && c.announce === 'morning');

  /** Once he is up: one message with what was learned and fixed overnight; later quiet ones one by one. */
  async function morning(t = now()) {
    if (busy() || !awake(t) || heldOff('nightly', store.listRecords('coach-holds').map((r) => r.data).filter(Boolean), t)) return null;
    const zone = tz();
    const today = isoDate(new Date(t), zone);
    const diaries = store.listRecords(DIARY).map((r) => r.data).filter((d) => d && d.status === 'done' && !d.morningAt && d.date >= addDays(today, -CATCH_UP_DAYS) && d.date < today).sort((a, b) => a.date.localeCompare(b.date));
    const changes = store.listRecords(CHANGES).map((r) => r.data).filter(Boolean);
    const quiet = quietDone();
    if (!diaries.length) {
      // After the morning message: a quiet change that finishes later is told on its own.
      for (const c of quiet) { put(CHANGES, c.id, { ...c, announce: 'done', announcedAt: t }); await tell(c.answer, c.answer, `change-${c.id}`); }
      return null;
    }
    const filed = diaries.flatMap((d) => d.fixes || []).map((id) => changes.find((c) => c.id === id)).filter(Boolean);
    const done = [...new Map([...filed.filter((c) => c.status === 'done'), ...quiet.filter((c) => c.status === 'done')].map((c) => [c.id, c])).values()];
    const building = filed.filter((c) => c.status === 'queued' || c.status === 'working');
    const other = [...filed, ...quiet].filter((c) => c.status === 'failed' || c.status === 'question');
    // A meal logged after the review (he logs the night meal once he's up): the morning's "X of Y kcal" is the Fuel total now.
    const said = diaries.map((d) => withoutFixes(d.morning && d.foodKcal != null && kcalOf(d.date) !== d.foodKcal
      ? d.morning.replace(/\b\d[\d,]* of ([\d,]+ kcal)/, `${kcalOf(d.date).toLocaleString('en-US')} of $1`) : d.morning)).filter(Boolean);
    const learned = diaries.reduce((n, d) => n + (d.facts?.length || 0), 0);
    const lines = [
      said.length ? said.join(' ') : '',
      ...done.map((c) => fixLine('Fixed overnight', c.answer)),
      ...building.map((c) => `Being fixed now: ${clip(c.want || c.said, 120).replace(/([^.!?…])$/, '$1.')}`),
      ...other.map((c) => fixLine(c.status === 'question' ? 'Question' : 'Not fixed', c.answer)),
    ].filter(Boolean);
    for (const d of diaries) put(DIARY, d.date, { ...d, morningAt: t });
    for (const c of quiet) put(CHANGES, c.id, { ...c, announce: 'done', announcedAt: t });
    if (!lines.length) { log(`nightly: nothing to tell this morning (${learned} facts kept quietly)`); return null; }
    // The lock screen: what he learned, then how many fixes, never their words (they're in Talk, once each).
    const count = [done.length && `${done.length} fixed overnight`, building.length && `${building.length} being fixed`, other.length && `${other.length} need you`].filter(Boolean).join(', ');
    const tally = count && `${count[0].toUpperCase()}${count.slice(1)}, in Talk.`;
    const head = said.join(' ');
    const short = head ? (tally && head.length + tally.length < 200 ? `${head} ${tally}` : head) : lines.length > 1 && tally ? tally : lines[0];
    await tell(lines.join('\n'), clip(short, 200), `nightly-${today}`);
    log(`nightly: morning message sent (${done.length} fixed, ${building.length} building, ${learned} facts)`);
    return lines.join('\n');
  }

  /** Every few minutes: review a day that's due (one at a time), then the morning message. */
  async function tick(t = now()) {
    if (running) return;
    running = true;
    try {
      // One Claude run per tick, oldest day first; empty days are passed over without one.
      for (const date of dueDays(t)) if ((await review(date)) !== false) return;
      await morning(t);
    } finally { running = false; }
  }

  return { tick, review, keep, dueDays, morning, awake, _dir: dir };
}
