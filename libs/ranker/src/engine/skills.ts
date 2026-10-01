// The player card's Overview: related stats rolled up into skills (each a 0-1 percentile in the list,
// the average of its stats' percentiles), an archetype picked from the skill profile, and the words
// for how good a skill is. Counting stats count per game, so missed games don't sink a skill. Each
// sport defines its skills and archetypes (apps/<sport>/src/sport/skills.ts) with these shapes.

// A stat in a skill: +1 when more is better for the skill, -1 when less is
export type SkillPart = [key: string, dir: 1 | -1];

export interface SkillDef {
  id: string;
  name: string;
  // Radar label
  short: string;
  parts: SkillPart[];
}

// Archetypes, most specific first: the first whose test passes names the card (s: skill id ->
// percentile, 0.5 when a skill has no data; overall: the list rank as a percentile)
export interface Archetype {
  name: string;
  test: (s: Record<string, number>, overall: number) => boolean;
}

// How good a skill is, in words
export function tierWord(pct: number): string {
  if (pct >= 0.9) return 'Elite';
  if (pct >= 0.75) return 'Strong';
  if (pct >= 0.6) return 'Above-average';
  if (pct > 0.4) return 'Average';
  if (pct > 0.25) return 'Below-average';
  if (pct > 0.1) return 'Poor';
  return 'Bottom-tier';
}

// "Top 8%" / "Bottom 15%" / "Middle of the pack"
export function standing(pct: number): string {
  if (pct >= 0.5) {
    const top = Math.max(1, Math.round((1 - pct) * 100));
    return top >= 45 ? 'Middle of the pack' : `Top ${top}%`;
  }
  return `Bottom ${Math.max(1, Math.round(pct * 100))}%`;
}
