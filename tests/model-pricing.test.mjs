// The desk's game-line pricing and staking (desk.mjs, margins.mjs): the moneyline priced off the spread, pushes
// on integer lines, the margins' shape, the lean's taper and the gap guard, the Kelly stake, one side of a game,
// the game's cap, the line-move guard's direction, and the trust fit's weights.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP, capGame, choose, decimal, fairPair, fitTrust, gapGuard, guardOf, leanOf, oneSide, price, stakeFor } from '../libs/ranker/scripts/model/desk.mjs';
import { atLine, cond, fitMargins, impliedMean, marginDist, mlChances, probit, spreadChances } from '../libs/ranker/scripts/model/margins.mjs';
import { clvOf } from '../libs/ranker/scripts/model/clv.mjs';
import { phi } from '../libs/ranker/scripts/model/ratings.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const lines = (over = {}) => ({
  spread: { home: { line: -3, odds: -110 }, away: { line: 3, odds: -110 } },
  total: { line: 44.5, over: -110, under: -110 },
  ml: { home: -165, away: 140 },
  ...over,
});
const params = { sigma: 13.5, sigmaT: 13.5 };

test('probit: the normal CDF inverted', () => {
  for (const p of [0.01, 0.2, 0.5, 0.77, 0.99]) near(phi(probit(p)), p, 1e-6);
});

test('marginDist: whole numbers adding to 1; no ties where the sport has none', () => {
  const d = marginDist(2.5, 13.5);
  near(d.p.reduce((s, x) => s + x, 0), 1, 1e-9);
  const nhl = mlChances(0.3, 2.3, { ties: false });
  assert.equal(nhl.push, 0);
  near(nhl.win + nhl.lose, 1, 1e-9);
  // (the better side takes a bit over half of the tie's mass)
  assert.ok(nhl.win > 0.5);
});

test('price: the model agreeing with the spread gives the fair moneyline, no edge on either side', () => {
  const l = lines();
  const fSpread = fairPair(-110, -110);
  const shape = { ties: true, w: { 3: 1.9, 7: 1.4, 0: 0.4 } };
  const m = impliedMean((x) => cond(spreadChances(x, -3, params.sigma, shape)), fSpread, 3, params.sigma);
  const priced = price({}, { margin: m, total: 44.5 }, l, params, shape);
  const ml = priced.find((x) => x.market === 'ml');
  const spread = priced.find((x) => x.market === 'spread');
  near(ml.sides[0].model, ml.sides[0].fair, 1e-6);
  near(spread.sides[0].model, spread.sides[0].fair, 1e-6);
  const pick = choose(ml, 1, 0.08);
  assert.ok(pick.ev <= 0 && pick.other.ev <= 0, `ml ev ${pick.ev} / ${pick.other.ev}`);
  assert.equal(pick.units, 0.5);
  // (the old way, the margin's normal alone, leaned to the underdog: a 7-point favorite at -330)
  const l7 = lines({ spread: { home: { line: -7, odds: -110 }, away: { line: 7, odds: -110 } }, ml: { home: -330, away: 265 } });
  const m7 = impliedMean((x) => cond(spreadChances(x, -7, params.sigma, shape)), 0.5, 7, params.sigma);
  const ml7 = price({}, { margin: m7, total: 44.5 }, l7, params, shape).find((x) => x.market === 'ml');
  near(ml7.sides[1].model, ml7.sides[1].fair, 1e-6);
  assert.ok(1 - phi(m7 / params.sigma) > ml7.sides[1].fair + 0.02);
});

test('price: an integer line has a push; its EV counts only the rest', () => {
  const priced = price({}, { margin: 3, total: 44 }, lines({ total: { line: 44, over: -110, under: -110 } }), params, { ties: true, w: null });
  const spread = priced.find((x) => x.market === 'spread');
  const total = priced.find((x) => x.market === 'total');
  assert.ok(spread.sides[0].push > 0.02 && total.sides[0].push > 0.02);
  const pick = choose(spread, 1, 0.08);
  near(pick.ev, (1 - pick.push) * (pick.p * decimal(pick.odds) - 1), 1e-12);
  // (a half-point line, none)
  const half = price({}, { margin: 3, total: 44 }, lines(), params, null).find((x) => x.market === 'total');
  assert.equal(half.sides[0].push, 0);
});

