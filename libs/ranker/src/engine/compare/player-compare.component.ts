import { Component, DoCheck, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { SPORT } from '@sport/sport';
import { rankPct, rankTone } from '@ranker/core/format';
import { COMPARE_MAX, CompareSide, PlayerCompare } from './player-compare';
import { GameViewService } from '../game-view/game-view.service';

// The compare view: the player card's board with a tape per side across its hero (team card, season,
// rank, archetype; the season switchable, the side removable) and a slot to add one by name, then its
// tabs: Overview (the skills on one radar and as bars, the edges, how alike), Stats (the grid's columns
// side by side) and Career (the arcs). Escape closes it.
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

  seasonText(season: number): string {
    return SPORT.seasonText(season);
  }

  // A percentile as the bars and hovers say it ("88")
  pct(p: number | null): string {
    return p === null ? '-' : String(Math.round(p * 100));
  }

  // A side's slot in a row of cells (its column's color, its name for the hover)
  label(side: CompareSide): string {
    return `${side.name}${side.short ? ' ' + side.short : ''}`;
  }

  // Opened empty, or with just one (from a card): straight into the search box (after the dialog takes the focus: a11y.directives.ts)
  private wasOpen = false;
  ngDoCheck(): void {
    const opened = this.compare.open && !this.wasOpen;
    this.wasOpen = this.compare.open;
    if (opened && this.compare.sides.length + this.compare.loading < 2) setTimeout(() => this.searchBox?.nativeElement.focus(), 30);
  }

  @HostListener('document:keydown', ['$event'])
  keys(event: KeyboardEvent): void {
    if (!this.compare.open || this.games.game || this.cardOpen()) return;
    if (event.key !== 'Escape') return;
    // (Escape clears a search first, then closes)
    if (this.compare.query) this.compare.search('');
    else this.compare.close();
    event.preventDefault();
  }
}
