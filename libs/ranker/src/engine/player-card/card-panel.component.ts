import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';

// A panel, every one in the app: a bar with the section's icon and its label, and the panel's content
// under it. Expandable (the default: the card's Season groups and Analysis sections, the filter menu's
// stat groups, the FAQ's questions), the bar opens and shuts it, the chevron on its left (right when shut,
// turning down when open), and on hover the bar lifts and the chevron lightens, never the accent color; not
// expandable (the card's Overview sections, Similar Seasons, Game Log, Career), the bar is just its title
// and the content always shows. Its category color is the host's --group-color (a group-* class on it, or
// a tab card's default). The filter menu's eye and drag grip ride on the bar's right (an element marked
// panel-actions), and a switched-off group is dimmed (the panel-dimmed class); a plain one (panel-plain,
// the FAQ) keeps its label's own case.
//
// Its open state is the page's when the page binds [open] (and handles (toggled)); otherwise the panel
// keeps its own, starting shut or [startOpen].
@Component({
  selector: 'card-panel',
  template: `
    <!-- (a chip-rimmed panel's corner spots, the Bets page's and the Algorithm's: hidden on every other panel) -->
    <i class="rim-corner tl" aria-hidden="true"></i><i class="rim-corner tr" aria-hidden="true"></i
    ><i class="rim-corner bl" aria-hidden="true"></i><i class="rim-corner br" aria-hidden="true"></i>
    <div class="group-bar">
      @if (expandable) {
        <button type="button" class="panel-toggle" [attr.aria-expanded]="isOpen" (click)="toggle()">
          <mat-icon class="panel-chevron" fontIcon="chevron_right"></mat-icon>
          @if (icon) {
            <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
          }
          <span [attr.title]="hint || null">{{ label }}</span>
        </button>
      } @else {
        <span class="panel-title">
          @if (icon) {
            <mat-icon class="group-bar-icon" [fontIcon]="icon"></mat-icon>
          }
          <span [attr.title]="hint || null">{{ label }}</span>
        </span>
      }
      <!-- (the page's own controls on the bar's right: the filter menu's eye and drag grip) -->
      <ng-content select="[panel-actions]"></ng-content>
    </div>
    @if (isOpen || !expandable) {
      <div class="panel-body" (animationend)="unfolded($event)"><ng-content></ng-content></div>
    }
  `,
  styleUrls: ['../../styles/components/card-panel.scss'],
  // (its styles reach the bar it draws; the content keeps the page's own)
  encapsulation: ViewEncapsulation.None,
  host: { class: 'stat-group', '[class.closed]': 'expandable && !isOpen', '[class.unfolding]': 'unfolding' },
  standalone: false,
})
export class CardPanelComponent {
  @Input() label = '';
  @Input() icon = '';
  // (the label's hover, when it needs one: why a formation isn't the team's main one)
  @Input() hint = '';
  // (off: a title bar, no folding)
  @Input() expandable = true;
  // (the page's: bound, the page decides; left alone, the panel keeps its own, from startOpen)
  @Input() set open(open: boolean) {
    this.controlled = true;
    this.own = open;
  }
  @Input() set startOpen(open: boolean) {
    if (!this.controlled) this.own = open;
  }
  @Output() toggled = new EventEmitter<void>();

  private controlled = false;
  private own = false;

  get isOpen(): boolean {
    return this.own;
  }

  // (opened by a click just now: its body unfolds, card-panel.scss; a panel open from the start just shows)
  unfolding = false;

  // (its own unfolding over: not a chart's or a tile's inside it, which would cut it short)
  unfolded(event: AnimationEvent): void {
    if (event.target === event.currentTarget) this.unfolding = false;
  }

  toggle(): void {
    this.unfolding = !this.own;
    if (!this.controlled) this.own = !this.own;
    this.toggled.emit();
  }
}
