import { Component } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { SKILL_PRESETS, SkillPresetDef } from 'app/skill-presets';
import { FilterService } from '../services/filter.service';
import { PositionService } from '../services/position.service';
import { Filters } from 'app/types';
import { QB_PRESETS, QB_PRESET_ORDER, QbPresetKey } from 'app/qb-presets';
import { FilterGroup, FilterKey, FilterRow, QB_FILTER_GROUPS, QB_ROW_COLUMNS, QbGroupId } from 'app/qb-filter-groups';

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
  presetWeights,
  combinedFor,
} from 'app/positions';

// A sidebar row on the other tabs: one stat, or a rush / rec pair shown as a parent slider with the
// two as its expandable breakdown
export interface SkillRow {
  key: SkillColumnKey;
  label: string;
  description: string;
  stat?: SkillStat;
  children?: SkillStat[];
}

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
  // Slider groups: which groups and sub-slider rows are open (every card starts collapsed on
  // each page load; open / closed isn't remembered)
  qbGroups = QB_FILTER_GROUPS;
  groupOpen: Record<QbGroupId, boolean> = { results: false, box: false, advanced: false, support: false };
  rowOpen: Partial<Record<FilterKey, boolean>> = {};
  // Other tabs: this position's stat groups, which are open, and which are switched off
  skillGroupList: SkillStatGroup[] = [];
  skillGroupOpen: Record<string, boolean> = {};
  skillHidden: Partial<Record<StatGroupId, boolean>> = {};
  hiddenGroups: Record<QbGroupId, boolean> = { results: false, box: false, advanced: false, support: false };
  // null: the default weights, shown as the dropdown's "Presets..." placeholder ("Defaults" isn't a
  // pickable preset; the Defaults button resets to it)
  preset: string | null = null;
  qbPresets = QB_PRESET_ORDER.filter((key) => key !== 'default').map((key) => ({ key, ...QB_PRESETS[key] }));

  // Current position (switched from the bar above the rankings)
  position: Position = 'QB';
  skillStats: SkillStat[] = [];
  skillWeights: SkillWeights = {};
  // Per tab, the same as preset above (null = default weights, shown as "Presets...")
  skillPresets: Record<SkillPosition, SkillPreset | 'custom' | null> = {
    RB: null,
    WR: null,
    TE: null,
    OL: null,
    K: null,
    P: null,
    DEF: null,
    HC: null,
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

  // ---------------------------------------------------------------------------
  // Drag to reorder: the category cards set the grid's group order, and the rows inside a card set
  // its column order (the same order the grid's header drag changes). Both reset on refresh.
  // ---------------------------------------------------------------------------
  get orderedQbGroups(): FilterGroup[] {
    const order = this.positionService.groupOrder('QB');
    return [...this.qbGroups].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  get orderedSkillGroups(): SkillStatGroup[] {
    const order = this.positionService.groupOrder(this.position);
    return [...this.skillGroupList].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  dropQbGroup(event: CdkDragDrop<unknown>) {
    this.moveGroup('QB', this.orderedQbGroups.map((group) => group.id), event);
  }

  dropSkillGroup(event: CdkDragDrop<unknown>) {
    this.moveGroup(this.position, this.orderedSkillGroups.map((group) => group.id), event);
  }

  // Groups a tab doesn't have keep their place at the end of its order
  private moveGroup(position: Position, shown: StatGroupId[], event: CdkDragDrop<unknown>) {
    moveItemInArray(shown, event.previousIndex, event.currentIndex);
    const rest = this.positionService.groupOrder(position).filter((id) => !shown.includes(id));
    this.positionService.setGroupOrder(position, [...shown, ...rest]);
  }

  // QB rows, ordered by where their columns sit in the grid
  private qbColumnOrder(group: FilterGroup): string[] {
    const defaults = group.rows.flatMap((row) => QB_ROW_COLUMNS[row.key] ?? []);
    return this.positionService.columnOrder(`QB.${group.id}`, defaults);
  }

  orderedRows(group: FilterGroup): FilterRow[] {
    const order = this.qbColumnOrder(group);
    const at = (row: FilterRow) => Math.min(...(QB_ROW_COLUMNS[row.key] ?? []).map((col) => order.indexOf(col)));
    return [...group.rows].sort((a, b) => at(a) - at(b));
  }

  // Moving a row moves its columns together, keeping their order among themselves
  dropQbRow(group: FilterGroup, event: CdkDragDrop<unknown>) {
    const rows = this.orderedRows(group);
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    const current = this.qbColumnOrder(group);
    const columns = rows.flatMap((row) =>
      [...(QB_ROW_COLUMNS[row.key] ?? [])].sort((a, b) => current.indexOf(a) - current.indexOf(b)),
    );
    this.positionService.setColumnOrder(`QB.${group.id}`, columns);
  }

  // Other tabs: a card's stats in the grid's column order
  orderedStats(group: SkillStatGroup): SkillStat[] {
    const order = this.positionService.columnOrder(
      `${this.position}.${group.id}`,
      group.stats.map((stat) => stat.key),
    );
    return [...group.stats].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  // A card's rows: rush / rec pairs become one parent row where the first of the two sits
  skillRows(group: SkillStatGroup): SkillRow[] {
    const stats = this.orderedStats(group);
    const pairs = this.skillPosition ? combinedFor(this.skillPosition) : [];
    const rows: SkillRow[] = [];
    const used = new Set<string>();
    for (const stat of stats) {
      if (used.has(stat.key)) continue;
      const pair = pairs.find(({ parts }) => parts.includes(stat.key) && parts.every((p) => stats.some((s) => s.key === p)));
      if (pair) {
        const children = stats.filter((s) => pair.parts.includes(s.key));
        children.forEach((child) => used.add(child.key));
        rows.push({ key: pair.stat.key, label: pair.stat.label, description: pair.stat.description, children });
      } else {
        rows.push({ key: stat.key, label: stat.label, description: stat.description, stat });
      }
    }
    return rows;
  }

  // Moving a parent row moves its breakdown's columns together
  dropSkillStat(group: SkillStatGroup, event: CdkDragDrop<unknown>) {
    const rows = this.skillRows(group);
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    const keys = rows.flatMap((row) => (row.children ? row.children.map((child) => child.key) : [row.key]));
    this.positionService.setColumnOrder(`${this.position}.${group.id}`, keys);
  }

  // Which parent rows have their breakdown open (per tab)
  private skillRowOpen: Record<string, boolean> = {};

  skillRowIsOpen(key: string): boolean {
    return !!this.skillRowOpen[`${this.position}.${key}`];
  }

  toggleSkillRow(key: string) {
    const id = `${this.position}.${key}`;
    this.skillRowOpen = { ...this.skillRowOpen, [id]: !this.skillRowOpen[id] };
  }

  // A breakdown slider dims when it or its parent is at 0 or switched off
  skillRowOff(key: SkillColumnKey, parent?: SkillColumnKey): boolean {
    const off = (k: SkillColumnKey) => !this.skillWeights[k] || this.skillStatHidden(k);
    return off(key) || (!!parent && off(parent));
  }

  get skillPosition(): SkillPosition | null {
    return this.position === 'QB' ? null : this.position;
  }

  // This position's presets (skill-presets.ts)
  get skillPresetOptions(): SkillPresetDef[] {
    return this.skillPosition ? SKILL_PRESETS[this.skillPosition] : [];
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
  }

  toggleSkillGroupHidden(id: StatGroupId) {
    const skill = this.skillPosition;
    if (skill) this.positionService.setSkillGroupHidden(skill, id, !this.skillHidden[id]);
  }

  // Eye on a slider: hides the stat's column and drops it from the ranking, whatever Unweighted Stats
  // says; the slider keeps its value for when it's switched back on
  skillStatHidden(key: SkillColumnKey): boolean {
    return this.positionService.isStatHidden(this.position, key);
  }

  toggleSkillSlider(key: SkillColumnKey) {
    this.positionService.setStatHidden(this.position, key, !this.skillStatHidden(key));
  }

  // Footer Buttons
  resetDefaults(): void {
    this.positionService.showAllStats(this.position);
    const skill = this.skillPosition;
    if (!skill) {
      this.reset();
      this.preset = null;
      return;
    }
    this.skillPresets[skill] = null;
    this.skillWeights = presetWeights(skill, 'default');
    this.saveSkillWeights();
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
    if (this.preset && this.preset !== 'custom') this.applyPreset(this.preset as QbPresetKey);
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

  // Eye on a slider: hides its columns and drops it from the ranking, whatever Unweighted Stats says
  isHidden(key: FilterKey): boolean {
    return this.positionService.isStatHidden('QB', key);
  }

  toggleSlider(key: FilterKey) {
    this.positionService.setStatHidden('QB', key, !this.isHidden(key));
  }

  // Dimmed when the slider (or the group / row it belongs to) is at 0 or switched off
  isOff(key: FilterKey, parent?: FilterKey): boolean {
    const off = (k: FilterKey) => this.valueOf(k) === 0 || this.isHidden(k);
    return off(key) || (!!parent && off(parent));
  }

  toggleGroupHidden(id: QbGroupId) {
    this.filterService.setGroupHidden(id, !this.hiddenGroups[id]);
  }

  toggleGroup(id: QbGroupId) {
    this.setGroupOpen(id, !this.groupOpen[id]);
  }

  setGroupOpen(id: QbGroupId, open: boolean) {
    this.groupOpen = { ...this.groupOpen, [id]: open };
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
