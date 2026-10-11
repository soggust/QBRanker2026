// The public picks: the algorithm's best bets on the games not started yet, for the site's Bets page
// (apps/<sport>/src/StaticData/model/picks.json, written by every run when they change).
//
//   which    every bet it's placed on a game not started, a game market's or a prop's (not a guarded one): the
//            user wants the bot's bets shown, the best first, while it's still learning (rein it in to the
//            edge bets alone once it's sharper). Only a showcase: nothing here feeds the bettor's learning
//   score    its Kelly score (scoreParts, below: the order): the share of a bankroll its edge is worth at its
//            price, (b·p − (1 − p)) / b with b what a unit pays and p its trusted chance (the book's fair chance
//            pulled toward the model's by the market's trust). Value and likelihood together: a heavy favorite
//            at a price with no edge scores 0 or under and sorts last, whatever its chance. Only the page's
//            order: the bettor's own staking (desk.mjs stakeFor, by the same Kelly fraction) is apart. A big
//            disagreement with the book can't reach the top bands: the bet's trusted chance leans the model's
//            way less past half the market's GAP (desk.mjs leanOf), and past GAP it isn't bet. Its edge score (scoreOf,
//            the tie-break) its expected return per unit at the trusted chance, times how far the trust can be
//            leaned on: 1 once the market's is fitted (the backtest's closing lines and the graded bets), 0.5
//            while it's the untested start (a prop type with fewer than 40 graded)
//   chance   what the page shows beside it: the trusted chance the bet wins, as a whole percent
//   level    its band, the row's color and chip, by its Kelly score (BANDS): lock (10% or more, and a 60%
//            chance), high (5%: LOVE), medium (2%: LIKE), low (PASS)
//   N        the 40 best a sport (TOP) by the Kelly score, the page's 40 across all the sports. An edge bet's
//            band is its score's; one without an edge is low, whatever its score (a favorite at a short price
//            isn't a strong bet)
//   reason   written from the bet's own numbers: the model's chance against the book's, the price and book,
//            the projection (a prop's) or the expected score, what the context saw (a backup quarterback, the
//            weather, a back-to-back, players out, the goalie or pitcher), and a line that's moved its way
//   record   the picks' own: each bet the page shows is marked shown (with its chance and Kelly score when
//            first shown, publishedP and publishedKelly), and published once it's locked: REPRICE_BY before its
//            start (timing.mjs), when the news can no longer price it again, or the first run after the start
//            if the runs skipped that. The record is of the published ones only, overall and by band, not of
//            every bet the desk made. Till then a shown bet is the desk's like any other: the news (or --replace)
//            prices it again, and the page shows the new one; one that falls out of the top before it's locked
//            loses its shown mark. (Published used to be set the run a bet was first shown, which froze the best
//            bets at their first price whatever the news: unlock turns those back into shown ones)

import { round } from './ratings.mjs';
import { decimal, intentOf, record } from './desk.mjs';
import { REPRICE_BY } from './timing.mjs';

// (a bet locked: its game starts within REPRICE_BY, or has started; nothing prices it again from here)
const locked = (b, now) => Date.parse(b.start) - now.getTime() <= REPRICE_BY;

// The open bets published before they were locked (under the old rule: published the run they were first
// shown), turned back into shown ones, their chance and score when shown kept: so the news and --replace can
// price them again. Returns how many
export function unlock(ledger, now) {
  let n = 0;
  for (const b of ledger.bets) {
    if (!b.published || b.status !== 'open' || locked(b, now)) continue;
    b.shown = true;
    delete b.published;
    delete b.publishedAt;
    n++;
  }
  return n;
}

export const TOP = 40;
// (the confidence bands, by the Kelly score: a bankroll's 5% or more high (the page's LOVE), 2% or more medium (LIKE),
// under that low (PASS); a lock above them all: 10% or more and a 60% chance to win, a big edge on a likely
// result. The page reads the same bands: bet-why.ts confidenceOf)
export const BANDS = { lock: 0.1, lockChance: 0.6, high: 0.05, medium: 0.02 };
const KIND = { spread: 'spread', total: 'total', ml: 'moneyline', prop: 'player' };
const LABEL = { spread: 'Spread', total: 'Game total', ml: 'Moneyline' };

