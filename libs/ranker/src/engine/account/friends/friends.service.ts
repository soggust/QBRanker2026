import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import type { DocumentReference, FieldValue, WriteBatch } from 'firebase/firestore';
import { firestoreSdk } from '@ranker/core/firebase';
import { AccountService } from '../account.service';
import { Profile, USERNAME_PATTERN, signedOut } from '../account-helpers';
import { FriendStatus, SEARCH_LIMIT, millis, prefixRange, sortFriends } from './friends-helpers';

// (someone else's profile, with whose it is)
export interface PublicProfile {
  uid: string;
  profile: Profile;
}

// (one of the signed-in user's friend docs, with the other user's profile once it's loaded)
export interface FriendEntry {
  uid: string;
  status: FriendStatus;
  since: number;
  name: string;
  profile: Profile | null;
  // (its profile looked up: false while it loads; true with a null profile, a deleted account)
  known: boolean;
}

// Friends: the signed-in user's friend docs (users/{uid}/friends, followed live while they're signed in, so
// the menu's badge counts incoming requests), the other users' profiles for them, and the writes that move a
// pair along: a request (my pending-out and their pending-in), an accept (both friends), and a decline,
// cancel or unfriend (both gone). Each write is one batch, both halves, as firestore.rules requires.
@Injectable({ providedIn: 'root' })
export class FriendsService {
  private readonly docs = signal<{ uid: string; status: FriendStatus; since: number }[] | null>(null);
  private readonly profiles = signal<Record<string, Profile | null>>({});
  private stop: (() => void) | null = null;
  private following: string | null = null;

  // (null until the first snapshot)
  readonly loaded = computed(() => this.docs() !== null);
  readonly error = signal('');
  readonly entries = computed<FriendEntry[]>(() => {
    const profiles = this.profiles();
    return (this.docs() ?? []).map((d) => {
      const profile = profiles[d.uid] ?? null;
      return { ...d, profile, known: d.uid in profiles, name: profile?.displayName || profile?.username || '' };
    });
  });
  readonly groups = computed(() => sortFriends(this.entries()));
  readonly incomingCount = computed(() => this.groups().incoming.length);
  private readonly statuses = computed(() => new Map((this.docs() ?? []).map((d) => [d.uid, d.status])));

  // (the uid a write is underway for, so its buttons wait)
  readonly busy = signal<string | null>(null);

  constructor(private readonly account: AccountService) {
    effect(() => {
      const uid = this.account.user()?.uid ?? null;
      untracked(() => void this.follow(uid));
    });
  }

  // The friends' profiles (their names and pictures), read only for a page that shows them (the Friends page):
  // the sport bar's badge, on every page, needs only the friend docs themselves
  private profilesWanted = false;

  showProfiles(): void {
    if (this.profilesWanted) return;
    this.profilesWanted = true;
    void this.loadProfiles((this.docs() ?? []).map((d) => d.uid));
  }

