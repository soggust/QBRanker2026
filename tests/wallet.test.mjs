// The play-money wallet: the Bets page's board read off ESPN's scoreboard, the slip's stakes and payouts, a bet
// in play settled by the score as the settler will settle it, the wallet's records and the comparison with the
// bot (wallet-math.ts); and the settler's own logic (libs/ranker/scripts/accounts/settle-lib.mjs): a bet settled
// from a final by the bettor's rules, the price check against the board, the tallies and the leaderboards.
// No network, no Firestore: the games and boards here are made up (the settler against the emulator:
// tests/rules/wallet-settle.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';
import * as lib from '../libs/ranker/scripts/accounts/settle-lib.mjs';

const w = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support/wallet-entry.ts'), data: {} });

// ---------------------------------------------------------------------------
// A made-up scoreboard event, ESPN's shape (DraftKings' lines: close is the current one)
// ---------------------------------------------------------------------------
const side = (close, open = close) => ({ close, open });
function espnEvent({ id = '401', state = 'pre', completed = false, name = 'STATUS_SCHEDULED', hs = '', as = '', odds = true } = {}) {
  return {
    id,
    date: '2026-10-11T17:00Z',
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: hs, team: { abbreviation: 'NE', displayName: 'New England Patriots', logo: 'ne.png' } },
          { homeAway: 'away', score: as, team: { abbreviation: 'LV', displayName: 'Las Vegas Raiders', logo: 'lv.png' } },
        ],
        status: { type: { state, completed, name, shortDetail: state === 'in' ? 'Q3 4:12' : 'Sun 1:00 PM' } },
        odds: odds
          ? [
              {
                provider: { name: 'DraftKings' },
                overUnder: 45.5,
                moneyline: { home: side({ odds: '-175' }, { odds: '-160' }), away: side({ odds: '+145' }) },
                pointSpread: { home: side({ line: '-3.5', odds: '-110' }), away: side({ line: '+3.5', odds: 'EVEN' }) },
                total: { over: side({ line: 'o45.5', odds: '-105' }), under: side({ line: 'u45.5', odds: '-115' }) },
              },
            ]
          : [],
      },
    ],
  };
}

test('the board: every market both sides at DraftKings, from the scoreboard', () => {
  const b = w.boardOf('nfl', espnEvent());
  assert.equal(b.matchup, 'LV @ NE');
  assert.equal(b.state, 'pre');
  assert.deepEqual(b.spread.home, { market: 'spread', side: 'home', line: -3.5, odds: -110 });
  // (EVEN is +100)
  assert.deepEqual(b.spread.away, { market: 'spread', side: 'away', line: 3.5, odds: 100 });
  assert.deepEqual(b.total.over, { market: 'total', side: 'over', line: 45.5, odds: -105 });
  assert.equal(b.total.under.odds, -115);
  assert.deepEqual(b.ml.home, { market: 'ml', side: 'home', line: null, odds: -175 });
  assert.equal(b.ml.away.odds, 145);
  // (no lines: no markets; a score only once it's begun)
  const bare = w.boardOf('nfl', espnEvent({ odds: false }));
  assert.equal(bare.spread, null);
  assert.equal(bare.book, null);
  assert.equal(bare.home.score, null);
  const live = w.boardOf('nfl', espnEvent({ state: 'in', hs: '17', as: '10' }));
  assert.deepEqual([live.home.score, live.away.score, live.final], [17, 10, false]);
  // (a game called off is never final)
  const off = w.boardOf('nfl', espnEvent({ state: 'post', completed: true, name: 'STATUS_POSTPONED', hs: '0', as: '0' }));
  assert.equal(off.final, false);
  assert.equal(w.priceOf('+120'), 120);
  assert.equal(w.priceOf('EVEN'), 100);
  assert.equal(w.priceOf(''), null);
  assert.equal(w.priceOf('50'), null);
  assert.equal(w.lineOf('PK'), 0);
  assert.equal(w.lineOf('u8.5'), 8.5);
});

