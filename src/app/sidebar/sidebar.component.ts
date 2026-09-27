import { Component } from '@angular/core';
import { FilterService } from '../services/filter.service';
import { PositionService } from '../services/position.service';
import { Filters } from 'app/types';
import { QB_PRESETS, QB_PRESET_ORDER, QbPresetKey } from 'app/qb-presets';
import { FilterKey, QB_FILTER_GROUPS, QbGroupId } from 'app/qb-filter-groups';

const GROUPS_KEY = 'qbFilterGroups';
const SKILL_GROUPS_KEY = 'skillFilterGroups';

// Open cards on the other tabs, keyed "WR.advanced" etc. (all collapsed on a first visit)
function readSkillGroupOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SKILL_GROUPS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// Every card starts collapsed on a first visit; after that the open / closed state is remembered
function readGroupOpen(): Record<QbGroupId, boolean> {
  const fallback = { results: false, box: false, advanced: false, support: false };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}
import {
  Position,
  SKILL_STATS,
  SkillColumnKey,
  SkillPosition,
  SkillPreset,
  SkillStatGroup,
  StatGroupId,
  skillGroups,
  SkillStat,
  SkillWeights,
  hasFantasy,
  presetWeights,
} from 'app/positions';

@Component({
    selector: 'sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
    standalone: false
})
export class SidebarComponent {
  recordValue: number = 50;
  compValue: number = 50;
  yardsValue: number = 50;
  passYdValue: number = 50;
  rushYdValue: number = 50;
  ypaValue: number = 50;
  touchdownValue: number = 50;
  passTdValue: number = 50;
  rushTdValue: number = 50;
  turnoverValue: number = 50;
  intValue: number = 50;
  fumLostValue: number = 50;
  supportValue: number = 50;
  weaponsValue: number = 50;
  coachingValue: number = 50;
  olineValue: number = 50;
  defenseValue: number = 50;
  responsibilityValue: number = 50;
  ratingValue: number = 50;
  advancedValue: number = 50;
  epaValue: number = 50;
  cpoeValue: number = 50;
  successValue: number = 50;
  fantasyValue: number = 50;
  pressureToSackValue: number = 50;
  badThrowValue: number = 50;
  timeToThrowValue: number = 50;
  adotValue: number = 50;
  aggressivenessValue: number = 50;
  recencyValue: number = 50;
  // Slider groups: which groups and sub-slider rows are open (groups remembered per browser)
  qbGroups = QB_FILTER_GROUPS;
  groupOpen: Record<QbGroupId, boolean> = readGroupOpen();
  rowOpen: Partial<Record<FilterKey, boolean>> = {};
  // Other tabs: this position's stat groups, which are open, and which are switched off
  skillGroupList: SkillStatGroup[] = [];
  skillGroupOpen: Record<string, boolean> = readSkillGroupOpen();
  skillHidden: Partial<Record<StatGroupId, boolean>> = {};
  private savedSkillValues: Record<string, number> = {};
  // Values sliders had before their eye switched them off
  private savedValues: Partial<Record<FilterKey, number>> = {};
  hiddenGroups: Record<QbGroupId, boolean> = { results: false, box: false, advanced: false, support: false };
  preset: string = 'default';
  qbPresets = QB_PRESET_ORDER.map((key) => ({ key, ...QB_PRESETS[key] }));

  // Current position (switched from the bar above the rankings)
  position: Position = 'QB';
  skillStats: SkillStat[] = [];
  skillWeights: SkillWeights = {};
  skillPresets: Record<SkillPosition, SkillPreset | 'custom'> = {
    RB: 'default',
    WR: 'default',
    TE: 'default',
    K: 'default',
    P: 'default',
    DEF: 'default',
    HC: 'default',
  };

  constructor(
    private filterService: FilterService,
    private positionService: PositionService,
  ) {}

