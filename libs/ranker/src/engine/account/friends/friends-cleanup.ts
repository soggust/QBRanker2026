import { db } from '@ranker/core/firebase';

// Deleting an account: every friend, request and invitation it's part of, both halves (its own doc and the
// mirror on the other side, together: the rules want both gone in the same write). Registered with
// AccountService.onDelete, loaded only then.
export async function removeFriends(uid: string): Promise<void> {
  const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
  const mine = await f.getDocs(f.collection(firestore, 'users', uid, 'friends'));
  // (a batch holds 500 writes: two per friend)
  for (let i = 0; i < mine.docs.length; i += 200) {
    const batch = f.writeBatch(firestore);
    for (const d of mine.docs.slice(i, i + 200)) {
      batch.delete(d.ref);
      batch.delete(f.doc(firestore, 'users', d.id, 'friends', uid));
    }
    await batch.commit();
  }
}
