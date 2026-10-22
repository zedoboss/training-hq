// The walk coach (Tue 10/20, his words: "its goal is to get me to go on a walk, to get me to get those 8K steps a day...
// If I don't respond within 5 minutes, it should bump me again and ask me... When are you going for a walk? Tell me so
// I can schedule it and not keep bumping you... If I tell it 'I'll go in an hour', he can say 'Okay, I'll message you
// in an hour'"). One record per day (collection 'walks', id = the date): what was asked and when, his plan, a walk
// in progress, walks done, skips. The Mac asks (server/notify.mjs walkTick); the coach records his answers (tool
// 'walk'). Pure, shared by the Mac and the phone.
import { formatHm, hmOf, isoDate, zonedTime } from './time.js';

/** Defaults, all in minutes. Claude's choices for his "very often" (Tue 10/20); Settings > Coach can change them later. */
export const WALK = {
  followMin: 5,       // no answer to a question this long: ask for a time
  nagMin: 15,         // still nothing: ask again this often
  againMin: 30,       // he answered without a time or a walk: ask again after this long
  afterWalkMin: 90,   // a walk done: the next ask waits this long (the step count catches up)
  backMin: 40,        // out walking: "back?" after this long
  startAfterWakeMin: 60, // the first ask of the day, after he wakes
  stopBeforeBedMin: 60,  // no asks in the last hour before bed
  skipMin: 60,        // "not now" with no time: ask again after this long
  freshMs: 3 * 3600000, // a step count older than this is not trusted for "steps to go"
  stepsPerMin: 100,   // an estimate: about 100 steps a minute walking (Claude's estimate)
};

// Heat and sun (Wed 10/21, his words: "check the UV index. He shouldn't recommend it when it's hot outside, when it's
// dangerous"). Claude's thresholds from common UV and heat guidance (not medical advice): safe = UV under 3 and it
// feels 33°C or less; never = UV 6 or more, or it feels 36°C or more; in between only when nothing safe is left today.
// Rain of 70% or more is avoided when another hour is free.
export const HEAT = { uvSafe: 3, uvNever: 6, feelsSafe: 33, feelsNever: 36, rainAvoid: 70, rainNowMm: 0.3, dryAfterRain: 50 };
const WET = (code) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
/** Raining at his place now (the model's current conditions, if fresh): {words} or null. */
export function rainingNow(weather, now) {
  const c = weather?.current;
  if (!c || now - c.at > 90 * 60000) return null;
  if ((c.precip ?? 0) >= HEAT.rainNowMm || WET(c.code)) return { words: `${weatherCodeText(c.code) || 'rain'}${c.precip != null ? `, ${c.precip} mm in the last hour` : ''}` };
  return null;
}
const HOUR = 3600000;
/** 'safe' | 'caution' | 'never' for one forecast hour. */
export function hourRisk(h) {
  if (!h || h.uv == null || h.feels == null) return 'unknown';
  if (h.uv >= HEAT.uvNever || h.feels >= HEAT.feelsNever) return 'never';
  if (h.uv < HEAT.uvSafe && h.feels <= HEAT.feelsSafe) return 'safe';
  return 'caution';
}
const hourAt = (weather, at) => (weather?.hours || []).find((h) => h.at <= at && at < h.at + HOUR) || null;
/** WMO weather codes (Open-Meteo) in words. */
export function weatherCodeText(code) {
  if (code == null) return null;
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code >= 95) return 'thunderstorm';
  return 'unsettled';
}
export const weatherWords = (h) => (h ? `UV ${Math.round(h.uv * 10) / 10}, feels ${Math.round(h.feels)}°C${h.rain != null && h.rain >= 40 ? `, rain ${h.rain}%` : ''}` : '');
/**
 * The next good time to walk from `from` until `until`: the first safe hour (a dry one if there is one), else the
 * first caution hour. The current hour counts if it is good (then `from` itself). Null when there is none.
 */
