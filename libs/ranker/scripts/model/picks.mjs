// The public picks: the algorithm's best bets on the games not started yet, for the site's Bets page
// (apps/<sport>/src/StaticData/model/picks.json, written by every run when they change).
//
//   which    every bet it's placed on a game not started, a game market's or a prop's (not a guarded one): the
//            user wants the bot's bets shown, the most likely first, while it's still learning (rein it in to the
//            edge bets alone once it's sharper). Only a showcase: nothing here feeds the bettor's learning
//   score    its expected return per unit at the trusted chance (EV: the trust already in it, so a market whose
//            trust is fitted at 0, the NFL's spreads and moneylines, never has an edge and never shows), times
//            how far the trust can be leaned on: 1 once the market's is fitted (the backtest's closing lines and
//            the graded bets), 0.5 while it's the untested start (a prop type with fewer than 40 graded: its
//            edge is the projection's against an assumed trust)
//   chance   what the page shows: the model's chance the bet wins, the trusted one (p: the book's fair chance
//            pulled toward the model's by the market's trust), as a whole percent. Its band colors the row: high at
//            60% or more, medium at 53%, low under (the edge bets' chances run from about 45% to 70%, a quarter
//            under 52%, half under 57%, a quarter over 64%: the bands cut them into near thirds). A heavy
//            favorite shows a high chance with little edge; the order is the score's, not the chance's
//   N        the 40 likeliest a sport (TOP), by their chance to win (the score is the chance: the page orders by
//            it), the page's 40 across all the sports. An edge bet's band is its chance's; one without an edge is
//            low, whatever its chance (a favorite at a short price isn't a strong bet)
//   reason   written from the bet's own numbers: the model's chance against the book's, the price and book,
//            the projection (a prop's) or the expected score, what the context saw (a backup quarterback, the
//            weather, a back-to-back, players out, the goalie or pitcher), and a line that's moved its way
//   record   the picks' own: each bet the page showed is marked published (with its chance then), and the
//            record is of those only, overall and by band, not of every bet the desk made

import { round } from './ratings.mjs';
import { intentOf, record } from './desk.mjs';

export const TOP = 40;
const BANDS = { high: 0.6, medium: 0.53 };
const KIND = { spread: 'spread', total: 'total', ml: 'moneyline', prop: 'player' };
const LABEL = { spread: 'Spread', total: 'Game total', ml: 'Moneyline' };

