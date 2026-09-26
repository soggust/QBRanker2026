import { Component } from '@angular/core';
import { PositionService } from './services/position.service';
import { POSITIONS, Position } from './positions';

// Remember whether the sidebar is collapsed on large screens
const COLLAPSED_KEY = 'sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false
})
export class AppComponent {
  menuOpen: boolean = false;
  position$ = this.positionService.position$;
  positions = POSITIONS;
  positionNames: Record<Position, string> = {
    QB: 'Quarterbacks',
    RB: 'Running Backs',
    WR: 'Wide Receivers',
    TE: 'Tight Ends',
    K: 'Kickers',
    P: 'Punters',
  };

  sidebarCollapsed: boolean = readCollapsed();

  constructor(private positionService: PositionService) {}

  selectPosition(position: Position) {
    this.positionService.setPosition(position);
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try {
      localStorage.setItem(COLLAPSED_KEY, String(this.sidebarCollapsed));
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this visit
    }
  }
}
