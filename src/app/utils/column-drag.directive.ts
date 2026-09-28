import { Directive, ElementRef, HostBinding, HostListener, Input } from '@angular/core';
import { PositionService } from 'app/services/position.service';

// Which list (tab + stat group, e.g. "QB.box") a header cell belongs to, and its column id
export interface ColumnDragTarget {
  list: string;
  id: string;
}

// Drag a column header to reorder the columns within its stat group (native drag and drop).
// Only header cells get a target; cells in other groups don't accept the drop.
@Directive({
  selector: '[columnDrag]',
  standalone: false,
})
export class ColumnDragDirective {
  @Input() columnDrag: ColumnDragTarget | null = null;

  // The header cell being dragged (one drag at a time across the page)
  private static dragging: ColumnDragTarget | null = null;

  constructor(
    private element: ElementRef<HTMLElement>,
    private positionService: PositionService,
  ) {}

  @HostBinding('attr.draggable')
  get draggable(): string | null {
    return this.columnDrag ? 'true' : null;
  }

  @HostBinding('class.column-draggable')
  get isDraggable(): boolean {
    return !!this.columnDrag;
  }

  @HostListener('dragstart', ['$event'])
  onDragStart(event: DragEvent) {
    if (!this.columnDrag) return;
    ColumnDragDirective.dragging = this.columnDrag;
    event.dataTransfer?.setData('text/plain', this.columnDrag.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.element.nativeElement.classList.add('column-dragging');
  }

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent) {
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

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent) {
    // Ignore moving between this cell's own children
    if (this.element.nativeElement.contains(event.relatedTarget as Node | null)) return;
    this.clearDropMarker();
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent) {
    const dragging = ColumnDragDirective.dragging;
    if (!this.columnDrag || !dragging || dragging.list !== this.columnDrag.list) return;
    event.preventDefault();
    this.positionService.moveColumn(this.columnDrag.list, dragging.id, this.columnDrag.id, this.dropsAfter(event));
    this.clearDropMarker();
  }

  @HostListener('dragend')
  onDragEnd() {
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
