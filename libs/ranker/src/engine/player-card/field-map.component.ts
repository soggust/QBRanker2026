import { Component, Input } from '@angular/core';
import { FieldMapView, KICK_BOX, PASS_BOX, PASS_FIELD, PUNT_BOX, RUN_BOX, RUN_FIELD } from './field-map';

// (each chart's turf and clip ids its own: two cards' maps never share one)
let next = 0;

// The Field Map's charts (field-map.ts, inside the Overview's Field Map panel): a passer's, a catcher's or a
// defense's zones on a field looking downfield (by efficiency, tinted against the league's, or by volume, a
// bubble a zone sized by its share), a runner's lanes as arrows out of the backfield, a defense's lanes as a
// strip, a kicker's rings out from the uprights, a punter's average punt down the field
@Component({
  selector: 'card-field-map',
  templateUrl: './field-map.component.html',
  standalone: false,
})
export class FieldMapComponent {
  @Input({ required: true }) view!: FieldMapView;
  @Input() mode: 'efficiency' | 'volume' = 'efficiency';

  readonly id = `fm${next++}`;
  readonly passField = PASS_FIELD;
  readonly runField = RUN_FIELD;

  readonly passBox = box(PASS_BOX);
  readonly runBox = box(RUN_BOX);
  readonly kickBox = box(KICK_BOX);
  readonly puntBox = box(PUNT_BOX);
  readonly runWidth = RUN_BOX.w;
  readonly runHeight = RUN_BOX.h;
  readonly puntWidth = PUNT_BOX.w;

  // (the turf under every chart: the theme's, darkened under the chalk)
  readonly turf = 'assets/textures/turf.webp';

  url(part: string): string {
    return `url(#${this.id}-${part})`;
  }

  rotate(n: { x: number; y: number; rotate: number }): string {
    return `translate(${n.x} ${n.y}) rotate(${n.rotate})`;
  }
}

const box = (b: { x: number; y: number; w: number; h: number }) => `${b.x} ${b.y} ${b.w} ${b.h}`;
