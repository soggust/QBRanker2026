import { firestoreSdk } from '@ranker/core/firebase';
import { deleteRefs } from '../account-cleanup';

// Deleting an account: every friend, request and invitation it's part of, both halves (its own doc and the
// mirror on the other side, together: the rules want both gone in the same write). Registered with
// AccountService.onDelete, loaded only then.
export async function removeFriends(uid: string): Promise<void> {
  const [firestore, f] = await firestoreSdk();
  const mine = await f.getDocs(f.collection(firestore, 'users', uid, 'friends'));
  await deleteRefs(mine.docs.flatMap((d) => [d.ref, f.doc(firestore, 'users', d.id, 'friends', uid)]));
}