export function nextWalkTime(weather, from, until) {
  const hours = (weather?.hours || []).filter((h) => h.at + HOUR > from && h.at < until);
  const pick = (ok) => hours.find((h) => ok(h));
  const h = pick((x) => hourRisk(x) === 'safe' && (x.rain ?? 0) < HEAT.rainAvoid) || pick((x) => hourRisk(x) === 'safe') || pick((x) => hourRisk(x) === 'caution');
  return h ? { at: Math.max(h.at, from), h, risk: hourRisk(h) } : null;
}
/** Safe stretches from `from` until `until`, as "5:00 PM-midnight (UV 1, feels 31°C)". */
export function safeWindowsText(weather, from, until, tz) {
  const hours = (weather?.hours || []).filter((h) => h.at + HOUR > from && h.at < until && hourRisk(h) === 'safe');
  const runs = [];
  for (const h of hours) { const r = runs.at(-1); if (r && r.end === h.at) { r.end = h.at + HOUR; r.hs.push(h); } else runs.push({ start: Math.max(h.at, from), end: h.at + HOUR, hs: [h] }); }
  const t = (ms) => formatHm(hmOf(new Date(ms), tz));
  return runs.map((r) => `${t(r.start)}-${t(Math.min(r.end, until))} (UV ${Math.round(Math.max(...r.hs.map((x) => x.uv)) * 10) / 10} at most, feels ${Math.round(Math.min(...r.hs.map((x) => x.feels)))}-${Math.round(Math.max(...r.hs.map((x) => x.feels)))}°C)`).join(', ');
}

export const emptyWalk = (date) => ({ id: date, date, asks: [], answeredAt: null, plan: null, going: null, walks: [], skips: [], goalAt: null });

const minOf = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + m; };
const nf = (n) => Math.round(n).toLocaleString('en-US');
const lastOf = (a) => a[a.length - 1] || null;

/** Steps in words: "6,223 of 8,000 steps as of 8:15 PM: 1,777 to go, about 18 minutes of walking." */
export function stepsText({ steps, goal, now, tz }) {
  if (!goal) return '';
  const fresh = steps?.steps != null && steps.asOf && now - steps.asOf <= WALK.freshMs;
  if (!fresh) return `No step count from your phone since ${steps?.asOf ? formatHm(hmOf(new Date(steps.asOf), tz)) : 'this morning'} (opening the app sends it). Goal ${nf(goal)}.`;
  const left = Math.max(0, goal - steps.steps);
  return `${nf(steps.steps)} of ${nf(goal)} steps as of ${formatHm(hmOf(new Date(steps.asOf), tz))}: ${nf(left)} to go, about ${Math.max(5, Math.ceil(left / WALK.stepsPerMin / 5) * 5)} minutes of walking.`;
}

