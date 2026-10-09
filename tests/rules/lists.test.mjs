// firestore.rules for presets (users/{uid}/presets), saved lists (users/{uid}/lists) and the Community
// (community/{key}/entries/{uid} and their votes): run against the Firestore emulator by `npm run test:rules`;
// without the emulator these skip (the main suite never runs them).
import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const ROOT = path.resolve(import.meta.dirname, '../..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';

let env;
before(async () => {
  if (skip) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-season-ranker-lists',
    firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env?.clearFirestore());

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

// (profiles and friendships put in place without the rules)
async function seed(fn) {
  await env.withSecurityRulesDisabled(async (context) => fn(context.firestore()));
}
const VIS = { lists: 'public', presets: 'public', openBets: 'friends', betHistory: 'friends', tracker: 'friends' };
const profile = (username, visibility = {}) => ({
  username,
  usernameLower: username.toLowerCase(),
  displayName: username,
  photo: null,
  bio: '',
  visibility: { ...VIS, ...visibility },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const preset = (extra = {}) => ({
  sport: 'nfl',
  tab: 'QB',
  name: 'Efficiency first',
  settings: { weights: { epaPerPlay: 90, passYards: 20 }, hidden: ['ints'], groups: ['support'] },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

const row = (name, rank) => ({ name, teamLogo: 'assets/NFL_Icons/KC.png', photo: null, rank, values: { passYards: 4000 - rank }, texts: { passYards: '4,000' } });
const list = (extra = {}) => ({
  sport: 'nfl',
  tab: 'QB',
  season: 2026,
  part: 'regular',
  basis: 'season',
  title: 'My QBs',
  note: '',
  ids: ['a', 'b', 'c'],
  snapshot: { a: row('A', 1), b: row('B', 2), c: row('C', 3) },
  columns: ['passYards'],
  labels: ['Pass Yds'],
  formats: [''],
  lower: [],
  visibility: 'public',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

const KEY = 'nfl_QB_2026';
const entry = (extra = {}) => ({
  listId: 'l1',
  title: 'My QBs',
  ownerName: 'Alice',
  ids: ['a', 'b', 'c'],
  names: ['A', 'B', 'C'],
  logos: [null, null, null],
  submittedAt: serverTimestamp(),
  ...extra,
});

describe('presets rules', { skip }, () => {
  test('the owner makes, edits and deletes their presets; the fields are checked', async () => {
    await seed((db) => setDoc(doc(db, 'users', 'alice'), profile('alice')));
    const alice = as('alice');
    const ref = doc(alice, 'users', 'alice', 'presets', 'p1');
    await assertSucceeds(setDoc(ref, preset()));
    await assertSucceeds(updateDoc(ref, { name: 'Renamed', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { settings: { weights: {}, hidden: [], groups: [] }, updatedAt: serverTimestamp() }));
    // (the name 1 to 40, the payload's three parts only, the server's times)
    await assertFails(updateDoc(ref, { name: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { name: 'x'.repeat(41), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { settings: { weights: {}, hidden: [], groups: [], extra: 1 }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { name: 'Late', updatedAt: new Date(0) }));
    await assertFails(updateDoc(ref, { createdAt: new Date(0), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'presets', 'p2'), preset({ admin: true })));
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'presets', 'p3'), preset({ sport: 'NFL!' })));
    // (nobody else writes them)
    await assertFails(setDoc(doc(as('bob'), 'users', 'alice', 'presets', 'p4'), preset()));
    await assertFails(updateDoc(doc(as('bob'), 'users', 'alice', 'presets', 'p1'), { name: 'Bob was here', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(as('bob'), 'users', 'alice', 'presets', 'p1')));
    await assertSucceeds(deleteDoc(ref));
  });

  test('others read them as the owner\'s presets setting allows', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', 'alice'), profile('alice', { presets: 'friends' }));
      await setDoc(doc(db, 'users', 'bob'), profile('bob'));
      await setDoc(doc(db, 'users', 'carol'), profile('carol'));
      await setDoc(doc(db, 'users', 'alice', 'presets', 'p1'), { ...preset(), createdAt: new Date(), updatedAt: new Date() });
      await setDoc(doc(db, 'users', 'alice', 'friends', 'bob'), { status: 'friends', since: new Date() });
      await setDoc(doc(db, 'users', 'bob', 'friends', 'alice'), { status: 'friends', since: new Date() });
    });
    await assertSucceeds(getDoc(doc(as('alice'), 'users', 'alice', 'presets', 'p1')));
    await assertSucceeds(getDoc(doc(as('bob'), 'users', 'alice', 'presets', 'p1')));
    await assertFails(getDoc(doc(as('carol'), 'users', 'alice', 'presets', 'p1')));
    await assertFails(getDoc(doc(anon(), 'users', 'alice', 'presets', 'p1')));
    await seed((db) => updateDoc(doc(db, 'users', 'alice'), { 'visibility.presets': 'public' }));
    await assertSucceeds(getDocs(collection(anon(), 'users', 'alice', 'presets')));
    await seed((db) => updateDoc(doc(db, 'users', 'alice'), { 'visibility.presets': 'private' }));
    await assertFails(getDoc(doc(as('bob'), 'users', 'alice', 'presets', 'p1')));
    // (the owner's own query, by sport)
    await assertSucceeds(getDocs(query(collection(as('alice'), 'users', 'alice', 'presets'), where('sport', '==', 'nfl'))));
  });
});

describe('saved lists rules', { skip }, () => {
  test('the owner saves, edits and deletes lists; the fields and sizes are checked', async () => {
    const alice = as('alice');
    const ref = doc(alice, 'users', 'alice', 'lists', 'l1');
    await assertSucceeds(setDoc(ref, list()));
    await assertSucceeds(updateDoc(ref, { title: 'Renamed', note: 'Why: arm talent', visibility: 'private', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { ids: ['c', 'b', 'a'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { title: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { title: 'x'.repeat(81), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { note: 'x'.repeat(501), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { visibility: 'everyone', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { part: 'preseason', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { owner: 'bob', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { createdAt: new Date(0), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { title: 'Stale', updatedAt: new Date(0) }));
    // (at most 50 players, 60 columns)
    const many = Array.from({ length: 51 }, (_, i) => `p${i}`);
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'lists', 'l2'), list({ ids: many })));
    await assertSucceeds(setDoc(doc(alice, 'users', 'alice', 'lists', 'l3'), list({ ids: many.slice(0, 50) })));
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'lists', 'l4'), list({ columns: Array.from({ length: 61 }, (_, i) => `s${i}`) })));
    // (the community mark: the owner's, a board key)
    await assertSucceeds(updateDoc(ref, { community: { submitted: true, key: KEY }, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { community: null, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { community: { submitted: true, key: KEY, votes: 99 }, updatedAt: serverTimestamp() }));
    // (nobody else writes it)
    await assertFails(setDoc(doc(as('bob'), 'users', 'alice', 'lists', 'l9'), list()));
    await assertFails(updateDoc(doc(as('bob'), 'users', 'alice', 'lists', 'l1'), { title: 'Mine now', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(as('bob'), 'users', 'alice', 'lists', 'l1')));
    await assertSucceeds(deleteDoc(ref));
  });

  test('a list is read as its own visibility allows: public anyone, friends a friend, private the owner', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', 'alice'), profile('alice'));
      for (const [id, visibility] of [['pub', 'public'], ['fr', 'friends'], ['me', 'private']]) {
        await setDoc(doc(db, 'users', 'alice', 'lists', id), { ...list({ visibility }), createdAt: new Date(), updatedAt: new Date() });
      }
      await setDoc(doc(db, 'users', 'alice', 'friends', 'bob'), { status: 'friends', since: new Date() });
      await setDoc(doc(db, 'users', 'bob', 'friends', 'alice'), { status: 'friends', since: new Date() });
      // (carol only asked: not friends yet)
      await setDoc(doc(db, 'users', 'alice', 'friends', 'carol'), { status: 'pending-in', since: new Date() });
      await setDoc(doc(db, 'users', 'carol', 'friends', 'alice'), { status: 'pending-out', since: new Date() });
    });
    const read = (db, id) => getDoc(doc(db, 'users', 'alice', 'lists', id));
    for (const id of ['pub', 'fr', 'me']) await assertSucceeds(read(as('alice'), id));
    await assertSucceeds(read(anon(), 'pub'));
    await assertFails(read(anon(), 'fr'));
    await assertSucceeds(read(as('bob'), 'fr'));
    await assertFails(read(as('carol'), 'fr'));
    await assertFails(read(as('bob'), 'me'));
    // (others list them by asking for the public ones; asking for all of them is turned away)
    await assertSucceeds(getDocs(query(collection(anon(), 'users', 'alice', 'lists'), where('visibility', '==', 'public'))));
    await assertFails(getDocs(collection(as('carol'), 'users', 'alice', 'lists')));
    await assertSucceeds(getDocs(collection(as('alice'), 'users', 'alice', 'lists')));
  });
});

describe('community rules', { skip }, () => {
  // (alice's list l1, on the board)
  async function submitted() {
    await seed((db) => setDoc(doc(db, 'users', 'alice', 'lists', 'l1'), { ...list(), createdAt: new Date(), updatedAt: new Date() }));
    const alice = as('alice');
    const batch = writeBatch(alice);
    batch.set(doc(alice, 'community', KEY, 'entries', 'alice'), entry());
    batch.update(doc(alice, 'users', 'alice', 'lists', 'l1'), { community: { submitted: true, key: KEY }, updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  }

  test('an entry is its owner\'s alone, one of their own lists, on a real board; anyone reads it', async () => {
    await submitted();
    const alice = as('alice');
    // (submitting again replaces it)
    await assertSucceeds(setDoc(doc(alice, 'community', KEY, 'entries', 'alice'), entry({ title: 'Take two' })));
    // (not someone else's, not a list they don't have, not a made-up board)
    await assertFails(setDoc(doc(as('bob'), 'community', KEY, 'entries', 'alice'), entry()));
    await assertFails(setDoc(doc(as('bob'), 'community', KEY, 'entries', 'bob'), entry({ listId: 'nope' })));
    await assertFails(setDoc(doc(alice, 'community', 'not a key', 'entries', 'alice'), entry()));
    // (the fields: an order of 1 to 50, names and logos alongside it, the server's time)
    await assertFails(setDoc(doc(alice, 'community', KEY, 'entries', 'alice'), entry({ ids: [] , names: [], logos: [] })));
    await assertFails(setDoc(doc(alice, 'community', KEY, 'entries', 'alice'), entry({ names: ['A'] })));
    await assertFails(setDoc(doc(alice, 'community', KEY, 'entries', 'alice'), entry({ votes: 1000 })));
    await assertFails(setDoc(doc(alice, 'community', KEY, 'entries', 'alice'), entry({ submittedAt: new Date(0) })));
    // (anyone reads the board; only an admin writes its tally)
    await assertSucceeds(getDocs(collection(anon(), 'community', KEY, 'entries')));
    await assertSucceeds(getDoc(doc(anon(), 'community', KEY)));
    await assertFails(setDoc(doc(alice, 'community', KEY), { consensus: ['a'] }));
    await assertSucceeds(setDoc(doc(env.authenticatedContext('root', { admin: true }).firestore(), 'community', KEY), { consensus: ['a'] }));
    // (taken down by its owner only)
    await assertFails(deleteDoc(doc(as('bob'), 'community', KEY, 'entries', 'alice')));
    await assertSucceeds(deleteDoc(doc(alice, 'community', KEY, 'entries', 'alice')));
  });

  test('votes: one per person per entry, +1 or -1, never on your own; the voter or the entry\'s owner removes it', async () => {
    await submitted();
    const vote = (uid, value, extra = {}) => setDoc(doc(as(uid), 'community', KEY, 'entries', 'alice', 'votes', uid), { value, voter: uid, ...extra });
    await assertSucceeds(vote('bob', 1));
    await assertSucceeds(vote('bob', -1));
    await assertFails(vote('bob', 2));
    await assertFails(vote('bob', 0));
    await assertFails(vote('bob', '1'));
    await assertFails(vote('bob', 1, { weight: 10 }));
    // (on their own doc only, as themselves)
    await assertFails(setDoc(doc(as('bob'), 'community', KEY, 'entries', 'alice', 'votes', 'carol'), { value: 1, voter: 'carol' }));
    await assertFails(setDoc(doc(as('bob'), 'community', KEY, 'entries', 'alice', 'votes', 'bob'), { value: 1, voter: 'carol' }));
    // (not on your own entry, not on an entry that isn't there, not signed out)
    await assertFails(vote('alice', 1));
    await assertFails(setDoc(doc(as('bob'), 'community', KEY, 'entries', 'nobody', 'votes', 'bob'), { value: 1, voter: 'bob' }));
    await assertFails(setDoc(doc(anon(), 'community', KEY, 'entries', 'alice', 'votes', 'x'), { value: 1, voter: 'x' }));
    await assertSucceeds(vote('carol', 1));
    // (anyone counts them; a voter finds their own anywhere)
    await assertSucceeds(getDocs(collection(anon(), 'community', KEY, 'entries', 'alice', 'votes')));
    await assertSucceeds(getDocs(query(collectionGroup(as('bob'), 'votes'), where('voter', '==', 'bob'))));
    await assertFails(getDocs(query(collectionGroup(as('bob'), 'votes'), where('voter', '==', 'carol'))));
    // (taken back by the voter, cleared by the entry's owner, not by anyone else)
    await assertFails(deleteDoc(doc(as('dave'), 'community', KEY, 'entries', 'alice', 'votes', 'bob')));
    await assertSucceeds(deleteDoc(doc(as('bob'), 'community', KEY, 'entries', 'alice', 'votes', 'bob')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'community', KEY, 'entries', 'alice', 'votes', 'carol')));
  });
});
