import { Component, ElementRef, ViewChild } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { FilterService } from '../services/filter.service';
import { EspnApiService } from 'app/services/espn-api.service';
import { Filters, Player } from 'app/types';
import { copyRankingsToClipboard } from 'app/utils/clipboard';
import { PositionService } from 'app/services/position.service';
import { defenseGrades } from 'app/utils/unit-scoring';
import { tintAverage, tintColor } from 'app/utils/value-tint';

export type ColumnGroupId = 'results' | 'box' | 'advanced' | 'support';

const COLUMN_GROUPS: { id: ColumnGroupId; label: string }[] = [
  { id: 'results', label: 'Results' },
  { id: 'box', label: 'Basic Stats' },
  { id: 'advanced', label: 'Advanced Stats' },
  { id: 'support', label: 'Support' },
];

import {
  FANTASY_SCORING_LABELS,
  FantasyScoring,
  SkillWeights,
  fantasyPoints,
} from 'app/positions';

@Component({
  selector: 'rankings',
  templateUrl: './rankings.component.html',
  styleUrls: ['./rankings.component.scss'],
  standalone: false,
})
export class RankingsComponent {
  @ViewChild('rankingsList') rankingsList!: ElementRef<HTMLElement>;

  playerList: Player[] = [];
  unfilteredPlayerList: Player[] = [];
  filters: Filters = {
    recordValue: 50,
    compValue: 50,
    yardsValue: 50,
    passYdValue: 50,
    rushYdValue: 50,
    ypaValue: 50,
    touchdownValue: 50,
    passTdValue: 50,
    rushTdValue: 50,
    turnoverValue: 50,
    intValue: 50,
    fumLostValue: 50,
    ratingValue: 50,
    advancedValue: 50,
    epaValue: 50,
    cpoeValue: 50,
    successValue: 50,
    fantasyValue: 50,
    pressureToSackValue: 50,
    badThrowValue: 50,
    timeToThrowValue: 50,
    adotValue: 50,
    aggressivenessValue: 50,
    recencyValue: 50,
    supportValue: 50,
    weaponsValue: 50,
    coachingValue: 50,
    olineValue: 50,
    defenseValue: 50,
    responsibilityValue: 50,
  };
  // Settings-menu toggles live in PositionService so every position shares and remembers them
  get perGame(): boolean {
    return this.positionService.settings.perGame;
  }
  set perGame(value: boolean) {
    this.positionService.updateSettings({ perGame: value });
  }

  get showInjured(): boolean {
    return this.positionService.settings.showInjured;
  }
  set showInjured(value: boolean) {
    this.positionService.updateSettings({ showInjured: value });
  }

  get showUnused(): boolean {
    return this.positionService.settings.showUnused;
  }
  set showUnused(value: boolean) {
    this.positionService.updateSettings({ showUnused: value });
  }

  get colorValues(): boolean {
    return this.positionService.settings.colorValues;
  }
  set colorValues(value: boolean) {
    this.positionService.updateSettings({ colorValues: value });
  }

  // Tint a value column (settings: color-coded values); keys are the column classes in the template
  tint(column: string, player: Player): string | null {
    if (!this.colorValues) return null;
    const stat = this.tintStats[column];
    if (!stat) return null;
    return tintColor(stat.get(player), this.playerList.map(stat.get), stat.lowerIsBetter);
  }

  // Label hover: the stat written out, plus the list average the color-coding centers on
  labelTitle(column: string): string {
    const label = this.labelInfo[column];
    const name = column === 'fantasy' ? `${this.scoringLabels[this.fantasyScoring]} Fantasy Points` : label.name;
    const stat = this.tintStats[column] ?? this.gradeStats[column];
    if (!stat || !label.avg) return name;
    const avg = tintAverage(this.playerList.map(stat.get));
    return avg === null ? name : `${name} (Avg: ${label.avg(avg)})`;
  }

  // Player-row hover (the label invisibly covers its value): "[value] [stat name]"
  cellTitle(column: string, label: HTMLElement, player: Player): string {
    const name = column === 'fantasy' ? `${this.scoringLabels[this.fantasyScoring]} Fantasy Points` : this.labelInfo[column].name;
    if (column === 'last-five') return `${this.getNumberOfRecentWins(player.lastFive)} Wins in the ${name}`;
    const value = (label.previousElementSibling?.textContent ?? '').replace(/\s+/g, '');
    return value && value !== '-' ? `${value} ${name}` : name;
  }

