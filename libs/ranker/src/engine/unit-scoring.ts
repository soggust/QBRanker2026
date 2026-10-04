import { AppData, DATA, dataVersion, withSeason } from '@ranker/engine/data';
import type { SportSettings, ValueContext } from '@ranker/engine/sport';
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, SkillStatKey, SkillWeights, unitStat } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { rosterGradeValue } from '@ranker/engine/roster-grades';

// Every tab's rows for the loaded season, from skill-players.json (and the tabs the sport builds from
// its other files, SPORT.extraRows). Refilled in place when the year selector loads another season, so
// everything holding SKILL_UNITS sees the new rows.
export const SKILL_UNITS = {} as Record<SkillPosition, SkillPlayer[]>;

export function rebuildUnits(): void {
  Object.assign(SKILL_UNITS, DATA.skillPlayers as Record<string, SkillPlayer[]>, SPORT.extraRows?.());
}
rebuildUnits();

// Another season's rows, from its files, without touching the loaded season (DATA and dataSeason are
// swapped just while the sport builds its own tabs, then put back)
export function unitsForSeason(data: AppData, season: number): Record<SkillPosition, SkillPlayer[]> {
  const rows = data.skillPlayers as Record<SkillPosition, SkillPlayer[]>;
  if (!SPORT.extraRows) return rows;
  return withSeason(season, data, () => ({ ...rows, ...SPORT.extraRows!() }));
}

// The sport's settings at their defaults
export const DEFAULT_SPORT_SETTINGS: SportSettings = Object.fromEntries((SPORT.settings ?? []).map((s) => [s.key, s.default]));

// A stat nobody on a tab has a value for in the loaded season (Statcast stats before 2015, drops before
// 2018): its column and slider are hidden, and it never counts. Stats worked out in the app (Games,
// grades from other tabs, fantasy points) aren't in the data, so they show.
const emptyStats = new Map<string, boolean>();

export function statIsEmpty(position: SkillPosition, key: string): boolean {
  const cacheKey = `${dataVersion}.${position}.${key}`;
  let empty = emptyStats.get(cacheKey);
  if (empty === undefined) {
    empty = emptyIn(SKILL_UNITS[position], key);
    emptyStats.set(cacheKey, empty);
  }
  return empty;
}

