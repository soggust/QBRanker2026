// The desk's betting: every market of every game (the spread, the total, the moneyline) priced with the
// model's chance for each side, the better side bet at 0.5 to 3 units by how good the price is, and each bet
// graded when its game is final. Play money: a 1,000-unit bankroll, rebought when it runs out.
//
// A side's chance: the model's (its expected margin or total and the history's spread around it), pulled
// toward the book's fair price (its two prices with the vig taken out) by how much the model has earned
// trust in that market (w: 0 the book's alone, 1 the model's alone; fit on the desk's own graded bets).

import { phi, round } from './ratings.mjs';

// (1,000 to start, so a full slate of bets leaves most of it on hand; the desk rebuys 1,000 whenever its
// balance would go under 0: the money's play money and every bet is data)
export const BANKROLL = 1000;
export const MARKETS = ['spread', 'total', 'ml'];

// American odds as the decimal payout (stake back included) and as the chance they imply
export const decimal = (american) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);
const implied = (american) => 1 / decimal(american);

// The first side's fair chance from a pair of prices (the vig taken out)
export const fairPair = (a, b) => fair(a, b)[0];

// Both sides' fair chances: the book's implied chances, the vig taken out
function fair(a, b) {
  const x = implied(a);
  const y = implied(b);
  return [x / (x + y), y / (x + y)];
}

// Units for a side: 0.5 at no edge (every game is bet), up to 3 at the desk's edge scale, by half units
export function stakeFor(ev, evScale) {
  const raw = 0.5 + Math.max(0, ev / evScale) * 2.5;
  return Math.min(3, Math.max(0.5, Math.round(raw * 2) / 2));
}

// Each market's two sides, priced: the line, the price, the model's chance, the book's fair chance (the lines'
// own fair chance of the first side where they bring one: Pinnacle's, from The Odds API; else the two prices
// with the vig taken out)
export function price(game, exp, lines, params) {
  const out = [];
  const sides = (market, a, b) => {
    if (!a.odds || !b.odds) return;
    const given = lines.fair?.[market];
    const [fa, fb] = Number.isFinite(given) ? [given, 1 - given] : fair(a.odds, b.odds);
    out.push({ market, sides: [{ ...a, fair: fa }, { ...b, fair: fb }] });
  };
  const { spread, total, ml } = lines;
  if (spread.home.line !== null && spread.away.line !== null) {
    // (home covers when its margin plus its line is over 0)
    const pHome = phi((exp.margin + spread.home.line) / params.sigma);
    sides(
      'spread',
      { side: 'home', line: spread.home.line, odds: spread.home.odds, model: pHome },
      { side: 'away', line: spread.away.line, odds: spread.away.odds, model: 1 - pHome },
    );
  }
  if (total.line !== null) {
    const pOver = 1 - phi((total.line - exp.total) / params.sigmaT);
    sides('total', { side: 'over', line: total.line, odds: total.over, model: pOver }, { side: 'under', line: total.line, odds: total.under, model: 1 - pOver });
  }
  const pWin = phi(exp.margin / params.sigma);
  sides('ml', { side: 'home', line: null, odds: ml.home, model: pWin }, { side: 'away', line: null, odds: ml.away, model: 1 - pWin });
  return out;
}

// The bet a market gets: the side with the better expected return at the desk's trust in the model (every
// market gets one), staked by that return
export function choose(market, trust, evScale) {
  const scored = market.sides.map((s) => {
    const p = s.fair + trust * (s.model - s.fair);
    return { ...s, p, ev: p * decimal(s.odds) - 1 };
  });
  const pick = scored[0].ev >= scored[1].ev ? scored[0] : scored[1];
  return { ...pick, units: stakeFor(pick.ev, evScale) };
}

// (a bet with no edge, placed for the data, or one it saw value in; bets from before the intent was kept go
// by their EV)
export const intentOf = (bet) => bet.intent ?? (bet.ev > 0 ? 'edge' : 'action');