  private readonly gradeStats: Record<string, { get: (p: Player) => number | null }> = {
    weapons: { get: (p) => p.weapons },
    coaching: { get: (p) => p.coaching },
    'o-line': { get: (p) => p.oline },
    defense: { get: (p) => p.defense },
    responsibility: { get: (p) => p.responsibility },
  };

  private readonly labelInfo: Record<string, { name: string; avg?: (v: number) => string }> = (() => {
    const perGame = (v: number) => `${v.toFixed(1)} per game`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const grades = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
    const grade = (v: number) => grades[Math.min(12, Math.max(0, Math.round(v)))];
    return {
      record: { name: 'Record as Starter', avg: (v) => `${v.toFixed(3).replace(/^0/, '')} win %` },
      'last-five': { name: 'Last 5 Games' },
      'comp-percent': { name: 'Completion Percentage', avg: (v) => `${v.toFixed(1)}%` },
      'total-yards': { name: 'Total Passing + Rushing Yards', avg: perGame },
      'pass-yards': { name: 'Passing Yards', avg: perGame },
      ypa: { name: 'Yards per Pass Attempt', avg: (v) => v.toFixed(1) },
      'rush-yards': { name: 'Rushing Yards', avg: perGame },
      touchdowns: { name: 'Total Passing + Rushing Touchdowns', avg: perGame },
      'pass-tds': { name: 'Passing Touchdowns', avg: perGame },
      'rush-tds': { name: 'Rushing Touchdowns', avg: perGame },
      turnovers: { name: 'Total Interceptions + Fumbles Lost', avg: perGame },
      interceptions: { name: 'Interceptions', avg: perGame },
      'fumbles-lost': { name: 'Fumbles Lost', avg: perGame },
      rating: { name: 'Passer Rating', avg: (v) => v.toFixed(1) },
      epa: { name: 'Expected Points Added per Play', avg: (v) => v.toFixed(2) },
      cpoe: { name: 'Completion Percentage Over Expected', avg: (v) => `${v.toFixed(1)}%` },
      'success-rate': { name: 'Success Rate', avg: pct },
      pressureToSack: { name: 'Pressure-to-Sack Rate', avg: pct },
      badThrowPct: { name: 'Bad Throw Percentage', avg: pct },
      timeToThrow: { name: 'Time to Throw', avg: (v) => `${v.toFixed(2)} sec` },
      adot: { name: 'Average Depth of Target', avg: (v) => `${v.toFixed(1)} yds` },
      aggressiveness: { name: 'Aggressiveness Percentage', avg: (v) => `${Math.round(v)}%` },
      fantasy: { name: 'Fantasy Points', avg: perGame },
      weapons: { name: 'Weapons Grade', avg: grade },
      coaching: { name: 'Coaching Grade', avg: grade },
      'o-line': { name: 'Offensive Line Grade', avg: grade },
      defense: { name: 'Defense Grade', avg: grade },
      responsibility: { name: 'Responsibility to Team Grade', avg: grade },
    };
  })();

  // Color-coding compares volume stats per game, whatever the display setting
  private perGameOf(player: Player, total: number): number {
    return player.games ? total / player.games : total;
  }

