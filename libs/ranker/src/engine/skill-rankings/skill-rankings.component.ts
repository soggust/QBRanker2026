import { Component, ElementRef, HostListener, Input, OnChanges, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  SKILL_STATS,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillStatGroup,
  SkillWeights,
  StatGroupId,
  skillGroups,
} from '@sport/positions';
import { AWARD_INFO, AwardWin, awardsFor } from '@sport/awards';
import { SPORT } from '@sport/sport';
import { extras, rowTeamNames } from '@ranker/engine/row-fields';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SportSetting, SportSettings } from '@ranker/engine/sport';
import { PositionService, RankerSettings } from '@ranker/engine/position.service';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { CURRENT_SEASON, SEASONS, SeasonPart, dataPart, dataSeason, dataVersion, isLiveSeason } from '@ranker/engine/data';
import { SKILL_UNITS, emptyIn, recentCount, statIsEmpty } from '@ranker/engine/unit-scoring';
import { StatReader } from '@ranker/engine/stat-reader';
import { settingGroups, settingOptions, settingText, settingsAt } from '@ranker/engine/setting-options';
import { CardHost, PlayerCards } from '@ranker/engine/player-card/player-cards';
import { COMPARE_MAX, PlayerCompare } from '@ranker/engine/compare/player-compare';
import { GameViewService, recentRef } from '@ranker/engine/game-view/game-view.service';
import { SeasonContext } from '@ranker/engine/player-card/card.model';
import { copyRankingsToClipboard } from '@ranker/core/clipboard';
import { RowGlide } from './row-glide';
import { TabRanker } from './tab-ranker';

// A tab's rankings: the button bar, then the grid (a row per player, best first by the sliders, or as
// dragged by hand), and the player card for a name clicked
@Component({
  selector: 'skill-rankings',
  templateUrl: './skill-rankings.component.html',
  // (the shared look: libs/ranker/src/styles/components, plus this sport's theme partial)
  styleUrls: ['../../styles/components/rankings.component.scss'],
  standalone: false,
})
export class SkillRankingsComponent implements OnChanges, CardHost {
  @ViewChild('rankingsList') rankingsList!: ElementRef<HTMLElement>;

  @Input({ required: true }) position!: SkillPosition;

  playerList: SkillPlayer[] = [];
  stats: SkillStat[] = [];
  // This position's stat groups, which are switched off (eye / header chip), and its slider weights
  groups: SkillStatGroup[] = [];
  hidden: Partial<Record<StatGroupId, boolean>> = {};
  weights: SkillWeights = {};

  // The year dropdown: every season we have, newest first
  readonly seasons = SEASONS;
  season = CURRENT_SEASON;
  seasonPart: SeasonPart = dataPart;
  seasonLoading = false;

  readonly sport = SPORT;
  readonly awardInfo = AWARD_INFO;
  readonly footerSettings = settingsAt('footer');
  readonly settingOptions = settingOptions;
  readonly settingGroups = settingGroups;

  // Bumped when the sport's values from other tabs change (the column averages are worked out again)
  private dataVersion = 0;

  // The table's values: this season's rows, ranked as the list shows
  readonly reader = new StatReader(this.tableSource());

  // How the list is made (the filters, the sliders, the columns), from the table's tab as it is now (one
  // object, read through: the ranker asks for it for every cell)
  private readonly ranker: TabRanker;
  private readonly tabState = ((table: SkillRankingsComponent) => ({
    get position() {
      return table.position;
    },
    get stats() {
      return table.stats;
    },
    get groups() {
      return table.groups;
    },
    get hidden() {
      return table.hidden;
    },
    get weights() {
      return table.weights;
    },
  }))(this);

  // The player card (a name clicked)
  readonly cards: PlayerCards;

  // The compare view, and the rows picked for it (a click on a row, off its name and links), in the
  // order they were picked
  readonly compare: PlayerCompare;
  picked: string[] = [];
  private dragEnded = 0;

