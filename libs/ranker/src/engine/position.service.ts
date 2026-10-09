import { SPORT } from '@sport/sport';
import { CURRENT_SEASON, SeasonPart, dataPart, dataSeason, hasSeasonParts, loadData } from '@ranker/engine/data';
import { Injectable } from '@angular/core';
import { BehaviorSubject, EMPTY, Observable, combineLatest, distinctUntilChanged, map, merge } from 'rxjs';
import { connectRosterGrades } from '@ranker/engine/roster-grades';
import { DEFAULT_SPORT_SETTINGS, SKILL_UNITS, defaultRanking, rebuildUnits } from '@ranker/engine/unit-scoring';
import { applySharedLink, shareLink } from '@ranker/engine/share';
import type { EngineHost, SportSettings } from '@ranker/engine/sport';
import {
  POSITIONS,
  Position,
  StatBasis,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillStatGroup,
  SkillWeights,
  StatGroupId,
  presetWeights,
} from '@sport/positions';

// Groups switched off with the sidebar eye, per position (every group is on at each page load)
export type HiddenGroups = Partial<Record<SkillPosition, Partial<Record<StatGroupId, boolean>>>>;

// Settings-menu toggles, shared by every position (back to the defaults on every page load)
export interface RankerSettings {
  // Counting stats as season totals, per game or at a full season's pace
  statBasis: StatBasis;
  showUnused: boolean;
  showInjured: boolean;
  // Players with less than this share of the season's playing time are left out (0-100; 0 is
  // everyone; the sport's measure: SPORT.playingTime)
  minShare: number;
  // ...or this many, when the sport's minimum is a fixed count (SPORT.playingTime.fixed; null: its default)
  minCount: number | null;
  // Tint values green / red by how far above / below the list average they are
  colorValues: boolean;
  // Carry each stat group's color down the rows (a line before each group)
  categoryColors: boolean;
  // Show each combined pair (SPORT.combined: rushing + receiving yards) as one total column
  combineStats: boolean;
  // List only rookies (and first-year head coaches): everyone else is left out, like Min Games
  rookiesOnly: boolean;
  // The copy button copies the stat columns too (off: just the rank, logo and name, a plain list)
  copyStats: boolean;
  // The grid shows each value as its place in the list (#1 the best) instead: display only, the ranking
  // and its weights unchanged
  showRanks: boolean;
  // The sport's own settings (SPORT.settings), by key
  sport: SportSettings;
}

// The Min setting: a share of the season so far, in steps of MIN_SHARE_STEP, or a whole game when that's
// less than one (0 is 1, everyone)
export const MIN_SHARE_STEP = 10;
export const DEFAULT_SETTINGS: RankerSettings = {
  statBasis: SPORT.defaultStatBasis,
  showUnused: false,
  showInjured: true,
  minShare: 10,
  minCount: null,
  colorValues: true,
  categoryColors: true,
  combineStats: true,
  rookiesOnly: false,
  copyStats: false,
  showRanks: false,
  sport: DEFAULT_SPORT_SETTINGS,
};

// Open the tab from a shared link, e.g. ?pos=SS
function linkedPosition(): Position {
  const linked = new URLSearchParams(location.search).get('pos')?.toUpperCase();
  return POSITIONS.find((position) => position === linked) ?? POSITIONS[0];
}

// A player's card from a link (?card=<his ESPN id>&name=<his name>: the Algorithm's prop picks): the tab and
// row he's in this season, by the id where the rows carry ESPN's (the NFL's, the NBA's) and by the name where
// they don't; the link taken out of the address. Null when he isn't in the season's rows.
function linkedCard(): { position: SkillPosition; gsisId: string } | null {
  const url = new URL(location.href);
  const id = url.searchParams.get('card');
  const name = url.searchParams.get('name');
  if (!id && !name) return null;
  url.searchParams.delete('card');
  url.searchParams.delete('name');
  history.replaceState(null, '', url);
  const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const tabs = (POSITIONS as SkillPosition[]).filter((position) => !SPORT.teamTabs?.includes(position));
  for (const match of [(p: SkillPlayer) => !!id && String(p.id) === id, (p: SkillPlayer) => !!name && key(p.name) === key(name)]) {
    for (const position of tabs) {
      const row = (SKILL_UNITS[position] ?? []).find(match);
      if (row) return { position, gsisId: row.gsisId };
    }
  }
  return null;
}

