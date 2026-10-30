// The walk coach (Tue 10/20, his words: "its goal is to get me to go on a walk, to get me to get those 8K steps a day...
// If I don't respond within 5 minutes, it should bump me again and ask me... When are you going for a walk? Tell me so
// I can schedule it and not keep bumping you... If I tell it 'I'll go in an hour', he can say 'Okay, I'll message you
// in an hour'"). One record per day (collection 'walks', id = the date): what was asked and when, his plan, a walk
// in progress, walks done, skips. The Mac asks (server/notify.mjs walkTick); the coach records his answers (tool
// 'walk'). Pure, shared by the Mac and the phone.
import { formatHm, hmOf, isoDate, zonedTime } from './time.js';

/** Defaults, all in minutes. Claude's choices for his "very often" (Tue 10/20); Settings > Coach can change them later. */
export const WALK = {
  // No answer (Sun 10/25, his words: "Walk check-ins like his meal rule: a few, further apart, new words each time,
  // then stop"; the 6:00 PM walk had been asked about every 15 minutes till 10:56 PM in the same words): check-ins
  // this long after the ask, each said differently, then quiet until he answers. Replaces Tue 10/20's 5 minutes, then
  // every 15.
  checkInMin: [20, 60, 120],
  nagMin: 15,         // at least this long between two check-ins (the Mac catching up sends one at a time)
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
// Tue 10/27, his words: "Anything under 3 UV is okay for a walk"; "I'm in Vietnam... it's always gonna be hot it shouldn't
// rely on temperature only strictly by UV nothing else"; "if theres a high rain chance it should recommend that its high
// rain and that it could rain and i take the risk if i do walk" (a 6:11 PM walk at UV 0.1 had been moved for "feels
// 34°C, rain 42%"). Now UV alone decides: under 3 = safe, 3 to under 6 = caution, 6+ = never. The feels-like
// temperature is never a reason; rain (forecast or now) never holds or moves a walk: he's told the chance, his risk.
export const HEAT = { uvSafe: 3, uvNever: 6, rainHigh: 50, rainNowMm: 0.3 };
// Thu 10/22, his words: "there are clouds above me... but there is no rain... improve the weather system": the model's
// "drizzle, 0.2 mm" had been told to him as fact, with an umbrella. Now a model alone never makes it "raining": a drizzle
// code under 0.3 mm doesn't count, the nearest weather station's observation (a real one, server/weather.mjs) can veto
// the model, and what he says he sees outside beats both for an hour.
const RAINY = (code) => (code >= 61 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
export const SEEN_MS = 60 * 60000;   // his word on the weather holds this long
export const OBS_MS = 90 * 60000;    // a station observation older than this isn't "now"
/** What he said he sees outside, if recent: {at, raining, said} or null. */
export const seenNow = (weather, now) => (weather?.seen && now - weather.seen.at >= 0 && now - weather.seen.at < SEEN_MS ? weather.seen : null);
/** The nearest station's observation, if recent. */
export const obsNow = (weather, now) => (weather?.obs && now - weather.obs.at < OBS_MS ? weather.obs : null);
/**
 * Raining at his place now: {words, sure, source} or null. His word first; then the forecast model's current
 * conditions (rain code or 0.3 mm+), dropped when the nearest station sees no rain, sure only when the station sees it too.
 */
export function rainingNow(weather, now) {
  const seen = seenNow(weather, now);
  if (seen) return seen.raining ? { words: `he says it's raining${seen.said ? ` ("${seen.said}")` : ''}`, sure: true, source: 'him' } : null;
  const c = weather?.current;
  if (!c || now - c.at > 90 * 60000) return null;
  if (!((c.precip ?? 0) >= HEAT.rainNowMm || RAINY(c.code))) return null;
  const obs = obsNow(weather, now);
  if (obs && !obs.rain && !obs.near) return null;
  const words = `${weatherCodeText(c.code) || 'rain'}${c.precip != null ? `, ${c.precip} mm in the last hour` : ''}`;
  return obs ? { words: `${words}; the station ${obs.km} km away reports ${obs.wx}`, sure: true, source: 'model+station' } : { words: `forecast model: ${words}`, sure: false, source: 'model' };
}
/** "Raining now (...)" when sure; a forecast stays a forecast: "Rain likely now (forecast model: ...), not confirmed". */
const wetText = (wet) => (wet.sure ? `Raining now (${wet.words})` : `Rain likely now (${wet.words}), not confirmed`);
/** How many forecast models show rain (0.3 mm+) in an hour: {wet, of} or null. */
export function modelsAgree(h) {
  const mm = (h?.mm || []).filter((x) => x != null);
  return mm.length ? { wet: mm.filter((x) => x >= HEAT.rainNowMm).length, of: mm.length } : null;
}
/**
 * The forecast for one hour in words, with how sure it is: "rain 47%, 1 of 4 models show rain (models split, leaning
 * dry)". Half of them is a tie, not a lean (Thu 10/22 audit: 2 of 4 had read "leaning rain").
 */
export function rainChanceText(h) {
  if (!h) return 'unknown';
  const a = modelsAgree(h);
  const sure = !a ? '' : a.wet === 0 ? 'models agree: dry' : a.wet === a.of ? 'models agree: rain' : a.wet * 2 === a.of ? 'models split evenly' : a.wet * 2 > a.of ? 'models split, leaning rain' : 'models split, leaning dry';
  return `rain ${h.rain ?? '?'}%${a ? `, ${a.wet} of ${a.of} models show rain (${sure})` : ''}`;
}
/**
 * Umbrella only for confirmed rain (Thu 10/22, what he was told: "umbrella only for confirmed rain"): the station or
 * his own word says it's raining now. A forecast, however high, is given as a forecast.
 */
export function umbrellaWorth(weather, now) {
  return Boolean(rainingNow(weather, now)?.sure);
}
const HOUR = 3600000;
/** 'safe' | 'caution' | 'never' for one forecast hour, by UV only (Tue 10/27). */
export function hourRisk(h) {
  if (!h || h.uv == null) return 'unknown';
  if (h.uv >= HEAT.uvNever) return 'never';
  if (h.uv < HEAT.uvSafe) return 'safe';
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
/** The hour's UV in words: "UV 4.2". Only ever given as a reason when it is 3 or more (Tue 10/27). */
export const weatherWords = (h) => (h?.uv != null ? `UV ${Math.round(h.uv * 10) / 10}` : '');
/**
 * Rain, for him to weigh (Tue 10/27): raining now, or a high chance (50%+) this hour, said plainly with "your call";
 * it never holds or moves a walk. '' when there's nothing to say.
 */
export function rainNote(weather, now, h = hourAt(weather, now)) {
  const wet = weather ? rainingNow(weather, now) : null;
  if (wet) return `${wetText(wet)}: if you walk, you take the risk of getting wet${wet.sure ? ' (umbrella)' : ''}. Your call.`;
  if (h?.rain != null && h.rain >= HEAT.rainHigh) return `Rain chance is high, ${h.rain}%: it could rain. If you walk, you take the risk. Your call.`;
  return '';
}
/**
 * The next good time to walk from `from` until `until`: the first safe hour (UV under 3), else the first caution hour.
 * Rain doesn't count (Tue 10/27). The current hour counts if it is good (then `from` itself). Null when there is none.
 */
export function nextWalkTime(weather, from, until) {
  const hours = (weather?.hours || []).filter((h) => h.at + HOUR > from && h.at < until);
  const pick = (ok) => hours.find((h) => ok(h));
  const h = pick((x) => hourRisk(x) === 'safe') || pick((x) => hourRisk(x) === 'caution');
  return h ? { at: Math.max(h.at, from), h, risk: hourRisk(h) } : null;
}
/** Safe stretches (UV under 3) from `from` until `until`, as "5:00 PM-11:00 PM (UV 1 at most)". */
export function safeWindowsText(weather, from, until, tz) {
  const hours = (weather?.hours || []).filter((h) => h.at + HOUR > from && h.at < until && hourRisk(h) === 'safe');
  const runs = [];
  for (const h of hours) { const r = runs.at(-1); if (r && r.end === h.at) { r.end = h.at + HOUR; r.hs.push(h); } else runs.push({ start: Math.max(h.at, from), end: h.at + HOUR, hs: [h] }); }
  const t = (ms) => formatHm(hmOf(new Date(ms), tz));
  return runs.map((r) => `${t(r.start)}-${t(Math.min(r.end, until))} (UV ${Math.round(Math.max(...r.hs.map((x) => x.uv)) * 10) / 10} at most)`).join(', ');
}

/** Follow-ups to an ask (older records: follow, plan-follow, nag). */
const CHECKS = ['check', 'follow', 'plan-follow', 'nag'];
/** A time the coach picked (the weather), not his: never "you said" or "you set" (Sun 10/25). */
export const coachPlanned = (plan) => Boolean(plan && (plan.by === 'coach' || /^planned by the coach/.test(plan.said || '')));
/** The next check-in after the last ask in `asks`, or null once they're all out: texts[n] for the n-th. */
function checkInDue(asks, now, cfg, texts) {
  const i = asks.findLastIndex((a) => !CHECKS.includes(a.kind));
  if (i < 0) return null;
  const n = asks.length - 1 - i;
  if (n >= cfg.checkInMin.length) return null;
  if (now - asks[i].at < cfg.checkInMin[n] * 60000 || now - asks[asks.length - 1].at < cfg.nagMin * 60000) return null;
  return { kind: 'check', text: texts[Math.min(n, texts.length - 1)] };
}

export const emptyWalk = (date) => ({ id: date, date, asks: [], answeredAt: null, plan: null, going: null, walks: [], skips: [], goalAt: null });

const minOf = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + m; };
const nf = (n) => Math.round(n).toLocaleString('en-US');
const lastOf = (a) => a[a.length - 1] || null;

/** Steps in words: "6,223 of 8,000 steps as of 8:15 PM: 1,777 to go, about 18 minutes of walking." */
export function stepsText({ steps, goal, now, tz }) {
  if (!goal) return '';
  const fresh = steps?.steps != null && steps.asOf && now - steps.asOf <= WALK.freshMs;
  // Thu 10/29: "since this morning" went out at 12:00 AM. No reading at all is "yet today", whatever the hour.
  if (!fresh) return `No step count from your phone ${steps?.asOf ? `since ${formatHm(hmOf(new Date(steps.asOf), tz))}` : 'yet today'} (opening the app sends it). Goal ${nf(goal)}.`;
  const left = Math.max(0, goal - steps.steps);
  return `${nf(steps.steps)} of ${nf(goal)} steps as of ${formatHm(hmOf(new Date(steps.asOf), tz))}: ${nf(left)} to go, about ${Math.max(5, Math.ceil(left / WALK.stepsPerMin / 5) * 5)} minutes of walking.`;
}

/**
 * The steps of his waking day `day` (Apple Health counts by calendar day): past midnight, before he has slept, that
 * day's count plus the new calendar day's (Thu 10/29: at 12:00 AM the new day had none, "no step count" while
 * Wednesday's 7,337 were there). `one(date)` gives the health record of a date. Null when neither has a count.
 */
export function walkSteps(day, today, one) {
  const a = one(day), b = day !== today ? one(today) : null;
  if (a?.steps == null && b?.steps == null) return null;
  return { steps: (a?.steps || 0) + (b?.steps || 0), asOf: Math.max(a?.fileAt || 0, b?.fileAt || 0) || null };
}

/**
 * The record as it stands since `from` (when he woke, on the moving schedule): asks, answers, plans, walks and skips
 * from an earlier stretch awake don't count for this one (Thu 10/29: Wednesday's record held Tuesday night's
 * 12:00-2:00 AM asks, so his Wednesday evening got none).
 */
export function dayPart(doc, from) {
  if (!doc || !from) return doc;
  const after = (x) => (x?.at ?? 0) >= from;
  return {
    ...doc, asks: doc.asks.filter(after), walks: doc.walks.filter(after), skips: doc.skips.filter(after),
    answeredAt: (doc.answeredAt || 0) >= from ? doc.answeredAt : null,
    plan: doc.plan && (doc.plan.setAt ?? doc.plan.at) >= from ? doc.plan : null,
    going: after(doc.going) ? doc.going : null,
    goalAt: (doc.goalAt || 0) >= from ? doc.goalAt : null,
  };
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
 * @param {number} [o.homeAt]        the last thing he did at home (a meal answer, a meal, a workout start), or 0
 * @returns {{kind: 'ask'|'check'|'again'|'plan'|'planned'|'moved'|'no-window'|'back'|'goal', text: string}|null}
 */
export function walkDue({ now, tz, doc, steps = null, goal = 8000, wakeHm = '07:00', bedHm = '22:00', lastUserAt = 0, busy = false, usualHm = null, fasting = false, weather = null, homeAt = 0, cfg = WALK }) {
  const d = doc || emptyWalk(isoDate(new Date(now), tz));
  const nowMin = minOf(hmOf(new Date(now), tz));
  const wake = minOf(wakeHm); let bed = minOf(bedHm); if (bed <= wake) bed += 1440;
  const at = nowMin < wake && bed > 1440 ? nowMin + 1440 : nowMin;
  // Goal done (Thu 10/22, his words: "Why would I want a notification after 12 am? ... he should say: Have a good night,
  // catch you up in the morning"): a short well done, a good night when it's late, no cutoff.
  if (goal && steps?.steps != null && steps.steps >= goal) {
    const late = at < wake || at > bed - cfg.stopBeforeBedMin;
    return d.goalAt ? null : { kind: 'goal', text: `${nf(steps.steps)} steps: today's ${nf(goal)} is done. Well done.${late ? ' Have a good night, catch you in the morning.' : ''}` };
  }
  if (d.goalAt) return null;
  if (at < wake + cfg.startAfterWakeMin || at > bed - cfg.stopBeforeBedMin) return null;
  if (busy) return null;
  const st = stepsText({ steps, goal, now, tz });
  const last = lastOf(d.asks);
  // Weather: when the UV is 3+ now, plan (or move the app's own time) to the next good time. UV only (Tue 10/27): never
  // the heat, never rain; rain is told as his risk (rainNote).
  const endMs = now + (bed - cfg.stopBeforeBedMin - at) * 60000;
  const nowH = hourAt(weather, now);
  const risk = hourRisk(nowH);
  const better = weather ? nextWalkTime(weather, now, endMs) : null;
  const badNow = Boolean(weather) && (risk === 'never' || (risk === 'caution' && Boolean(better) && better.risk === 'safe' && better.at > now));
  const rainNow = weather ? rainNote(weather, now, nowH) : '';
  const withRain = (text) => (rainNow ? `${text} ${rainNow}` : text);
  const t = (ms) => formatHm(hmOf(new Date(ms), tz));
  // UV 3+ now, said as a fact at his own time (never moved): "UV 7 now, strong sun: under 3 from 5:00 PM."
  const uvNote = risk === 'caution' || risk === 'never' ? `${weatherWords(nowH)} now, strong sun: shade and a hat${better && better.risk === 'safe' && better.at > now ? `; under 3 from ${t(better.at)}` : ''}.` : '';
  // Only an answer about the walk (the coach's walk tool) starts a new round (Tue 10/27: his 5:32 PM lunch message
  // restarted Monday's 5:00 PM walk, six check-ins to 8:02 PM, three the same). Anything else he writes holds the next
  // check-in for half an hour; the count goes on.
  const answered = (t) => (d.answeredAt || 0) > t;
  const talking = (t) => (lastUserAt || 0) > t && now - lastUserAt < cfg.againMin * 60000;
  // Out walking: one "back?" after a while.
  if (d.going) {
    // Thu 10/22, 4:54 PM: "Back from the walk?" came after he'd said he was cooking. Something he did at home since he
    // went out (a meal answer, a meal, a workout) means the walk is over: no question.
    if (homeAt > d.going.at) return null;
    if (now - d.going.at >= cfg.backMin * 60000 && !d.asks.some((a) => a.kind === 'back' && a.at > d.going.at)) {
      return { kind: 'back', text: 'Back from the walk? How many minutes did you go?' };
    }
    return null;
  }
  const walked = lastOf(d.walks);
  if (walked && now - walked.at < cfg.afterWalkMin * 60000) return null;
  // After a walk, wait for a step count that includes it (Thu 10/22 audit: "No step count... go for a walk now" right
  // after one); 3 hours at most.
  if (walked && !(steps?.asOf > walked.at) && now - walked.at < 3 * 3600000) return null;
  const skip = lastOf(d.skips);
  if (skip?.until && now < skip.until) return null;
  // He gave a time: quiet until then, then "walk time", then the same follow-ups.
  if (d.plan) {
    if (now < d.plan.at) return null;
    // Whose time it is: his words back to him, or the hour the coach picked; never "you set" for the coach's.
    const mine = !coachPlanned(d.plan);
    // The app's own time came and the UV is 3+ now: move it to the next good time, once per plan. A time he set himself
    // is never moved for the weather (Tue 10/27: his 6:11 PM walk was moved to 7:00 PM at UV 0.1).
    if (!mine && badNow && better && better.at > now && !d.asks.some((a) => a.kind === 'moved' && a.at >= d.plan.setAt)) {
      return { kind: 'moved', planAt: better.at, text: withRain(`It's ${weatherWords(nowH)} now, too strong for a walk. I moved it to ${t(better.at)} (${weatherWords(better.h)}). Say if you want to go anyway.`) };
    }
    const asked = d.asks.filter((a) => a.at >= d.plan.at);
    const planTime = formatHm(hmOf(new Date(d.plan.at), tz));
    const whose = mine ? `you said ${planTime}` : `${planTime} was the hour I picked for the weather`;
    // His time: ask, don't order (his profile, Thu 10/22: "Did you start walking?"); the UV and rain as facts, his call.
    if (!asked.length) return { kind: 'plan', text: withRain(mine ? `Walk time: you said ${d.plan.said ? `"${d.plan.said}"` : planTime}. Did you start walking?${uvNote ? ` ${uvNote}` : ''} ${st}` : `Walk time: ${planTime}, the hour I picked for the weather. Going, or another time? ${st}`) };
    const l = lastOf(asked);
    if (answered(l.at)) return now - d.answeredAt >= cfg.againMin * 60000 ? { kind: 'again', text: `Back to the walk: ${whose}, and no new time yet. Going now, or pick one? ${st}` } : null;
    if (talking(l.at)) return null;
    return checkInDue(asked, now, cfg, [
      `Walk: ${whose}. Out yet? Going now, or a new time?`,
      `Still no word on the walk. ${st} Going now, or tell me a time and I'll wait for it.`,
      'Last check on the walk: going, a new time, or skipping it today?',
    ]);
  }
  const since = Math.max(last?.at || 0, skip?.at || 0, walked?.at || 0);
  // No time set and the UV is 3+ now: the coach plans it (his words: "he can schedule them").
  if (badNow) {
    if (better && better.at > now) return { kind: 'planned', planAt: better.at, text: `${fasting ? 'Fasting today, so moving is the job. ' : ''}Walk: ${weatherWords(nowH)} now, too strong. I planned it for ${t(better.at)}, when it's ${weatherWords(better.h)}. ${st} Tell me if another time suits you.` };
    if (!d.asks.some((a) => a.kind === 'no-window')) return { kind: 'no-window', text: `UV under 3 doesn't come again before your bedtime (now ${weatherWords(nowH)}). Steps can wait for early morning or after sunset.` };
    return null;
  }
  if (!last || (skip && skip.at > last.at)) {
    // His usual hour (Thu 10/29: "Go out for a walk now. You usually go around 8:00 PM." at 12:00 AM): still ahead in
    // his day, more than half an hour away: ask if he's going then. After his last ask time: not said. Sat 10/31 (Fri
    // 10/30, 6:05 AM, "Go out for a walk now." with no usual hour to go by): every ask is a question, at any hour; the
    // time is his to say.
    const fast = fasting ? 'Fasting today, so moving is the job. ' : '';
    const u = usualHm ? minOf(usualHm) + (minOf(usualHm) < wake && bed > 1440 ? 1440 : 0) : null;
    const usual = u != null && u <= bed - cfg.stopBeforeBedMin ? formatHm(usualHm) : null;
    if (usual && u - at > 30) return { kind: 'ask', text: `${fast}Walk: ${st} You usually go around ${usual}. Going then, or another time?` };
    return { kind: 'ask', text: withRain(`${fast}Walk: ${st}${risk === 'caution' ? ` ${weatherWords(nowH)} now: shade and a hat.` : ''}${usual ? ` You usually go around ${usual}${at - u > 30 ? `; it's past that` : ''}.` : ''} When are you going?`) };
  }
  if (answered(last.at)) {
    return now - Math.max(d.answeredAt, since) >= cfg.againMin * 60000 ? { kind: 'ask', text: `Walk: ${st} No time set yet. When are you going?` } : null;
  }
  if (talking(last.at)) return null;
  // The last question wasn't a walk ask (e.g. "no safe walking weather" and the weather turned): ask fresh.
  if (lastOf(d.asks.filter((a) => !CHECKS.includes(a.kind)))?.kind !== 'ask') {
    return { kind: 'ask', text: `Walk: ${st} No time set yet. When are you going?` };
  }
  return checkInDue(d.asks, now, cfg, [
    'No answer on the walk. When are you going? Tell me a time and I leave you alone until then.',
    `Still no time for your walk. ${st} One time, and I stop asking.`,
    'Last check on the walk: going, a time, or skipping it today?',
  ]);
}

/** The record with one more question asked. */
export const withAsk = (doc, date, kind, at) => ({ ...(doc || emptyWalk(date)), asks: [...(doc?.asks || []), { at, kind }].slice(-60), ...(kind === 'goal' ? { goalAt: at } : {}) });

/**
 * His answer, recorded by the coach (tool 'walk').
 * plan: {at, said}; going; done: {minutes, steps}; skip: {reason, until}; clear: forget the plan.
 */
export function withAnswer(doc, date, a, now) {
  const d = { ...(doc || emptyWalk(date)), answeredAt: now };
  if (a.action === 'plan') return { ...d, plan: { at: a.at, said: a.said || null, setAt: now, ...(a.by === 'coach' ? { by: 'coach' } : {}) }, going: null };
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
  else if (d.plan) parts.push(coachPlanned(d.plan) ? `the app planned it for ${t(d.plan.at)} (for the weather; his time only if he agrees, never "you said" or "you set")` : `he said he'd go at ${t(d.plan.at)}${d.plan.said ? ` ("${d.plan.said}")` : ''}`);
  else if (last && !((d.answeredAt || 0) > last.at)) parts.push(`asked at ${t(last.at)}, no answer yet: get a time from him`);
  for (const w of d.walks) parts.push(`walked at ${t(w.at)}${w.minutes ? ` for ${w.minutes} min` : ''}`);
  for (const s of d.skips) parts.push(`skipped at ${t(s.at)}${s.reason ? ` (${s.reason})` : ''}`);
  const week = docs.filter((x) => x?.date && x.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7)
    .map((x) => `${x.date.slice(5)}: ${[x.plan ? `planned ${t(x.plan.at)}${coachPlanned(x.plan) ? ' (by the app)' : ''}` : '', ...x.walks.map((w) => `walked ${t(w.at)}${w.minutes ? ` ${w.minutes} min` : ''}`), ...x.skips.map((s) => `skipped${s.reason ? ` (${s.reason})` : ''}`), x.goalAt ? 'goal met' : ''].filter(Boolean).join(', ') || 'asked, no walk'}`);
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
