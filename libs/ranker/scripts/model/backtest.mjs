// The backtest: the model replayed against the real lines of games it has already seen, from The Odds API's
// history (oddsapi.mjs): the desk's book's prices and Pinnacle's, snapshots of a whole slate at a time (each 30
// credits: ten times the three markets). Each game bet twice over:
//
//   early  at the first snapshot two hours or more before it starts (a mid-week or morning line), against its
//          close (the last snapshot before it starts): the return, the closing-line value, how often it beat
//          the close. Flattered: the model knows things the early line didn't yet (the quarterback who actually
//          started, the players who actually sat, the goalie in net: its context reads them from the game), so
//          it gets ahead of line moves the market only made once that news was out
//   close  at the last snapshot before it starts, when that news is in the line too: the honest test of whether
//          the model adds anything to the market's own number. Each market's trust is fitted on these (desk.mjs
//          fitTrust, on the results), which the live runs start from instead of waiting for 40 graded bets
//
//   the snapshots: PLAN (the most signal for the credits: a season of the NFL a week at a time, three weeks each
//   of the NBA, NHL and MLB a day at a time); each one's response kept under .cache/model/history (never bought
//   twice) and the bets drawn from them in apps/<sport>/scripts/model/backtest.json (committed: paid for)
//   the model's chances: its expectation for each game from the replay, each game predicted from the games
//   before it only (its settings are this run's, fit on the whole history: a small look-ahead, noted). The
//   saved bets' chances are priced again every run by the desk's pricing as it is now (repriced: each bet's
//   line, price and fair chance are kept, so no snapshot is needed), so the trust is fit on the chances the
//   desk bets with, not on an older pricing's
//
// Only asked for with run.mjs --backtest, and only within history's budget (HISTORY_BUDGET).

import path from 'node:path';
import { CACHE, DAY, isoSecond as iso, readJson, writeJson } from './sources.mjs';
import { HISTORY_BUDGET, LINE_BOOKS, SPORT_KEYS, call, canSpend, linesFromEvent, matchNearest } from './oddsapi.mjs';
import { choose, fitTrust, price, settle, stakeFor } from './desk.mjs';
import { cond, mlModel, spreadChances, totalChances } from './margins.mjs';
import { clvOf } from './clv.mjs';
import { idOf } from './teamstats.mjs';
import { round } from './ratings.mjs';

const COST = 30;

// Each sport's snapshots: when, as UTC times
function daily(from, to, hours) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) for (const h of hours) out.push(iso(t + h * 36e5));
  return out;
}
export const PLAN = {
  // (the 2025 season: Tuesday 16:00 for the week's lines, Sunday 16:45 for the Sunday and Monday games' close,
  // and the playoffs' Saturdays at 20:30)
  nfl: () => {
    const out = [];
    for (let t = Date.parse('2025-09-02T16:00:00Z'); t <= Date.parse('2026-02-03T16:00:00Z'); t += 7 * DAY) {
      out.push(iso(t), iso(t + 5 * DAY + 45 * 6e4));
      if (t >= Date.parse('2026-01-06T00:00:00Z')) out.push(iso(t + 4 * DAY + 4.5 * 36e5));
    }
    return out;
  },
  nba: () => daily('2026-01-12T00:00:00Z', '2026-02-01T00:00:00Z', [15, 23.75]),
  nhl: () => daily('2026-01-12T00:00:00Z', '2026-02-01T00:00:00Z', [15, 23.75]),
  mlb: () => daily('2025-08-04T00:00:00Z', '2025-08-24T00:00:00Z', [15.5, 22.75]),
};
export const planCost = (sport) => PLAN[sport]().length * COST;

const fileOf = (sport, at) => path.join(CACHE, 'history', sport, `${at.replace(/:/g, '-')}.json`);

