import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  FantasyScoring,
  POSITIONS,
  Position,
  SkillPosition,
  SkillWeights,
  StatGroupId,
  presetWeights,
} from 'app/positions';

// Groups switched off with the eye / header chips, per position (remembered per browser)
export type HiddenGroups = Partial<Record<SkillPosition, Partial<Record<StatGroupId, boolean>>>>;
const SKILL_HIDDEN_KEY = 'skillHiddenGroups';

function readSkillHidden(): HiddenGroups {
  try {
    return JSON.parse(localStorage.getItem(SKILL_HIDDEN_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// Settings-menu toggles, shared by every position and remembered per browser
export interface RankerSettings {
  perGame: boolean;
  showUnused: boolean;
  showInjured: boolean;
  totalStats: boolean;
  fantasyScoring: FantasyScoring;
}

const SETTINGS_KEY = 'rankerSettings';
const DEFAULT_SETTINGS: RankerSettings = {
  perGame: false,
  showUnused: false,
  showInjured: true,
  totalStats: true,
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

  private skillHiddenSubject = new BehaviorSubject<HiddenGroups>(readSkillHidden());
  public skillHidden$ = this.skillHiddenSubject.asObservable();

  skillHiddenGroups(position: SkillPosition): Partial<Record<StatGroupId, boolean>> {
    return this.skillHiddenSubject.value[position] ?? {};
  }

  setSkillGroupHidden(position: SkillPosition, id: StatGroupId, hidden: boolean): void {
    const current = this.skillHiddenSubject.value;
    const next = { ...current, [position]: { ...current[position], [id]: hidden } };
    this.skillHiddenSubject.next(next);
    try {
      localStorage.setItem(SKILL_HIDDEN_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable; the setting still applies for this visit
    }
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
