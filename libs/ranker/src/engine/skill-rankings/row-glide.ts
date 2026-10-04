// When the list re-ranks, the rows on screen glide from where they were to their new places (a quick
// slide, transforms only) instead of jumping: measure() before the sort, play() once it's drawn. Only
// for a re-rank that comes on its own (a preset, a setting, a click on a slider's track): while a
// slider is dragged the list re-ranks many times a second, and gliding every one of those would cost
// the smoothness the drag needs.
const ROWS = ':scope > li.player[data-id]';

export class RowGlide {
  private lastSort = 0;

  // Where the rows near the screen are now (by id), or null when this re-rank shouldn't glide
  measure(list: HTMLElement | undefined): Map<string, number> | null {
    const now = performance.now();
    const steady = now - this.lastSort > 300;
    this.lastSort = now;
    if (!list || !steady || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    const top = list.scrollTop - 200;
    const bottom = list.scrollTop + list.clientHeight + 200;
    const at = new Map<string, number>();
    for (const row of Array.from(list.querySelectorAll<HTMLElement>(ROWS))) {
      if (row.offsetTop < top || row.offsetTop > bottom) continue;
      at.set(row.dataset['id']!, row.getBoundingClientRect().top);
    }
    return at;
  }

  // Slide each measured row from where it was to where it's drawn now
  play(list: () => HTMLElement | undefined, from: Map<string, number> | null): void {
    if (!from?.size) return;
    requestAnimationFrame(() => {
      const rows = list();
      if (!rows) return;
      for (const row of Array.from(rows.querySelectorAll<HTMLElement>(ROWS))) {
        const was = from.get(row.dataset['id']!);
        if (was === undefined) continue;
        row.getAnimations().forEach((a) => a.cancel());
        const dy = was - row.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) continue;
        row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    });
  }
}
