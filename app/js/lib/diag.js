// What the phone's sounds actually did (Thu 10/22: at the gym the rest ding and a hold's beeps were silent, volume up,
// not on silent, and nothing here could say why). Timer sounds and the coach's counts note how each one went (a sound
// file, Web Audio, the coach's voice; the audio's state; a refusal); main.js sends them to the Mac's log in small
// batches, so a silent beep can be traced next time.
const queue = [];
let sink = null;
let timer = null;

/** Note one event: {what, ...details}. */
export function diag(event) {
  queue.push({ at: Date.now(), ...event });
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  if (sink && !timer) timer = setTimeout(flush, 3000);
}

function flush() {
  timer = null;
  if (!sink || !queue.length) return;
  const batch = queue.splice(0, queue.length);
  Promise.resolve(sink(batch)).catch(() => { queue.unshift(...batch.slice(-50)); });
}

/** Where the notes go (main.js: the Mac). */
export function setDiagSink(fn) { sink = fn; if (queue.length && !timer) timer = setTimeout(flush, 3000); }
