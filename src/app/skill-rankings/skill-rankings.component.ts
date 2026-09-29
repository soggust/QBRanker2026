import { Component, Input, OnChanges, ElementRef, ViewChild } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { skip } from 'rxjs';
import {
  FANTASY_SCORING_LABELS,
  RANK_BASIS_LABELS,
  STAT_BASIS_LABELS,
  StatBasis,
  RANK_METRICS,
  RankBasis,
  statLabelFor,
  FantasyScoring,
  SKILL_STATS,
  STAT_NAMES,
  PER_GAME_LABELS,
  combinedFor,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillWeights,
  fantasyPoints,
  SkillStatGroup,
  SkillStatKey,
  StatGroupId,
  unitStat,
  hasFantasy,
  skillGroups,
  statGroup,
} from 'app/positions';
import { MAX_MIN_GAMES, PositionService } from 'app/services/position.service';
import { copyRankingsToClipboard } from 'app/utils/clipboard';
import { SKILL_UNITS, UnitRankKey, recencyScore, statIsEmpty, unitRanks, weightedTotals } from 'app/utils/unit-scoring';
import { CURRENT_SEASON, SEASONS, dataSeason, dataVersion } from 'StaticData/data';
import { AWARD_INFO, AwardWin, awardsFor } from 'app/awards';
import { TintScale, tintFrom, tintScale } from 'app/utils/value-tint';
import { badgeColor, whiteLogo } from 'app/utils/team-colors';


@Component({
  selector: 'skill-rankings',
  templateUrl: './skill-rankings.component.html',
  styleUrls: ['../rankings/rankings.component.scss'],
  standalone: false,
})
export class SkillRankingsComponent implements OnChanges {
  @ViewChild('rankingsList') rankingsList!: ElementRef<HTMLElement>;

  @Input({ required: true }) position!: SkillPosition;

  playerList: SkillPlayer[] = [];
  stats: SkillStat[] = [];
  weights: SkillWeights = {};
  // Settings-menu toggles are shared with every position (see PositionService)
  // Settings menu: counting stats as season totals, per game or at a 17-game pace
  get statBasis(): StatBasis {
    return this.positionService.settings.statBasis;
  }
  statBasisLabels = STAT_BASIS_LABELS;

  cycleStatBasis() {
    this.positionService.cycleStatBasis();
  }

  // Counting stats are rates (per game, or per game x 17) rather than season totals
  get perGame(): boolean {
    return this.statBasis !== 'season';
  }

  // Same settings menu as the QB page; these two only change the QB table but stay in sync
  get totalStats(): boolean {
    return this.positionService.settings.totalStats;
  }
  set totalStats(value: boolean) {
    this.positionService.updateSettings({ totalStats: value });
  }

  // Settings menu: what the head coaches' Off / Def Rank columns rank on
  get rankBasis(): RankBasis {
    return this.positionService.settings.rankBasis;
  }
  rankBasisLabels = RANK_BASIS_LABELS;

  cycleRankBasis() {
    this.positionService.cycleRankBasis();
  }

  // Each head coach's unit ranks, worked out once per setting (not once per cell)
  private rankCache?: { key: string; ranks: Map<SkillPlayer, Record<UnitRankKey, number | null>> };

  private unitRank(player: SkillPlayer, key: UnitRankKey): number | null {
    const cacheKey = `${dataVersion}.${this.rankBasis}.${this.garbageTime}`;
    if (this.rankCache?.key !== cacheKey) {
      this.rankCache = { key: cacheKey, ranks: unitRanks(SKILL_UNITS.HC, this.rankBasis, this.garbageTime) };
    }
    return this.rankCache.ranks.get(player)?.[key] ?? null;
  }

  // Another team shares this rank (a small "(t)" in the cell, "#7 (tied)" in hover and copy text)
  rankTied(player: SkillPlayer, stat: SkillStat): boolean {
    if (stat.format !== 'rank') return false;
    const key = stat.key as UnitRankKey;
    const rank = this.unitRank(player, key);
    if (rank === null) return false;
    return [...this.rankCache!.ranks].some(([other, ranks]) => other !== player && ranks[key] === rank);
  }

