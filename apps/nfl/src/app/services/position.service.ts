import { dataWeight, preseasonCoaching, preseasonOline, preseasonWeapons, teamGamesPlayed } from 'StaticData/StaticData';
import { CURRENT_SEASON, dataSeason, loadData } from 'StaticData/data';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, distinctUntilChanged, map, shareReplay } from 'rxjs';
import { SKILL_UNITS, curveGrades, defaultRanking, gradesByRank, rebuildUnits } from 'app/utils/unit-scoring';
import {
  FantasyScoring,
  POSITIONS,
  Position,
  RankBasis,
  StatBasis,
  SkillPlayer,
  SkillPosition,
  SkillWeights,
  StatGroupId,
  presetWeights,
} from 'app/positions';

// Groups switched off with the sidebar eye, per position (every group is on at each page load)
export type HiddenGroups = Partial<Record<SkillPosition, Partial<Record<StatGroupId, boolean>>>>;

// Everything starts fresh on every page load: rankings, grades, filters, open cards and the settings
// menu. Clear what older versions of the app saved.
try {
  for (const key of ['qbFilterGroups', 'skillFilterGroups', 'qbHiddenGroups', 'skillHiddenGroups', 'rankerSettings']) {
    localStorage.removeItem(key);
  }
} catch {
  // Storage unavailable: nothing to clear
}

// Settings-menu toggles, shared by every position (back to the defaults on every page load)
export interface RankerSettings {
  // Counting stats as season totals, per game or at a 17-game pace
  statBasis: StatBasis;
  showUnused: boolean;
  showInjured: boolean;
  // Players with less than this share of the season's games are left out (0-100; 0 is everyone;
  // player tabs only)
  minShare: number;
  totalStats: boolean;
  // Tint values green / red by how far above / below the list average they are
  colorValues: boolean;
  // Carry each stat group's color down the rows (a thin bar before each group)
  categoryColors: boolean;
  fantasyScoring: FantasyScoring;
  // What the head coaches' Off / Def Rank columns rank on
  rankBasis: RankBasis;
  // Off: play-by-play stats leave out garbage time (plays with the game already decided)
  garbageTime: boolean;
}

// The Min Games setting: a share of the season so far, in steps of MIN_SHARE_STEP (0 is 1, everyone),
// of at most a full season
export const MAX_MIN_GAMES = 17;
export const MIN_SHARE_STEP = 10;
const DEFAULT_SETTINGS: RankerSettings = {
  statBasis: 'season',
  showUnused: false,
  showInjured: true,
  minShare: 10,
  totalStats: true,
  colorValues: true,
  categoryColors: true,
  fantasyScoring: 'ppr',
  rankBasis: 'points',
  garbageTime: true,
};


// Open the tab from a shared link, e.g. ?pos=WR
function linkedPosition(): Position {
  const linked = new URLSearchParams(location.search).get('pos')?.toUpperCase();
  return POSITIONS.find((position) => position === linked) ?? 'QB';
}

