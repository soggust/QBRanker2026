import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  Position,
  SkillPosition,
  SkillWeights,
  presetWeights,
} from 'app/positions';

@Injectable({
  providedIn: 'root',
})
export class PositionService {
  private positionSubject = new BehaviorSubject<Position>('QB');
  public position$: Observable<Position> = this.positionSubject.asObservable();

  // Slider weights per skill position, kept when switching tabs
  private weightsSubject = new BehaviorSubject<Record<SkillPosition, SkillWeights>>({
    RB: presetWeights('RB', 'default'),
    WR: presetWeights('WR', 'default'),
    TE: presetWeights('TE', 'default'),
  });
  public weights$ = this.weightsSubject.asObservable();

  setPosition(position: Position): void {
    this.positionSubject.next(position);
  }

  getWeights(position: SkillPosition): SkillWeights {
    return this.weightsSubject.value[position];
  }

  saveWeights(position: SkillPosition, weights: SkillWeights): void {
    this.weightsSubject.next({ ...this.weightsSubject.value, [position]: { ...weights } });
  }
}