  get garbageTime(): boolean {
    return this.positionService.settings.garbageTime;
  }
  set garbageTime(value: boolean) {
    this.positionService.updateSettings({ garbageTime: value });
  }

  get showInjured(): boolean {
    return this.positionService.settings.showInjured;
  }
  set showInjured(value: boolean) {
    this.positionService.updateSettings({ showInjured: value });
  }

  // Bandage hover: this season's injury report status, or for a past season, finishing it on IR
  injuryTitle(player: SkillPlayer): string {
    return dataSeason === CURRENT_SEASON
      ? `This player is currently injured${player.injuryStatus ? ` (${player.injuryStatus})` : ''}`
      : 'Finished the season on injured reserve';
  }

  // Footer year dropdown: every season we have, newest first
  readonly seasons = SEASONS;
  readonly currentSeason = CURRENT_SEASON;
  season = CURRENT_SEASON;
  seasonLoading = false;

  selectSeason(season: number) {
    this.positionService.setSeason(season);
  }

  // Footer filter button: opens / closes the filters menu
  get filtersOpen(): boolean {
    return this.positionService.filtersOpen;
  }

  toggleFilters() {
    this.positionService.setFiltersOpen(!this.filtersOpen);
  }

  // Min Games (settings menu): players with fewer games are left out. Tops out at the most games any
  // team has played that season: a finished season's length (16 through 2020, 17 since), or so far this
  // season. A higher setting counts as that (Min Games 15 in week 4 means 4).
  get seasonGames(): number {
    return Math.min(MAX_MIN_GAMES, Math.max(1, ...SKILL_UNITS.DEF.map((team) => team.games)));
  }

  get minGames(): number {
    return Math.min(this.positionService.settings.minGames, this.seasonGames);
  }

  stepMinGames(step: number) {
    const next = Math.min(this.seasonGames, Math.max(1, this.minGames + step));
    if (next === this.minGames) return;
    this.positionService.updateSettings({ minGames: next });
    this.sortPlayers();
  }

  // The players this tab lists: injured players only with Show Injured on, and enough games (not on
  // the team tabs, where everyone plays every week)
  private listedPlayers(): SkillPlayer[] {
    const teamTab = this.position === 'DEF' || this.position === 'OL' || this.position === 'HC';
    const min = teamTab ? 0 : this.minGames;
    return SKILL_UNITS[this.position].filter((player) => (this.showInjured || !player.injured) && player.games >= min);
  }

  get categoryColors(): boolean {
    return this.positionService.settings.categoryColors;
  }
  set categoryColors(value: boolean) {
    this.positionService.updateSettings({ categoryColors: value });
  }

  get colorValues(): boolean {
    return this.positionService.settings.colorValues;
  }
  set colorValues(value: boolean) {
    this.positionService.updateSettings({ colorValues: value });
  }

  // Settings: color-coded values (grades and records keep their own coloring; Games is context only)
  valueColor(player: SkillPlayer, stat: SkillStat): string | null {
    if (!this.colorValues || stat.infoOnly || ['grade', 'record', 'recent'].includes(stat.format)) return null;
    return tintFrom(this.rateValue(player, stat), this.columnScale(stat, 'rate'), !!stat.negative);
  }

  // Each column's average and spread over the list, computed once and reused by every cell and the
  // header hover (recomputing it per cell made the table slow to update, e.g. during column drags).
  // Cleared whenever the list or anything feeding the values changes.
  private scales = new Map<string, TintScale | null>();
  private scalesFor?: unknown[];