  statusOf(uid: string): FriendStatus | null {
    return this.statuses().get(uid) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Following the signed-in user's friend docs
  // ---------------------------------------------------------------------------
  private async follow(uid: string | null): Promise<void> {
    if (uid === this.following) return;
    this.following = uid;
    this.stop?.();
    this.stop = null;
    this.docs.set(null);
    if (!uid) return;
    const [firestore, { collection, onSnapshot }] = await firestoreSdk();
    if (this.following !== uid) return;
    this.stop = onSnapshot(
      collection(firestore, 'users', uid, 'friends'),
      (snap) => {
        const docs = snap.docs.map((d) => ({ uid: d.id, status: d.data()['status'] as FriendStatus, since: millis(d.data()['since']) }));
        this.docs.set(docs);
        this.error.set('');
        if (this.profilesWanted) void this.loadProfiles(docs.map((d) => d.uid));
      },
      (error) => {
        console.error('Friends', error);
        this.docs.set([]);
        this.error.set('Couldn’t load your friends. Try again later.');
      },
    );
  }

  // (the profiles not loaded yet)
  private async loadProfiles(uids: string[]): Promise<void> {
    const missing = uids.filter((uid) => !(uid in this.profiles()));
    if (!missing.length) return;
    const [firestore, { doc, getDoc }] = await firestoreSdk();
    const found = await Promise.all(
      missing.map((uid) =>
        getDoc(doc(firestore, 'users', uid))
          .then((snap) => [uid, snap.exists() ? (snap.data() as Profile) : null] as const)
          .catch(() => [uid, null] as const),
      ),
    );
    this.profiles.update((all) => ({ ...all, ...Object.fromEntries(found) }));
  }

  private remember(found: PublicProfile[]): void {
    this.profiles.update((all) => ({ ...all, ...Object.fromEntries(found.map((p) => [p.uid, p.profile])) }));
  }

  // ---------------------------------------------------------------------------
  // Finding people
  // ---------------------------------------------------------------------------
  // (usernames starting with a prefix, already cleaned: searchPrefix)
  async search(prefix: string): Promise<PublicProfile[]> {
    const [firestore, f] = await firestoreSdk();
    const [start, end] = prefixRange(prefix);
    const claims = await f.getDocs(
      f.query(f.collection(firestore, 'usernames'), f.where(f.documentId(), '>=', start), f.where(f.documentId(), '<', end), f.limit(SEARCH_LIMIT)),
    );
    const found = await Promise.all(
      claims.docs.map(async (claim) => {
        const uid = claim.data()['uid'] as string;
        const snap = await f.getDoc(f.doc(firestore, 'users', uid)).catch(() => null);
        return snap?.exists() ? { uid, profile: snap.data() as Profile } : null;
      }),
    );
    const people = found.filter((p): p is PublicProfile => !!p);
    this.remember(people);
    return people;
  }

  // (a profile by its username, any capitals: null when no one has it)
  async byUsername(username: string): Promise<PublicProfile | null> {
    // (not a username at all, e.g. #u/a/b: no one, without asking)
    const name = username.trim().replace(/^@+/, '');
    if (!USERNAME_PATTERN.test(name)) return null;
    const [firestore, { doc, getDoc }] = await firestoreSdk();
    const claim = await getDoc(doc(firestore, 'usernames', name.toLowerCase()));
    if (!claim.exists()) return null;
    const uid = claim.data()['uid'] as string;
    const snap = await getDoc(doc(firestore, 'users', uid));
    if (!snap.exists()) return null;
    const found = { uid, profile: snap.data() as Profile };
    this.remember([found]);
    return found;
  }

  // ---------------------------------------------------------------------------
  // The writes: both halves together
  // ---------------------------------------------------------------------------
  private async pair(other: string, write: (batch: WriteBatch, mine: DocumentReference, theirs: DocumentReference, now: FieldValue) => void): Promise<void> {
    const me = this.account.user()?.uid;
    if (!me) throw signedOut();
    this.busy.set(other);
    try {
      const [firestore, f] = await firestoreSdk();
      const batch = f.writeBatch(firestore);
      write(batch, f.doc(firestore, 'users', me, 'friends', other), f.doc(firestore, 'users', other, 'friends', me), f.serverTimestamp());
      await batch.commit();
    } finally {
      this.busy.set(null);
    }
  }

  // (asking: mine pending-out, theirs pending-in)
  request(other: string): Promise<void> {
    try {
      this.account.requireVerified();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.pair(other, (batch, mine, theirs, now) => {
      batch.set(mine, { status: 'pending-out', since: now });
      batch.set(theirs, { status: 'pending-in', since: now });
    });
  }

  // (saying yes to their request: both friends)
  accept(other: string): Promise<void> {
    return this.pair(other, (batch, mine, theirs, now) => {
      batch.update(mine, { status: 'friends', since: now });
      batch.update(theirs, { status: 'friends', since: now });
    });
  }

  // (a decline, a cancel or an unfriend: both halves gone)
  remove(other: string): Promise<void> {
    return this.pair(other, (batch, mine, theirs) => {
      batch.delete(mine);
      batch.delete(theirs);
    });
  }
}
