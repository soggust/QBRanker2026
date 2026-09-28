import { DATA } from 'StaticData/data';
import {
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

export const SKILL_UNITS = DATA.skillPlayers as Record<SkillPosition, SkillPlayer[]>;

// Weighted total for each unit. Stats are scaled against the max, or into 0.5-1 of the league
// range when signed; negative stats subtract; support grades (0-12) subtract at a fifth strength,
// matching the QB support bias. A missing value (null) scores as the league's worst (or the
// league average for stats flagged missingIsAverage).
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
        score = -((v ?? 6) / 12) * (weight / 250);
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
export function defaultRanking(position: SkillPosition, weights: SkillWeights, garbageTime = true): SkillPlayer[] {
  const units = SKILL_UNITS[position];
  const effective = { ...weights };
  for (const { stat, parts } of combinedFor(position)) {
    const parent = weights[stat.key] ?? 50;
    for (const part of parts) effective[part] = ((effective[part] ?? 0) * parent) / 50;
  }
  const totals = weightedTotals(units, SKILL_STATS[position], effective, (unit, stat) => {
    switch (stat.key) {
      case 'fantasy':
        return fantasyPoints(unit.stats.fantasyStd ?? 0, unit.stats.receptions ?? 0, 'ppr');
      case 'totalYards':
        return (unit.stats.rushYards ?? 0) + (unit.stats.recYards ?? 0);
      default:
        return stat.support ? null : unitStat(unit, stat.key as SkillStatKey, garbageTime);
    }
  });
  return [...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}