  private columnScale(stat: SkillStat, basis: 'rate' | 'shown'): TintScale | null {
    const inputs = [this.playerList, this.dataVersion, this.statBasis, this.fantasyScoring, this.garbageTime, this.rankBasis];
    if (!this.scalesFor || inputs.some((v, i) => v !== this.scalesFor![i])) {
      this.scales.clear();
      this.scalesFor = inputs;
    }
    const key = `${basis}.${stat.key}`;
    if (!this.scales.has(key)) {
      const value = (p: SkillPlayer) => (basis === 'shown' ? this.value(p, stat) : this.rateValue(p, stat));
      this.scales.set(key, tintScale(this.playerList.map(value)));
    }
    return this.scales.get(key)!;
  }

  // Bumped when grades from other tabs change (QB order, defense / coaching / O-line / weapons)
  private dataVersion = 0;

  get showUnused(): boolean {
    return this.positionService.settings.showUnused;
  }
  set showUnused(value: boolean) {
    this.positionService.updateSettings({ showUnused: value });
  }
  isToastVisible: boolean = false;
  // Where the toast shows: centered just under the copy button
  toastAt = { top: 0, left: 0 };
  fantasyScoring: FantasyScoring = 'ppr';
  scoringLabels = FANTASY_SCORING_LABELS;
  teamQbPlay = new Map<string, number>();
  // Team RB grades from the RB tab's order, weighted by carries
  teamRbPlay = new Map<string, number>();
  // Team grades from the Head Coaches / Defenses tabs' orders (the same grades the QB page uses)
  teamCoaching = new Map<string, number>();
  teamDefense = new Map<string, number>();
  hasFantasy: boolean = true;
  // This position's stat groups, and which are switched off (eye / header chip)
  groups: SkillStatGroup[] = [];
  hidden: Partial<Record<StatGroupId, boolean>> = {};

  constructor(private positionService: PositionService) {
    this.positionService.defenseGrades$.subscribe((grades) => {
      this.teamDefense = grades;
      this.refresh();
    });

    this.positionService.coachingGrades$.subscribe((grades) => {
      this.teamCoaching = grades;
      this.refresh();
    });

    this.positionService.weights$.subscribe((weights) => {
      if (!this.position) return;
      this.weights = weights[this.position];
      this.sortPlayers();
    });

    // QB Play from the QB tab's order (see PositionService)
    this.positionService.qbPlayGrades$.subscribe((grades) => {
      this.teamQbPlay = grades;
      this.refresh();
    });


    this.positionService.skillHidden$.subscribe((hidden) => {
      if (!this.position) return;
      this.hidden = hidden[this.position] ?? {};
      this.sortPlayers();
    });

    // Re-rank when the settings menu changes per-game stats or injured players
    this.positionService.settings$.subscribe(() => {
      if (this.position) this.sortPlayers();
    });

    this.positionService.olineGrades$.subscribe(() => this.refresh());
    this.positionService.weaponsGrades$.subscribe(() => this.refresh());

    this.positionService.rbPlayGrades$.subscribe((grades) => {
      this.teamRbPlay = grades;
      this.refresh();
    });

    // Eyes switch stats off: re-sort without them (the columns hide on their own)
    this.positionService.statHidden$.subscribe(() => {
      if (this.position) this.sortPlayers();
    });

    this.positionService.fantasyScoring$.subscribe((scoring) => {
      this.fantasyScoring = scoring;
      if (this.position) this.sortPlayers();
    });

    // Another season from the year selector: the new rows from the top, in that season's order for
    // this tab (dragged or not) if it has one, otherwise sorted by the sliders
    this.positionService.season$.subscribe((season) => {
      const changed = season !== this.season;
      this.season = season;
      if (changed && this.position) this.ngOnChanges();
    });
    this.positionService.seasonLoading$.subscribe((loading) => (this.seasonLoading = loading));
  }

  // Empty Recent slots for games not played yet (up to five)
  unplayed(player: SkillPlayer): null[] {
    return Array(Math.max(0, 5 - (player.lastFive?.length ?? 0))).fill(null);
  }

  cycleFantasyScoring() {
    this.positionService.cycleFantasyScoring();
  }

