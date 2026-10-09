// firestore.rules for friends (users/{uid}/friends/{other}: the request, accept, decline/cancel/unfriend
// state machine, both halves written together) and the visibility helpers every owner's data uses
// (canSee, isFriend: probed through a test-only match added to the rules here). Run against the Firestore
// emulator by `npm run test:rules`; without the emulator these skip.
import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const ROOT = path.resolve(import.meta.dirname, '../..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';

// (a probe for canSee: probes/{owner}/{kind}/{x} readable when canSee(owner, kind), added just inside the
// rules' outermost match, so the helper is tested on its own, whatever uses it)
function rulesWithProbe() {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const probe = `
    match /probes/{owner}/{kind}/{x} {
      allow read: if canSee(owner, kind);
    }
    match /friendProbes/{owner} {
      allow read: if isFriend(owner);
    }
`;
  const at = rules.indexOf('match /databases/{database}/documents {');
  if (at < 0) throw new Error('rules: no documents match');
  const end = rules.indexOf('\n', at) + 1;
  return rules.slice(0, end) + probe + rules.slice(end);
}

let env;
before(async () => {
  if (skip) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-season-ranker-friends',
    firestore: { host: hostname, port: Number(port), rules: rulesWithProbe() },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env?.clearFirestore());

const KINDS = ['lists', 'presets', 'openBets', 'betHistory', 'tracker'];
const as = (uid) => env.authenticatedContext(uid).firestore();
const friend = (db, uid, other) => doc(db, 'users', uid, 'friends', other);

// (profiles straight in, rules off: each user's visibility, every kind set to one value unless given)
async function seedUsers(users) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, vis] of Object.entries(users)) {
      const visibility = typeof vis === 'string' ? Object.fromEntries(KINDS.map((k) => [k, vis])) : vis;
      await setDoc(doc(db, 'users', uid), { username: uid, usernameLower: uid, displayName: uid, visibility });
      for (const kind of KINDS) await setDoc(doc(db, 'probes', uid, kind, 'x'), { ok: true });
      await setDoc(doc(db, 'friendProbes', uid), { ok: true });
    }
  });
}

// (the app's writes)
function request(db, me, them) {
  const batch = writeBatch(db);
  batch.set(friend(db, me, them), { status: 'pending-out', since: serverTimestamp() });
  batch.set(friend(db, them, me), { status: 'pending-in', since: serverTimestamp() });
  return batch.commit();
}
function accept(db, me, them) {
  const batch = writeBatch(db);
  batch.update(friend(db, me, them), { status: 'friends', since: serverTimestamp() });
  batch.update(friend(db, them, me), { status: 'friends', since: serverTimestamp() });
  return batch.commit();
}
function remove(db, me, them) {
  const batch = writeBatch(db);
  batch.delete(friend(db, me, them));
  batch.delete(friend(db, them, me));
  return batch.commit();
}
async function befriend(a, b) {
  await request(as(a), a, b);
  await accept(as(b), b, a);
}