  ngOnInit(): void {
    this.saveFilters();
    this.filterService.hiddenGroups$.subscribe((hidden) => (this.hiddenGroups = hidden));
    this.positionService.skillHidden$.subscribe((hidden) => {
      if (this.skillPosition) this.skillHidden = hidden[this.skillPosition] ?? {};
    });

    this.positionService.position$.subscribe((position) => {
      this.position = position;
      if (position !== 'QB') {
        this.skillStats = SKILL_STATS[position];
        this.skillGroupList = skillGroups(position);
        this.skillHidden = this.positionService.skillHiddenGroups(position);
        this.skillWeights = { ...this.positionService.getWeights(position) };
      }
    });
  }

  get skillPosition(): SkillPosition | null {
    return this.position === 'QB' ? null : this.position;
  }

  // Punters have no fantasy points, so no Fantasy preset
  get skillHasFantasy(): boolean {
    return !!this.skillPosition && hasFantasy(this.skillPosition);
  }

  onSkillPresetChange(): void {
    const skill = this.skillPosition;
    const preset = skill && this.skillPresets[skill];
    if (!skill || !preset || preset === 'custom') return;
    this.skillWeights = presetWeights(skill, preset);
    this.saveSkillWeights();
  }

  saveSkillWeights(): void {
    const skill = this.skillPosition;
    if (skill) this.positionService.saveWeights(skill, this.skillWeights);
  }

  skillGroupIsOpen(id: StatGroupId): boolean {
    return !!this.skillGroupOpen[`${this.position}.${id}`];
  }

  toggleSkillGroup(id: StatGroupId) {
    const key = `${this.position}.${id}`;
    this.skillGroupOpen = { ...this.skillGroupOpen, [key]: !this.skillGroupOpen[key] };
    try {
      localStorage.setItem(SKILL_GROUPS_KEY, JSON.stringify(this.skillGroupOpen));
    } catch {
      // Storage unavailable; the cards still open and close for this visit
    }
  }

  toggleSkillGroupHidden(id: StatGroupId) {
    const skill = this.skillPosition;
    if (skill) this.positionService.setSkillGroupHidden(skill, id, !this.skillHidden[id]);
  }

  // Eye on a slider: off saves the value and sets 0; on restores it (or 50 if none was saved)
  toggleSkillSlider(key: SkillColumnKey) {
    const skill = this.skillPosition;
    if (!skill) return;
    const saveKey = `${skill}.${key}`;
    const current = this.skillWeights[key] ?? 0;
    if (current) this.savedSkillValues[saveKey] = current;
    this.skillWeights = { ...this.skillWeights, [key]: current ? 0 : (this.savedSkillValues[saveKey] ?? 50) };
    this.skillPresets[skill] = 'custom';
    this.saveSkillWeights();
  }

  // Display-only columns (e.g. Games) have no weight in the ranking; a weight of 0 just hides them
  toggleInfoColumn(key: SkillColumnKey) {
    if (!this.skillPosition) return;
    this.skillWeights = { ...this.skillWeights, [key]: this.skillWeights[key] === 0 ? 50 : 0 };
    this.saveSkillWeights();
  }

  // Footer Buttons
  resetDefaults(): void {
    const skill = this.skillPosition;
    if (!skill) {
      this.preset = 'default';
      this.reset();
      return;
    }
    this.skillPresets[skill] = 'default';
    this.onSkillPresetChange();
  }

  clearAll(): void {
    const skill = this.skillPosition;
    if (!skill) {
      this.setCustomFilter();
      this.clearFilters();
      return;
    }
    this.skillPresets[skill] = 'custom';
    this.skillWeights = Object.fromEntries(this.skillStats.map((stat) => [stat.key, 0]));
    this.saveSkillWeights();
  }

