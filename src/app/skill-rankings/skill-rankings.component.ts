import { Component, Input, OnChanges } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { StaticData, gradesForTeam } from 'StaticData/StaticData';
import {
  FANTASY_SCORING_LABELS,
  FantasyScoring,
  SKILL_STATS,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillWeights,
  fantasyPoints,
  hasFantasy,
} from 'app/positions';
import { PositionService } from 'app/services/position.service';
import { copyRankingsToClipboard } from 'app/utils/clipboard';
import { SKILL_UNITS, weightedTotals } from 'app/utils/unit-scoring';

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
  @Input({ required: true }) position!: SkillPosition;

  playerList: SkillPlayer[] = [];
  stats: SkillStat[] = [];
  weights: SkillWeights = {};
  perGame: boolean = false;
  showUnused: boolean = false;
  isToastVisible: boolean = false;
  fantasyScoring: FantasyScoring = 'ppr';
  scoringLabels = FANTASY_SCORING_LABELS;
  teamQbPlay = new Map<string, number>();
  hasFantasy: boolean = true;

  constructor(private positionService: PositionService) {
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
      if (this.position) this.sortPlayers();
    });

    this.positionService.fantasyScoring$.subscribe((scoring) => {
      this.fantasyScoring = scoring;
      if (this.position) this.sortPlayers();
    });
  }

  cycleFantasyScoring() {
    this.positionService.cycleFantasyScoring();
  }

  ngOnChanges(): void {
    this.stats = SKILL_STATS[this.position];
    this.hasFantasy = hasFantasy(this.position);
    this.playerList = [...SKILL_UNITS[this.position]];
    this.weights = this.positionService.getWeights(this.position);
    this.sortPlayers();
  }

  // Sort Players By Weighted Total
  sortPlayers() {
    const totals = weightedTotals(this.playerList, this.stats, this.weights, (player, stat) =>
      this.value(player, stat),
    );
    this.playerList = [...this.playerList].sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    );
  }

  // Drop Event
  drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.playerList, event.previousIndex, event.currentIndex);
  }

  // Stat Value, Per Game For Volume Stats When Toggled
  value(player: SkillPlayer, stat: SkillStat): number {
    const raw = this.rawValue(player, stat);
    return this.perGame && stat.kind === 'volume' && player.games ? raw / player.games : raw;
  }

  rawValue(player: SkillPlayer, stat: SkillStat): number {
    switch (stat.key) {
      case 'fantasy':
        return fantasyPoints(player.stats.fantasyStd, player.stats.receptions, this.fantasyScoring);
      case 'oline':
        return gradesForTeam(player.teamLogo).oline;
      // Teams without a graded QB yet count as average
      case 'qbPlay':
        return this.teamQbPlay.get(player.teamLogo) ?? 6;
      default:
        return player.stats[stat.key];
    }
  }

  isShown(stat: SkillStat): boolean {
    return this.showUnused || !!this.weights[stat.key];
  }

  format(player: SkillPlayer, stat: SkillStat): string {
    const value = this.value(player, stat);
    const perGameVolume = this.perGame && stat.kind === 'volume';
    switch (stat.format) {
      case 'grade':
        return this.grade(value);
      case 'record': {
        const { wins, losses, ties } = player.stats;
        return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      }
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
    const value = this.value(player, stat);
    return `hsl(${Math.round((value / 12) * 120)}, 100%, ${Math.round(50 + (1 - value / 12) * 16)}%)`;
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