// The plan's snapshots, each read from the cache or bought (within the history budget); how many were bought
export async function snapshots(sport, { buy = true } = {}) {
  const out = [];
  let bought = 0;
  for (const at of PLAN[sport]()) {
    let snap = readJson(fileOf(sport, at), null);
    if (!snap && buy && canSpend('history', COST)) {
      snap = await call('history', `/historical/sports/${SPORT_KEYS[sport]}/odds`, { date: at, markets: 'h2h,spreads,totals', bookmakers: LINE_BOOKS.join(',') });
      if (snap) {
        writeJson(fileOf(sport, at), snap);
        bought++;
      }
    }
    if (snap) out.push({ at, data: snap.data ?? [] });
  }
  return { snaps: out, bought, planned: PLAN[sport]().length };
}

// The bets the history gives: each game of the snapshots that's in the desk's history and final, bet at its
// first snapshot two hours or more before it starts and closed at its last before it (expect: game id to the
// model's expectation; teams: ESPN's teams for the names)
export function backtestBets(sport, snaps, games, expect, params, teams, trust = 0.5, evScale = 0.08, shape = null) {
  const byGame = new Map();
  for (const { at, data } of snaps) {
    // (each event its game, one to one and nearest start first: a doubleheader's two games their own events)
    const candidates = [];
    for (const ev of data) {
      const home = idOf(teams, ev.home_team);
      const away = idOf(teams, ev.away_team);
      const start = Date.parse(ev.commence_time);
      if (!home || !away || start <= Date.parse(at)) continue;
      for (const x of games) if (x.home === home && x.away === away && Math.abs(Date.parse(x.date) - start) < 12 * 36e5) candidates.push([ev, x, Math.abs(Date.parse(x.date) - start)]);
    }
    for (const [ev, g] of matchNearest(candidates)) {
      if (!g?.final || g.hs === null) continue;
      const lines = linesFromEvent(ev);
      if (!lines) continue;
      const list = byGame.get(g.id) ?? [];
      list.push({ at, lines });
      byGame.set(g.id, list);
    }
  }
  const bets = [];
  for (const [id, seen] of byGame) {
    const g = games.find((x) => x.id === id);
    const exp = expect.get(id);
    if (!exp) continue;
    seen.sort((a, b) => a.at.localeCompare(b.at));
    const early = seen.find((s) => Date.parse(g.date) - Date.parse(s.at) >= 2 * 36e5);
    const close = seen.at(-1);
    for (const [when, bet] of [
      ['early', early],
      ['close', close],
    ]) {
    if (!bet) continue;
    for (const anchor of ['pinnacle', 'own']) {
      const l = deskLines(bet.lines, anchor);
      for (const market of price(g, exp, l, params, shape)) {
        const pick = choose(market, trust, evScale);
        const b = { id: `${id}:${market.market}`, event: id, when, market: market.market, side: pick.side, line: pick.line, odds: pick.odds, model: round(pick.model, 4), push: round(pick.push ?? 0, 4), fair: round(pick.fair, 4), anchor, sharp: l.sharp[market.market], ev: round(pick.ev, 4), units: pick.units, at: bet.at, start: g.date };
        Object.assign(b, settle(b, g));
        // (a run line or total on an MLB game cut short: void, no action, no evidence)
        if (b.void) continue;
        // (an early bet's close: the same side at the last snapshot, the anchor's fair chance there)
        if (when === 'early' && close.at !== bet.at) {
          const c = closeFrom(b, deskLines(close.lines, anchor));
          if (c) {
            b.close = c;
            b.clv = clvOf(b, c, market.market === 'total' ? params.sigmaT : params.sigma, { sigma: params.sigma, sigmaT: params.sigmaT, shape });
          }
        }
        bets.push(b);
      }
    }
    }
  }
  return bets;
}