  ngOnChanges(): void {
    // A new tab starts scrolled to the top-left of its list
    this.rankingsList?.nativeElement.scrollTo({ top: 0, left: 0 });
    this.stats = SKILL_STATS[this.position];
    this.groups = skillGroups(this.position);
    this.hidden = this.positionService.skillHiddenGroups(this.position);
    this.hasFantasy = hasFantasy(this.position);
    this.weights = this.positionService.getWeights(this.position);
    // A hand-dragged order comes back as it was; otherwise re-sort with the latest grades from the
    // other tabs (a different Defenses order can move the Head Coaches, and so on)
    const saved = this.positionService.unitOrder(this.position);
    if (saved?.manual) this.restoreOrder(saved.ids);
    else this.sortPlayers();
  }

  // Changes from other tabs (QB order, defense / coaching / O-line / weapons grades) re-sort this tab
  // unless its order was dragged by hand; the new values still show either way
  private refresh() {
    this.dataVersion++;
    if (!this.position) return;
    if (!this.positionService.unitOrder(this.position)?.manual) this.sortPlayers();
  }

  // Put the list back in a saved order (units that have since appeared go at the end)
  private restoreOrder(ids: string[]) {
    const players = this.listedPlayers();
    const rank = new Map(ids.map((id, i) => [id, i]));
    this.playerList = [...players].sort((a, b) => (rank.get(a.gsisId) ?? Infinity) - (rank.get(b.gsisId) ?? Infinity));
  }

  // Remember this tab's order for when you come back, and for the grades other tabs use
  private publishOrder(manual: boolean) {
    this.positionService.setUnitOrder(this.position, this.playerList.map((player) => player.gsisId), manual);
  }