test('fitMargins: a key number the history shows is weighted up, and kept for the held-out games', () => {
  // (made-up finals: a normal margin, but a third of the ones near 3 land on it)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const games = [];
  const exp = new Map();
  for (let i = 0; i < 3000; i++) {
    const m = (rnd() - 0.5) * 10;
    let k = Math.round(m + 13.5 * probit(rnd()));
    if (Math.abs(Math.abs(k) - 3) <= 2 && rnd() < 0.35) k = Math.sign(k || 1) * 3;
    const id = String(i);
    games.push({ id, date: `2020-01-01T00:00:${String(i).padStart(6, '0')}`, final: true, hs: 20 + Math.max(0, k), as: 20 + Math.max(0, -k) });
    exp.set(id, { margin: m });
  }
  const fit = fitMargins('nfl', games, exp, 13.5);
  assert.equal(fit.kept, true);
  assert.ok(fit.gain > 0);
  assert.ok(fit.w[3] > 1.5 && fit.w[3] > fit.w[8], `w3 ${fit.w[3]}`);
  // (too few finals: the base)
  assert.equal(fitMargins('nfl', games.slice(0, 100), exp, 13.5).kept, false);
  assert.equal(fitMargins('nhl', [], new Map(), 2.3).ties, false);
});

test("leanOf and gapGuard: the model's lean tapers past half the gap, nothing at it; past it the market isn't bet", () => {
  assert.equal(leanOf(0.03, 0.12), 0.03);
  near(leanOf(0.06, 0.12), 0.06);
  near(leanOf(0.09, 0.12), 0.03);
  near(leanOf(-0.12, 0.12), 0);
  assert.equal(gapGuard('spread', 0.6, 0.5), null);
  assert.equal(gapGuard('spread', 0.63, 0.5).skip, true);
  assert.equal(gapGuard('ml', 0.63, 0.5), null);
  assert.ok(GAP.ml > GAP.spread);
  // (the biggest disagreement can't buy a big edge: its trusted chance leans no further than half the gap)
  const market = { market: 'spread', sides: [{ side: 'home', odds: -110, fair: 0.5, model: 0.61 }, { side: 'away', odds: -110, fair: 0.5, model: 0.39 }] };
  assert.ok(choose(market, 1, 0.08).p < 0.5 + GAP.spread / 2);
});

test('stakeFor: by the Kelly fraction, a long price staking less for the same return', () => {
  assert.equal(stakeFor(0.08, 0.08, -110), 3);
  assert.equal(stakeFor(0.08, 0.08), 3);
  assert.equal(stakeFor(-0.02, 0.08, -110), 0.5);
  assert.ok(stakeFor(0.08, 0.08, 400) <= 1);
  assert.ok(stakeFor(0.04, 0.08, -250) > stakeFor(0.04, 0.08, -110));
  for (const odds of [-400, -110, 120, 900]) for (let ev = -0.1; ev < 0.4; ev += 0.01) {
    const u = stakeFor(ev, 0.08, odds);
    assert.ok(u >= 0.5 && u <= 3 && Number.isInteger(u * 2));
  }
});

test('oneSide: the spread and the moneyline never on the same side of a game', () => {
  const side = (s, ev) => ({ side: s, ev });
  const pick = (s, ev, otherEv) => ({ ...side(s, ev), other: side(s === 'home' ? 'away' : 'home', otherEv) });
  // (both new on home: the better return keeps it; the other's other side has no edge, so it isn't bet)
  let out = oneSide([{ market: 'spread', pick: pick('home', 0.05, -0.08) }, { market: 'ml', pick: pick('home', 0.02, -0.06) }]);
  assert.equal(out[0].drop, undefined);
  assert.ok(out[1].drop);
  // (the other side with an edge: taken)
  out = oneSide([{ market: 'spread', pick: pick('home', 0.05, -0.08) }, { market: 'ml', pick: pick('home', 0.02, 0.01) }]);
  assert.equal(out[1].pick.side, 'away');
  assert.equal(out[1].flipped, true);
  // (a new moneyline against a spread already placed on its side gives way)
  out = oneSide([{ market: 'ml', pick: pick('away', 0.09, -0.1) }], [{ market: 'spread', side: 'away' }]);
  assert.ok(out[0].drop);
  // (opposite sides, or a total: untouched)
  out = oneSide([{ market: 'spread', pick: pick('home', 0.05, -0.08) }, { market: 'ml', pick: pick('away', 0.02, -0.06) }, { market: 'total', pick: pick('over', 0.1, -0.1) }]);
  assert.ok(out.every((x) => !x.drop && !x.flipped));
});

