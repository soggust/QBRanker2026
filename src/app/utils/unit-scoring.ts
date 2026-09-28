import { DATA } from 'StaticData/data';
import { QB_UNITS } from 'StaticData/StaticData';
import {
  RANK_METRICS,
  RankBasis,
  SKILL_STATS,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillStatKey,
  SkillWeights,
  combinedFor,
  fantasyPoints,
  unitStat,
} from 'app/positions';

// Every tab's rows: the QBs are built from games.json, the rest come from skill-players.json
export const SKILL_UNITS = {
  ...(DATA.skillPlayers as Record<string, SkillPlayer[]>),
  QB: QB_UNITS,
} as Record<SkillPosition, SkillPlayer[]>;

// Recent form from up to five results (newest first, 1 win / 0.5 tie / 0 loss): each older game counts
// a little less, scaled to a 0-4 range (4 = won them all); no games yet scores 0
export function recencyScore(lastFive: number[] = []): number {
  const weights = [1, 0.9, 0.8, 0.7, 0.6];
  const played = lastFive.slice(0, 5);
  if (!played.length) return 0;
  const earned = played.reduce((sum, result, i) => sum + result * weights[i], 0);
  const possible = played.reduce((sum, _, i) => sum + weights[i], 0);
  return (earned / possible) * weights.reduce((a, b) => a + b, 0);
}

// League ranks (1 = best) for the head coaches' offense and defense, on the
// stat the Unit Ranks setting picks. Ties share a rank.
export type UnitRankKey = keyof typeof RANK_METRICS;

export function unitRanks(
  units: SkillPlayer[],
  basis: RankBasis,
  garbageTime: boolean,
): Map<SkillPlayer, Record<UnitRankKey, number | null>> {
  const ranks = new Map(units.map((unit) => [unit, { offRank: null, defRank: null } as Record<UnitRankKey, number | null>]));
  for (const key of Object.keys(RANK_METRICS) as UnitRankKey[]) {
    const [stat, higherIsBetter] = RANK_METRICS[key][basis];
    const values = units.map((unit) => unitStat(unit, stat, garbageTime));
    units.forEach((unit, i) => {
      const v = values[i];
      if (v === null || v === undefined) return;
      const better = values.filter((o) => o !== null && o !== undefined && (higherIsBetter ? o > v : o < v)).length;
      ranks.get(unit)![key] = better + 1;
    });
  }
  return ranks;
}

// Weighted total for each unit. Stats are scaled against the max, or into 0.5-1 of the league
// range when signed; negative stats subtract; support grades (0-12) subtract at a fifth strength
// (credit for doing more with less), or add for the one that helps (QB Responsibility). A missing
// value (null) scores as the league's worst (or the league average for stats flagged missingIsAverage).
export function weightedTotals<T>(
  units: T[],
  stats: SkillStat[],
  weights: SkillWeights,
  value: (unit: T, stat: SkillStat) => number | null,
): Map<T, number> {
  const totals = new Map<T, number>(units.map((unit) => [unit, 0]));
  for (const stat of stats) {
    const weight = weights[stat.key] ?? 0;
    if (!weight || stat.infoOnly) continue;

    const known = units.map((unit) => value(unit, stat)).filter((v): v is number => v !== null);
    const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
    // Stats where "-" just means no chances yet count missing values as the league average
    const values = units.map((unit) => value(unit, stat) ?? (stat.missingIsAverage ? average : null));
    const max = known.length ? Math.max(...known) : 0;
    const min = known.length ? Math.min(...known) : 0;
    units.forEach((unit, i) => {
      const v = values[i];
      let score: number;
      if (stat.support) {
        score = ((v ?? 6) / 12) * (weight / 250) * (stat.supportHelps ? 1 : -1);
      } else {
        const scaled =
          v === null
            ? stat.negative
              ? 1
              : stat.signed
                ? 0.5
                : 0
            : stat.signed
              ? max === min
                ? 1
                : 0.5 + (0.5 * (v - min)) / (max - min)
              : max
                ? v / max
                : 0;
        score = scaled * (weight / 50) * (stat.negative ? -1 : 1);
      }
      totals.set(unit, (totals.get(unit) ?? 0) + score);
    });
  }
  return totals;
}

// Team grades (0-12) from a ranked list: #1 grades 12 (A+), last grades 0 (F)
export function gradesByRank(ranked: { teamLogo: string }[]): Map<string, number> {
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map((unit, rank) => [unit.teamLogo, 12 * (1 - rank / last)]));
}

// Grades on a curve: highest score grades 12 (A+), lowest 0 (F), the rest spread evenly by rank.
// Used for every support grade, so each always runs the full F to A+ range.
export function curveGrades<K>(scores: Map<K, number>): Map<K, number> {
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map(([key], rank) => [key, 12 * (1 - rank / last)]));
}

// A tab's default ranking (its sliders, before it's been opened), best first. Rush / rec parts are
// scaled by their parent Total Yds / Total TDs sliders, fantasy is PPR, and support grades from
// other tabs count as average (C).
export function defaultRanking(
  position: SkillPosition,
  weights: SkillWeights,
  garbageTime = true,
  rankBasis: RankBasis = 'points',
): SkillPlayer[] {
  const units = SKILL_UNITS[position];
  const ranks = position === 'HC' ? unitRanks(units, rankBasis, garbageTime) : null;
  const effective = { ...weights };
  for (const { stat, parts } of combinedFor(position)) {
    const parent = weights[stat.key] ?? 50;
    for (const part of parts) effective[part] = ((effective[part] ?? 0) * parent) / 50;
  }
  const totals = weightedTotals(units, SKILL_STATS[position], effective, (unit, stat) => {
    switch (stat.key) {
      case 'fantasy':
        return fantasyPoints(unit.stats.fantasyStd ?? 0, unit.stats.receptions ?? 0, 'ppr');
      case 'recent':
        return recencyScore(unit.lastFive);
      case 'offRank':
      case 'defRank':
        return ranks?.get(unit)?.[stat.key] ?? null;
      default:
        // Support grades from other tabs count as average here; a QB's own Responsibility counts
        return stat.support && stat.key !== 'responsibility' ? null : unitStat(unit, stat.key as SkillStatKey, garbageTime);
    }
  });
  return [...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}
