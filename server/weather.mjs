// Weather for planning walks (Wed 10/21, his words: "he should check the UV index. He shouldn't recommend it when it's
// hot outside, when it's dangerous"). Open-Meteo: free, no account or key. Asked about once an hour for his rough
// location from the private config (config/weather.json: lat, lon rounded to about 1 km, label); nothing else is sent.
// Kept in the server's meta table ('weather'): {fetchedAt, label, hours: [{at, uv, feels, temp, rain, mm}], current, obs,
// seen}. Thu 10/22 ("there are clouds above me... but there is no rain... improve the weather system"): one model's
// "drizzle" isn't the sky at his door, so three more sources: mm = each of four forecast models' rain for the hour (how
// sure the forecast is), obs = the nearest airport weather station's latest observation (aviationweather.gov METAR, real,
// every 30 minutes, no key), and seen = what he said he sees outside (tool weather_seen), kept across refreshes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WEATHER_KEY = 'weather';
const EVERY_MS = 15 * 60000;
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless'];

export function openWeather({ configDir, store, log = () => {}, fetchFn = fetch, now = () => Date.now() }) {
  const loc = () => { try { const c = JSON.parse(readFileSync(join(configDir, 'weather.json'), 'utf8')); return Number.isFinite(c.lat) && Number.isFinite(c.lon) ? c : null; } catch { return null; } };
  async function refresh({ force = false } = {}) {
    const l = loc();
    if (!l) return null;
    const cur = store.getMeta(WEATHER_KEY);
    if (!force && cur?.fetchedAt && now() - cur.fetchedAt < EVERY_MS) return cur;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${l.lat.toFixed(2)}&longitude=${l.lon.toFixed(2)}&hourly=uv_index,apparent_temperature,temperature_2m,precipitation_probability&current=precipitation,rain,weather_code,apparent_temperature,temperature_2m&timezone=GMT&forecast_days=2`;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
      const j = await res.json();
      const h = j.hourly || {};
      const c = j.current || {};
      // "Is it raining?" (Wed 10/21): the model's current conditions (a forecast model, not a rain gauge at his door).
      const current = c.time ? { at: Date.parse(`${c.time}:00Z`), precip: c.precipitation ?? null, rain: c.rain ?? null, code: c.weather_code ?? null, feels: c.apparent_temperature ?? null, temp: c.temperature_2m ?? null } : null;
      const hours = (h.time || []).map((t, i) => ({ at: Date.parse(`${t}:00Z`), uv: h.uv_index?.[i] ?? null, feels: h.apparent_temperature?.[i] ?? null, temp: h.temperature_2m?.[i] ?? null, rain: h.precipitation_probability?.[i] ?? null }))
        .filter((x) => Number.isFinite(x.at));
      const mm = await modelRain(l).catch((e) => { log(`weather models: ${e.message}`); return null; });
      for (const x of hours) if (mm?.has(x.at)) x.mm = mm.get(x.at);
      const obs = await station(l).catch((e) => { log(`weather station: ${e.message}`); return cur?.obs || null; });
      const doc = { fetchedAt: now(), label: l.label || null, hours, current, obs, seen: store.getMeta(WEATHER_KEY)?.seen || null };
      store.setMeta(WEATHER_KEY, doc);
      return doc;
    } catch (e) {
      log(`weather: ${e.message}`);
      return cur || null;
    }
  }
  /** Each model's rain (mm) per hour: Map(at -> [mm per model]). */
  async function modelRain(l) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${l.lat.toFixed(2)}&longitude=${l.lon.toFixed(2)}&hourly=precipitation&models=${MODELS.join(',')}&timezone=GMT&forecast_days=2`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const h = (await res.json()).hourly || {};
    return new Map((h.time || []).map((t, i) => [Date.parse(`${t}:00Z`), MODELS.map((m) => h[`precipitation_${m}`]?.[i] ?? null)]));
  }
  /** The nearest station within about 55 km with a METAR in the last 2 hours: {at, id, km, wx, rain, near, sky} or null. */
  async function station(l) {
    const d = 0.5;
    const url = `https://aviationweather.gov/api/data/metar?bbox=${(l.lat - d).toFixed(2)},${(l.lon - d).toFixed(2)},${(l.lat + d).toFixed(2)},${(l.lon + d).toFixed(2)}&format=json&hours=2`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`aviationweather.gov answered ${res.status}`);
    const list = await res.json();
    const best = (Array.isArray(list) ? list : []).filter((m) => Number.isFinite(m.obsTime))
      .map((m) => ({ m, km: kmBetween(l, m) })).sort((p, q) => p.km - q.km || q.m.obsTime - p.m.obsTime)[0];
    return best ? metarObs(best.m, best.km) : null;
  }
  return { refresh, get: () => store.getMeta(WEATHER_KEY) || null };
}

/** Save what he says he sees outside (his word beats the models for an hour). */
export function saveSeen(store, seen) {
  const cur = store.getMeta(WEATHER_KEY) || {};
  store.setMeta(WEATHER_KEY, { ...cur, seen });
}

const kmBetween = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.round(Math.sqrt(x * x + y * y) * 6371);
};
const SKY = { CLR: 'clear', SKC: 'clear', NSC: 'clear', CAVOK: 'clear', FEW: 'a few clouds', SCT: 'partly cloudy', BKN: 'mostly cloudy', OVC: 'overcast' };
const WX = [[/TS/, 'thunderstorm'], [/SHRA|SH\b/, 'showers'], [/\+RA/, 'heavy rain'], [/-RA/, 'light rain'], [/RA/, 'rain'], [/DZ/, 'drizzle']];
/** One METAR (aviationweather.gov JSON) in plain words. */
export function metarObs(m, km) {
  const groups = String(m.wxString || '').split(/\s+/).filter(Boolean);
  const here = groups.filter((g) => !g.startsWith('VC')).join(' ');
  const nearby = groups.filter((g) => g.startsWith('VC')).join(' ');
  const what = (g) => WX.find(([re]) => re.test(g))?.[1] || null;
  const rain = what(here);
  const near = /SH|TS/.test(nearby) ? (/TS/.test(nearby) ? 'thunderstorms nearby' : 'showers nearby') : null;
  const order = ['CLR', 'SKC', 'NSC', 'CAVOK', 'FEW', 'SCT', 'BKN', 'OVC'];
  const covers = (m.clouds || []).map((c) => c.cover).filter((c) => SKY[c]);
  const top = covers.sort((p, q) => order.indexOf(q) - order.indexOf(p))[0] || (SKY[m.cover] ? m.cover : null);
  return { at: m.obsTime * 1000, id: m.icaoId || null, km, rain: Boolean(rain), near: Boolean(near), wx: rain || near || 'no rain', sky: top ? SKY[top] : null };
}