  private readonly glide = new RowGlide();

  // "List copied" under the copy button
  toastVisible = false;
  toastText = '';
  toastAt = { top: 0, left: 0 };
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private positionService: PositionService,
    private seasonData: SeasonDataService,
    readonly games: GameViewService,
  ) {
    this.ranker = new TabRanker(
      positionService,
      seasonData,
      () => this.tabState,
      () => this.position && this.sortPlayers(),
    );
    this.cards = new PlayerCards(this, seasonData);
    this.compare = new PlayerCompare(this, seasonData);
    // (the game view's names and teams open cards)
    this.cards.connectGames(games);
    const service = this.positionService;

    // Re-rank when the sliders, the group eyes, the settings menu or the stat eyes change
    service.weights$.pipe(takeUntilDestroyed()).subscribe((weights) => {
      if (!this.position) return;
      this.weights = weights[this.position];
      this.sortPlayers();
    });
    service.skillHidden$.pipe(takeUntilDestroyed()).subscribe((hidden) => {
      if (!this.position) return;
      this.hidden = hidden[this.position] ?? {};
      this.sortPlayers();
    });
    service.settings$.pipe(takeUntilDestroyed()).subscribe(() => this.position && this.sortPlayers());
    service.statHidden$.pipe(takeUntilDestroyed()).subscribe(() => this.position && this.sortPlayers());

    // Another season from the year dropdown (or its playoffs, Length): its rows from the top, in
    // that season's order for this tab (dragged or not) if it has one, otherwise sorted by the sliders
    service.season$.pipe(takeUntilDestroyed()).subscribe((season) => {
      const changed = season !== this.season || service.seasonPart !== this.seasonPart;
      this.season = season;
      this.seasonPart = service.seasonPart;
      if (changed) this.picked = [];
      if (changed && this.position) this.ngOnChanges();
    });
    service.seasonLoading$.pipe(takeUntilDestroyed()).subscribe((loading) => (this.seasonLoading = loading));

    // The sport's values from other tabs changed (SPORT.connect: the NFL's team grades): they show,
    // and the list re-sorts unless it was dragged by hand
    service.sportChanged$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.dataVersion++;
      if (this.position && !this.positionService.unitOrder(this.position)?.manual) this.sortPlayers();
    });
  }

  ngOnChanges(): void {
    // (picks are a tab's own)
    this.picked = [];
    // A new tab starts scrolled to the top-left of its list
    this.rankingsList?.nativeElement.scrollTo({ top: 0, left: 0 });
    this.stats = SKILL_STATS[this.position];
    this.groups = skillGroups(this.position);
    this.hidden = this.positionService.skillHiddenGroups(this.position);
    this.weights = this.positionService.getWeights(this.position);
    // A hand-dragged order comes back as it was; otherwise sorted by the sliders
    const saved = this.positionService.unitOrder(this.position);
    if (saved?.manual) this.restoreOrder(saved.ids);
    else this.sortPlayers();
    // (a card a link asked for: open on its tab, once)
    const card = this.positionService.takePendingCard(this.position);
    if (card) this.cards.openLinked(card, this.season);
    // (a comparison a link asked for: open over whichever tab, once)
    const shared = this.positionService.takePendingCompare();
    if (shared) this.compare.openLinked(shared);
  }

  get settings(): RankerSettings {
    return this.positionService.settings;
  }

  get sportSettings(): SportSettings {
    return this.settings.sport;
  }

  get colorValues(): boolean {
    return this.settings.colorValues;
  }

  get categoryColors(): boolean {
    return this.settings.categoryColors;
  }

  // ---------------------------------------------------------------------------
  // The list: who's in it, and their order
  // ---------------------------------------------------------------------------
  // Sort by the sliders (weighted totals of every stat that counts), then head-to-head among ties
  sortPlayers(): void {
    const from = this.glide.measure(this.rankingsList?.nativeElement);
    this.playerList = this.limited(this.shown(this.ranker.ranked(this.reader, this.ranker.listed(SKILL_UNITS, this.season, this.position), this.position, SKILL_UNITS)));
    this.publishOrder(false);
    this.glide.play(() => this.rankingsList?.nativeElement, from);
  }

  // A row dragged to another place: the order is kept, by hand, until the tab re-sorts
  drop(event: CdkDragDrop<string[]>): void {
    moveItemInArray(this.playerList, event.previousIndex, event.currentIndex);
    this.publishOrder(true);
  }

  // Put the list back in a saved order (players that have since appeared go at the end)
  private restoreOrder(ids: string[]): void {
    this.playerList = this.limited(this.ranker.inOrder(this.shown(this.ranker.listed(SKILL_UNITS, this.season, this.position)), ids));
  }

  // Remember this tab's order for when you come back
  private publishOrder(manual: boolean): void {
    this.positionService.setUnitOrder(this.position, this.playerList.map((player) => player.gsisId), manual);
  }

  // The ranked rows the sport's view-only filter keeps (SPORT.rowShown)
  private shown(list: SkillPlayer[]): SkillPlayer[] {
    const show = SPORT.rowShown;
    return show ? list.filter((player) => show(player, this.sportSettings)) : list;
  }

  // The tab's top rows only, when the sport caps it (SPORT.listLimit)
  private limited(list: SkillPlayer[]): SkillPlayer[] {
    const limit = SPORT.listLimit?.(this.position);
    return limit ? list.slice(0, limit) : list;
  }

  // ---------------------------------------------------------------------------
  // The columns
  // ---------------------------------------------------------------------------
  // The groups shown in the grid, in the order of the sidebar's cards, each with its stats that have a
  // column (in their dragged order)
  get visibleGroups(): SkillStatGroup[] {
    const { groups, spots } = this.ranker.shownGroups(this.reader, this.position);
    Object.assign(this.combinedSpot, spots);
    return groups;
  }

  shownGroups(reader: StatReader, position = this.position): SkillStatGroup[] {
    return this.ranker.shownGroups(reader, position).groups;
  }

  // Which stat's spot each combined column took (header dragging moves it as that stat)
  private combinedSpot: Partial<Record<string, string>> = {};

  columnId(stat: SkillStat): string {
    return this.combinedSpot[stat.key] ?? stat.key;
  }

  // ---------------------------------------------------------------------------
  // Reading the stats (StatReader): the table's season, or another one for the player card
  // ---------------------------------------------------------------------------
  private tableSource() {
    const table = this;
    return {
      get position() {
        return table.position;
      },
      get settings() {
        return table.settings;
      },
      get rows() {
        return SKILL_UNITS;
      },
      get list() {
        return table.playerList;
      },
      get version() {
        return table.dataVersion;
      },
      get season() {
        return table.season;
      },
      get weights() {
        return table.ranker.mixWeights(table.position);
      },
      tableSeason: true,
      empty: (key: string) => statIsEmpty(table.position, key),
    };
  }

  readerFor(context: SeasonContext | null): StatReader {
    if (!context) return this.reader;
    const table = this;
    const position = context.position ?? this.position;
    return new StatReader({
      position,
      settings: this.settings,
      rows: context.rows,
      list: context.list,
      tableSeason: false,
      season: context.season,
      empty: context.empty,
      get weights() {
        return table.ranker.mixWeights(position);
      },
    });
  }

  // Another season's list: the same filters as the table, ranked with the current sliders (or as
  // dragged by hand this visit)
  seasonContext(season: number, rows: Record<SkillPosition, SkillPlayer[]>, position = this.position): SeasonContext {
    const units = rows[position];
    const context: SeasonContext = {
      season,
      rows,
      list: [],
      empty: (key) => emptyIn(units, key),
      ...(position !== this.position && { position }),
    };
    const listed = this.ranker.listed({ [position]: units }, season, position);
    const saved = this.positionService.seasonUnitOrder(season, position);
    if (saved?.manual) {
      context.list = this.ranker.inOrder(listed, saved.ids);
      context.manual = true;
    } else {
      context.list = this.rankedIn(context, listed);
    }
    return context;
  }

  rankedIn(context: SeasonContext, players: SkillPlayer[]): SkillPlayer[] {
    return this.ranker.ranked(this.readerFor(context), players, context.position ?? this.position, context.rows);
  }

  // ---------------------------------------------------------------------------
  // The grid's cells
  // ---------------------------------------------------------------------------
  // The name column's header
  get rowHeader(): string {
    return SPORT.rowHeader?.(this.position) ?? 'Player';
  }

  // Gold for #1 (the top-5 class, with the trophy), green for 2-10 (top-10), red for the bottom 10
  // (bottom-5), white for the rest
  rankClasses(i: number): string {
    if (i === 0) return 'count top-5';
    // (the top 10 keep their green if the list is ever that short)
    if (i < 10) return 'count top-10';
    if (i >= this.playerList.length - 10) return 'count bottom-5';
    return 'count';
  }

  // Header hover: the stat written out, plus the list average of what the column shows
  labelTitle(stat: SkillStat): string {
    const name = this.reader.name(stat);
    const avg = this.reader.averageText(stat);
    return avg === null ? name : `${name} (Avg: ${avg})`;
  }

  // A header label split before its parenthetical ("HR" + "(162G)"), which shows smaller
  labelParts(stat: SkillStat): [string, string | null] {
    const label = this.reader.label(stat);
    const match = label.match(/^(.*?)\s*(\([^()]*\))$/);
    return match ? [match[1], match[2]] : [label, null];
  }

  // Row hover (the label invisibly covers its value): "[value] [stat name]"
  valueTitle(player: SkillPlayer, stat: SkillStat): string {
    const name = this.reader.name(stat);
    const value = this.reader.format(player, stat);
    return value === '-' ? name : `${value} ${name}`;
  }

  // A Recent dot: its game (the row's team's nth meeting with that opponent, newest first)
  openRecent(player: SkillPlayer, index: number, event: Event): void {
    if (!this.games.available) return;
    const vs = extras(player).lastFiveVs;
    const ref = recentRef(this.recentTeam(player), vs, index, this.season);
    if (!ref) return;
    event.stopPropagation();
    this.games.open(ref);
  }

  // A row's card (a click in the grid: a fresh start, no game to go back to)
  openCard(player: SkillPlayer): void {
    this.games.backTo = null;
    this.cards.open(player);
  }

  // ---------------------------------------------------------------------------
  // Compare: rows picked in the grid, then the button
  // ---------------------------------------------------------------------------
  // A click on a row, anywhere but its name, its badge and its links (a drag just let go isn't one, nor a
  // click that ends a text selection): picked, or unpicked
  pickRow(player: SkillPlayer, event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target?.closest('.card-target, .last-five, .drag-indicator, .group-icon, button, a')) return;
    if (Date.now() - this.dragEnded < 300 || getSelection()?.toString()) return;
    this.togglePick(player, event.currentTarget as HTMLElement);
  }

  // ...or C with the row's name in focus (Enter and Space still open the card), said under the name
  pickKey(player: SkillPlayer, event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const name = event.target as HTMLElement;
    const picked = this.togglePick(player, name);
    if (picked !== null) this.toast(name, picked ? `Picked for Compare (${this.picked.length} of ${COMPARE_MAX})` : 'Unpicked');
  }

  // (picked: true, unpicked: false, a fifth turned away: null)
  private togglePick(player: SkillPlayer, anchor: HTMLElement): boolean | null {
    const at = this.picked.indexOf(player.gsisId);
    if (at >= 0) this.picked.splice(at, 1);
    else if (this.picked.length >= COMPARE_MAX) {
      this.toast(anchor, `Compare up to ${COMPARE_MAX} at a time`);
      return null;
    } else this.picked.push(player.gsisId);
    return at < 0;
  }

  // Escape with nothing open over the grid lets go of the picks
  @HostListener('document:keydown.escape', ['$event'])
  clearPicks(event: Event): void {
    if (!this.picked.length || event.defaultPrevented || document.querySelector('[aria-modal="true"], .cdk-overlay-pane')) return;
    this.picked = [];
  }

  rowDropped(): void {
    this.dragEnded = Date.now();
  }

  // The button: the picks compared (then let go), or the view open to search anyone
  openCompare(): void {
    const picks = this.picked.map((id) => this.playerList.find((p) => p.gsisId === id)).filter((p): p is SkillPlayer => !!p);
    this.picked = [];
    this.compare.start(picks);
  }

  // The card's compare button: its season into the compare view (the card closes, the view under it)
  readonly compareFromCard = () => {
    const card = this.cards.card;
    if (!card) return;
    const position = this.cards.tabPosition;
    this.games.backTo = null;
    this.cards.close();
    this.compare.startWith(position, card.season, card.player.gsisId);
  };

  // A Recent square decided past regulation (the NHL's overtime or shootout: a lighter square)
  recentOt(player: SkillPlayer, index: number): boolean {
    return !!extras(player).lastFiveOt?.[index];
  }

  // A row's team, by the names the row knows (its team's name, its own, its logo's file)
  recentTeam(player: SkillPlayer): (string | undefined)[] {
    return rowTeamNames(player);
  }

  // A Recent square's hover: "W 24-17 @ Miami Dolphins" (the score once the team's results are in)
  dotTitle(player: SkillPlayer, index: number): string {
    const title = this.reader.recentTitle(player, index);
    const vs = extras(player).lastFiveVs;
    const score = this.games.recentScore(this.recentTeam(player), vs, index, this.season);
    return score ? title.replace(/^(\S+)/, `$1 ${score}`) : title;
  }

  // Empty Recent slots for games not played yet (up to the tab's count: SPORT.recentGames)
  unplayed(player: SkillPlayer): null[] {
    return Array(Math.max(0, recentCount(this.position) - this.reader.lastFive(player).length)).fill(null);
  }

  // More than 7 Recent dots: smaller ones, so the column stays narrow
  get manyRecent(): boolean {
    return recentCount(this.position) > 7;
  }

  // A stat group collapsed to a strip (its header icon clicked; clicked again to open): hidden, still
  // counted in the ranking
  isCollapsed(id: StatGroupId): boolean {
    return this.positionService.isGroupCollapsed(this.position, id);
  }

  toggleCollapsed(id: StatGroupId, event: Event): void {
    event.stopPropagation();
    this.positionService.toggleGroupCollapsed(this.position, id);
  }

  collapseTitle(group: { id: StatGroupId; title: string }): string {
    return `${group.title}: Click to ${this.isCollapsed(group.id) ? 'Expand' : 'Collapse'}`;
  }

  // Games in a row's record its stats don't cover yet (the data's statsBehind; the current season only)
  statsBehind(player: SkillPlayer): number {
    return this.season === CURRENT_SEASON ? ((player as { statsBehind?: number }).statsBehind ?? 0) : 0;
  }

  // Bandage hover: the injury status (the sport's wording)
  injuryTitle(player: SkillPlayer): string {
    return SPORT.copy.injuryTitle(player, dataSeason === CURRENT_SEASON);
  }

  // A row's awards this season (badges beside the name), looked up once per season
  private awardCache?: { key: string; wins: Map<SkillPlayer, AwardWin[]> };

  awards(player: SkillPlayer): AwardWin[] {
    const key = `${dataVersion}.${this.position}`;
    if (this.awardCache?.key !== key) this.awardCache = { key, wins: new Map() };
    let wins = this.awardCache.wins.get(player);
    if (!wins) {
      wins = awardsFor(player, this.position, dataSeason);
      this.awardCache.wins.set(player, wins);
    }
    return wins;
  }

  // The team card: its color, the logo as it looked in the table's season, drawn in white for a logo
  // that's dark lettering (the Giants')
  teamBadge(unit: { teamLogo: string }): string {
    return badgeColor(unit.teamLogo);
  }

  seasonLogo(teamLogo: string): string {
    return logoForSeason(teamLogo, this.season);
  }

  teamLogoWhite(unit: { teamLogo: string }): boolean {
    return whiteLogo(unit.teamLogo);
  }

  // The player's headshot (a cutout on a clear background, sized for the team card; w: its width): the
  // sport's, then its fallback once that fails to load (SPORT.headshotFallback), then none
  private headshotMisses = new Map<number, number>();

  headshot(unit: { id?: number | null }, w = 160): string | null {
    if (!unit.id) return null;
    const misses = this.headshotMisses.get(unit.id) ?? 0;
    if (misses === 0) return SPORT.headshot(unit.id, w);
    if (misses === 1 && SPORT.headshotFallback) return SPORT.headshotFallback(unit.id, w);
    return null;
  }

  noHeadshot(unit: { id?: number | null }): void {
    if (unit.id) this.headshotMisses.set(unit.id, (this.headshotMisses.get(unit.id) ?? 0) + 1);
  }

  // ---------------------------------------------------------------------------
  // The button bar
  // ---------------------------------------------------------------------------
  get filtersOpen(): boolean {
    return this.positionService.filtersOpen;
  }

  toggleFilters(): void {
    this.positionService.setFiltersOpen(!this.filtersOpen);
  }

  get aboutOpen(): boolean {
    return this.positionService.aboutOpen;
  }

  openAbout(): void {
    this.positionService.setAboutOpen(true);
  }

  // The sport's footer dropdowns (MMA's Current / All-Time)
  settingText(setting: SportSetting): string {
    return settingText(setting, this.sportSettings);
  }

  setSportSetting(key: string, value: string): void {
    this.positionService.setSportSetting(key, value);
  }

  // The year dropdown: "2019" ("2024-25" for a sport named for the year it ends in), or CURRENT while
  // it's being played
  seasonName(season: number): string {
    return isLiveSeason(season) ? 'CURRENT' : SPORT.seasonText(season);
  }

  selectSeason(season: number): void {
    this.positionService.setSeason(season);
  }

  // The list as text, then "List copied" for two seconds, just under the button
  copyList(button: HTMLElement): void {
    copyRankingsToClipboard(this.rankingsList.nativeElement, this.settings.copyStats)
      .then(() => this.toast(button, 'List copied to clipboard!'))
      .catch((err) => console.error('Failed to copy: ', err));
  }

  // The list's link (its tab, season, sliders, eyes and settings: share.ts)
  shareList(button: HTMLElement): void {
    this.shareLink(button, this.positionService.shareLink(), 'Link copied: anyone who opens it sees this list');
  }

  // The compare view's: the list's, with its sides and its tab on top
  readonly shareCompare = (button: HTMLElement) => {
    const { sides, tab } = this.compare;
    this.shareLink(button, this.positionService.compareLink(sides, tab), 'Link copied: anyone who opens it sees this comparison');
  };

  // (a phone's share sheet, else copied, "Link copied" under the button)
  private shareLink(button: HTMLElement, url: string, copied: string): void {
    const phone = matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function';
    if (phone) {
      navigator.share({ title: document.title, url }).catch(() => null);
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => this.toast(button, copied))
      .catch((err) => console.error('Failed to copy: ', err));
  }

  private toast(button: HTMLElement, text: string): void {
    const rect = button.getBoundingClientRect();
    this.toastAt = { top: rect.bottom + 8, left: rect.left + rect.width / 2 };
    this.toastText = text;
    this.toastVisible = true;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastVisible = false), 2200);
  }
}
