// Development only: a bet history on the emulators for a signed-in account, to see the wallet, the Open Bets
// tab and a profile's history with something in them. Places a few weeks of bets across the sports (each out
// of the wallet, as the app does), settles most of them through the settler's own settleOne (won, lost, a
// push, a void: the wallet paid and the tally added to), leaves a few open on games still to play, and writes
// the leaderboards. Refuses to run anywhere but the emulators.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//     node libs/ranker/scripts/accounts/seed-history.mjs [email]
//
// (no email: the emulator's only account, or its first)
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { settleOne, writeLeaderboards } from './settle.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Emulators only: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST');
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'qbranker2026' });
const db = getFirestore(app);
const auth = getAuth(app);

const DAY = 864e5;
const at = (days, hour = 20) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const toWin = (stake, odds) => Math.round((odds > 0 ? (stake * odds) / 100 : (stake * 100) / -odds) * 100) / 100;

// [days from now, sport, matchup, market, side, line, odds, stake, pick, tier, result, final]
// (result: won | lost | push | void | open)
const BETS = [
  [-19, 'nfl', 'KC @ BAL', 'spread', 'home', -2.5, -110, 25, 'BAL -2.5', 'love', 'won', 'KC 20 @ BAL 27'],
  [-19, 'nfl', 'KC @ BAL', 'total', 'over', 47.5, -108, 10, 'Over 47.5', null, 'lost', 'KC 20 @ BAL 27'],
  [-17, 'mlb', 'NYY @ BOS', 'ml', 'away', null, 135, 15, 'NYY ML', 'like', 'won', 'NYY 6 @ BOS 3'],
  [-16, 'nba', 'LAL @ GSW', 'spread', 'away', 4.5, -112, 20, 'LAL +4.5', 'love', 'lost', 'LAL 101 @ GSW 114'],
  [-14, 'nhl', 'TOR @ MTL', 'ml', 'home', null, 120, 10, 'MTL ML', 'pass', 'lost', 'TOR 4 @ MTL 2'],
  [-12, 'nfl', 'BUF @ MIA', 'spread', 'away', -3, -105, 30, 'BUF -3', 'lock', 'push', 'BUF 24 @ MIA 21'],
  [-12, 'nfl', 'BUF @ MIA', 'prop', 'over', 245.5, -115, 5, 'Josh Allen Over 245.5 Pass Yds', null, 'won', 'BUF 24 @ MIA 21'],
  [-10, 'mlb', 'LAD @ SD', 'total', 'under', 8.5, -102, 12.5, 'Under 8.5', 'like', 'won', 'LAD 3 @ SD 2'],
  [-9, 'nba', 'BOS @ NYK', 'ml', 'home', null, 150, 8, 'NYK ML', null, 'void', 'canceled'],
  [-7, 'nhl', 'EDM @ VAN', 'total', 'over', 6.5, 115, 10, 'Over 6.5', 'love', 'won', 'EDM 5 @ VAN 3'],
  [-6, 'nfl', 'DAL @ PHI', 'spread', 'home', -6.5, -110, 40, 'PHI -6.5', 'lock', 'won', 'DAL 13 @ PHI 31'],
  [-5, 'nfl', 'DAL @ PHI', 'ml', 'away', null, 230, 5, 'DAL ML', null, 'lost', 'DAL 13 @ PHI 31'],
  [-4, 'mlb', 'HOU @ SEA', 'spread', 'away', -1.5, 140, 10, 'HOU -1.5', 'like', 'lost', 'HOU 2 @ SEA 2'],
  [-3, 'nba', 'DEN @ PHX', 'total', 'under', 228.5, -110, 15, 'Under 228.5', 'pass', 'won', 'DEN 109 @ PHX 112'],
  [-2, 'nhl', 'NYR @ BOS', 'spread', 'home', -1.5, 165, 7.5, 'BOS -1.5', null, 'lost', 'NYR 3 @ BOS 2'],
  [-1, 'nfl', 'SF @ SEA', 'spread', 'home', 3, -110, 20, 'SEA +3', 'love', 'won', 'SF 23 @ SEA 24'],
  [1, 'nfl', 'GB @ CHI', 'spread', 'away', -3.5, -110, 25, 'GB -3.5', 'lock', 'open'],
  [1, 'nfl', 'GB @ CHI', 'total', 'over', 44.5, -105, 10, 'Over 44.5', null, 'open'],
  [2, 'nba', 'MIL @ CLE', 'ml', 'home', null, -135, 15, 'CLE ML', 'like', 'open'],
  [3, 'nhl', 'COL @ DAL', 'ml', 'away', null, 105, 0.5, 'COL ML', 'pass', 'open'],
];

const email = process.argv[2];
const user = email ? await auth.getUserByEmail(email) : (await auth.listUsers(10)).users[0];
if (!user) {
  console.error('No account on the Auth emulator: sign in on the site first');
  process.exit(1);
}
const uid = user.uid;
const walletRef = db.doc(`users/${uid}/wallet/main`);

// (a wallet made before the history, so its bets pay into it: settle-lib's paysInto)
const wallet = await walletRef.get();
const made = Timestamp.fromDate(at(-30));
if (!wallet.exists) {
  await walletRef.set({ balance: 1000, start: 1000, resets: 0, createdAt: made, updatedAt: FieldValue.serverTimestamp() });
} else {
  await walletRef.update({ createdAt: made });
}
const run = (await walletRef.get()).get('resets') ?? 0;

let settled = 0;
for (const [i, [days, sport, matchup, market, side, line, odds, stake, pick, tier, result, final]] of BETS.entries()) {
  const start = at(days, 19 + (i % 3));
  const ref = db.collection(`users/${uid}/bets`).doc(`seed-${i}`);
  const bet = {
    sport,
    event: `seed${i}`,
    matchup,
    start: Timestamp.fromDate(start),
    market,
    side,
    line,
    odds,
    stake,
    pick,
    botPick: !!tier,
    ...(tier ? { tier, kelly: { lock: 11.2, love: 6.1, like: 2.8, pass: 0.6 }[tier] } : {}),
    ref: `seed${i}:${market}`,
    ...(market === 'prop' ? { propType: 'passYds', athlete: '3918298', player: 'Josh Allen', statLabel: 'Pass Yds' } : {}),
    run,
    placedAt: Timestamp.fromDate(new Date(Math.min(start.getTime() - DAY, Date.now() - 6e4))),
    status: 'open',
  };
  await db.runTransaction(async (tx) => {
    tx.set(ref, bet);
    tx.update(walletRef, { balance: FieldValue.increment(-stake) });
  });
  if (result === 'open') continue;
  const profit = result === 'won' ? toWin(stake, odds) : result === 'lost' ? -stake : 0;
  await settleOne(db, ref, { status: result, profit, final, ...(result === 'void' ? { note: final } : {}) }, { start: start.toISOString() });
  settled++;
}
await writeLeaderboards(db, { log: () => {} });

const balance = (await walletRef.get()).get('balance');
console.log(`${user.email ?? uid}: ${settled} settled, ${BETS.length - settled} open; balance ${balance}`);
