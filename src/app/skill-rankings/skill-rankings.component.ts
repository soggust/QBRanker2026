import { Component, Input, OnChanges, ElementRef, ViewChild } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { StaticData, blendGrade, preseasonCoaching, teamGamesPlayed } from 'StaticData/StaticData';
import {
  FANTASY_SCORING_LABELS,
  FantasyScoring,
  SKILL_STATS,
  STAT_NAMES,
  PER_GAME_LABELS,
  COMBINED_STATS,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillWeights,
  fantasyPoints,
  SkillStatGroup,
  StatGroupId,
  hasFantasy,
  skillGroups,
  statGroup,
} from 'app/positions';
import { PositionService } from 'app/services/position.service';
import { copyRankingsToClipboard } from 'app/utils/clipboard';
import { SKILL_UNITS, weightedTotals } from 'app/utils/unit-scoring';
import { tintAverage, tintColor } from 'app/utils/value-tint';
import { badgeColor, whiteLogo } from 'app/utils/team-colors';

// Average a per-QB value (0-12) for each team, weighted by how many games each QB started there
function teamGrades(valueFor: (qbId: number) => number | undefined): Map<string, number> {
  const totals = new Map<string, { sum: number; starts: number }>();
  for (const qb of StaticData) {
    const value = valueFor(qb.id);
    if (value === undefined) continue;
    for (const [team, starts] of Object.entries(qb.starts)) {
      const total = totals.get(team) ?? { sum: 0, starts: 0 };
      totals.set(team, { sum: total.sum + value * starts, starts: total.starts + starts });
    }
  }
  return new Map([...totals].map(([team, { sum, starts }]) => [team, sum / starts]));
}


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
  get perGame(): boolean {
    return this.positionService.settings.perGame;
  }
  set perGame(value: boolean) {
    this.positionService.updateSettings({ perGame: value });
  }

  // Same settings menu as the QB page; these two only change the QB table but stay in sync
  get totalStats(): boolean {
    return this.positionService.settings.totalStats;
  }
  set totalStats(value: boolean) {
    this.positionService.updateSettings({ totalStats: value });
  }

  get showInjured(): boolean {
    return this.positionService.settings.showInjured;
  }
  set showInjured(value: boolean) {
    this.positionService.updateSettings({ showInjured: value });
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
    if (!this.colorValues || stat.infoOnly || stat.format === 'grade' || stat.format === 'record') return null;
    return tintColor(
      this.rateValue(player, stat),
      this.playerList.map((p) => this.rateValue(p, stat)),
      !!stat.negative,
    );
  }

  get showUnused(): boolean {
    return this.positionService.settings.showUnused;
  }
  set showUnused(value: boolean) {
    this.positionService.updateSettings({ showUnused: value });
  }
  isToastVisible: boolean = false;
  fantasyScoring: FantasyScoring = 'ppr';
  scoringLabels = FANTASY_SCORING_LABELS;
  teamQbPlay = new Map<string, number>();
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

    // QB Play: #1 QB grades 12 (A+), the last-ranked grades 0 (F)
    this.positionService.qbRanks$.subscribe((ids) => {
      const last = Math.max(ids.length - 1, 1);
      this.teamQbPlay = teamGrades((id) => {
        const rank = ids.indexOf(id);
        return rank === -1 ? undefined : 12 * (1 - rank / last);
      });
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

    this.positionService.olineOverrides$.subscribe(() => this.refresh());

    // Eyes switch stats off: re-sort without them (the columns hide on their own)
    this.positionService.statHidden$.subscribe(() => {
      if (this.position) this.sortPlayers();
    });

    this.positionService.fantasyScoring$.subscribe((scoring) => {
      this.fantasyScoring = scoring;
      if (this.position) this.sortPlayers();
    });
  }

  // O-line +/- arrows: one grade step for the player's team, on this tab and the QB page
  stepOline(player: SkillPlayer, direction: 'up' | 'down') {
    this.positionService.stepOlineGrade(player.teamLogo, direction);
  }

  cycleFantasyScoring() {
    this.positionService.cycleFantasyScoring();
  }

  ngOnChanges(): void {
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

  // Changes from other tabs (QB order, defense / coaching grades, O-line tweaks) re-sort this tab
  // unless its order was dragged by hand; the new values still show either way
  private refresh() {
    if (!this.position) return;
    if (!this.positionService.unitOrder(this.position)?.manual) this.sortPlayers();
  }

  // Put the list back in a saved order (units that have since appeared go at the end)
  private restoreOrder(ids: string[]) {
    const players = SKILL_UNITS[this.position].filter((player) => this.showInjured || !player.injured);
    const rank = new Map(ids.map((id, i) => [id, i]));
    this.playerList = [...players].sort((a, b) => (rank.get(a.gsisId) ?? Infinity) - (rank.get(b.gsisId) ?? Infinity));
  }

  // Remember this tab's order for when you come back, and for the grades other tabs use
  private publishOrder(manual: boolean) {
    this.positionService.setUnitOrder(this.position, this.playerList.map((player) => player.gsisId), manual);
  }

  // Sort Players By Weighted Total
  sortPlayers() {
    // Injured players drop out unless the settings menu's Show Injured is on (same as QBs)
    const players = SKILL_UNITS[this.position].filter((player) => this.showInjured || !player.injured);
    // Switched-off groups don't count
    const counted = this.stats.filter((stat) => !this.hidden[statGroup(stat)] && !this.statHidden(stat.key));
    const totals = weightedTotals(players, counted, this.weights, (player, stat) =>
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

  // Label hover: the stat written out, plus the list average the color-coding centers on
  labelTitle(stat: SkillStat): string {
    const name = this.statName(stat);
    if (stat.format === 'record') return name;
    // Matches what the color-coding compares, or what the column shows when it's per game
    // (display-only columns like FG Att aren't color-coded, so they follow the column)
    const averaged = (p: SkillPlayer) => (this.showsPerGame(stat) ? this.value(p, stat) : this.rateValue(p, stat));
    const avg = tintAverage(this.playerList.map(averaged));
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
        shown = avg.toFixed(1);
    }
    // Volume stats average per game; the name already says so when the column is per game
    const perGame = stat.kind === 'volume' && !stat.infoOnly && !this.showsPerGame(stat);
    return `${name} (Avg: ${shown}${perGame ? ' per game' : ''})`;
  }

  // Volume stats show per-game values when Per-Game Stats is on
  private showsPerGame(stat: SkillStat): boolean {
    return this.perGame && stat.kind === 'volume';
  }

  // Column label, switched to its per-game name when the column shows per-game values
  statLabel(stat: SkillStat): string {
    return this.showsPerGame(stat) ? (PER_GAME_LABELS[stat.key] ?? `${stat.label} / Game`) : stat.label;
  }

  // The stat written out in full; kickers and defenses have their own fixed fantasy scoring
  statName(stat: SkillStat): string {
    const name =
      stat.key === 'fantasy' && !['K', 'DEF'].includes(this.position)
        ? `${FANTASY_SCORING_LABELS[this.fantasyScoring]} Fantasy Points`
        : (STAT_NAMES[stat.key] ?? stat.label);
    return this.showsPerGame(stat) ? `${name} per Game` : name;
  }

  // Player-row hover (the label invisibly covers its value): "[value] [stat name]"
  valueTitle(player: SkillPlayer, stat: SkillStat): string {
    const name = this.statName(stat);
    const value = this.format(player, stat);
    return value === '-' ? name : `${value} ${name}`;
  }

  // Displayed value: per game for volume stats when the setting is on
  value(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.rawValue(player, stat);
    if (raw === null) return null;
    return this.perGame && stat.kind === 'volume' && player.games ? raw / player.games : raw;
  }

  rawValue(player: SkillPlayer, stat: SkillStat): number | null {
    switch (stat.key) {
      case 'games':
        return player.games;
      case 'totalYards': {
        const { rushYards, recYards } = player.stats;
        return rushYards === null && recYards === null ? null : (rushYards ?? 0) + (recYards ?? 0);
      }
      case 'fantasy':
        return fantasyPoints(player.stats.fantasyStd ?? 0, player.stats.receptions ?? 0, this.fantasyScoring);
      // Shared with the QB page: +/- on either tab moves the team's O-line grade in both
      case 'oline':
        return this.positionService.olineGrade(player.teamLogo);
      // Teams without a graded QB yet count as average
      case 'qbPlay':
        return this.teamQbPlay.get(player.teamLogo) ?? 6;
      // Same as the QB page: preseason coaching blended with the Head Coaches ranking by games played
      case 'coaching':
        return blendGrade(
          preseasonCoaching(player.teamLogo),
          this.teamCoaching.get(player.teamLogo),
          teamGamesPlayed(player.teamLogo),
        );
      case 'defense':
        return Math.round(this.teamDefense.get(player.teamLogo) ?? 6);
      default:
        return player.stats[stat.key];
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
    for (const { stat: total, parts } of COMBINED_STATS) {
      const at = out.findIndex((stat) => parts.includes(stat.key));
      if (at === -1 || !parts.every((part) => out.some((stat) => stat.key === part))) continue;
      this.combinedSpot[total.key] = out[at].key;
      out = out.flatMap((stat, i) => (i === at ? [total] : parts.includes(stat.key) ? [] : [stat]));
    }
    return out;
  }

  // Switched off with its sidebar eye: hidden and out of the ranking, whatever Unweighted Stats says
  private statHidden(key: string): boolean {
    return this.positionService.isStatHidden(this.position, key);
  }

  // The eye decides first; Unweighted Stats only decides whether a 0% stat shows
  isShown(stat: SkillStat): boolean {
    // A combined column shows if either of its stats would
    const combined = COMBINED_STATS.find((c) => c.stat.key === stat.key);
    if (combined) {
      const parts = combined.parts.filter((key) => !this.statHidden(key));
      return parts.length > 0 && (this.showUnused || parts.some((key) => !!this.weights[key]));
    }
    if (this.statHidden(stat.key)) return false;
    // Display-only columns (Games, FG Att) have no weight, so they show unless their eye is off
    if (stat.infoOnly) return true;
    return this.showUnused || !!this.weights[stat.key];
  }

  format(player: SkillPlayer, stat: SkillStat): string {
    const value = this.value(player, stat);
    if (value === null) return '-';
    const perGameVolume = this.perGame && stat.kind === 'volume';
    switch (stat.format) {
      case 'grade':
        return this.grade(value);
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
        return perGameVolume ? value.toFixed(1) : value.toLocaleString('en-US');
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

  // Logos drawn in white on their badge (e.g. the Giants)
  teamLogoWhite(unit: { teamLogo: string }): boolean {
    return whiteLogo(unit.teamLogo);
  }

  // Get Count Classes
  getCountClasses(i: number): string {
    if (i < 5) return 'count top-5';
    // Bottom 5 in red (the top 5 keep their gold if the list is ever that short)
    if (i >= this.playerList.length - 5) return 'count bottom-5';
    if (i < 10) return 'count top-10';
    if (i < 15) return 'count top-15';
    return 'count';
  }

  // Copy Player Names
  copyPlayerListToClipboard() {
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
