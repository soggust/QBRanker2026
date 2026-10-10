// The desk's betting: every market of every game (the spread, the total, the moneyline) priced with the
// model's chance for each side, the better side bet at 0.5 to 3 units by how good the price is, and each bet
// graded when its game is final. Play money: a 1,000-unit bankroll, rebought when it runs out.
//
// A side's chance: the model's (margins.mjs: its expected margin or total and the history's spread around it,
// as whole numbers, the margins' shape and pushes and all; the moneyline's priced off the spread market's, so
// a model agreeing with the spread is the fair moneyline), pulled toward the book's fair price (its two prices
// with the vig taken out) by how much the model has earned trust in that market (w: 0 the book's alone, 1 the
// model's alone; fit on the desk's own graded bets). The lean is the model's less the book's, but past half
// of GAP it tapers to nothing at GAP (a disagreement that size is the market knowing something the model
// doesn't far more often than an edge), and past GAP the market isn't bet at all (gapGuard).
// Its stake: by its Kelly fraction, its expected return over what a unit pays (a long shot's edge stakes less
// than the same edge at -110), 0.5 at no edge up to 3 (stakeFor); a game's whole stake, every market and prop,
// at most leagues.mjs GAME_CAP (capGame); the spread and the moneyline never on the same side of a game
// (oneSide).

import { round } from './ratings.mjs';
import { cond, mlModel, spreadChances, totalChances } from './margins.mjs';

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

// (the most the model's chance may be from the book's fair chance, by market, before the market isn't bet: the
// lean tapers from half of it; leanOf, gapGuard)
export const GAP = { spread: 0.12, total: 0.12, ml: 0.15 };

// Units for a side, by its Kelly fraction (its expected return over what a unit pays at its price): 0.5 at no
// edge (every game is bet), up to 3 at the desk's edge scale (the return that tops out at -110; a longer price
// needs a bigger return for the same stake, a shorter one less), by half units
const REF = 100 / 110;
export function stakeFor(ev, evScale, odds = -110) {
  const b = decimal(Number.isFinite(odds) && odds ? odds : -110) - 1;
  const raw = 0.5 + (Math.max(0, ev) / b / (evScale / REF)) * 2.5;
  return Math.min(3, Math.max(0.5, Math.round(raw * 2) / 2));
}

// The model's lean on a side (its chance less the book's fair chance), tapered: whole to half of the market's
// GAP, then less and less, nothing at GAP (and past it the market isn't bet)
export function leanOf(gap, limit) {
  if (!limit) return gap;
  const a = Math.abs(gap);
  const half = limit / 2;
  if (a <= half) return gap;
  return Math.sign(gap) * half * Math.max(0, (limit - a) / (limit - half));
}

// Why a market isn't bet for its model's distance from the book (skip), or null
export function gapGuard(market, model, fair) {
  const limit = GAP[market];
  if (!limit || !Number.isFinite(model) || !Number.isFinite(fair) || Math.abs(model - fair) <= limit) return null;
  return { skip: true, why: `the model's ${Math.round(model * 100)}% against the book's ${Math.round(fair * 100)}%: too far from the market to trust` };
}

// Each market's two sides, priced: the line, the price, the model's chance (a push left out: margins.mjs cond)
// and its push, the book's fair chance (the lines' own fair chance of the first side where they bring one:
// Pinnacle's, from The Odds API; else the two prices with the vig taken out). shape: the margins' (margins.mjs
// fitMargins; none, the plain normal cut into whole numbers)
export function price(game, exp, lines, params, shape = null) {
  const out = [];
  const fairOf = (market, a, b) => {
    const given = lines.fair?.[market];
    return Number.isFinite(given) ? given : fair(a, b)[0];
  };
  const both = (market, a, b, fa) => out.push({ market, sides: [{ ...a, fair: fa }, { ...b, fair: 1 - fa }] });
  const { spread, total, ml } = lines;
  let spreadHome = null;
  if (spread.home.line !== null && spread.away.line !== null && spread.home.odds && spread.away.odds) {
    // (home covers when its margin plus its line is over 0; away the same with its own: the shape is the same
    // both ways)
    const h = spreadChances(exp.margin, spread.home.line, params.sigma, shape);
    const a = spreadChances(-exp.margin, spread.away.line, params.sigma, shape);
    const f = fairOf('spread', spread.home.odds, spread.away.odds);
    spreadHome = { line: spread.home.line, fair: f };
    both(
      'spread',
      { side: 'home', line: spread.home.line, odds: spread.home.odds, model: cond(h), push: h.push },
      { side: 'away', line: spread.away.line, odds: spread.away.odds, model: cond(a), push: a.push },
      f,
    );
  }
  if (total.line !== null && total.over && total.under) {
    const c = totalChances(exp.total, total.line, params.sigmaT);
    both('total', { side: 'over', line: total.line, odds: total.over, model: cond(c), push: c.push }, { side: 'under', line: total.line, odds: total.under, model: 1 - cond(c), push: c.push }, fairOf('total', total.over, total.under));
  }
  if (ml.home && ml.away) {
    // (off the spread market where it has one: margins.mjs mlModel)
    const f = fairOf('ml', ml.home, ml.away);
    const c = mlModel(exp.margin, params.sigma, shape, f, spreadHome);
    both('ml', { side: 'home', line: null, odds: ml.home, model: cond(c), push: c.push }, { side: 'away', line: null, odds: ml.away, model: 1 - cond(c), push: c.push }, f);
  }
  return out;
}

