import { Component } from '@angular/core';
import { FilterService } from '../services/filter.service';
import { PositionService } from '../services/position.service';
import { Filters } from 'app/types';
import { QB_PRESETS, QB_PRESET_ORDER, QbPresetKey } from 'app/qb-presets';
import {
  Position,
  SKILL_STATS,
  SkillPosition,
  SkillPreset,
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
  yardsExpanded: boolean = false;
  tdsExpanded: boolean = false;
  tosExpanded: boolean = false;
  advancedExpanded: boolean = false;
  supportExpanded: boolean = false;
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

    this.positionService.position$.subscribe((position) => {
      this.position = position;
      if (position !== 'QB') {
        this.skillStats = SKILL_STATS[position];
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
    this.yardsExpanded = expand === 'yards';
    this.tdsExpanded = expand === 'tds';
    this.tosExpanded = expand === 'tos';
    this.advancedExpanded = expand === 'advanced';
    this.supportExpanded = expand === 'support';
    this.saveFilters();
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
    this.advancedValue = 0;
    this.epaValue = 50;
    this.cpoeValue = 50;
    this.successValue = 50;
    this.pressureToSackValue = 50;
    this.badThrowValue = 50;
    this.timeToThrowValue = 50;
    this.adotValue = 50;
    this.aggressivenessValue = 50;
    this.fantasyValue = 0;
    this.recencyValue = 0;

    this.saveFilters();
  }
}
