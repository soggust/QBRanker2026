import { Directive, ElementRef, HostBinding, Inject, InjectionToken, Input, NgZone, OnDestroy, OnInit } from '@angular/core';

// What a drop does: moves a column within its list (each app provides its PositionService, which
// keeps the column orders, as COLUMN_MOVER in its module)
export interface ColumnMover {
  moveColumn(list: string, id: string, targetId: string, after: boolean): void;
}
export const COLUMN_MOVER = new InjectionToken<ColumnMover>('COLUMN_MOVER');

// Which list (tab + stat group, e.g. "QB.box") a header cell belongs to, and its column id
export interface ColumnDragTarget {
  list: string;
  id: string;
}

// Drag a column header to reorder the columns within its stat group (native drag and drop).
// Only header cells get a target; cells in other groups don't accept the drop.
//
// The drag events are handled outside Angular: dragover fires dozens of times a second and only
// moves the drop marker (a CSS class), so letting each one re-check the whole table made dragging
// sluggish. Only the drop, which actually reorders the columns, goes back into Angular.
@Directive({
  selector: '[columnDrag]',
  standalone: false,
})
export class ColumnDragDirective implements OnInit, OnDestroy {
  @Input() columnDrag: ColumnDragTarget | null = null;

  // The header cell being dragged (one drag at a time across the page)
  private static dragging: ColumnDragTarget | null = null;

  private readonly listeners: [string, (event: DragEvent) => void][] = [
    ['dragstart', (e) => this.onDragStart(e)],
    ['dragover', (e) => this.onDragOver(e)],
    ['dragleave', (e) => this.onDragLeave(e)],
    ['drop', (e) => this.onDrop(e)],
    ['dragend', () => this.onDragEnd()],
  ];

  constructor(
    private element: ElementRef<HTMLElement>,
    @Inject(COLUMN_MOVER) private mover: ColumnMover,
    private zone: NgZone,
  ) {}

  @HostBinding('attr.draggable')
  get draggable(): string | null {
    return this.columnDrag ? 'true' : null;
  }

  @HostBinding('class.column-draggable')
  get isDraggable(): boolean {
    return !!this.columnDrag;
  }

  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      for (const [type, handler] of this.listeners) {
        this.element.nativeElement.addEventListener(type, handler as EventListener);
      }
    });
  }

  ngOnDestroy() {
    for (const [type, handler] of this.listeners) {
      this.element.nativeElement.removeEventListener(type, handler as EventListener);
    }
  }

  private onDragStart(event: DragEvent) {
    if (!this.columnDrag) return;
    ColumnDragDirective.dragging = this.columnDrag;
    event.dataTransfer?.setData('text/plain', this.columnDrag.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.element.nativeElement.classList.add('column-dragging');
  }

  private onDragOver(event: DragEvent) {
    const dragging = ColumnDragDirective.dragging;
    if (!this.columnDrag || !dragging || dragging.list !== this.columnDrag.list || dragging.id === this.columnDrag.id) {
      return;
    }
    // Allow the drop, and show which side of this column it lands on
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const after = this.dropsAfter(event);
    this.element.nativeElement.classList.toggle('column-drop-after', after);
    this.element.nativeElement.classList.toggle('column-drop-before', !after);
  }

  private onDragLeave(event: DragEvent) {
    // Ignore moving between this cell's own children
    if (this.element.nativeElement.contains(event.relatedTarget as Node | null)) return;
    this.clearDropMarker();
  }

  private onDrop(event: DragEvent) {
    const dragging = ColumnDragDirective.dragging;
    const target = this.columnDrag;
    if (!target || !dragging || dragging.list !== target.list) return;
    event.preventDefault();
    const after = this.dropsAfter(event);
    this.clearDropMarker();
    // Back into Angular so the table re-renders in the new order
    this.zone.run(() => this.mover.moveColumn(target.list, dragging.id, target.id, after));
  }

  private onDragEnd() {
    ColumnDragDirective.dragging = null;
    this.element.nativeElement.classList.remove('column-dragging');
    document.querySelectorAll('.column-drop-before, .column-drop-after').forEach((cell) => {
      cell.classList.remove('column-drop-before', 'column-drop-after');
    });
  }

  // Past the middle of this column: the dragged column goes after it
  private dropsAfter(event: DragEvent): boolean {
    const box = this.element.nativeElement.getBoundingClientRect();
    return event.clientX > box.left + box.width / 2;
  }

  private clearDropMarker() {
    this.element.nativeElement.classList.remove('column-drop-before', 'column-drop-after');
  }
}
