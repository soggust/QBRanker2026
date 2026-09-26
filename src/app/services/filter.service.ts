import { Injectable } from '@angular/core';
import { Filters } from 'app/types';
import { Observable, BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class FilterService {
  private filtersSubject: BehaviorSubject<Filters> =
    new BehaviorSubject<Filters>({
      recordValue: 50,
      compValue: 50,
      yardsValue: 50,
      passYdValue: 50,
      rushYdValue: 50,
      ypaValue: 50,
      touchdownValue: 50,
      passTdValue: 50,
      rushTdValue: 50,
      turnoverValue: 50,
      intValue: 50,
      fumLostValue: 50,
      ratingValue: 50,
      advancedValue: 50,
      epaValue: 50,
      cpoeValue: 50,
      successValue: 50,
      fantasyValue: 50,
      pressureToSackValue: 50,
      badThrowValue: 50,
      timeToThrowValue: 50,
      adotValue: 50,
      aggressivenessValue: 50,
      recencyValue: 50,
      supportValue: 50,
      weaponsValue: 50,
      coachingValue: 50,
      olineValue: 50,
      defenseValue: 50,
      responsibilityValue: 50,
    });
  public filters$: Observable<Filters> = this.filtersSubject.asObservable();

  constructor() {}

  saveFilters(filtersToAdd: Filters): void {
    this.filtersSubject.next(filtersToAdd);
  }

  getCurrentFilters(): Filters {
    return this.filtersSubject.value;
  }
}
