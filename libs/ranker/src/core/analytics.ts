import { firebaseApp } from './firebase';

// Google Analytics (via Firebase), loaded after the app has rendered so its ~230 KB SDK isn't part
// of the initial download. Page views are recorded the same as before, just a moment later. (The one
// Firebase app sign-in and the database use too: firebase.ts)
export function startAnalyticsWhenIdle(): void {
  const start = () =>
    Promise.all([firebaseApp(), import('firebase/analytics')])
      .then(([app, { getAnalytics }]) => getAnalytics(app))
      .catch(() => {
        // Blocked by an ad blocker or offline: the app works the same without analytics
      });
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 2000);
}