// (the desk's lines from an Odds API event's: its book's prices, the fair chance from Pinnacle (anchor
// 'pinnacle', where it posts the line) or the book's own prices (anchor 'own'))
function deskLines(l, anchor) {
  const fairOf = (m) => (m ? (anchor === 'pinnacle' && m.sharp !== null ? m.sharp : m.own) : undefined);
  return {
    ml: { home: l.h2h?.prices.home ?? null, away: l.h2h?.prices.away ?? null },
    spread: { home: { line: l.spreads?.line ?? null, odds: l.spreads?.prices.home ?? null }, away: { line: l.spreads ? -l.spreads.line : null, odds: l.spreads?.prices.away ?? null } },
    total: { line: l.totals?.line ?? null, over: l.totals?.prices.over ?? null, under: l.totals?.prices.under ?? null },
    fair: { ml: fairOf(l.h2h), spread: fairOf(l.spreads), total: fairOf(l.totals) },
    sharp: { ml: l.h2h?.sharp !== null && l.h2h?.sharp !== undefined, spread: l.spreads?.sharp !== null && l.spreads?.sharp !== undefined, total: l.totals?.sharp !== null && l.totals?.sharp !== undefined },
  };
}

// (a backtest bet's close: its side's line and price at the closing snapshot, and its fair chance there)
function closeFrom(b, l) {
  if (b.market === 'ml') {
    const odds = l.ml[b.side];
    const f = l.fair.ml;
    return odds && Number.isFinite(f) ? { line: null, odds, fair: b.side === 'home' ? f : 1 - f } : null;
  }
  if (b.market === 'spread') {
    const s = l.spread[b.side];
    const f = l.fair.spread;
    return s.line !== null && s.odds && Number.isFinite(f) ? { line: s.line, odds: s.odds, fair: b.side === 'home' ? f : 1 - f } : null;
  }
  const f = l.fair.total;
  const odds = b.side === 'over' ? l.total.over : l.total.under;
  return l.total.line !== null && odds && Number.isFinite(f) ? { line: l.total.line, odds, fair: b.side === 'over' ? f : 1 - f } : null;
}

// A market's backtest numbers: its bets, return (at the desk's stakes, every market bet; and on the ones with an
// edge at the trust), closing-line value, how often it beat the close, calibration, and the anchors' log loss
export function summarize(bets, trust) {
  const decided = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  const pOf = (b) => b.fair + trust * (b.model - b.fair);
  const ret = (list, stake) => {
    let staked = 0;
    let profit = 0;
    for (const b of list) {
      const u = stake(b);
      staked += u;
      profit += b.status === 'won' ? u * (b.odds > 0 ? b.odds / 100 : 100 / -b.odds) : b.status === 'lost' ? -u : 0;
    }
    return { n: list.length, staked: round(staked, 2), profit: round(profit, 2), roi: staked ? round(profit / staked, 4) : null };
  };
  const evAt = (b) => (1 - (b.push ?? 0)) * (pOf(b) * (b.odds > 0 ? 1 + b.odds / 100 : 1 + 100 / -b.odds) - 1);
  const withClv = bets.filter((b) => b.clv);
  const beats = withClv.filter((b) => b.clv.beat !== null);
  const ll = (list, f) => (list.length ? round(list.reduce((s, b) => s - Math.log(b.status === 'won' ? f(b) : 1 - f(b)), 0) / list.length, 4) : null);
  const bands = new Map();
  for (const b of decided) {
    const band = Math.min(0.8, Math.max(0.2, Math.floor(pOf(b) * 10) / 10));
    const x = bands.get(band) ?? { n: 0, said: 0, was: 0 };
    x.n++;
    x.said += pOf(b);
    x.was += b.status === 'won' ? 1 : 0;
    bands.set(band, x);
  }
  return {
    bets: bets.length,
    every: ret(bets, (b) => stakeFor(evAt(b), 0.08, b.odds)),
    flat: ret(bets, () => 1),
    edge: ret(bets.filter((b) => evAt(b) > 0), (b) => stakeFor(evAt(b), 0.08, b.odds)),
    clv: { n: withClv.length, beat: beats.length ? round(beats.filter((b) => b.clv.beat).length / beats.length, 4) : null, ev: withClv.length ? round(withClv.reduce((s, b) => s + (b.clv.ev ?? 0), 0) / withClv.length, 4) : null },
    logLoss: { model: ll(decided, (b) => Math.min(0.99, Math.max(0.01, b.model))), market: ll(decided, (b) => b.fair), trusted: ll(decided, (b) => Math.min(0.99, Math.max(0.01, pOf(b)))) },
    calibration: [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([band, x]) => ({ band, n: x.n, said: round(x.said / x.n, 4), was: round(x.was / x.n, 4) })),
  };
}