// Only emit when some team's grade actually changed; shared so every tab sees the same grades
function distinctGrades() {
  return (source: Observable<Map<string, number>>) =>
    source.pipe(
      distinctUntilChanged<Map<string, number>>(
        (a, b) => a.size === b.size && [...a].every(([team, grade]) => b.get(team) === grade),
      ),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
}

// A team grade for one position from its ranked list: each player graded by his spot (#1 = 12,
// last = 0), averaged per team weighted by usage (carries, targets...)
function teamGradesByUsage(ranked: SkillPlayer[], usage: (player: SkillPlayer) => number): Map<string, number> {
  const last = Math.max(ranked.length - 1, 1);
  const totals = new Map<string, { sum: number; usage: number }>();
  ranked.forEach((player, rank) => {
    const weight = usage(player);
    if (!weight) return;
    const total = totals.get(player.teamLogo) ?? { sum: 0, usage: 0 };
    totals.set(player.teamLogo, { sum: total.sum + 12 * (1 - rank / last) * weight, usage: total.usage + weight });
  });
  return new Map([...totals].map(([team, { sum, usage }]) => [team, sum / usage]));
}

// A receiver's targets, or his catches in the seasons that didn't record targets (2003-2008)
const looks = (p: SkillPlayer) => p.stats.targets ?? p.stats.receptions ?? 0;

// How much each position counts toward a team's weapons grade (receivers lead: it's mostly about
// who the QB throws to). A team missing a position splits its share among the others.
const WEAPONS_SHARES: [SkillPosition, number, (player: SkillPlayer) => number][] = [
  ['WR', 0.5, (p) => looks(p)],
  ['RB', 0.3, (p) => (p.stats.carries ?? 0) + looks(p)],
  ['TE', 0.2, (p) => looks(p)],
];

// Every team in the loaded season (logo path), for grades that cover the whole league (31 teams
// before 2002)
const allTeams = () => SKILL_UNITS.DEF.map((unit) => unit.teamLogo);

// A team grade that starts from preseason: each team's preseason grade blended with this season's
// grade (leaning on this season more with every game played), then curved so the best team is an
// A+ and the worst an F
function blendedCurve(preseason: (team: string) => number, season: Map<string, number>): Map<string, number> {
  const scores = new Map(
    allTeams().map((team) => {
      const start = preseason(team);
      const now = season.get(team);
      return [team, now === undefined ? start : start + (now - start) * dataWeight(teamGamesPlayed(team))];
    }),
  );
  return curveGrades(scores);
}

export interface UnitOrder {
  ids: string[];
  manual: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PositionService {
  // First, since the grade streams below read the settings
  private settingsSubject = new BehaviorSubject<RankerSettings>({ ...DEFAULT_SETTINGS });
  public settings$ = this.settingsSubject.asObservable();

  private positionSubject = new BehaviorSubject<Position>(linkedPosition());
  public position$: Observable<Position> = this.positionSubject.asObservable();

  // Slider weights per skill position, kept when switching tabs
  private weightsSubject = new BehaviorSubject<Record<SkillPosition, SkillWeights>>({
    QB: presetWeights('QB', 'default'),
    RB: presetWeights('RB', 'default'),
    WR: presetWeights('WR', 'default'),
    TE: presetWeights('TE', 'default'),
    OL: presetWeights('OL', 'default'),
    K: presetWeights('K', 'default'),
    P: presetWeights('P', 'default'),
    DEF: presetWeights('DEF', 'default'),
    HC: presetWeights('HC', 'default'),
  });
  public weights$ = this.weightsSubject.asObservable();

  // Each tab's order when it was last shown (unit ids, drags included), so a tab keeps its list
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

  // Load another season's data and show it. The rows are rebuilt first, then the orders swap to that
  // season's (which re-ranks every tab and re-grades the teams), then the pages hear the season changed.
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

  // Team defense / coaching / O-line grades (0-12) from the Defenses / Head Coaches / Offensive Lines
  // tabs as last shown, drags included (#1 = A+). Before a tab has been opened, from its default slider
  // ranking. Each tab only re-sorts while it's on screen, so they can feed each other without looping.
  public defenseGrades$ = this.teamGradesFrom('DEF');
  public coachingGrades$ = this.teamGradesFrom('HC');
  public olineGrades$ = this.teamGradesFrom('OL');

  // A tab's list as last shown (or its default slider ranking before it's been opened), best first
  private rankedUnits(position: SkillPosition): Observable<SkillPlayer[]> {
    // Only the settings that change a default ranking
    const rankingSettings$ = this.settingsSubject.pipe(
      map(({ garbageTime, rankBasis }) => ({ garbageTime, rankBasis })),
      distinctUntilChanged((a, b) => a.garbageTime === b.garbageTime && a.rankBasis === b.rankBasis),
    );
    return combineLatest([this.weightsSubject, this.unitOrdersSubject, rankingSettings$]).pipe(
      map(([weights, orders, { garbageTime, rankBasis }]) => {
        const order = orders[position];
        if (!order) return defaultRanking(position, weights[position], garbageTime, rankBasis);
        const byId = new Map(SKILL_UNITS[position].map((unit) => [unit.gsisId, unit]));
        return order.ids.map((id) => byId.get(id)).filter((unit) => !!unit);
      }),
    );
  }

  private teamGradesFrom(position: 'DEF' | 'HC' | 'OL'): Observable<Map<string, number>> {
    return this.rankedUnits(position).pipe(map(gradesByRank), distinctGrades());
  }

  // RB Play: each back graded by his spot in the RB rankings (#1 = A+, last = F), averaged per team
  // weighted by carries, so the lead back counts most
  // QB Play: each QB graded by his spot in the QB rankings (#1 = 12, last = 0), averaged per team by
  // his starts there, then curved
  public qbPlayGrades$ = this.rankedUnits('QB').pipe(
    map((ranked) => {
      const last = Math.max(ranked.length - 1, 1);
      const totals = new Map<string, { sum: number; starts: number }>();
      ranked.forEach((qb, rank) => {
        for (const [team, starts] of Object.entries(qb.starts ?? {})) {
          const total = totals.get(team) ?? { sum: 0, starts: 0 };
          totals.set(team, { sum: total.sum + 12 * (1 - rank / last) * starts, starts: total.starts + starts });
        }
      });
      return curveGrades(new Map([...totals].map(([team, { sum, starts }]) => [team, sum / starts])));
    }),
    distinctGrades(),
  );

  public rbPlayGrades$ = this.rankedUnits('RB').pipe(
    map((ranked) => curveGrades(teamGradesByUsage(ranked, (rb) => rb.stats.carries ?? 0))),
    distinctGrades(),
  );

  // Weapons from this season: the team's RBs, WRs and TEs graded by the RB / WR / TE tabs' orders
  // (by usage within each position), combined by WEAPONS_SHARES. Blended with preseason in weaponsGrade.
  public weaponsGrades$ = combineLatest(WEAPONS_SHARES.map(([position]) => this.rankedUnits(position))).pipe(
    map((lists) => {
      const byPosition = lists.map((ranked, i) => teamGradesByUsage(ranked, WEAPONS_SHARES[i][2]));
      const teams = new Set(byPosition.flatMap((grades) => [...grades.keys()]));
      return new Map(
        [...teams].map((team) => {
          let sum = 0;
          let shares = 0;
          byPosition.forEach((grades, i) => {
            const grade = grades.get(team);
            if (grade === undefined) return;
            sum += grade * WEAPONS_SHARES[i][1];
            shares += WEAPONS_SHARES[i][1];
          });
          return [team, sum / shares];
        }),
      );
    }),
    distinctGrades(),
  );

  // Stats switched off with their sidebar eye, keyed "QB.compValue", "RB.carries"...: the column is
  // hidden whatever the Unweighted Stats setting says, and the stat drops out of the ranking (its slider
  // keeps its value). Every stat is on at each page load.
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

  // Order of the stat groups (categories) per tab, changed by dragging the sidebar cards. Starts in
  // the standard order on every page load and is kept while switching tabs.
  private groupOrders: Partial<Record<Position, StatGroupId[]>> = {};

  groupOrder(position: Position): StatGroupId[] {
    return this.groupOrders[position] ?? ['results', 'box', 'advanced', 'support'];
  }

  setGroupOrder(position: Position, order: StatGroupId[]): void {
    this.groupOrders = { ...this.groupOrders, [position]: order };
  }

  // Column order within each stat group, per tab ("QB.box", "RB.advanced"...), changed by dragging
  // a column header. Starts at each table's default order on every page load.
  private columnOrders: Record<string, string[]> = {};
  private columnDefaults: Record<string, string[]> = {};

  // A group's current column order; the table passes its default order (kept for moveColumn)
  columnOrder(list: string, defaults: string[]): string[] {
    this.columnDefaults[list] = defaults;
    return this.columnOrders[list] ?? defaults;
  }

  // Replace a group's whole column order (the sidebar's row drag)
  setColumnOrder(list: string, order: string[]): void {
    this.columnOrders = { ...this.columnOrders, [list]: order };
  }

  // Move a column to just before / after another column in the same group
  moveColumn(list: string, id: string, targetId: string, after: boolean): void {
    const order = [...(this.columnOrders[list] ?? this.columnDefaults[list] ?? [])].filter((col) => col !== id);
    const at = order.indexOf(targetId);
    if (at === -1) return;
    order.splice(after ? at + 1 : at, 0, id);
    this.columnOrders = { ...this.columnOrders, [list]: order };
  }

  // The O-line, weapons and coaching grades every page shows: preseason blended with the Offensive
  // Lines / RB, WR and TE / Head Coaches rankings, then curved (see blendedCurve)
  private olineCurve = new Map<string, number>();
  private weaponsCurve = new Map<string, number>();
  private coachingCurve = new Map<string, number>();

  constructor() {
    // Subscribed before any page, so the grades are current when the pages hear about a change
    this.olineGrades$.subscribe((grades) => (this.olineCurve = blendedCurve(preseasonOline, grades)));
    this.weaponsGrades$.subscribe((grades) => (this.weaponsCurve = blendedCurve(preseasonWeapons, grades)));
    this.coachingGrades$.subscribe((grades) => (this.coachingCurve = blendedCurve(preseasonCoaching, grades)));
  }

  // A team's grade, as a whole grade (0 = F ... 12 = A+)
  olineGrade(teamLogo: string): number {
    return Math.round(this.olineCurve.get(teamLogo) ?? 6);
  }

  weaponsGrade(teamLogo: string): number {
    return Math.round(this.weaponsCurve.get(teamLogo) ?? 6);
  }

  coachingGrade(teamLogo: string): number {
    return Math.round(this.coachingCurve.get(teamLogo) ?? 6);
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



  private fantasyScoringSubject = new BehaviorSubject<FantasyScoring>(this.settingsSubject.value.fantasyScoring);
  public fantasyScoring$ = this.fantasyScoringSubject.asObservable();

  get settings(): RankerSettings {
    return this.settingsSubject.value;
  }

  updateSettings(changes: Partial<RankerSettings>): void {
    this.settingsSubject.next({ ...this.settingsSubject.value, ...changes });
  }

  setPosition(position: Position): void {
    this.positionSubject.next(position);

    const url = new URL(location.href);
    if (position === 'QB') url.searchParams.delete('pos');
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


  get fantasyScoring(): FantasyScoring {
    return this.fantasyScoringSubject.value;
  }

  // Cycle Season Totals -> Per Game -> 17-Game Pace
  cycleStatBasis(): void {
    const order: StatBasis[] = ['season', 'perGame', 'pace17'];
    this.updateSettings({ statBasis: order[(order.indexOf(this.settings.statBasis) + 1) % order.length] });
  }

  // Switch Points <-> Yards
  cycleRankBasis(): void {
    const order: RankBasis[] = ['points', 'yards'];
    this.updateSettings({ rankBasis: order[(order.indexOf(this.settings.rankBasis) + 1) % order.length] });
  }

  // Cycle PPR -> Half -> Standard
  cycleFantasyScoring(): void {
    const order: FantasyScoring[] = ['ppr', 'half', 'std'];
    const next = order[(order.indexOf(this.fantasyScoring) + 1) % order.length];
    this.fantasyScoringSubject.next(next);
    this.updateSettings({ fantasyScoring: next });
  }
}
