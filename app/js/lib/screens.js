// Every screen of the app by name (Tue 10/20, his words: the coach should "navigate through the app itself... If I
// say 'Open the chat', it should open"). The coach's open_screen tool picks one; the phone goes there. Also how the
// coach is told which screen he is looking at. Screens marked `needs` take something to open (the active session, an
// exercise, a routine, a supplement, a scan date); the Mac fills that in.

export const SCREENS = [
  ['today', '#/today', 'Today (home)'],
  ['talk', '#/coach', 'Talk (the chat with the coach)'],
  ['coach_notes', '#/coach/notes', 'Coach notes'],
  ['checkin', '#/checkin', 'Readiness check-in'],
  ['train', '#/train', 'Train'],
  ['session', '#/session/', 'The workout in progress', 'session'],
  ['finish', '#/finish/', 'Finish the workout in progress', 'session'],
  ['library', '#/library', 'Exercise library'],
  ['exercise', '#/exercise/', 'One exercise', 'exercise'],
  ['routine', '#/routine/', 'One routine', 'routine'],
  ['programme', '#/programme', 'Programme'],
  ['holds', '#/holds', 'Tendon holds'],
  ['demos', '#/demos', 'Demo clips'],
  ['stats', '#/stats', 'Statistics'],
  ['stats_month', '#/stats/month', 'Monthly report'],
  ['calendar', '#/calendar', 'Calendar'],
  ['history', '#/history', 'Workout history'],
  ['progression', '#/progression', 'Progression'],
  ['readiness_table', '#/readiness', 'Readiness table'],
  ['squat', '#/squat', 'Squat Depth'],
  ['fuel', '#/fuel', 'Fuel'],
  ['supplements', '#/supps', 'Supplements today'],
  ['supplements_list', '#/supps/list', 'All supplements'],
  ['supplements_plan', '#/supps/plan', 'Supplement plans and restock'],
  ['supplement', '#/supp/', 'One supplement', 'supplement'],
  ['vitamins', '#/micro', 'Vitamins and minerals'],
  ['sauna', '#/sauna', 'Sauna'],
  ['sauna_checklist', '#/sauna/check', 'Sauna checklist'],
  ['body', '#/body', 'Body'],
  ['health', '#/body/health', 'Apple Health'],
  ['measurements', '#/body/measure', 'Measurements'],
  ['progress_photos', '#/body/photos', 'Progress photos'],
  ['body_scan', '#/body/scan', 'Body scan'],
  ['body_scan_results', '#/body/scan/r/', 'Body scan results of a day', 'date'],
  ['body_scan_trends', '#/body/scan/trends', 'Body scan trends'],
  ['body_scan_checklist', '#/body/scan/protocol', 'Body scan checklist'],
  ['recovery', '#/body/recovery', 'Surgery recovery'],
  ['settings', '#/settings', 'Settings'],
  ['voice', '#/voice', 'Voice settings'],
  ['import', '#/import', 'Import history'],
  ['export', '#/export', 'Export'],
].map(([id, hash, label, needs]) => ({ id, hash, label, ...(needs ? { needs } : {}) }));

export const SCREEN_IDS = SCREENS.map((s) => s.id);
export const screenById = (id) => SCREENS.find((s) => s.id === id) || null;

/** A link the phone may go to: the app's own screens only. */
export const safeHash = (h) => (typeof h === 'string' && /^#\/[\w./-]{0,120}$/.test(h) && !h.includes('..') ? h : null);

/** Which screen a link is ("#/session/abc" -> the workout in progress), for the coach's context. */
export function screenOf(hash) {
  const h = safeHash(hash) || '#/today';
  const path = h === '#/' ? '#/today' : h.replace(/\/$/, '');
  let best = null;
  for (const s of SCREENS) {
    const base = s.hash.replace(/\/$/, '');
    if (path === base || (s.needs && path.startsWith(s.hash)) || path.startsWith(`${base}/`)) {
      if (!best || base.length > best.hash.replace(/\/$/, '').length) best = s;
    }
  }
  return best || SCREENS[0];
}
