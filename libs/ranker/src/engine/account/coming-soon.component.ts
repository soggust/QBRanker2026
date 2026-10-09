import { Component, Input } from '@angular/core';

// A page that isn't built yet (the account pages later phases fill in), or a sport not open to everyone
// yet: its name and Coming soon on a scoreboard panel, and the way back to the rankings
@Component({
  selector: 'coming-soon',
  template: `
    <div class="soon-panel">
      <mat-icon class="soon-icon" aria-hidden="true" fontIcon="construction"></mat-icon>
      <h2>{{ heading }}</h2>
      <p class="soon-lit">Coming soon</p>
      @if (detail) {
        <p class="soon-detail">{{ detail }}</p>
      }
      <a class="soon-back" [href]="backHref || '#'" (click)="backHref || back($event)">{{ backLabel }}</a>
    </div>
  `,
  styleUrls: ['../../styles/components/account-page.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class ComingSoonComponent {
  @Input() heading = '';
  @Input() detail = '';
  // (somewhere else to go: a sport that isn't open, another sport's page)
  @Input() backHref = '';
  @Input() backLabel = 'Back to the rankings';

  // (the rankings: the hash cleared, without leaving a bare # in the address)
  back(event: Event): void {
    event.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}
