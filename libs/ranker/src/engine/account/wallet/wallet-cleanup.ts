import { firestoreSdk } from '@ranker/core/firebase';
import { deleteRefs } from '../account-cleanup';

// The wallet's part of deleting an account (AccountService.onDelete): every settled bet and the wallet itself.
// An open bet can't be deleted from the browser (firestore.rules: so a losing one can't be dropped before it's
// counted), so open ones stay for the settler, which removes a deleted account's open bets and its tally
// (tallies/{uid}) on its next run, and the leaderboards with them.
export async function deleteWallet(uid: string): Promise<void> {
  const [firestore, f] = await firestoreSdk();
  const bets = await f.getDocs(f.collection(firestore, 'users', uid, 'bets'));
  const settled = bets.docs.filter((d) => d.data()['status'] !== 'open').map((d) => d.ref);
  await deleteRefs([...settled, f.doc(firestore, 'users', uid, 'wallet', 'main')]);
}
