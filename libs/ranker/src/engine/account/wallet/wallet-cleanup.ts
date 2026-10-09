import { db } from '@ranker/core/firebase';

// The wallet's part of deleting an account (AccountService.onDelete): every bet the user placed, open or
// settled, and the wallet itself. The settler's tally (tallies/{uid}) is the Admin's to remove: it drops a
// tally whose profile is gone on its next run, and the leaderboards with it.
export async function deleteWallet(uid: string): Promise<void> {
  const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
  const bets = await f.getDocs(f.collection(firestore, 'users', uid, 'bets'));
  const refs = [...bets.docs.map((d) => d.ref), f.doc(firestore, 'users', uid, 'wallet', 'main')];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = f.writeBatch(firestore);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}
