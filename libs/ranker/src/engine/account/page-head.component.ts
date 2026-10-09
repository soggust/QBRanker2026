import { Component, Input, booleanAttribute } from '@angular/core';

// An account page's title strip (My lists, Community, Friends, Wallet; the Tracker's desk has the same look):
// the page's icon on a lit disc, its name, a line on what it's for, and the page's own actions on the right
// (projected). On a scoreboard panel of its own, or bare on a desk's scoreboard top.
@Component({
  selector: 'page-head',
  template: `
    <span class="page-badge" aria-hidden="true"><mat-icon [fontIcon]="icon"></mat-icon></span>
    <div class="page-heading">
      <h2>{{ heading }}</h2>
      @if (sub) {
        <p>{{ sub }}</p>
      }
    </div>
    <div class="page-actions"><ng-content></ng-content></div>
  `,
  styleUrls: ['../../styles/components/account-page-head.scss'],
  host: { '[class.bare]': 'bare' },
  standalone: false,
})
export class PageHeadComponent {
  @Input({ required: true }) heading = '';
  @Input() sub = '';
  @Input() icon = 'person';
  // (inside a desk whose top is already the scoreboard: no panel of its own)
  @Input({ transform: booleanAttribute }) bare = false;
}
