import { Component } from '@angular/core';
import { PositionService } from '@ranker/engine/position.service';
import { POSITIONS, Position } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SPORT_LINKS } from '@ranker/core/sports';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['../styles/components/app.component.scss'],
    standalone: false
})
export class AppComponent {
  // The sport bar across the top: each sport is its own app on the same site (apps/<sport>, served at
  // /<sport>/); this one is lit
  readonly sport = SPORT.id;
  readonly sports = SPORT_LINKS;

  position$ = this.positionService.position$;
  aboutOpen$ = this.positionService.aboutOpen$;
  // The tabs (the sport's settings can hide some: SPORT.tabVisible)
  get positions(): Position[] {
    const settings = this.positionService.settings.sport;
    return POSITIONS.filter((tab) => SPORT.tabVisible?.(tab, settings) ?? true);
  }
  positionNames = SPORT.tabNames as Record<Position, string>;

  // Below 1200px the filters are a slide-out menu (menu-open); above, a sidebar that collapses. Both
  // follow the one open / closed state (the footer's filter button and the menu's X).
  private readonly smallScreen = window.matchMedia('(max-width: 1199px)');

  constructor(private positionService: PositionService) {
    // A setting that shows new tabs (the UFC's women's divisions) opens the first of them; one that
    // hides the open tab goes back to the first tab
    let shown = POSITIONS.filter((tab) => SPORT.tabVisible?.(tab, this.positionService.settings.sport) ?? true);
    this.positionService.sportSettings$.subscribe((settings) => {
      if (!SPORT.tabVisible) return;
      const now = POSITIONS.filter((tab) => SPORT.tabVisible!(tab, settings));
      const added = now.filter((tab) => !shown.includes(tab));
      shown = now;
      const open = this.positionService.position;
      if (added.length) this.positionService.setPosition(added[0]);
      else if (open && !now.includes(open)) this.positionService.setPosition(POSITIONS[0]);
    });
  }

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