const pct = (v) => `${Math.round(v * 100)}%`;
const odds = (a) => (a > 0 ? `+${a}` : String(a));
const logo = (sport, abbr) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${sport}/500/${abbr.toLowerCase()}.png&w=40&h=40`;
// (a chance's band: 60% and up high, 53% and up medium, low under)
export const level = (p) => (p >= BANDS.high ? 'high' : p >= BANDS.medium ? 'medium' : 'low');
// (a bet's band: its chance's if it has an edge, else low: a favorite at a short price isn't a strong bet)
export const levelOf = (b, p) => (intentOf(b) === 'edge' ? level(p) : 'low');

// A bet's score (see above): its EV, half for a market whose trust is still the untested start
export function scoreOf(bet, trust) {
  const key = bet.market === 'prop' ? `prop:${bet.propType}` : bet.market;
  return round(bet.ev * (trust?.[key]?.fitted ? 1 : 0.5), 4);
}

// A bet's reasons, in a few short sentences from its own numbers
export function reasonOf(bet, game) {
  const [away, home] = bet.matchup.split(' @ ');
  const c = bet.context ?? {};
  const out = [];
  const anchor = bet.fairFrom === 'pinnacle' ? "Pinnacle's line" : 'the book';
  out.push(bet.oddsAssumed ? `Model ${pct(bet.model)} vs an even line (${bet.book ?? 'DraftKings'}, -110 assumed: its board had no price).` : `Model ${pct(bet.model)} vs ${anchor} ${pct(bet.fair)} (${bet.book ?? 'DraftKings'} ${odds(bet.odds)}).`);
  if (bet.market === 'prop' && bet.projection) {
    const p = bet.projection;
    out.push(`Projects ${p.mean} ${bet.statLabel.toLowerCase()} against a line of ${bet.line}${p.games ? ` (${p.rate} a game this season)` : ''}.`);
    // (the defense against his role, and its funnel: said where they stand out; "not weighed" where the
    // projection leaves them out, as it does while they haven't helped on past games)
    // (his team is ESPN's id: the defense is the game's other side)
    const defense = bet.team && game ? (String(bet.team) === String(game.home) ? game.awayAbbr : String(bet.team) === String(game.away) ? game.homeAbbr : null) : null;
    const team = defense ?? 'The defense';
    if (p.role && Number.isFinite(p.roleFactor) && Math.abs(p.roleFactor - 1) >= 0.1 && p.roleRank) {
      const pctOff = Math.round(Math.abs(p.roleFactor - 1) * 100);
      out.push(`${team} ${p.roleFactor < 1 ? 'holds' : 'gives'} ${p.role}s ${pctOff}% ${p.roleFactor < 1 ? 'under' : 'over'} their average (#${p.roleFactor < 1 ? p.roleRank.rank : p.roleRank.of - p.roleRank.rank + 1} in the league${p.roleUsed ? '' : '; not weighed: the role split hasn\'t helped on past games'}).`);
    }
    if (Number.isFinite(p.funnel) && Math.abs(p.funnel) >= 0.03) {
      out.push(`${team} is a ${p.funnel > 0 ? 'pass' : 'run'} funnel: opponents pass ${Math.round(Math.abs(p.funnel) * 100)} points ${p.funnel > 0 ? 'more' : 'less'} often than usual for the situation${p.funnelUsed ? '' : ' (not weighed: it hasn\'t helped on past games)'}.`);
    }
  } else if (Number.isFinite(bet.expMargin) && Number.isFinite(bet.expTotal)) {
    const h = (bet.expTotal + bet.expMargin) / 2;
    const a = (bet.expTotal - bet.expMargin) / 2;
    out.push(`Expects ${away} ${a.toFixed(1)}, ${home} ${h.toFixed(1)}.`);
  }
  // (what the context saw)
  const notes = [];
  const s = c.starters ?? {};
  if (s.backup?.[0]) notes.push(`${home} starts a backup QB${s.home ? ` (${s.home})` : ''}`);
  if (s.backup?.[1]) notes.push(`${away} starts a backup QB${s.away ? ` (${s.away})` : ''}`);
  if (s.missing && (s.missing[0] >= 15 || s.missing[1] >= 15)) {
    for (const [i, t] of [home, away].entries()) if (s.missing[i] >= 15) notes.push(`${t} is missing players worth ${Math.round(s.missing[i])} production a game`);
  }
  if (bet.sport === 'nhl' && s.home && s.away && !bet.player) notes.push(`${s.away} vs ${s.home} in net`);
  if (bet.sport === 'mlb' && s.home && s.away && !bet.player) notes.push(`${s.away} vs ${s.home} on the mound`);
  if (c.b2b?.[0]) notes.push(`${home} played last night`);
  if (c.b2b?.[1]) notes.push(`${away} played last night`);
  const w = c.weather ?? {};
  if (Number.isFinite(w.wind) && w.wind >= 12) notes.push(`${w.wind} mph wind`);
  if (Number.isFinite(w.temp) && w.temp <= 35) notes.push(`${w.temp}°`);
  if (Number.isFinite(w.windOut) && Math.abs(w.windOut) >= 8) notes.push(`wind blowing ${w.windOut > 0 ? 'out' : 'in'} at ${Math.abs(w.windOut)} mph`);
  if (notes.length) out.push(`${notes.slice(0, 3).join('; ').replace(/^./, (x) => x.toUpperCase())}.`);
  // (a line that's moved its way since it was bet: the market agreeing)
  const seen = bet.seen;
  if (seen && seen.line !== null && bet.line !== null && seen.line !== undefined && seen.line !== bet.line) {
    const better = bet.market === 'spread' ? seen.line < bet.line : bet.side === 'over' ? seen.line > bet.line : bet.side === 'under' ? seen.line < bet.line : false;
    if (better) out.push(`The line has moved its way since (${bet.line} to ${seen.line}).`);
  } else if (seen && Number.isFinite(seen.fair) && seen.fair - bet.fair >= 0.015) out.push(`The market has moved its way since (${pct(bet.fair)} to ${pct(seen.fair)}).`);
  return out.join(' ');
}

