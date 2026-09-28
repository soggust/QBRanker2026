import { blendGrade, preseasonOline, preseasonWeapons, teamGamesPlayed } from 'StaticData/StaticData';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, distinctUntilChanged, map, shareReplay } from 'rxjs';
import { SKILL_UNITS, defaultRanking, gradesByRank } from 'app/utils/unit-scoring';
import {
  FantasyScoring,
  POSITIONS,
  Position,
  SkillPlayer,
  SkillPosition,
  SkillWeights,
  StatGroupId,
  presetWeights,
} from 'app/positions';

// Groups switched off with the sidebar eye, per position (every group is on at each page load)
export type HiddenGroups = Partial<Record<SkillPosition, Partial<Record<StatGroupId, boolean>>>>;

// Rankings, grades, filters and open cards start fresh on every page load; only the settings menu
// is remembered. Clear what older versions of the app saved for the rest.
try {
  for (const key of ['qbFilterGroups', 'skillFilterGroups', 'qbHiddenGroups', 'skillHiddenGroups']) {
    localStorage.removeItem(key);
  }
} catch {
  // Storage unavailable: nothing to clear
}

// Settings-menu toggles, shared by every position and remembered per browser
export interface RankerSettings {
  perGame: boolean;
  showUnused: boolean;
  showInjured: boolean;
  totalStats: boolean;
  // Tint values green / red by how far above / below the list average they are
  colorValues: boolean;
  // Carry each stat group's color down the rows (a thin bar before each group)
  categoryColors: boolean;
  fantasyScoring: FantasyScoring;
  // Off: play-by-play stats leave out garbage time (plays with the game already decided)
  garbageTime: boolean;
}

const SETTINGS_KEY = 'rankerSettings';
const DEFAULT_SETTINGS: RankerSettings = {
  perGame: false,
  showUnused: false,
  showInjured: true,
  totalStats: true,
  colorValues: true,
  categoryColors: true,
  fantasyScoring: 'ppr',
  garbageTime: true,
};

function readSettings(): RankerSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

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

// How much each position counts toward a team's weapons grade (receivers lead: it's mostly about
// who the QB throws to). A team missing a position splits its share among the others.
const WEAPONS_SHARES: [SkillPosition, number, (player: SkillPlayer) => number][] = [
  ['WR', 0.5, (p) => p.stats.targets ?? 0],
  ['RB', 0.3, (p) => (p.stats.carries ?? 0) + (p.stats.targets ?? 0)],
  ['TE', 0.2, (p) => p.stats.targets ?? 0],
];

export interface UnitOrder {
  ids: string[];
  manual: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PositionService {
  // First, since the grade streams below read the settings
  private settingsSubject = new BehaviorSubject<RankerSettings>(readSettings());
  public settings$ = this.settingsSubject.asObservable();

  private positionSubject = new BehaviorSubject<Position>(linkedPosition());
  public position$: Observable<Position> = this.positionSubject.asObservable();

  // Slider weights per skill position, kept when switching tabs
  private weightsSubject = new BehaviorSubject<Record<SkillPosition, SkillWeights>>({
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

  unitOrder(position: SkillPosition): UnitOrder | undefined {
    return this.unitOrdersSubject.value[position];
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
    const garbageTime$ = this.settingsSubject.pipe(
      map((settings) => settings.garbageTime),
      distinctUntilChanged(),
    );
    return combineLatest([this.weightsSubject, this.unitOrdersSubject, garbageTime$]).pipe(
      map(([weights, orders, garbageTime]) => {
        const order = orders[position];
        if (!order) return defaultRanking(position, weights[position], garbageTime);
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
  public rbPlayGrades$ = this.rankedUnits('RB').pipe(
    map((ranked) => teamGradesByUsage(ranked, (rb) => rb.stats.carries ?? 0)),
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

  // Every stat on this tab back on (the Defaults button)
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

  // Latest grades from the Offensive Lines tab and the RB / WR / TE tabs (kept for olineGrade and
  // weaponsGrade)
  private olineTabGrades = new Map<string, number>();
  private weaponsTabGrades = new Map<string, number>();

  constructor() {
    // Subscribed before any page, so the grades are current when the pages hear about a change
    this.olineGrades$.subscribe((grades) => (this.olineTabGrades = grades));
    this.weaponsGrades$.subscribe((grades) => (this.weaponsTabGrades = grades));
  }

  // A team's O-line grade: the preseason grade blended with the Offensive Lines tab's order, leaning
  // on the ranking more with every game played (like coaching)
  olineGrade(teamLogo: string): number {
    return blendGrade(preseasonOline(teamLogo), this.olineTabGrades.get(teamLogo), teamGamesPlayed(teamLogo));
  }

  // A team's weapons grade: the preseason grade blended the same way with the RB / WR / TE rankings
  weaponsGrade(teamLogo: string): number {
    return blendGrade(preseasonWeapons(teamLogo), this.weaponsTabGrades.get(teamLogo), teamGamesPlayed(teamLogo));
  }

  // The About / FAQ panel (the footer's info button opens it on every tab)
  private aboutOpenSubject = new BehaviorSubject<boolean>(false);
  public aboutOpen$ = this.aboutOpenSubject.asObservable();

  setAboutOpen(open: boolean): void {
    this.aboutOpenSubject.next(open);
  }

  // Current QB order (ESPN ids, best first) from the QB page, used for receivers' QB Play grade
  private qbRanksSubject = new BehaviorSubject<number[]>([]);
  public qbRanks$ = this.qbRanksSubject.asObservable();


  private fantasyScoringSubject = new BehaviorSubject<FantasyScoring>(this.settingsSubject.value.fantasyScoring);
  public fantasyScoring$ = this.fantasyScoringSubject.asObservable();

  get settings(): RankerSettings {
    return this.settingsSubject.value;
  }

  updateSettings(changes: Partial<RankerSettings>): void {
    const next = { ...this.settingsSubject.value, ...changes };
    this.settingsSubject.next(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable; the settings still apply for this visit
    }
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

  setQbRanks(ids: number[]): void {
    this.qbRanksSubject.next(ids);
  }

  get fantasyScoring(): FantasyScoring {
    return this.fantasyScoringSubject.value;
  }

  // Cycle PPR -> Half -> Standard
  cycleFantasyScoring(): void {
    const order: FantasyScoring[] = ['ppr', 'half', 'std'];
    const next = order[(order.indexOf(this.fantasyScoring) + 1) % order.length];
    this.fantasyScoringSubject.next(next);
    this.updateSettings({ fantasyScoring: next });
  }
}
