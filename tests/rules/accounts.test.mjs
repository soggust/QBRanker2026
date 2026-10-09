// firestore.rules for the accounts' own documents (users/{uid}, usernames/{lower}, users/{uid}/private,
// config): run against the Firestore emulator by `npm run test:rules` (firebase emulators:exec, which needs
// Java), never by the main suite (npm test: tests/*.test.mjs). Without the emulator these skip.
import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const ROOT = path.resolve(import.meta.dirname, '../..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';

let env;
before(async () => {
  if (skip) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-season-ranker',
    firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env?.clearFirestore());

const VIS = { lists: 'public', presets: 'public', openBets: 'friends', betHistory: 'friends', tracker: 'friends' };
const profile = (username, extra = {}) => ({
  username,
  usernameLower: username.toLowerCase(),
  displayName: 'Test User',
  photo: null,
  bio: '',
  visibility: { ...VIS },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

// (a user's sign-up as the app writes it: the claim and the profile in one batch)
function signUp(db, uid, username, extra = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', username.toLowerCase()), { uid });
  batch.set(doc(db, 'users', uid), profile(username, extra));
  return batch.commit();
}

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();

describe('accounts rules', { skip }, () => {
  test('a username is claimed once, with the profile that uses it', async () => {
    await assertSucceeds(signUp(as('alice'), 'alice', 'Ace_1'));
    // (someone else can't take it, in any capitals)
    await assertFails(signUp(as('bob'), 'bob', 'ace_1'));
    await assertFails(signUp(as('bob'), 'bob', 'ACE_1'));
    // (a claim alone, or a profile alone, doesn't go through)
    await assertFails(setDoc(doc(as('bob'), 'usernames', 'bobby'), { uid: 'bob' }));
    await assertFails(setDoc(doc(as('bob'), 'users', 'bob'), profile('bobby')));
    // (nor a claim for another user, or one with more in it)
    const carol = as('carol');
    const batch = writeBatch(carol);
    batch.set(doc(carol, 'usernames', 'carol'), { uid: 'alice' });
    batch.set(doc(carol, 'users', 'carol'), profile('carol'));
    await assertFails(batch.commit());
    await assertSucceeds(signUp(as('bob'), 'bob', 'bobby'));
    // (claims can't be edited)
    await assertFails(updateDoc(doc(as('bob'), 'usernames', 'bobby'), { uid: 'bob' }));
    // (anyone can read profiles and claims, signed in or not)
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'usernames', 'ace_1')));
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'alice')));
  });

  test('nobody writes another user\'s profile', async () => {
    await assertSucceeds(signUp(as('alice'), 'alice', 'alice'));
    const bob = as('bob');
    await assertFails(updateDoc(doc(bob, 'users', 'alice'), { displayName: 'Hacked', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(bob, 'users', 'alice')));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'alice'), profile('alice')));
    await assertSucceeds(updateDoc(doc(as('alice'), 'users', 'alice'), { displayName: 'Alice A', updatedAt: serverTimestamp() }));
  });

  test('the profile\'s fields are checked', async () => {
    await assertSucceeds(signUp(as('alice'), 'alice', 'alice'));
    const alice = as('alice');
    const ref = doc(alice, 'users', 'alice');
    const edit = (change) => updateDoc(ref, { ...change, updatedAt: serverTimestamp() });
    await assertFails(edit({ displayName: '' }));
    await assertFails(edit({ displayName: 'x'.repeat(41) }));
    await assertSucceeds(edit({ displayName: 'x'.repeat(40) }));
    await assertFails(edit({ bio: 'x'.repeat(201) }));
    await assertSucceeds(edit({ bio: 'x'.repeat(200) }));
    await assertFails(edit({ 'visibility.lists': 'everyone' }));
    await assertSucceeds(edit({ 'visibility.lists': 'private' }));
    await assertFails(edit({ 'visibility.extra': 'public' }));
    await assertFails(edit({ photo: { kind: 'upload', url: 'data:image/webp;base64,' + 'A'.repeat(61440) } }));
    await assertSucceeds(edit({ photo: { kind: 'upload', url: 'data:image/webp;base64,' + 'A'.repeat(40000) } }));
    await assertFails(edit({ photo: { kind: 'upload', url: 'javascript:alert(1)' } }));
    await assertFails(edit({ photo: { kind: 'other', url: 'https://example.com/a.png' } }));
    await assertSucceeds(edit({ photo: { kind: 'logo', url: '/nfl/assets/NFL_Icons/Bears.png' } }));
    await assertSucceeds(edit({ photo: { kind: 'provider', url: 'https://lh3.googleusercontent.com/a/x' } }));
    await assertSucceeds(edit({ photo: null }));
    // (a username's case can change; its claim can't be dodged)
    await assertSucceeds(edit({ username: 'Alice' }));
    await assertFails(edit({ username: 'Alicia', usernameLower: 'alicia' }));
    await assertFails(edit({ username: 'al', usernameLower: 'al' }));
    await assertFails(edit({ username: 'Alice', usernameLower: 'ALICE' }));
    // (updatedAt is the server's time; createdAt never changes)
    await assertFails(updateDoc(ref, { displayName: 'A', updatedAt: new Date(0) }));
    await assertFails(edit({ createdAt: new Date(0) }));
    // (and on a new profile, the same checks)
    await assertFails(signUp(as('bob'), 'bob', 'bad name'));
    await assertFails(signUp(as('bob'), 'bob', 'bob', { displayName: 'x'.repeat(41) }));
  });

  test('a non-admin can\'t write any admin-ish field; an admin claim is the token\'s', async () => {
    await assertFails(signUp(as('alice'), 'alice', 'alice', { admin: true }));
    await assertSucceeds(signUp(as('alice'), 'alice', 'alice'));
    const alice = as('alice');
    const ref = doc(alice, 'users', 'alice');
    for (const field of ['admin', 'role', 'isAdmin', 'claims']) {
      await assertFails(updateDoc(ref, { [field]: true, updatedAt: serverTimestamp() }));
    }
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'private', 'settings'), { admin: true }));
    // (config: anyone reads it, only a token with admin: true writes it)
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'config', 'site')));
    await assertFails(setDoc(doc(alice, 'config', 'site'), { mma: true }));
    await assertFails(setDoc(doc(as('carl', { admin: 'true' }), 'config', 'site'), { mma: true }));
    await assertSucceeds(setDoc(doc(as('root', { admin: true }), 'config', 'site'), { mma: true }));
  });

  test('a rename claims the new name and lets go of the old, together', async () => {
    await assertSucceeds(signUp(as('alice'), 'alice', 'alice'));
    await assertSucceeds(signUp(as('bob'), 'bob', 'bobby'));
    const alice = as('alice');
    const rename = (to, { release = true } = {}) => {
      const batch = writeBatch(alice);
      batch.set(doc(alice, 'usernames', to.toLowerCase()), { uid: 'alice' });
      batch.update(doc(alice, 'users', 'alice'), { username: to, usernameLower: to.toLowerCase(), updatedAt: serverTimestamp() });
      if (release) batch.delete(doc(alice, 'usernames', 'alice'));
      return batch.commit();
    };
    await assertFails(rename('bobby'));
    // (keeping the old name too isn't allowed)
    await assertFails(rename('ally', { release: false }));
    await assertSucceeds(rename('ally'));
    // (the claim can't be let go while the profile uses it, or by anyone else)
    await assertFails(deleteDoc(doc(alice, 'usernames', 'ally')));
    await assertFails(deleteDoc(doc(as('bob'), 'usernames', 'ally')));
    // (the freed name is anyone's)
    await assertSucceeds(signUp(as('carol'), 'carol', 'alice'));
  });

  test('usernames are deleted only by their owner, with the account', async () => {
    await assertSucceeds(signUp(as('alice'), 'alice', 'alice'));
    await assertFails(deleteDoc(doc(as('bob'), 'usernames', 'alice')));
    await assertFails(deleteDoc(doc(env.unauthenticatedContext().firestore(), 'usernames', 'alice')));
    const alice = as('alice');
    const batch = writeBatch(alice);
    batch.delete(doc(alice, 'usernames', 'alice'));
    batch.delete(doc(alice, 'users', 'alice'));
    await assertSucceeds(batch.commit());
  });

  test('private settings are the owner\'s alone', async () => {
    await assertSucceeds(signUp(as('alice'), 'alice', 'alice'));
    const mine = doc(as('alice'), 'users', 'alice', 'private', 'settings');
    await assertSucceeds(setDoc(mine, { email: 'alice@example.com' }));
    await assertSucceeds(getDoc(mine));
    await assertFails(setDoc(mine, { email: 'x'.repeat(321) }));
    await assertFails(setDoc(mine, { email: 'a@b.c', other: 1 }));
    await assertFails(getDoc(doc(as('bob'), 'users', 'alice', 'private', 'settings')));
    await assertFails(setDoc(doc(as('bob'), 'users', 'alice', 'private', 'settings'), { email: 'bob@example.com' }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'alice', 'private', 'settings')));
    await assertFails(deleteDoc(doc(as('bob'), 'users', 'alice', 'private', 'settings')));
    await assertSucceeds(deleteDoc(mine));
  });
});
