import { Directive, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';

let nextId = 0;

// Crosshair highlight for the rankings list: the hovered row is styled with :hover, and this
// tints the same column in every row. Cells are matched by their position within the row
// (and within a grouped box like the support grades), so every row must share one structure.
// Runs outside Angular so mouse movement doesn't trigger change detection.
@Directive({
  selector: '[columnHighlight]',
  standalone: false,
})
export class ColumnHighlightDirective implements OnInit, OnDestroy {
  private readonly id = `col-${nextId++}`;
  private readonly style = document.createElement('style');
  private current = '';

  constructor(
    private host: ElementRef<HTMLElement>,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    const list = this.host.nativeElement;
    list.setAttribute('data-column-highlight', this.id);
    document.head.appendChild(this.style);

    this.zone.runOutsideAngular(() => {
      list.addEventListener('mouseover', this.onOver);
      list.addEventListener('mouseleave', this.clear);
    });
  }

  ngOnDestroy(): void {
    const list = this.host.nativeElement;
    list.removeEventListener('mouseover', this.onOver);
    list.removeEventListener('mouseleave', this.clear);
    this.style.remove();
  }

  private onOver = (event: Event) => {
    const list = this.host.nativeElement;
    let el = event.target as HTMLElement | null;

    // Walk up to the row, remembering each step's position (row cell, then box cell)
    const path: number[] = [];
    while (el && el.parentElement && el.parentElement.tagName !== 'LI') {
      if (el.parentElement.classList.contains('box')) {
        path.unshift(indexIn(el));
      }
      el = el.parentElement;
    }
    const row = el?.parentElement;
    if (!el || !row || row.parentElement !== list || el.classList.contains('player-info')) {
      return this.clear();
    }
    path.unshift(indexIn(el));

    const selector = `[data-column-highlight="${this.id}"] > li > ${path
      .map((i) => `:nth-child(${i})`)
      .join(' > ')}`;
    if (selector === this.current) return;
    this.current = selector;
    this.style.textContent = `${selector} { background-color: rgba(255, 255, 255, 0.09); border-radius: 0.5em; }`;
  };

  private clear = () => {
    this.current = '';
    this.style.textContent = '';
  };
}

function indexIn(el: Element): number {
  return Array.prototype.indexOf.call(el.parentElement!.children, el) + 1;
}
