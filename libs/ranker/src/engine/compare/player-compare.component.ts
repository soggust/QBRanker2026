import { Component, DoCheck, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { SPORT } from '@sport/sport';
import { rankPct, rankTone } from '@ranker/core/format';
import { percentileText } from '@ranker/engine/player-card/hover-text';
import { COMPARE_MAX, CompareTab, PlayerCompare } from './player-compare';
import { GameViewService } from '../game-view/game-view.service';

// The compare view: the player card's board with a tape per side across the top (team card, season, rank,
// archetype; the season switchable, the side removable) and a slot to add one by name; then its tabs:
// Overview (what each one has over the rest, the skills on one radar and as bars, the edges, how alike),
// Stats (the grid's columns side by side) and Career (the arcs). In the search, the arrows move through
// the hits and Enter picks one; Escape clears the search, then closes the view.
@Component({
  selector: 'player-compare',
  templateUrl: './player-compare.component.html',
  // (its look is global, kept to its element: styles/components/compare.scss)
  standalone: false,
})
export class PlayerCompareComponent implements DoCheck {
  @Input({ required: true }) compare!: PlayerCompare;
  // (the share button: the grid shares the link, its toast under the button)
  @Input() share?: (button: HTMLElement) => void;

  @ViewChild('search') searchBox?: ElementRef<HTMLInputElement>;

  constructor(
    readonly games: GameViewService,
    private readonly el: ElementRef<HTMLElement>,
  ) {}

  readonly max = COMPARE_MAX;
  readonly rankTone = rankTone;
  // ("92nd percentile", the card's words)
  readonly percentileText = percentileText;
  readonly rankPct = rankPct;
  readonly seasonText = SPORT.seasonText;
  readonly careerOnly = !!SPORT.careerOnly;
  // (a career-only sport has no seasons to chart)
  readonly tabs: { id: CompareTab; title: string }[] = [
    { id: 'overview', title: 'Overview' },
    { id: 'stats', title: 'Stats' },
    ...(this.careerOnly ? [] : [{ id: 'career' as const, title: 'Career' }]),
  ];

  // A percentile as the bars and hovers say it ("88")
  pct(p: number | null): string {
    return p === null ? '-' : String(Math.round(p * 100));
  }

  // Opened empty, or with just one (from a card): straight into the search box (after the dialog takes the
  // focus: a11y.directives.ts)
  private wasOpen = false;
  ngDoCheck(): void {
    const opened = this.compare.open && !this.wasOpen;
    this.wasOpen = this.compare.open;
    if (opened && this.compare.sides.length + this.compare.loading < 2) setTimeout(() => this.searchBox?.nativeElement.focus(), 30);
  }

  // The search box's keys: Enter picks the hit lit, the arrows move it (round the ends), kept in view
  searchKey(event: KeyboardEvent): void {
    const { compare } = this;
    const n = compare.hits.length;
    if (event.key === 'Enter') {
      if (n) compare.pick(compare.hits[compare.active]);
    } else if (n && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      compare.active = (compare.active + (event.key === 'ArrowDown' ? 1 : n - 1)) % n;
      setTimeout(() => this.el.nativeElement.querySelector('.tape-hits .active')?.scrollIntoView({ block: 'nearest' }));
    } else return;
    event.preventDefault();
  }

  @HostListener('document:keydown', ['$event'])
  keys(event: KeyboardEvent): void {
    if (!this.compare.open || this.games.game || event.key !== 'Escape') return;
    if (this.compare.query) this.compare.search('');
    else this.compare.close();
    event.preventDefault();
  }
}
