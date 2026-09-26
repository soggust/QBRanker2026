import { Component } from '@angular/core';
import { FilterService } from '../services/filter.service';
import { PositionService } from '../services/position.service';
import { Filters } from 'app/types';
import {
  POSITIONS,
  Position,
  SKILL_STATS,
  SkillPosition,
  SkillPreset,
  SkillStat,
  SkillWeights,
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
  fantasyValue: number = 0;
  recencyValue: number = 50;
  yardsExpanded: boolean = false;
  tdsExpanded: boolean = false;
  tosExpanded: boolean = false;
  advancedExpanded: boolean = false;
  supportExpanded: boolean = false;
  preset: string = 'default';

  // Position Tabs
  positions: Position[] = POSITIONS;
  position: Position = 'QB';
  skillStats: SkillStat[] = [];
  skillWeights: SkillWeights = {};
  skillPresets: Record<SkillPosition, SkillPreset | 'custom'> = {
    RB: 'default',
    WR: 'default',
    TE: 'default',
  };

  constructor(
    private filterService: FilterService,
    private positionService: PositionService,
  ) {}

  ngOnInit(): void {
    this.saveFilters();

    // Open the tab from a shared link, e.g. ?pos=WR
    const linked = new URLSearchParams(location.search).get('pos')?.toUpperCase();
    const match = this.positions.find((position) => position === linked);
    if (match) this.selectPosition(match);
  }

  get skillPosition(): SkillPosition | null {
    return this.position === 'QB' ? null : this.position;
  }

  selectPosition(position: Position): void {
    this.position = position;
    this.positionService.setPosition(position);

    const url = new URL(location.href);
    if (position === 'QB') url.searchParams.delete('pos');
    else url.searchParams.set('pos', position);
    history.replaceState(null, '', url);

    if (position !== 'QB') {
      this.skillStats = SKILL_STATS[position];
      this.skillWeights = { ...this.positionService.getWeights(position) };
    }
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
    switch (this.preset) {
      case 'default':
        this.reset();
        break;

      case 'stats':
        this.statsOnly();
        break;

      case 'mvp':
        this.mvp();
        break;

      case 'fantasy':
        this.fantasyOnly();
        break;

      case 'support':
        this.leastSupport();
        break;

      default:
        break;
    }
  }

  setCustomFilter() {
    this.preset = 'custom';
  }

  statsOnly() {
    this.recordValue = 0;
    this.compValue = 50;
    this.yardsValue = 50;
    this.passYdValue = 50;
    this.rushYdValue = 50;
    this.ypaValue = 50;
    this.touchdownValue = 50;
    this.passTdValue = 50;
    this.rushTdValue = 50;
    this.turnoverValue = 50;
    this.intValue = 50;
    this.fumLostValue = 50;
    this.supportValue = 0;
    this.weaponsValue = 50;
    this.coachingValue = 50;
    this.olineValue = 50;
    this.defenseValue = 50;
    this.responsibilityValue = 50;
    this.ratingValue = 50;
    this.advancedValue = 50;
    this.epaValue = 50;
    this.cpoeValue = 50;
    this.successValue = 50;
    this.fantasyValue = 0;
    this.recencyValue = 0;
    this.yardsExpanded = false;
    this.tdsExpanded = false;
    this.tosExpanded = false;
    this.advancedExpanded = false;
    this.supportExpanded = false;
    this.saveFilters();
  }

  leastSupport() {
    this.recordValue = 0;
    this.compValue = 0;
    this.yardsValue = 0;
    this.passYdValue = 0;
    this.rushYdValue = 0;
    this.ypaValue = 0;
    this.touchdownValue = 0;
    this.passTdValue = 0;
    this.rushTdValue = 0;
    this.turnoverValue = 0;
    this.intValue = 0;
    this.fumLostValue = 0;
    this.supportValue = 50;
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
    this.fantasyValue = 0;
    this.recencyValue = 0;
    this.yardsExpanded = false;
    this.tdsExpanded = false;
    this.tosExpanded = false;
    this.advancedExpanded = false;
    this.supportExpanded = false;
    this.saveFilters();
  }

  mvp() {
    this.recordValue = 75;
    this.compValue = 15;
    this.yardsValue = 60;
    this.passYdValue = 50;
    this.rushYdValue = 50;
    this.ypaValue = 35;
    this.touchdownValue = 75;
    this.passTdValue = 50;
    this.rushTdValue = 50;
    this.turnoverValue = 75;
    this.intValue = 50;
    this.fumLostValue = 50;
    this.supportValue = 35;
    this.weaponsValue = 25;
    this.coachingValue = 25;
    this.olineValue = 25;
    this.defenseValue = 25;
    this.responsibilityValue = 75;
    this.ratingValue = 50;
    this.advancedValue = 35;
    this.epaValue = 50;
    this.cpoeValue = 50;
    this.successValue = 50;
    this.fantasyValue = 0;
    this.recencyValue = 15;
    this.yardsExpanded = false;
    this.tdsExpanded = false;
    this.tosExpanded = false;
    this.advancedExpanded = false;
    this.supportExpanded = false;
    this.saveFilters();
  }

  // Rank purely on fantasy points (scoring is set in the settings menu)
  fantasyOnly() {
    this.clearFilters();
    this.advancedValue = 100;
    this.epaValue = 0;
    this.cpoeValue = 0;
    this.successValue = 0;
    this.fantasyValue = 100;
    this.advancedExpanded = true;
    this.saveFilters();
  }

  reset() {
    this.recordValue = 50;
    this.compValue = 50;
    this.yardsValue = 50;
    this.passYdValue = 50;
    this.rushYdValue = 50;
    this.ypaValue = 50;
    this.touchdownValue = 50;
    this.passTdValue = 50;
    this.rushTdValue = 50;
    this.turnoverValue = 50;
    this.intValue = 50;
    this.fumLostValue = 50;
    this.supportValue = 50;
    this.weaponsValue = 50;
    this.coachingValue = 50;
    this.olineValue = 50;
    this.defenseValue = 50;
    this.responsibilityValue = 50;
    this.ratingValue = 50;
    this.advancedValue = 50;
    this.epaValue = 50;
    this.cpoeValue = 50;
    this.successValue = 50;
    this.fantasyValue = 0;
    this.recencyValue = 50;
    this.yardsExpanded = false;
    this.tdsExpanded = false;
    this.tosExpanded = false;
    this.advancedExpanded = false;
    this.supportExpanded = false;
    this.saveFilters();
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
    this.fantasyValue = 0;
    this.recencyValue = 0;

    this.saveFilters();
  }
}
