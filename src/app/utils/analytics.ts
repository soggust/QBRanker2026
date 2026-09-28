// Google Analytics (via Firebase), loaded after the app has rendered so its ~230 KB SDK isn't part
// of the initial download. Page views are recorded the same as before, just a moment later.
const firebaseConfig = {
  apiKey: 'AIzaSyD5sj0mL45M2p_MB3ZUSFE6Ve9nMiLm8Nc',
  authDomain: 'qbranker2026.firebaseapp.com',
  projectId: 'qbranker2026',
  storageBucket: 'qbranker2026.firebasestorage.app',
  messagingSenderId: '1027982765642',
  appId: '1:1027982765642:web:05ea3880c08454b4b680b3',
  measurementId: 'G-HKT8MVPT8V',
};

export function startAnalyticsWhenIdle(): void {
  const start = () =>
    Promise.all([import('firebase/app'), import('firebase/analytics')])
      .then(([{ initializeApp }, { getAnalytics }]) => getAnalytics(initializeApp(firebaseConfig)))
      .catch(() => {
        // Blocked by an ad blocker or offline: the app works the same without analytics
      });
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 2000);
}
