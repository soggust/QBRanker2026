// The accounts' security review (phase 3), the browser's side: firestore.rules against an attacker with a valid
// account and the console (any write, any payload). Each test is one finding: it failed before its fix. Run by
// `npm run test:rules` against the Firestore emulator; without it these skip. Its own project id.
import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

const ROOT = path.resolve(import.meta.dirname, '../..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';

let env;
before(async () => {
  if (skip) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-season-ranker-security',
    firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env?.clearFirestore());

const as = (uid) => env.authenticatedContext(uid).firestore();
const seed = (fn) => env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
const VIS = { lists: 'public', presets: 'public', openBets: 'friends', betHistory: 'public', tracker: 'friends' };
const profile = (username) => ({
  username,
  usernameLower: username.toLowerCase(),
  displayName: username,
  photo: null,
  bio: '',
  visibility: { ...VIS },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

describe('security review: usernames', { skip }, () => {
  test('a profile is deleted only with its username’s claim (no hoarding names by dropping profiles)', async () => {
    const mallory = as('mallory');
    const signUp = (name) => {
      const batch = writeBatch(mallory);
      batch.set(doc(mallory, 'usernames', name), { uid: 'mallory' });
      batch.set(doc(mallory, 'users', 'mallory'), profile(name));
      return batch.commit();
    };
    await assertSucceeds(signUp('kingjames'));
    // (the profile alone: its claim would be held forever)
    await assertFails(deleteDoc(doc(mallory, 'users', 'mallory')));
    // (with its claim, as deleteAccount writes it)
    const batch = writeBatch(mallory);
    batch.delete(doc(mallory, 'usernames', 'kingjames'));
    batch.delete(doc(mallory, 'users', 'mallory'));
    await assertSucceeds(batch.commit());
    // (and the name is free again)
    const bob = as('bob');
    const claim = writeBatch(bob);
    claim.set(doc(bob, 'usernames', 'kingjames'), { uid: 'bob' });
    claim.set(doc(bob, 'users', 'bob'), profile('kingjames'));
    await assertSucceeds(claim.commit());
  });
});

describe('security review: play bets', { skip }, () => {
  const bet = (over = {}) => ({
    sport: 'nfl',
    event: '401',
    matchup: 'LV @ NE',
    start: Timestamp.fromMillis(Date.now() + 36e5),
    market: 'ml',
    side: 'home',
    odds: -150,
    stake: 100,
    pick: 'NE ML',
    run: 0,
    placedAt: serverTimestamp(),
    status: 'open',
    ...over,
  });

  test('an open bet can’t be deleted (a losing one dropped before the settler sees it would launder the record)', async () => {
    const db = as('mallory');
    await assertSucceeds(setDoc(doc(db, 'users', 'mallory', 'wallet', 'main'), { balance: 1000, start: 1000, resets: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'mallory', 'bets', 'b1'), bet());
    batch.update(doc(db, 'users', 'mallory', 'wallet', 'main'), { balance: increment(-100), lastBet: 'b1', updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
    await assertFails(deleteDoc(doc(db, 'users', 'mallory', 'bets', 'b1')));
    // (not even with the wallet going in the same write)
    const both = writeBatch(db);
    both.delete(doc(db, 'users', 'mallory', 'bets', 'b1'));
    both.delete(doc(db, 'users', 'mallory', 'wallet', 'main'));
    await assertFails(both.commit());
    // (a settled one still goes: Clear history; the tally keeps the record)
    await seed((f) => setDoc(doc(f, 'users', 'mallory', 'bets', 'old'), { ...bet(), status: 'lost', profit: -100 }));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'mallory', 'bets', 'old')));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'mallory', 'wallet', 'main')));
  });
});

describe('security review: community votes', { skip }, () => {
  const KEY = 'nfl_QB_2026';
  const entry = (listId = 'l1') => ({ listId, title: 'My QBs', ownerName: 'Mallory', ids: ['a', 'b'], names: ['A', 'B'], logos: [null, null], submittedAt: serverTimestamp() });
  const entryRef = (db) => doc(db, 'community', KEY, 'entries', 'mallory');
  const voteRef = (db, voter) => doc(db, 'community', KEY, 'entries', 'mallory', 'votes', voter);

  async function onTheBoard() {
    await seed(async (f) => {
      await setDoc(doc(f, 'users', 'mallory', 'lists', 'l1'), { title: 'l1' });
      await setDoc(doc(f, 'users', 'mallory', 'lists', 'l2'), { title: 'l2' });
    });
    await assertSucceeds(setDoc(entryRef(as('mallory')), entry()));
    return (await getDoc(entryRef(as('bob')))).data().submittedAt;
  }

  test('a vote names the submission it’s for; the entry’s owner can’t pick off the down votes', async () => {
    const at = await onTheBoard();
    // (a vote without the submission's time, or another time: no)
    await assertFails(setDoc(voteRef(as('bob'), 'bob'), { value: -1, voter: 'bob' }));
    await assertFails(setDoc(voteRef(as('bob'), 'bob'), { value: -1, voter: 'bob', at: Timestamp.fromMillis(0) }));
    await assertSucceeds(setDoc(voteRef(as('bob'), 'bob'), { value: -1, voter: 'bob', at }));
    await assertSucceeds(setDoc(voteRef(as('cy'), 'cy'), { value: 1, voter: 'cy', at }));
    // (the owner deleting a current vote, the down one: no)
    await assertFails(deleteDoc(voteRef(as('mallory'), 'bob')));
    // (nor by taking the entry down and putting it back: the votes are the old submission's, stale for good)
    await assertSucceeds(deleteDoc(entryRef(as('mallory'))));
    await assertSucceeds(setDoc(entryRef(as('mallory')), entry()));
    const again = (await getDoc(entryRef(as('bob')))).data().submittedAt;
    if (again.isEqual(at)) throw new Error('a new submission keeps its time');
    // (a stale vote: its owner may tidy it away, and the voter always takes theirs back)
    await assertSucceeds(deleteDoc(voteRef(as('mallory'), 'bob')));
    await assertSucceeds(deleteDoc(voteRef(as('cy'), 'cy')));
  });

  test('the entry going and its votes cleared in one write (the account’s cleanup)', async () => {
    const at = await onTheBoard();
    await assertSucceeds(setDoc(voteRef(as('bob'), 'bob'), { value: -1, voter: 'bob', at }));
    const db = as('mallory');
    const batch = writeBatch(db);
    batch.delete(entryRef(db));
    batch.delete(voteRef(db, 'bob'));
    await assertSucceeds(batch.commit());
  });

  test('another list submitted in the old one’s place: the old votes go stale and may be cleared', async () => {
    const at = await onTheBoard();
    await assertSucceeds(setDoc(voteRef(as('bob'), 'bob'), { value: -1, voter: 'bob', at }));
    const db = as('mallory');
    await assertSucceeds(setDoc(entryRef(db), entry('l2')));
    await assertSucceeds(deleteDoc(voteRef(db, 'bob')));
  });
});

describe('security review: presets', { skip }, () => {
  test('a preset can’t carry its own visibility (the rules read only the owner’s presets setting)', async () => {
    const ref = doc(as('ann'), 'users', 'ann', 'presets', 'p1');
    const preset = { sport: 'nfl', tab: 'QB', name: 'Mine', settings: { weights: {}, hidden: [], groups: [] }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(ref, { ...preset, visibility: 'private' }));
    await assertSucceeds(setDoc(ref, preset));
  });
});

// (what the review tried that the rules already stopped, kept as a guard)
describe('security review: probes that already failed', { skip }, () => {
  test('no reading around the visibility: collection groups, private settings, friends lists, extra profile fields', async () => {
    const { collectionGroup, getDocs, query, where } = await import('firebase/firestore');
    await seed(async (f) => {
      await setDoc(doc(f, 'users', 'ann'), { ...profile('ann'), createdAt: new Date(), updatedAt: new Date(), visibility: { ...VIS, lists: 'private', openBets: 'private', betHistory: 'private', tracker: 'private', presets: 'private' } });
      await setDoc(doc(f, 'users', 'ann', 'private', 'settings'), { email: 'ann@example.com' });
      await setDoc(doc(f, 'users', 'ann', 'friends', 'bob'), { status: 'friends', since: new Date() });
      await setDoc(doc(f, 'users', 'ann', 'lists', 'l1'), { visibility: 'private', title: 'x' });
      await setDoc(doc(f, 'users', 'ann', 'bets', 'b1'), { status: 'open', stake: 5 });
      await setDoc(doc(f, 'users', 'ann', 'pins', 'p1'), { title: 'x' });
    });
    const m = as('mallory');
    for (const group of ['bets', 'lists', 'pins', 'presets', 'friends', 'wallet', 'private']) {
      await assertFails(getDocs(collectionGroup(m, group)));
    }
    await assertFails(getDocs(query(collectionGroup(m, 'bets'), where('status', '==', 'open'))));
    await assertFails(getDocs(query(collectionGroup(m, 'lists'), where('visibility', 'in', ['private', 'friends']))));
    await assertFails(getDoc(doc(m, 'users', 'ann', 'private', 'settings')));
    await assertFails(getDoc(doc(m, 'users', 'ann', 'friends', 'bob')));
    await assertFails(getDoc(doc(m, 'users', 'ann', 'lists', 'l1')));
    await assertFails(getDoc(doc(m, 'users', 'ann', 'bets', 'b1')));
    await assertFails(getDoc(doc(m, 'users', 'ann', 'pins', 'p1')));
    // (a profile can't carry an admin flag or an email: only the listed fields)
    const batch = writeBatch(m);
    batch.set(doc(m, 'usernames', 'mallory'), { uid: 'mallory' });
    batch.set(doc(m, 'users', 'mallory'), { ...profile('mallory'), admin: true });
    await assertFails(batch.commit());
    // (an admin-only document, without the token's claim)
    await assertFails(setDoc(doc(m, 'config', 'site'), { open: true }));
  });

  test('no forged friendship, no accepting for someone else', async () => {
    await seed((f) => setDoc(doc(f, 'users', 'ann'), { ...profile('ann'), createdAt: new Date(), updatedAt: new Date() }));
    const m = as('mallory');
    const both = (mine, theirs) => {
      const batch = writeBatch(m);
      batch.set(doc(m, 'users', 'mallory', 'friends', 'ann'), { status: mine, since: serverTimestamp() });
      batch.set(doc(m, 'users', 'ann', 'friends', 'mallory'), { status: theirs, since: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(both('friends', 'friends'));
    await assertFails(both('pending-in', 'pending-out'));
    await assertSucceeds(both('pending-out', 'pending-in'));
    // (the asker turning both to friends)
    const accept = writeBatch(m);
    accept.update(doc(m, 'users', 'mallory', 'friends', 'ann'), { status: 'friends', since: serverTimestamp() });
    accept.update(doc(m, 'users', 'ann', 'friends', 'mallory'), { status: 'friends', since: serverTimestamp() });
    await assertFails(accept.commit());
  });
});