  saveFilters(): void {
    const filters: Filters = {
      recordValue: this.recordValue,
      compValue: this.compValue,
      yardsValue: this.yardsValue,
      passYdValue: this.passYdValue,
      rushYdValue: this.rushYdValue,
      ypaValue: this.ypaValue,
      touchdownValue: this.touchdownValue,
      passTdValue: this.passTdValue,
      rushTdValue: this.rushTdValue,
      turnoverValue: this.turnoverValue,
      intValue: this.intValue,
      fumLostValue: this.fumLostValue,
      ratingValue: this.ratingValue,
      advancedValue: this.advancedValue,
      epaValue: this.epaValue,
      cpoeValue: this.cpoeValue,
      successValue: this.successValue,
      fantasyValue: this.fantasyValue,
      pressureToSackValue: this.pressureToSackValue,
      badThrowValue: this.badThrowValue,
      timeToThrowValue: this.timeToThrowValue,
      adotValue: this.adotValue,
      aggressivenessValue: this.aggressivenessValue,
      recencyValue: this.recencyValue,
      supportValue: this.supportValue,
      weaponsValue: this.weaponsValue,
      coachingValue: this.coachingValue,
      olineValue: this.olineValue,
      defenseValue: this.defenseValue,
      responsibilityValue: this.responsibilityValue,
    };

    this.filterService.saveFilters(filters);
  }

  onPresetChange() {
    if (this.preset !== 'custom') this.applyPreset(this.preset as QbPresetKey);
  }

  setCustomFilter() {
    this.preset = 'custom';
  }

  // Set every slider from a preset, open the group it focuses on, and rerank
  applyPreset(key: QbPresetKey) {
    const { values, expand } = QB_PRESETS[key];
    Object.assign(this, values);
    this.rowOpen = {};
    if (expand === 'advanced' || expand === 'support') this.setGroupOpen(expand, true);
    this.saveFilters();
  }

  valueOf(key: FilterKey): number {
    return (this as unknown as Filters)[key];
  }

  setValue(key: FilterKey, value: number) {
    (this as unknown as Filters)[key] = value;
    this.setCustomFilter();
    this.saveFilters();
  }

  // Eye on a slider: off saves the value and sets 0; on restores it (or 50 if none was saved)
  toggleSlider(key: FilterKey) {
    const current = this.valueOf(key);
    if (current) this.savedValues[key] = current;
    this.setValue(key, current ? 0 : (this.savedValues[key] ?? 50));
  }

  // Dimmed when the slider or the group/row it belongs to is at 0
  isOff(key: FilterKey, parent?: FilterKey): boolean {
    return this.valueOf(key) === 0 || (!!parent && this.valueOf(parent) === 0);
  }

  toggleGroupHidden(id: QbGroupId) {
    this.filterService.setGroupHidden(id, !this.hiddenGroups[id]);
  }

  toggleGroup(id: QbGroupId) {
    this.setGroupOpen(id, !this.groupOpen[id]);
  }

  setGroupOpen(id: QbGroupId, open: boolean) {
    this.groupOpen = { ...this.groupOpen, [id]: open };
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(this.groupOpen));
    } catch {
      // Storage unavailable; the groups still open and close for this visit
    }
  }

  reset() {
    this.applyPreset('default');
  }

  clearFilters() {
    this.recordValue = 0;
    this.compValue = 0;
    this.yardsValue = 0;
    this.passYdValue = 50;
    this.rushYdValue = 50;
    this.ypaValue = 0;
    this.touchdownValue = 0;
    this.passTdValue = 50;
    this.rushTdValue = 50;
    this.turnoverValue = 0;
    this.intValue = 50;
    this.fumLostValue = 50;
    this.supportValue = 0;
    this.weaponsValue = 50;
    this.coachingValue = 50;
    this.olineValue = 50;
    this.defenseValue = 50;
    this.responsibilityValue = 50;
    this.ratingValue = 0;
    this.advancedValue = 50;
    this.epaValue = 0;
    this.cpoeValue = 0;
    this.successValue = 0;
    this.pressureToSackValue = 0;
    this.badThrowValue = 0;
    this.timeToThrowValue = 0;
    this.adotValue = 0;
    this.aggressivenessValue = 0;
    this.fantasyValue = 0;
    this.recencyValue = 0;

    this.saveFilters();
  }
}
