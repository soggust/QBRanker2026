import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';

// The rankings list scrolled sideways: a "scrolled-x" class on it while it is, so a phone can pin the
// rank and the team card to the left edge (and fade the name, which the stats would scroll under) and
// every stat still has its row's owner beside it. Runs outside Angular: scrolling never triggers
// change detection, and the class is only touched when it flips.
@Directive({
  selector: '[scrolledSideways]',
  standalone: false,
})
export class ScrolledSidewaysDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private on = false;

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => this.host.nativeElement.addEventListener('scroll', this.check, { passive: true }));
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('scroll', this.check);
  }

  private check = () => {
    // (past the drag grip and a bit of the name: a nudge doesn't flip it)
    const on = this.host.nativeElement.scrollLeft > 40;
    if (on === this.on) return;
    this.on = on;
    this.host.nativeElement.classList.toggle('scrolled-x', on);
  };
}
