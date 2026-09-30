import { AppData, DATA, dataVersion } from 'StaticData/data';
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, SkillStatKey, SkillWeights, unitStat } from 'app/positions';

// Every tab's rows for the loaded season, from skill-players.json. Refilled in place when the year
// selector loads another season, so everything holding SKILL_UNITS sees the new rows.
export const SKILL_UNITS = {} as Record<SkillPosition, SkillPlayer[]>;

export function rebuildUnits(): void {
  Object.assign(SKILL_UNITS, DATA.skillPlayers as Record<string, SkillPlayer[]>);
}
rebuildUnits();

// Another season's rows, from its files, without touching the loaded season
export function unitsForSeason(data: AppData): Record<SkillPosition, SkillPlayer[]> {
  return data.skillPlayers as Record<SkillPosition, SkillPlayer[]>;
}

// A stat nobody on a tab has a value for in the loaded season (Statcast stats before 2015): its
// column and slider are hidden, and it never counts. Stats worked out in the app (Games) aren't in
// the data, so they show.
const emptyStats = new Map<string, boolean>();

export function statIsEmpty(position: SkillPosition, key: string): boolean {
  const cacheKey = `${dataVersion}.${position}.${key}`;
  let empty = emptyStats.get(cacheKey);
  if (empty === undefined) {
    const units = SKILL_UNITS[position];
    empty = units.some((unit) => key in unit.stats) && units.every((unit) => unit.stats[key as SkillStatKey] == null);
    emptyStats.set(cacheKey, empty);
  }
  return empty;
}

// Standard scores are capped here, so one extreme value (e.g. 100% on two chances) can't swamp a list
const MAX_Z = 2.5;

// Weighted total for each unit. Every stat is put on the same scale first: its standard score (how
// many standard deviations above or below the list's average), capped at +/-2.5 and flipped for
// lower-is-better stats, so at the same slider every stat moves the ranking by the same amount and
// the sliders alone decide what matters. The slider multiplies it (50 = 1x, 100 = 2x). A missing
// value (null) scores as the list's worst, or as average for stats flagged missingIsAverage. Small samples aren't adjusted for: a stat
// alone sorts the list exactly by its values (the Min Games setting leaves out players with too few).
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

    const raw = units.map((unit) => value(unit, stat));
    const known = raw.filter((v): v is number => v !== null);
    if (known.length < 2) continue;
    const mean = known.reduce((a, b) => a + b, 0) / known.length;
    const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / known.length);
    if (!sd) continue;

    // Standard score, pointed so higher is always better for the unit
    const better = stat.support ? (stat.supportHelps ? 1 : -1) : stat.negative ? -1 : 1;
    const score = (v: number) => better * Math.max(-MAX_Z, Math.min(MAX_Z, (v - mean) / sd));
    const worst = Math.min(...known.map(score));
    const strength = (weight / 50) * (stat.support ? 0.2 : 1);

    units.forEach((unit, i) => {
      const v = raw[i];
      const scored = v !== null ? score(v) : stat.missingIsAverage || stat.support ? 0 : worst;
      totals.set(unit, (totals.get(unit) ?? 0) + scored * strength);
    });
  }
  return totals;
}

// A tab's default ranking (its default sliders), best first. The loaded season's rows unless given
// another season's.
export function defaultRanking(
  position: SkillPosition,
  weights: SkillWeights,
  units: SkillPlayer[] = SKILL_UNITS[position],
): SkillPlayer[] {
  const totals = weightedTotals(units, SKILL_STATS[position], weights, (unit, stat) =>
    stat.key === 'games' ? unit.games : unitStat(unit, stat.key as SkillStatKey),
  );
  return [...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}
