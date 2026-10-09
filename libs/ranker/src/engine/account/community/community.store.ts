import { Injectable, inject } from '@angular/core';
import { db } from '@ranker/core/firebase';
import { AccountService } from '../account.service';
import type { Profile } from '../account-helpers';
import { CommunityEntry, VoteTally, tally } from './community-helpers';

// An entry with its votes added up
export interface EntryCard {
  entry: CommunityEntry;
  tally: VoteTally;
}

// The community boards in Firestore: a board's entries (community/{key}/entries/{uid}, anyone may read)
// with their votes (…/votes/{voterUid}: { value: 1 | -1, voter }), and the user's own vote on one. The
// counts are added up here from the votes for now; an Admin tally can write them to community/{key}
// later.
@Injectable({ providedIn: 'root' })
export class CommunityStore {
  private readonly account = inject(AccountService);

  async board(key: string): Promise<EntryCard[]> {
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const entries = await f.getDocs(f.collection(firestore, 'community', key, 'entries'));
    const me = this.account.user()?.uid ?? null;
    return Promise.all(
      entries.docs.map(async (d) => {
        // (only the votes for this submission count: a vote's `at` is the entry's submittedAt; firestore.rules)
        const submitted = d.data()['submittedAt'] as { isEqual?: (o: unknown) => boolean } | undefined;
        const votes = (await f.getDocs(f.collection(d.ref, 'votes'))).docs.filter((v) => !!submitted?.isEqual?.(v.data()['at']));
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

  // The user's vote on an entry: up, down, or taken back (0)
  async vote(key: string, owner: string, value: 1 | -1 | 0): Promise<void> {
    await this.account.start();
    const uid = this.account.user()?.uid;
    if (!uid) throw Object.assign(new Error('signed out'), { code: 'permission-denied' });
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const entryRef = f.doc(firestore, 'community', key, 'entries', owner);
    const ref = f.doc(entryRef, 'votes', uid);
    if (value === 0) {
      await f.deleteDoc(ref);
      return;
    }
    // (for the entry as submitted now: its submittedAt, which the rules check)
    const at = (await f.getDoc(entryRef)).data()?.['submittedAt'];
    await f.setDoc(ref, { value, voter: uid, at: at ?? null });
  }

  // The list makers' public profiles (their pictures and usernames), read once each
  private profiles = new Map<string, Promise<Profile | null>>();

  profile(uid: string): Promise<Profile | null> {
    let profile = this.profiles.get(uid);
    if (!profile) {
      profile = (async () => {
        const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
        const snap = await f.getDoc(f.doc(firestore, 'users', uid));
        return snap.exists() ? (snap.data() as Profile) : null;
      })().catch(() => null);
      this.profiles.set(uid, profile);
    }
    return profile;
  }
}