  // Sort Players By Weighted Total
  sortPlayers() {
    // Injured players drop out unless the settings menu's Show Injured is on, and so do players under
    // the Min Games setting
    const players = this.listedPlayers();
    // Switched-off groups don't count
    const counted = this.stats.filter((stat) => !this.hidden[statGroup(stat)] && !this.statHidden(stat.key));
    const totals = weightedTotals(players, counted, this.effectiveWeights(), (player, stat) =>
      this.value(player, stat),
    );
    this.playerList = [...players].sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    );
    this.publishOrder(false);
  }

  // Drop Event
  drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.playerList, event.previousIndex, event.currentIndex);
    this.publishOrder(true);
  }

  // Per-game value for volume stats, whatever the display setting: what color-coding uses,
  // so 100 yards in 1 game tints greener than 100 yards in 10 (ranking and display unchanged)
  rateValue(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.rawValue(player, stat);
    if (raw === null) return null;
    return stat.kind === 'volume' && !stat.infoOnly && player.games ? raw / player.games : raw;
  }

  // Label hover: the stat written out, plus the list average of what the column shows (season totals,
  // per game or 17-game pace, as the Stat Totals setting says)
  labelTitle(stat: SkillStat): string {
    const name = this.statName(stat);
    if (stat.format === 'record' || stat.format === 'recent' || stat.format === 'rank') return name;
    const avg = this.columnScale(stat, 'shown')?.mean ?? null;
    if (avg === null) return name;
    let shown: string;
    switch (stat.format) {
      case 'grade':
        shown = this.grade(avg);
        break;
      case 'pct':
        shown = `${Math.round(avg * 100)}%`;
        break;
      case 'pctPoints':
        shown = `${avg.toFixed(1)}%`;
        break;
      case 'dec2':
        shown = avg.toFixed(2);
        break;
      default:
        // (a 17-game pace reads in whole numbers, like its column)
        shown = this.statBasis === 'pace17' && stat.kind === 'volume' ? Math.round(avg).toLocaleString('en-US') : avg.toFixed(1);
    }
    return `${name} (Avg: ${shown})`;
  }

  // Volume stats show per-game (or 17-game pace) values unless Stat Totals is on Season Totals
  private showsPerGame(stat: SkillStat): boolean {
    return this.perGame && stat.kind === 'volume';
  }

  // Column label, switched to its per-game name (or tagged "17G") when the column shows rates
  statLabel(stat: SkillStat): string {
    const label = statLabelFor(stat, this.rankBasis);
    if (!this.showsPerGame(stat)) return label;
    return this.statBasis === 'pace17' ? `${label} (17G)` : (PER_GAME_LABELS[stat.key] ?? `${label} / Game`);
  }

  // A header label split before its parenthetical ("Off Rank" + "(Pts)", "Pass Yards" + "(17G)"), which
  // shows smaller
  labelParts(stat: SkillStat): [string, string | null] {
    const label = this.statLabel(stat);
    const match = label.match(/^(.*?)\s*(\([^()]*\))$/);
    return match ? [match[1], match[2]] : [label, null];
  }

  // The stat written out in full; kickers and defenses have their own fixed fantasy scoring
  statName(stat: SkillStat): string {
    const name =
      stat.key === 'fantasy' && !['K', 'DEF'].includes(this.position)
        ? `${FANTASY_SCORING_LABELS[this.fantasyScoring]} Fantasy Points`
        : (stat.name ?? STAT_NAMES[stat.key] ?? stat.label);
    // Unit ranks say what they're ranked on
    if (stat.key in RANK_METRICS) {
      return `${name} (by ${RANK_BASIS_LABELS[this.rankBasis]})`;
    }
    if (!this.showsPerGame(stat)) return name;
    return this.statBasis === 'pace17' ? `${name} (17-game pace)` : `${name} per Game`;
  }

  // Player-row hover (the label invisibly covers its value): "[value] [stat name]"
  valueTitle(player: SkillPlayer, stat: SkillStat): string {
    const name = this.statName(stat);
    const value = this.format(player, stat);
    return value === '-' ? name : `${value} ${name}`;
  }

  // Displayed value: for volume stats, per game or per game x 17 as the Stat Totals setting says
  value(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.rawValue(player, stat);
    if (raw === null) return null;
    if (!this.perGame || stat.kind !== 'volume' || !player.games) return raw;
    return (raw / player.games) * (this.statBasis === 'pace17' ? 17 : 1);
  }

  // A row's awards this season (badges beside the name), looked up once per season
  readonly awardInfo = AWARD_INFO;
  private awardCache?: { key: string; wins: Map<SkillPlayer, AwardWin[]> };

  awards(player: SkillPlayer): AwardWin[] {
    const key = `${dataVersion}.${this.position}`;
    if (this.awardCache?.key !== key) this.awardCache = { key, wins: new Map() };
    let wins = this.awardCache.wins.get(player);
    if (!wins) {
      wins = awardsFor(player, this.position, dataSeason);
      this.awardCache.wins.set(player, wins);
    }
    return wins;
  }

  rawValue(player: SkillPlayer, stat: SkillStat): number | null {
    switch (stat.key) {
      case 'games':
        return player.games;
      case 'recent':
        return recencyScore(player.lastFive);
      case 'offRank':
      case 'defRank':
        return this.unitRank(player, stat.key);
      // Combined columns (Total Yds, Total TDs, Turnovers): the sum of their two stats
      case 'totalYards':
      case 'totalTds':
      case 'turnovers': {
        const pair = combinedFor(this.position).find(({ stat: total }) => total.key === stat.key);
        if (!pair) return player.stats[stat.key as 'totalTds'] ?? null;
        const values = pair.parts.map((part) => unitStat(player, part as SkillStatKey, this.garbageTime));
        return values.every((v) => v === null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      }
      case 'fantasy':
        return fantasyPoints(player.stats.fantasyStd ?? 0, player.stats.receptions ?? 0, this.fantasyScoring);
      // Preseason blended with the Offensive Lines / RB, WR and TE rankings (the same grades as the QB page)
      case 'oline':
        return this.positionService.olineGrade(player.teamLogo);
      case 'weapons':
        return this.positionService.weaponsGrade(player.teamLogo);
      // Teams without a graded QB yet count as average
      case 'qbPlay':
        return this.teamQbPlay.get(player.teamLogo) ?? 6;
      case 'rbPlay':
        return this.teamRbPlay.get(player.teamLogo) ?? 6;
      // Same as the QB page: preseason coaching blended with the Head Coaches ranking, curved
      case 'coaching':
        return this.positionService.coachingGrade(player.teamLogo);
      case 'defense':
        return Math.round(this.teamDefense.get(player.teamLogo) ?? 6);
      default:
        return unitStat(player, stat.key, this.garbageTime);
    }
  }

  // Groups shown in the grid, each with the stats that have a column
  get visibleGroups(): SkillStatGroup[] {
    // In the order set by dragging the sidebar cards
    const order = this.positionService.groupOrder(this.position);
    return [...this.groups]
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .filter((group) => !this.hidden[group.id])
      .map((group) => ({
        ...group,
        stats: this.combine(this.ordered(group)).filter((stat) => this.isShown(stat)),
      }))
      .filter((group) => group.stats.length);
  }

  // A group's stats in their current column order (dragging a header reorders them; kept in
  // PositionService so the order survives switching tabs)
  private ordered(group: SkillStatGroup): SkillStat[] {
    const order = this.positionService.columnOrder(
      `${this.position}.${group.id}`,
      group.stats.map((stat) => stat.key),
    );
    return [...group.stats].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  // Column id for header dragging: a combined column stands in for the stat whose spot it took
  columnId(stat: SkillStat): string {
    return this.combinedSpot[stat.key] ?? stat.key;
  }

  // Which stat's spot each combined column took (the pair's first one in the current order)
  private combinedSpot: Partial<Record<string, string>> = {};

  // Combined Rush/Pass: a rushing + receiving pair (yards, touchdowns) shows as one total column
  // where the first of the two sits, when the tab has both
  private combine(stats: SkillStat[]): SkillStat[] {
    if (!this.totalStats) return stats;
    let out = stats;
    for (const { stat: total, parts } of combinedFor(this.position)) {
      const at = out.findIndex((stat) => parts.includes(stat.key));
      if (at === -1 || !parts.every((part) => out.some((stat) => stat.key === part))) continue;
      this.combinedSpot[total.key] = out[at].key;
      out = out.flatMap((stat, i) => (i === at ? [total] : parts.includes(stat.key) ? [] : [stat]));
    }
    return out;
  }

  // Switched off with its sidebar eye (or its parent Yards / Touchdowns slider's eye): hidden and out
  // of the ranking, whatever Unweighted Stats says
  private statHidden(key: string): boolean {
    const parent = combinedFor(this.position).find(({ parts }) => parts.includes(key as never));
    return (
      this.positionService.isStatHidden(this.position, key) ||
      (!!parent && this.positionService.isStatHidden(this.position, parent.stat.key))
    );
  }

  // Slider weights with each rush / rec part scaled by its parent slider (50 = as set, 0 = off)
  private effectiveWeights(): SkillWeights {
    const weights = { ...this.weights };
    for (const { stat, parts } of combinedFor(this.position)) {
      const parent = this.weights[stat.key] ?? 50;
      for (const part of parts) weights[part] = ((weights[part] ?? 0) * parent) / 50;
    }
    return weights;
  }

  // The eye decides first; Unweighted Stats only decides whether a 0% stat shows
  isShown(stat: SkillStat): boolean {
    // A combined column shows if either of its stats would
    const weights = this.effectiveWeights();
    const combined = combinedFor(this.position).find((c) => c.stat.key === stat.key);
    if (combined) {
      const parts = combined.parts.filter((key) => !this.statHidden(key) && !statIsEmpty(this.position, key));
      return parts.length > 0 && (this.showUnused || parts.some((key) => !!weights[key]));
    }
    if (this.statHidden(stat.key)) return false;
    // Not recorded that season
    if (statIsEmpty(this.position, stat.key)) return false;
    // Display-only columns (Games, FG Att) have no weight, so they show unless their eye is off
    if (stat.infoOnly) return true;
    return this.showUnused || !!weights[stat.key];
  }

  format(player: SkillPlayer, stat: SkillStat): string {
    const value = this.value(player, stat);
    if (value === null) return '-';
    // Per game reads to a decimal; a 17-game pace rounds to a whole season's worth
    const perGameVolume = this.statBasis === 'perGame' && stat.kind === 'volume';
    const paceVolume = this.statBasis === 'pace17' && stat.kind === 'volume';
    switch (stat.format) {
      case 'grade':
        return this.grade(value);
      case 'rank':
        return this.rankTied(player, stat) ? `#${value} (tied)` : `#${value}`;
      case 'record': {
        const { wins, losses, ties } = player.stats;
        return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      }
      case 'pctPoints':
        return `${(Number(value.toFixed(1)) + 0).toFixed(1)}%`;
      case 'pct':
        return `${Math.round(value * 100)}%`;
      // + 0 turns -0 into 0 so tiny negatives don't show as "-0.00"
      case 'dec1':
        return (Number(value.toFixed(1)) + 0).toFixed(1);
      case 'dec2':
        return (Number(value.toFixed(2)) + 0).toFixed(2);
      default:
        if (perGameVolume) return value.toFixed(1);
        return (paceVolume ? Math.round(value) : value).toLocaleString('en-US');
    }
  }

  // 0-12 -> F..A+, matching the QB support grades
  grade(value: number): string {
    const grades = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
    return grades[Math.min(12, Math.max(0, Math.round(value)))];
  }

  // Red (0) to green (12), same scale as the QB page
  gradeColor(player: SkillPlayer, stat: SkillStat): string | null {
    if (stat.format !== 'grade') return null;
    // Brighter at the red end so low grades stay readable on their dark pill
    const value = this.value(player, stat) ?? 6;
    return `hsl(${Math.round((value / 12) * 120)}, 100%, ${Math.round(50 + (1 - value / 12) * 16)}%)`;
  }

  // Color of the badge behind the team logo (the team's primary, or secondary for logos drawn in it)
  teamBadge(unit: { teamLogo: string }): string {
    return badgeColor(unit.teamLogo);
  }

  // The player's ESPN headshot (a cutout on a clear background), sized for the team card; none for
  // teams and units, or when ESPN has no photo (older seasons often don't)
  private missingHeadshots = new Set<number>();

  headshot(unit: { id?: number | null }): string | null {
    if (!unit.id || this.missingHeadshots.has(unit.id)) return null;
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${unit.id}.png&w=160&h=116`;
  }

  noHeadshot(unit: { id?: number | null }): void {
    if (unit.id) this.missingHeadshots.add(unit.id);
  }

  // Logos drawn in white on their badge (e.g. the Giants)
  teamLogoWhite(unit: { teamLogo: string }): boolean {
    return whiteLogo(unit.teamLogo);
  }

  // Get Count Classes
  // Gold for #1 (the top-5 class, with the trophy), green for 2-10 (top-10), red for the bottom 10
  // (bottom-5), white for the rest
  getCountClasses(i: number): string {
    if (i === 0) return 'count top-5';
    // The top 10 keep their green if the list is ever that short
    if (i < 10) return 'count top-10';
    if (i >= this.playerList.length - 10) return 'count bottom-5';
    return 'count';
  }

  // Footer info button: the About / FAQ panel (the button lights up while it's open)
  get aboutOpen(): boolean {
    return this.positionService.aboutOpen;
  }

  openAbout() {
    this.positionService.setAboutOpen(true);
  }

  // Copy Player Names
  copyPlayerListToClipboard(button: HTMLElement) {
    const rect = button.getBoundingClientRect();
    this.toastAt = { top: rect.bottom + 8, left: rect.left + rect.width / 2 };
    copyRankingsToClipboard(this.rankingsList.nativeElement)
      .then(() => this.showToast())
      .catch((err) => console.error('Failed to copy: ', err));
  }

  // Show toast for 2 seconds
  showToast() {
    this.isToastVisible = true;
    setTimeout(() => {
      this.isToastVisible = false;
    }, 2000);
  }
}
