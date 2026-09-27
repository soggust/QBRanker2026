import skillData from 'StaticData/skill-players.json';
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, SkillWeights } from 'app/positions';

export const SKILL_UNITS = skillData as Record<SkillPosition, SkillPlayer[]>;

// Weighted total for each unit. Stats are scaled against the max, or into 0.5-1 of the league
// range when signed; negative stats subtract; support grades (0-12) subtract at a fifth strength,
// matching the QB support bias. A missing value (null) scores as the league's worst.
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

    const values = units.map((unit) => value(unit, stat));
    const known = values.filter((v): v is number => v !== null);
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

// Team coaching grades from the Head Coaches rankings with the given slider weights
export function coachingGrades(weights: SkillWeights): Map<string, number> {
  const units = SKILL_UNITS.HC;
  const totals = weightedTotals(units, SKILL_STATS.HC, weights, (unit, stat) => unit.stats[stat.key]);
  return gradesByRank([...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)));
}

// Team defense grades from the Defenses rankings with the given slider weights
export function defenseGrades(weights: SkillWeights): Map<string, number> {
  const units = SKILL_UNITS.DEF;
  const totals = weightedTotals(units, SKILL_STATS.DEF, weights, (unit, stat) =>
    stat.key === 'fantasy' ? unit.stats.fantasyStd : unit.stats[stat.key],
  );
  return gradesByRank([...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)));
}
