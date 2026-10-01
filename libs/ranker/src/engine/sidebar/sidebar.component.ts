import { Component } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { SKILL_PRESETS, SkillPresetDef } from '@sport/skill-presets';
import { PositionService } from '@ranker/engine/position.service';
import { SPORT } from '@sport/sport';
import { combinedFor, statIsEmpty } from '@ranker/engine/unit-scoring';

import {
  POSITIONS,
  Position,
  SKILL_STATS,
  SkillColumnKey,
  SkillPreset,
  SkillStatGroup,
  StatGroupId,
  skillGroups,
  SkillStat,
  SkillWeights,
  presetWeights,
} from '@sport/positions';

// A sidebar row: one stat, or a pair (e.g. rushing + receiving yards) shown as a parent slider with
// the two as its expandable breakdown
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
    styleUrls: ['../../styles/components/sidebar.component.scss'],
    standalone: false
})
export class SidebarComponent {
  // (the menu's title and ball)
  readonly sport = SPORT;

  // This tab's stat groups, which are open (every card starts collapsed on each page load; open /
  // closed isn't remembered), and which are switched off
  skillGroupList: SkillStatGroup[] = [];
  skillGroupOpen: Record<string, boolean> = {};
  skillHidden: Partial<Record<StatGroupId, boolean>> = {};

  // Current position (switched from the bar above the rankings)
  position: Position = POSITIONS[0];
  skillStats: SkillStat[] = [];
  skillWeights: SkillWeights = {};
  // Each tab's preset (null = default weights, shown as the dropdown's "Presets..." placeholder;
  // "Defaults" isn't a pickable preset, the Reset button goes back to it)
  skillPresets = Object.fromEntries(POSITIONS.map((position) => [position, null])) as Record<
    Position,
    SkillPreset | 'custom' | null
  >;

  constructor(private positionService: PositionService) {}

  closeFilters(): void {
    this.positionService.setFiltersOpen(false);
  }

  ngOnInit(): void {

    this.positionService.skillHidden$.subscribe((hidden) => {
      this.skillHidden = hidden[this.position] ?? {};
    });

    this.positionService.position$.subscribe((position) => {
      this.position = position;
      this.skillStats = SKILL_STATS[position];
      this.skillGroupList = skillGroups(position);
      this.skillHidden = this.positionService.skillHiddenGroups(position);
      this.skillWeights = { ...this.positionService.getWeights(position) };
    });
  }

  // ---------------------------------------------------------------------------
  // Drag to reorder: the category cards set the grid's group order, and the rows inside a card set
  // its column order (the same order the grid's header drag changes). Both reset on refresh.
  // ---------------------------------------------------------------------------
  get orderedSkillGroups(): SkillStatGroup[] {
    const order = this.positionService.groupOrder(this.position);
    return [...this.skillGroupList].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  // Groups a tab doesn't have keep their place at the end of its order
  dropSkillGroup(event: CdkDragDrop<unknown>) {
    const shown = this.orderedSkillGroups.map((group) => group.id);
    moveItemInArray(shown, event.previousIndex, event.currentIndex);
    const rest = this.positionService.groupOrder(this.position).filter((id) => !shown.includes(id));
    this.positionService.setGroupOrder(this.position, [...shown, ...rest]);
  }

  // A card's stats in the grid's column order
  orderedStats(group: SkillStatGroup): SkillStat[] {
    const order = this.positionService.columnOrder(
      `${this.position}.${group.id}`,
      group.stats.map((stat) => stat.key),
    );
    return [...group.stats].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  // A card's rows: one slider per stat, and a combined pair (SPORT.combined: Total Yds) as one parent
  // row where the first of the two sits
  skillRows(group: SkillStatGroup): SkillRow[] {
    // Stats not recorded in the loaded season (Statcast's before 2015, drops before 2018) have no slider
    const stats = this.orderedStats(group).filter((stat) => !statIsEmpty(this.position, stat.key));
    const pairs = combinedFor(this.position);
    const rows: SkillRow[] = [];
    const used = new Set<string>();
    for (const stat of stats) {
      if (used.has(stat.key)) continue;
      const pair = pairs.find(({ parts }) => (parts as string[]).includes(stat.key) && parts.every((p) => stats.some((s) => s.key === p)));
      if (pair) {
        const children = stats.filter((s) => (pair.parts as string[]).includes(s.key));
        children.forEach((child) => used.add(child.key));
        rows.push({ key: pair.stat.key, label: pair.stat.label, description: pair.stat.description, children });
      } else {
        const label = SPORT.statLabel?.(stat, this.positionService.settings.sport) ?? stat.label;
        rows.push({ key: stat.key, label, description: stat.description, stat });
      }
    }
    return rows;
  }

  // Moving a parent row moves its breakdown's columns together
  dropSkillStat(group: SkillStatGroup, event: CdkDragDrop<unknown>) {
    const rows = this.skillRows(group);
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    const keys = rows.flatMap((row) => (row.children ? row.children.map((child) => child.key) : [row.key]));
    // Stats this season has no row for keep their place at the end
    const rest = this.orderedStats(group).map((stat) => stat.key).filter((key) => !keys.includes(key));
    this.positionService.setColumnOrder(`${this.position}.${group.id}`, [...keys, ...rest]);
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

  // A slider row dims when its eye (or its parent row's) is switched off; a slider at 0% keeps its
  // white label and football
  skillRowOff(key: SkillColumnKey, parent?: SkillColumnKey): boolean {
    return this.skillStatHidden(key) || (!!parent && this.skillStatHidden(parent));
  }

  // This tab's presets (skill-presets.ts)
  get skillPresetOptions(): SkillPresetDef[] {
    return SKILL_PRESETS[this.position];
  }

  onSkillPresetChange(): void {
    const preset = this.skillPresets[this.position];
    if (!preset || preset === 'custom') return;
    this.skillWeights = presetWeights(this.position, preset);
    this.saveSkillWeights();
  }

  saveSkillWeights(): void {
    this.positionService.saveWeights(this.position, this.skillWeights);
  }

  skillGroupIsOpen(id: StatGroupId): boolean {
    return !!this.skillGroupOpen[`${this.position}.${id}`];
  }

  toggleSkillGroup(id: StatGroupId) {
    const key = `${this.position}.${id}`;
    this.skillGroupOpen = { ...this.skillGroupOpen, [key]: !this.skillGroupOpen[key] };
  }

  toggleSkillGroupHidden(id: StatGroupId) {
    this.positionService.setSkillGroupHidden(this.position, id, !this.skillHidden[id]);
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
    this.skillPresets[this.position] = null;
    this.skillWeights = presetWeights(this.position, 'default');
    this.saveSkillWeights();
  }

  // Every slider to 0%, combined pairs' parent sliders included
  clearAll(): void {
    this.skillPresets[this.position] = 'custom';
    this.skillWeights = {
      ...Object.fromEntries(this.skillStats.map((stat) => [stat.key, 0])),
      ...Object.fromEntries(combinedFor(this.position).map(({ stat }) => [stat.key, 0])),
    };
    this.saveSkillWeights();
  }
}
