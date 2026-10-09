import { db } from '@ranker/core/firebase';
import { deleteRefs } from '../account-cleanup';

// Every pin a user has, deleted (their account going: AccountService.onDelete, loaded only then)
export async function deletePins(uid: string): Promise<void> {
  const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
  const snap = await f.getDocs(f.collection(firestore, 'users', uid, 'pins'));
  await deleteRefs(snap.docs.map((d) => d.ref));
}
