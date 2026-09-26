import { Component, Input, OnChanges } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import skillData from 'StaticData/skill-players.json';
import {
  SKILL_STATS,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillWeights,
} from 'app/positions';
import { PositionService } from 'app/services/position.service';
import { copyRankingsToClipboard } from 'app/utils/clipboard';

const PLAYERS = skillData as Record<SkillPosition, SkillPlayer[]>;

@Component({
  selector: 'skill-rankings',
  templateUrl: './skill-rankings.component.html',
  styleUrls: ['../rankings/rankings.component.scss'],
  standalone: false,
})
export class SkillRankingsComponent implements OnChanges {
  @Input({ required: true }) position!: SkillPosition;

  playerList: SkillPlayer[] = [];
  stats: SkillStat[] = [];
  weights: SkillWeights = {};
  perGame: boolean = false;
  showUnused: boolean = false;
  isToastVisible: boolean = false;

  constructor(private positionService: PositionService) {
    this.positionService.weights$.subscribe((weights) => {
      if (!this.position) return;
      this.weights = weights[this.position];
      this.sortPlayers();
    });
  }

  ngOnChanges(): void {
    this.stats = SKILL_STATS[this.position];
    this.playerList = [...PLAYERS[this.position]];
    this.weights = this.positionService.getWeights(this.position);
    this.sortPlayers();
  }

  // Sort Players By Weighted Total
  sortPlayers() {
    this.playerList = [...this.playerList].sort(
      (a, b) => this.totalWeighted(b) - this.totalWeighted(a),
    );
  }

  // Drop Event
  drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.playerList, event.previousIndex, event.currentIndex);
  }

  // Stat Value, Per Game For Volume Stats When Toggled
  value(player: SkillPlayer, stat: SkillStat): number {
    const raw = player.stats[stat.key];
    return this.perGame && stat.kind === 'volume' && player.games ? raw / player.games : raw;
  }

  // Combine Total Weighted Value Of Each Stat
  totalWeighted(player: SkillPlayer): number {
    return this.stats.reduce((total, stat) => {
      const weight = this.weights[stat.key] ?? 0;
      if (!weight) return total;
      const score = this.normalize(stat, this.value(player, stat)) * (weight / 50);
      return stat.negative ? total - score : total + score;
    }, 0);
  }

  // Scale Against The Max, Or Into 0.5-1 Of The League Range For Stats That Can Go Negative
  normalize(stat: SkillStat, value: number): number {
    const values = this.playerList.map((player) => this.value(player, stat));
    const max = Math.max(...values);
    if (!stat.signed) return max ? value / max : 0;

    const min = Math.min(...values);
    return max === min ? 1 : 0.5 + (0.5 * (value - min)) / (max - min);
  }

  isShown(stat: SkillStat): boolean {
    return this.showUnused || !!this.weights[stat.key];
  }

  format(player: SkillPlayer, stat: SkillStat): string {
    const value = this.value(player, stat);
    const perGameVolume = this.perGame && stat.kind === 'volume';
    switch (stat.format) {
      case 'pct':
        return `${Math.round(value * 100)}%`;
      case 'dec1':
        return value.toFixed(1);
      case 'dec2':
        return value.toFixed(2);
      default:
        return perGameVolume ? value.toFixed(1) : value.toLocaleString('en-US');
    }
  }

  // Get Count Classes
  getCountClasses(i: number): string {
    if (i < 5) return 'count top-5';
    if (i < 10) return 'count top-10';
    if (i < 15) return 'count top-15';
    return 'count';
  }

  getMinGames() {
    return this.playerList.length ? Math.min(...this.playerList.map((p) => p.games)) : null;
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
    }, 2000);
  }
}
