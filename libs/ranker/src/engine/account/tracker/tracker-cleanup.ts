import { firestoreSdk } from '@ranker/core/firebase';
import { deleteRefs } from '../account-cleanup';

// Every pin a user has, deleted (their account going: AccountService.onDelete, loaded only then)
export async function deletePins(uid: string): Promise<void> {
  const [firestore, f] = await firestoreSdk();
  const snap = await f.getDocs(f.collection(firestore, 'users', uid, 'pins'));
  await deleteRefs(snap.docs.map((d) => d.ref));
}
