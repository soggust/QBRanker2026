// The bettor's pricing and grading arithmetic (libs/ranker/scripts/model): The Odds API's events read into
// the desk's lines (the vig out, Pinnacle's chance only at the desk's own line), closing-line value, the
// record, and a game called off never graded
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { american, linesFromEvent } from '../libs/ranker/scripts/model/oddsapi.mjs';
import { clvOf } from '../libs/ranker/scripts/model/clv.mjs';
import { fairPair, record } from '../libs/ranker/scripts/model/desk.mjs';
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
