// Closing-line value: how each bet's line and price compare with where the market closed. The close is the
// market's last word before the game (everyone's money and news in it), so a desk that keeps getting better
// numbers than the close is finding real edges long before enough results are in to show it: the early
// skill signal.
//
//   a game market's close: ESPN's core API keeps DraftKings' opening and closing lines and prices for an event
//   after it's played, so any run after kickoff can read it (the run that grades it, at the latest)
//   a prop's close: its board stays up after the game too, each item at its last line (and price, where the
//   board has prices)
//
// Each bet's clv: pts (its line against the close's for its side: a spread or a prop the points it got better,
// a total the same toward its side), prob (the closing fair chance of its side at its own line, less the fair
// chance when it bet: a line move counted through the margin's or total's spread, about 0.4 / sigma a point),
// ev (its expected return at the closing chance and its own price), beat (whether it got the better of the
// close: a better line, or the same line and a better chance). Before the game, each run also notes the
// line it last saw (seen), which stands in for the close until it's read.

import { get } from './sources.mjs';
import { decimal, fairPair } from './desk.mjs';
import { round } from './ratings.mjs';
import { ESPN_PROVIDER } from './espn.mjs';
import { BOOK } from './leagues.mjs';

const CORE = 'https://sports.core.api.espn.com/v2/sports';

// An event's closing lines (null when the API has none): each side's spread and its price, the total and its
// over and under prices, each side's moneyline
export async function closingLines(league, id) {
  if (!ESPN_PROVIDER[BOOK]) return null;
  const [kind, lg] = league.split('/');
  const body = await get(`${CORE}/${kind}/leagues/${lg}/events/${id}/competitions/${id}/odds/${ESPN_PROVIDER[BOOK]}?lang=en&region=us`);
  if (!body) return null;
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/^[ou+]/, ''));
    return Number.isFinite(n) && v !== undefined && v !== '' ? n : null;
  };
  const side = (t) => {
    const c = t?.close ?? t?.current ?? null;
    return { line: num(c?.pointSpread?.american), odds: num(c?.spread?.american), ml: num(c?.moneyLine?.american) };
  };
  const h = side(body.homeTeamOdds);
  const a = side(body.awayTeamOdds);
  const c = body.close ?? body.current ?? null;
  return {
    spread: { home: { line: h.line, odds: h.odds }, away: { line: a.line, odds: a.odds } },
    total: { line: num(c?.total?.american), over: num(c?.over?.american), under: num(c?.under?.american) },
    ml: { home: h.ml, away: a.ml },
  };
}

// A game bet's close (its side's line and price, and the fair chance of its side) from closing lines
export function closeOf(bet, lines) {
  if (!lines) return null;
  if (bet.market === 'spread') {
    const mine = lines.spread[bet.side];
    const other = lines.spread[bet.side === 'home' ? 'away' : 'home'];
    if (mine.line === null || !mine.odds || !other.odds) return null;
    return { line: mine.line, odds: mine.odds, fair: fairPair(mine.odds, other.odds) };
  }
  if (bet.market === 'total') {
    const t = lines.total;
    if (t.line === null || !t.over || !t.under) return null;
    const odds = bet.side === 'over' ? t.over : t.under;
    return { line: t.line, odds, fair: fairPair(odds, bet.side === 'over' ? t.under : t.over) };
  }
  const mine = lines.ml[bet.side];
  const other = lines.ml[bet.side === 'home' ? 'away' : 'home'];
  if (!mine || !other) return null;
  return { line: null, odds: mine, fair: fairPair(mine, other) };
}

// A prop bet's close from its game's board after kickoff (the player's line for the stat; its prices where
// the board has them)
export function propCloseOf(bet, board) {
  const p = board.find((x) => String(x.athlete.id) === String(bet.athlete) && x.stat.key === bet.propType);
  if (!p) return null;
  const odds = p.prices ? (bet.side === 'over' ? p.prices.over : p.prices.under) : null;
  const fair = p.prices ? (bet.side === 'over' ? fairPair(p.prices.over, p.prices.under) : fairPair(p.prices.under, p.prices.over)) : null;
  return { line: p.line, odds, fair };
}

// A bet's CLV against its close (spread: the margin's spread; for a total, the total's)
export function clvOf(bet, close, sigma) {
  if (!close) return null;
  // (the points it got better than the close, its own side's way)
  let pts = null;
  if (close.line !== null && bet.line !== null && bet.line !== undefined) {
    if (bet.market === 'spread') pts = bet.line - close.line;
    else if (bet.market === 'total' || bet.market === 'prop') pts = bet.side === 'over' ? close.line - bet.line : bet.line - close.line;
  }
  pts = pts === null ? null : round(pts, 2);
  // (the closing fair chance of its side at its own line, and what that's worth at its own price)
  let q = null;
  // (a prop whose line moved has no spread to carry its chance to the bet's line: its points say it alone)
  if (close.fair !== null && close.fair !== undefined && !(bet.market === 'prop' && pts)) {
    const perPoint = bet.market === 'prop' ? 0 : sigma ? 0.4 / sigma : 0;
    q = Math.min(0.99, Math.max(0.01, close.fair + (pts ?? 0) * perPoint));
  }
  const prob = q !== null && bet.fair !== undefined ? round(q - bet.fair, 4) : null;
  const ev = q !== null && bet.odds ? round(q * decimal(bet.odds) - 1, 4) : null;
  const beat = pts !== null && pts !== 0 ? pts > 0 : prob !== null && prob !== 0 ? prob > 0 : null;
  return { pts, prob, ev, q: q === null ? null : round(q, 4), beat };
}

// CLV across bets: how many have it, the share that beat the close (of those that didn't tie it), the mean
// points (spreads, totals, props), chance and expected return at the close
export function clvSummary(bets) {
  const withClv = bets.filter((b) => b.clv);
  const decided = withClv.filter((b) => b.clv.beat !== null);
  const mean = (key) => {
    const v = withClv.map((b) => b.clv[key]).filter((x) => x !== null && x !== undefined);
    return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 4) : null;
  };
  return { n: withClv.length, beat: decided.length ? round(decided.filter((b) => b.clv.beat).length / decided.length, 4) : null, pts: mean('pts'), prob: mean('prob'), ev: mean('ev') };
}
