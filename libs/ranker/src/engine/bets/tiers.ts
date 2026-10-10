// A pick's band, in one place: the bettor's confidence (picks.mjs's BANDS: lock, high, medium, low) and the name
// the site shows for it (LOCK, LOVE, LIKE, PASS), on the Bets rows, the lines' chips, the wallet's Bot column, the
// slip and the Algorithm's By Confidence. (The wallet stores the shown name on a bet: tier.)
export type Confidence = 'lock' | 'high' | 'medium' | 'low';
export type Tier = 'lock' | 'love' | 'like' | 'pass';

// (best first)
export const TIERS: readonly { confidence: Confidence; tier: Tier; label: string }[] = [
  { confidence: 'lock', tier: 'lock', label: 'Lock' },
  { confidence: 'high', tier: 'love', label: 'Love' },
  { confidence: 'medium', tier: 'like', label: 'Like' },
  { confidence: 'low', tier: 'pass', label: 'Pass' },
];

// A confidence's tier (none for none)
export function tierOf(confidence: Confidence | null | undefined): Tier | null {
  return TIERS.find((t) => t.confidence === confidence)?.tier ?? null;
}

// A confidence's name as the site says it ("Love")
export function tierLabel(confidence: Confidence): string {
  return TIERS.find((t) => t.confidence === confidence)?.label ?? '';
}
