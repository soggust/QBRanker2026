import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

// Keyboard and screen reader support the page's own markup can't give by itself.

// Something clicked that isn't a button (a grid row's name, a group's icon): reachable with Tab, a
// button to a screen reader, Enter or Space clicks it
@Directive({
  selector: '[activate]',
  standalone: false,
  host: { role: 'button', tabindex: '0' },
})
export class ActivateDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  @HostListener('keydown', ['$event'])
  key(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.el.nativeElement.click();
  }
}

// A dialog (the player card, the game view): focus moves into it when it opens, Tab and Shift+Tab stay
// inside it, and focus goes back where it was when it closes
@Directive({
  selector: '[dialogFocus]',
  standalone: false,
  host: { tabindex: '-1' },
})
export class DialogFocusDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly before = document.activeElement as HTMLElement | null;

  ngAfterViewInit(): void {
    // (the dialog itself, not its first button: a screen reader reads its name, the keyboard starts at
    // its top)
    queueMicrotask(() => this.el.nativeElement.focus({ preventScroll: true }));
  }

  ngOnDestroy(): void {
    if (this.before?.isConnected) this.before.focus({ preventScroll: true });
  }

  @HostListener('keydown', ['$event'])
  trap(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusable = [
      ...this.el.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]'),
    ].filter((x) => x.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === this.el.nativeElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

// A row of tabs (role="tablist"): the arrow keys, Home and End move between them and open the one
// they land on, as tabs do everywhere
@Directive({
  selector: '[role=tablist]',
  standalone: false,
})
export class TablistKeysDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  @HostListener('keydown', ['$event'])
  key(event: KeyboardEvent): void {
    const tabs = [...this.el.nativeElement.querySelectorAll<HTMLElement>('[role=tab]')];
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const to =
      event.key === 'ArrowRight' ? (at + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1;
    if (to < 0) return;
    event.preventDefault();
    tabs[to].focus();
    tabs[to].click();
  }
}

export const A11Y_DIRECTIVES = [ActivateDirective, DialogFocusDirective, TablistKeysDirective];
