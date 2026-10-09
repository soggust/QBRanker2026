// The accounts' security review (phase 3), the settler's side: settle.mjs runs with the Admin SDK (no rules), so
// it mustn't trust what a browser could have written into a bet or a wallet. Each test is one finding: it failed
// before its fix. Against the Firestore emulator (`npm run test:rules`), ESPN stubbed; without it these skip.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { run } from '../../libs/ranker/scripts/accounts/settle.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = host ? false : 'no Firestore emulator (npm run test:rules)';
const PROJECT = 'demo-season-ranker-secsettle';

let app;
let db;
before(() => {
  if (skip) return;
  app = initializeApp({ projectId: PROJECT }, 'security-settle-test');
  db = getFirestore(app);
});
after(async () => app && deleteApp(app));
beforeEach(async () => {
  if (skip) return;
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
});

const NOW = Date.parse('2026-10-12T03:00:00Z');
const at = (iso) => Timestamp.fromDate(new Date(iso));
const quiet = () => undefined;

// ESPN, made up: LV @ NE 20-24 (NFL, final, 2026-10-11 17:00Z) with DraftKings' close at NE -3.5 -108; SEA @ DET
// 3-2 (NHL, final) where only goalie 2590824 has a box score line (24 saves)
const header = (id, date, home, away, hs, as) => ({
  header: {
    id,
    season: { year: 2026, type: 2 },
    competitions: [
      {
        date,
        status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
        competitors: [
          { homeAway: 'home', score: String(hs), team: { id: '1', abbreviation: home } },
          { homeAway: 'away', score: String(as), team: { id: '2', abbreviation: away } },
        ],
      },
    ],
  },
  boxscore: {
    players: [{ team: { abbreviation: 'DET' }, statistics: [{ name: 'goaltending', labels: ['SA', 'GA', 'SV'], athletes: [{ athlete: { id: '2590824' }, stats: ['26', '2', '24'] }] }] }],
  },
});
const core = {
  homeTeamOdds: { close: { pointSpread: { american: '-3.5' }, spread: { american: '-108' }, moneyLine: { american: '-180' } } },
  awayTeamOdds: { close: { pointSpread: { american: '+3.5' }, spread: { american: '-112' }, moneyLine: { american: '+150' } } },
  close: { total: { american: '45.5' }, over: { american: '-105' }, under: { american: '-115' } },
};
async function fetchJson(url) {
  if (url.includes('summary?event=401')) return header('401', '2026-10-11T17:00Z', 'NE', 'LV', 24, 20);
  if (url.includes('summary?event=501')) return header('501', '2026-10-11T23:00Z', 'DET', 'SEA', 3, 2);
  if (url.includes('/events/401/competitions/401/odds/100')) return core;
  return { events: [] };
}

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

async function seed(uid, { wallet = { balance: 900, start: 1000, resets: 0, createdAt: at('2026-10-01T00:00Z') }, bets = {}, profile = true } = {}) {
  if (profile) await db.doc(`users/${uid}`).set({ username: uid, usernameLower: uid, displayName: uid, visibility: { lists: 'public', presets: 'public', openBets: 'friends', betHistory: 'public', tracker: 'friends' } });
  if (wallet) await db.doc(`users/${uid}/wallet/main`).set(wallet);
  for (const [id, b] of Object.entries(bets)) await db.doc(`users/${uid}/bets/${id}`).set(b);
}
const get = async (p) => (await db.doc(p).get()).data();

describe('security review: the settler', { skip }, () => {
  test('a prop is settled by its own player’s count, never another pick’s named in its ref', async () => {
    const ledgers = {
      nfl: [],
      nba: [],
      mlb: [],
      nhl: [
        // (the bot's graded pick on the goalie who played: 24 saves)
        { id: '501:prop:saves:2590824', event: '501', market: 'prop', side: 'under', propType: 'saves', athlete: '2590824', line: 24.5, odds: -110, placedAt: '2026-10-11T12:00Z', status: 'won', actual: 24 },
        // (and one on a goalie who didn't play: its price is on the board, but no count)
        { id: '501:prop:saves:999', event: '501', market: 'prop', side: 'under', propType: 'saves', athlete: '999', line: 30.5, odds: -110, placedAt: '2026-10-11T12:00Z', status: 'open' },
      ],
    };
    // (mallory bets the one who didn't play, under 30.5, with the other pick's id in ref: its 24 would win it)
    await seed('mallory', {
      bets: {
        forged: bet({ sport: 'nhl', event: '501', matchup: 'SEA @ DET', start: at('2026-10-11T23:00Z'), market: 'prop', side: 'under', line: 30.5, odds: -110, propType: 'saves', athlete: '999', player: 'Backup', statLabel: 'Saves', ref: '501:prop:saves:2590824', pick: 'Backup Under 30.5 Saves', stake: 500 }),
      },
    });
    await run({ db, fetchJson, now: NOW + 4 * 864e5, ledgers, log: quiet });
    const forged = await get('users/mallory/bets/forged');
    assert.notEqual(forged.status, 'won');
    assert.equal((await get('users/mallory/wallet/main')).balance, 900 + (forged.status === 'void' ? 500 : 0));
  });

  test('a wallet made again pays nothing for bets placed before it (no fresh 1,000 a bet, run 0 every time)', async () => {
    // (the bet placed from the old wallet, deleted since and made again: same run number 0, a later createdAt)
    await seed('mallory', { wallet: { balance: 1000, start: 1000, resets: 0, createdAt: at('2026-10-10T16:00Z') }, bets: { old: bet() } });
    await run({ db, fetchJson, now: NOW, ledgers: {}, log: quiet });
    assert.equal((await get('users/mallory/bets/old')).status, 'won');
    assert.equal((await get('users/mallory/wallet/main')).balance, 1000);
  });

  test('a deleted account’s open bets are removed (the browser can’t delete an open bet), its tally with them', async () => {
    await seed('gone', { profile: false, wallet: null, bets: { due: bet(), later: bet({ event: '403', matchup: 'KC @ DEN', start: at('2026-10-20T17:00Z') }) } });
    await db.doc('tallies/gone').set({ all: { won: 1 }, days: {} });
    await seed('ann', { bets: { mine: bet({ event: '403', matchup: 'KC @ DEN', start: at('2026-10-20T17:00Z') }) } });
    await run({ db, fetchJson, now: NOW, ledgers: {}, log: quiet });
    assert.equal((await db.doc('users/gone/bets/due').get()).exists, false);
    assert.equal((await db.doc('users/gone/bets/later').get()).exists, false);
    assert.equal((await db.doc('tallies/gone').get()).exists, false);
    // (a live account's open bet untouched)
    assert.equal((await get('users/ann/bets/mine')).status, 'open');
  });

  test('a bet is filed under its game’s real day, not the start the browser wrote', async () => {
    // (the game was the 11th; the bet says the 14th, to land in another week's board)
    await seed('mallory', { bets: { moved: bet({ start: at('2026-10-14T17:00Z') }) } });
    await run({ db, fetchJson, now: Date.parse('2026-10-15T00:00Z'), ledgers: {}, log: quiet });
    assert.equal((await get('users/mallory/bets/moved')).status, 'won');
    const tally = await get('tallies/mallory');
    assert.deepEqual(Object.keys(tally.days), ['2026-10-11']);
  });
});
