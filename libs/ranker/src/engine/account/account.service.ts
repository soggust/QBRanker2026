import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import type { AuthProvider, User } from 'firebase/auth';
import { auth, db } from '@ranker/core/firebase';
import { ADMIN } from './features';
import {
  DEFAULT_VISIBILITY,
  Photo,
  Profile,
  Visibility,
  VisibilityKind,
  cleanUsername,
  usernameCandidates,
  usernameFrom,
  usernameKey,
} from './account-helpers';
// ---- wallet (phase 2) ----
import { deleteWallet } from './wallet/wallet-cleanup';
// ---- end wallet ----

// The signed-in user: their uid, their profile (null for the moment between signing up and the profile
// landing), and what the sign-in itself knows (email, the providers linked, the provider's photo, admin)
export interface AccountUser {
  uid: string;
  profile: Profile | null;
  email: string | null;
  providers: string[];
  providerPhoto: string | null;
  admin: boolean;
}

export type SocialProvider = 'google.com' | 'facebook.com';

// (a later phase's own data to remove when the account is deleted: its subcollections under users/{uid})
export type AccountCleanup = (uid: string) => Promise<void>;

// (remembered in this browser while someone's signed in, so a returning visitor's sign-in is restored
// right away; without it, Firebase's SDK isn't loaded until someone asks to sign in)
const HINT = 'srSignedIn';
const hinted = () => {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
};
const setHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    // Storage unavailable: the sign-in is restored when the SDK loads
  }
};

const fail = (code: string) => Object.assign(new Error(code), { code });

