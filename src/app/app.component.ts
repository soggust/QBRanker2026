import { Component } from '@angular/core';
import { PositionService } from './services/position.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false
})
export class AppComponent {
  menuOpen: boolean = false;
  position$ = this.positionService.position$;

  constructor(private positionService: PositionService) {}
}
