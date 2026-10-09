import { Component, DoCheck, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { SPORT } from '@sport/sport';
import { rankPct, rankTone } from '@ranker/core/format';
import { COMPARE_MAX, CompareSide, PlayerCompare } from './player-compare';
import { GameViewService } from '../game-view/game-view.service';

// The compare view: the player card's board with a tape per side across the top (team card, season, rank,
// archetype; the season switchable, the side removable) and a slot to add one by name, then its tabs:
// Overview (the skills on one radar and as bars, the edges, how alike), Stats (the grid's columns side by
// side) and Career (the arcs). Escape clears the search, then closes it.
@Component({
  selector: 'player-compare',
  templateUrl: './player-compare.component.html',
  // (its look is global, kept to its element: styles/_cards.scss)
  standalone: false,
})
export class PlayerCompareComponent implements DoCheck {
  @Input({ required: true }) compare!: PlayerCompare;
  // (a side's name: their card, that season)
  @Input() openCard: (side: CompareSide) => void = () => undefined;
  // (a card opened over it has the keys)
  @Input() cardOpen: () => boolean = () => false;

  @ViewChild('search') searchBox?: ElementRef<HTMLInputElement>;

  constructor(readonly games: GameViewService) {}

  readonly max = COMPARE_MAX;
  readonly rankTone = rankTone;
  readonly rankPct = rankPct;
  readonly careerOnly = !!SPORT.careerOnly;
  // (a career-only sport has no seasons to chart)
  readonly tabs: { id: PlayerCompare['tab']; title: string }[] = [
    { id: 'overview', title: 'Overview' },
    { id: 'stats', title: 'Stats' },
    ...(this.careerOnly ? [] : [{ id: 'career' as const, title: 'Career' }]),
  ];

  seasonText(season: number): string {
    return SPORT.seasonText(season);
  }

  // A percentile as the bars and hovers say it ("88")
  pct(p: number | null): string {
    return p === null ? '-' : String(Math.round(p * 100));
  }

  // A side as the legends and hovers name it ("Jamaal Charles ’13")
  label(side: CompareSide): string {
    return side.short ? `${side.name} ${side.short}` : side.name;
  }

  // Opened empty, or with just one (from a card): straight into the search box (after the dialog takes the
  // focus: a11y.directives.ts)
  private wasOpen = false;
  ngDoCheck(): void {
    const opened = this.compare.open && !this.wasOpen;
    this.wasOpen = this.compare.open;
    if (opened && this.compare.sides.length + this.compare.loading < 2) setTimeout(() => this.searchBox?.nativeElement.focus(), 30);
  }

  @HostListener('document:keydown', ['$event'])
  keys(event: KeyboardEvent): void {
    if (!this.compare.open || this.games.game || this.cardOpen() || event.key !== 'Escape') return;
    if (this.compare.query) this.compare.search('');
    else this.compare.close();
    event.preventDefault();
  }
}