test("capGame: a game's units at most the cap, scaled alike, the least worth having dropped", () => {
  const b = (id, units, ev, intent = ev > 0 ? 'edge' : 'action') => ({ id, units, ev, intent });
  let res = capGame([b('a', 3, 0.08), b('b', 2, 0.04)], 0, 5);
  assert.deepEqual(res.kept.map((x) => x.units), [3, 2]);
  res = capGame([b('a', 3, 0.08), b('b', 3, 0.06), b('c', 0.5, -0.02)], 1, 5);
  const sum = res.kept.reduce((t, x) => t + x.units, 0);
  assert.ok(sum <= 4);
  assert.equal(res.dropped.at(-1)?.id ?? 'c', 'c');
  assert.ok(res.kept.some((x) => x.cappedFrom === 3));
  // (no room left: nothing new)
  res = capGame([b('a', 1, 0.02)], 5, 5);
  assert.deepEqual([res.kept.length, res.dropped.length], [0, 1]);
});

test('guardOf: only a move against the side counts; toward it the market is agreeing', () => {
  const limits = { spread: 1.5, total: 2, ml: 0.06 };
  // (the home spread from -3 to -5: the market moving toward home)
  const move = { spread: -2 };
  assert.equal(guardOf(limits, 'spread', move, [], { m: 0, t: 0 }, 13.5, 'home'), null);
  assert.ok(guardOf(limits, 'spread', move, [], { m: 0, t: 0 }, 13.5, 'away').why.includes('against it'));
  assert.equal(guardOf(limits, 'spread', { spread: 3.5 }, [], { m: 0, t: 0 }, 13.5, 'home').skip, true);
  assert.equal(guardOf(limits, 'total', { total: 2.5 }, [], { m: 0, t: 0 }, 13.5, 'over'), null);
  assert.ok(guardOf(limits, 'total', { total: 2.5 }, [], { m: 0, t: 0 }, 13.5, 'under'));
  // (no side: either way counts, as before)
  assert.ok(guardOf(limits, 'spread', move, [], { m: 0, t: 0 }, 13.5));
  // (a flag still cuts it)
  assert.ok(guardOf(limits, 'spread', move, ['QB questionable'], { m: 0, t: 0 }, 13.5, 'home'));
});

test('fitTrust: at most 1; a bet with a result and a close counts once; a game\'s bets count as one', () => {
  const bet = (i, event, won) => ({ event, status: won ? 'won' : 'lost', fair: 0.5, model: won ? 0.6 : 0.4 });
  // (a model that's always right: trust capped at 1)
  const right = Array.from({ length: 400 }, (_, i) => bet(i, String(i), i % 2 === 0));
  assert.equal(fitTrust(right, 0.5).trust, 1);
  // (40 bets on one game weigh as about 3: the same results on 40 games earn far more trust)
  const one = fitTrust(Array.from({ length: 40 }, (_, i) => bet(i, 'g', i % 2 === 0)), 0.3);
  const apart = fitTrust(Array.from({ length: 40 }, (_, i) => bet(i, String(i), i % 2 === 0)), 0.3);
  near(one.eff, 3.1, 0.051);
  assert.equal(apart.eff, 40);
  assert.ok(one.fitted && one.trust < apart.trust, `${one.trust} vs ${apart.trust}`);
  // (25 bets with both a result and a close: 25 bets' worth, not 50)
  const both = Array.from({ length: 25 }, (_, i) => ({ ...bet(i, String(i), true), clv: { q: 0.55 } }));
  assert.equal(fitTrust(both, 0.5).fitted, false);
});

test("clvOf with the margins: a half point onto the NFL's 3 is worth more than one onto the 8", () => {
  const shape = { ties: true, w: { 3: 2, 7: 1.4 } };
  const dist = { sigma: 13.5, sigmaT: 13.5, shape };
  const onto3 = clvOf({ market: 'spread', side: 'home', line: -2.5, odds: -110, fair: 0.5 }, { line: -3, odds: -110, fair: 0.5 }, 13.5, dist);
  const onto8 = clvOf({ market: 'spread', side: 'home', line: -7.5, odds: -110, fair: 0.5 }, { line: -8, odds: -110, fair: 0.5 }, 13.5, dist);
  assert.ok(onto3.prob > onto8.prob && onto8.prob > 0, `${onto3.prob} vs ${onto8.prob}`);
  // (the same line: the close's own chance)
  near(atLine('spread', 'away', { line: 3, fair: 0.47 }, 3, dist), 0.47, 1e-6);
});
