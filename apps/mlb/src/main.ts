import { provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { linkedSeason, loadData } from './StaticData/data';
import { startAnalyticsWhenIdle } from '@ranker/core/analytics';

// Load the ranking data (this season, or the one a shared link names), then the app, then analytics once the page is up. The app's code reads the
// data as soon as it runs, so it must not be imported (executed) until the data is in; the prefetch
// hint still downloads its chunk in parallel so it's ready (or cached) by then. Until the app
// starts, index.html shows a loading screen (replaced by the app, or by an error message here).
loadData(linkedSeason())
  .then(() => import(/* webpackPrefetch: true */ './app/app.module'))
  .then(({ AppModule }) =>
    platformBrowserDynamic().bootstrapModule(AppModule, { applicationProviders: [provideZoneChangeDetection()] }),
  )
  .then(() => startAnalyticsWhenIdle())
  .catch((err) => {
    console.error(err);
    const loading = document.querySelector('.app-loading');
    const text = loading?.querySelector('.app-loading-text');
    if (loading && text) {
      loading.classList.add('failed');
      text.textContent = "Couldn't load the rankings. Refresh to try again.";
    }
  });
