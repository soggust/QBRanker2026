// firestore.rules for the play-money wallet (users/{uid}/wallet/main, users/{uid}/bets, tallies, leaderboards,
// lines): run against the Firestore emulator by `npm run test:rules`; without it these skip. Its own project id,
// so its clearing between tests never touches another file's (node runs the files side by side).
import { after, before, beforeEach, describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, deleteDoc, doc, getDoc, getDocs, collection, increment, serverTimestamp, setDoc, updateDoc, where, query, writeBatch } from 'firebase/firestore';

const ROOT = path.resolve(import.meta.dirname, '../..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';

let env;
before(async () => {
  if (skip) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-season-ranker-wallet',
    firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env?.clearFirestore());

const as = (uid) => env.authenticatedContext(uid).firestore();
const VIS = { lists: 'public', presets: 'public', openBets: 'friends', betHistory: 'friends', tracker: 'friends' };

// (a profile, with its visibility, written past the rules)
async function seedProfile(uid, visibility = {}) {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'users', uid), { username: uid, usernameLower: uid, displayName: uid, visibility: { ...VIS, ...visibility }, createdAt: Timestamp.now(), updatedAt: Timestamp.now() }),
  );
}

const newWallet = () => ({ balance: 1000, start: 1000, resets: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const later = (hours = 24) => Timestamp.fromMillis(Date.now() + hours * 36e5);
const playBet = (over = {}) => ({
  sport: 'nfl',
  event: '401872986',
  matchup: 'LV @ NE',
  start: later(),
  market: 'spread',
  side: 'home',
  line: -3.5,
  odds: -110,
  stake: 25,
  pick: 'NE -3.5',
  botPick: true,
  tier: 'love',
  kelly: 5.2,
  ref: '401872986:spread',
  run: 0,
  placedAt: serverTimestamp(),
  status: 'open',
  ...over,
});

// (a bet as the app places it: the bet and the stake out of the wallet, one batch)
function place(db, uid, id, bet = playBet(), take = bet.stake) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'bets', id), bet);
  batch.update(doc(db, 'users', uid, 'wallet', 'main'), { balance: increment(-take), lastBet: id, updatedAt: serverTimestamp() });
  return batch.commit();
}

