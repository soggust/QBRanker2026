import { TestBed } from '@angular/core/testing';

import { EspnApiService } from './espn-api.service';

describe('EspnApiService', () => {
  let service: EspnApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EspnApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
