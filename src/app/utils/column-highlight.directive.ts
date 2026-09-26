import { Directive, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';

// Crosshair highlight for the rankings list: the hovered row is styled with :hover, and this
// lays a matching tint over the hovered column for the full height of the list (gaps included).
// Grouped boxes (Recent, support grades) get no band. Runs outside Angular so mouse movement
// doesn't trigger change detection.
@Directive({
  selector: '[columnHighlight]',
  standalone: false,
})
export class ColumnHighlightDirective implements OnInit, OnDestroy {
  private readonly band = document.createElement('div');
  private cell: HTMLElement | null = null;

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

    // The row cell being hovered. No band for the header, the player name, the drag handle,
    // or the grouped Recent / support boxes (the row highlight is enough there).
    let cell: HTMLElement | null = null;
    while (el && el !== list) {
      const parent = el.parentElement;
      if (parent?.tagName === 'LI') {
        const skip =
          parent.classList.contains('header-row') ||
          ['player-info', 'drag-indicator', 'box'].some((name) => el!.classList.contains(name));
        cell = skip ? null : el;
        break;
      }
      el = parent;
    }
    if (!cell) return this.clear();

    // Only move the band when the column changes; measure the scroll height with the band
    // hidden so it can't grow the scroll area (which made the scrollbar flicker)
    if (cell === this.cell) return;
    this.cell = cell;
    this.band.style.display = 'none';
    const height = list.scrollHeight;
    const listBox = list.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    Object.assign(this.band.style, {
      display: 'block',
      height: `${height}px`,
      left: `${cellBox.left - listBox.left + list.scrollLeft}px`,
      width: `${cellBox.width}px`,
    });
  };

  private clear = () => {
    this.cell = null;
    this.band.style.display = 'none';
  };
}