// The bet a market gets: the side with the better expected return at the desk's trust in the model (every
// market gets one; the lean tapered by leanOf), staked by its Kelly fraction; the other side's, scored the
// same, beside it (other: oneSide)
export function choose(market, trust, evScale) {
  const scored = market.sides.map((s) => {
    const p = s.fair + trust * leanOf(s.model - s.fair, GAP[market.market]);
    // (a push gives the stake back: only the rest of the chance is won or lost)
    const ev = (1 - (s.push ?? 0)) * (p * decimal(s.odds) - 1);
    return { ...s, p, ev, units: stakeFor(ev, evScale, s.odds) };
  });
  const [a, b] = scored;
  const pick = a.ev >= b.ev ? a : b;
  return { ...pick, other: pick === a ? b : a };
}

// The spread and the moneyline never on the same side of one game (the two win together: one bet twice).
// picks: this run's for the game ({ market, pick }); placed: its open bets already placed. Of two new on the
// same side, the better return keeps it; a new one against a placed one gives way. The one giving way takes
// the other side if that has an edge (its pick replaced, flipped), else isn't bet (drop: why)
export function oneSide(picks, placed = []) {
  const s = picks.find((x) => x.market === 'spread');
  const m = picks.find((x) => x.market === 'ml');
  const sideOf = (market) => placed.find((b) => b.market === market)?.side;
  let loser = null;
  if (s && m && s.pick.side === m.pick.side) loser = s.pick.ev >= m.pick.ev ? m : s;
  else if (s && sideOf('ml') === s.pick.side) loser = s;
  else if (m && sideOf('spread') === m.pick.side) loser = m;
  if (!loser) return picks;
  const other = loser.pick.other;
  return picks.map((x) => {
    if (x !== loser) return x;
    if (other && other.ev > 0) return { ...x, pick: { ...other, other: x.pick }, flipped: true };
    return { ...x, drop: `the ${x.market === 'ml' ? 'spread' : 'moneyline'} has its side already, and the other side has no edge` };
  });
}

// A game's new bets under its cap: the units already open on it (placed) and the new ones' at most cap; over
// it, the new ones scaled down alike (by half units, 0.5 the least), then the least worth having dropped (an
// action bet before an edge one, an action prop before an action game market (the main markets' data teach
// their trust and CLV), the smaller return first). Each bet: { units, ev, intent, market }; kept (at its
// units; cappedFrom, what it would have staked) and dropped
export function capGame(bets, placed, cap) {
  const rank = (b) => (b.intent === 'edge' ? 0 : b.market === 'prop' ? 2 : 1);
  const order = [...bets].sort((a, b) => rank(a) - rank(b) || b.ev - a.ev);
  const room = cap - placed;
  const sum = order.reduce((t, b) => t + b.units, 0);
  if (sum <= room + 1e-9) return { kept: order, dropped: [] };
  const scale = Math.max(0, room) / sum;
  const kept = [];
  const dropped = [];
  let used = 0;
  for (const b of order) {
    const units = Math.max(0.5, Math.floor(b.units * scale * 2) / 2);
    if (used + units <= room + 1e-9) {
      kept.push(units === b.units ? b : { ...b, units, cappedFrom: b.units });
      used += units;
    } else dropped.push(b);
  }
  return { kept, dropped };
}

