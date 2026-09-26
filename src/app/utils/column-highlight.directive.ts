import { Directive, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';

// Crosshair highlight for the rankings list: the hovered row is styled with :hover, and this
// lays a matching tint over the hovered column for the full height of the list (gaps included).
// Grade boxes highlight just the hovered grade. Runs outside Angular so mouse movement
// doesn't trigger change detection.
@Directive({
  selector: '[columnHighlight]',
  standalone: false,
})
export class ColumnHighlightDirective implements OnInit, OnDestroy {
  private readonly band = document.createElement('div');

  constructor(
    private host: ElementRef<HTMLElement>,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    const list = this.host.nativeElement;
    // Styled inline: component styles don't reach elements created here. Same tint as row hover.
    Object.assign(this.band.style, {
      background: 'rgba(255, 255, 255, 0.08)',
      borderRadius: '0.6em',
      display: 'none',
      pointerEvents: 'none',
      position: 'absolute',
      top: '0',
      zIndex: '4',
    });
    this.band.setAttribute('aria-hidden', 'true');
    list.appendChild(this.band);

    this.zone.runOutsideAngular(() => {
      list.addEventListener('mouseover', this.onOver);
      list.addEventListener('mouseleave', this.clear);
    });
  }

  ngOnDestroy(): void {
    const list = this.host.nativeElement;
    list.removeEventListener('mouseover', this.onOver);
    list.removeEventListener('mouseleave', this.clear);
    this.band.remove();
  }

  private onOver = (event: Event) => {
    const list = this.host.nativeElement;
    let el = event.target as HTMLElement | null;

    // The innermost cell: a grade inside a box, or a direct child of the row
    let cell: HTMLElement | null = null;
    while (el && el !== list) {
      const parent = el.parentElement;
      if (!cell && parent?.classList.contains('box')) cell = el;
      if (parent?.tagName === 'LI') {
        cell = cell ?? el;
        if (parent.classList.contains('header-row') || el.classList.contains('player-info')) {
          cell = null;
        }
        break;
      }
      el = parent;
    }
    if (!cell) return this.clear();

    const listBox = list.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    Object.assign(this.band.style, {
      display: 'block',
      height: `${list.scrollHeight}px`,
      left: `${cellBox.left - listBox.left + list.scrollLeft}px`,
      width: `${cellBox.width}px`,
    });
  };

  private clear = () => {
    this.band.style.display = 'none';
  };
}
