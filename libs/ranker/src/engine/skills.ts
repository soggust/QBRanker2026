// The player card's Overview: related stats rolled up into skills (each a 0-1 percentile in the list,
// the average of its stats' percentiles), an archetype picked from the skill profile, and the words
// for how good a skill is. Counting stats count per game, so missed games don't sink a skill. Each
// sport defines its skills and archetypes (apps/<sport>/src/sport/skills.ts) with these shapes.

import { DATA } from '@ranker/engine/data';
import type { SkillPlayer } from '@sport/positions';

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
// percentile, 0.5 when a skill has no data; overall: the list rank as a percentile; player: the row,
// for a test that looks past the list: leagueRank)
export interface Archetype {
  name: string;
  test: (s: Record<string, number>, overall: number, player: SkillPlayer) => boolean;
}

// A player's rank across the whole league, 1 the best, on a value from his row, among the rows of the
// tabs given (each player once): for the top labels (an MVP candidate, an ace), which a percentile in
// one position's list would hand out a few per position, too many across the league. Rows without the
// value rank last.
const leagueValues = new WeakMap<object, Map<string, Map<string, number>>>();
export function leagueRank(player: SkillPlayer, tabs: string[], value: (row: SkillPlayer) => number | null | undefined, key: string): number {
  const all = DATA.skillPlayers as Record<string, SkillPlayer[]> | undefined;
  if (!all) return Infinity;
  const byKey = leagueValues.get(all) ?? leagueValues.set(all, new Map()).get(all)!;
  const cacheKey = `${key}/${tabs.join(',')}`;
  let values = byKey.get(cacheKey);
  if (!values) {
    values = new Map();
    for (const tab of tabs) {
      for (const row of all[tab] ?? []) {
        const v = value(row);
        if (v != null && Number.isFinite(v) && v > (values.get(row.gsisId) ?? -Infinity)) values.set(row.gsisId, v);
      }
    }
    byKey.set(cacheKey, values);
  }
  const mine = values.get(player.gsisId);
  if (mine === undefined) return Infinity;
  let above = 0;
  for (const v of values.values()) if (v > mine) above++;
  return above + 1;
}

// A skill on the card: a percentile in the list, in words, with the stats behind it and where they rank
export interface CardSkill {
  id: string;
  name: string;
  short: string;
  pct: number;
  tier: string;
  standing: string;
  evidence: { label: string; rank: number; of: number }[];
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
