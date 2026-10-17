// Small in-memory app state with change notifications. Screens read from here and redraw on change;
// the database and sync code write to it.
const state = {
  paired: false,
  macUrl: null,
  mac: { reachable: null, lastSeen: null, lastError: null },
  sync: { lastAt: null, pending: 0, running: false },
  programme: null,
  settings: null,
  equipment: null,
};
const subs = new Set();

export const getState = () => state;

export function setState(patch) {
  for (const [k, v] of Object.entries(patch)) {
    state[k] = v && typeof v === 'object' && !Array.isArray(v) && state[k] && typeof state[k] === 'object'
      ? { ...state[k], ...v }
      : v;
  }
  for (const fn of subs) fn(state);
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
