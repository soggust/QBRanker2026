// The bettor's pricing and grading arithmetic (libs/ranker/scripts/model): The Odds API's events read into
// the desk's lines (the vig out, Pinnacle's chance only at the desk's own line), closing-line value, the
// record, and a game called off never graded: void, as DraftKings has it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { american, linesFromEvent } from '../libs/ranker/scripts/model/oddsapi.mjs';
import { clvOf } from '../libs/ranker/scripts/model/clv.mjs';
import { VOID_AFTER, fairPair, fitTrust, record, settle, voidOf } from '../libs/ranker/scripts/model/desk.mjs';
import { gameOf } from '../libs/ranker/scripts/model/espn.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('american: decimal odds as American, even money +100', () => {
  assert.equal(american(2), 100);
  assert.equal(american(2.5), 150);
  assert.equal(american(1.5), -200);
  assert.equal(american(1.909), -110);
});

test('fairPair: the vig taken out, the two sides adding to 1', () => {
  near(fairPair(-110, -110), 0.5);
  near(fairPair(-200, 170) + fairPair(170, -200), 1);
  assert.ok(fairPair(-200, 170) > 0.6);
});

const outcomes = (home, away, a, b, point = null) => ({ outcomes: [{ name: home, price: a, ...(point === null ? {} : { point }) }, { name: away, price: b, ...(point === null ? {} : { point: -point }) }] });
const event = (pinSpread) => ({
  home_team: 'Dallas Cowboys',
  away_team: 'Tampa Bay Buccaneers',
  bookmakers: [
    {
      key: 'draftkings',
      markets: [
        { key: 'h2h', ...outcomes('Dallas Cowboys', 'Tampa Bay Buccaneers', 1.5, 2.6) },
        { key: 'spreads', ...outcomes('Dallas Cowboys', 'Tampa Bay Buccaneers', 1.91, 1.91, -3.5) },
        { key: 'totals', outcomes: [{ name: 'Over', price: 1.87, point: 47.5 }, { name: 'Under', price: 1.95, point: 47.5 }] },
      ],
    },
    { key: 'pinnacle', markets: [{ key: 'spreads', ...outcomes('Dallas Cowboys', 'Tampa Bay Buccaneers', 2.0, 1.83, pinSpread) }] },
  ],
});

test("linesFromEvent: the desk's book's lines and prices, Pinnacle's fair chance only at the same line", () => {
  const same = linesFromEvent(event(-3.5));
  assert.equal(same.spreads.line, -3.5);
  assert.deepEqual(same.spreads.prices, { home: american(1.91), away: american(1.91) });
  near(same.spreads.fair, same.spreads.sharp);
  assert.ok(same.spreads.sharp < 0.5, "Pinnacle's home price is the longer: under half");
  near(same.spreads.own, 0.5);
  // (a different line at Pinnacle: the book's own, de-vigged)
  const moved = linesFromEvent(event(-3));
  assert.equal(moved.spreads.sharp, null);
  near(moved.spreads.fair, 0.5);
  // (no Pinnacle total: the book's own; the over the first side)
  assert.equal(moved.totals.line, 47.5);
  assert.ok(moved.totals.fair > 0.5);
  assert.ok(moved.h2h.fair > 0.6);
  assert.equal(linesFromEvent({ ...event(-3.5), bookmakers: [] }), null);
});

test('clvOf: points better than the close, its own side\'s way; the closing chance carried to its line', () => {
  const close = { line: -4.5, odds: -110, fair: 0.5 };
  const home = clvOf({ market: 'spread', side: 'home', line: -3.5, odds: -110, fair: 0.5 }, close, 13.5);
  assert.equal(home.pts, 1);
  assert.ok(home.prob > 0 && home.ev > 0);
  assert.equal(home.beat, true);
  const over = clvOf({ market: 'total', side: 'over', line: 48.5, odds: -110, fair: 0.5 }, { line: 47.5, odds: -110, fair: 0.5 }, 13.5);
  assert.equal(over.pts, -1);
  assert.equal(over.beat, false);
  const ml = clvOf({ market: 'ml', side: 'home', line: null, odds: 150, fair: 0.4 }, { line: null, odds: 120, fair: 0.44 }, 13.5);
  assert.equal(ml.pts, null);
  near(ml.prob, 0.04);
  assert.equal(ml.beat, true);
  assert.equal(clvOf({ market: 'ml' }, null, 13.5), null);
});

test("record: a void prop (he didn't play) isn't staked, won, lost or pushed", () => {
  const r = record([
    { status: 'won', units: 1, profit: 0.91 },
    { status: 'lost', units: 2, profit: -2 },
    { status: 'push', units: 1, profit: 0 },
    { status: 'push', units: 1, profit: 0, void: true },
    { status: 'open', units: 3, profit: 0 },
  ]);
  assert.deepEqual({ bets: r.bets, won: r.won, lost: r.lost, push: r.push, staked: r.staked }, { bets: 3, won: 1, lost: 1, push: 1, staked: 4 });
  near(r.roi, -1.09 / 4, 1e-4);
});

