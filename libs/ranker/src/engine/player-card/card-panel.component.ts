import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';

// A panel on the player card, every one of them: a bar with the section's icon and its label, and the
// panel's content under it. Expandable (the default: the Season tab's stat groups, the Analysis tab's
// sections), the bar opens and shuts it, the chevron on its left (right when shut, down when open), and on
// hover the bar lifts and the chevron lightens, never the accent color; not expandable (Overview's
// sections, Similar Seasons, Game Log, Career), the bar is just its title and the content always shows.
// Its category color is the host's --group-color (a group-* class on it, or a tab card's default). The
// filter menu's stat groups are panels too: their eye and drag grip ride on the bar's right (an element
// marked panel-actions), and a switched-off group is dimmed (the panel-dimmed class).
@Component({
  selector: 'card-panel',
  template: `
    <div class="group-bar">
      @if (expandable) {
        <button type="button" class="panel-toggle" [attr.aria-expanded]="open" (click)="toggled.emit()">
          <mat-icon class="panel-chevron" [fontIcon]="open ? 'expand_more' : 'chevron_right'"></mat-icon>
          <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
          <span>{{ label }}</span>
        </button>
      } @else {
        <span class="panel-title">
          <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
          <span>{{ label }}</span>
        </span>
      }
      <!-- (the page's own controls on the bar's right: the filter menu's eye and drag grip) -->
      <ng-content select="[panel-actions]"></ng-content>
    </div>
    @if (open || !expandable) {
      <div class="panel-body"><ng-content></ng-content></div>
    }
  `,
  styleUrls: ['../../styles/components/card-panel.scss'],
  // (its styles reach the bar it draws; the content keeps the card's own)
  encapsulation: ViewEncapsulation.None,
  host: { class: 'stat-group', '[class.closed]': 'expandable && !open' },
  standalone: false,
})
export class CardPanelComponent {
  @Input() label = '';
  @Input() icon = '';
  @Input() open = false;
  // (off: a title bar, no folding)
  @Input() expandable = true;
  @Output() toggled = new EventEmitter<void>();
}