const pct = (v) => `${Math.round(v * 100)}%`;
const odds = (a) => (a > 0 ? `+${a}` : String(a));
const logo = (sport, abbr) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${sport}/500/${abbr.toLowerCase()}.png&w=40&h=40`;
// (a Kelly score's band, with its chance for a lock: value and likelihood together, as the picks are ranked)
export const level = (kelly, p = 0) =>
  kelly >= BANDS.lock && p >= BANDS.lockChance ? 'lock' : kelly >= BANDS.high ? 'high' : kelly >= BANDS.medium ? 'medium' : 'low';
// (a bet's band: its Kelly score's if it has an edge, else low: a favorite at a short price isn't a strong bet)
export const levelOf = (b, kelly, p = b.p) => (intentOf(b) === 'edge' ? level(kelly, p) : 'low');

// A bet's score (see above): its EV, half for a market whose trust is still the untested start
export function scoreOf(bet, trust) {
  const key = bet.market === 'prop' ? `prop:${bet.propType}` : bet.market;
  return round(bet.ev * (trust?.[key]?.fitted ? 1 : 0.5), 4);
}

// A bet's Kelly score (the order), and its parts as the page's rank tile shows them: what a unit pays (b) and
// the price's break-even chance (p0), then the price's part, the book's own fair chance against that
// break-even (its vig on this side: under 0, or over where the price beats its own fair chance), and the
// model's lean, the trust times the model's chance less the book's; each scaled by what the price pays,
// (b + 1) / b, so they add up to the score. The trust read back off the bet's own numbers (the one it was
// priced at), fitted or the untested start, and where the fair chance came from
export function scoreParts(bet, trust) {
  const b = decimal(bet.odds) - 1;
  const p0 = 1 / (b + 1);
  const scale = (b + 1) / b;
  const score = round((bet.p - p0) * scale, 4);
  const price = round((bet.fair - p0) * scale, 4);
  const key = bet.market === 'prop' ? `prop:${bet.propType}` : bet.market;
  const gap = bet.model - bet.fair;
  return {
    score,
    price,
    lean: round(score - price, 4),
    b: round(b, 4),
    p0: round(p0, 4),
    fair: round(bet.fair, 4),
    p: round(bet.p, 4),
    trust: Math.abs(gap) > 1e-6 ? round((bet.p - bet.fair) / gap, 2) + 0 : null,
    fitted: !!trust?.[key]?.fitted,
    from: bet.oddsAssumed ? 'even' : bet.fairFrom === 'pinnacle' ? 'pinnacle' : 'book',
  };
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
  // (over 0, a worse quarterback than the usual one; under 0, a better one: the starter back from an injury)
  for (const [i, t, qb] of [
    [0, home, s.home],
    [1, away, s.away],
  ]) {
    if (s.backup?.[i] > 0) notes.push(`${t} starts a backup QB${qb ? ` (${qb})` : ''}`);
    else if (s.backup?.[i] < 0) notes.push(`${t} has its better QB back${qb ? ` (${qb})` : ''}`);
  }
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
  if (Number.isFinite(w.snow) && w.snow >= 0.5) notes.push(`snow in the forecast (${w.snow} in)`);
  else if (Number.isFinite(w.precip) && w.precip >= 0.1) notes.push(`rain in the forecast (${w.precip} in)`);
  if (w.rain === true) notes.push('rain at the park');
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

// The sport's picks: its bets on games not started, the best Kelly score first, the top TOP; each one marked
// shown on the ledger (its level then), published once it's locked, and the published ones' record
export function buildPicks(sport, ledger, trust, games, now) {
  // (the ones shown before and locked since (their game within REPRICE_BY, or started between runs, graded
  // even): published, at their chance and level when first shown)
  for (const b of ledger.bets) {
    if (!b.shown || b.published || !locked(b, now)) continue;
    Object.assign(b, { published: true, publishedAt: now.toISOString() });
    delete b.shown;
  }
  const open = ledger.bets.filter((b) => b.status === 'open' && Date.parse(b.start) > now.getTime() && !b.context?.guard);
  // (one a bet: a --dry run prices placed bets again in memory)
  const once = [...new Map(open.map((b) => [b.id, b])).values()];
  // (the order: its Kelly score; its edge score kept beside it)
  const scored = once.map((b) => {
    const { score, ...why } = scoreParts(b, trust);
    return { b, score, why, edgeScore: scoreOf(b, trust) };
  });
  scored.sort((x, y) => y.score - x.score || y.edgeScore - x.edgeScore || x.b.start.localeCompare(y.b.start));
  const top = scored.slice(0, TOP);
  const inTop = new Set(top.map((x) => x.b));
  // (one shown before that's dropped out of the top, not yet locked: no longer shown)
  for (const { b } of scored) {
    if (inTop.has(b) || !b.shown) continue;
    for (const k of ['shown', 'publishedP', 'publishedKelly', 'publishedLevel']) delete b[k];
  }
  for (const { b, score } of top) {
    // (shown now; published once locked: at REPRICE_BY before the start, here or the next run)
    if (locked(b, now)) {
      if (!b.published) Object.assign(b, { published: true, publishedAt: now.toISOString() });
      delete b.shown;
    } else if (!b.published) b.shown = true;
    // (its chance and its Kelly score when shown, and its band: fixed from then on, so the record by band is
    // what the page said at the time)
    if (!Number.isFinite(b.publishedP)) b.publishedP = b.p;
    if (!Number.isFinite(b.publishedKelly)) b.publishedKelly = score;
    b.publishedLevel = levelOf(b, b.publishedKelly, b.publishedP);
  }
  const picks = top.map(({ b, score, why }, i) => {
    const g = games.get(b.event);
    const [away, home] = b.matchup.split(' @ ');
    return {
      id: b.id,
      rank: i + 1,
      sport,
      score,
      chance: Math.round(b.p * 100),
      level: levelOf(b, score),
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
      // (its score's parts, for the rank tile's breakdown: price + lean is the score)
      why,
      start: b.start,
      matchup: b.matchup,
      teams: [away, home].map((abbr) => ({ abbr, logo: logo(sport, abbr) })),
      where: whereOf(b, g),
      reason: reasonOf(b, g),
    };
  });
  const published = ledger.bets.filter((b) => b.published);
  const byLevel = Object.fromEntries(['lock', 'high', 'medium', 'low'].map((l) => [l, tally(published.filter((b) => b.publishedLevel === l))]));
  return { sport, at: now.toISOString(), bands: BANDS, top: TOP, record: { graded: published.filter((b) => b.status !== 'open').length, overall: tally(published), byLevel }, picks };
}

// (a record as the page's: wins, losses, pushes, the win share; a void bet, no action, isn't counted)
function tally(bets) {
  const r = record(bets);
  return { wins: r.won, losses: r.lost, pushes: r.push, winPct: r.won + r.lost ? round(r.won / (r.won + r.lost), 4) : null, profit: r.profit };
}