test('the words: a bet as the bettor writes its own', () => {
  assert.equal(w.pickWords({ market: 'spread', side: 'away', line: 3.5 }, 'LV @ NE'), 'LV +3.5');
  assert.equal(w.pickWords({ market: 'spread', side: 'home', line: -3.5 }, 'LV @ NE'), 'NE -3.5');
  assert.equal(w.pickWords({ market: 'spread', side: 'home', line: 0 }, 'LV @ NE'), 'NE PK');
  assert.equal(w.pickWords({ market: 'total', side: 'under', line: 45.5 }, 'LV @ NE'), 'Under 45.5');
  assert.equal(w.pickWords({ market: 'ml', side: 'away', line: null }, 'LV @ NE'), 'LV ML');
  assert.equal(w.pickWords({ market: 'prop', side: 'over', line: 24.5, player: 'John Gibson', statLabel: 'Saves' }, 'SEA @ DET'), 'John Gibson Over 24.5 Saves');
  assert.equal(w.oddsText(150), '+150');
  assert.equal(w.oddsText(-110), '-110');
  // (ESPN files a game by its day in US Eastern time: a 7:30 PM Pacific start is the next day in UTC)
  assert.equal(w.espnDay('2026-10-12T02:30:00Z'), '20261011');
});

test('the slip: what a stake wins and pays, the totals, the chips, the stake rules', () => {
  assert.equal(w.toWin(10, -110), 9.09);
  assert.equal(w.toWin(10, 150), 15);
  assert.equal(w.toWin(25, 100), 25);
  assert.equal(w.payout(10, -110), 19.09);
  assert.equal(w.payout(100, 235), 335);
  assert.deepEqual(w.slipTotals([{ stake: 10, odds: -110 }, { stake: 5, odds: 200 }, { stake: 0, odds: -120 }]), { count: 2, stake: 15, toWin: 19.09, payout: 34.09 });
  // (chips stack, never past what's left)
  assert.equal(w.addChip(0, 25, 1000), 25);
  assert.equal(w.addChip(25, 100, 1000), 125);
  assert.equal(w.addChip(90, 25, 100), 100);
  assert.equal(w.addChip(5, 5, 7.5), 7);
  assert.equal(w.stakeProblem(0, 1000), 'Set a stake');
  assert.equal(w.stakeProblem(2.5, 1000), 'Whole units only');
  assert.equal(w.stakeProblem(600, 1000, 500), 'Only 500 units left');
  assert.equal(w.stakeProblem(1, 0.5), 'Not enough in the wallet');
  assert.equal(w.stakeProblem(500, 1000, 500), null);
  // (a game can be bet only before it begins)
  const now = Date.parse('2026-10-11T16:00Z');
  assert.equal(w.bettable('2026-10-11T17:00Z', 'pre', now), true);
  assert.equal(w.bettable('2026-10-11T17:00Z', 'in', now), false);
  assert.equal(w.bettable('2026-10-11T15:00Z', undefined, now), false);
  assert.equal(w.selectionKey({ sport: 'nfl', event: '401', market: 'spread', side: 'home' }), 'nfl|401|spread|home||');
});

const bet = (over = {}) => ({
  id: 'b1',
  sport: 'nfl',
  event: '401',
  matchup: 'LV @ NE',
  start: '2026-10-11T17:00Z',
  market: 'spread',
  side: 'home',
  line: -3.5,
  odds: -110,
  stake: 10,
  pick: 'NE -3.5',
  run: 0,
  placedAt: '2026-10-10T12:00:00.000Z',
  status: 'open',
  ...over,
});

