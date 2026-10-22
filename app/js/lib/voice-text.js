// Voice words (step 9): the calibration phrases, the short words of the silent readout. Pure.

/**
 * What he reads out at calibration (about a minute): what he actually says mid-session (brief section 12), plus his
 * own supplement names from his list (passed in; nothing personal is written here).
 */
export function calibrationPhrases(suppNames = []) {
  const names = suppNames.filter(Boolean).map((n) => String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim());
  const first = names.slice(0, 3); const rest = names.slice(3, 6);
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0]);
  return [
    'Eighty for eight',
    'Next exercise',
    'Start the timer',
    'Sixty two point five for ten',
    'Add fifteen seconds',
    'Skip the rest',
    first.length ? `Took ${list(first)}` : 'Took my creatine and vitamin C',
    "What's my next set?",
    'Bodyweight for twelve, last set to failure',
    'Knees one, not worse. Legs zero, back zero, energy two.',
    rest.length ? `Skipped ${list(rest)} today` : 'Skipped the magnesium today',
    'How heavy is the bench today?',
    "Start today's session",
    'That set felt easy, go up next time',
  ];
}

/** Short words for the silent readout when speech was heard but not acted on. */
export const REASON_TEXT = { you: 'YOU', noise: 'NOISE', music: 'MUSIC', unsure: 'TOO SHORT', 'not-you': 'NOT YOU', 'not-calibrated': 'NOT SET UP', empty: 'NO WORDS', duplicate: 'ALREADY HEARD', aside: 'OTHERS TALKING · SAY COACH', 'self-talk': 'SELF-TALK', hush: 'STOPPED' };

/**
 * The header's two voice buttons (Thu 10/22, like Claude voice mode): the mic only switches his microphone, never the
 * coach's voice (he muted himself right after "Yo coach" and the answer was never spoken); the X beside it, shown while
 * an answer is coming or being spoken, is what stops the coach.
 * @param {{on: boolean, held: boolean}} s  voice.snapshot()
 * @returns {'mute' | 'held' | 'listen'}
 */
export const micTap = (s) => (s.on ? 'mute' : s.held ? 'held' : 'listen');
/** @param {{replying: boolean}} s */
export const showsStop = (s) => !!s.replying;

/** Why a calibration phrase was not kept, in his words. */
export const ENROL_PROBLEM = {
  'too-short': "Didn't catch enough of that. Say it again, a bit closer.",
  'not-like-the-others': "That didn't sound like your other phrases (someone else, or noise?). Say it again.",
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Text as it should be spoken: no markdown or symbols, times with the letters "A M" / "P M" (brief section 4), dates
 * as "October 20", "kg" as "kilos", "60 x 8" as "60 for 8".
 */
export function speechText(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*([AaPp])\.\s?[Mm]\./g, (_, t, ap) => `${t} ${ap.toUpperCase()} M`)
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*([AaPp])[Mm]\b/g, (_, t, ap) => `${t} ${ap.toUpperCase()} M`)
    .replace(/\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?:\/(\d{2,4}))?\b/g, (_, m, d, y) => `${MONTHS[Number(m) - 1]} ${Number(d)}${y ? `, ${y.length === 2 ? `20${y}` : y}` : ''}`)
    .replace(/(\d)\s*(kg)?\s*[x×]\s*(\d)/g, (_, a, kg, b) => `${a}${kg ? ' kg' : ''} for ${b}`)
    .replace(/(\d)\s*(?:kg|KG)\b/g, '$1 kilos')
    .replace(/\bkg\b/g, 'kilos')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a reply arriving in pieces into whole sentences, so each can be spoken as soon as it is complete.
 * push(delta) returns the sentences finished by it; flush() returns what is left.
 */
export function sentenceSplitter() {
  let buf = '';
  // A full stop after a number ("62.5") or a short abbreviation is not the end of a sentence.
  const END = /([.!?…]+["')\]]*)(\s+)|\n+/g;
  return {
    push(delta) {
      buf += delta;
      const out = [];
      let from = 0;
      END.lastIndex = 0;
      let m;
      while ((m = END.exec(buf))) {
        const cut = m.index + (m[1] ? m[1].length : 0);
        const piece = buf.slice(from, cut).trim();
        if (piece.length >= 2) { out.push(piece); from = m.index + m[0].length; }
      }
      buf = buf.slice(from);
      return out;
    },
    flush() { const rest = buf.trim(); buf = ''; return rest ? [rest] : []; },
  };
}

/**
 * Quiet rule for spoken replies (9.9, brief section 4): after a set, speak only if it differs from the target or
 * breaks a rule. The coach answers a plain logged set with exactly "Logged."; that is a tick sound, not words. The
 * first sentence waits for a second one (or the end) only when it is "Logged.": any other first sentence is spoken at
 * once (Tue 10/20: holding every first sentence cost a second or more before each answer).
 * sentence(s) returns the sentences to speak now; end() returns {speak, tick}.
 */
export function replyGate() {
  let first = null; let count = 0;
  return {
    sentence(s) {
      count++;
      if (count === 1 && /^logged\.?$/i.test(String(s).trim())) { first = s; return []; }
      const out = first != null ? [first, s] : [s];
      first = null;
      return out;
    },
    end() {
      const f = first; first = null;
      if (f == null) return { speak: [], tick: false };
      if (count === 1 && /^logged\.?$/i.test(f.trim())) return { speak: [], tick: true };
      return { speak: [f], tick: false };
    },
  };
}
