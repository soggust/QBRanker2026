import { isDevMode } from '@angular/core';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

// The site's one Firebase app (project qbranker2026), shared by analytics, sign-in and the database. Its
// SDK is loaded only when something asks for it (dynamic imports), so the grid's first load never pays for
// it. The web config is public by design (the rules and the authorized domains are what protect it).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD5sj0mL45M2p_MB3ZUSFE6Ve9nMiLm8Nc',
  authDomain: 'qbranker2026.firebaseapp.com',
  projectId: 'qbranker2026',
  storageBucket: 'qbranker2026.firebasestorage.app',
  messagingSenderId: '1027982765642',
  appId: '1:1027982765642:web:05ea3880c08454b4b680b3',
  measurementId: 'G-HKT8MVPT8V',
};

// Development against the local emulators (`npx firebase emulators:start --only auth,firestore`): a page
// opened with ?emulators turns it on for this browser (remembered, so the app's own address rewrites
// don't lose it), ?emulators=0 turns it off; localStorage.useEmulators === '1' is the switch itself
export function usingEmulators(): boolean {
  try {
    const flag = new URLSearchParams(location.search).get('emulators');
    if (flag !== null) {
      if (flag === '0') localStorage.removeItem('useEmulators');
      else localStorage.setItem('useEmulators', '1');
    }
    return localStorage.getItem('useEmulators') === '1';
  } catch {
    return false;
  }
}

// The emulators' ports, for a dev run that needs its own (localStorage.emulatorPorts =
// "<auth>,<firestore>", e.g. "9101,8101"); the defaults otherwise
function emulatorPorts(): { auth: number; firestore: number } {
  try {
    const [auth, firestore] = (localStorage.getItem('emulatorPorts') ?? '').split(',').map(Number);
    return { auth: auth || 9099, firestore: firestore || 8080 };
  } catch {
    return { auth: 9099, firestore: 8080 };
  }
}

// App Check: proof that a request comes from this site, not a script (reCAPTCHA)
// App Check's site key (Firebase console → App Check → the web app: Fraud Defense, formerly reCAPTCHA
// Enterprise; the classic v3 is retired). A site key is public: it ships in the page. Empty: App Check is off and
// nothing loads. 'v3' or 'enterprise' for the kind of key.
export const APP_CHECK_SITE_KEY = '6LfyGugtAAAAAAqHwguX1EsuSRYmJZwDidhyW0X2';
export const APP_CHECK_PROVIDER: 'v3' | 'enterprise' = 'enterprise';

let appCheckPromise: Promise<void> | null = null;

// Starts App Check once, before sign-in or the database first talks to Firebase (analytics doesn't wait for
// it, so a signed-out visitor never loads reCAPTCHA). Off with no key, and against the emulators (they
// don't check tokens). In development against the real project it uses a debug token: the SDK prints it to
// the console once; add it in the console (App Check → the web app → Manage debug tokens).
function appCheck(firebase: FirebaseApp): Promise<void> {
  if (!APP_CHECK_SITE_KEY || usingEmulators()) return Promise.resolve();
  appCheckPromise ??= import('firebase/app-check')
    .then((c) => {
      if (isDevMode()) (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN ??= true;
      const provider =
        APP_CHECK_PROVIDER === 'enterprise'
          ? new c.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY)
          : new c.ReCaptchaV3Provider(APP_CHECK_SITE_KEY);
      c.initializeAppCheck(firebase, { provider, isTokenAutoRefreshEnabled: true });
    })
    // (blocked or offline: carry on without it; enforcement, once on, is what turns such requests away)
    .catch(() => undefined);
  return appCheckPromise;
}
// ---- end App Check ----

let app: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;
let dbPromise: Promise<Firestore> | null = null;

// The app, initialized once
export function firebaseApp(): Promise<FirebaseApp> {
  app ??= import('firebase/app').then(({ getApps, initializeApp }) => getApps()[0] ?? initializeApp(FIREBASE_CONFIG));
  return app;
}

// (the app with App Check started, for sign-in and the database)
function checkedApp(): Promise<FirebaseApp> {
  return firebaseApp().then((firebase) => appCheck(firebase).then(() => firebase));
}

// Sign-in: kept in IndexedDB (local storage where there's none), so one sign-in carries across the
// sport apps (the same origin) and across visits
export function auth(): Promise<Auth> {
  authPromise ??= Promise.all([checkedApp(), import('firebase/auth')]).then(([firebase, a]) => {
    const instance = a.initializeAuth(firebase, {
      persistence: [a.indexedDBLocalPersistence, a.browserLocalPersistence],
      popupRedirectResolver: a.browserPopupRedirectResolver,
    });
    if (usingEmulators()) a.connectAuthEmulator(instance, `http://127.0.0.1:${emulatorPorts().auth}`, { disableWarnings: true });
    return instance;
  });
  authPromise.catch(() => (authPromise = null));
  return authPromise;
}

// The database (Cloud Firestore), its cache kept in the browser (IndexedDB, shared by the tabs): each sport is
// its own page, so a memory cache started over on every switch and every listener paid for its whole result
// again; kept, a listener picked up again within half an hour pays only for what changed. (Where the browser
// won't keep it, a private window, the memory cache as before.)
export function db(): Promise<Firestore> {
  dbPromise ??= Promise.all([checkedApp(), import('firebase/firestore')]).then(([firebase, f]) => {
    let instance: Firestore;
    try {
      instance = f.initializeFirestore(firebase, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) });
    } catch {
      instance = f.getFirestore(firebase);
    }
    if (usingEmulators()) f.connectFirestoreEmulator(instance, '127.0.0.1', emulatorPorts().firestore);
    return instance;
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

// The database and the Firestore SDK's functions together, as nearly every read and write wants them:
// const [firestore, f] = await firestoreSdk(); (the SDK itself loads only when it's first asked for)
export function firestoreSdk(): Promise<[Firestore, typeof import('firebase/firestore')]> {
  return Promise.all([db(), import('firebase/firestore')]);
}

// ...and the sign-in and the Auth SDK's: const [a, { signOut }] = await authSdk();
export function authSdk(): Promise<[Auth, typeof import('firebase/auth')]> {
  return Promise.all([auth(), import('firebase/auth')]);
}