// A game's place and weather as the page shows it (its city, the park, the roof, the temperature and wind)
function whereOf(bet, game) {
  const w = bet.context?.weather ?? {};
  const city = game?.venue?.split('|')[0] || null;
  const stadium = bet.context?.lineups?.park ?? null;
  const roof = w.roof === 'outdoors' || w.roof === 'open' ? 'outdoors' : w.roof === 'dome' || w.roof === 'closed' || game?.indoor || bet.sport === 'nba' || bet.sport === 'nhl' ? 'indoors' : w.roof ? 'retractable' : null;
  const tempF = Number.isFinite(w.temp) ? w.temp : null;
  const windMph = Number.isFinite(w.wind) ? w.wind : Number.isFinite(w.windOut) ? Math.abs(w.windOut) : null;
  return { city, stadium, weather: roof || tempF !== null ? { roof: roof ?? 'outdoors', tempF, windMph } : null };
}

// The sport's picks: its bets on games not started, the likeliest first, the top TOP; each one marked
// published on the ledger (its level then), and the published ones' record
export function buildPicks(sport, ledger, trust, games, now) {
  const open = ledger.bets.filter((b) => b.status === 'open' && Date.parse(b.start) > now.getTime() && !b.context?.guard);
  // (one a bet: a --dry run prices placed bets again in memory)
  const once = [...new Map(open.map((b) => [b.id, b])).values()];
  // (the order: its chance to win; its edge score kept beside it)
  const scored = once.map((b) => ({ b, score: round(b.p, 4), edgeScore: scoreOf(b, trust) }));
  scored.sort((x, y) => y.score - x.score || y.edgeScore - x.edgeScore || x.b.start.localeCompare(y.b.start));
  const top = scored.slice(0, TOP);
  for (const { b } of top) {
    if (!b.published) Object.assign(b, { published: true, publishedAt: now.toISOString() });
    // (its chance when shown, and its band: fixed from then on)
    if (!Number.isFinite(b.publishedP)) b.publishedP = b.p;
    b.publishedLevel = levelOf(b, b.publishedP);
  }
  const picks = top.map(({ b, score }, i) => {
    const g = games.get(b.event);
    const [away, home] = b.matchup.split(' @ ');
    return {
      id: b.id,
      rank: i + 1,
      sport,
      score,
      chance: Math.round(b.p * 100),
      level: levelOf(b, b.p),
      edge: intentOf(b) === 'edge',
      kind: KIND[b.market] ?? 'player',
      market: b.market === 'prop' ? b.statLabel : LABEL[b.market],
      pick: b.pick,
      // (which side it took, and a prop's player and his team, ESPN's ids: the page's circle and its color)
      side: b.side ?? null,
      athlete: b.athlete ?? null,
      team: b.team ?? null,
      player: b.player ?? null,
      line: b.line,
      odds: b.odds,
      book: b.book ?? 'DraftKings',
      model: b.model,
      fair: b.fair,
      p: b.p,
      ev: b.ev,
      units: b.units,
      start: b.start,
      matchup: b.matchup,
      teams: [away, home].map((abbr) => ({ abbr, logo: logo(sport, abbr) })),
      where: whereOf(b, g),
      reason: reasonOf(b, g),
    };
  });
  const published = ledger.bets.filter((b) => b.published);
  const byLevel = Object.fromEntries(['high', 'medium', 'low'].map((l) => [l, tally(published.filter((b) => b.publishedLevel === l))]));
  return { sport, at: now.toISOString(), bands: BANDS, top: TOP, record: { graded: published.filter((b) => b.status !== 'open').length, overall: tally(published), byLevel }, picks };
}

// (a record as the page's: wins, losses, pushes, the win share; a void prop isn't counted)
function tally(bets) {
  const r = record(bets.filter((b) => !b.void));
  return { wins: r.won, losses: r.lost, pushes: r.push, winPct: r.won + r.lost ? round(r.won / (r.won + r.lost), 4) : null, profit: r.profit };
}