// A grid's look for a shared link (PositionService.layout): tab -> row ids in their dragged order,
// tab -> collapsed group ids, "TAB.group" -> column keys, tab -> the sidebar's group order
export interface GridLayout {
  orders: Record<string, string[]>;
  collapsed: Record<string, string[]>;
  columns: Record<string, string[]>;
  groups: Record<string, StatGroupId[]>;
}

export interface UnitOrder {
  ids: string[];
  manual: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PositionService {
  // (a shared list's link opened: its sliders, eyes and settings, applied once everything's set up)
  constructor() {
    applySharedLink(this, DEFAULT_SETTINGS);
    // (a card's link: its tab open from the start, the card when the grid draws it)
    this.pendingCard = linkedCard();
    if (this.pendingCard) this.positionSubject.next(this.pendingCard.position);
    this.checkSeasonParts(dataSeason);
    // (a linked part the season doesn't have loaded its regular season: the address says so too)
    const url = new URL(location.href);
    if (url.searchParams.has('part') && url.searchParams.get('part') !== dataPart) {
      if (dataPart === 'regular') url.searchParams.delete('part');
      else url.searchParams.set('part', dataPart);
      history.replaceState(null, '', url);
    }
  }

  // The link to this list as it is now (the tab, the season, and what's changed from the defaults)
  shareLink(): string {
    return shareLink(this, DEFAULT_SETTINGS);
  }

  private settingsSubject = new BehaviorSubject<RankerSettings>({ ...DEFAULT_SETTINGS });
  public settings$ = this.settingsSubject.asObservable();

  private positionSubject = new BehaviorSubject<Position>(linkedPosition());
  public position$: Observable<Position> = this.positionSubject.asObservable();

  // Slider weights per position, kept when switching tabs
  private weightsSubject = new BehaviorSubject<Record<SkillPosition, SkillWeights>>(
    Object.fromEntries(POSITIONS.map((position) => [position, presetWeights(position, 'default')])) as Record<
      SkillPosition,
      SkillWeights
    >,
  );
  public weights$ = this.weightsSubject.asObservable();

  // Each tab's order when it was last shown (player ids, drags included), so a tab keeps its list
  // when you switch away and back. manual: the order was dragged by hand, so it stays put until
  // that tab's own sliders or settings re-sort it.
  private unitOrdersSubject = new BehaviorSubject<Partial<Record<SkillPosition, UnitOrder>>>({});

  // The filters menu: open or closed, set by the footer's filter button and the menu's X. On large
  // screens it's the sidebar, below 1200px a slide-out menu; closed at each page load either way.
  private filtersOpenSubject = new BehaviorSubject<boolean>(false);

  get filtersOpen(): boolean {
    return this.filtersOpenSubject.value;
  }

  setFiltersOpen(open: boolean): void {
    this.filtersOpenSubject.next(open);
  }

  // A card a link asked for (linkedCard), until the grid opens it on its tab
  private pendingCard: { position: SkillPosition; gsisId: string } | null = null;

  takePendingCard(position: SkillPosition): { position: SkillPosition; gsisId: string } | null {
    const card = this.pendingCard;
    if (!card || card.position !== position) return null;
    this.pendingCard = null;
    return card;
  }

  // The season on screen (the year selector). Sliders, eyes and column orders carry over to another
  // season; each season keeps its own tab orders (drags included) while the page is open.
  private seasonSubject = new BehaviorSubject<number>(dataSeason);
  public season$ = this.seasonSubject.asObservable();
  private seasonLoadingSubject = new BehaviorSubject<boolean>(false);
  public seasonLoading$ = this.seasonLoadingSubject.asObservable();
  private ordersBySeason = new Map<string, Partial<Record<SkillPosition, UnitOrder>>>();

  // Which games the stats count (data.ts SeasonPart: the regular season, the playoffs or both), the
  // settings menu's Length
  private seasonPartSubject = new BehaviorSubject<SeasonPart>(dataPart);
  public seasonPart$ = this.seasonPartSubject.asObservable();
  // (whether the season on screen has its playoffs built: Length is greyed out until it does)
  seasonPartsAvailable = false;
  private checkSeasonParts(season: number): void {
    hasSeasonParts(season).then((has) => {
      if (season === this.season) this.seasonPartsAvailable = has;
    });
  }

  get season(): number {
    return this.seasonSubject.value;
  }

  get seasonPart(): SeasonPart {
    return this.seasonPartSubject.value;
  }

  // Load another season's data and show it: the rows are rebuilt first, then the orders swap to that
  // season's, then the pages hear the season changed
  async setSeason(season: number): Promise<void> {
    if (season === this.season) return;
    await this.load(season, this.seasonPart);
  }

  // The playoffs, both, or the regular season again (a season without the part stays on its regular
  // season; false says so)
  async setSeasonPart(part: SeasonPart): Promise<boolean> {
    if (part === this.seasonPart) return true;
    await this.load(this.season, part);
    return this.seasonPart === part;
  }

  private async load(season: number, part: SeasonPart): Promise<void> {
    if (this.seasonLoadingSubject.value) return;
    this.seasonLoadingSubject.next(true);
    try {
      await loadData(season, part);
      rebuildUnits();
      this.ordersBySeason.set(`${this.season}.${this.seasonPart}`, this.unitOrdersSubject.value);
      this.unitOrdersSubject.next(this.ordersBySeason.get(`${season}.${dataPart}`) ?? {});
      this.seasonPartSubject.next(dataPart);
      this.seasonSubject.next(season);
      this.seasonPartsAvailable = false;
      this.checkSeasonParts(season);

      // A past season goes in the address, so a shared link opens it (?season=2024), and the playoffs
      // or both (?part=post)
      const url = new URL(location.href);
      if (season === CURRENT_SEASON) url.searchParams.delete('season');
      else url.searchParams.set('season', String(season));
      if (dataPart === 'regular') url.searchParams.delete('part');
      else url.searchParams.set('part', dataPart);
      history.replaceState(null, '', url);
    } catch (err) {
      console.error(err);
    } finally {
      this.seasonLoadingSubject.next(false);
    }
  }

  unitOrder(position: SkillPosition): UnitOrder | undefined {
    return this.unitOrdersSubject.value[position];
  }

  // A tab's order in any season this visit (the player card ranks other seasons with it when it was
  // dragged by hand; it reads other seasons' regular seasons)
  seasonUnitOrder(season: number, position: SkillPosition): UnitOrder | undefined {
    return season === this.season ? this.unitOrder(position) : this.ordersBySeason.get(`${season}.regular`)?.[position];
  }

  setUnitOrder(position: SkillPosition, ids: string[], manual: boolean): void {
    const current = this.unitOrdersSubject.value[position];
    if (current && current.manual === manual && current.ids.join('|') === ids.join('|')) return;
    this.unitOrdersSubject.next({ ...this.unitOrdersSubject.value, [position]: { ids, manual } });
  }

  // Stats switched off with their sidebar eye, keyed "SS.homeRuns"...: the column is hidden whatever
  // the Unweighted Stats setting says, and the stat drops out of the ranking (its slider keeps its
  // value). Every stat is on at each page load.
  private statHiddenSubject = new BehaviorSubject<Record<string, boolean>>({});
  public statHidden$ = this.statHiddenSubject.asObservable();

  // (every eye's state at once: a new object whenever one changes)
  get statHiddenState(): Record<string, boolean> {
    return this.statHiddenSubject.value;
  }

  isStatHidden(position: Position, key: string): boolean {
    return !!this.statHiddenSubject.value[`${position}.${key}`];
  }

  setStatHidden(position: Position, key: string, hidden: boolean): void {
    this.statHiddenSubject.next({ ...this.statHiddenSubject.value, [`${position}.${key}`]: hidden });
  }

  // Every stat on this tab back on (the Reset button)
  showAllStats(position: Position): void {
    const next = Object.fromEntries(
      Object.entries(this.statHiddenSubject.value).filter(([key]) => !key.startsWith(`${position}.`)),
    );
    this.statHiddenSubject.next(next);
  }

  // Order of the stat groups (categories) per tab, changed by dragging the sidebar cards
  private groupOrders: Partial<Record<Position, StatGroupId[]>> = {};

  groupOrder(position: Position): StatGroupId[] {
    return this.groupOrders[position] ?? ['results', 'box', 'advanced', 'support'];
  }

  setGroupOrder(position: Position, order: StatGroupId[]): void {
    this.groupOrders = { ...this.groupOrders, [position]: order };
  }

  // A tab's groups in that order
  orderedGroups(position: Position, groups: SkillStatGroup[]): SkillStatGroup[] {
    const order = this.groupOrder(position);
    return [...groups].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  // Column order within each stat group, per tab ("SS.box", "SP.advanced"...), changed by dragging
  // a column header. Starts at each table's default order on every page load.
  private columnOrders: Record<string, string[]> = {};
  private columnDefaults: Record<string, string[]> = {};

  columnOrder(list: string, defaults: string[]): string[] {
    this.columnDefaults[list] = defaults;
    return this.columnOrders[list] ?? defaults;
  }

  // A group's stats in their column order
  orderedStats(position: Position, group: SkillStatGroup): SkillStat[] {
    const order = this.columnOrder(
      `${position}.${group.id}`,
      group.stats.map((stat) => stat.key),
    );
    return [...group.stats].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  setColumnOrder(list: string, order: string[]): void {
    this.columnOrders = { ...this.columnOrders, [list]: order };
  }

  moveColumn(list: string, id: string, targetId: string, after: boolean): void {
    const order = [...(this.columnOrders[list] ?? this.columnDefaults[list] ?? [])].filter((col) => col !== id);
    const at = order.indexOf(targetId);
    if (at === -1) return;
    order.splice(after ? at + 1 : at, 0, id);
    this.columnOrders = { ...this.columnOrders, [list]: order };
  }

  // The About / FAQ panel (the footer's info button opens it on every tab)
  private aboutOpenSubject = new BehaviorSubject<boolean>(false);
  public aboutOpen$ = this.aboutOpenSubject.asObservable();

  get aboutOpen(): boolean {
    return this.aboutOpenSubject.value;
  }

  setAboutOpen(open: boolean): void {
    this.aboutOpenSubject.next(open);
  }

  // The sport's settings as they change (only when one does)
  public sportSettings$: Observable<SportSettings> = this.settingsSubject.pipe(
    map((settings) => settings.sport),
    distinctUntilChanged(),
  );

  // A tab's list as last shown (drags included), or its default slider ranking before it's been
  // opened, best first. Each tab only re-sorts while it's on screen, so tabs can grade each other
  // (SPORT.connect) without looping.
  rankedUnits(position: SkillPosition, emphasis?: Record<string, number>): Observable<SkillPlayer[]> {
    return combineLatest([this.weightsSubject, this.unitOrdersSubject, this.sportSettings$]).pipe(
      map(([weights, orders, settings]) => {
        const order = orders[position];
        if (emphasis && !order?.manual) {
          const tab = weights[position] ?? {};
          const leaned = Object.fromEntries(Object.entries(tab).map(([key, weight]) => [key, weight * (emphasis[key] ?? 1)]));
          return defaultRanking(position, leaned, SKILL_UNITS, settings);
        }
        if (!order) return defaultRanking(position, weights[position], SKILL_UNITS, settings);
        const byId = new Map(SKILL_UNITS[position].map((unit) => [unit.gsisId, unit]));
        return order.ids.map((id) => byId.get(id)).filter((unit) => !!unit);
      }),
    );
  }

  // The sport's values from other tabs (SPORT.connect), hooked up once: fires when they change. Hooked
  // up before any page, so the values are current when the pages hear about a change.
  // (and the Teams tab's roster grades from the tabs' rankings: engine/roster-grades)
  private readonly host: EngineHost = {
    settings$: this.sportSettings$,
    rankedUnits: (position, emphasis) => this.rankedUnits(position as SkillPosition, emphasis),
    rows: () => SKILL_UNITS,
  };
  public sportChanged$: Observable<unknown> = merge(SPORT.connect?.(this.host) ?? EMPTY, connectRosterGrades(this.host));

  get settings(): RankerSettings {
    return this.settingsSubject.value;
  }

  updateSettings(changes: Partial<RankerSettings>): void {
    this.settingsSubject.next({ ...this.settingsSubject.value, ...changes });
  }

  get position(): Position {
    return this.positionSubject.value;
  }

  setPosition(position: Position): void {
    this.positionSubject.next(position);

    const url = new URL(location.href);
    if (position === POSITIONS[0]) url.searchParams.delete('pos');
    else url.searchParams.set('pos', position);
    history.replaceState(null, '', url);
  }

  getWeights(position: SkillPosition): SkillWeights {
    return this.weightsSubject.value[position];
  }

  saveWeights(position: SkillPosition, weights: SkillWeights): void {
    this.weightsSubject.next({ ...this.weightsSubject.value, [position]: { ...weights } });
  }

  private skillHiddenSubject = new BehaviorSubject<HiddenGroups>({});
  public skillHidden$ = this.skillHiddenSubject.asObservable();

  skillHiddenGroups(position: SkillPosition): Partial<Record<StatGroupId, boolean>> {
    return this.skillHiddenSubject.value[position] ?? {};
  }

  setSkillGroupHidden(position: SkillPosition, id: StatGroupId, hidden: boolean): void {
    const current = this.skillHiddenSubject.value;
    const next = { ...current, [position]: { ...current[position], [id]: hidden } };
    this.skillHiddenSubject.next(next);
  }

  // Stat groups collapsed to a strip in the grid (their group icon clicked): out of sight, still counted
  private collapsedGroups: Partial<Record<SkillPosition, Partial<Record<StatGroupId, boolean>>>> = {};

  isGroupCollapsed(position: SkillPosition, id: StatGroupId): boolean {
    return !!this.collapsedGroups[position]?.[id];
  }

  toggleGroupCollapsed(position: SkillPosition, id: StatGroupId): void {
    this.collapsedGroups = { ...this.collapsedGroups, [position]: { ...this.collapsedGroups[position], [id]: !this.isGroupCollapsed(position, id) } };
  }

  // How the grid looks beyond its settings, for a shared link (share.ts): each tab's hand-dragged order,
  // its collapsed groups, the dragged columns and the sidebar's card order
  get layout(): GridLayout {
    const orders = Object.entries(this.unitOrdersSubject.value).filter(([, order]) => order?.manual);
    return {
      orders: Object.fromEntries(orders.map(([position, order]) => [position, order!.ids])),
      collapsed: Object.fromEntries(
        Object.entries(this.collapsedGroups).map(([position, groups]) => [position, Object.keys(groups ?? {}).filter((id) => groups?.[id as StatGroupId])]),
      ),
      columns: { ...this.columnOrders },
      groups: { ...this.groupOrders } as Record<string, StatGroupId[]>,
    };
  }

  // ...and a shared link's, put in place (before the tabs first draw)
  applyLayout(layout: Partial<GridLayout>): void {
    for (const [position, ids] of Object.entries(layout.orders ?? {})) this.setUnitOrder(position as SkillPosition, ids, true);
    for (const [position, ids] of Object.entries(layout.collapsed ?? {})) {
      this.collapsedGroups = { ...this.collapsedGroups, [position]: Object.fromEntries(ids.map((id) => [id, true])) };
    }
    this.columnOrders = { ...this.columnOrders, ...layout.columns };
    this.groupOrders = { ...this.groupOrders, ...layout.groups };
  }

  // A sport setting set to a value (the footer's dropdown)
  setSportSetting(key: string, value: string | boolean): void {
    this.updateSettings({ sport: { ...this.settings.sport, [key]: value } });
  }

  // A sport setting: the next of its options, or flipped
  stepSportSetting(key: string): void {
    const setting = SPORT.settings?.find((s) => s.key === key);
    if (!setting) return;
    const value = this.settings.sport[key];
    const options = setting.options ? Object.keys(setting.options) : null;
    const next = options ? options[(options.indexOf(value as string) + 1) % options.length] : !value;
    this.updateSettings({ sport: { ...this.settings.sport, [key]: next } });
  }

  // Cycle Season Totals -> Per Game -> Full-Season Pace
  cycleStatBasis(): void {
    const order: StatBasis[] = ['season', 'perGame', 'pace17'];
    this.updateSettings({ statBasis: order[(order.indexOf(this.settings.statBasis) + 1) % order.length] });
  }
}
