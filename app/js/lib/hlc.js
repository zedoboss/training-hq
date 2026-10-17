// Hybrid logical clock: a change stamp that always moves forward, even if a device's clock is wrong.
// Format: 13-digit wall-clock ms, 6-digit counter, 12-character device id, joined by '-'.
// Fixed widths mean stamps compare correctly as plain strings, and the device id breaks ties.
// The same code runs on the phone and the Mac, so both sides always pick the same winner.

const pad = (n, w) => String(n).padStart(w, '0');

export function formatHlc(wall, counter, device) {
  return `${pad(wall, 13)}-${pad(counter, 6)}-${device}`;
}

export function parseHlc(hlc) {
  const [wall, counter, device] = hlc.split('-');
  return { wall: Number(wall), counter: Number(counter), device };
}

export function isDeviceId(id) {
  return typeof id === 'string' && /^[0-9a-z]{12}$/.test(id);
}

export function newDeviceId(random = () => crypto.getRandomValues(new Uint8Array(6))) {
  return [...random()].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} device 12-character device id
 * @param {{wall:number, counter:number}=} saved last state, so a reload never moves the clock back
 * @param {() => number} now
 */
export function createClock(device, saved = { wall: 0, counter: 0 }, now = () => Date.now()) {
  if (!isDeviceId(device)) throw new Error(`bad device id: ${device}`);
  let last = { wall: saved.wall, counter: saved.counter };
  return {
    /** Stamp for a local change. */
    tick() {
      const w = now();
      last = w > last.wall ? { wall: w, counter: 0 } : { wall: last.wall, counter: last.counter + 1 };
      return formatHlc(last.wall, last.counter, device);
    },
    /** Move past a stamp seen from another device. */
    receive(hlc) {
      const r = parseHlc(hlc);
      const w = now();
      const wall = Math.max(w, last.wall, r.wall);
      let counter = 0;
      if (wall === last.wall && wall === r.wall) counter = Math.max(last.counter, r.counter) + 1;
      else if (wall === last.wall) counter = last.counter + 1;
      else if (wall === r.wall) counter = r.counter + 1;
      last = { wall, counter };
    },
    state: () => ({ ...last }),
  };
}

/** The one merge rule: a record version wins if its stamp is newer. */
export function newer(incoming, current) {
  return !current || incoming.hlc > current.hlc;
}
