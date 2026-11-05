// Thu 11/5 (missing feature 13): the phone couldn't reach the Mac while NextDNS was on, and nothing on the phone said
// so; the coach and sync just failed quietly. When the Mac has been unreachable for 2 minutes while the phone itself is
// online, a banner says so, with the likely cause. Pure helpers; ui/mac-banner.js draws it.

export const WARN_AFTER_MS = 2 * 60000;

/** When the Mac went quiet: kept while it stays unreachable, cleared the moment it answers. */
export function downSinceNext(prev, reachable, now) {
  if (reachable === false) return prev ?? now;
  if (reachable === true) return null;
  return prev ?? null;
}

/**
 * The banner text, or null. Only when paired, the phone is online (offline is the phone's problem, not the Mac's) and the
 * Mac has failed for WARN_AFTER_MS.
 */
export function reachWarning({ paired, online = true, downSince, now, afterMs = WARN_AFTER_MS }) {
  if (!paired || !online || downSince == null || now - downSince < afterMs) return null;
  const min = Math.floor((now - downSince) / 60000);
  // Thu 11/5 (11:26 AM to 12:02 PM): the Mac stayed up but this phone's Tailscale dropped, and he restarted the app, then
  // the phone. Tailscale off and on fixes it; restarting the app can't. Notifications don't go through Tailscale.
  return `Can't reach your Mac for ${min} min, though this phone is online. Most likely this phone's Tailscale dropped: open Tailscale, turn it off and on (no restart needed). Still nothing? NextDNS may be blocking it. The app reconnects by itself; coach, sync and recordings wait till then.`;
}
