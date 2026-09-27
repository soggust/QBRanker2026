// Stock-ticker style tint: green above the list average, red below, stronger the further out
// (capped at 2 standard deviations). Lower-is-better stats are flipped.
export function tintColor(value: number | null, values: (number | null)[], lowerIsBetter = false): string | null {
  if (value === null) return null;
  const known = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (known.length < 2) return null;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / known.length);
  if (!sd) return null;
  let z = (value - mean) / sd;
  if (lowerIsBetter) z = -z;
  const strength = Math.round((Math.min(Math.abs(z), 2) / 2) * 85);
  const hue = z >= 0 ? '#3ee07a' : '#ff5a4f';
  return `color-mix(in srgb, ${hue} ${strength}%, #fff)`;
}
