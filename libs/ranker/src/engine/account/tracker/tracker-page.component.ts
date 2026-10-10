import { Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, effect, inject, signal } from '@angular/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { SPORT } from '@sport/sport';
import { SITE_SPORTS } from '@ranker/core/sports';
import { rankTone } from '@ranker/core/format';
import { CURRENT_SEASON } from '@ranker/engine/data';
import { scoreText } from '@ranker/engine/skill-rankings/rank-why';
import { gameLogView } from '@ranker/engine/player-card/game-log-view';
import { COMPARE_COLORS, CompareSide } from '@ranker/engine/compare/player-compare';
import { AccountService } from '../account.service';
import { Visibility } from '../account-helpers';
import { TrackerStore } from './tracker.store';
import {
  Pin,
  PinSnapshot,
  TrackRow,
  TrackSide,
  TrackView,
  TrendChart,
  addPoint,
  cleanTitle,
  compareHref,
  dayMs,
  keyStats,
  lastSeen,
  moved,
  pointOf,
  signed,
  sinceText,
  textNumber,
  trackView,
  trendChart,
} from './tracker-helpers';

// A side as the card shows it: the compare view's look (its team's color, logo, face) when it's been read
// now, else what the pin kept
interface CardSide {
  key: string;
  name: string;
  label: string;
  // (the table's column: the name, or with the season where two share it)
  head: string;
  meta: string;
  color: string;
  badge: string;
  logo: string | null;
  whiteLogo: boolean;
  photo: string | null;
  track: TrackSide;
  // (now's rank and its tone; the pin's)
  rank: number | null;
  of: number | null;
  tone: string;
  live: boolean;
  side: CompareSide | null;
}

// A side's games this season: a bar a game of the log's own chart (total yards, a team's margin), the
// games since the pin lit
interface LogStrip {
  key: string;
  label: string;
  bars: { h: number; neg: boolean; after: boolean; title: string }[];
  // (where the pin falls among the games: a fraction of the strip; null: before them all or after)
  pinAt: number | null;
  diverging: boolean;
}

interface PinCard {
  pin: Pin;
  // (the sport's own pins are read now; another sport's (the All view) show what they kept: the day its
  // owner last looked at it in its own sport, `seen`, null: as pinned)
  here: boolean;
  seen: number | null;
  sportLabel: string;
  // (unfolded: the sides' tapes, the chart, the numbers; folded, its strip and the sides at a glance)
  open: boolean;
  loading: boolean;
  error: string | null;
  now: PinSnapshot | null;
  sides: CardSide[];
  view: TrackView;
  chart: TrendChart | null;
  allStats: boolean;
  logs: 'off' | 'loading' | 'ready' | 'none';
  strips: LogStrip[];
  // (renaming: its draft; unpinning: asked once, then done)
  draft: string | null;
  confirm: boolean;
  busy: boolean;
}

