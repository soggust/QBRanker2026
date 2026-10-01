import { SPORT } from '@sport/sport';
import { CURRENT_SEASON, dataSeason, loadData } from '@ranker/engine/data';
import { Injectable } from '@angular/core';
import { BehaviorSubject, EMPTY, Observable, combineLatest, distinctUntilChanged, map } from 'rxjs';
import { DEFAULT_SPORT_SETTINGS, SKILL_UNITS, defaultRanking, rebuildUnits } from '@ranker/engine/unit-scoring';
import type { SportSettings } from '@ranker/engine/sport';
import { POSITIONS, Position, StatBasis, SkillPlayer, SkillPosition, SkillWeights, StatGroupId, presetWeights } from '@sport/positions';

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
  // Tint values green / red by how far above / below the list average they are
  colorValues: boolean;
  // Carry each stat group's color down the rows (a line before each group)
  categoryColors: boolean;
  // Show each combined pair (SPORT.combined: rushing + receiving yards) as one total column
  combineStats: boolean;
  // The sport's own settings (SPORT.settings), by key
  sport: SportSettings;
}

// The Min setting: a share of the season so far, in steps of MIN_SHARE_STEP (0 is 1, everyone)
export const MIN_SHARE_STEP = 10;
const DEFAULT_SETTINGS: RankerSettings = {
  statBasis: SPORT.defaultStatBasis,
  showUnused: false,
  showInjured: true,
  minShare: 10,
  colorValues: true,
  categoryColors: true,
  combineStats: true,
  sport: DEFAULT_SPORT_SETTINGS,
};

// Open the tab from a shared link, e.g. ?pos=SS
function linkedPosition(): Position {
  const linked = new URLSearchParams(location.search).get('pos')?.toUpperCase();
  return POSITIONS.find((position) => position === linked) ?? POSITIONS[0];
}

export interface UnitOrder {
  ids: string[];
  manual: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PositionService {
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
  public filtersOpen$ = this.filtersOpenSubject.asObservable();

  get filtersOpen(): boolean {
    return this.filtersOpenSubject.value;
  }

  setFiltersOpen(open: boolean): void {
    this.filtersOpenSubject.next(open);
  }

  // The season on screen (the year selector). Sliders, eyes and column orders carry over to another
  // season; each season keeps its own tab orders (drags included) while the page is open.
  private seasonSubject = new BehaviorSubject<number>(dataSeason);
  public season$ = this.seasonSubject.asObservable();
  private seasonLoadingSubject = new BehaviorSubject<boolean>(false);
  public seasonLoading$ = this.seasonLoadingSubject.asObservable();
  private ordersBySeason = new Map<number, Partial<Record<SkillPosition, UnitOrder>>>();

  get season(): number {
    return this.seasonSubject.value;
  }

  // Load another season's data and show it: the rows are rebuilt first, then the orders swap to that
  // season's, then the pages hear the season changed
  async setSeason(season: number): Promise<void> {
    if (season === this.season || this.seasonLoadingSubject.value) return;
    this.seasonLoadingSubject.next(true);
    try {
      await loadData(season);
      rebuildUnits();
      this.ordersBySeason.set(this.season, this.unitOrdersSubject.value);
      this.unitOrdersSubject.next(this.ordersBySeason.get(season) ?? {});
      this.seasonSubject.next(season);

      // A past season goes in the address, so a shared link opens it (?season=2024)
      const url = new URL(location.href);
      if (season === CURRENT_SEASON) url.searchParams.delete('season');
      else url.searchParams.set('season', String(season));
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
  // dragged by hand)
  seasonUnitOrder(season: number, position: SkillPosition): UnitOrder | undefined {
    return season === this.season ? this.unitOrder(position) : this.ordersBySeason.get(season)?.[position];
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

  // Column order within each stat group, per tab ("SS.box", "SP.advanced"...), changed by dragging
  // a column header. Starts at each table's default order on every page load.
  private columnOrders: Record<string, string[]> = {};
  private columnDefaults: Record<string, string[]> = {};

  columnOrder(list: string, defaults: string[]): string[] {
    this.columnDefaults[list] = defaults;
    return this.columnOrders[list] ?? defaults;
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
  rankedUnits(position: SkillPosition): Observable<SkillPlayer[]> {
    return combineLatest([this.weightsSubject, this.unitOrdersSubject, this.sportSettings$]).pipe(
      map(([weights, orders, settings]) => {
        const order = orders[position];
        if (!order) return defaultRanking(position, weights[position], SKILL_UNITS, settings);
        const byId = new Map(SKILL_UNITS[position].map((unit) => [unit.gsisId, unit]));
        return order.ids.map((id) => byId.get(id)).filter((unit) => !!unit);
      }),
    );
  }

  // The sport's values from other tabs (SPORT.connect), hooked up once: fires when they change. Hooked
  // up before any page, so the values are current when the pages hear about a change.
  public sportChanged$: Observable<unknown> =
    SPORT.connect?.({
      settings$: this.sportSettings$,
      rankedUnits: (position) => this.rankedUnits(position as SkillPosition),
      rows: () => SKILL_UNITS,
    }) ??
    EMPTY;

  get settings(): RankerSettings {
    return this.settingsSubject.value;
  }

  updateSettings(changes: Partial<RankerSettings>): void {
    this.settingsSubject.next({ ...this.settingsSubject.value, ...changes });
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