test('gameOf: a final has its score; a game called off is never final, whatever the flag says', () => {
  const e = (name, completed) => ({
    id: '1',
    date: '2026-10-09T23:00Z',
    competitions: [{ status: { type: { name, completed } }, competitors: [{ homeAway: 'home', score: '0', team: { id: '1', abbreviation: 'A' } }, { homeAway: 'away', score: '0', team: { id: '2', abbreviation: 'B' } }] }],
  });
  assert.equal(gameOf(e('STATUS_FINAL', true)).final, true);
  assert.equal(gameOf(e('STATUS_FINAL', true)).hs, 0);
  for (const name of ['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_SUSPENDED']) {
    const g = gameOf(e(name, true));
    assert.equal(g.final, false, name);
    assert.equal(g.hs, null, name);
  }
});

// ---------------------------------------------------------------------------
// A bet on a game called off: void (desk.mjs voidOf), a void prop's own shape
// ---------------------------------------------------------------------------

const START = '2026-10-04T17:00:00Z';
const H = 36e5;
const at = (hours) => Date.parse(START) + hours * H;
const spread = { market: 'spread', side: 'home', line: -3, odds: -110, units: 2, start: START };
const game = (extra) => ({ id: '9', date: START, homeAbbr: 'DAL', awayAbbr: 'TB', final: false, hs: null, as: null, ...extra });
const VOID = { status: 'push', profit: 0, void: true };

test('gameOf: a game called off keeps why (postponed, suspended, canceled, forfeit); one played has none', () => {
  const e = (name, completed) => ({ id: '1', date: START, competitions: [{ status: { type: { name, completed } }, competitors: [{ homeAway: 'home', team: { id: '1' } }, { homeAway: 'away', team: { id: '2' } }] }] });
  assert.equal(gameOf(e('STATUS_POSTPONED', false)).off, 'postponed');
  assert.equal(gameOf(e('STATUS_SUSPENDED', false)).off, 'suspended');
  assert.equal(gameOf(e('STATUS_CANCELED', true)).off, 'canceled');
  assert.equal(gameOf(e('STATUS_CANCELLED', true)).off, 'canceled');
  assert.equal(gameOf(e('STATUS_FORFEIT', true)).off, 'forfeit');
  assert.equal('off' in gameOf(e('STATUS_FINAL', true)), false);
});

test('voidOf: a canceled game (or a forfeit) voids its bets as soon as a run sees it', () => {
  for (const off of ['canceled', 'forfeit']) {
    const v = voidOf(spread, game({ off }), at(-1));
    assert.deepEqual({ status: v.status, profit: v.profit, void: v.void }, VOID, off);
    assert.equal(v.final, off);
  }
  // (a prop's void has no stat, as a player who didn't play)
  assert.equal(voidOf({ ...spread, market: 'prop' }, game({ off: 'canceled' }), at(1)).actual, null);
});

test('voidOf: a game postponed or suspended stays open inside 48 hours of its start', () => {
  assert.equal(VOID_AFTER, 48 * H);
  for (const off of ['postponed', 'suspended']) {
    assert.equal(voidOf(spread, game({ off }), at(2)), null, off);
    assert.equal(voidOf(spread, game({ off }), at(47.9)), null, off);
  }
  // (a game moved a day, no word why: open)
  assert.equal(voidOf(spread, game({ date: '2026-10-05T17:00:00Z' }), at(30)), null);
  // (a game simply not final yet, nothing called off: open, whenever)
  assert.equal(voidOf(spread, game(), at(100)), null);
  assert.equal(voidOf(spread, undefined, at(100)), null);
});

test('voidOf: postponed or suspended and no final 48 hours after the start: void', () => {
  for (const off of ['postponed', 'suspended']) {
    const v = voidOf(spread, game({ off }), at(48.5));
    assert.deepEqual({ status: v.status, profit: v.profit, void: v.void }, VOID, off);
    assert.match(v.why, /^Void: game /);
  }
  // (seen put off on an earlier run, the game since showing nothing: void all the same)
  assert.equal(voidOf({ ...spread, off: 'postponed' }, game(), at(49)).void, true);
  // (moved past the 48 hours with no word of it: a postponement)
  assert.equal(voidOf(spread, game({ date: '2026-10-07T17:00:00Z' }), at(49)).void, true);
});

test('voidOf: postponed, then played within 48 hours: graded on its final as usual', () => {
  const played = game({ date: '2026-10-05T17:00:00Z', final: true, hs: 24, as: 17 });
  const bet = { ...spread, off: 'postponed' };
  assert.equal(voidOf(bet, played, at(30)), null);
  assert.deepEqual(settle(bet, played), { status: 'won', profit: 1.818, final: 'TB 17 @ DAL 24' });
  // (played past the 48 hours, or its final first seen after them: void, not graded)
  assert.equal(voidOf(spread, game({ date: '2026-10-06T19:00:00Z', final: true, hs: 24, as: 17 }), at(60)).void, true);
  assert.equal(voidOf(bet, played, at(50)).void, true);
  // (never put off, its final read late: graded)
  assert.equal(voidOf(spread, game({ final: true, hs: 24, as: 17 }), at(200)), null);
});

test('a void game bet: out of the record, the ROI and the trust fit, its stake back', () => {
  const voided = { ...spread, ...voidOf(spread, game({ off: 'canceled' }), at(1)), clv: { q: 0.6 }, fair: 0.5, model: 0.55 };
  const graded = [
    { status: 'won', units: 1, profit: 0.91 },
    { status: 'lost', units: 2, profit: -2 },
  ];
  assert.deepEqual(record([...graded, voided]), record(graded));
  assert.equal(record([voided]).roi, null);
  const fit = fitTrust([voided], 0.3);
  assert.deepEqual([fit.n, fit.clvN], [0, 0]);
});