describe('wallet rules', { skip }, () => {
  test('a wallet is made once, by its owner, at 1,000', async () => {
    const db = as('ann');
    await assertFails(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), { ...newWallet(), balance: 5000 }));
    await assertFails(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), { ...newWallet(), resets: 3 }));
    await assertFails(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), { ...newWallet(), lastBet: 'x' }));
    await assertFails(setDoc(doc(db, 'users', 'ann', 'wallet', 'other'), newWallet()));
    await assertFails(setDoc(doc(as('bob'), 'users', 'ann', 'wallet', 'main'), newWallet()));
    await assertSucceeds(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), newWallet()));
    // (made again over itself: that's an update, and not a bet's or a reload's)
    await assertFails(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), newWallet()));
  });

  test('a bet goes on only with its stake out of the wallet, in the same write', async () => {
    const db = as('ann');
    await assertSucceeds(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), newWallet()));
    // (the bet alone, the wallet alone, a different amount out, someone else's)
    await assertFails(setDoc(doc(db, 'users', 'ann', 'bets', 'b1'), playBet()));
    await assertFails(updateDoc(doc(db, 'users', 'ann', 'wallet', 'main'), { balance: increment(-25), lastBet: 'b1', updatedAt: serverTimestamp() }));
    await assertFails(place(db, 'ann', 'b1', playBet(), 5));
    await assertFails(place(as('bob'), 'ann', 'b1'));
    await assertSucceeds(place(db, 'ann', 'b1'));
    assertBalance(await getDoc(doc(db, 'users', 'ann', 'wallet', 'main')), 975);
    // (another, a moneyline, a total, a prop)
    await assertSucceeds(place(db, 'ann', 'b2', playBet({ market: 'ml', line: null, odds: 145, side: 'away', pick: 'LV ML', stake: 100 })));
    await assertSucceeds(place(db, 'ann', 'b3', playBet({ market: 'total', side: 'over', line: 45.5, pick: 'Over 45.5', stake: 1 })));
    await assertSucceeds(
      place(db, 'ann', 'b4', playBet({ market: 'prop', side: 'under', line: 24.5, odds: -110, pick: 'John Gibson Under 24.5 Saves', propType: 'saves', athlete: '2590824', player: 'John Gibson', statLabel: 'Saves', ref: '401:prop:saves:2590824', stake: 4 })),
    );
    assertBalance(await getDoc(doc(db, 'users', 'ann', 'wallet', 'main')), 870);
    // (the same bet id twice: the second is an update, never allowed)
    await assertFails(place(db, 'ann', 'b1'));
  });

  test('a bet: open, on a game not begun, a stake in half units no bigger than the balance, its fields as they should be', async () => {
    const db = as('ann');
    await assertSucceeds(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), newWallet()));
    const bad = [
      playBet({ stake: 1001 }),
      playBet({ stake: 0 }),
      playBet({ stake: 2.25 }),
      playBet({ start: later(-1) }),
      playBet({ start: later(24 * 20) }),
      playBet({ status: 'won' }),
      playBet({ profit: 50 }),
      playBet({ placedAt: Timestamp.fromMillis(Date.now() - 36e5) }),
      playBet({ odds: -99 }),
      playBet({ odds: 7.5 }),
      playBet({ run: 1 }),
      playBet({ sport: 'mma' }),
      playBet({ market: 'parlay' }),
      playBet({ side: 'over' }),
      playBet({ market: 'ml', line: -3.5 }),
      playBet({ market: 'total', side: 'over', line: -1 }),
      playBet({ market: 'prop', side: 'over', line: 1.5 }),
      playBet({ matchup: '<script>' }),
      playBet({ tier: 'mega' }),
      playBet({ propType: 'saves' }),
    ];
    for (const [i, b] of bad.entries()) await assertFails(place(db, 'ann', `bad${i}`, b, Number.isFinite(b.stake) ? b.stake : 25));
    // (never under 0: a stake bigger than the balance, however it's written)
    // (the band once called Bet: Like now)
    await assertSucceeds(place(db, 'ann', 'a-like', playBet({ tier: 'like', stake: 0.5 })));
    await assertSucceeds(place(db, 'ann', 'all-in', playBet({ stake: 999.5 })));
    await assertFails(place(db, 'ann', 'more', playBet({ stake: 1 })));
  });

  test('a reload: back to 1,000, one more reset; nothing else, and no settling from the browser', async () => {
    const db = as('ann');
    await assertSucceeds(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), newWallet()));
    await assertSucceeds(place(db, 'ann', 'b1', playBet({ stake: 400 })));
    const wallet = doc(db, 'users', 'ann', 'wallet', 'main');
    await assertFails(updateDoc(wallet, { balance: 1000, resets: increment(2), resetAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(wallet, { balance: 2000, resets: increment(1), resetAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(wallet, { balance: 1000, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(wallet, { balance: 1000, resets: increment(1), resetAt: serverTimestamp(), updatedAt: serverTimestamp(), start: 5000 }));
    await assertSucceeds(updateDoc(wallet, { balance: 1000, resets: increment(1), resetAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    const after = (await getDoc(wallet)).data();
    assertBalance({ data: () => after }, 1000);
    if (after.resets !== 1) throw new Error(`resets ${after.resets}`);
    // (a bet in the new run says so)
    await assertFails(place(db, 'ann', 'b2', playBet({ run: 0 })));
    await assertSucceeds(place(db, 'ann', 'b2', playBet({ run: 1 })));
    // (the browser never settles: no bet updates, no balance up)
    await assertFails(updateDoc(doc(db, 'users', 'ann', 'bets', 'b1'), { status: 'won', profit: 363.64 }));
    await assertFails(updateDoc(wallet, { balance: 5000, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(wallet, { balance: increment(500), lastBet: 'b1', updatedAt: serverTimestamp() }));
  });

  test('who sees the bets: the owner always; others by the open bets and history settings', async () => {
    await seedProfile('ann', { openBets: 'public', betHistory: 'private' });
    await seedProfile('bob');
    const db = as('ann');
    await assertSucceeds(setDoc(doc(db, 'users', 'ann', 'wallet', 'main'), newWallet()));
    await assertSucceeds(place(db, 'ann', 'b1'));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users', 'ann', 'bets', 'old'), { ...playBet(), start: later(-48), placedAt: Timestamp.now(), status: 'won', profit: 22.73 }));
    await assertSucceeds(getDoc(doc(db, 'users', 'ann', 'bets', 'old')));
    await assertSucceeds(getDocs(collection(db, 'users', 'ann', 'bets')));
    const bob = as('bob');
    await assertSucceeds(getDoc(doc(bob, 'users', 'ann', 'bets', 'b1')));
    await assertSucceeds(getDocs(query(collection(bob, 'users', 'ann', 'bets'), where('status', '==', 'open'))));
    await assertFails(getDoc(doc(bob, 'users', 'ann', 'bets', 'old')));
    await assertFails(getDocs(collection(bob, 'users', 'ann', 'bets')));
    await assertFails(getDoc(doc(bob, 'users', 'ann', 'wallet', 'main')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'ann', 'bets', 'old')));
    // (history public: the settled ones and the wallet too)
    await seedProfile('ann', { openBets: 'private', betHistory: 'public' });
    await assertSucceeds(getDoc(doc(bob, 'users', 'ann', 'bets', 'old')));
    await assertSucceeds(getDoc(doc(bob, 'users', 'ann', 'wallet', 'main')));
    await assertFails(getDoc(doc(bob, 'users', 'ann', 'bets', 'b1')));
    // (Clear history and the account going: the owner deletes; no one else)
    await assertFails(deleteDoc(doc(bob, 'users', 'ann', 'bets', 'old')));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'ann', 'bets', 'old')));
    // (an open bet stays until it's settled: tests/rules/security)
    await assertFails(deleteDoc(doc(db, 'users', 'ann', 'bets', 'b1')));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'ann', 'wallet', 'main')));
  });

  test('the settler’s documents: leaderboards read by anyone, tallies by the history setting, lines by no one; none written', async () => {
    await seedProfile('ann', { betHistory: 'public' });
    await seedProfile('cy', { betHistory: 'private' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore();
      await setDoc(doc(f, 'leaderboards', 'week'), { rows: [] });
      await setDoc(doc(f, 'tallies', 'ann'), { all: { won: 1 } });
      await setDoc(doc(f, 'tallies', 'cy'), { all: { won: 1 } });
      await setDoc(doc(f, 'lines', 'nfl_401'), { snaps: [] });
    });
    const anyone = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anyone, 'leaderboards', 'week')));
    await assertSucceeds(getDoc(doc(as('bob'), 'tallies', 'ann')));
    await assertFails(getDoc(doc(as('bob'), 'tallies', 'cy')));
    await assertSucceeds(getDoc(doc(as('cy'), 'tallies', 'cy')));
    await assertFails(getDoc(doc(as('ann'), 'lines', 'nfl_401')));
    await assertFails(setDoc(doc(as('ann'), 'leaderboards', 'week'), { rows: [{ uid: 'ann', profit: 1e6 }] }));
    await assertFails(setDoc(doc(as('ann'), 'tallies', 'ann'), { all: { won: 99 } }));
    await assertFails(setDoc(doc(as('ann'), 'lines', 'nfl_401'), { snaps: [] }));
  });
});

function assertBalance(snap, want) {
  const got = snap.data().balance;
  if (Math.abs(got - want) > 1e-9) throw new Error(`balance ${got}, wanted ${want}`);
}
