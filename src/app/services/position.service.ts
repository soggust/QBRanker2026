import { gradesForTeam } from 'StaticData/StaticData';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, distinctUntilChanged, map, shareReplay } from 'rxjs';
import { SKILL_UNITS, coachingGrades, defenseGrades, gradesByRank } from 'app/utils/unit-scoring';
import {
  FantasyScoring,
  POSITIONS,
  Position,
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

export interface UnitOrder {
  ids: string[];
  manual: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PositionService {
  private positionSubject = new BehaviorSubject<Position>(linkedPosition());
  public position$: Observable<Position> = this.positionSubject.asObservable();

  // Slider weights per skill position, kept when switching tabs
  private weightsSubject = new BehaviorSubject<Record<SkillPosition, SkillWeights>>({
    RB: presetWeights('RB', 'default'),
    WR: presetWeights('WR', 'default'),
    TE: presetWeights('TE', 'default'),
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

  // Team defense / coaching grades (0-12) from the Defenses / Head Coaches tabs as last shown, drags
  // included (#1 = A+). Before a tab has been opened, from its default slider ranking. Each tab only
  // re-sorts while it's on screen, so the two can feed each other without looping.
  public defenseGrades$ = this.teamGradesFrom('DEF');
  public coachingGrades$ = this.teamGradesFrom('HC');

  private teamGradesFrom(position: 'DEF' | 'HC'): Observable<Map<string, number>> {
    return combineLatest([this.weightsSubject, this.unitOrdersSubject]).pipe(
      map(([weights, orders]) => {
        const order = orders[position];
        if (!order) return position === 'DEF' ? defenseGrades(weights.DEF) : coachingGrades(weights.HC);
        const byId = new Map(SKILL_UNITS[position].map((unit) => [unit.gsisId, unit]));
        return gradesByRank(order.ids.map((id) => byId.get(id)).filter((unit) => !!unit));
      }),
      distinctUntilChanged((a, b) => a.size === b.size && [...a].every(([team, grade]) => b.get(team) === grade)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
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

  // Move a column to just before / after another column in the same group
  moveColumn(list: string, id: string, targetId: string, after: boolean): void {
    const order = [...(this.columnOrders[list] ?? this.columnDefaults[list] ?? [])].filter((col) => col !== id);
    const at = order.indexOf(targetId);
    if (at === -1) return;
    order.splice(after ? at + 1 : at, 0, id);
    this.columnOrders = { ...this.columnOrders, [list]: order };
  }

  // O-line grades changed with the +/- arrows, per team (logo path -> 0-12). Shared by the QB and
  // RB pages, so nudging a team's O-line on either tab moves it for every QB and RB on that team.
  private olineOverridesSubject = new BehaviorSubject<Record<string, number>>({});
  public olineOverrides$ = this.olineOverridesSubject.asObservable();

  // A team's O-line grade: the adjusted one if changed, otherwise the blended team grade
  olineGrade(teamLogo: string): number {
    return this.olineOverridesSubject.value[teamLogo] ?? gradesForTeam(teamLogo).oline;
  }

  // One grade step up or down (stays within F-A+)
  stepOlineGrade(teamLogo: string, direction: 'up' | 'down'): void {
    const current = this.olineGrade(teamLogo);
    const next = Math.min(12, Math.max(0, current + (direction === 'up' ? 1 : -1)));
    if (next === current) return;
    this.olineOverridesSubject.next({ ...this.olineOverridesSubject.value, [teamLogo]: next });
  }

  // Current QB order (ESPN ids, best first) from the QB page, used for receivers' QB Play grade
  private qbRanksSubject = new BehaviorSubject<number[]>([]);
  public qbRanks$ = this.qbRanksSubject.asObservable();

  private settingsSubject = new BehaviorSubject<RankerSettings>(readSettings());
  public settings$ = this.settingsSubject.asObservable();

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
