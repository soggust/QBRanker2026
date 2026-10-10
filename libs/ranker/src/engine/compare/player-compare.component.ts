import { AfterViewChecked, ChangeDetectorRef, Component, DoCheck, ElementRef, HostListener, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { SPORT } from '@sport/sport';
import { rankTone } from '@ranker/core/format';
import { percentileText } from '@ranker/engine/player-card/hover-text';
import { COMPARE_MAX, CompareHit, CompareTab, PlayerCompare } from './player-compare';
import { GameViewService } from '../game-view/game-view.service';
import { ARC_DRAW_MS, arcDraw } from './arc-draw';
import { AccountService } from '../account/account.service';
import { TrackerStore } from '../account/tracker/tracker.store';

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
export class PlayerCompareComponent implements DoCheck, AfterViewChecked, OnDestroy {
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
    readonly account: AccountService,
    private readonly tracker: TrackerStore,
  ) {}

  // Pinned to the Tracker (signed in: the comparison as it is, its snapshot the baseline; signed out: the
  // sign-in first), a note under the hero for a moment, with the way to the Tracker
  pinning = false;
  pinNote: { text: string; link: boolean } | null = null;
  private pinTimer?: ReturnType<typeof setTimeout>;

  get pinned(): boolean {
    const { sides, tab } = this.compare;
    return sides.length > 0 && this.tracker.pinnedSpecs().has(this.tracker.specFor(sides, tab));
  }

  async pin(): Promise<void> {
    if (!this.account.signedIn()) {
      this.account.openLogin();
      return;
    }
    if (this.pinning || !this.compare.sides.length) return;
    this.pinning = true;
    try {
      await this.tracker.pinCompare(this.compare.sides, this.compare.tab);
      this.notePin({ text: 'Pinned to Track Players', link: true });
    } catch (error) {
      console.error('Pin', error);
      const full = (error as { code?: string }).code === 'full';
      this.notePin({ text: full ? 'Track Players is full: unpin one first' : "Couldn't pin it", link: full });
    } finally {
      this.pinning = false;
    }
  }

  private notePin(note: { text: string; link: boolean }): void {
    this.pinNote = note;
    clearTimeout(this.pinTimer);
    this.pinTimer = setTimeout(() => (this.pinNote = null), 4200);
  }

  ngOnDestroy(): void {
    clearTimeout(this.pinTimer);
    this.arcsObserver?.disconnect();
    this.stopArcs();
  }

  // ---------------------------------------------------------------------------
  // The career arcs drawn in (arc-draw.ts): one sweep left to right, the lines uncovered, each dot landing
  // and each face riding its line's head as it goes; drawn again when shown, when a line's new (the bottom
  // switched, a side added or removed) and on Replay. None for anyone who's asked their system for less
  // motion: everything at rest, no Replay
  // ---------------------------------------------------------------------------
  readonly motion = typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
  @ViewChild('arcSvg') private arcSvg?: ElementRef<SVGSVGElement>;
  @ViewChild('arcReplay') private arcReplay?: ElementRef<HTMLElement>;
  // (what was drawn last: the board, its lines, its width)
  private drawn: { svg: SVGSVGElement; keys: string; width: number } | null = null;
  private drawing: Animation[] = [];

  ngAfterViewChecked(): void {
    const svg = this.arcSvg?.nativeElement;
    const arcs = this.compare.arcs;
    if (!svg || !arcs) {
      if (this.drawn) this.stopArcs();
      this.drawn = null;
      return;
    }
    const keys = arcs.lines.map((l) => l.key).join(' ');
    if (this.drawn?.svg !== svg || this.drawn.keys !== keys) {
      this.drawn = { svg, keys, width: arcs.width };
      this.drawArcs();
    } else if (this.drawn.width !== arcs.width) {
      // (resized while drawing (the first measure, a phone turned): drawn again at the new size from as
      // far as it had got)
      this.drawn.width = arcs.width;
      const at = this.drawing[0]?.currentTime;
      if (at == null || this.drawing[0].playState === 'finished') return;
      this.drawArcs();
      for (const a of this.drawing) a.currentTime = at;
    }
  }

  replayArcs(): void {
    this.drawArcs();
  }

  private drawArcs(): void {
    this.stopArcs();
    const replay = this.arcReplay?.nativeElement;
    replay?.classList.remove('arc-done');
    const svg = this.drawn?.svg;
    const arcs = this.compare.arcs;
    if (!this.motion || !svg || !arcs || typeof svg.animate !== 'function') return;
    const plan = arcDraw(arcs);
    const ms = ARC_DRAW_MS;
    const pop = 'cubic-bezier(0.3, 1.6, 0.5, 1)';
    this.zone.runOutsideAngular(() => {
      const run = (el: Element | null | undefined, keys: Keyframe[], options: KeyframeAnimationOptions) => {
        if (el) this.drawing.push(el.animate(keys, { fill: 'backwards', ...options }));
      };
      // (the lines: uncovered left to right, the sweep's x the clip's right edge)
      const scale = (x: number) => ({ transform: `scaleX(${x / arcs.width})` });
      run(svg.querySelector('.arc-sweep'), [scale(plan.from), scale(plan.to)], { duration: ms });
      // (each dot lands as the head reaches it)
      const dots = svg.querySelectorAll('.arc-dot');
      plan.dots.flat().forEach((at, i) => {
        run(dots[i], [{ opacity: 0, scale: 0 }, { opacity: 1, scale: 1 }], { duration: 240, delay: at * ms, easing: pop });
      });
      // (each face pops in at its line's start, rides its head, settles just past its end, tied to it then)
      const faces = svg.querySelectorAll('.arc-face');
      plan.faces.forEach((ride, i) => {
        const face = faces[i];
        const { x, y } = arcs.faces[i];
        run(face, ride.keys.map((k) => ({ offset: k.offset, translate: `${k.dx}px ${k.dy}px` })), { duration: ms });
        const origin = `${x}px ${y}px`;
        run(face, [{ opacity: 0, scale: 0.3, transformOrigin: origin }, { opacity: 1, scale: 1, transformOrigin: origin }], { duration: 300, delay: ride.start * ms, easing: pop });
        run(face?.querySelector('.arc-face-tie'), [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: ride.rest * ms });
      });
      // (drawn: the Replay shows)
      const drawing = this.drawing;
      Promise.all(drawing.map((a) => a.finished)).then(
        () => drawing === this.drawing && replay?.classList.add('arc-done'),
        () => {},
      );
    });
  }

  // (every animation stopped, everything at rest)
  private stopArcs(): void {
    for (const a of this.drawing) a.cancel();
    this.drawing = [];
  }

  // On a phone the sides are chips in a row, one opened at a time into a sheet over the board (its id,
  // or 'add' for the search; null: none). Wider screens show every tape and ignore it
  sheet: number | 'add' | null = null;
  private readonly phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 600px)') : null;

  toggle(sheet: number | 'add'): void {
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
    if (this.sheet === this.compare.sides[i]?.uid) this.sheet = null;
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
