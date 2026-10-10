import { Injectable, inject } from '@angular/core';
import { firestoreSdk } from '@ranker/core/firebase';
import { AccountService } from '../account.service';
import type { Profile } from '../account-helpers';
import { CommunityEntry, VoteTally, tally } from './community-helpers';

// An entry with its votes added up
export interface EntryCard {
  entry: CommunityEntry;
  tally: VoteTally;
}

// (a board read once in this long is shown again as read: switching the position or season, and coming back,
// costs nothing; a vote or a submission of the user's own drops it at once)
const BOARD_TTL = 5 * 60e3;

// The community boards in Firestore: a board's entries (community/{key}/entries/{uid}, anyone may read)
// with their votes (…/votes/{voterUid}: { value: 1 | -1, voter }), and the user's own vote on one. The
// counts are added up here from the votes for now; an Admin tally can write them to community/{key}
// later.
@Injectable({ providedIn: 'root' })
export class CommunityStore {
  private readonly account = inject(AccountService);
  // (each board read, by its key and who read it: whose vote is whose counts in its tallies)
  private readonly boards = new Map<string, { at: number; cards: Promise<EntryCard[]> }>();

  board(key: string): Promise<EntryCard[]> {
    const cacheKey = `${key}|${this.account.user()?.uid ?? ''}`;
    const kept = this.boards.get(cacheKey);
    if (kept && Date.now() - kept.at < BOARD_TTL) return kept.cards;
    const cards = this.read(key);
    this.boards.set(cacheKey, { at: Date.now(), cards });
    cards.catch(() => this.boards.delete(cacheKey));
    return cards;
  }

  // (a board read again next time it's asked for: the user's own vote or submission changed it)
  forget(key: string): void {
    for (const cacheKey of this.boards.keys()) if (cacheKey.startsWith(`${key}|`)) this.boards.delete(cacheKey);
  }

  private async read(key: string): Promise<EntryCard[]> {
    const [firestore, f] = await firestoreSdk();
    const entries = await f.getDocs(f.collection(firestore, 'community', key, 'entries'));
    const me = this.account.user()?.uid ?? null;
    return Promise.all(
      entries.docs.map(async (d) => {
        // (only the votes for this submission count, and only they're read: a vote's `at` is the entry's
        // submittedAt; firestore.rules)
        const submitted = d.data()['submittedAt'];
        const votes = submitted ? (await f.getDocs(f.query(f.collection(d.ref, 'votes'), f.where('at', '==', submitted)))).docs : [];
        const entry = { ...(d.data() as Omit<CommunityEntry, 'owner'>), owner: d.id } as CommunityEntry;
        entry.ids ??= [];
        entry.names ??= [];
        entry.logos ??= [];
        return {
          entry,
          tally: tally(
            votes.map((v) => ({ voter: v.id, value: v.data()['value'] as number })),
            me,
          ),
        };
      }),
    );
  }

  // The user's vote on an entry: up, down, or taken back (0); `at`, the entry's submittedAt as the board read it
  // (the rules check it), else read here
  async vote(key: string, owner: string, value: 1 | -1 | 0, at?: unknown): Promise<void> {
    await this.account.start();
    const uid = this.account.user()?.uid;
    if (!uid) throw Object.assign(new Error('signed out'), { code: 'permission-denied' });
    if (value !== 0) this.account.requireVerified();
    const [firestore, f] = await firestoreSdk();
    const entryRef = f.doc(firestore, 'community', key, 'entries', owner);
    const ref = f.doc(entryRef, 'votes', uid);
    this.forget(key);
    if (value === 0) {
      await f.deleteDoc(ref);
      return;
    }
    // (for the entry as submitted now: its submittedAt, which the rules check)
    const submitted = at ?? (await f.getDoc(entryRef)).data()?.['submittedAt'];
    await f.setDoc(ref, { value, voter: uid, at: submitted ?? null });
  }

  // The list makers' public profiles (their pictures and usernames), read once each
  private profiles = new Map<string, Promise<Profile | null>>();

  profile(uid: string): Promise<Profile | null> {
    let profile = this.profiles.get(uid);
    if (!profile) {
      profile = (async () => {
        const [firestore, f] = await firestoreSdk();
        const snap = await f.getDoc(f.doc(firestore, 'users', uid));
        return snap.exists() ? (snap.data() as Profile) : null;
      })().catch(() => null);
      this.profiles.set(uid, profile);
    }
    return profile;
  }
}
