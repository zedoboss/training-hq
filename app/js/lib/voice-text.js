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
export const REASON_TEXT = { you: 'YOU', noise: 'NOISE', music: 'MUSIC', unsure: 'TOO SHORT', 'not-you': 'NOT YOU', 'not-calibrated': 'NOT SET UP', empty: 'NO WORDS', duplicate: 'ALREADY HEARD' };

/** Why a calibration phrase was not kept, in his words. */
export const ENROL_PROBLEM = {
  'too-short': "Didn't catch enough of that. Say it again, a bit closer.",
  'not-like-the-others': "That didn't sound like your other phrases (someone else, or noise?). Say it again.",
};