// Accounts: signing in (Google, Facebook, or email and password with a username), the profile in
// Firestore (users/{uid}, its username claimed in usernames/{lower}), and the account's settings. The
// state is signals (user(), ready(), loginOpen()) with user$ for the rxjs side of the app.
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly current = signal<AccountUser | null>(null);
  readonly user = this.current.asReadonly();
  readonly user$ = toObservable(this.current);
  // (true once it's known whether someone's signed in: until then the sport bar shows neither state)
  private readonly known = signal(!hinted());
  readonly ready = this.known.asReadonly();
  // (and whether they're an admin: the token checked, or no one signed in)
  private readonly adminKnown = signal(!hinted());
  readonly settled = computed(() => this.known() && this.adminKnown());
  readonly signedIn = computed(() => !!this.current());
  readonly profile = computed(() => this.current()?.profile ?? null);
  readonly admin = computed(() => !!this.current()?.admin);

  // The login dialog (the sport bar's Sign in, and any page that needs a signed-in user)
  readonly loginOpen = signal(false);

  private started: Promise<void> | null = null;
  private stopProfile: (() => void) | null = null;
  // (signing up: the profile is being written with the username asked for, so don't make one up)
  private registering = false;
  private readonly cleanups: AccountCleanup[] = [];

  constructor() {
    // (a returning visitor: restore their sign-in now)
    if (hinted()) void this.start();
    // ---- wallet (phase 2) ----
    // (the play-money wallet and its bets go with the account)
    this.onDelete(deleteWallet);
    // ---- end wallet ----
    // ---- friends (phase 2) ----
    // (every friend and request, both halves: loaded only when an account is deleted)
    this.onDelete((uid) => import('./friends/friends-cleanup').then((m) => m.removeFriends(uid)));
    // ---- end friends ----
    // ---- tracker (phase 2) ----
    // (the pinned comparisons: loaded only when an account is deleted)
    this.onDelete((uid) => import('./tracker/tracker.store').then((m) => m.deletePins(uid)));
    // ---- end tracker ----
    // ---- lists (phase 2) ----
    // (presets, saved lists, community entries and the votes on them, and the votes cast: loaded only
    // when an account is deleted)
    this.onDelete((uid) => import('./lists/lists-cleanup').then((m) => m.deleteListsData(uid)));
    // ---- end lists ----
  }

  // Loads the SDK and follows the sign-in (once)
  start(): Promise<void> {
    this.started ??= (async () => {
      const [a, { onAuthStateChanged }] = await Promise.all([auth(), import('firebase/auth')]);
      onAuthStateChanged(a, (user) => void this.follow(user));
    })().catch((error) => {
      this.started = null;
      this.known.set(true);
      this.adminKnown.set(true);
      throw error;
    });
    return this.started;
  }

  openLogin(): void {
    this.loginOpen.set(true);
    void this.start().catch(() => undefined);
  }

  closeLogin(): void {
    this.loginOpen.set(false);
  }

  // A later phase's data, deleted with the account
  onDelete(cleanup: AccountCleanup): void {
    this.cleanups.push(cleanup);
  }

  // ---------------------------------------------------------------------------
  // Following the sign-in
  // ---------------------------------------------------------------------------
  private async follow(user: User | null): Promise<void> {
    this.stopProfile?.();
    this.stopProfile = null;
    if (!user) {
      this.current.set(null);
      ADMIN.set(false);
      setHint(false);
      this.known.set(true);
      this.adminKnown.set(true);
      return;
    }
    setHint(true);
    const base: AccountUser = {
      uid: user.uid,
      profile: this.current()?.uid === user.uid ? (this.current()?.profile ?? null) : null,
      email: user.email,
      providers: user.providerData.map((p) => p.providerId),
      providerPhoto: user.providerData.find((p) => p.photoURL)?.photoURL ?? user.photoURL ?? null,
      admin: false,
    };
    this.current.set(base);
    this.known.set(true);

    // (admin: a custom claim on the token; a fresh token, so a claim set since the last visit applies now)
    user
      .getIdTokenResult(true)
      .then((token) => {
        const admin = token.claims['admin'] === true;
        ADMIN.set(admin);
        this.patch(user.uid, { admin });
      })
      .catch(() => undefined)
      .finally(() => this.adminKnown.set(true));

    const [firestore, { doc, onSnapshot }] = await Promise.all([db(), import('firebase/firestore')]);
    let checked = false;
    this.stopProfile = onSnapshot(
      doc(firestore, 'users', user.uid),
      (snap) => {
        if (snap.exists()) this.patch(user.uid, { profile: snap.data() as Profile });
        else if (!checked && !this.registering && !snap.metadata.fromCache) {
          // (a first Google or Facebook sign-in: a profile made from their name, the username editable later)
          checked = true;
          this.createProfile(user).catch((error) => console.error('Profile', error));
        }
      },
      (error) => console.error('Profile', error),
    );
  }

  private patch(uid: string, change: Partial<AccountUser>): void {
    const now = this.current();
    if (now?.uid === uid) this.current.set({ ...now, ...change });
  }

  private async me(): Promise<User> {
    await this.start();
    const user = (await auth()).currentUser;
    if (!user) throw fail('auth/no-current-user');
    return user;
  }

  // ---------------------------------------------------------------------------
  // Signing in and out
  // ---------------------------------------------------------------------------
  private async provider(id: SocialProvider): Promise<AuthProvider> {
    const a = await import('firebase/auth');
    if (id === 'google.com') {
      const google = new a.GoogleAuthProvider();
      google.setCustomParameters({ prompt: 'select_account' });
      return google;
    }
    const facebook = new a.FacebookAuthProvider();
    facebook.addScope('public_profile');
    return facebook;
  }

  async signInWith(id: SocialProvider): Promise<void> {
    const [a, { signInWithPopup }] = await Promise.all([auth(), import('firebase/auth')]);
    await this.start();
    await signInWithPopup(a, await this.provider(id));
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const [a, { signInWithEmailAndPassword }] = await Promise.all([auth(), import('firebase/auth')]);
    await this.start();
    await signInWithEmailAndPassword(a, email.trim(), password);
  }

  // A new email account: the username checked first, the account made, then the username claimed and the
  // profile written together (if someone took the name in between, the new account is removed again)
  async register(email: string, password: string, username: string, displayName: string): Promise<void> {
    const name = cleanUsername(username);
    if (!(await this.usernameAvailable(name))) throw fail('username-taken');
    const [a, { createUserWithEmailAndPassword, updateProfile }] = await Promise.all([auth(), import('firebase/auth')]);
    await this.start();
    this.registering = true;
    try {
      const { user } = await createUserWithEmailAndPassword(a, email.trim(), password);
      try {
        await this.writeNewProfile(user, name, displayName.trim(), null);
      } catch (error) {
        await user.delete().catch(() => undefined);
        throw error;
      }
      await updateProfile(user, { displayName: displayName.trim() }).catch(() => undefined);
    } finally {
      this.registering = false;
    }
  }

  async resetPassword(email: string): Promise<void> {
    const [a, { sendPasswordResetEmail }] = await Promise.all([auth(), import('firebase/auth')]);
    await sendPasswordResetEmail(a, email.trim());
  }

  async signOut(): Promise<void> {
    const [a, { signOut }] = await Promise.all([auth(), import('firebase/auth')]);
    await signOut(a);
  }

  // ---------------------------------------------------------------------------
  // The profile
  // ---------------------------------------------------------------------------
  // (a first social sign-in: the first free username from their name)
  private async createProfile(user: User): Promise<void> {
    const base = usernameFrom(user.displayName, user.email);
    const photo: Photo | null = user.photoURL ? { kind: 'provider', url: user.photoURL } : null;
    const displayName = (user.displayName || base).slice(0, 40);
    for (const name of usernameCandidates(base)) {
      try {
        await this.writeNewProfile(user, name, displayName, photo);
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'username-taken') throw error;
      }
    }
    throw fail('username-taken');
  }

  // The username's claim, the profile and the private settings, in one transaction
  private async writeNewProfile(user: User, username: string, displayName: string, photo: Photo | null): Promise<void> {
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const lower = usernameKey(username);
    await f.runTransaction(firestore, async (tx) => {
      // (already made, by another tab or a late duplicate: leave it)
      if ((await tx.get(f.doc(firestore, 'users', user.uid))).exists()) return;
      const claim = await tx.get(f.doc(firestore, 'usernames', lower));
      if (claim.exists()) throw fail('username-taken');
      const profile = {
        username,
        usernameLower: lower,
        displayName,
        photo,
        bio: '',
        visibility: { ...DEFAULT_VISIBILITY },
        createdAt: f.serverTimestamp(),
        updatedAt: f.serverTimestamp(),
      };
      tx.set(f.doc(firestore, 'usernames', lower), { uid: user.uid });
      tx.set(f.doc(firestore, 'users', user.uid), profile);
      tx.set(f.doc(firestore, 'users', user.uid, 'private', 'settings'), { email: user.email ?? null });
    });
  }

  // (is a username free: not claimed, or claimed by this user)
  async usernameAvailable(username: string): Promise<boolean> {
    const [firestore, { doc, getDoc }] = await Promise.all([db(), import('firebase/firestore')]);
    const claim = await getDoc(doc(firestore, 'usernames', usernameKey(username)));
    return !claim.exists() || claim.data()['uid'] === this.current()?.uid;
  }

  // The profile's own fields (display name, photo, bio, favorite team)
  async updateProfile(change: Partial<Pick<Profile, 'displayName' | 'photo' | 'bio' | 'favoriteTeam'>>): Promise<void> {
    const user = await this.me();
    const [firestore, { doc, serverTimestamp, updateDoc }] = await Promise.all([db(), import('firebase/firestore')]);
    await updateDoc(doc(firestore, 'users', user.uid), { ...change, updatedAt: serverTimestamp() });
  }

  async setVisibility(kind: VisibilityKind, value: Visibility): Promise<void> {
    const user = await this.me();
    const [firestore, { doc, serverTimestamp, updateDoc }] = await Promise.all([db(), import('firebase/firestore')]);
    await updateDoc(doc(firestore, 'users', user.uid), { [`visibility.${kind}`]: value, updatedAt: serverTimestamp() });
  }

  // A new username: the new name claimed, the profile pointed at it and the old claim let go, together
  async changeUsername(username: string): Promise<void> {
    const user = await this.me();
    const name = cleanUsername(username);
    const lower = usernameKey(name);
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    await f.runTransaction(firestore, async (tx) => {
      const mine = await tx.get(f.doc(firestore, 'users', user.uid));
      const old = (mine.data()?.['usernameLower'] as string | undefined) ?? null;
      const profile = f.doc(firestore, 'users', user.uid);
      if (old === lower) {
        // (only its capitals changed: the same claim)
        tx.update(profile, { username: name, updatedAt: f.serverTimestamp() });
        return;
      }
      const claim = await tx.get(f.doc(firestore, 'usernames', lower));
      if (claim.exists()) throw fail('username-taken');
      tx.set(f.doc(firestore, 'usernames', lower), { uid: user.uid });
      tx.update(profile, { username: name, usernameLower: lower, updatedAt: f.serverTimestamp() });
      if (old) tx.delete(f.doc(firestore, 'usernames', old));
    });
  }

  // ---------------------------------------------------------------------------
  // The account
  // ---------------------------------------------------------------------------
  // (a password change: the current one asked for again first)
  async changePassword(current: string, next: string): Promise<void> {
    const user = await this.me();
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import('firebase/auth');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', current));
    await updatePassword(user, next);
  }

  // Another way to sign in to the same account
  async link(id: SocialProvider): Promise<void> {
    const user = await this.me();
    const { linkWithPopup } = await import('firebase/auth');
    await linkWithPopup(user, await this.provider(id));
    await user.reload();
    this.patch(user.uid, { providers: user.providerData.map((p) => p.providerId) });
  }

  // Deleting the account: signed in again first (a password account with its password, a social one in
  // its pop-up), then every document it owns, then the sign-in itself
  async deleteAccount(password?: string): Promise<void> {
    const user = await this.me();
    const a = await import('firebase/auth');
    const providers = user.providerData.map((p) => p.providerId);
    if (providers.includes('password') && password !== undefined) {
      await a.reauthenticateWithCredential(user, a.EmailAuthProvider.credential(user.email ?? '', password));
    } else {
      const social = providers.find((p): p is SocialProvider => p === 'google.com' || p === 'facebook.com');
      if (social) await a.reauthenticateWithPopup(user, await this.provider(social));
    }
    for (const cleanup of this.cleanups) await cleanup(user.uid);
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    this.stopProfile?.();
    this.stopProfile = null;
    const profile = await f.getDoc(f.doc(firestore, 'users', user.uid));
    const batch = f.writeBatch(firestore);
    batch.delete(f.doc(firestore, 'users', user.uid, 'private', 'settings'));
    const lower = profile.data()?.['usernameLower'] as string | undefined;
    if (lower) batch.delete(f.doc(firestore, 'usernames', lower));
    batch.delete(f.doc(firestore, 'users', user.uid));
    await batch.commit();
    await a.deleteUser(user);
  }
}