// (#tracker/<uid>: whose)
function uidOf(hash: string): string | null {
  try {
    return decodeURIComponent(hash.replace(/^#tracker\/?/, '')) || null;
  } catch {
    return null;
  }
}

// Before All stats: this many columns (the ones moved most since: keyStats) and skills (the ones every side has)
const KEY_STATS = 6;
const KEY_SKILLS = 8;
const CHART_HEIGHT = 156;
// (the All pill's choice, remembered on this browser: every sport's apps share it)
const ALL_KEY = 'trackerAll';
const readAll = (): boolean => {
  try {
    return localStorage.getItem(ALL_KEY) === '1';
  } catch {
    return false;
  }
};
const sportName = (id: string): string => SITE_SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();

// The Tracker (#tracker, and #tracker/<uid> for someone else's): every comparison pinned from the compare
// view, a scoreboard card each: the sides with their faces in their colors, where each stands now against
// where it stood when pinned (the rank, the score, the skills, the columns, each change colored better or
// worse), the rank since on a step chart (a point each day it's been looked at), and the games since. The
// owner opens, renames, re-pins, reorders (a drag, or the menu) and unpins; anyone else, only looks.
@Component({
  selector: 'tracker-page',
  templateUrl: './tracker-page.component.html',
  styleUrls: ['../../../styles/components/tracker.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class TrackerPageComponent implements OnDestroy {
  readonly account = inject(AccountService);
  private readonly store = inject(TrackerStore);
  private readonly zone = inject(NgZone);

  readonly sport = SPORT.id;
  readonly sportLabel = SITE_SPORTS.find((s) => s.id === SPORT.id)?.label ?? SPORT.id.toUpperCase();
  readonly rankTone = rankTone;
  readonly scoreText = scoreText;
  readonly signed = signed;
  readonly sinceText = sinceText;

  // Whose tracker: #tracker/<uid> someone's (read only), else the signed-in user's
  private readonly hashUid = signal(uidOf(location.hash));
  get viewing(): string | null {
    return this.hashUid();
  }

  @HostListener('window:hashchange')
  onHash(): void {
    if (location.hash.startsWith('#tracker')) this.hashUid.set(uidOf(location.hash));
  }
  // (loading; 'hidden': theirs isn't shared with this reader; 'missing': no such user)
  state: 'wait' | 'ready' | 'hidden' | 'missing' | 'error' = 'wait';
  owner: { uid: string; name: string; photo: { kind: string; url: string } | null; username: string } | null = null;
  cards: PinCard[] = [];
  // Every sport's pins, counted (the pills: the others open their own sport's tracker), and All: every sport's
  // here, this sport's measured now, the others as last seen
  sportCounts: { id: string; label: string; count: number }[] = [];
  all = readAll();
  private pins: Pin[] = [];
  chartWidth = 640;
  toast = '';
  private toastTimer?: ReturnType<typeof setTimeout>;
  private loadedFor: string | null = null;
  private observer?: ResizeObserver;

  @ViewChild('list') set list(ref: ElementRef<HTMLElement> | undefined) {
    this.observer?.disconnect();
    if (!ref || typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(([entry]) => {
      // (the chart is as wide as a card's body, less its padding)
      const width = Math.round(entry.contentRect.width - 28);
      if (width > 0 && Math.abs(width - this.chartWidth) > 4) this.zone.run(() => this.resize(width));
    });
    this.observer.observe(ref.nativeElement);
  }

  constructor() {
    void this.account.start().catch(() => undefined);
    // (signed in or out, or someone else's: loaded once the sign-in's known, again when it changes)
    effect(() => {
      if (!this.account.ready()) return;
      const user = this.account.user();
      const uid = this.hashUid() ?? user?.uid ?? null;
      const key = `${uid}|${user?.uid ?? ''}`;
      if (key === this.loadedFor) return;
      this.loadedFor = key;
      if (!uid) {
        this.owner = null;
        this.state = 'ready';
        this.cards = [];
        return;
      }
      void this.load(uid);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    clearTimeout(this.toastTimer);
  }

  get mine(): boolean {
    const user = this.account.user();
    return !!user && (!this.viewing || this.viewing === user.uid);
  }

  get signedOut(): boolean {
    return this.account.ready() && !this.viewing && !this.account.user();
  }

  get visibility(): Visibility {
    return this.account.profile()?.visibility?.tracker ?? 'friends';
  }

  // (the board's tiles: the pins here, and the sides up or down since)
  get tally(): { pins: number; up: number; down: number } {
    const sides = this.cards.flatMap((c) => c.sides.map((s) => s.track.moved ?? 0));
    return { pins: this.cards.length, up: sides.filter((m) => m > 0).length, down: sides.filter((m) => m < 0).length };
  }

  // ---------------------------------------------------------------------------
  // Loading: the pins, then each one read now (this sport's), and today's point kept on the owner's
  // ---------------------------------------------------------------------------
  private async load(uid: string): Promise<void> {
    this.state = 'wait';
    try {
      if (this.viewing) {
        const profile = await this.store.profileOf(uid);
        if (!profile) {
          this.state = 'missing';
          return;
        }
        this.owner = { uid, name: profile.displayName, photo: profile.photo, username: profile.username };
      } else {
        this.owner = null;
      }
      const pins = await this.store.list(uid);
      const counts = new Map<string, number>();
      for (const p of pins) counts.set(p.sport, (counts.get(p.sport) ?? 0) + 1);
      this.sportCounts = SITE_SPORTS.filter((s) => counts.has(s.id) || s.id === SPORT.id).map((s) => ({ id: s.id, label: s.label, count: counts.get(s.id) ?? 0 }));
      this.pins = pins;
      this.cards = [];
      this.showCards();
      this.state = 'ready';
      await Promise.all(this.cards.filter((card) => card.here).map((card) => this.readNow(card)));
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // (not shared with this reader: said on the page, not an error)
      if (code !== 'permission-denied') console.error('Tracker', error);
      this.state = code === 'permission-denied' ? 'hidden' : 'error';
    }
  }

  // The cards shown: this sport's pins, or with All every sport's (a card already built kept as it is)
  private showCards(): void {
    const built = new Map(this.cards.map((c) => [c.pin.id, c]));
    this.cards = this.pins.filter((p) => this.all || p.sport === SPORT.id).map((pin) => built.get(pin.id) ?? this.blankCard(pin));
  }

  // (the All pill: every sport's pins on this page, or this sport's alone)
  setAll(on: boolean): void {
    if (on === this.all) return;
    this.all = on;
    try {
      if (on) localStorage.setItem(ALL_KEY, '1');
      else localStorage.removeItem(ALL_KEY);
    } catch {
      // (storage off: the choice lasts the visit)
    }
    this.showCards();
  }

  get allCount(): number {
    return this.pins.length;
  }

  private blankCard(pin: Pin): PinCard {
    const here = pin.sport === SPORT.id;
    // (another sport's: as its owner last saw it there, else as pinned)
    const seen = here ? null : lastSeen(pin.baseline, pin.history);
    const card: PinCard = {
      pin,
      here,
      seen: seen?.at ?? null,
      sportLabel: sportName(pin.sport),
      open: false,
      loading: here,
      error: null,
      now: null,
      sides: [],
      view: trackView(pin.baseline, here ? null : (seen ?? pin.baseline)),
      chart: null,
      allStats: false,
      logs: 'off',
      strips: [],
      draft: null,
      confirm: false,
      busy: false,
    };
    this.build(card, []);
    return card;
  }

  private async readNow(card: PinCard): Promise<void> {
    card.loading = true;
    try {
      const read = await this.store.reader.read(card.pin.spec);
      if (!read) {
        card.error = "Couldn't find these seasons any more";
        return;
      }
      card.now = read.snapshot;
      card.view = trackView(card.pin.baseline, read.snapshot);
      this.build(card, read.sides);
      // (the owner's: today's point kept, when it's moved since the last one)
      if (this.mine) {
        const history = addPoint(card.pin.history, card.pin.baseline, pointOf(read.snapshot));
        if (history) {
          card.pin.history = history;
          this.chartOf(card);
          this.store.record(this.account.user()!.uid, card.pin.id, history).catch((error) => console.error('Tracker', error));
        }
      }
    } catch (error) {
      console.error('Tracker', error);
      card.error = "Couldn't read this comparison now";
    } finally {
      card.loading = false;
    }
  }

  // The card's sides (now's looks, else the pin's), and its chart
  private build(card: PinCard, live: CompareSide[]): void {
    card.sides = card.view.sides.map((track, i): CardSide => {
      const side = live.find((s) => s.key === track.key) ?? null;
      const snap = track.now ?? track.then!;
      const season = snap.season;
      const seasonText = SPORT.careerOnly ? 'Career' : season === CURRENT_SEASON ? `${SPORT.seasonText(season)} season` : SPORT.seasonText(season);
      const rank = track.now?.rank ?? null;
      return {
        key: track.key,
        name: snap.name,
        label: side?.label ?? snap.name,
        head: snap.name,
        meta: [snap.tab, side?.teamName, seasonText].filter(Boolean).join(' · '),
        color: side?.color ?? COMPARE_COLORS[i % COMPARE_COLORS.length],
        badge: side?.badge ?? '#333',
        logo: side?.logo ?? null,
        whiteLogo: !!side?.whiteLogo,
        photo: side?.photo ?? null,
        track,
        rank,
        of: track.now?.of ?? null,
        tone: rankTone(track.now?.pct ?? track.then?.pct ?? null),
        live: season === CURRENT_SEASON,
        side,
      };
    });
    const twice = (name: string) => card.sides.filter((s) => s.name === name).length > 1;
    for (const s of card.sides) if (twice(s.name)) s.head = `${s.name} ’${String(s.track.now?.season ?? s.track.then?.season ?? '').slice(-2)}`;
    this.chartOf(card);
  }

  private chartOf(card: PinCard): void {
    card.chart = card.sides.length ? trendChart(card.pin.baseline, card.pin.history, card.now, card.sides.map((s) => ({ key: s.key, name: s.name, color: s.color })), this.chartWidth, CHART_HEIGHT) : null;
  }

  private resize(width: number): void {
    this.chartWidth = Math.max(240, width);
    for (const card of this.cards) this.chartOf(card);
  }

  // ---------------------------------------------------------------------------
  // What a card shows
  // ---------------------------------------------------------------------------
  // The stat rows shown: the key ones (the first group's), or every one, group by group
  statGroups(card: PinCard): { title: string; rows: TrackRow[] }[] {
    const rows = card.view.stats.filter((r) => r.cells.some((c) => c.text !== '-' || c.then !== '-'));
    const groups: { title: string; rows: TrackRow[] }[] = [];
    for (const row of rows) {
      let group = groups.find((g) => g.title === row.group);
      if (!group) groups.push((group = { title: row.group, rows: [] }));
      group.rows.push(row);
    }
    if (card.allStats) return groups;
    const key = keyStats(rows, KEY_STATS);
    return groups.map((g) => ({ title: g.title, rows: g.rows.filter((r) => key.includes(r)) })).filter((g) => g.rows.length);
  }

  statCount(card: PinCard): number {
    return card.view.stats.filter((r) => r.cells.some((c) => c.text !== '-' || c.then !== '-')).length;
  }

  // (the skills: the ones every side has first, the rest (another position's) with All stats)
  skills(card: PinCard): TrackRow[] {
    const any = card.view.skills.filter((r) => r.cells.some((c) => c.text !== '-'));
    if (card.allStats) return any;
    const shared = any.filter((r) => r.cells.every((c) => c.text !== '-'));
    return (shared.length ? shared : any).slice(0, KEY_SKILLS);
  }

  // (more to show under All stats: columns or skills held back)
  hasMore(card: PinCard): boolean {
    const shown = this.statGroups(card).reduce((n, g) => n + g.rows.length, 0) + this.skills(card).length;
    return card.allStats || shown < this.statCount(card) + card.view.skills.filter((r) => r.cells.some((c) => c.text !== '-')).length;
  }

  // "#4 when pinned" and the move since, for a side's tape (another sport's: since the pin, as last seen)
  moveText(side: CardSide, card?: PinCard): string {
    if (card && !card.here && card.seen === null) return 'As pinned';
    const m = side.track.moved;
    if (m === null) return side.track.now ? 'New since the pin' : 'Not found now';
    if (m === 0) return 'No change';
    return `${m > 0 ? 'Up' : 'Down'} ${Math.abs(m)}`;
  }

  cellTitle(row: TrackRow, i: number, card: PinCard): string {
    const c = row.cells[i];
    const who = card.sides[i]?.name ?? '';
    return `${who}, ${row.name}: ${c.text} now, ${c.then} when pinned${c.delta ? ` (${c.delta})` : ''}`;
  }

  pinnedDay(card: PinCard): string {
    return new Date(card.pin.baseline.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // (the full comparison: the sport's page with the pin's link)
  openHref(card: PinCard): string {
    return compareHref(card.pin.sport, card.pin.spec);
  }

  // (another sport's card: its own sport's tracker, where it's measured now)
  trackerHref(card: PinCard): string {
    return `/${card.pin.sport}/#tracker`;
  }

  seenText(card: PinCard): string {
    return card.seen === null ? 'Not looked at since it was pinned' : `Last seen ${sinceText(card.seen)}`;
  }

  awayText(card: PinCard): string {
    return card.seen === null
      ? `As pinned: not opened in ${card.sportLabel} since.`
      : `Ranks as of ${sinceText(card.seen)}, the last time it was opened in ${card.sportLabel}.`;
  }

  sportHref(id: string): string {
    return `/${id}/#tracker${this.viewing ? '/' + encodeURIComponent(this.viewing) : ''}`;
  }

  // ---------------------------------------------------------------------------
  // The owner's actions
  // ---------------------------------------------------------------------------
  private uid(): string | null {
    return this.mine ? this.account.user()!.uid : null;
  }

  private say(text: string): void {
    this.toast = text;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 2600);
  }

  // (its name an input, focused with the text selected once the menu's gone)
  startRename(card: PinCard): void {
    card.draft = card.pin.title;
    setTimeout(() => document.querySelector<HTMLInputElement>(`#pin-title-${card.pin.id}`)?.focus(), 60);
  }

  async saveRename(card: PinCard): Promise<void> {
    const uid = this.uid();
    const title = cleanTitle(card.draft ?? '');
    card.draft = null;
    if (!uid || !title || title === card.pin.title) return;
    const was = card.pin.title;
    card.pin.title = title;
    try {
      await this.store.rename(uid, card.pin.id, title);
    } catch (error) {
      console.error('Tracker', error);
      card.pin.title = was;
      this.say("Couldn't rename it");
    }
  }

  renameKey(event: KeyboardEvent, card: PinCard): void {
    if (event.key === 'Enter') void this.saveRename(card);
    else if (event.key === 'Escape') {
      card.draft = null;
      event.stopPropagation();
    }
  }

  // A fresh start: where they stand now becomes the pin
  async repin(card: PinCard): Promise<void> {
    const uid = this.uid();
    if (!uid || !card.now || card.busy) return;
    card.busy = true;
    try {
      const baseline = { ...card.now, at: Date.now() };
      await this.store.repin(uid, card.pin.id, baseline);
      card.pin.baseline = baseline;
      card.pin.history = [];
      card.view = trackView(baseline, card.now);
      this.build(card, card.sides.map((s) => s.side).filter((s): s is CompareSide => !!s));
      this.say('Re-pinned: changes count from now');
    } catch (error) {
      console.error('Tracker', error);
      this.say("Couldn't re-pin it");
    } finally {
      card.busy = false;
    }
  }

  async unpin(card: PinCard): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    if (!card.confirm) {
      card.confirm = true;
      setTimeout(() => (card.confirm = false), 4000);
      return;
    }
    card.busy = true;
    try {
      await this.store.remove(uid, card.pin.id);
      this.cards = this.cards.filter((c) => c !== card);
      this.pins = this.pins.filter((p) => p !== card.pin);
      const count = this.sportCounts.find((s) => s.id === card.pin.sport);
      if (count) count.count--;
      this.say('Unpinned');
    } catch (error) {
      console.error('Tracker', error);
      card.busy = false;
      this.say("Couldn't unpin it");
    }
  }

  drop(event: CdkDragDrop<PinCard[]>): void {
    this.move(event.previousIndex, event.currentIndex);
  }

  // (a drag, or the menu's Move up / Move down)
  move(from: number, to: number): void {
    const uid = this.uid();
    if (!uid || from === to || to < 0 || to >= this.cards.length) return;
    this.cards = moved(this.cards, from, to);
    this.store.reorder(
      uid,
      this.cards.map((c) => c.pin),
    ).then(() => {
      // (every pin in its new order, for the All pill's next turn)
      this.pins = [...this.pins].sort((a, b) => a.order - b.order);
    }).catch((error) => {
      console.error('Tracker', error);
      this.say("Couldn't save the order");
    });
  }

  async setVisibility(value: Visibility): Promise<void> {
    try {
      await this.account.setVisibility('tracker', value);
    } catch (error) {
      console.error('Tracker', error);
      this.say("Couldn't change who sees it");
    }
  }

  // The tracker's own link, for the ones it's shared with
  copyLink(): void {
    const uid = this.account.user()?.uid;
    if (!uid) return;
    const url = `${location.origin}/${SPORT.id}/#tracker/${encodeURIComponent(uid)}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => this.say('Link copied'))
      .catch(() => this.say(url));
  }

  // ---------------------------------------------------------------------------
  // Game by game: each side's log this season (the card's Game Log, read live), the games since the pin lit
  // ---------------------------------------------------------------------------
  hasLogs(card: PinCard): boolean {
    return !!SPORT.gameLog && card.sides.some((s) => s.live && s.side && SPORT.gameLog!.has(s.side.player, s.side.position, s.side.season));
  }

  async toggleLogs(card: PinCard): Promise<void> {
    if (card.logs !== 'off') {
      card.logs = 'off';
      return;
    }
    card.logs = 'loading';
    const pinned = card.pin.baseline.at;
    const reads = await Promise.all(
      card.sides.map(async (s) => {
        const side = s.side;
        if (!s.live || !side || !SPORT.gameLog?.has(side.player, side.position, side.season)) return null;
        try {
          const log = await SPORT.gameLog.load(side.player, side.position, side.season);
          const chart = gameLogView(log).chart;
          if (!chart) return null;
          const games = [...log.rows].reverse();
          const values = chart.bars.map((b) => textNumber(b.text.replace('+', ''))?.n ?? 0);
          return { s, chart, games, values };
        } catch {
          return null;
        }
      }),
    );
    // (one scale for the sides charting the same thing, so their bars compare)
    const tops = new Map<string, number>();
    for (const r of reads) if (r) tops.set(r.chart.label, Math.max(tops.get(r.chart.label) ?? 1, ...r.values.map(Math.abs)));
    card.strips = reads.flatMap((r) => {
      if (!r) return [];
      const top = tops.get(r.chart.label) || 1;
      const times = r.games.map((g) => (g.when ? new Date(g.when.length <= 10 ? dayMs(g.when) : g.when).getTime() : NaN));
      const firstAfter = times.findIndex((t) => t > pinned);
      return [
        {
          key: r.s.key,
          label: r.chart.label,
          diverging: r.chart.diverging,
          pinAt: firstAfter <= 0 ? (firstAfter === 0 ? 0 : null) : firstAfter / times.length,
          bars: r.chart.bars.map((b, i) => ({
            h: Math.round((Math.abs(r.values[i]) / top) * 100),
            neg: b.negative,
            after: times[i] > pinned,
            title: b.title,
          })),
        },
      ];
    });
    card.logs = card.strips.length ? 'ready' : 'none';
  }

  stripSide(card: PinCard, key: string): CardSide | undefined {
    return card.sides.find((s) => s.key === key);
  }
}
