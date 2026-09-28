import { provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { loadData } from './StaticData/data';
import { startAnalyticsWhenIdle } from './app/utils/analytics';

// Load the ranking data first, then the app (a separate chunk, so it downloads alongside the data),
// then analytics once the page is up
Promise.all([loadData(), import('./app/app.module')])
  .then(([, { AppModule }]) =>
    platformBrowserDynamic().bootstrapModule(AppModule, { applicationProviders: [provideZoneChangeDetection()] }),
  )
  .then(() => startAnalyticsWhenIdle())
  .catch((err) => console.error(err));
