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
    DEF: 'Defenses',
    HC: 'Head Coaches',
  };

  // The filter menu always starts open on large screens; the drawer tab hides it for this visit
  sidebarCollapsed: boolean = false;

  constructor(private positionService: PositionService) {}

  selectPosition(position: Position) {
    this.positionService.setPosition(position);
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }
}
