// Stock-ticker style tint: green above the list average, red below, stronger the further out
// (capped at 2 standard deviations). Lower-is-better stats are flipped.

// A column's average and spread (null when there's nothing to compare)
export interface TintScale {
  mean: number;
  sd: number;
}

export function tintScale(values: (number | null)[]): TintScale | null {
  const known = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (known.length < 2) return null;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / known.length);
  return sd ? { mean, sd } : null;
}

// Tint for one value against a column's precomputed scale (compute the scale once per column)
export function tintFrom(value: number | null, scale: TintScale | null, lowerIsBetter = false): string | null {
  if (value === null || !scale) return null;
  let z = (value - scale.mean) / scale.sd;
  if (lowerIsBetter) z = -z;
  const strength = Math.round((Math.min(Math.abs(z), 2) / 2) * 85);
  // The row's surface can set its own good / bad colors and the neutral the tint fades toward (light
  // text on dark rows by default; a light surface would fade toward dark instead)
  const hue = z >= 0 ? 'var(--tint-good, #3ee07a)' : 'var(--tint-bad, #ff5a4f)';
  return `color-mix(in srgb, ${hue} ${strength}%, var(--tint-base, #fff))`;
}

export function tintColor(value: number | null, values: (number | null)[], lowerIsBetter = false): string | null {
  return tintFrom(value, tintScale(values), lowerIsBetter);
}

// The list average the tint is centered on (null when nothing to compare)
export function tintAverage(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}
