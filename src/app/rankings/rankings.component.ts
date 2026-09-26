import { Component } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { FilterService } from '../services/filter.service';
import { EspnApiService } from 'app/services/espn-api.service';
import { Filters, Player } from 'app/types';
import { copyRankingsToClipboard } from 'app/utils/clipboard';
import { PositionService } from 'app/services/position.service';
import { defenseGrades } from 'app/utils/unit-scoring';
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
    recencyValue: 50,
    supportValue: 50,
    weaponsValue: 50,
    coachingValue: 50,
    olineValue: 50,
    defenseValue: 50,
    responsibilityValue: 50,
  };
  perGame: boolean = false;
  showInjured: boolean = true;
  showUnused: boolean = false;
  totalStats: boolean = true;
  isToastVisible: boolean = false;
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

  // Set each QB's defense grade (whole number, 0-12) from their team's Defenses ranking
  applyDefenseGrades() {
    for (const player of this.unfilteredPlayerList) {
      const grade = this.teamDefense.get(player.teamLogo);
      player.defense = player.defenseOverride ?? (grade === undefined ? 6 : Math.round(grade));
    }
  }

  // Share the QB order with the WR/TE QB Play grade
  publishRanks() {
    this.positionService.setQbRanks(this.playerList.map((player) => player.id));
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
    const advancedMix = epaWeight + cpoeWeight + successWeight + fantasyWeight;
    const advancedWeighted = advancedMix
      ? ((this.rangeScore((p) => p.epaPerPlay, player) * epaWeight +
          this.rangeScore((p) => p.cpoe, player) * cpoeWeight +
          this.rangeScore((p) => p.successRate, player) * successWeight +
          this.rangeScore((p) => this.fantasyPoints(p), player) * fantasyWeight) /
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

    const pkg =
      recordWeighted +
      compPercentWeighted +
      yardsWeighted +
      ypaWeighted +
      ratingWeighted +
      advancedWeighted +
      touchdownsWeighted -
      turnoverWeighted -
      (weaponsWeighted +
        coachingWeighted +
        olineWeighted +
        defenseWeighted -
        responsibilityWeighted) *
        (this.filters.supportValue / 250) + // Dividing By 250 to reduce the severity of slider (5 * 50)
      recencyWeighted;

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

  // Fantasy Points In The Chosen Scoring, Per Game When Toggled
  fantasyPoints(player: Player): number | null {
    if (player.fantasyStd === null) return null;
    const points = fantasyPoints(player.fantasyStd, player.receptions, this.fantasyScoring);
    return this.perGame && player.games ? points / player.games : points;
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
  calculateRecencyBias(games: number[]): number {
    if (games.length !== 5) {
      throw new Error('Array must have exactly 5 elements.');
    }

    const weights = [1, 0.9, 0.8, 0.7, 0.6];
    return games.reduce((sum, num, index) => sum + num * weights[index], 0);
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

    // Gold / silver / bronze for the top 3
    if (i < 3) {
      classes += ` rank-${i + 1}`;
    }

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

  // Get Number of Recent Wins
  getMinGames() {
    if (this.playerList.length === 0) {
      // Handle the case when the array is empty
      return null;
    }

    let lowestGames = this.playerList[0].games;

    for (let i = 1; i < this.playerList.length; i++) {
      if (this.playerList[i].games < lowestGames) {
        lowestGames = this.playerList[i].games;
      }
    }

    return lowestGames;
  }

  // Copy Player Names
  copyPlayerListToClipboard() {
    copyRankingsToClipboard(this.playerList)
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