describe('friends rules', { skip }, () => {
  test('a request writes both halves together, and nothing else', async () => {
    await seedUsers({ alice: 'friends', bob: 'friends', carol: 'friends' });
    const alice = as('alice');
    // (one half alone doesn't go through, either half)
    await assertFails(setDoc(friend(alice, 'alice', 'bob'), { status: 'pending-out', since: serverTimestamp() }));
    await assertFails(setDoc(friend(alice, 'bob', 'alice'), { status: 'pending-in', since: serverTimestamp() }));
    // (nor a request straight to friends, the halves swapped, extra fields, a made-up time, or myself)
    const bad = async (mine, theirs) => {
      const batch = writeBatch(alice);
      batch.set(friend(alice, 'alice', 'bob'), mine);
      batch.set(friend(alice, 'bob', 'alice'), theirs);
      await assertFails(batch.commit());
    };
    const t = serverTimestamp();
    await bad({ status: 'friends', since: t }, { status: 'friends', since: t });
    await bad({ status: 'pending-in', since: t }, { status: 'pending-out', since: t });
    await bad({ status: 'pending-out', since: t, note: 'hi' }, { status: 'pending-in', since: t });
    await bad({ status: 'pending-out', since: new Date(0) }, { status: 'pending-in', since: t });
    await assertFails(request(alice, 'alice', 'alice'));
    // (someone who doesn't exist)
    await assertFails(request(alice, 'alice', 'nobody'));
    // (on someone else's behalf: carol can't make alice ask bob)
    await assertFails(request(as('carol'), 'alice', 'bob'));
    await assertSucceeds(request(alice, 'alice', 'bob'));
    // (again, while it's pending: not a create any more, and not an accept of one's own request)
    await assertFails(request(alice, 'alice', 'bob'));
    await assertFails(accept(alice, 'alice', 'bob'));
    // (bob asking back, while alice's request waits: no, he accepts it)
    await assertFails(request(as('bob'), 'bob', 'alice'));
  });

  test('accepting turns both to friends; only the one asked can', async () => {
    await seedUsers({ alice: 'friends', bob: 'friends', carol: 'friends' });
    await request(as('alice'), 'alice', 'bob');
    // (a stranger, or one half alone, or something other than friends)
    await assertFails(accept(as('carol'), 'bob', 'alice'));
    await assertFails(updateDoc(friend(as('bob'), 'bob', 'alice'), { status: 'friends', since: serverTimestamp() }));
    const bob = as('bob');
    const batch = writeBatch(bob);
    batch.update(friend(bob, 'bob', 'alice'), { status: 'pending-out', since: serverTimestamp() });
    batch.update(friend(bob, 'alice', 'bob'), { status: 'pending-in', since: serverTimestamp() });
    await assertFails(batch.commit());
    await assertSucceeds(accept(bob, 'bob', 'alice'));
    // (each side reads the pair; nobody else does)
    await assertSucceeds(getDoc(friend(as('alice'), 'alice', 'bob')));
    await assertSucceeds(getDoc(friend(as('alice'), 'bob', 'alice')));
    await assertSucceeds(getDocs(collection(as('bob'), 'users', 'bob', 'friends')));
    await assertFails(getDoc(friend(as('carol'), 'alice', 'bob')));
    await assertFails(getDocs(collection(as('carol'), 'users', 'alice', 'friends')));
    await assertFails(getDoc(friend(env.unauthenticatedContext().firestore(), 'alice', 'bob')));
    // (friends can't be edited into anything else)
    await assertFails(updateDoc(friend(bob, 'bob', 'alice'), { status: 'pending-in', since: serverTimestamp() }));
  });

  test('declining, cancelling and unfriending delete both halves, by either side', async () => {
    await seedUsers({ alice: 'friends', bob: 'friends', carol: 'friends' });
    // (a decline by the one asked)
    await request(as('alice'), 'alice', 'bob');
    await assertFails(deleteDoc(friend(as('bob'), 'bob', 'alice')));
    await assertFails(remove(as('carol'), 'bob', 'alice'));
    await assertSucceeds(remove(as('bob'), 'bob', 'alice'));
    // (a cancel by the asker)
    await request(as('alice'), 'alice', 'bob');
    await assertSucceeds(remove(as('alice'), 'alice', 'bob'));
    // (an unfriend)
    await befriend('alice', 'bob');
    await assertFails(remove(as('carol'), 'alice', 'bob'));
    await assertSucceeds(remove(as('bob'), 'bob', 'alice'));
    // (asked again after: fine)
    await assertSucceeds(request(as('bob'), 'bob', 'alice'));
  });

  test('a half left alone (the other side gone) can still be cleared', async () => {
    await seedUsers({ alice: 'friends', bob: 'friends' });
    await befriend('alice', 'bob');
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(friend(ctx.firestore(), 'bob', 'alice')));
    await assertSucceeds(deleteDoc(friend(as('alice'), 'alice', 'bob')));
  });

  test('isFriend: both halves say friends', async () => {
    await seedUsers({ alice: 'friends', bob: 'friends', carol: 'friends' });
    const probe = (reader, owner) => getDoc(doc(as(reader), 'friendProbes', owner));
    await assertFails(probe('bob', 'alice'));
    await request(as('alice'), 'alice', 'bob');
    await assertFails(probe('bob', 'alice'));
    await assertFails(probe('alice', 'bob'));
    await accept(as('bob'), 'bob', 'alice');
    await assertSucceeds(probe('bob', 'alice'));
    await assertSucceeds(probe('alice', 'bob'));
    await assertFails(probe('carol', 'alice'));
    // (one half forged or left behind isn't enough)
    await env.withSecurityRulesDisabled((ctx) => setDoc(friend(ctx.firestore(), 'carol', 'alice'), { status: 'friends' }));
    await assertFails(probe('carol', 'alice'));
  });

  // canSee for every kind: public / friends / private, read by a stranger, a friend, the owner, and no one
  for (const kind of KINDS) {
    test(`canSee('${kind}'): public, friends, private x stranger, friend, owner`, async () => {
      const others = Object.fromEntries(KINDS.map((k) => [k, k === kind ? 'private' : 'public']));
      await seedUsers({ pub: 'public', fri: 'friends', pri: 'private', mixed: others, viewer: 'private', stranger: 'private' });
      for (const owner of ['pub', 'fri', 'pri', 'mixed']) await befriend(owner, 'viewer');
      const read = (reader, owner) => getDoc(doc(reader ? as(reader) : env.unauthenticatedContext().firestore(), 'probes', owner, kind, 'x'));
      // (public: everyone, signed out too)
      await assertSucceeds(read('stranger', 'pub'));
      await assertSucceeds(read('viewer', 'pub'));
      await assertSucceeds(read('pub', 'pub'));
      await assertSucceeds(read(null, 'pub'));
      // (friends: friends and the owner)
      await assertFails(read('stranger', 'fri'));
      await assertSucceeds(read('viewer', 'fri'));
      await assertSucceeds(read('fri', 'fri'));
      await assertFails(read(null, 'fri'));
      // (private: the owner alone, even to a friend)
      await assertFails(read('stranger', 'pri'));
      await assertFails(read('viewer', 'pri'));
      await assertSucceeds(read('pri', 'pri'));
      // (one kind's setting doesn't open another's)
      await assertFails(read('viewer', 'mixed'));
      await assertSucceeds(read('mixed', 'mixed'));
      // (a pending request isn't friends yet)
      await request(as('stranger'), 'stranger', 'fri');
      await assertFails(read('stranger', 'fri'));
    });
  }

  test('canSee: the owner reads their own without a profile; others never do', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'probes', 'ghost', 'lists', 'x'), { ok: true }));
    await assertSucceeds(getDoc(doc(as('ghost'), 'probes', 'ghost', 'lists', 'x')));
    await assertFails(getDoc(doc(as('someone'), 'probes', 'ghost', 'lists', 'x')));
  });
});
