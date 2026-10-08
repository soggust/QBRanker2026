import { Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
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
  statGroup,
} from '@sport/positions';
import { AWARD_INFO, AwardWin, awardsFor } from '@sport/awards';
import { SPORT } from '@sport/sport';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SportSetting, SportSettings } from '@ranker/engine/sport';
import { PositionService, RankerSettings } from '@ranker/engine/position.service';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { CURRENT_SEASON, SEASONS, dataSeason, dataVersion, isLiveSeason } from '@ranker/engine/data';
import { SKILL_UNITS, byTotals, combinedFor, combinedWeights, emptyIn, recentCount, statIsEmpty, weightedTotals } from '@ranker/engine/unit-scoring';
import { StatReader } from '@ranker/engine/stat-reader';
import { hasMin, minCount, seasonLength } from '@ranker/engine/playing-time';
import { settingGroups, settingOptions, settingText, settingsAt } from '@ranker/engine/setting-options';
import { CardHost, PlayerCards } from '@ranker/engine/player-card/player-cards';
import { SeasonContext } from '@ranker/engine/player-card/card.model';
import { copyRankingsToClipboard } from '@ranker/core/clipboard';
import { RowGlide } from './row-glide';

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

  // The player card (a name clicked)
  readonly cards: PlayerCards;

  private readonly glide = new RowGlide();

  // "List copied" under the copy button
  toastVisible = false;
  toastAt = { top: 0, left: 0 };

  constructor(
    private positionService: PositionService,
    private seasonData: SeasonDataService,
  ) {
    this.cards = new PlayerCards(this, seasonData);
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

    // Another season from the year dropdown: its rows from the top, in that season's order for this
    // tab (dragged or not) if it has one, otherwise sorted by the sliders
    service.season$.pipe(takeUntilDestroyed()).subscribe((season) => {
      const changed = season !== this.season;
      this.season = season;
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
    this.playerList = this.limited(this.shown(this.ranked(this.reader, this.listed(SKILL_UNITS, this.season))));
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
    const at = new Map(ids.map((id, i) => [id, i]));
    const players = this.shown(this.listed(SKILL_UNITS, this.season));
    this.playerList = this.limited(players.sort((a, b) => (at.get(a.gsisId) ?? Infinity) - (at.get(b.gsisId) ?? Infinity)));
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

  // The players a season's rows list: injured players only with Injured Players on, enough playing
  // time (Min Games), only rookies with Rookies Only on, and the sport's own filter
  private listed(rows: Record<string, SkillPlayer[]>, season: number, position = this.position): SkillPlayer[] {
    const min = hasMin(position) ? minCount(this.settings, seasonLength(rows, position)) : 0;
    return (rows[position] ?? []).filter(
      (player) =>
        (this.settings.showInjured || !player.injured || !!SPORT.noSwitches?.includes('showInjured')) &&
        SPORT.playingTime.of(player) >= min &&
        this.rookieOk(player, season, position) &&
        (SPORT.rowVisible?.(player, this.sportSettings) ?? true),
    );
  }

  // Best first by the sliders: switched-off groups and stats don't count, and each combined pair's
  // parts count by their parent slider (another tab's, for a card opened on it)
  private ranked(reader: StatReader, players: SkillPlayer[], position = this.position): SkillPlayer[] {
    const { stats, hidden, weights: sliders } = this.tab(position);
    const counted = stats.filter((stat) => !hidden[statGroup(stat)] && !this.statHidden(stat.key, position) && !reader.recentOff(stat));
    const weights = combinedWeights(position, sliders);
    const totals = weightedTotals(players, counted, weights, (player, stat) => reader.value(player, stat), undefined, this.sportSettings);
    return byTotals(players, totals, this.sportSettings);
  }

  // Rookies Only (settings menu): players in their first season (first-year head coaches on a coaches'
  // tab). A first season is the first one they're in the data (careers.json, loaded when the setting
  // is turned on), so the data's first season can't tell and lists everyone; so do team tabs.
  private firstSeasons: Map<string, number> | null = null;
  private firstSeasonsLoading = false;

  private rookieOk(player: SkillPlayer, season: number, position = this.position): boolean {
    if (!this.settings.rookiesOnly || SPORT.noSwitches?.includes('rookiesOnly') || SPORT.teamTabs?.includes(position)) return true;
    // (a sport whose data says who's a rookie: that decides)
    const flagged = (player as { rookie?: boolean }).rookie;
    if (flagged !== undefined) return flagged;
    if (season <= SPORT.firstSeason) return true;
    if (!this.firstSeasons) {
      this.loadFirstSeasons();
      return true;
    }
    // (careers.json has the finished seasons, so this season's rookies aren't in it at all)
    return (this.firstSeasons.get(player.gsisId) ?? season) >= season;
  }

  private loadFirstSeasons(): void {
    if (this.firstSeasonsLoading) return;
    this.firstSeasonsLoading = true;
    this.seasonData
      .careers()
      .then((careers) => {
        const first = new Map<string, number>();
        for (const byId of Object.values(careers)) {
          for (const [id, seasons] of Object.entries(byId ?? {})) {
            for (const [season] of seasons) first.set(id, Math.min(season, first.get(id) ?? Infinity));
          }
        }
        this.firstSeasons = first;
        if (this.position && this.settings.rookiesOnly) this.sortPlayers();
      })
      .catch((err) => console.error(err))
      .finally(() => (this.firstSeasonsLoading = false));
  }

  // ---------------------------------------------------------------------------
  // The columns
  // ---------------------------------------------------------------------------
  // The groups shown in the grid, in the order of the sidebar's cards, each with its stats that have a
  // column (in their dragged order)
  get visibleGroups(): SkillStatGroup[] {
    return this.shownGroups(this.reader);
  }

  shownGroups(reader: StatReader, position = this.position): SkillStatGroup[] {
    const { groups, hidden } = this.tab(position);
    return this.positionService
      .orderedGroups(position, groups)
      .filter((group) => !hidden[group.id])
      .map((group) => ({
        ...group,
        // (in their column order: dragging a header reorders them, and the order survives switching tabs)
        stats: this.combine(this.positionService.orderedStats(position, group), position).filter((stat) => this.isShown(stat, reader, position)),
      }))
      .filter((group) => group.stats.length);
  }

  // A tab's stats, groups, switched-off groups and sliders: the table's own, or another's (a card opened
  // on it from a roster)
  private tab(position: SkillPosition) {
    if (position === this.position) return { stats: this.stats, groups: this.groups, hidden: this.hidden, weights: this.weights };
    return {
      stats: SKILL_STATS[position],
      groups: skillGroups(position),
      hidden: this.positionService.skillHiddenGroups(position),
      weights: this.positionService.getWeights(position),
    };
  }

  // Combine setting: a pair (rushing + receiving yards) shows as one total column where the first of the
  // two sits, when the tab has both
  private combine(stats: SkillStat[], position = this.position): SkillStat[] {
    if (!this.settings.combineStats) return stats;
    let out = stats;
    for (const { stat: total, parts } of combinedFor(position)) {
      const at = out.findIndex((stat) => (parts as string[]).includes(stat.key));
      if (at === -1 || !parts.every((part) => out.some((stat) => stat.key === part))) continue;
      // (the grid's columns only)
      if (position === this.position) this.combinedSpot[total.key] = out[at].key;
      out = out.flatMap((stat, i) => (i === at ? [total] : (parts as string[]).includes(stat.key) ? [] : [stat]));
    }
    return out;
  }

  // Which stat's spot each combined column took (header dragging moves it as that stat)
  private combinedSpot: Partial<Record<string, string>> = {};

  columnId(stat: SkillStat): string {
    return this.combinedSpot[stat.key] ?? stat.key;
  }

  // Switched off with its sidebar eye (or its combined pair's parent eye): hidden and out of the
  // ranking, whatever Unweighted Stats says
  private statHidden(key: string, position = this.position): boolean {
    const parent = combinedFor(position).find(({ parts }) => (parts as string[]).includes(key));
    return this.positionService.isStatHidden(position, key) || (!!parent && this.positionService.isStatHidden(position, parent.stat.key));
  }

  // The eye decides first; then a stat the season didn't record has no column; then Unweighted Stats
  // decides whether a 0% stat shows (display-only columns like Games always do)
  private isShown(stat: SkillStat, reader: StatReader, position = this.position): boolean {
    if (this.statHidden(stat.key, position) || stat.shownWhen?.(this.sportSettings) === false || reader.recentOff(stat)) return false;
    const weights = combinedWeights(position, this.tab(position).weights);
    const showUnused = this.settings.showUnused;
    // A combined column shows if either of its stats would
    const combined = combinedFor(position).find((c) => c.stat.key === stat.key);
    if (combined) {
      const parts = combined.parts.filter((key) => !this.statHidden(key, position) && !reader.empty(key));
      return parts.length > 0 && (showUnused || parts.some((key) => !!weights[key as keyof SkillWeights]));
    }
    if (reader.empty(stat.key)) return false;
    // (a display-only column nobody has a value for this season: one it didn't keep yet)
    if (stat.infoOnly) return ['recent', 'record'].includes(stat.format) || reader.hasValues(stat);
    return showUnused || !!weights[stat.key];
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
      tableSeason: true,
      empty: (key: string) => statIsEmpty(table.position, key),
    };
  }

  readerFor(context: SeasonContext | null): StatReader {
    if (!context) return this.reader;
    return new StatReader({
      position: context.position ?? this.position,
      settings: this.settings,
      rows: context.rows,
      list: context.list,
      tableSeason: false,
      season: context.season,
      empty: context.empty,
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
    const listed = this.listed({ [position]: units }, season, position);
    const saved = this.positionService.seasonUnitOrder(season, position);
    if (saved?.manual) {
      const at = new Map(saved.ids.map((id, i) => [id, i]));
      context.list = [...listed].sort((a, b) => (at.get(a.gsisId) ?? Infinity) - (at.get(b.gsisId) ?? Infinity));
      context.manual = true;
    } else {
      context.list = this.rankedIn(context, listed);
    }
    return context;
  }

  rankedIn(context: SeasonContext, players: SkillPlayer[]): SkillPlayer[] {
    return this.ranked(this.readerFor(context), players, context.position);
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
    const rect = button.getBoundingClientRect();
    this.toastAt = { top: rect.bottom + 8, left: rect.left + rect.width / 2 };
    copyRankingsToClipboard(this.rankingsList.nativeElement, this.settings.copyStats)
      .then(() => {
        this.toastVisible = true;
        setTimeout(() => (this.toastVisible = false), 2000);
      })
      .catch((err) => console.error('Failed to copy: ', err));
  }
}
