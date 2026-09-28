import { provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { loadData } from './StaticData/data';
import { startAnalyticsWhenIdle } from './app/utils/analytics';

// Load the ranking data, then the app, then analytics once the page is up. The app's code reads the
// data as soon as it runs, so it must not be imported (executed) until the data is in; the prefetch
// hint still downloads its chunk in parallel so it's ready (or cached) by then.
loadData()
  .then(() => import(/* webpackPrefetch: true */ './app/app.module'))
  .then(({ AppModule }) =>
    platformBrowserDynamic().bootstrapModule(AppModule, { applicationProviders: [provideZoneChangeDetection()] }),
  )
  .then(() => startAnalyticsWhenIdle())
  .catch((err) => console.error(err));