/** The hour he usually walks, from the last two weeks of plans and walks (memory), as "HH:00", or null. */
export function usualWalkHm(docs = [], { today, tz } = {}) {
  const from = isoDate(new Date(Date.parse(`${today}T12:00:00Z`) - 14 * 86400000), 'UTC');
  const hours = new Map();
  for (const d of docs) {
    if (!d?.date || d.date >= today || d.date < from) continue;
    const at = d.walks?.[0]?.at ?? d.going?.at ?? d.plan?.at;
    if (!at) continue;
    const h = hmOf(new Date(at), tz).slice(0, 2);
    hours.set(h, (hours.get(h) || 0) + 1);
  }
  const best = [...hours.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? `${best[0]}:00` : null;
}

/**
 * What to say now, or null. Asks only in his waking hours (from an hour after he wakes to an hour before bed), never
 * while a workout or the sauna runs, and stops for the day once the goal is met.
 * @param {object} o
 * @param {object|null} o.doc        today's walk record
 * @param {{steps:number, asOf:number}|null} o.steps  today's steps (Apple Health) and when they were read
 * @param {number} o.goal            his daily step goal
 * @param {number} o.lastUserAt      when he last wrote or spoke to the coach
 * @param {string|null} [o.usualHm]  his usual walk hour (usualWalkHm)
 * @returns {{kind: 'ask'|'follow'|'nag'|'plan'|'plan-follow'|'back'|'goal', text: string, calm?: boolean}|null}
 */
export function walkDue({ now, tz, doc, steps = null, goal = 8000, wakeHm = '07:00', bedHm = '22:00', lastUserAt = 0, busy = false, usualHm = null, fasting = false, weather = null, cfg = WALK }) {
  const d = doc || emptyWalk(isoDate(new Date(now), tz));
  const nowMin = minOf(hmOf(new Date(now), tz));
  const wake = minOf(wakeHm); let bed = minOf(bedHm); if (bed <= wake) bed += 1440;
  const at = nowMin < wake && bed > 1440 ? nowMin + 1440 : nowMin;
  // Goal done (Thu 10/22, his words: "Why would I want a notification after 12 am? ... he should say: Have a good night,
  // catch you up in the morning"): a short well done, a good night when it's late, no cutoff and no push line (calm).
  if (goal && steps?.steps != null && steps.steps >= goal) {
    const late = at < wake || at > bed - cfg.stopBeforeBedMin;
    return d.goalAt ? null : { kind: 'goal', calm: true, text: `${nf(steps.steps)} steps: today's ${nf(goal)} is done. Well done.${late ? ' Have a good night, catch you in the morning.' : ''}` };
  }
  if (d.goalAt) return null;
  if (at < wake + cfg.startAfterWakeMin || at > bed - cfg.stopBeforeBedMin) return null;
  if (busy) return null;
  const st = stepsText({ steps, goal, now, tz });
  const last = lastOf(d.asks);
  // Weather: when the hour isn't good for walking, plan (or move) the walk to the next good time instead of "go now".
  const endMs = now + (bed - cfg.stopBeforeBedMin - at) * 60000;
  const nowH = hourAt(weather, now);
  const risk = hourRisk(nowH);
  // Raining now (Wed 10/21, "check if it's raining"): wait for the first safe hour with under 50% rain.
  const wet = weather ? rainingNow(weather, now) : null;
  const dry = wet ? (weather.hours || []).find((h) => h.at > now && h.at < endMs && hourRisk(h) === 'safe' && (h.rain ?? 100) < HEAT.dryAfterRain) : null;
  const better = wet ? (dry ? { at: dry.at, h: dry, risk: 'safe' } : null) : weather ? nextWalkTime(weather, now, endMs) : null;
  const badNow = weather && (wet ? Boolean(better) : risk === 'never' || (risk === 'caution' && better && better.risk === 'safe' && better.at > now));
  const t = (ms) => formatHm(hmOf(new Date(ms), tz));
  const heardSince = (t) => (d.answeredAt || 0) > t || (lastUserAt || 0) > t;
  // Out walking: one "back?" after a while.
  if (d.going) {
    if (now - d.going.at >= cfg.backMin * 60000 && !d.asks.some((a) => a.kind === 'back' && a.at > d.going.at)) {
      return { kind: 'back', text: 'Back from the walk? How many minutes did you go?' };
    }
    return null;
  }
  const walked = lastOf(d.walks);
  if (walked && now - walked.at < cfg.afterWalkMin * 60000) return null;
  const skip = lastOf(d.skips);
  if (skip?.until && now < skip.until) return null;
  // He gave a time: quiet until then, then "walk time", then the same follow-ups.
  if (d.plan) {
    if (now < d.plan.at) return null;
    // His time came but it's too hot or bright now: move it to the next good time, once per plan.
    if (badNow && better && better.at > now && !d.asks.some((a) => a.kind === 'moved' && a.at >= d.plan.setAt)) {
      return { kind: 'moved', planAt: better.at, text: `${wet ? `Raining now (${wet.words})` : `It's ${weatherWords(nowH)} now`}: not a walk to do. I moved your walk to ${t(better.at)} (${weatherWords(better.h)}${wet ? `, rain ${better.h.rain}%` : ''}). Say if you want to go anyway.` };
    }
    const asked = d.asks.filter((a) => a.at >= d.plan.at);
    const planTime = formatHm(hmOf(new Date(d.plan.at), tz));
    if (!asked.length) return { kind: 'plan', text: `Walk time: you said ${d.plan.said ? `"${d.plan.said}"` : planTime}. Go now. ${st}` };
    const l = lastOf(asked);
    if (heardSince(l.at)) return now - Math.max(d.answeredAt || 0, lastUserAt || 0) >= cfg.againMin * 60000 ? { kind: 'nag', text: `Walk: you said ${planTime}. Out yet? Going now, or a new time? ${st}` } : null;
    if (l.kind === 'plan' && now - l.at >= cfg.followMin * 60000) return { kind: 'plan-follow', text: `You said ${planTime} for your walk. Out yet? Going now, or a new time?` };
    if (now - l.at >= cfg.nagMin * 60000) return { kind: 'nag', text: `Still not out for the walk you set for ${planTime}. Going now, or a new time? ${st}` };
    return null;
  }
  const since = Math.max(last?.at || 0, skip?.at || 0, walked?.at || 0);
  // No time set and it isn't good walking weather now: the coach plans it (his words: "he can schedule them").
  if (badNow) {
    if (better && better.at > now) return { kind: 'planned', planAt: better.at, text: `${fasting ? 'Fasting today, so moving is the job. ' : ''}Walk: ${wet ? `raining now (${wet.words})` : `too hot or bright now (${weatherWords(nowH)})`}. I planned it for ${t(better.at)}, when it's ${weatherWords(better.h)}${wet ? `, rain ${better.h.rain}%` : ''}. ${st} Tell me if another time suits you.` };
    if (!d.asks.some((a) => a.kind === 'no-window')) return { kind: 'no-window', text: `No safe walking weather left today (now ${weatherWords(nowH)}). Steps can wait for a cooler hour: early morning or after sunset.` };
    return null;
  }
  if (!last || (skip && skip.at > last.at)) {
    return { kind: 'ask', text: `${fasting ? 'Fasting today, so moving is the job. ' : ''}Walk: ${st} Go out for a walk now${nowH ? ` (${weatherWords(nowH)}${risk === 'caution' ? ': shade and water' : ''})` : ''}.${usualHm ? ` You usually go around ${formatHm(usualHm)}.` : ''} When are you going?` };
  }
  if (heardSince(last.at)) {
    return now - Math.max(d.answeredAt || 0, lastUserAt || 0, since) >= cfg.againMin * 60000 ? { kind: 'ask', text: `Walk: ${st} No time set yet. When are you going?` } : null;
  }
  if ((last.kind === 'ask' || last.kind === 'plan') && now - last.at >= cfg.followMin * 60000) {
    return { kind: 'follow', text: 'No answer on the walk. When are you going? Tell me a time and I leave you alone until then.' };
  }
  if (now - last.at >= cfg.nagMin * 60000) return { kind: 'nag', text: `Still no time for your walk. When are you going? One time, and I stop asking. ${st}` };
  return null;
}

/** The record with one more question asked. */
export const withAsk = (doc, date, kind, at) => ({ ...(doc || emptyWalk(date)), asks: [...(doc?.asks || []), { at, kind }].slice(-60), ...(kind === 'goal' ? { goalAt: at } : {}) });

/**
 * His answer, recorded by the coach (tool 'walk').
 * plan: {at, said}; going; done: {minutes, steps}; skip: {reason, until}; clear: forget the plan.
 */
export function withAnswer(doc, date, a, now) {
  const d = { ...(doc || emptyWalk(date)), answeredAt: now };
  if (a.action === 'plan') return { ...d, plan: { at: a.at, said: a.said || null, setAt: now }, going: null };
  if (a.action === 'going') return { ...d, going: { at: now }, plan: null };
  if (a.action === 'done') return { ...d, going: null, plan: null, walks: [...d.walks, { at: now, minutes: a.minutes ?? null, steps: a.steps ?? null }] };
  if (a.action === 'skip') return { ...d, plan: null, skips: [...d.skips, { at: now, reason: a.reason || '', until: a.until ?? now + WALK.skipMin * 60000 }] };
  if (a.action === 'clear') return { ...d, plan: null };
  return d;
}

/** Today in one line for the coach, and the last week as memory. */
export function walkLines(docs = [], { today, now, tz, steps = null, goal = 8000, usualHm = null } = {}) {
  const t = (ms) => formatHm(hmOf(new Date(ms), tz));
  const d = docs.find((x) => x?.date === today) || emptyWalk(today);
  const last = lastOf(d.asks);
  const parts = [stepsText({ steps, goal, now, tz }).replace(/\.$/, '')];
  if (d.goalAt) parts.push('goal met today');
  else if (d.going) parts.push(`out walking since ${t(d.going.at)}`);
  else if (d.plan) parts.push(`he said he'd go at ${t(d.plan.at)}${d.plan.said ? ` ("${d.plan.said}")` : ''}`);
  else if (last && !((d.answeredAt || 0) > last.at)) parts.push(`asked at ${t(last.at)}, no answer yet: get a time from him`);
  for (const w of d.walks) parts.push(`walked at ${t(w.at)}${w.minutes ? ` for ${w.minutes} min` : ''}`);
  for (const s of d.skips) parts.push(`skipped at ${t(s.at)}${s.reason ? ` (${s.reason})` : ''}`);
  const week = docs.filter((x) => x?.date && x.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7)
    .map((x) => `${x.date.slice(5)}: ${[x.plan ? `planned ${t(x.plan.at)}` : '', ...x.walks.map((w) => `walked ${t(w.at)}${w.minutes ? ` ${w.minutes} min` : ''}`), ...x.skips.map((s) => `skipped${s.reason ? ` (${s.reason})` : ''}`), x.goalAt ? 'goal met' : ''].filter(Boolean).join(', ') || 'asked, no walk'}`);
  return [`Walk today: ${parts.join('; ')}.${usualHm ? ` He usually walks around ${formatHm(usualHm)}.` : ''}`, ...(week.length ? [`Walks, last days: ${week.join('; ')}.`] : [])];
}

/** "in 60 minutes" or "18:30" to a time today (tomorrow if that clock time has passed). */
export function planAt({ inMinutes = null, time = null, now, tz }) {
  if (inMinutes) return now + Math.round(inMinutes) * 60000;
  if (!/^\d{2}:\d{2}$/.test(time || '')) return null;
  const today = isoDate(new Date(now), tz);
  let at = zonedTime(today, time, tz);
  if (at <= now) at = zonedTime(isoDate(new Date(now + 86400000), tz), time, tz);
  return at;
}
