import { Component } from '@angular/core';
import { PositionService } from './services/position.service';
import { POSITIONS, Position } from './positions';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false
})
export class AppComponent {
  position$ = this.positionService.position$;
  aboutOpen$ = this.positionService.aboutOpen$;
  positions = POSITIONS;
  positionNames: Record<Position, string> = {
    QB: 'Quarterbacks',
    RB: 'Running Backs',
    WR: 'Wide Receivers',
    TE: 'Tight Ends',
    OL: 'Offensive Lines',
    K: 'Kickers',
    P: 'Punters',
    DEF: 'Defenses',
    HC: 'Head Coaches',
  };

  // Below 1200px the filters are a slide-out menu (menu-open); above, a sidebar that collapses. Both
  // follow the one open / closed state (the footer's filter button and the menu's X).
  private readonly smallScreen = window.matchMedia('(max-width: 1199px)');

  constructor(private positionService: PositionService) {}

  get menuOpen(): boolean {
    return this.smallScreen.matches && this.positionService.filtersOpen;
  }

  get sidebarCollapsed(): boolean {
    return !this.smallScreen.matches && !this.positionService.filtersOpen;
  }

  closeFilters() {
    this.positionService.setFiltersOpen(false);
  }

  selectPosition(position: Position) {
    this.positionService.setPosition(position);
  }

  closeAbout() {
    this.positionService.setAboutOpen(false);
  }
}
