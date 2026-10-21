// Coach initiatives (Wed 10/21, his words: "I've skipped the neck workout. I still haven't started that. He should
// suggest or ask. Same with the holds... 'Oh, we still haven't started that. We should get into it. When do you think
// you want to start? Let me help you... You can fit this in that day'... if I tell it 'Oh, I want to', don't push...
// 'it might fit better on Pull because of X, Y and Z'"). The Mac finds what has been planned but not done, or never
// started; the coach (Claude) writes the opening message itself, in the same conversation, so his reply continues it.
// Pure: facts in, open items out. Each item: {key, priority, facts}. The facts are for the coach, not for him.
import { addDays } from './rotation.js';
import { areaStatus, roundsByDate } from './holds.js';
import { placeLabel } from './neck.js';

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/**
 * @param {object} o
 * @param {string} o.today
 * @param {Array} o.sessions        workout sessions (all)
 * @param {Array} o.sets
 * @param {object|null} o.neck      schedule/neck
 * @param {Array} o.areas           tendon areas
 * @param {object|null} o.bridge
 * @param {Array} o.sauna           sauna sessions
 * @param {object|null} o.saunaPlan sauna-plan/main
 * @param {object|null} o.readiness tendons/readiness (the table)
 * @param {object|null} o.scanPlan  scan-plan/main
 * @param {(ms:number) => string} o.dayOf  local date of a time
 * @returns {Array<{key: string, priority: number, facts: string}>} most important first
 */
export function openItems({ today, sessions = [], sets = [], neck = null, areas = [], bridge = null, sauna = [], saunaPlan = null, readiness = null, scanPlan = null, dayOf }) {
  const out = [];
  // Neck: planned in the rotation and never done since (or not for a week and more).
  if (neck?.planned) {
    const neckDays = sessions.filter((s) => s.dayType === 'neck' && s.status === 'done' && s.startedAt).map((s) => dayOf(s.startedAt)).sort();
    const last = neckDays.at(-1) || null;
    const since = neck.on || null;
    const host = (neck.place || '').replace('after-', '');
    const missed = sessions.filter((s) => s.status === 'done' && s.dayType === host && s.startedAt && dayOf(s.startedAt) >= (since || '0000') && !neckDays.includes(dayOf(s.startedAt))).map((s) => dayOf(s.startedAt));
    if (!last ? missed.length : daysBetween(last, today) >= 8) {
      out.push({ key: 'neck', priority: 60, facts: `Neck: his plan since ${since || '?'} puts it ${(placeLabel(neck.place) || neck.place || '').toLowerCase()}. ${last ? `Last done ${last}.` : 'Never done yet.'}${missed.length ? ` ${host[0].toUpperCase()}${host.slice(1)} days without it: ${missed.join(', ')}.` : ''} His Neck routine is 3 exercises (light, about 10 minutes); the 30% cap applies from a light start.` });
    }
  }
  // Tendon holds: behind the phase's target (heal: 2 a day; fix: 3-4 a week).
  const rounds = roundsByDate(areas, sessions, sets, bridge);
  for (const a of areas) {
    if (!a.holds?.length || a.phase === 'none' || a.phase === 'unknown') continue;
    const st = areaStatus(a, rounds[a.id] || {}, today);
    const week = Object.entries(rounds[a.id] || {}).filter(([d]) => d > addDays(today, -7) && d <= today).reduce((n, [, c]) => n + c, 0);
    const behind = a.phase === 'heal' ? week < 7 : st.due;
    if (behind) out.push({ key: `holds-${a.id}`, priority: a.phase === 'heal' ? 70 : 55, facts: `Tendon holds, ${a.label} (${a.phase} phase: ${a.phase === 'heal' ? '3 holds twice a day' : '3-4 rounds a week'}): ${week} round${week === 1 ? '' : 's'} in the last 7 days; today ${st.text}. Holds: ${a.holds.map((h) => h.exercise).join(', ')}. A round is 3 × 30 s with 2:00 between (about 6 min).` });
  }
  // The readiness table: still a draft, so check-ins can't run.
  if (readiness && readiness.status !== 'confirmed') out.push({ key: 'readiness', priority: 45, facts: 'His readiness table (the check-in before a session) is still a DRAFT: he confirms or edits it once on the check-in screen, then check-ins work. Takes about 2 minutes.' });
  // Sauna: never started, or nothing planned for the coming week.
  const lastSauna = sauna.map((s) => s.date).sort().at(-1) || null;
  const planned = (saunaPlan?.planned || []).filter((p) => p.date >= today);
  if (!planned.length && (!saunaPlan?.askAfter || saunaPlan.askAfter <= today) && (!lastSauna || daysBetween(lastSauna, today) >= 6)) {
    out.push({ key: 'sauna', priority: 40, facts: `Sauna: ${lastSauna ? `last session ${lastSauna}` : 'never started (his goal: once a week, 4 × 30 min; the ladder starts at 1 round of 10 minutes)'}; nothing planned. Use sauna_plan propose for the days that fit his split (rest days first, never before lifting), and ask the one-time doctor question before the first plan if it is still open.` });
  }
  // Body scan safety notice never read.
  if (scanPlan && !scanPlan.safety?.readAt) out.push({ key: 'scan-safety', priority: 35, facts: "Body scans: he hasn't recorded reading the Evolt scanner's own safety notice yet (one tap on the body scan screen, or tell you)." });
  return out.sort((a, b) => b.priority - a.priority);
}

/** The instruction the coach gets for an opening message (it never sees this as his words). */
export function initiativePrompt(item) {
  return `[From the app, not from him. He does not see this. He will see only your reply, as a notification from Coach and in Talk.]
Open a conversation with him about this, like a human coach who noticed it:
${item.facts}
One short message (2-4 sentences): say what you noticed, why it matters for him (his goals), propose where it fits in his split with the reason (which day, before or after what, how long), and ask when he wants to start or whether that day works. Reply exactly SKIP only when he already answered this topic (the conversation or your notes say when he'll start, or not now), or when he told you to drop it. Planning a later day is always fine: a fast, being busy today or the late hour is no reason to skip; fit the plan around it (holds need no food; neck and sauna can be planned for another day).`;
}
