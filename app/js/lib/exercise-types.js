// Exercise types: which fields a set has and how its load counts.
// Hold is not a type: any exercise can have a "hold" set (duration, optional weight).

export const TYPES = {
  weight_reps: { label: 'Weight × reps', fields: ['kg', 'reps'] },
  reps_only: { label: 'Bodyweight reps', fields: ['reps'] },
  weighted_bodyweight: { label: 'Bodyweight + added weight', fields: ['kg', 'reps'], kgMeans: 'added' },
  assisted_bodyweight: { label: 'Assisted bodyweight', fields: ['kg', 'reps'], kgMeans: 'assistance' },
  duration: { label: 'Time', fields: ['durationS'] },
  weight_duration: { label: 'Weight × time', fields: ['kg', 'durationS'] },
  distance_duration: { label: 'Distance + time', fields: ['distanceM', 'durationS'] },
  weight_distance: { label: 'Weight × distance', fields: ['kg', 'distanceM'] },
};

export const SET_TYPES = {
  warmup: { short: 'W', label: 'Warm-up' },
  normal: { short: null, label: 'Normal' },
  failure: { short: 'F', label: 'To failure' },
  dropset: { short: 'D', label: 'Drop set' },
  hold: { short: 'H', label: 'Hold' },
};

export const MUSCLES = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'lats', 'upper_back', 'traps', 'lower_back', 'abdominals',
  'quadriceps', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors', 'neck', 'cardio', 'full_body', 'other',
];

export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'plate', 'kettlebell', 'band', 'bodyweight', 'other'];

export const muscleLabel = (m) => m.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());

/** Fields a set of this exercise shows. Hold sets always show time (and weight if the type has one). */
export function setFields(type, setType) {
  const t = TYPES[type] || TYPES.weight_reps;
  if (setType === 'hold') return t.fields.includes('kg') ? ['kg', 'durationS'] : ['durationS'];
  return t.fields;
}

/**
 * Load that counts for volume and the 30% guard.
 * bodyweightKg is needed for bodyweight types; without it they count only the added weight.
 */
export function effectiveKg(type, kg, bodyweightKg = null) {
  const t = TYPES[type] || TYPES.weight_reps;
  if (t.kgMeans === 'added') return (bodyweightKg ?? 0) + (kg ?? 0);
  if (t.kgMeans === 'assistance') return bodyweightKg != null ? Math.max(0, bodyweightKg - (kg ?? 0)) : 0;
  if (type === 'reps_only') return bodyweightKg ?? 0;
  return kg ?? 0;
}
