import { Component } from '@angular/core';
import { FilterService } from '../services/filter.service';
import { Filters } from 'app/types';

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
  recencyValue: number = 50;
  yardsExpanded: boolean = false;
  tdsExpanded: boolean = false;
  tosExpanded: boolean = false;
  advancedExpanded: boolean = false;
  supportExpanded: boolean = false;
  preset: string = 'default';

  constructor(private filterService: FilterService) {}

  ngOnInit(): void {
    this.saveFilters();
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
    this.recencyValue = 15;
    this.yardsExpanded = false;
    this.tdsExpanded = false;
    this.tosExpanded = false;
    this.advancedExpanded = false;
    this.supportExpanded = false;
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
    this.recencyValue = 0;

    this.saveFilters();
  }
}
