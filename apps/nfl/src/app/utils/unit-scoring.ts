import { AppData, DATA, dataVersion } from 'StaticData/data';
import { buildQbUnits } from 'StaticData/StaticData';
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

// Every tab's rows for the loaded season: the QBs are built from games.json, the rest come from
// skill-players.json. Refilled in place when the year selector loads another season, so everything
// holding SKILL_UNITS sees the new rows.
export const SKILL_UNITS = {} as Record<SkillPosition, SkillPlayer[]>;

export function rebuildUnits(): void {
  Object.assign(SKILL_UNITS, DATA.skillPlayers as Record<string, SkillPlayer[]>, { QB: buildQbUnits() });
}
rebuildUnits();

// Another season's rows, built from its files without touching the loaded season (DATA is swapped
// just while the QBs are built, then put back)
export function unitsForSeason(data: AppData): Record<SkillPosition, SkillPlayer[]> {
  const loaded = { ...DATA };
  Object.assign(DATA, data);
  try {
    return { ...(data.skillPlayers as Record<SkillPosition, SkillPlayer[]>), QB: buildQbUnits() };
  } finally {
    Object.assign(DATA, loaded);
  }
}

// A stat nobody on a tab has a value for in the loaded season (tracking and charting stats before
// they were recorded, e.g. drops before 2018): its column and slider are hidden, and it never
// counts. Stats worked out in the app (grades, fantasy, Recent...) aren't in the data, so they show.
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

// Standard scores are capped here, so one extreme value (e.g. 100% on two chances) can't swamp a list
const MAX_Z = 2.5;

// Weighted total for each unit. Every stat is put on the same scale first: its standard score (how
// many standard deviations above or below the list's average), capped at +/-2.5 and flipped for
// lower-is-better stats, so at the same slider every stat moves the ranking by the same amount and
// the sliders alone decide what matters. The slider multiplies it (50 = 1x, 100 = 2x). Support
// grades count at a fifth of that strength, against the unit (credit for doing more with less) or
// for it (QB Responsibility). A missing value (null) scores as the list's worst, or as average for
// stats flagged missingIsAverage and for support grades. Small samples aren't adjusted for: a stat
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
// other tabs count as average (C). The loaded season's rows unless given another season's.
export function defaultRanking(
  position: SkillPosition,
  weights: SkillWeights,
  garbageTime = true,
  rankBasis: RankBasis = 'points',
  units: SkillPlayer[] = SKILL_UNITS[position],
): SkillPlayer[] {
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
