import { Directive, ElementRef, inject } from '@angular/core';
import { MatSelect } from '@angular/material/select';

// Every dropdown's open list hangs from the dropdown itself, edge to edge with it. Outside a form field
// Material hangs it from the trigger inside (the dropdown's padding in from its edge, which differs by sport
// and by dropdown), so the list sat a few pixels off to the right; a form field gives Material this origin
// itself, and so does this.
@Directive({
  selector: 'mat-select',
  standalone: false,
})
export class SelectOriginDirective {
  constructor() {
    const select = inject(MatSelect);
    select._preferredOverlayOrigin ??= inject(ElementRef);
  }
}
