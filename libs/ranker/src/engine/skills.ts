// The player card's Overview: related stats rolled up into skills (each a 0-1 percentile in the list,
// the weighted average of its stats' percentiles), an archetype picked from the skill profile, and the
// words for how good a skill is. Counting stats count per game, so missed games don't sink a skill. Each
// sport defines its skills and archetypes (apps/<sport>/src/sport/skills.ts) with these shapes.

import { DATA } from '@ranker/engine/data';
import type { SkillPlayer } from '@sport/positions';

// A stat in a skill: +1 when more is better for the skill, -1 when less is, and how much it counts in
// the skill's average (1 when left out: 0.5 counts half as much as each of the others)
export type SkillPart = [key: string, dir: 1 | -1, weight?: number];

// A rate stat's qualifying volume (a sport's SKILL_MINIMUMS, by tab then stat key): a player counts on
// the stat in a skill only with enough of what it's a rate of, so a 2-for-4 shooter neither ranks high
// on it nor moves anyone else's percentile. Below it, the part is skipped for him (his skill comes from
// its other parts) and he's left out of its pool. perGame: at least that many for each game he played
// (3-point attempts for 3P %: scales with the season); atLeast: that many all told (an MMA fighter's
// fights with box stats); both: the larger. attempts: his count (null when the row can't say: he counts
// as usual); noun: what's counted, for the hover ("attempts", "fights with stats").
export interface SkillMinimum {
  perGame?: number;
  atLeast?: number;
  noun: string;
  attempts: (player: SkillPlayer) => number | null | undefined;
}
export type SkillMinimums = Record<string, SkillMinimum>;

// Whether a player has the volume a part asks for (always with no minimum, or no count to go on)
export function qualifies(minimum: SkillMinimum | undefined, player: SkillPlayer): boolean {
  if (!minimum) return true;
  const attempts = minimum.attempts(player);
  if (attempts == null || !Number.isFinite(attempts)) return true;
  const need = Math.max((minimum.perGame ?? 0) * (player.games || 0), minimum.atLeast ?? 0);
  // (half an attempt's grace: a count worked out from rounded rates can land a hair short)
  return attempts >= need - 0.5;
}

// A stat only skills read (a sport's SKILL_DERIVED, by key), worked out from the row: saves and holds
// together, fumbles per touch, a season's total of a stat its column shows per game. kind 'volume' reads
// per game, as a counting column does; 'efficiency' as it is. A part names it like any stat (a column of
// the tab's with the same key is read instead).
export interface SkillDerived {
  key: string;
  label: string;
  kind: 'volume' | 'efficiency';
  value: (player: SkillPlayer) => number | null | undefined;
}
export type SkillDerivedStats = Record<string, SkillDerived>;

// A derived stat's value for a skill (per game for a 'volume' one; null when the row can't say)
export function derivedRate(stat: SkillDerived, player: SkillPlayer): number | null {
  const v = stat.value(player);
  if (v == null || !Number.isFinite(v)) return null;
  return stat.kind === 'volume' ? (player.games ? v / player.games : null) : v;
}

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
  // What it's made of, for its hovers (hover-text.ts skillDefinition)
  about?: string;
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
