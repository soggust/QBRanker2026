import { ChangeDetectorRef, Component, DoCheck, ElementRef, HostListener, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { SPORT } from '@sport/sport';
import { rankTone } from '@ranker/core/format';
import { percentileText } from '@ranker/engine/player-card/hover-text';
import { COMPARE_MAX, CompareHit, CompareTab, PlayerCompare } from './player-compare';
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
export class PlayerCompareComponent implements DoCheck, OnDestroy {
  @Input({ required: true }) compare!: PlayerCompare;
  // (the share button: the grid shares the link, its toast under the button)
  @Input() share?: (button: HTMLElement) => void;

  @ViewChild('search') searchBox?: ElementRef<HTMLInputElement>;

  // The career arcs' box, measured: they're drawn at the width they're shown at, so their labels stay the
  // card's size (a ResizeObserver runs outside Angular's zone: back in for the redraw)
  private arcsObserver?: ResizeObserver;
  @ViewChild('arcBox') set arcBox(ref: ElementRef<HTMLElement> | undefined) {
    this.arcsObserver?.disconnect();
    if (!ref || typeof ResizeObserver === 'undefined') return;
    this.arcsObserver = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) this.zone.run(() => this.compare.setArcWidth(width));
    });
    this.arcsObserver.observe(ref.nativeElement);
  }

  constructor(
    readonly games: GameViewService,
    private readonly el: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnDestroy(): void {
    this.arcsObserver?.disconnect();
  }

  // On a phone the sides are chips in a row, one opened at a time into a sheet over the board (its color,
  // or 'add' for the search; null: none). Wider screens show every tape and ignore it
  sheet: string | null = null;
  private readonly phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 600px)') : null;

  toggle(sheet: string): void {
    this.sheet = this.sheet === sheet ? null : sheet;
    if (this.sheet !== 'add') return;
    // (shown now, focused in the same tap, so a phone's keyboard comes up)
    this.cdr.detectChanges();
    this.searchBox?.nativeElement.focus();
  }

  // A hit picked: added, the search's sheet put away
  pick(hit: CompareHit): void {
    if (this.sheet === 'add') this.sheet = null;
    this.compare.pick(hit);
  }

  // A side removed (its sheet with it)
  remove(i: number): void {
    if (this.sheet === this.compare.sides[i]?.color) this.sheet = null;
    this.compare.remove(i);
  }

  // A tap outside the chips and the sheet puts the sheet away (a season's picker opens in an overlay: not
  // outside)
  @HostListener('document:click', ['$event'])
  outside(event: MouseEvent): void {
    if (this.sheet === null) return;
    const target = event.target as Element | null;
    if (target?.isConnected && !target.closest('.cmp-chips, .tapes, .cdk-overlay-container')) this.sheet = null;
  }

  readonly max = COMPARE_MAX;
  readonly rankTone = rankTone;
  // ("92nd percentile", the card's words)
  readonly percentileText = percentileText;
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
    if (opened) this.sheet = null;
    // (on a phone, with one coming from a card: the search's sheet open under its chip)
    if (opened && this.compare.sides.length + this.compare.loading < 2) {
      if (this.compare.sides.length + this.compare.loading === 1) this.sheet = 'add';
      setTimeout(() => this.searchBox?.nativeElement.focus(), 30);
    }
  }

  // The search box's keys: Enter picks the hit lit, the arrows move it (round the ends), kept in view
  searchKey(event: KeyboardEvent): void {
    const { compare } = this;
    const n = compare.hits.length;
    if (event.key === 'Enter') {
      if (n) this.pick(compare.hits[compare.active]);
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
    // (a phone's sheet put away first)
    else if (this.sheet !== null && this.phone?.matches) this.sheet = null;
    else this.compare.close();
    event.preventDefault();
  }
}
