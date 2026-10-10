// The play-money settler (libs/ranker/scripts/accounts/settle.mjs) against the Firestore emulator, with the
// Admin SDK as the Actions job runs it and ESPN stubbed with made-up games: bets settled from the finals and
// paid into their wallets, a price not on the board voided with its stake back, a run twice paying nothing
// twice, a bet from before a reload counted but not paid, the leaderboards (public players only), the lines'
// snapshots, a deleted account's tally dropped. `npm run test:rules`; without the emulator these skip.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { run } from '../../libs/ranker/scripts/accounts/settle.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';
const PROJECT = 'demo-season-ranker-settle';

let app;
let db;
before(() => {
  if (skip) return;
  app = initializeApp({ projectId: PROJECT }, 'settle-test');
  db = getFirestore(app);
});
after(async () => app && deleteApp(app));
beforeEach(async () => {
  if (skip) return;
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
});

const NOW = Date.parse('2026-10-12T03:00:00Z');
const at = (iso) => Timestamp.fromDate(new Date(iso));

// ESPN, made up: two finals (LV @ NE 20-24, SEA @ DET 3-2 in the NHL), one not over (CLE @ NYJ), DraftKings'
// core odds for the NFL final, and tomorrow's scoreboard with one game to snapshot
const header = (id, date, home, away, hs, as, done) => ({
  header: {
    id,
    season: { year: 2026, type: 2 },
    competitions: [
      {
        date,
        status: { type: { completed: done, state: done ? 'post' : 'in', name: done ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS' } },
        competitors: [
          { homeAway: 'home', score: String(hs), team: { id: '1', abbreviation: home } },
          { homeAway: 'away', score: String(as), team: { id: '2', abbreviation: away } },
        ],
      },
    ],
  },
  boxscore: {
    players: [
      {
        team: { abbreviation: 'DET' },
        statistics: [{ name: 'goaltending', labels: ['SA', 'GA', 'SV'], athletes: [{ athlete: { id: '2590824' }, stats: ['26', '2', '24'] }] }],
      },
    ],
  },
});
const core = {
  homeTeamOdds: {
    open: { pointSpread: { american: '-3' }, spread: { american: '-110' }, moneyLine: { american: '-160' } },
    close: { pointSpread: { american: '-3.5' }, spread: { american: '-108' }, moneyLine: { american: '-180' } },
  },
  awayTeamOdds: {
    open: { pointSpread: { american: '+3' }, spread: { american: '-110' }, moneyLine: { american: '+135' } },
    close: { pointSpread: { american: '+3.5' }, spread: { american: '-112' }, moneyLine: { american: '+150' } },
  },
  open: { total: { american: '44.5' }, over: { american: '-110' }, under: { american: '-110' } },
  close: { total: { american: '45.5' }, over: { american: '-105' }, under: { american: '-115' } },
};
let tomorrowSpread = '-6.5';
const fetched = [];
async function fetchJson(url) {
  fetched.push(url);
  if (url.includes('summary?event=401')) return header('401', '2026-10-11T17:00Z', 'NE', 'LV', 24, 20, true);
  if (url.includes('summary?event=402')) return header('402', '2026-10-11T20:00Z', 'NYJ', 'CLE', 7, 3, false);
  if (url.includes('summary?event=501')) return header('501', '2026-10-11T23:00Z', 'DET', 'SEA', 3, 2, true);
  if (url.includes('/events/401/competitions/401/odds/100')) return core;
  if (url.includes('football/nfl/scoreboard') && url.includes('dates=20261012')) {
    return {
      events: [
        {
          id: '403',
          date: '2026-10-12T23:15Z',
          competitions: [
            {
              status: { type: { state: 'pre' } },
              odds: [
                {
                  provider: { name: 'DraftKings' },
                  moneyline: { home: { close: { odds: '-250' } }, away: { close: { odds: '+205' } } },
                  pointSpread: { home: { close: { line: tomorrowSpread, odds: '-110' } }, away: { close: { line: '+6.5', odds: '-110' } } },
                  total: { over: { close: { line: 'o48.5', odds: '-110' } }, under: { close: { line: 'u48.5', odds: '-110' } } },
                },
              ],
            },
          ],
        },
      ],
    };
  }
  return { events: [] };
}

// The bettor's ledger: its own pick on the NHL prop (graded: he made 24 saves)
const ledgers = {
  nfl: [],
  nba: [],
  mlb: [],
  nhl: [
    { id: '501:prop:saves:2590824', event: '501', market: 'prop', side: 'under', propType: 'saves', athlete: '2590824', line: 24.5, odds: -110, placedAt: '2026-10-11T12:00Z', status: 'won', actual: 24 },
  ],
};

const bet = (over = {}) => ({
  sport: 'nfl',
  event: '401',
  matchup: 'LV @ NE',
  start: at('2026-10-11T17:00Z'),
  market: 'spread',
  side: 'home',
  line: -3.5,
  odds: -108,
  stake: 100,
  pick: 'NE -3.5',
  run: 0,
  placedAt: at('2026-10-10T15:00Z'),
  status: 'open',
  ...over,
});

async function seed(uid, { betHistory = 'public', balance = 800, resets = 0, bets = {}, photo = null } = {}) {
  await db.doc(`users/${uid}`).set({ username: uid, usernameLower: uid, displayName: uid.toUpperCase(), photo, visibility: { lists: 'public', presets: 'public', openBets: 'friends', betHistory, tracker: 'friends' } });
  await db.doc(`users/${uid}/wallet/main`).set({ balance, start: 1000, resets });
  for (const [id, b] of Object.entries(bets)) await db.doc(`users/${uid}/bets/${id}`).set(b);
}

const quiet = () => undefined;

describe('the settler', { skip }, () => {
  test('settles the finals, pays the wallets, voids what must be, and pays nothing twice', async () => {
    await seed('ann', {
      balance: 699,
      bets: {
        // (won: 100 at -108 pays 192.59 back)
        won: bet(),
        // (lost)
        lost: bet({ market: 'ml', side: 'away', line: null, odds: 150, pick: 'LV ML', stake: 50 }),
        // (a price never on the board: void, its stake back)
        void: bet({ market: 'total', side: 'over', line: 45.5, odds: 140, pick: 'Over 45.5', stake: 25 }),
        // (not over yet: waits)
        waiting: bet({ event: '402', matchup: 'CLE @ NYJ', start: at('2026-10-11T20:00Z'), side: 'away', line: 2.5, stake: 10 }),
        // (the bot's prop at its price: under 24.5 saves, he made 24)
        prop: bet({ sport: 'nhl', event: '501', matchup: 'SEA @ DET', start: at('2026-10-11T23:00Z'), market: 'prop', side: 'under', line: 24.5, odds: -110, propType: 'saves', athlete: '2590824', player: 'John Gibson', statLabel: 'Saves', ref: '501:prop:saves:2590824', pick: 'John Gibson Under 24.5 Saves', stake: 11 }),
        // (a game not begun: not looked at)
        future: bet({ event: '403', matchup: 'KC @ DEN', start: at('2026-10-12T23:15Z') }),
      },
    });
    // (bob: friends-only history, a bet from before his reload: settled and counted, not paid)
    await seed('bob', { betHistory: 'friends', balance: 1000, resets: 1, bets: { old: bet({ stake: 40, run: 0 }) } });
    // (a tally whose account is gone)
    await db.doc('tallies/ghost').set({ all: { won: 5 }, days: { '2026-10-11': [5, 0, 0, 50, 45] } });

    const first = await run({ db, fetchJson, now: NOW, ledgers, log: quiet });
    assert.equal(first.failed, false);
    assert.deepEqual(first.counts, { settled: 4, void: 1, waiting: 1 });

    const get = async (p) => (await db.doc(p).get()).data();
    const won = await get('users/ann/bets/won');
    assert.equal(won.status, 'won');
    assert.equal(won.profit, 92.59);
    assert.equal(won.final, 'LV 20 @ NE 24');
    assert.ok(won.settledAt);
    assert.equal((await get('users/ann/bets/lost')).status, 'lost');
    const v = await get('users/ann/bets/void');
    assert.deepEqual([v.status, v.profit, v.note], ['void', 0, 'price didn’t match the board']);
    assert.equal((await get('users/ann/bets/waiting')).status, 'open');
    assert.equal((await get('users/ann/bets/future')).status, 'open');
    const prop = await get('users/ann/bets/prop');
    assert.deepEqual([prop.status, prop.profit, prop.final], ['won', 10, 'John Gibson 24 Saves']);
    // (699 + 192.59 + 25 + 21 = 937.59)
    assert.equal((await get('users/ann/wallet/main')).balance, 937.59);
    // (bob's bet from run 1 settled and counted; his run-2 wallet untouched)
    assert.equal((await get('users/bob/bets/old')).status, 'won');
    assert.equal((await get('users/bob/wallet/main')).balance, 1000);
    const tally = await get('tallies/ann');
    assert.deepEqual(tally.all, { won: 2, lost: 1, push: 0, void: 1, staked: 161, profit: 52.59 });
    assert.deepEqual(tally.days['2026-10-11'], [2, 1, 0, 161, 52.59]);

    // (the boards: ann public, bob not; the ghost's tally gone)
    const week = await get('leaderboards/week');
    assert.equal(week.label, 'Week of Oct 5');
    assert.deepEqual(
      week.rows.map((r) => [r.username, r.won, r.lost, r.profit]),
      [['ann', 2, 1, 52.59]],
    );
    // (her reloads beside her row, read from her wallet's resets)
    assert.equal(week.rows[0].reloads, 0);
    assert.equal((await get('leaderboards/all')).rows.length, 1);
    assert.equal((await db.doc('tallies/ghost').get()).exists, false);

    // (the lines: tomorrow's game snapshotted once; again only when a price moves)
    const lines = await get('lines/nfl_403');
    assert.equal(lines.snaps.length, 1);
    assert.equal(lines.snaps[0].spread.home.line, -6.5);

    // (run again: nothing paid twice, the snapshot unchanged)
    const second = await run({ db, fetchJson, now: NOW + 36e5, ledgers, log: quiet });
    assert.deepEqual(second.counts, { settled: 0, void: 0, waiting: 1 });
    assert.equal((await get('users/ann/wallet/main')).balance, 937.59);
    assert.equal((await get('lines/nfl_403')).snaps.length, 1);
    tomorrowSpread = '-7';
    await run({ db, fetchJson, now: NOW + 2 * 36e5, ledgers, log: quiet });
    assert.equal((await get('lines/nfl_403')).snaps.length, 2);
  });

  test('a bet placed from a snapshot’s price within its window stands; a dry run writes nothing', async () => {
    await db.doc('lines/nfl_401').set({ sport: 'nfl', event: '401', snaps: [{ at: '2026-10-10T14:00:00Z', spread: { home: { line: -2.5, odds: -105 }, away: { line: 2.5, odds: -115 } }, total: { line: 46, over: -110, under: -110 }, ml: { home: -190, away: 160 } }] });
    await seed('cy', { bets: { snap: bet({ line: -2.5, odds: -105 }), late: bet({ line: -2.5, odds: -105, placedAt: at('2026-10-11T10:00Z') }) } });
    const dry = await run({ db, fetchJson, now: NOW, ledgers, dry: true, log: quiet });
    assert.deepEqual(dry.counts, { settled: 1, void: 1, waiting: 0 });
    assert.equal((await db.doc('users/cy/bets/snap').get()).get('status'), 'open');
    assert.equal((await db.doc('leaderboards/week').get()).exists, false);
    await run({ db, fetchJson, now: NOW, ledgers, log: quiet });
    assert.equal((await db.doc('users/cy/bets/snap').get()).get('status'), 'won');
    assert.equal((await db.doc('users/cy/bets/late').get()).get('note'), 'price didn’t match the board');
  });
});
