// Names of tendon holds (Tue 11/10, his words: "make the hold for tendons, names of the exercises make sense. Because I
// think now they're the same. They should in the name have like dot hold"). A hold done on a lift's machine is its own
// exercise, "<lift> · Hold" ("Cupping · Hold", "Bench Press (Smith Machine) · Hold"); a name that already says hold
// ("Toes Wall Squat Hold") stays. The older forms ("Leg Extension Hold (Machine)", or the bare lift name on hold sets)
// are the same hold.

/** The lift a hold belongs to: "Cupping · Hold" and "Leg Extension Hold (Machine)" -> "Cupping", "Leg Extension (Machine)". */
export const holdBase = (name) => String(name || '').replace(/\s*·\s*hold\b/i, '').replace(/\s+Hold\b/i, '').replace(/\s+/g, ' ').trim();

/** The hold's own name: "<lift> · Hold", or the name as it is when it already says hold (and isn't the older "X Hold (Machine)"). */
export function holdName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return n;
  if (/·\s*hold\b/i.test(n)) return n;
  if (/\bhold\b/i.test(n) && !/\bhold\s*\(/i.test(n)) return n;
  return `${holdBase(n)} · Hold`;
}