// The guard for a market: why to cut its stake (or skip it), or null
// Only a move against the bet's side counts (the market's money on the other side: steam); one toward it is
// the market agreeing, and isn't held against it. A move the model's own context explains (it saw the backup
// QB the line moved for, and moved its number the same way) doesn't count against the bet either: only what's
// left of the move once the context's shift is taken off it does. A context shift the other way explains
// nothing. Each in the line's own units: the home side's points (a home spread moving down is the market
// moving toward home), the total's points, the moneyline's home chance (its points through the margin spread:
// a chance near even moves about 0.4 / sigma a point). side: the bet's (none: a move either way counts)
export function guardOf(limits, market, move, flags, adj = { m: 0, t: 0 }, sigma = null, side = null) {
  const limit = limits?.[market];
  const moved = move?.[market];
  if (limit && moved !== null && moved !== undefined && moved !== 0) {
    const toPoints = market === 'ml' ? (sigma ? sigma / 0.4 : null) : 1;
    // (the market's move and the context's shift, both as points toward home / onto the total)
    const market_ = market === 'spread' ? -moved : market === 'total' ? moved : toPoints ? moved * toPoints : null;
    // (the move's way, and the bet's: home or over +1, away or under -1)
    const way = Math.sign(market_ ?? moved);
    const mine = side === 'home' || side === 'over' ? 1 : side === 'away' || side === 'under' ? -1 : 0;
    if (!mine || way !== mine) {
      const shift = market === 'total' ? adj.t : adj.m;
      const explained = market_ !== null && Math.sign(shift) === Math.sign(market_) ? Math.min(Math.abs(shift), Math.abs(market_)) : 0;
      const left = market_ === null ? Math.abs(moved) : (Math.abs(market_) - explained) / (toPoints ?? 1);
      if (left >= limit) {
        const why = `line moved ${moved > 0 ? '+' : ''}${moved} since it opened${mine ? ', against it' : ''}${explained ? ` (${round(explained, 1)} of it explained by the context)` : ''}`;
        return left >= 2 * limit ? { skip: true, why } : { why };
      }
    }
  }
  if (flags.length) return { why: flags.join('; ') };
  return null;
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

// A bet against its game's final: won, lost or a push, and what it paid. An MLB game shortened (rain: called
// before 9 innings, or 8 and a half with the home side ahead; espn.mjs gameOf's short) is official, so its
// moneyline stands, but DraftKings voids its run line and total: no action, stake back
export function settle(bet, game) {
  if (game.short && (bet.market === 'spread' || bet.market === 'total')) {
    const final = `${game.awayAbbr} ${game.as} @ ${game.homeAbbr} ${game.hs} (${game.short} innings)`;
    return { status: 'push', profit: 0, void: true, final, why: `Void: game shortened to ${game.short} innings` };
  }
  const margin = game.hs - game.as;
  let edge;
  if (bet.market === 'spread') edge = (bet.side === 'home' ? margin : -margin) + bet.line;
  else if (bet.market === 'total') edge = (bet.side === 'over' ? 1 : -1) * (game.hs + game.as - bet.line);
  else edge = bet.side === 'home' ? margin : -margin;
  return { ...outcomeOf(bet, edge), final: `${game.awayAbbr} ${game.as} @ ${game.homeAbbr} ${game.hs}` };
}

// (DraftKings' rule for a game called off, the desk's book: a bet on one canceled, or forfeit, is void as soon
// as a run sees it; one postponed or suspended stands only if the game's played to its final within 48 hours
// of the start it was bet on, else it's void too. A game moved more than 48 hours with no word of it is a
// postponement; one seen called off whose final no run saw inside the 48 hours counts as finished after them)
export const VOID_AFTER = 48 * 36e5;

// A bet's void, if its game was called off (a void prop's own: a push, its stake back, no action, out of the
// record, the ROI and the trust fit); null for one still open or to be graded on its final
export function voidOf(bet, game, now) {
  if (!game) return null;
  const start = Date.parse(bet.start);
  const late = now - start > VOID_AFTER;
  const moved = Date.parse(game.date) - start > VOID_AFTER;
  let why = null;
  if (game.off === 'canceled' || game.off === 'forfeit') why = game.off;
  else if (game.final) why = moved || (bet.off && late) ? 'not played within 48 hours' : null;
  else if (late && (game.off || bet.off || moved)) why = `${game.off ?? bet.off ?? 'postponed'}, not played within 48 hours`;
  if (!why) return null;
  return { status: 'push', profit: 0, void: true, ...(bet.market === 'prop' ? { actual: null } : {}), final: why, why: `Void: game ${why}` };
}

// The trust in the model a market has earned: of 0 to 1 (never more than the model's own chance), the one that
// would have made its bets' chances closest to what happened, less a cost for trusting it at all. Two kinds of
// evidence, as log-likelihoods: each graded bet's result (a bet whose premise broke in the game, a starter hurt
// or a goalie pulled, counts for its weight, less than 1: noise, not evidence), and each bet's closing chance
// (clv.mjs: the market's fair chance of its side at the close, its last word with everyone's money and news in
// it; a model whose chances run ahead of where the market closes is worth trusting long before enough results
// are in to say so; a void bet, no action, is neither). A bet with both counts once, half each; and a game's
// n bets count less each, 1 / (1 + (n - 1)·RHO) (the props of one game share its pace and its script: the
// design effect of bets that correlated, so 10 on one game weigh as about 2.7; eff, the bets' worth all told).
// Until a market has 40 bets with either, the starting trust.
const RHO = 0.3;
export function fitTrust(bets, start) {
  const decided = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  const closed = bets.filter((b) => !b.void && b.clv && b.clv.q !== null && b.clv.q !== undefined && Number.isFinite(b.fair) && Number.isFinite(b.model));
  const isDecided = new Set(decided);
  const isClosed = new Set(closed);
  const all = new Set([...decided, ...closed]);
  const perGame = new Map();
  const gameOf = (b) => b.event ?? b.id;
  for (const b of all) perGame.set(gameOf(b), (perGame.get(gameOf(b)) ?? 0) + 1);
  const share = (b) => 1 / (1 + ((perGame.get(gameOf(b)) ?? 1) - 1) * RHO);
  const eff = round([...all].reduce((s, b) => s + share(b), 0), 1);
  if (all.size < 40) return { trust: start, n: decided.length, clvN: closed.length, eff, fitted: false };
  // (each piece of evidence's weight: its game's share, halved where the bet has the other kind too)
  const wResult = (b) => (b.weight ?? 1) * share(b) * (isClosed.has(b) ? 0.5 : 1);
  const wClose = (b) => share(b) * (isDecided.has(b) ? 0.5 : 1);
  const n = decided.reduce((s, b) => s + wResult(b), 0) + closed.reduce((s, b) => s + wClose(b), 0);
  let best = { trust: start, loss: Infinity };
  for (let t = 0; t <= 1.0001; t += 0.05) {
    let loss = 0;
    const pOf = (b) => Math.min(0.995, Math.max(0.005, b.fair + t * (b.model - b.fair)));
    for (const b of decided) loss -= wResult(b) * Math.log(b.status === 'won' ? pOf(b) : 1 - pOf(b));
    // (the closing chance as a soft result: best matched by a chance equal to it)
    for (const b of closed) loss -= wClose(b) * (b.clv.q * Math.log(pOf(b)) + (1 - b.clv.q) * Math.log(1 - pOf(b)));
    // (trusting the model has to be earned: each unit of trust costs 2 nats, so luck over a few dozen bets
    // doesn't buy it, and with no real edge the fit settles near the book)
    const penalized = loss + 2 * t * t;
    if (penalized < best.loss) best = { trust: round(t, 2), loss: penalized, raw: loss };
  }
  return { trust: best.trust, n: decided.length, clvN: closed.length, eff, fitted: true, logLoss: round(best.raw / n, 4) };
}

// A record: won, lost, pushed, units staked and won, the return on them (a void bet, no action, isn't in it)
export function record(bets) {
  const r = { bets: 0, won: 0, lost: 0, push: 0, staked: 0, profit: 0 };
  for (const b of bets) {
    if (b.status === 'open' || b.void) continue;
    r.bets++;
    r[b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'push']++;
    r.staked += b.units;
    r.profit += b.profit;
  }
  return { ...r, staked: round(r.staked, 2), profit: round(r.profit, 2), roi: r.staked ? round(r.profit / r.staked, 4) : null };
}
