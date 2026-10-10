import { firestoreSdk } from '@ranker/core/firebase';
import { deleteRefs } from '../account-cleanup';

// A deleted account's presets, lists and community entries (their votes with them), and the votes it
// cast on others' entries: AccountService.deleteAccount runs this (onDelete) after signing in again,
// before the profile goes. Loaded only then.
export async function deleteListsData(uid: string): Promise<void> {
  const [firestore, f] = await firestoreSdk();
  type Ref = ReturnType<typeof f.doc>;
  const refs: Ref[] = [];

  // (its own: presets, lists, and each list's community entry with the votes on it)
  const [presets, lists, cast] = await Promise.all([
    f.getDocs(f.collection(firestore, 'users', uid, 'presets')),
    f.getDocs(f.collection(firestore, 'users', uid, 'lists')),
    // (its votes on other people's entries, wherever they are: votes carry their voter for this)
    f.getDocs(f.query(f.collectionGroup(firestore, 'votes'), f.where('voter', '==', uid))),
  ]);
  const boards = new Set<string>();
  for (const list of lists.docs) {
    const key = (list.data()['community'] as { key?: string } | null)?.key;
    if (key) boards.add(key);
  }
  for (const key of boards) {
    const entry = f.doc(firestore, 'community', key, 'entries', uid);
    const votes = await f.getDocs(f.collection(entry, 'votes'));
    // (the entry ahead of its votes: they're the owner's to clear only once it's gone; firestore.rules)
    refs.push(entry, ...votes.docs.map((d) => d.ref));
  }
  refs.push(...cast.docs.map((d) => d.ref), ...presets.docs.map((d) => d.ref), ...lists.docs.map((d) => d.ref));

  await deleteRefs(refs);
}