  private readonly tintStats: Record<string, { get: (p: Player) => number | null; lowerIsBetter?: boolean }> = {
    record: { get: (p) => (p.wins + (p.ties ?? 0) * 0.5) / Math.max(p.wins + p.losses + (p.ties ?? 0), 1) },
    'comp-percent': { get: (p) => Number(p.compPercent) },
    'total-yards': { get: (p) => this.perGameOf(p, p.passYards + p.rushYards) },
    'pass-yards': { get: (p) => this.perGameOf(p, p.passYards) },
    'rush-yards': { get: (p) => this.perGameOf(p, p.rushYards) },
    ypa: { get: (p) => Number(p.ypa) },
    touchdowns: { get: (p) => this.perGameOf(p, p.passTd + p.rushTd) },
    'pass-tds': { get: (p) => this.perGameOf(p, p.passTd) },
    'rush-tds': { get: (p) => this.perGameOf(p, p.rushTd) },
    turnovers: { get: (p) => this.perGameOf(p, p.ints + p.fumLost), lowerIsBetter: true },
    interceptions: { get: (p) => this.perGameOf(p, p.ints), lowerIsBetter: true },
    'fumbles-lost': { get: (p) => this.perGameOf(p, p.fumLost), lowerIsBetter: true },
    rating: { get: (p) => p.rating },
    epa: { get: (p) => p.epaPerPlay },
    cpoe: { get: (p) => p.cpoe },
    'success-rate': { get: (p) => p.successRate },
    pressureToSack: { get: (p) => p.pressureToSack, lowerIsBetter: true },
    badThrowPct: { get: (p) => p.badThrowPct, lowerIsBetter: true },
    timeToThrow: { get: (p) => p.timeToThrow, lowerIsBetter: true },
    adot: { get: (p) => p.adot },
    aggressiveness: { get: (p) => p.aggressiveness },
    fantasy: { get: (p) => this.fantasyPerGame(p) },
  };

  get totalStats(): boolean {
    return this.positionService.settings.totalStats;
  }
  set totalStats(value: boolean) {
    this.positionService.updateSettings({ totalStats: value });
  }
  isToastVisible: boolean = false;

  // Column groups, switched on / off from the header chips or the sidebar eye
  columnGroups = COLUMN_GROUPS;
  // Groups switched off with the sidebar eye: no columns, no weight in the ranking
  hidden: Record<ColumnGroupId, boolean> = { results: false, box: false, advanced: false, support: false };
  // Each group's contribution to a player's total
  private groupScores = new Map<number, Record<ColumnGroupId, number>>();
  fantasyScoring: FantasyScoring = 'ppr';
  scoringLabels = FANTASY_SCORING_LABELS;
  teamDefense = new Map<string, number>();
  defenseWeights?: SkillWeights;

  constructor(
    private filterService: FilterService,
    private espnApiService: EspnApiService,
    private positionService: PositionService,
  ) {
    this.positionService.fantasyScoring$.subscribe((scoring) => {
      this.fantasyScoring = scoring;
      this.sortPlayers();
    });

    // Defense grades follow the Defenses rankings (and their sliders) unless overridden
    // (only when the Defenses weights change, so manual +/- tweaks survive other tabs' slider moves)
    this.positionService.weights$.subscribe((weights) => {
      if (weights.DEF === this.defenseWeights) return;
      this.defenseWeights = weights.DEF;
      this.teamDefense = defenseGrades(weights.DEF);
      this.applyDefenseGrades();
      this.sortPlayers();
    });

    this.espnApiService.playerStats$.subscribe((res: Player[]) => {
      this.playerList = res;
      this.unfilteredPlayerList = res;
      this.applyDefenseGrades();
      this.sortPlayers();
    });

    // Re-rank when another tab's settings menu changes per-game stats or injured players
    this.positionService.settings$.subscribe(() => this.sortPlayers());

    this.filterService.hiddenGroups$.subscribe((hidden) => {
      this.hidden = hidden;
      this.sortPlayers();
    });

    this.filterService.filters$.subscribe((res) => {
      this.filters = res;
      this.sortPlayers();
    });
  }

  // Sort Players
  sortPlayers() {
    // Filter out injured players if showInjured is true
    const filteredData = !this.showInjured
      ? this.playerList.filter((player) => !player.injured)
      : this.unfilteredPlayerList;

    // Sort the filtered data
    this.playerList = [...filteredData].sort((a, b) =>
      this.sortPlayersFunc(a, b),
    );
    this.publishRanks();
  }

  // Header chips switch a group on / off, same as the sidebar eye
  toggleColumnGroup(id: ColumnGroupId) {
    this.filterService.setGroupHidden(id, !this.hidden[id]);
  }

  // Set each QB's defense grade (whole number, 0-12) from their team's Defenses ranking
  applyDefenseGrades() {
    for (const player of this.unfilteredPlayerList) {
      const grade = this.teamDefense.get(player.teamLogo);
      player.defense = player.defenseOverride ?? (grade === undefined ? 6 : Math.round(grade));
    }
  }