// The saved bets' chances priced again by the desk's pricing now (desk.mjs price, margins.mjs): each bet's side,
// line, price and fair chance as saved, its model's chance (and push) from its game's expectation (expOf: the
// replay's, each game's before it was played) at that line; a moneyline off the same snapshot's spread (its
// bet beside it), as the live desk prices it. A bet whose game the replay has no expectation for is left out
// (its chance from an older pricing would teach the trust that pricing's leans)
export function repriced(bets, expOf, params, shape = null) {
  const key = (b) => `${b.event}|${b.when ?? 'early'}|${b.anchor}`;
  const spreads = new Map(bets.filter((b) => b.market === 'spread').map((b) => [key(b), b]));
  const out = [];
  for (const b of bets) {
    const exp = expOf.get(b.event);
    if (!exp || !Number.isFinite(b.fair)) continue;
    let c;
    let q;
    if (b.market === 'spread') {
      c = spreadChances(b.side === 'home' ? exp.margin : -exp.margin, b.line, params.sigma, shape);
      q = cond(c);
    } else if (b.market === 'total') {
      c = totalChances(exp.total, b.line, params.sigmaT);
      q = b.side === 'over' ? cond(c) : 1 - cond(c);
    } else {
      const s = spreads.get(key(b));
      const spreadHome = s ? { line: s.side === 'home' ? s.line : -s.line, fair: s.side === 'home' ? s.fair : 1 - s.fair } : null;
      c = mlModel(exp.margin, params.sigma, shape, b.side === 'home' ? b.fair : 1 - b.fair, spreadHome);
      q = b.side === 'home' ? cond(c) : 1 - cond(c);
    }
    out.push({ ...b, model: round(q, 4), push: round(c.push, 4) });
  }
  return out;
}

// The bets the trust is fitted on: the close's, with the Pinnacle anchor (its fair chance where it had the line)
export const trustBets = (bets) => bets.filter((b) => b.when === 'close' && b.anchor === 'pinnacle').map(({ clv, close, ...b }) => b);

// The whole backtest for a sport, per market: its trust fitted on the closing bets; their numbers at it (close),
// the early bets' at it (early: return, closing-line value, beat the close; flattered, see above), and the two
// fair-chance anchors compared (the market's log loss on the results with Pinnacle's, and with the book's own)
export function evaluate(bets) {
  const out = {};
  for (const market of ['spread', 'total', 'ml']) {
    const of = (when, anchor) => bets.filter((b) => b.market === market && (b.when ?? 'early') === when && b.anchor === anchor);
    const pin = of('close', 'pinnacle');
    if (!pin.length) continue;
    const t = fitTrust(trustBets(pin), 0.5);
    const close = summarize(pin, t.trust);
    const early = summarize(of('early', 'pinnacle'), t.trust);
    out[market] = {
      trust: t,
      bets: pin.length,
      close: { every: close.every, edge: close.edge, logLoss: close.logLoss, calibration: close.calibration },
      early,
      sharpShare: round(pin.filter((b) => b.sharp).length / pin.length, 4),
      anchors: { pinnacle: close.logLoss.market, own: summarize(of('close', 'own'), t.trust).logLoss.market, earlyPinnacle: early.logLoss.market, earlyOwn: summarize(of('early', 'own'), t.trust).logLoss.market },
    };
  }
  return out;
}

export { HISTORY_BUDGET };
