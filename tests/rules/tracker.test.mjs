// firestore.rules for the Tracker's pins (users/{uid}/pins/{id}): only the owner pins, renames, reorders,
// re-pins and unpins; the link and sport stay as pinned; the fields and their limits; and who may read them
// (the owner's tracker setting: public, friends, only them). Run against the Firestore emulator by
// `npm run test:rules`; without the emulator these skip.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const ROOT = path.resolve(import.meta.dirname, '../..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';

let env;
before(async () => {
  if (skip) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-season-ranker-tracker',
    firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env?.clearFirestore());

const as = (uid) => env.authenticatedContext(uid).firestore();
const pinRef = (db, uid, id = 'p1') => doc(db, 'users', uid, 'pins', id);

const SNAP = {
  at: 1760000000000,
  skills: [{ id: 'QB|accuracy', name: 'Accuracy', tab: null }],
  rows: [{ key: 'passYards|Pass Yds', label: 'Pass Yds', name: 'Passing yards', group: 'Box Score', lower: false }],
  sides: [
    { key: 'QB/2026/1', position: 'QB', season: 2026, id: '1', name: 'A', tab: 'QB', rank: 3, of: 40, pct: 0.95, score: 1.2, skills: [0.9], stats: [{ v: 1200, p: 0.9, t: '1,200' }] },
    { key: 'QB/2026/2', position: 'QB', season: 2026, id: '2', name: 'B', tab: 'QB', rank: 9, of: 40, pct: 0.8, score: 0.4, skills: [0.7], stats: [{ v: 900, p: 0.6, t: '900' }] },
  ],
};
const pin = (extra = {}) => ({
  title: 'A vs B',
  spec: 'list=eyJ2IjoxfQ&cmp=QB.2026.1_QB.2026.2',
  sport: 'nfl',
  order: 0,
  baseline: SNAP,
  history: [],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

// (profiles straight in, rules off: each one's tracker setting; friends as the friends rules leave them)
async function seed({ users = {}, friends = [], pins = [] }) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, tracker] of Object.entries(users)) {
      await setDoc(doc(db, 'users', uid), {
        username: uid,
        usernameLower: uid,
        displayName: uid,
        visibility: { lists: 'public', presets: 'public', openBets: 'friends', betHistory: 'friends', tracker },
      });
    }
    for (const [a, b] of friends) {
      await setDoc(doc(db, 'users', a, 'friends', b), { status: 'friends', since: 1 });
      await setDoc(doc(db, 'users', b, 'friends', a), { status: 'friends', since: 1 });
    }
    for (const [uid, id] of pins) await setDoc(pinRef(db, uid, id), { ...pin(), createdAt: 1, updatedAt: 1 });
  });
}

describe('tracker rules', { skip }, () => {
  test('the owner pins; nobody else, signed out or in', async () => {
    await seed({ users: { alice: 'public', bob: 'public' } });
    await assertSucceeds(setDoc(pinRef(as('alice'), 'alice'), pin()));
    await assertFails(setDoc(pinRef(as('bob'), 'alice', 'p2'), pin()));
    await assertFails(setDoc(pinRef(env.unauthenticatedContext().firestore(), 'alice', 'p3'), pin()));
  });

  test('a pin is what the Tracker writes: its fields, their sizes, its times', async () => {
    await seed({ users: { alice: 'public' } });
    const alice = as('alice');
    const bad = [
      { title: '' },
      { title: 'x'.repeat(81) },
      { spec: 'cmp=' },
      { spec: 'pos=QB&cmp=QB.2026.1' },
      { spec: 'list=abc&cmp=QB.2026.1&evil=1' },
      { spec: 'list=a&cmp=' + 'x'.repeat(4000) },
      { sport: 'NFL!' },
      { order: '1' },
      { baseline: 'x' },
      { baseline: { ...SNAP, sides: [] } },
      { baseline: { ...SNAP, sides: [...SNAP.sides, ...SNAP.sides, SNAP.sides[0]] } },
      { baseline: { sides: SNAP.sides } },
      { history: Array.from({ length: 201 }, (_, i) => ({ d: String(i), sides: [] })) },
      { createdAt: 5 },
      { updatedAt: 5 },
      { admin: true },
    ];
    for (const [i, change] of bad.entries()) await assertFails(setDoc(pinRef(alice, 'alice', `bad${i}`), pin(change)));
    // (no list: a comparison with the default sliders)
    await assertSucceeds(setDoc(pinRef(alice, 'alice', 'plain'), pin({ spec: 'cmp=stats_QB.2026.1_RB.2013.00-0011869' })));
  });

  test('the owner renames, reorders, re-pins and records; the link, sport and pin date stay', async () => {
    await seed({ users: { alice: 'public', bob: 'public' }, pins: [['alice', 'p1']] });
    const alice = as('alice');
    const ref = pinRef(alice, 'alice');
    await assertSucceeds(updateDoc(ref, { title: 'Rivals', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { order: -3, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { baseline: { ...SNAP, at: 1770000000000 }, history: [], updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { history: [{ d: '2026-10-09', sides: [{ k: 'QB/2026/1', r: 2, o: 40, p: 0.97, s: 1.4 }] }], updatedAt: serverTimestamp() }));
    // (not without its time, nor the fixed fields)
    await assertFails(updateDoc(ref, { title: 'No time' }));
    await assertFails(updateDoc(ref, { spec: 'cmp=QB.2026.9', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { sport: 'nba', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    // (bob can't touch it)
    await assertFails(updateDoc(pinRef(as('bob'), 'alice'), { title: 'Mine', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(pinRef(as('bob'), 'alice')));
    await assertSucceeds(deleteDoc(ref));
  });

  test('who reads a tracker: the owner always; anyone when public; friends when friends; nobody else when private', async () => {
    await seed({
      users: { pub: 'public', fr: 'friends', priv: 'private', pal: 'public', stranger: 'public' },
      friends: [
        ['fr', 'pal'],
        ['priv', 'pal'],
      ],
      pins: [
        ['pub', 'p1'],
        ['fr', 'p1'],
        ['priv', 'p1'],
      ],
    });
    const list = (db, uid) => getDocs(query(collection(db, 'users', uid, 'pins'), orderBy('order')));
    const anon = env.unauthenticatedContext().firestore();
    // public
    await assertSucceeds(list(anon, 'pub'));
    await assertSucceeds(getDoc(pinRef(as('stranger'), 'pub')));
    // friends
    await assertSucceeds(list(as('fr'), 'fr'));
    await assertSucceeds(list(as('pal'), 'fr'));
    await assertFails(list(as('stranger'), 'fr'));
    await assertFails(list(anon, 'fr'));
    // private: only the owner, a friend or not
    await assertSucceeds(list(as('priv'), 'priv'));
    await assertFails(list(as('pal'), 'priv'));
    await assertFails(getDoc(pinRef(as('stranger'), 'priv')));
  });

  test('a deleted account takes its pins: the owner deletes every one', async () => {
    await seed({ users: { alice: 'private' }, pins: [['alice', 'p1'], ['alice', 'p2']] });
    const alice = as('alice');
    const pins = await getDocs(collection(alice, 'users', 'alice', 'pins'));
    for (const d of pins.docs) await assertSucceeds(deleteDoc(d.ref));
    assert.equal((await getDocs(collection(alice, 'users', 'alice', 'pins'))).size, 0);
  });
});