  // Share the QB order with the WR/TE QB Play grade
  // Uses every QB who started (injured ones included), so each team's QB Play is each starter's
  // grade weighted by their share of the team's starts; follows manual drag order when all are shown
  publishRanks() {
    const everyone =
      this.playerList.length === this.unfilteredPlayerList.length
        ? this.playerList
        : [...this.unfilteredPlayerList].sort((a, b) => this.sortPlayersFunc(a, b));
    this.positionService.setQbRanks(everyone.map((player) => player.id));
  }

  // Reset
  reset() {
    this.playerList = this.unfilteredPlayerList;
  }

  // Drop Event
  drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.playerList, event.previousIndex, event.currentIndex);
    this.publishRanks();
  }

  // ---------------------------------------

  // Sort Function
  sortPlayersFunc(a: Player, b: Player) {
    const TotalA = this.totalWeighted(a);
    const TotalB = this.totalWeighted(b);

    // Compare Totals
    if (TotalA < TotalB) {
      return 1;
    } else if (TotalA > TotalB) {
      return -1;
    } else {
      return 0;
    }
  }

  // Combine Total Weighted Value Of Each Stat
  totalWeighted(player: Player) {
    const recordValue = player.wins + (player.ties ?? 0) * 0.5;
    const recordWeighted = this.applyWeight(
      recordValue / (player.wins + player.losses + (player.ties ?? 0)),
      this.filters.recordValue,
      this.findMax('record'),
    );

    const compPercentWeighted = this.applyWeight(
      player.compPercent,
      this.filters.compValue,
      this.findMax('compPercent'),
    );

    const passYardsWeighted =
      player.passYards * (this.filters.passYdValue / 50);
    const rushYardsWeighted =
      player.rushYards * (this.filters.rushYdValue / 50);

    const yardsWeighted = this.applyWeight(
      this.perGame
        ? ((passYardsWeighted + rushYardsWeighted) / player.games) * 10
        : passYardsWeighted + rushYardsWeighted,
      this.filters.yardsValue,
      this.perGame ? this.findMax('yardsPerGame') : this.findMax('yards'),
    );
    const ypaWeighted = this.applyWeight(
      player.ypa,
      this.filters.ypaValue,
      this.findMax('ypa'),
    );

    const passTdsWeighted = player.passTd * (this.filters.passTdValue / 50);
    const rushTdsWeighted = player.rushTd * (this.filters.rushTdValue / 50);
    const touchdownsWeighted = this.applyWeight(
      this.perGame
        ? ((passTdsWeighted + rushTdsWeighted) / player.games) * 10
        : passTdsWeighted + rushTdsWeighted,
      this.filters.touchdownValue,
      this.perGame ? this.findMax('tdPerGame') : this.findMax('touchdowns'),
    );

    const intsWeighted = player.ints * (this.filters.intValue / 50);
    const fumLostWeighted = player.fumLost * (this.filters.fumLostValue / 50);
    const turnoverWeighted = this.applyWeight(
      this.perGame
        ? ((intsWeighted + fumLostWeighted) / player.games) * 10
        : intsWeighted + fumLostWeighted,
      this.filters.turnoverValue,
      this.perGame
        ? this.findMax('turnoversPerGame')
        : this.findMax('turnovers'),
    );
    const ratingWeighted = this.applyWeight(
      player.rating,
      this.filters.ratingValue,
      this.findMax('rating'),
    );
    // Advanced stats can be negative, so they're scaled against the league range
    // instead of the max; sub-sliders set the mix within the group
    const epaWeight = this.filters.epaValue;
    const cpoeWeight = this.filters.cpoeValue;
    const successWeight = this.filters.successValue;
    const fantasyWeight = this.filters.fantasyValue;
    // Lower is better for pressure-to-sack, bad throws and time to throw, so those are negated
    const negate = (v: number | null) => (v === null ? null : -v);
    const extras: [number, (p: Player) => number | null][] = [
      [this.filters.pressureToSackValue, (p) => negate(p.pressureToSack)],
      [this.filters.badThrowValue, (p) => negate(p.badThrowPct)],
      [this.filters.timeToThrowValue, (p) => negate(p.timeToThrow)],
      [this.filters.adotValue, (p) => p.adot],
      [this.filters.aggressivenessValue, (p) => p.aggressiveness],
    ];
    const advancedMix =
      epaWeight + cpoeWeight + successWeight + fantasyWeight + extras.reduce((sum, [w]) => sum + w, 0);
    const advancedWeighted = advancedMix
      ? ((this.rangeScore((p) => p.epaPerPlay, player) * epaWeight +
          this.rangeScore((p) => p.cpoe, player) * cpoeWeight +
          this.rangeScore((p) => p.successRate, player) * successWeight +
          this.rangeScore((p) => this.fantasyPoints(p), player) * fantasyWeight +
          extras.reduce((sum, [w, stat]) => sum + this.rangeScore(stat, player) * w, 0)) /
          advancedMix) *
        (this.filters.advancedValue / 50)
      : 0;

    const recencyWeighted = this.applyWeight(
      this.calculateRecencyBias(player.lastFive),
      this.filters.recencyValue,
      5,
    );

    const weaponsWeighted = this.applyWeight(
      player.weapons,
      this.filters.weaponsValue,
      12,
    );
    const coachingWeighted = this.applyWeight(
      player.coaching,
      this.filters.coachingValue,
      12,
    );
    const olineWeighted = this.applyWeight(
      player.oline,
      this.filters.olineValue,
      12,
    );
    const defenseWeighted = this.applyWeight(
      player.defense,
      this.filters.defenseValue,
      12,
    );
    const responsibilityWeighted = this.applyWeight(
      player.responsibility,
      this.filters.responsibilityValue,
      12,
    );

    const supportWeighted =
      -(weaponsWeighted + coachingWeighted + olineWeighted + defenseWeighted - responsibilityWeighted) *
      (this.filters.supportValue / 250);
    this.groupScores.set(player.id, {
      results: recordWeighted + recencyWeighted,
      box:
        compPercentWeighted + yardsWeighted + ypaWeighted + ratingWeighted + touchdownsWeighted - turnoverWeighted,
      advanced: advancedWeighted,
      support: supportWeighted,
    });

    // Groups switched off with the eye don't count
    const scores = this.groupScores.get(player.id)!;
    const pkg = COLUMN_GROUPS.reduce((sum, { id }) => sum + (this.hidden[id] ? 0 : scores[id]), 0);

    // console.log(player.name);
    // console.log('record: ' + recordWeighted);
    // console.log('comp percent: ' + compPercentWeighted);
    // console.log('total yards: ' + yardsWeighted);
    // console.log('ypa: ' + ypaWeighted);
    // console.log('touchdowns: ' + touchdownsWeighted);
    // console.log('turnovers: ' + turnoverWeighted);
    // console.log('rating: ' + ratingWeighted);
    // console.log('weapons: ' + weaponsWeighted);
    // console.log('coaching: ' + coachingWeighted);
    // console.log('oline: ' + olineWeighted);
    // console.log('defense: ' + defenseWeighted);
    // console.log('responsibility: ' + responsibilityWeighted);
    // console.log('recency: ' + recencyWeighted);

    return pkg;
  }

  // Apply Weight To Filters
  applyWeight(stat: number, weight: number, max: number) {
    if (max === 0) {
      // To avoid ever theoretically dividing by 0
      return 0;
    }
    // Divide by max + min to normalize the numbers
    const weighted = (stat / max) * (weight / 50);
    return weighted;
  }

  // Scale A Stat Into 0.5-1 Based On The League Min/Max (Missing Data Counts As The Min)
  rangeScore(stat: (player: Player) => number | null, player: Player) {
    const value = stat(player);
    const values = this.playerList.map(stat).filter((v): v is number => v !== null);
    if (value === null || values.length === 0) return 0.5;

    const min = Math.min(...values);
    const max = Math.max(...values);
    return max === min ? 1 : 0.5 + (0.5 * (value - min)) / (max - min);
  }

  // Fantasy Points In The Chosen Scoring, Per Game When Toggled (display)
  fantasyPoints(player: Player): number | null {
    const perGame = this.fantasyPerGame(player);
    if (perGame === null) return null;
    return this.perGame ? perGame : perGame * (player.games || 1);
  }

  // Fantasy points per game: what color-coding uses
  fantasyPerGame(player: Player): number | null {
    if (player.fantasyStd === null) return null;
    const points = fantasyPoints(player.fantasyStd, player.receptions, this.fantasyScoring);
    return player.games ? points / player.games : points;
  }

  cycleFantasyScoring() {
    this.positionService.cycleFantasyScoring();
  }

  // Modify Support Stat
  modifyStat(player: Player, stat: string, direction: string) {
    const statKeys = [
      'weapons',
      'coaching',
      'oline',
      'defense',
      'responsibility',
    ];
    if (statKeys.includes(stat)) {
      const currentValue =
        this.playerList[this.playerList.indexOf(player)][stat];
      const maxLimit = 12;
      const minLimit = 0;

      if (
        (direction === 'down' && currentValue === minLimit) ||
        (direction === 'up' && currentValue === maxLimit)
      ) {
        return;
      }

      this.playerList[this.playerList.indexOf(player)][stat] =
        direction === 'up' ? currentValue + 1 : currentValue - 1;
      this.sortPlayers();
    }
  }

  // Find Max Attribute
  findMax(attribute: string): number {
    if (this.playerList.length === 0) return 0;

    const values = this.playerList.map((player) => {
      switch (attribute) {
        case 'record':
          return (
            (player.wins + (player.ties ?? 0) * 0.5) /
            (player.wins + player.losses + (player.ties ?? 0))
          );
        case 'tdPerGame':
          return ((player.passTd + player.rushTd) / player.games) * 10;
        case 'touchdowns':
          return player.passTd + player.rushTd;
        case 'turnovers':
          return player.ints + player.fumLost;
        case 'turnoversPerGame':
          return ((player.ints + player.fumLost) / player.games) * 10;
        case 'yards':
          return player.passYards + player.rushYards;
        case 'yardsPerGame':
          return ((player.passYards + player.rushYards) / player.games) * 10;
        default:
          return player[attribute];
      }
    });

    return Math.max(...values);
  }

  // Calculate Recency Bias
  // Weighted recent results (newest counts most), scaled to a full five games so unplayed
  // games don't count as losses: 2-0 scores the same as 5-0
  calculateRecencyBias(games: number[]): number {
    const weights = [1, 0.9, 0.8, 0.7, 0.6];
    const played = games.slice(0, 5);
    if (!played.length) return 0;

    const earned = played.reduce((sum, result, index) => sum + result * weights[index], 0);
    const possible = played.reduce((sum, _, index) => sum + weights[index], 0);
    return (earned / possible) * weights.reduce((a, b) => a + b, 0);
  }

  // Empty slots for recent games not played yet
  unplayedGames(games: number[]): null[] {
    return Array(Math.max(0, 5 - games.length)).fill(null);
  }

  getColor(value: number): string {
    // Assuming value ranges from 0 to 12
    const hue = Math.round((value / 12) * 120); // 0 is red, 120 is green on the hue scale
    const saturation = 100; // Full saturation
    // Brighter at the red end so low grades stay readable on their dark pill
    const lightness = Math.round(50 + (1 - value / 12) * 16);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  // Get Column Numbers
  getColumnNumbers(targetProperties?: string[]) {
    let count = 0;

    for (const key in this.filters) {
      if (
        Object.prototype.hasOwnProperty.call(this.filters, key) &&
        this.filters[key] > 0 &&
        (!targetProperties ||
          (targetProperties.includes && targetProperties.includes(key)))
      ) {
        count++;
      }
    }

    return count;
  }

  // Get Count Classes
  getCountClasses(i: number): string {
    let classes = 'count';

    if (i < 5) {
      classes += ' top-5';
    } else if (i >= 5 && i < 10) {
      classes += ' top-10';
    } else if (i >= 10 && i < 15) {
      classes += ' top-15';
    }

    return classes;
  }
  // Get Number of Recent Wins
  getNumberOfRecentWins(array) {
    const numberOfWins = array.filter((item) => item === 1).length;
    return numberOfWins;
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
    }, 2000); // Hide after 2 seconds
  }
}