// (a bet by how far it finished past its line, its side's way: won over 0, lost under, a push at 0; what it
// paid, its stake back not counted: settle and props.mjs settleProp)
export function outcomeOf(bet, edge) {
  const status = edge > 0 ? 'won' : edge < 0 ? 'lost' : 'push';
  const profit = status === 'won' ? bet.units * (decimal(bet.odds) - 1) : status === 'lost' ? -bet.units : 0;
  return { status, profit: round(profit, 3) };
}

// A bet's words: "DAL -8.5", "Over 47.5", "TB ML"
export function pickText(bet, game) {
  const abbr = bet.side === 'home' ? game.homeAbbr : game.awayAbbr;
  if (bet.market === 'total') return `${bet.side === 'over' ? 'Over' : 'Under'} ${bet.line}`;
  if (bet.market === 'spread') return `${abbr} ${bet.line > 0 ? '+' : ''}${bet.line}`;
  return `${abbr} ML`;
}

// A bet against its game's final: won, lost or a push, and what it paid
export function settle(bet, game) {
  const margin = game.hs - game.as;
  let edge;
  if (bet.market === 'spread') edge = (bet.side === 'home' ? margin : -margin) + bet.line;
  else if (bet.market === 'total') edge = (bet.side === 'over' ? 1 : -1) * (game.hs + game.as - bet.line);
  else edge = bet.side === 'home' ? margin : -margin;
  return { ...outcomeOf(bet, edge), final: `${game.awayAbbr} ${game.as} @ ${game.homeAbbr} ${game.hs}` };
}

// The trust in the model a market has earned: of 0 to 1.2, the one that would have made its bets' chances
// closest to what happened, less a cost for trusting it at all. Two kinds of evidence, as log-likelihoods:
// each graded bet's result (a bet whose premise broke in the game, a starter hurt or a goalie pulled, counts
// for its weight, less than 1: noise, not evidence), and each bet's closing chance (clv.mjs: the market's
// fair chance of its side at the close, its last word with everyone's money and news in it; a model whose
// chances run ahead of where the market closes is worth trusting long before enough results are in to say
// so). Until a market has 40 of the two together, the starting trust.
export function fitTrust(bets, start) {
  const decided = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  const closed = bets.filter((b) => b.clv && b.clv.q !== null && b.clv.q !== undefined && Number.isFinite(b.fair) && Number.isFinite(b.model));
  if (decided.length + closed.length < 40) return { trust: start, n: decided.length, clvN: closed.length, fitted: false };
  const n = decided.reduce((s, b) => s + (b.weight ?? 1), 0) + closed.length;
  let best = { trust: start, loss: Infinity };
  for (let t = 0; t <= 1.2001; t += 0.05) {
    let loss = 0;
    const pOf = (b) => Math.min(0.995, Math.max(0.005, b.fair + t * (b.model - b.fair)));
    for (const b of decided) loss -= (b.weight ?? 1) * Math.log(b.status === 'won' ? pOf(b) : 1 - pOf(b));
    // (the closing chance as a soft result: best matched by a chance equal to it)
    for (const b of closed) loss -= b.clv.q * Math.log(pOf(b)) + (1 - b.clv.q) * Math.log(1 - pOf(b));
    // (trusting the model has to be earned: each unit of trust costs 2 nats, so luck over a few dozen bets
    // doesn't buy it, and with no real edge the fit settles near the book)
    const penalized = loss + 2 * t * t;
    if (penalized < best.loss) best = { trust: round(t, 2), loss: penalized, raw: loss };
  }
  return { trust: best.trust, n: decided.length, clvN: closed.length, fitted: true, logLoss: round(best.raw / n, 4) };
}

// A record: won, lost, pushed, units staked and won, the return on them
export function record(bets) {
  const r = { bets: 0, won: 0, lost: 0, push: 0, staked: 0, profit: 0 };
  for (const b of bets) {
    if (b.status === 'open') continue;
    r.bets++;
    r[b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'push']++;
    r.staked += b.units;
    r.profit += b.profit;
  }
  return { ...r, staked: round(r.staked, 2), profit: round(r.profit, 2), roi: r.staked ? round(r.profit / r.staked, 4) : null };
}
