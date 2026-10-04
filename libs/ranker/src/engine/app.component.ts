import { Component, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PositionService } from '@ranker/engine/position.service';
import { POSITIONS, Position } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SPORT_LINKS } from '@ranker/core/sports';
import { SportSettings } from '@ranker/engine/sport';

// The tabs the sport's settings show (SPORT.tabVisible: the UFC's divisions, men's or women's)
function visibleTabs(settings: SportSettings): Position[] {
  return POSITIONS.filter((tab) => SPORT.tabVisible?.(tab, settings) ?? true);
}

// The page: the sport bar, the filter menu, the position tabs and the rankings, and About when it's open
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['../styles/components/app.component.scss'],
  standalone: false,
})
export class AppComponent {
  // The sport bar across the top: each sport is its own app on the same site (apps/<sport>, served at
  // /<sport>/); this one is lit
  readonly sport = SPORT.id;
  readonly sports = SPORT_LINKS;

  position$ = this.positionService.position$;
  aboutOpen$ = this.positionService.aboutOpen$;
  readonly positionNames = SPORT.tabNames as Record<Position, string>;

  get positions(): Position[] {
    return visibleTabs(this.positionService.settings.sport);
  }

  // Below 1200px the filters are a slide-out menu (menu-open); above, a sidebar that collapses. Both
  // follow the one open / closed state (the footer's filter button and the menu's X).
  private readonly smallScreen = window.matchMedia('(max-width: 1199px)');

  constructor(private positionService: PositionService) {
    // A setting that shows new tabs (the UFC's women's divisions) opens the first of them; one that
    // hides the open tab goes back to the first tab
    let shown = this.positions;
    this.positionService.sportSettings$.pipe(takeUntilDestroyed()).subscribe((settings) => {
      if (!SPORT.tabVisible) return;
      const now = visibleTabs(settings);
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

  // A click outside the filter menu closes it: not one in its dropdowns' lists (they open over the page)
  // or on the filter button (that toggles it)
  @HostListener('document:pointerdown', ['$event'])
  closeOnOutsideClick(event: PointerEvent): void {
    if (!this.positionService.filtersOpen) return;
    if ((event.target as Element | null)?.closest('.sidebar-shell, .cdk-overlay-container, .filter-toggle')) return;
    this.closeFilters();
  }

  closeFilters(): void {
    this.positionService.setFiltersOpen(false);
  }

  selectPosition(position: Position): void {
    this.positionService.setPosition(position);
  }

  closeAbout(): void {
    this.positionService.setAboutOpen(false);
  }
}
