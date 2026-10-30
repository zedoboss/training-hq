// A fasting day (Wed 10/21, his words: "I told him that I'm gonna fast. Why is he asking me to cook? And that I should
// [take] supplements. Obviously, I'm fasting, so I'm not gonna get any... He can say, still, go for a walk"). Kept on
// the day record: days/<date>.fast = {at, by, said, endedAt?}. While it runs: no cooking, meal-time, food or
// supplement prompts; walks stay on, asked, never ordered (Sat 10/31); no sauna (his own checklist wants food and water in the last few hours).
// A meal logged after the fast began ends it (he broke it).

/** Is he fasting on this date? meals: that day's meals (a meal after the fast began ends it). */
export function fastingOn(days, date, meals = []) {
  const f = days?.[date]?.fast;
  if (!f || f.endedAt) return false;
  return !meals.some((m) => m && m.date === date && (m.at || 0) > f.at);
}

/** The day record with a fast started (on) or ended. */
export function withFast(doc, date, { on, by = 'coach', said = null }, at) {
  const base = { ...(doc || {}), date };
  if (on) return { ...base, fast: { at, by, said: said ? String(said).slice(0, 120) : null } };
  return base.fast ? { ...base, fast: { ...base.fast, endedAt: at } } : base;
}
