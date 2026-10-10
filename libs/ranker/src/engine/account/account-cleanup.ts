import type { DocumentReference } from 'firebase/firestore';
import { firestoreSdk } from '@ranker/core/firebase';

// Deleting an account's documents (each feature's AccountService.onDelete cleanup): in batches of 400 (a
// batch holds 500 writes). The count is even, so pairs that must go in the same write (a friendship's two
// halves, listed one after the other) stay together.
export async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  if (!refs.length) return;
  const [firestore, { writeBatch }] = await firestoreSdk();
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(firestore);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}
