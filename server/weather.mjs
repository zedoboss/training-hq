// Weather for planning walks (Wed 10/21, his words: "he should check the UV index. He shouldn't recommend it when it's
// hot outside, when it's dangerous"). Open-Meteo: free, no account or key. Asked about once an hour for his rough
// location from the private config (config/weather.json: lat, lon rounded to about 1 km, label); nothing else is sent.
// Kept in the server's meta table ('weather'): {fetchedAt, label, hours: [{at, uv, feels, temp, rain}]}.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WEATHER_KEY = 'weather';
const EVERY_MS = 30 * 60000;

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
      const doc = { fetchedAt: now(), label: l.label || null, hours, current };
      store.setMeta(WEATHER_KEY, doc);
      return doc;
    } catch (e) {
      log(`weather: ${e.message}`);
      return cur || null;
    }
  }
  return { refresh, get: () => store.getMeta(WEATHER_KEY) || null };
}