test('in play: a bet decided by the score before the settler pays it, as desk-math decides the bot’s', () => {
  const board = (hs, as, final, state = final ? 'post' : 'in', completed = final) =>
    w.boardOf('nfl', espnEvent({ state, completed, name: final ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', hs: String(hs), as: String(as) }));
  // (a spread: only once it's final)
  assert.equal(w.provisionalOf(bet(), board(24, 10, false), null), null);
  assert.deepEqual(w.provisionalOf(bet(), board(24, 10, true), null), { status: 'won', profit: 9.09 });
  assert.deepEqual(w.provisionalOf(bet(), board(20, 17, true), null), { status: 'lost', profit: -10 });
  // (a total: the over home as soon as the scoring's past the line)
  assert.deepEqual(w.provisionalOf(bet({ market: 'total', side: 'over', line: 45.5, odds: 100 }), board(28, 21, false), null), { status: 'won', profit: 10 });
  assert.equal(w.provisionalOf(bet({ market: 'total', side: 'over', line: 45.5 }), board(21, 21, false), null), null);
  // (a moneyline's push on a tie; a prop past its line)
  assert.deepEqual(w.provisionalOf(bet({ market: 'ml', line: null, odds: -175 }), board(20, 20, true), null), { status: 'push', profit: 0 });
  assert.deepEqual(w.provisionalOf(bet({ market: 'prop', side: 'over', line: 24.5, propType: 'saves' }), board(1, 1, false), 26), { status: 'won', profit: 9.09 });
  assert.equal(w.provisionalOf(bet({ status: 'won' }), board(24, 10, true), null), null);
  assert.equal(w.provisionalOf(bet(), undefined, null), null);
});

test('the wallet’s record: won, lost, pushed and void; staked, profit, return; at risk; the curve', () => {
  const list = [
    bet({ id: 'a', status: 'won', profit: 9.09, settledAt: '2026-10-11T21:00Z' }),
    bet({ id: 'b', status: 'lost', profit: -10, stake: 10, settledAt: '2026-10-11T22:00Z' }),
    bet({ id: 'c', status: 'push', profit: 0, settledAt: '2026-10-11T23:00Z' }),
    bet({ id: 'd', status: 'void', profit: 0, note: 'price didn’t match the board' }),
    bet({ id: 'e', status: 'open', stake: 25 }),
  ];
  const t = w.playTally(list);
  assert.deepEqual({ ...t, roi: Math.round(t.roi * 1e4) / 1e4 }, { won: 1, lost: 1, push: 1, void: 1, open: 1, staked: 30, profit: -0.91, roi: -0.0303, atRisk: 25 });
  assert.equal(w.recordText(t), '1-1-1');
  assert.equal(w.recordText({ won: 3, lost: 2, push: 0 }), '3-2');
  const curve = w.playCurve(list);
  assert.deepEqual(curve.totals.map((v) => Math.round(v * 100) / 100), [0, 9.09, -0.91, -0.91]);
  const groups = w.byGame([bet({ id: 'x', event: '2', start: '2026-10-12T00:00Z' }), bet({ id: 'y' }), bet({ id: 'z', placedAt: '2026-10-09T00:00Z' })]);
  assert.deepEqual(
    groups.map((g) => [g.event, g.bets.map((b) => b.id)]),
    [
      ['401', ['z', 'y']],
      ['2', ['x']],
    ],
  );
});

test('you vs the bot: the bot’s published picks settled over the same stretch, by return on stakes', () => {
  const mine = [bet({ status: 'won', profit: 9.09, start: '2026-10-11T17:00Z' }), bet({ status: 'lost', profit: -10, start: '2026-10-12T17:00Z' })];
  const ledger = [
    { status: 'won', start: '2026-10-11T17:00Z', units: 2, profit: 1.8, published: true },
    { status: 'won', start: '2026-10-11T20:00Z', units: 1, profit: 0.91, published: true },
    { status: 'lost', start: '2026-10-12T17:00Z', units: 1, profit: -1, published: true },
    // (before the user's first bet, unpublished, void or open: not counted)
    { status: 'won', start: '2026-10-01T17:00Z', units: 1, profit: 1, published: true },
    { status: 'lost', start: '2026-10-11T17:00Z', units: 1, profit: -1 },
    { status: 'push', start: '2026-10-11T17:00Z', units: 1, profit: 0, published: true, void: true },
    { status: 'open', start: '2026-10-13T17:00Z', units: 1, profit: 0, published: true },
  ];
  const v = w.versusBot(mine, ledger);
  assert.equal(v.from, '2026-10-11T17:00Z');
  assert.deepEqual([v.you.won, v.you.lost, v.you.winPct], [1, 1, 0.5]);
  assert.equal(Math.round(v.you.roi * 1e4), -455);
  assert.deepEqual([v.bot.won, v.bot.lost], [2, 1]);
  assert.equal(Math.round(v.bot.roi * 1e4), 4275);
  assert.equal(w.versusBot([], ledger).from, null);
});

// ---------------------------------------------------------------------------
// The settler (settle-lib.mjs)
// ---------------------------------------------------------------------------
const game = (over = {}) => ({ id: '401', date: '2026-10-11T17:00Z', homeAbbr: 'NE', awayAbbr: 'LV', final: true, hs: 24, as: 20, ...over });
const now = Date.parse('2026-10-12T03:00Z');
const coreBody = {
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
const board = lib.coreObservations(coreBody);

test('the price check: the open, the close, the bot’s and the snapshots in their window; the line exact, the price within 10 cents', () => {
  assert.equal(lib.cents(-110), -10);
  assert.equal(lib.cents(120), 20);
  assert.ok(lib.priceNear(-105, -110));
  assert.ok(lib.priceNear(100, -110));
  assert.ok(!lib.priceNear(105, -110));
  // (a long price gets 4% of itself)
  assert.ok(lib.priceNear(800, 770));
  assert.ok(!lib.priceNear(800, 700));
  assert.equal(board.length, 12);
  // (the close's price, the open's line and price)
  assert.deepEqual(lib.checkPrice(bet({ odds: -108 }), board), { ok: true, by: 'close' });
  assert.deepEqual(lib.checkPrice(bet({ line: -3, odds: -110 }), board), { ok: true, by: 'open' });
  assert.equal(lib.checkPrice(bet({ line: -2.5 }), board).ok, false);
  assert.equal(lib.checkPrice(bet({ odds: 120 }), board).why, 'price didn’t match the board');
  assert.ok(lib.checkPrice(bet({ market: 'ml', side: 'away', line: null, odds: 150 }), board).ok);
  assert.ok(lib.checkPrice(bet({ market: 'total', side: 'under', line: 45.5, odds: -115 }), board).ok);
  // (a snapshot only within 3 hours of the bet)
  const snap = lib.observationsOf({ spread: { home: { line: -4, odds: -105 }, away: { line: 4, odds: -115 } }, total: { line: 46, over: -110, under: -110 }, ml: { home: -190, away: 160 } }, 'snap', Date.parse('2026-10-10T13:00Z'));
  assert.deepEqual(lib.checkPrice(bet({ line: -4, odds: -105 }), [...board, ...snap]), { ok: true, by: 'snap' });
  assert.equal(lib.checkPrice(bet({ line: -4, odds: -105, placedAt: '2026-10-10T20:00:00Z' }), [...board, ...snap]).ok, false);
  // (no board at all for the market: void, saying so)
  assert.match(lib.checkPrice(bet(), []).why, /no board/);
  // (a prop: the bot's own pick, its line and price)
  const bot = lib.botObservations([{ market: 'prop', side: 'under', propType: 'saves', athlete: 2590824, line: 24.5, odds: -110, placedAt: '2026-10-09T20:00Z', seen: { at: '2026-10-10T20:00Z', line: 24.5, odds: -125 } }]);
  const prop = bet({ market: 'prop', side: 'under', line: 24.5, odds: -110, propType: 'saves', athlete: '2590824' });
  assert.ok(lib.checkPrice(prop, bot).ok);
  assert.ok(lib.checkPrice({ ...prop, odds: -125 }, bot).ok);
  assert.equal(lib.checkPrice({ ...prop, line: 23.5 }, bot).ok, false);
  assert.equal(lib.checkPrice({ ...prop, athlete: '1' }, bot).ok, false);
});

test('settling: won, lost, pushed from the final by the bettor’s rules; void when it must be; null while it waits', () => {
  const opts = { observations: board, now };
  assert.deepEqual(lib.settlePlayBet(bet({ odds: -108 }), game(), opts), { status: 'won', profit: 9.26, final: 'LV 20 @ NE 24' });
  assert.deepEqual(lib.settlePlayBet(bet({ odds: -108 }), game({ hs: 23 }), opts).status, 'lost');
  assert.deepEqual(lib.settlePlayBet(bet({ line: -3, odds: -110 }), game({ hs: 23 }), opts), { status: 'push', profit: 0, final: 'LV 20 @ NE 23' });
  assert.deepEqual(lib.settlePlayBet(bet({ market: 'total', side: 'under', line: 45.5, odds: -115 }), game(), opts), { status: 'won', profit: 8.7, final: 'LV 20 @ NE 24' });
  assert.deepEqual(lib.settlePlayBet(bet({ market: 'ml', side: 'away', line: null, odds: 150 }), game(), opts), { status: 'lost', profit: -10, final: 'LV 20 @ NE 24' });
  // (not final yet: waits)
  assert.equal(lib.settlePlayBet(bet(), game({ final: false, hs: null, as: null }), opts), null);
  // (the price not on the board, placed after the start, not this game, called off)
  assert.deepEqual(lib.settlePlayBet(bet({ odds: 130 }), game(), opts), { status: 'void', profit: 0, note: 'price didn’t match the board' });
  assert.equal(lib.settlePlayBet(bet({ odds: -108, placedAt: '2026-10-11T17:30:00Z' }), game(), opts).note, 'placed after the start');
  assert.equal(lib.settlePlayBet(bet({ matchup: 'KC @ DEN' }), game(), opts).note, 'not this game');
  assert.equal(lib.settlePlayBet(bet(), game({ final: false, off: 'canceled', hs: null, as: null }), opts).note, 'game canceled');
  // (ESPN with no game: waits, then void after 3 days)
  assert.equal(lib.settlePlayBet(bet(), null, opts), null);
  assert.equal(lib.settlePlayBet(bet(), null, { ...opts, now: now + 4 * lib.DAY }).note, 'game not found');
  // (a prop: the count, or no action when he didn't play)
  const bot = lib.botObservations([{ market: 'prop', side: 'over', propType: 'saves', athlete: '9', line: 24.5, odds: -110, placedAt: '2026-10-09T20:00Z' }]);
  const prop = bet({ market: 'prop', side: 'over', line: 24.5, propType: 'saves', athlete: '9', player: 'John Gibson', statLabel: 'Saves' });
  assert.deepEqual(lib.settlePlayBet(prop, game(), { observations: bot, propValue: 27, now }), { status: 'won', profit: 9.09, final: 'John Gibson 27 Saves' });
  assert.equal(lib.settlePlayBet(prop, game(), { observations: bot, propValue: 20, now }).status, 'lost');
  assert.deepEqual(lib.settlePlayBet(prop, game(), { observations: bot, propValue: null, now }), { status: 'void', profit: 0, note: 'did not play' });
  assert.equal(lib.settlePlayBet(prop, game(), { observations: bot, propValue: undefined, now }), null);
  assert.equal(lib.settlePlayBet(prop, game(), { observations: bot, propValue: undefined, now: now + 4 * lib.DAY }).note, 'couldn’t read the stat');
  // (what goes back in the wallet)
  assert.equal(lib.creditOf(10, { status: 'won', profit: 9.09 }), 19.09);
  assert.equal(lib.creditOf(10, { status: 'lost', profit: -10 }), 0);
  assert.equal(lib.creditOf(10, { status: 'push', profit: 0 }), 10);
  assert.equal(lib.creditOf(10, { status: 'void', profit: 0 }), 10);
});

test('the tallies and the leaderboards: public players only, by profit, by period', () => {
  let t = lib.addToTally(null, bet(), { status: 'won', profit: 9.09 });
  t = lib.addToTally(t, bet({ start: '2026-10-05T17:00Z', stake: 20 }), { status: 'lost', profit: -20 });
  t = lib.addToTally(t, bet(), { status: 'void', profit: 0 });
  assert.deepEqual(t.all, { won: 1, lost: 1, push: 0, void: 1, staked: 30, profit: -10.91 });
  assert.deepEqual(t.days, { '2026-10-11': [1, 0, 0, 10, 9.09], '2026-10-05': [0, 1, 0, 20, -20] });
  // (Monday to Sunday, US Eastern; the season from August 1)
  const p = lib.periodsAt(Date.parse('2026-10-12T03:00Z'));
  assert.equal(p.week.from, '2026-10-05');
  assert.equal(p.season.from, '2026-08-01');
  assert.equal(p.season.label, '2026-27 season');
  assert.equal(lib.periodsAt(Date.parse('2027-03-01T12:00Z')).season.from, '2026-08-01');
  const profile = (username, betHistory = 'public', photo = null) => ({ username, displayName: username, photo, visibility: { betHistory } });
  const entries = [
    { uid: 'a', profile: profile('ace', 'public', { kind: 'upload', url: 'data:image/webp;base64,AAAA' }), tally: t },
    { uid: 'b', profile: profile('bo', 'public', { kind: 'provider', url: 'https://x/y.jpg' }), tally: { days: { '2026-10-11': [3, 0, 0, 30, 27] } } },
    { uid: 'c', profile: profile('cy', 'friends'), tally: { days: { '2026-10-11': [9, 0, 0, 90, 80] } } },
    { uid: 'd', profile: profile('di'), tally: { days: {} } },
  ];
  const week = lib.leaderboard(entries, '2026-10-06');
  assert.deepEqual(
    week.map((r) => [r.username, r.won, r.lost, r.profit]),
    [
      ['bo', 3, 0, 27],
      ['ace', 1, 0, 9.09],
    ],
  );
  // (an upload's data stays off the board; an address stays)
  assert.equal(week[1].photo, null);
  assert.deepEqual(week[0].photo, { kind: 'provider', url: 'https://x/y.jpg' });
  const all = lib.leaderboard(entries, '0000-00-00');
  assert.deepEqual(all.find((r) => r.username === 'ace'), { uid: 'a', username: 'ace', displayName: 'ace', photo: null, won: 1, lost: 1, push: 0, staked: 30, profit: -10.91, roi: -0.3637 });
});
