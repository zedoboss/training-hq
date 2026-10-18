// Always-on listening (step 9.7) arrives in the next part of step 9. Until then listening is never on.
const subs = new Set();
export const listening = () => false;
export async function start() { throw new Error('Listening arrives with the next part of step 9.'); }
export function stop() {}
export function hold() {}
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
