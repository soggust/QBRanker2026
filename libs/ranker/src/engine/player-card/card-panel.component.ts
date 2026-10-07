import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';

// A panel on the player card, every one of them: a bar with the section's icon and its label, and the
// panel's content under it. Expandable (the default: the Season tab's stat groups, the Analysis tab's
// sections), the bar opens and shuts it, the chevron on its left (right when shut, down when open), and on
// hover the bar lifts and the chevron lightens, never the accent color; not expandable (Overview's
// sections, Similar Seasons, Game Log, Career), the bar is just its title and the content always shows.
// Its category color is the host's --group-color (a group-* class on it, or a tab card's default).
@Component({
  selector: 'card-panel',
  template: `
    @if (expandable) {
      <button type="button" class="group-bar" [attr.aria-expanded]="open" (click)="toggled.emit()">
        <mat-icon class="panel-chevron" [fontIcon]="open ? 'expand_more' : 'chevron_right'"></mat-icon>
        <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
        <span>{{ label }}</span>
      </button>
    } @else {
      <div class="group-bar">
        <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
        <span>{{ label }}</span>
      </div>
    }
    @if (open || !expandable) {
      <ng-content></ng-content>
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