// ...in any season's rows: the rows have the stat, but nobody has a value for it
export function emptyIn(units: SkillPlayer[], key: string): boolean {
  return units.some((unit) => key in unit.stats) && units.every((unit) => unit.stats[key as SkillStatKey] == null);
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

// The combined pairs (SPORT.combined) a tab has
export function combinedFor(position: string) {
  return SPORT.combined?.stats(position) ?? [];
}

// Slider weights with each combined pair's parts scaled by their parent slider (50 = as set, 0 = off)
export function combinedWeights(position: string, weights: SkillWeights): SkillWeights {
  const effective = { ...weights };
  for (const { stat, parts } of combinedFor(position)) {
    const parent = weights[stat.key] ?? 50;
    for (const part of parts) effective[part as keyof SkillWeights] = ((effective[part as keyof SkillWeights] ?? 0) * parent) / 50;
  }
  return effective;
}

// A stat's value for a row: from the data, or worked out in the app (Games, recent form, a combined
// pair's total, or the sport's own: SPORT.computedValue)
export function statValue(unit: SkillPlayer, stat: SkillStat, context: ValueContext): number | null {
  if (stat.key === 'games') return unit.games;
  if (stat.format === 'recent') return recencyScore((unit as { lastFive?: number[] }).lastFive);
  const pair = combinedFor(context.position).find(({ stat: total }) => total.key === stat.key);
  if (pair) {
    const values = pair.parts.map((part) => unitStat(unit, part as SkillStatKey, context.settings));
    return values.every((v) => v === null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  }
  const roster = rosterGradeValue(unit, stat.key, context);
  if (roster !== undefined) return roster;
  const computed = SPORT.computedValue?.(unit, stat, context);
  if (computed !== undefined) return computed;
  return unitStat(unit, stat.key as SkillStatKey, context.settings);
}

// Standard scores are capped here, so one extreme value (e.g. 100% on two chances) can't swamp a list
const MAX_Z = 2.5;

// Weighted total for each unit. Every stat is put on the same scale first: its standard score (how
// many standard deviations above or below the list's average), capped at +/-2.5 and flipped for
// lower-is-better stats, so at the same slider every stat moves the ranking by the same amount and
// the sliders alone decide what matters. The slider multiplies it (50 = 1x, 100 = 2x). Support
// grades count at a fifth of that strength, against the player (credit for doing more with less) or
// for them (supportHelps). A missing value (null) scores as the list's worst, or as average for stats
// flagged missingIsAverage and for support grades; a stat flagged skipMissing is left out of that unit's
// total instead, the rest of it scaled up to make up its share. Small samples aren't adjusted for unless the sport
// says how much evidence a row's rates rest on (SPORT.reliability, 0-1: MMA's fights): then each
// rate's score is scaled by it, so a few fights' perfect numbers count less than a long career's.
export function weightedTotals<T>(
  units: T[],
  stats: SkillStat[],
  weights: SkillWeights,
  value: (unit: T, stat: SkillStat) => number | null,
  reliability: ((unit: T) => number) | null = (SPORT.reliability as ((unit: T) => number) | undefined) ?? null,
  settings: SportSettings = DEFAULT_SPORT_SETTINGS,
): Map<T, number> {
  const totals = new Map<T, number>(units.map((unit) => [unit, 0]));
  // (the strength every unit's total is out of, and what each unit skipped of it)
  let full = 0;
  const skipped = new Map<T, number>();
  for (const stat of stats) {
    const weight = weights[stat.key] ?? 0;
    if (!weight || stat.infoOnly) continue;

    const raw = units.map((unit) => {
      const shown = value(unit, stat);
      const scored = SPORT.scoreValue?.(unit as SkillPlayer, stat, shown, settings);
      return scored === undefined ? shown : scored;
    });
    const known = raw.filter((v): v is number => v !== null);
    if (known.length < 2) continue;
    const mean = known.reduce((a, b) => a + b, 0) / known.length;
    const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / known.length);
    if (!sd) continue;

    // Standard score, pointed so higher is always better for the unit. A stat on a fixed scale (the
    // UFC's rank: the champion to unranked) is laid evenly across the whole range instead, best to
    // worst, so a list's many unranked fighters don't squeeze its top ranks together at the cap.
    const better = stat.support ? (stat.supportHelps ? 1 : -1) : stat.negative ? -1 : 1;
    const scale = stat.scale;
    const clamp = (z: number) => Math.max(-MAX_Z, Math.min(MAX_Z, z));
    const score = scale
      ? (v: number) => clamp(MAX_Z * (1 - (2 * (v - scale[0])) / (scale[1] - scale[0])))
      : (v: number) => better * clamp((v - mean) / sd);
    const worst = Math.min(...known.map(score));
    // (a sport can boost a stat behind its slider: the same 0-100% range, more effect at every step;
    // the boost can depend on the sport's settings)
    const boost = typeof stat.boost === 'function' ? stat.boost(settings) : (stat.boost ?? 1);
    const strength = (weight / 50) * boost * (stat.support ? 0.2 : 1);
    full += strength;

    units.forEach((unit, i) => {
      const v = raw[i];
      if (v === null && stat.skipMissing) {
        skipped.set(unit, (skipped.get(unit) ?? 0) + strength);
        return;
      }
      const scored = v !== null ? score(v) : stat.missingIsAverage || stat.support ? 0 : worst;
      // (a rate that isn't his own sample's, like the UFC's rank, isn't scaled: stat.settled)
      const trust = reliability && stat.kind === 'efficiency' && !stat.settled ? reliability(unit) : 1;
      totals.set(unit, (totals.get(unit) ?? 0) + scored * strength * trust);
    });
  }
  // (a unit that skipped stats: what it has counts for the whole)
  for (const [unit, missed] of skipped) {
    if (full > missed) totals.set(unit, (totals.get(unit) ?? 0) * (full / (full - missed)));
  }
  return totals;
}

// Best first by their weighted totals, then the sport's head-to-head rule
export function byTotals<T>(units: T[], totals: Map<T, number>): T[] {
  return headToHead([...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)));
}

// The sport's head-to-head rule (SPORT.beat) over a sorted list: a row right below one it beat in their
// latest meeting moves above it, down the list again until nothing moves (bounded, so a cycle of wins
// can't loop)
export function headToHead<T>(sorted: T[]): T[] {
  const beat = SPORT.beat as ((a: T, b: T) => boolean) | undefined;
  if (!beat) return sorted;
  const list = [...sorted];
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < list.length; i++) {
      if (beat(list[i + 1], list[i])) {
        [list[i], list[i + 1]] = [list[i + 1], list[i]];
        moved = true;
        i++;
      }
    }
    if (!moved) break;
  }
  return list;
}

// A tab's default ranking (its sliders, before it's been opened), best first: combined pairs' parts
// scaled by their parent sliders, the sport's settings as given (their defaults if not), and grades
// from other tabs as average. The loaded season's rows unless given another season's.
export function defaultRanking(
  position: SkillPosition,
  weights: SkillWeights,
  rows: Record<string, SkillPlayer[]> = SKILL_UNITS,
  settings: SportSettings = DEFAULT_SPORT_SETTINGS,
): SkillPlayer[] {
  const units = rows[position] ?? [];
  const context: ValueContext = { position, settings, rows, tableSeason: false, defaults: true };
  const totals = weightedTotals(
    units,
    SKILL_STATS[position],
    combinedWeights(position, weights),
    (unit, stat) => statValue(unit, stat, context),
    undefined,
    settings,
  );
  return byTotals(units, totals);
}
