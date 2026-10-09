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

// ---- lists (phase 2): the emulators' ports, for a dev run that needs its own (localStorage.emulatorPorts =
// "<auth>,<firestore>", e.g. "9101,8101"); the defaults otherwise ----
function emulatorPorts(): { auth: number; firestore: number } {
  try {
    const [auth, firestore] = (localStorage.getItem('emulatorPorts') ?? '').split(',').map(Number);
    return { auth: auth || 9099, firestore: firestore || 8080 };
  } catch {
    return { auth: 9099, firestore: 8080 };
  }
}
// ---- end lists ----

let app: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;
let dbPromise: Promise<Firestore> | null = null;

// The app, initialized once
export function firebaseApp(): Promise<FirebaseApp> {
  app ??= import('firebase/app').then(({ getApps, initializeApp }) => getApps()[0] ?? initializeApp(FIREBASE_CONFIG));
  return app;
}

// Sign-in: kept in IndexedDB (local storage where there's none), so one sign-in carries across the
// sport apps (the same origin) and across visits
export function auth(): Promise<Auth> {
  authPromise ??= Promise.all([firebaseApp(), import('firebase/auth')]).then(([firebase, a]) => {
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

// The database (Cloud Firestore)
export function db(): Promise<Firestore> {
  dbPromise ??= Promise.all([firebaseApp(), import('firebase/firestore')]).then(([firebase, f]) => {
    const instance = f.getFirestore(firebase);
    if (usingEmulators()) f.connectFirestoreEmulator(instance, '127.0.0.1', emulatorPorts().firestore);
    return instance;
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}
