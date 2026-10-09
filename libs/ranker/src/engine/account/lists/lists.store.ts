import { Injectable, inject, signal } from '@angular/core';
import { db } from '@ranker/core/firebase';
import { AccountService } from '../account.service';
import type { Visibility } from '../account-helpers';
import { CommunityEntry, boardKey } from '../community/community-helpers';
import { LIST_MAX, SavedList, Snapshot } from './lists-helpers';

// A new list's fields (the snapshot and where it came from)
export type ListDraft = Snapshot & Pick<SavedList, 'sport' | 'tab' | 'season' | 'part' | 'basis'>;

const fromDoc = (owner: string, id: string, data: Record<string, unknown>): SavedList =>
  ({
    note: '',
    labels: [],
    formats: [],
    lower: [],
    columns: [],
    ids: [],
    snapshot: {},
    basis: 'season',
    part: 'regular',
    ...data,
    id,
    owner,
  }) as unknown as SavedList;

// (a time from Firestore, as milliseconds: none before the server's stamp lands)
export const millis = (stamp: unknown): number => (stamp as { toMillis?: () => number } | null)?.toMillis?.() ?? Date.now();

// Saved lists in Firestore (users/{uid}/lists/{id}): the signed-in user's own, followed live while a page
// shows them, and anyone's one list by its address (the rules decide who may read it: its visibility)
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly account = inject(AccountService);

  // The user's lists, newest change first (null: not loaded yet)
  readonly mine = signal<SavedList[] | null>(null);
  readonly error = signal('');
  private following: string | null = null;
  private stop: (() => void) | null = null;

  // Follows the signed-in user's lists (again when the user changes; nothing when signed out)
  async follow(uid: string | null): Promise<void> {
    if (uid === this.following) return;
    this.stop?.();
    this.stop = null;
    this.following = uid;
    this.mine.set(null);
    if (!uid) return;
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    if (this.following !== uid) return;
    this.stop = f.onSnapshot(
      f.query(f.collection(firestore, 'users', uid, 'lists'), f.orderBy('updatedAt', 'desc')),
      (snap) => {
        this.error.set('');
        this.mine.set(snap.docs.map((d) => fromDoc(uid, d.id, d.data())));
      },
      (error) => {
        console.error('Lists', error);
        this.error.set('Couldn’t load your lists. Try again in a moment.');
        this.mine.set([]);
      },
    );
  }

  // One list, followed live (its owner's edits show as they're made); null when it's gone or hidden
  async watch(owner: string, id: string, next: (list: SavedList | null, error?: unknown) => void): Promise<() => void> {
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    return f.onSnapshot(
      f.doc(firestore, 'users', owner, 'lists', id),
      (snap) => next(snap.exists() ? fromDoc(owner, id, snap.data()) : null),
      (error) => next(null, error),
    );
  }

  private async uid(): Promise<string> {
    await this.account.start();
    const uid = this.account.user()?.uid;
    if (!uid) throw Object.assign(new Error('signed out'), { code: 'permission-denied' });
    return uid;
  }

  async create(draft: ListDraft, title: string, note: string, visibility: Visibility): Promise<string> {
    const uid = await this.uid();
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const ref = f.doc(f.collection(firestore, 'users', uid, 'lists'));
    await f.setDoc(ref, {
      sport: draft.sport,
      tab: draft.tab,
      season: draft.season,
      part: draft.part,
      basis: draft.basis,
      title: title.trim(),
      note: note.trim(),
      ids: draft.ids.slice(0, LIST_MAX),
      snapshot: draft.snapshot,
      columns: draft.columns,
      labels: draft.labels,
      formats: draft.formats,
      lower: draft.lower,
      visibility,
      createdAt: f.serverTimestamp(),
      updatedAt: f.serverTimestamp(),
    });
    return ref.id;
  }

  // A list's own fields changed (title, note, visibility, a new order or snapshot)
  async update(id: string, change: Partial<Pick<SavedList, 'title' | 'note' | 'visibility' | 'ids' | 'snapshot'>>): Promise<void> {
    const uid = await this.uid();
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    await f.updateDoc(f.doc(firestore, 'users', uid, 'lists', id), { ...change, updatedAt: f.serverTimestamp() });
  }

  // Deleted, and its community entry with it
  async remove(list: SavedList): Promise<void> {
    const uid = await this.uid();
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    if (list.community?.key) await this.withdraw(list).catch(() => undefined);
    await f.deleteDoc(f.doc(firestore, 'users', uid, 'lists', list.id));
  }

  // ---------------------------------------------------------------------------
  // The community board (community/{sport_tab_season}/entries/{uid}: one list per user per board)
  // ---------------------------------------------------------------------------
  // The user's entry on a board, if any
  async entry(key: string): Promise<CommunityEntry | null> {
    const uid = await this.uid();
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const snap = await f.getDoc(f.doc(firestore, 'community', key, 'entries', uid));
    return snap.exists() ? ({ ...(snap.data() as CommunityEntry), owner: uid }) : null;
  }

  // Submitted: the list's order on its board (replacing the user's earlier entry there; another list's
  // votes don't carry over to this one), the list marked
  async submit(list: SavedList): Promise<void> {
    const uid = await this.uid();
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const key = boardKey(list.sport, list.tab, list.season);
    const entryRef = f.doc(firestore, 'community', key, 'entries', uid);
    const before = await f.getDoc(entryRef);
    const previous = before.exists() ? (before.data()['listId'] as string) : null;
    if (previous && previous !== list.id) {
      await this.clearVotes(key, uid);
      // (the list it replaces isn't on the board any more)
      await f.updateDoc(f.doc(firestore, 'users', uid, 'lists', previous), { community: null, updatedAt: f.serverTimestamp() }).catch(() => undefined);
    }
    const ids = list.ids.filter((id) => id in list.snapshot).slice(0, LIST_MAX);
    const profile = this.account.profile();
    const batch = f.writeBatch(firestore);
    batch.set(entryRef, {
      listId: list.id,
      title: list.title,
      ownerName: (profile?.displayName || profile?.username || 'Someone').slice(0, 40),
      ids,
      names: ids.map((id) => list.snapshot[id].name.slice(0, 80)),
      logos: ids.map((id) => list.snapshot[id].teamLogo?.slice(0, 300) ?? null),
      submittedAt: f.serverTimestamp(),
    });
    batch.update(f.doc(firestore, 'users', uid, 'lists', list.id), { community: { submitted: true, key }, updatedAt: f.serverTimestamp() });
    await batch.commit();
  }

  // Taken off the board (its votes with it)
  async withdraw(list: SavedList): Promise<void> {
    const uid = await this.uid();
    const key = list.community?.key ?? boardKey(list.sport, list.tab, list.season);
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const entryRef = f.doc(firestore, 'community', key, 'entries', uid);
    const snap = await f.getDoc(entryRef);
    if (snap.exists() && snap.data()['listId'] === list.id) {
      await this.clearVotes(key, uid);
      await f.deleteDoc(entryRef);
    }
    await f.updateDoc(f.doc(firestore, 'users', uid, 'lists', list.id), { community: null, updatedAt: f.serverTimestamp() }).catch(() => undefined);
  }

  // (the votes on the user's entry: its owner may clear them)
  private async clearVotes(key: string, uid: string): Promise<void> {
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const votes = await f.getDocs(f.collection(firestore, 'community', key, 'entries', uid, 'votes'));
    for (let i = 0; i < votes.docs.length; i += 400) {
      const batch = f.writeBatch(firestore);
      votes.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}
