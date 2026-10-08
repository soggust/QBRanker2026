// Reads a tab's stats for one season's list: values as the settings show them (season totals, per game
// or a full season's pace), as text, their labels and names, and the list's averages and color scale.
// The table has one for its season; the player card makes one for any other season it shows.
import { PACE_GAMES, PER_GAME_LABELS, STAT_NAMES, SkillPlayer, SkillPosition, SkillStat, SkillWeights } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { extras } from '@ranker/engine/row-fields';
import { ValueContext } from '@ranker/engine/sport';
import { recentCount, statValue } from '@ranker/engine/unit-scoring';
import { CURRENT_SEASON } from '@ranker/engine/data';

// Minutes as minutes:seconds: 31.4 -> "31:24"
const mmss = (minutes: number): string => {
  if (!Number.isFinite(minutes)) return '-';
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
import type { RankerSettings } from '@ranker/engine/position.service';
import { TintScale, tintFrom, tintScale } from '@ranker/core/value-tint';
import { NUMBER, avg3, grade, gradeColor, innings } from '@ranker/core/format';

export interface ReaderSource {
  position: SkillPosition;
  settings: RankerSettings;
  // The season's rows (every tab's: some values are worked out from other tabs) and the list ranked
  rows: Record<SkillPosition, SkillPlayer[]>;
  list: SkillPlayer[];
  // The table's own season (values from other tabs are only for it)
  tableSeason: boolean;
  // Which season it is (Recent is the current season's only)
  season: number;
  // A stat the season didn't record
  empty: (key: string) => boolean;
  // Bumped when the values change underneath (the sport's values from other tabs)
  version?: number;
  // The tab's sliders, its switched-off stats at 0 (a combined total mixes its parts by them)
  weights?: SkillWeights;
}

// A Recent result's letter (W, T, L), and on hover how it was decided past regulation (the NHL's OT or SO:
// "L (SO)")
export const recentWord = (result: number, ot?: string | null): string => (result === 1 ? 'W' : result === 0.5 ? 'T' : 'L') + (ot ? ` (${ot})` : '');

export class StatReader {
  // Each column's average and spread over the list, computed once and reused by every cell and the
  // header hover (per cell, it made the table slow to update), until the list or the settings change
  private scales = new Map<string, TintScale | null>();
  // (each column's values in the list, for Show Ranks; cleared with the scales)
  private rankValues = new Map<string, number[]>();
  private scalesFor?: unknown[];

  constructor(private readonly source: ReaderSource) {}

  get position(): SkillPosition {
    return this.source.position;
  }

  get list(): SkillPlayer[] {
    return this.source.list;
  }

  get season(): number {
    return this.source.season;
  }

  // Recent form is the season being played's alone: a finished season's last few games say little, so
  // its Recent has no column, no slider and no part in the ranking
  recentOff(stat: SkillStat): boolean {
    return stat.format === 'recent' && this.source.season !== CURRENT_SEASON;
  }

  get rows(): Record<SkillPosition, SkillPlayer[]> {
    return this.source.rows;
  }

  empty(key: string): boolean {
    return this.source.empty(key);
  }

  // Whether anyone in the list has a value for a stat (a season from before it was kept has none: Time of
  // Possession)
  hasValues(stat: SkillStat): boolean {
    return this.source.list.some((p) => Number.isFinite(this.value(p, stat)));
  }

  private get basis() {
    return this.source.settings.statBasis;
  }

  // Counting stats show as rates (per game, or per game over a full season) rather than season totals
  private showsPerGame(stat: SkillStat): boolean {
    return this.basis !== 'season' && stat.kind === 'volume';
  }

  // A stat's value from the data, or worked out in the app (see statValue)
  raw(player: SkillPlayer, stat: SkillStat): number | null {
    const context: ValueContext = {
      position: this.position,
      settings: this.source.settings.sport,
      rows: this.source.rows,
      tableSeason: this.source.tableSeason,
      defaults: false,
      weights: this.source.weights,
    };
    return statValue(player, stat, context);
  }

  // The shown value: for volume stats, per game or at a full season's pace as the Stat Base setting says
  value(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.raw(player, stat);
    if (raw === null || !this.showsPerGame(stat) || !player.games) return raw;
    return (raw / player.games) * (this.basis === 'pace17' ? PACE_GAMES[this.position] : 1);
  }

  // Per game for volume stats, whatever the setting: what color-coding and the card's skills use, so
  // 100 yards in 1 game tints greener than 100 yards in 10
  rate(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.raw(player, stat);
    if (raw === null) return null;
    return stat.kind === 'volume' && !stat.infoOnly && player.games ? raw / player.games : raw;
  }

  // Another row shares this rank (a small "(t)" in the cell, "#7 (tied)" in hover and copy text)
  rankTied(player: SkillPlayer, stat: SkillStat): boolean {
    if (stat.format !== 'rank' || stat.noTies) return false;
    const rank = this.value(player, stat);
    if (rank === null) return false;
    return (this.rows[this.position] ?? []).some((other) => other !== player && this.value(other, stat) === rank);
  }

  // The last five results (newest first; 1 win, 0.5 tie, 0 loss), for a sport with a 'recent' stat
  lastFive(player: SkillPlayer): number[] {
    return (extras(player).lastFive ?? []).slice(0, recentCount(this.position));
  }

  // One Recent dot's hover: the result and whom it came against ("W @ Denver Broncos", "L vs Seattle
  // Seahawks": the data writes the @ or vs; the result alone when the data doesn't say)
  recentTitle(player: SkillPlayer, i: number): string {
    const word = recentWord(this.lastFive(player)[i], extras(player).lastFiveOt?.[i]);
    const vs = extras(player).lastFiveVs?.[i];
    return vs ? `${word} ${/^(@|vs) /.test(vs) ? vs : `vs ${vs}`}` : word;
  }

  format(player: SkillPlayer, stat: SkillStat): string {
    const value = this.value(player, stat);
    if (value === null) return '-';
    // Per game reads to a decimal; a full-season pace rounds to a whole season's worth
    const perGameVolume = this.basis === 'perGame' && stat.kind === 'volume';
    const paceVolume = this.basis === 'pace17' && stat.kind === 'volume';
    switch (stat.format) {
      case 'grade':
        return grade(value);
      case 'rank':
        // (rank 0, above #1: the champion)
        if (value === 0) return 'Champion';
        return this.rankTied(player, stat) ? `#${value} (tied)` : `#${value}`;
      case 'record': {
        const { wins, losses, ties } = player.stats as Record<string, number | null>;
        return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      }
      case 'avg3':
        return avg3(value);
      case 'ip':
        return perGameVolume ? value.toFixed(1) : innings(paceVolume ? Math.round(value) : value);
      // + 0 turns -0 into 0 so tiny negatives don't show as "-0.0"
      case 'pctPoints':
        return `${(Number(value.toFixed(1)) + 0).toFixed(1)}%`;
      case 'pct':
        return `${Math.round(value * 100)}%`;
      case 'dec1':
        return (Number(value.toFixed(perGameVolume ? 2 : 1)) + 0).toFixed(perGameVolume ? 2 : 1);
      case 'dec2':
        return (Number(value.toFixed(2)) + 0).toFixed(2);
      case 'mmss':
        return mmss(value);
      default:
        if (perGameVolume) return value.toFixed(SPORT.perGameDecimals);
        return NUMBER.format(paceVolume ? Math.round(value) : value);
    }
  }

  // The column's label, switched to its per-game name (or tagged with the pace, "162G") when it shows rates
  label(stat: SkillStat): string {
    const label = SPORT.statLabel?.(stat, this.source.settings.sport, this.position) ?? stat.label;
    if (!this.showsPerGame(stat)) return label;
    return this.basis === 'pace17' ? `${label} (${PACE_GAMES[this.position]}G)` : (PER_GAME_LABELS[stat.key] ?? `${label} / Game`);
  }

  // The stat written out in full
  name(stat: SkillStat): string {
    const name = SPORT.statName?.(stat, this.position, this.source.settings.sport) ?? stat.name ?? STAT_NAMES[stat.key] ?? stat.label;
    if (!this.showsPerGame(stat)) return name;
    return this.basis === 'pace17' ? `${name} (${PACE_GAMES[this.position]}-game pace)` : `${name} per Game`;
  }

  // The list average of what a column shows, formatted like its values (none for records, recent
  // results and ranks)
  averageText(stat: SkillStat): string | null {
    if (stat.format === 'record' || stat.format === 'recent' || stat.format === 'rank') return null;
    const avg = this.scale(stat, 'shown')?.mean ?? null;
    if (avg === null) return null;
    switch (stat.format) {
      case 'grade':
        return grade(avg);
      case 'avg3':
        return avg3(avg);
      case 'ip':
        return innings(avg);
      case 'pct':
        return `${Math.round(avg * 100)}%`;
      case 'pctPoints':
        return `${avg.toFixed(1)}%`;
      case 'dec2':
        return avg.toFixed(2);
      case 'mmss':
        return mmss(avg);
      default:
        // (a full-season pace reads in whole numbers, like its column)
        return this.basis === 'pace17' && stat.kind === 'volume' ? NUMBER.format(Math.round(avg)) : avg.toFixed(1);
    }
  }

  // Color-Coded Values: green above the list's average, red below (records tint by win percentage;
  // grades and recent results keep their own coloring; display-only columns stay plain)
  valueColor(player: SkillPlayer, stat: SkillStat): string | null {
    if (!this.source.settings.colorValues || stat.infoOnly || ['grade', 'recent'].includes(stat.format)) return null;
    return tintFrom(this.rate(player, stat), this.scale(stat, 'rate'), !!stat.negative);
  }

  // Show Ranks: a column shown as places in the list (not the Recent dots, a column that's a rank
  // already, or a display-only one)
  showsRank(stat: SkillStat): boolean {
    return !!this.source.settings.showRanks && !stat.infoOnly && !['recent', 'rank'].includes(stat.format);
  }

  // A value's place in the list on what the column shows (its per-game or pace value; lower first for a
  // lower-is-better stat), tied values sharing a place; null with no value
  listRank(player: SkillPlayer, stat: SkillStat): { rank: number; tied: boolean } | null {
    const mine = this.rate(player, stat);
    if (mine === null) return null;
    this.scale(stat, 'rate');
    const key = `rank.${stat.key}`;
    let values = this.rankValues.get(key);
    if (!values) {
      values = this.source.list.map((p) => this.rate(p, stat)).filter((v): v is number => v !== null);
      this.rankValues.set(key, values);
    }
    const better = values.filter((v) => (stat.negative ? v < mine : v > mine)).length;
    return { rank: better + 1, tied: values.filter((v) => v === mine).length > 1 };
  }

  // A grid cell's text: the value, or with Show Ranks its place ("#3"). No tie mark: in the grade boxes it
  // doesn't fit (a rank's "(tied)" stays in its hover)
  cellText(player: SkillPlayer, stat: SkillStat): string {
    if (!this.showsRank(stat)) return this.format(player, stat).replace(/ \(tied\)$/, '');
    const r = this.listRank(player, stat);
    return r ? `#${r.rank}` : '-';
  }

  // A grade's own color (null for anything else)
  gradeColor(player: SkillPlayer, stat: SkillStat): string | null {
    return stat.format === 'grade' ? gradeColor(this.value(player, stat) ?? 6) : null;
  }

  private scale(stat: SkillStat, basis: 'rate' | 'shown'): TintScale | null {
    const inputs = [this.source.list, this.source.version, this.source.settings];
    if (!this.scalesFor || inputs.some((v, i) => v !== this.scalesFor![i])) {
      this.scales.clear();
      this.rankValues.clear();
      this.scalesFor = inputs;
    }
    const key = `${basis}.${stat.key}`;
    if (!this.scales.has(key)) {
      const value = (p: SkillPlayer) => (basis === 'shown' ? this.value(p, stat) : this.rate(p, stat));
      this.scales.set(key, tintScale(this.source.list.map(value)));
    }
    return this.scales.get(key)!;
  }
}
