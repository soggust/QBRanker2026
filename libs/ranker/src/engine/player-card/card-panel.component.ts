import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';

// An expandable panel on the player card (the Season tab's stat groups, the Analysis tab's sections): a
// bar with the chevron on the left (right when shut, down when open), the section's icon and its label,
// and the panel's content under it while it's open. Every one looks and behaves the same: on hover the
// bar lifts and the chevron lightens, never the accent color. Its category color is the host's
// --group-color (a group-* class on it, or a tab card's default).
@Component({
  selector: 'card-panel',
  template: `
    <button type="button" class="group-bar" [attr.aria-expanded]="open" (click)="toggled.emit()">
      <mat-icon class="panel-chevron" [fontIcon]="open ? 'expand_more' : 'chevron_right'"></mat-icon>
      <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
      <span>{{ label }}</span>
    </button>
    @if (open) {
      <ng-content></ng-content>
    }
  `,
  styleUrls: ['../../styles/components/card-panel.scss'],
  // (its styles reach the bar it draws; the content keeps the card's own)
  encapsulation: ViewEncapsulation.None,
  host: { class: 'stat-group', '[class.closed]': '!open' },
  standalone: false,
})
export class CardPanelComponent {
  @Input() label = '';
  @Input() icon = '';
  @Input() open = false;
  @Output() toggled = new EventEmitter<void>();
}
