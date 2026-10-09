import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild, ViewEncapsulation } from '@angular/core';

// A small dialog over the dimmed page (the login dialog's look): the title on the scoreboard, the content
// on the chalkboard. Escape, the X or a click on the dim closes it; Tab stays inside it; focus goes to its
// first field (or button) and back to whatever opened it after. Saving a list, naming a preset, editing a
// list, and the are-you-sure for deleting either.
@Component({
  selector: 'list-modal',
  template: `
    <div class="modal-backdrop" (click)="close()"></div>
    <div #panel class="modal-panel" [class.wide]="wide" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" [attr.aria-busy]="busy">
      <header>
        <mat-icon class="modal-icon" aria-hidden="true" [fontIcon]="icon"></mat-icon>
        <h2 [id]="titleId">{{ heading }}</h2>
        <button type="button" class="modal-close" aria-label="Close" title="Close (Esc)" (click)="close()">
          <mat-icon fontIcon="close"></mat-icon>
        </button>
      </header>
      <div class="modal-body"><ng-content></ng-content></div>
    </div>
  `,
  styleUrls: ['../../../styles/components/account-lists-dialog.scss'],
  // (its styles reach the content it's given: the fields and buttons the pages put in it)
  encapsulation: ViewEncapsulation.None,
  standalone: false,
})
export class ListModalComponent implements AfterViewInit, OnDestroy {
  private static count = 0;
  readonly titleId = `list-modal-${++ListModalComponent.count}`;

  @Input() heading = '';
  @Input() icon = 'format_list_numbered';
  @Input() busy = false;
  @Input() wide = false;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('panel') panel!: ElementRef<HTMLElement>;

  private readonly opener = document.activeElement as HTMLElement | null;

  ngAfterViewInit(): void {
    // (the first field, else the first button after the X)
    setTimeout(() => {
      const panel = this.panel.nativeElement;
      const first =
        panel.querySelector<HTMLElement>('.modal-body input:not([type=hidden]), .modal-body textarea, [autofocus]') ??
        panel.querySelector<HTMLElement>('.modal-body button:not([disabled])');
      first?.focus({ preventScroll: true });
    });
  }

  ngOnDestroy(): void {
    this.opener?.focus?.({ preventScroll: true });
  }

  @HostListener('document:keydown.escape', ['$event'])
  escape(event: Event): void {
    event.preventDefault();
    this.close();
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }

  // Tab and Shift+Tab stay inside the dialog
  @HostListener('keydown.tab', ['$event'])
  @HostListener('keydown.shift.tab', ['$event'])
  trap(event: Event): void {
    const items = Array.from(
      this.panel.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const back = (event as KeyboardEvent).shiftKey;
    if (back && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!back && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
