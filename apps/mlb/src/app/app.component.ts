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
  // The sport bar across the top: each sport is its own app on the same site (apps/<sport>, served at
  // /<sport>/); this one is lit
  readonly sport = 'mlb';
  readonly sports = [
    { id: 'nfl', label: 'NFL' },
    { id: 'mlb', label: 'MLB' },
  ];

  position$ = this.positionService.position$;
  aboutOpen$ = this.positionService.aboutOpen$;
  positions = POSITIONS;
  positionNames: Record<Position, string> = {
    C: 'Catchers',
    '1B': 'First Base',
    '2B': 'Second Base',
    '3B': 'Third Base',
    SS: 'Shortstops',
    OF: 'Outfielders',
    DH: 'Designated Hitters',
    SP: 'Starting Pitchers',
    RP: 'Relief Pitchers',
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
