import { Component, EventEmitter, Input, Output, booleanAttribute } from '@angular/core';
import { VISIBILITY_CHOICES, Visibility } from './account-helpers';

// Who sees something: Public, Friends, Only me, as the app's sand pills (a radio group: the arrow keys
// move along it). The Privacy settings, a list's own (saving, editing, its page) and the Tracker's.
@Component({
  selector: 'visibility-pills',
  template: `
    @for (choice of choices; track choice.value; let i = $index) {
      <button
        type="button"
        role="radio"
        class="vis-pill"
        [class.active]="value === choice.value"
        [attr.aria-checked]="value === choice.value"
        [attr.tabindex]="value === choice.value || (!value && i === 0) ? 0 : -1"
        [attr.aria-disabled]="disabled || null"
        [class.busy]="disabled"
        (click)="pick(choice.value)"
        (keydown)="key($event, i)"
      >
        {{ choice.label }}
      </button>
    }
  `,
  styleUrls: ['../../styles/components/account-visibility-pills.scss'],
  host: { role: 'radiogroup', '[attr.aria-label]': 'label || null', '[attr.aria-labelledby]': 'labelledby || null' },
  standalone: false,
})
export class VisibilityPillsComponent {
  readonly choices = VISIBILITY_CHOICES;
  @Input() value: Visibility | null | undefined = null;
  @Input() label = '';
  @Input() labelledby = '';
  @Input({ transform: booleanAttribute }) disabled = false;
  @Output() picked = new EventEmitter<Visibility>();

  // (while a change is saving the pills stay focusable, so the keyboard keeps its place, but don't act)
  pick(value: Visibility): void {
    if (!this.disabled && value !== this.value) this.picked.emit(value);
  }

  // (a radio group: the arrows pick the next or previous choice, focus with it)
  key(event: KeyboardEvent, i: number): void {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    if (this.disabled) return;
    const next = (i + step + this.choices.length) % this.choices.length;
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
    buttons?.[next]?.focus();
    this.pick(this.choices[next].value);
  }
}
