import { AppData, DATA, dataVersion, withSeason } from '@ranker/engine/data';
import type { SportSettings, ValueContext } from '@ranker/engine/sport';
import { extras } from '@ranker/engine/row-fields';
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, SkillStatKey, SkillWeights, unitStat } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { rosterGradeValue } from '@ranker/engine/roster-grades';

// Every tab's rows for the loaded season, from skill-players.json (and the tabs the sport builds from
// its other files, SPORT.extraRows). Refilled in place when the year selector loads another season, so
// everything holding SKILL_UNITS sees the new rows.
export const SKILL_UNITS = {} as Record<SkillPosition, SkillPlayer[]>;

export function rebuildUnits(): void {
  const rows = { ...(DATA.skillPlayers as Record<string, SkillPlayer[]>), ...SPORT.extraRows?.() };
  // (a tab the new season doesn't have is emptied, not left with the last season's rows)
  for (const tab of Object.keys(SKILL_UNITS)) if (!(tab in rows)) delete SKILL_UNITS[tab as SkillPosition];
  Object.assign(SKILL_UNITS, rows);
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

// How many games a tab's Recent column covers (SPORT.recentGames; 5 if the sport doesn't say)
export function recentCount(position: string): number {
  return SPORT.recentGames?.(position) ?? 5;
}

// Recent form from the latest results (newest first, 1 win / 0.5 tie / 0 loss; up to count of them):
// each older game counts a little less, the oldest 0.6 of the newest, scaled so winning them all scores
// the weights' total; no games yet scores 0
export function recencyScore(lastFive: number[] = [], count = 5): number {
  const weights = Array.from({ length: count }, (_, i) => (count > 1 ? 1 - (0.4 * i) / (count - 1) : 1));
  const played = lastFive.slice(0, count);
  if (!played.length) return 0;
  const earned = played.reduce((sum, result, i) => sum + result * weights[i], 0);
  const possible = played.reduce((sum, _, i) => sum + weights[i], 0);
  return (earned / possible) * weights.reduce((a, b) => a + b, 0);
}

// The combined pairs (SPORT.combined) a tab has
export function combinedFor(position: string) {
  return SPORT.combined?.stats(position) ?? [];
}

// Slider weights with each combined pair's parts scaled by their parent slider (50 = as set, 0 = off).
// Combined (the Combine setting: the pair one column), the pair counts as its total instead, at the
// parent's weight times its parts' (what the two counted for apart), the total read as the parts mixed
// by their sliders (combinedMix)
export function combinedWeights(position: string, weights: SkillWeights, combined = false): SkillWeights {
  const effective = { ...weights };
  for (const { stat, parts } of combinedFor(position)) {
    const parent = weights[stat.key] ?? 50;
    const sum = parts.reduce((total, part) => total + (weights[part as keyof SkillWeights] ?? 0), 0);
    for (const part of parts) effective[part as keyof SkillWeights] = ((effective[part as keyof SkillWeights] ?? 0) * parent) / 50;
    if (combined) effective[stat.key as keyof SkillWeights] = (sum * parent) / 50;
  }
  return effective;
}

// A combined total's parts mixed by their sliders: each part counts as its slider's share of the larger
// one's, so even sliders add the two up (rushing + receiving yards) and a part at 0% drops out (Total
// Yds with rushing at 0% is passing yards). Without sliders (or both at 0%), the plain sum.
function combinedMix(values: (number | null)[], parts: string[], weights?: SkillWeights): number {
  const shares = parts.map((part) => weights?.[part as keyof SkillWeights] ?? 0);
  const top = Math.max(...shares);
  return values.reduce<number>((sum, v, i) => sum + (v ?? 0) * (top > 0 ? shares[i] / top : 1), 0);
}

// A stat's value for a row: from the data, or worked out in the app (Games, recent form, a combined
// pair's total, or the sport's own: SPORT.computedValue)
export function statValue(unit: SkillPlayer, stat: SkillStat, context: ValueContext): number | null {
  if (stat.key === 'games') return unit.games;
  if (stat.format === 'recent') return recencyScore(extras(unit).lastFive, recentCount(context.position));
  const pair = combinedFor(context.position).find(({ stat: total }) => total.key === stat.key);
  if (pair) {
    const values = pair.parts.map((part) => unitStat(unit, part as SkillStatKey, context.settings));
    return values.every((v) => v === null) ? null : combinedMix(values, pair.parts, context.weights);
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
// flagged missingIsAverage and for support grades; a stat flagged skipMissing takes, for that unit, his
// average over the skipMissing stats he does have (MMA: a fighter's striking stats that weren't kept
// read as he did in the ones that were), or the list's average if he has none. Small samples aren't adjusted for unless the sport
// says how much evidence a row's rates rest on (SPORT.reliability, 0-1: MMA's fights): then each
// rate's score is scaled by it, so a few fights' perfect numbers count less than a long career's.
export function weightedTotals<T>(
  units: T[],
  stats: SkillStat[],
  weights: SkillWeights,
  value: (unit: T, stat: SkillStat) => number | null,
  reliability: ((unit: T, stat: SkillStat) => number) | null = (SPORT.reliability as ((unit: T, stat: SkillStat) => number) | undefined) ?? null,
  settings: SportSettings = DEFAULT_SPORT_SETTINGS,
  // (the units each stat's average and spread come from, when not all of them: a list's filters then
  // only leave units out, never move the ones left; see TabRanker.ranked)
  pool?: T[],
): Map<T, number> {
  const totals = new Map<T, number>(units.map((unit) => [unit, 0]));
  const index = new Map(units.map((unit, i) => [unit, i]));
  // (each unit's skipMissing stats: the strength he's missing, and the score and strength he has)
  const skipped = new Map<T, { missed: number; sum: number; strength: number }>();
  const skipOf = (unit: T) => skipped.get(unit) ?? skipped.set(unit, { missed: 0, sum: 0, strength: 0 }).get(unit)!;
  for (const stat of stats) {
    const weight = weights[stat.key] ?? 0;
    if (!weight || stat.infoOnly || stat.shownWhen?.(settings) === false) continue;

    const rawOf = (unit: T) => {
      const shown = value(unit, stat);
      const scored = SPORT.scoreValue?.(unit as SkillPlayer, stat, shown, settings);
      return scored === undefined ? shown : scored;
    };
    const raw = units.map(rawOf);
    const isNumber = (v: number | null): v is number => v !== null;
    const pooled = pool?.map((unit) => (index.has(unit) ? raw[index.get(unit)!] : rawOf(unit))).filter(isNumber);
    const known = pooled && pooled.length >= 2 ? pooled : raw.filter(isNumber);
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

    units.forEach((unit, i) => {
      const v = raw[i];
      if (v === null && stat.skipMissing) {
        skipOf(unit).missed += strength;
        return;
      }
      const scored = v !== null ? score(v) : stat.missingIsAverage || stat.support ? 0 : worst;
      // (a rate that isn't his own sample's, like the UFC's rank, isn't scaled: stat.settled)
      const trust = reliability && stat.kind === 'efficiency' && !stat.settled ? reliability(unit, stat) : 1;
      totals.set(unit, (totals.get(unit) ?? 0) + scored * strength * trust);
      if (stat.skipMissing) {
        skipOf(unit).sum += scored * strength * trust;
        skipOf(unit).strength += strength;
      }
    });
  }
  // (the skipMissing stats a unit is missing: his average over the ones he has)
  for (const [unit, { missed, sum, strength }] of skipped) {
    if (missed && strength) totals.set(unit, (totals.get(unit) ?? 0) + (sum / strength) * missed);
  }
  return totals;
}

// Best first by their weighted totals, then the sport's head-to-head rule
export function byTotals<T>(units: T[], totals: Map<T, number>, settings: SportSettings = DEFAULT_SPORT_SETTINGS): T[] {
  // (head to head only between close scores, when the sport says how close: SPORT.beatGap)
  const gap = SPORT.beatGap?.(settings);
  let close: ((a: T, b: T) => boolean) | undefined;
  if (gap !== undefined && units.length > 1) {
    const values = units.map((unit) => totals.get(unit) ?? 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
    close = (a, b) => Math.abs((totals.get(a) ?? 0) - (totals.get(b) ?? 0)) <= gap * sd;
  }
  return headToHead([...units].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)), settings, close);
}

// The sport's head-to-head rule (SPORT.beat) over a sorted list: a row below one it beat, within the
// sport's reach (SPORT.beatReach; 1: right below), moves to just above it, down the list again until
// nothing moves (bounded, so a cycle of wins can't loop)
export function headToHead<T>(sorted: T[], settings: SportSettings = DEFAULT_SPORT_SETTINGS, close?: (a: T, b: T) => boolean): T[] {
  const beat = SPORT.beat as ((a: T, b: T, settings: SportSettings) => boolean) | undefined;
  if (!beat) return sorted;
  const reach = Math.max(1, SPORT.beatReach?.(settings) ?? 1);
  const list = [...sorted];
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < list.length; i++) {
      // (the nearest row below, within reach, that beat this one moves just above it)
      for (let j = i + 1; j <= Math.min(i + reach, list.length - 1); j++) {
        if (beat(list[j], list[i], settings) && (!close || close(list[j], list[i]))) {
          const [winner] = list.splice(j, 1);
          list.splice(i, 0, winner);
          moved = true;
          i++;
          break;
        }
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
  return byTotals(units, totals, settings);
}
