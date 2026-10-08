// The model desk: code only, no AI, free. For each sport, every run:
//
//   1. the game history kept current (apps/<sport>/scripts/model/games.json: two seasons of finals from the
//      teams' schedules the first time, then the last few days' scoreboards)
//   2. the ratings refit on it (ratings.mjs: the grid's best settings at predicting the games they hadn't
//      seen yet), each setting that moves logged with why
//   2b. the context (context.mjs: rest, travel, starters, weather) gathered for every game, and the size of
//      each of its terms fit on the same held-out games (ratings.mjs fitContext: a term that doesn't help is
//      left out), each size that moves logged the same way
//   3. each market's trust in the model refit on the desk's own graded bets, logged the same way
//   4. the open bets graded against their finals
//   5. every market (spread, total, moneyline) of every game starting in the next two days bet once, the
//      better side at 0.5 to 3 units (desk.mjs), cut to 0.5 (or skipped) when its line has moved a lot since it
//      opened or a key player is questionable (the guard); each bet keeps the context it saw
//
// What it writes (apps/<sport>/src/StaticData/model/): state.json (the settings, their test numbers, the
// changelog, the teams' ratings, the context's sizes) and ledger.json (every bet, open or graded); and
// apps/<sport>/scripts/model/context.json, the facts the context is built from. The Bets page's admin panel
// (dev only) reads them.
//
//   node libs/ranker/scripts/model/run.mjs [nfl nba nhl mlb] [--dry] [--replace]   (--dry: no bets placed, state and ledger
//   untouched; --replace: open bets on games not started yet are taken back and priced again)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES } from './leagues.mjs';
import { gameOf, json, linesOf, scoreboard, teamIds, teamSchedule, ymd } from './espn.mjs';
import { adjust, expect, fit, fitContext, gateOf, replay, round } from './ratings.mjs';
import { enrich, featurize, gather } from './context.mjs';
import { BANKROLL, MARKETS, choose, fitTrust, pickText, price, record, settle } from './desk.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
// (the return a side has to show to get the 3-unit top stake; a smaller one scales down to 0.5)
const EV_SCALE = 0.08;
// (the trust a market starts at, before 40 of its bets are graded: halfway between the book and the model)
const START_TRUST = 0.5;
const DAY = 864e5;

const read = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const write = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
};

async function runSport(sport) {
  const cfg = LEAGUES[sport];
  const gamesFile = path.join(ROOT, 'apps', sport, 'scripts/model/games.json');
  const outDir = path.join(ROOT, 'apps', sport, 'src/StaticData/model');
  const stateFile = path.join(outDir, 'state.json');
  const ledgerFile = path.join(outDir, 'ledger.json');
  const now = new Date();
  const at = now.toISOString();

  // 1. the history
  const games = new Map(read(gamesFile, []).map((g) => [g.id, g]));
  if (!games.size) {
    const current = (await json(`https://site.api.espn.com/apis/site/v2/sports/${cfg.league}/scoreboard`))?.leagues?.[0]?.season?.year;
    const ids = await teamIds(cfg.league);
    for (const season of [current - 1, current]) {
      for (const id of ids) {
        for (const type of [2, 3]) {
          for (const e of await teamSchedule(cfg.league, id, season, type)) {
            const g = gameOf(e);
            if (g && !games.has(g.id)) games.set(g.id, { ...g, season: g.season ?? season, type: g.type ?? type });
          }
        }
      }
    }
    console.log(`${sport}: history started, ${games.size} games (${current - 1}-${current})`);
  }
  const upcoming = [];
  // (the last few days and the next two; and the day of any bet still open from before then, should the
  // runs ever have stopped a while)
  const days = new Set(Array.from({ length: 7 }, (_, i) => ymd(new Date(now.getTime() + (i - 4) * DAY))));
  for (const bet of read(path.join(ROOT, 'apps', sport, 'src/StaticData/model/ledger.json'), { bets: [] }).bets) {
    if (bet.status === 'open' && Date.parse(bet.start) < now.getTime() - 4 * DAY) days.add(ymd(new Date(bet.start)));
  }
  for (const day of days) {
    for (const e of await scoreboard(cfg.league, day)) {
      const g = gameOf(e);
      if (!g || (g.type !== 2 && g.type !== 3)) continue;
      games.set(g.id, { ...(games.get(g.id) ?? {}), ...g });
      const lines = linesOf(e);
      if (!g.final && lines && Date.parse(g.date) > now.getTime() + 5 * 60e3) upcoming.push({ game: g, lines, event: e });
    }
  }
  await enrich(sport, cfg, games).catch((err) => console.warn(`${sport}: history's gaps left (${err.message})`));
  const history = [...games.values()].filter((g) => g.type === 2 || g.type === 3);
  write(gamesFile, history.sort((a, b) => a.date.localeCompare(b.date)));

  // 2. the ratings, refit
  const state = read(stateFile, { sport, changelog: [] });
  const before = state.params ?? cfg.priors;
  const best = fit(history, { ...cfg.priors, sigma: before.sigma ?? cfg.priors.sigma, sigmaT: before.sigmaT ?? cfg.priors.sigmaT }, cfg.grid);
  const params = best?.params ?? before;
  const why = best ? `on ${best.test.n} games it hadn't seen: margins off by ${round(best.test.maeMargin)}, totals by ${round(best.test.maeTotal)}, winners ${round(best.test.winHit * 100, 1)}% right` : 'not enough history';
  for (const key of ['k', 'hfa', 'revert', 'kO']) {
    if (state.params && state.params[key] !== params[key]) state.changelog.push({ at, what: `ratings ${key}`, from: state.params[key], to: params[key], why });
  }

  // 2b. the context: its facts brought up to date, each game's terms, their sizes fit (nothing here may stop
  // the run: without it, every term is 0 and the ratings bet alone)
  const contextFile = path.join(ROOT, 'apps', sport, 'scripts/model/context.json');
  const facts = read(contextFile, {});
  let ctxFit = null;
  let feats = null;
  try {
    const t0 = Date.now();
    const live = await gather(sport, cfg, history, upcoming, facts);
    const { nfl: _rows, ...kept } = facts;
    write(contextFile, kept);
    feats = featurize(sport, cfg, history, facts, live);
    ctxFit = fitContext(history, params, feats.feats, feats.terms);
    console.log(`${sport}: context gathered and fit in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (err) {
    console.warn(`${sport}: context left out (${err.stack ?? err})`);
  }
  // (with the context, the spreads around its expectations are the ones it priced with)
  if (ctxFit) Object.assign(params, { sigma: round(ctxFit.after.sigma, 3), sigmaT: round(ctxFit.after.sigmaT, 3) });
  const { state: teams } = replay(history, params, 0, ctxFit?.ctx ?? null);
  const weights = teams.weights ?? null;
  const context = ctxFit ? contextState(ctxFit, weights) : (state.context ?? null);
  // (logged: a term joining or leaving, or its size moving a tenth or more; the first fit logs each it keeps)
  if (ctxFit) {
    const was = new Map((state.context?.terms ?? []).map((t) => [t.key, t]));
    const why = `on ${ctxFit.after.n} games it hadn't seen: margins off by ${round(ctxFit.after.maeMargin)} (${round(ctxFit.before.maeMargin)} without the context), totals by ${round(ctxFit.after.maeTotal)} (${round(ctxFit.before.maeTotal)}), winners ${round(ctxFit.after.winHit * 100, 1)}% right (${round(ctxFit.before.winHit * 100, 1)}%)`;
    for (const t of context.terms) {
      const from = was.get(t.key) ?? { size: 0, kept: false };
      const moved = Math.abs(t.size - from.size) >= 0.1 * Math.max(Math.abs(t.size), Math.abs(from.size));
      if (from.kept !== t.kept || (t.kept && moved)) state.changelog.push({ at, what: `context: ${t.label}${t.kept ? '' : ' (left out)'}`, from: from.size, to: t.size, why });
    }
  }

  // 3. each market's trust in the model, refit on its graded bets
  const ledger = read(ledgerFile, { sport, bankroll: BANKROLL, bets: [] });
  const trust = { ...(state.trust ?? {}) };
  for (const market of MARKETS) {
    const t = fitTrust(
      ledger.bets.filter((b) => b.market === market && b.status !== 'open'),
      START_TRUST,
    );
    if (trust[market] && trust[market].trust !== t.trust) {
      state.changelog.push({ at, what: `${market} trust in the model`, from: trust[market].trust, to: t.trust, why: `best fit to ${t.n} graded ${market} bets (log loss ${t.logLoss})` });
    }
    trust[market] = t;
  }

  // 4. the open bets, graded
  let graded = 0;
  for (const bet of ledger.bets) {
    if (bet.status !== 'open') continue;
    const g = games.get(bet.event);
    if (!g?.final || g.hs === null) continue;
    Object.assign(bet, settle(bet, g), { gradedAt: at });
    graded++;
  }

  // (--replace: the open bets on games not started yet taken back, to be priced again with what the model
  // knows now; logged)
  let replaced = 0;
  if (REPLACE && !DRY) {
    const before = ledger.bets.length;
    ledger.bets = ledger.bets.filter((b) => !(b.status === 'open' && Date.parse(b.start) > Date.now()));
    replaced = before - ledger.bets.length;
  }

  // 5. every market of the coming games, bet once
  const placed = new Set(ledger.bets.map((b) => b.id));
  let newBets = 0;
  for (const { game, lines } of upcoming) {
    const base = expect(teams, game, params);
    const f = feats?.feats.get(game.id);
    const adjM = f && weights ? f.m.reduce((s, v, i) => s + v * weights.m[i], 0) : 0;
    const adjT = f && weights ? f.t.reduce((s, v, i) => s + v * weights.t[i], 0) : 0;
    const exp = adjust(base, adjM, adjT);
    const seen = f ? { ...f.info, adj: { margin: round(adjM, 2), total: round(adjT, 2) }, move: lines.move ?? null } : { move: lines.move ?? null };
    for (const market of price(game, exp, lines, params)) {
      const id = `${game.id}:${market.market}`;
      if (placed.has(id) && !DRY) continue;
      const pick = choose(market, trust[market.market]?.trust ?? START_TRUST, EV_SCALE);
      // (the guard: a line that's moved a lot since it opened, or a key player questionable, cuts the stake
      // to the minimum; a line that's moved twice that far skips the market this run)
      const guard = guardOf(cfg.guard, market.market, lines.move, f?.info.flags ?? []);
      if (guard?.skip) {
        if (DRY) console.log(`${sport} (dry) skipped ${game.awayAbbr} @ ${game.homeAbbr} ${market.market}: ${guard.why}; ${JSON.stringify(seen)}`);
        continue;
      }
      if (guard) pick.units = 0.5;
      const bet = {
        id,
        event: game.id,
        sport,
        start: game.date,
        placedAt: at,
        matchup: `${game.awayAbbr} @ ${game.homeAbbr}`,
        market: market.market,
        side: pick.side,
        line: pick.line,
        odds: pick.odds,
        model: round(pick.model, 4),
        fair: round(pick.fair, 4),
        p: round(pick.p, 4),
        ev: round(pick.ev, 4),
        units: pick.units,
        expMargin: round(exp.margin, 2),
        expTotal: round(exp.total, 2),
        book: lines.book,
        context: { ...seen, ...(guard ? { guard: guard.why } : {}) },
        status: 'open',
        profit: 0,
      };
      bet.pick = pickText(bet, game);
      if (DRY && market.market === 'spread') console.log(`${sport} (dry) ${bet.matchup} ${bet.pick} ${bet.units}u: ${JSON.stringify(bet.context)}`);
      ledger.bets.push(bet);
      placed.add(id);
      newBets++;
    }
  }

  if (replaced) state.changelog.push({ at, what: 'Open bets replaced', from: replaced, to: newBets, why: 'Priced again with the context the model has now (starters, weather, parks, the line-move guard)' });

  // The state: the settings and how they test, the trust, the changelog, the teams by rating
  const abbr = new Map();
  for (const g of history) {
    abbr.set(g.home, g.homeAbbr);
    abbr.set(g.away, g.awayAbbr);
  }
  Object.assign(state, {
    sport,
    label: cfg.label,
    updated: at,
    params,
    // (the whole model's: the ratings with the context; context.test has them without it too)
    test: ctxFit ? { games: ctxFit.after.n, maeMargin: round(ctxFit.after.maeMargin), maeTotal: round(ctxFit.after.maeTotal), winHit: round(ctxFit.after.winHit, 4), winLogLoss: round(ctxFit.after.winLogLoss, 4) } : best ? { games: best.test.n, maeMargin: round(best.test.maeMargin), maeTotal: round(best.test.maeTotal), winHit: round(best.test.winHit, 4), winLogLoss: round(best.test.winLogLoss, 4) } : null,
    trust,
    evScale: EV_SCALE,
    context,
    history: { games: history.length, finals: history.filter((g) => g.final).length, from: history[0]?.date ?? null },
    teams: [...teams.r.entries()]
      .map(([id, r]) => ({ id, abbr: abbr.get(id) ?? id, rating: round(r, 2), off: round(teams.o.get(id), 2), def: round(teams.d.get(id), 2) }))
      .sort((a, b) => b.rating - a.rating),
    record: record(ledger.bets),
  });
  state.changelog = state.changelog.slice(-200);
  if (!DRY) {
    write(stateFile, state);
    write(ledgerFile, ledger);
  } else console.log(`${sport} (dry): ${JSON.stringify(state.context, null, 1)}`);
  console.log(`${sport}: ${history.length} games kept; ${graded} bets graded, ${newBets} placed; record ${state.record.won}-${state.record.lost}-${state.record.push}, ${state.record.profit >= 0 ? '+' : ''}${state.record.profit}u`);
}

// The guard for a market: why to cut its stake (or skip it), or null
function guardOf(limits, market, move, flags) {
  const limit = limits?.[market];
  const moved = move?.[market];
  if (limit && moved !== null && moved !== undefined && Math.abs(moved) >= limit) {
    const why = `line moved ${moved > 0 ? '+' : ''}${moved} since it opened`;
    return Math.abs(moved) >= 2 * limit ? { skip: true, why } : { why };
  }
  if (flags.length) return { why: flags.join('; ') };
  return null;
}

// The context as the state shows it: each term's fitted size (in the sport's unit, per unit of the term),
// whether it earned its place, how many games had it, what it was worth on the held-out games; the test
// numbers with and without it
function contextState(fitted, weights) {
  const test = (r) => ({ maeMargin: round(r.maeMargin, 3), maeTotal: round(r.maeTotal, 3), winHit: round(r.winHit, 4), winLogLoss: round(r.winLogLoss, 4) });
  const sig = (v) => (v ? Number(v.toPrecision(2)) : 0);
  const each = ['m', 't'].flatMap((on) =>
    fitted.ctx.terms[on].map((t, i) => ({
      key: t.key,
      gate: t.gate ?? null,
      label: t.label,
      group: t.group,
      on: on === 'm' ? 'margin' : 'total',
      unit: t.unit,
      size: sig(weights?.[on][i] ?? 0),
      kept: !fitted.ctx.off.has(gateOf(t)),
      games: fitted.seen[on][i],
      gain: fitted.gain[gateOf(t)] === undefined ? null : round(fitted.gain[gateOf(t)] * 100, 3),
    })),
  );
  // (a park's set shows as one row per side it moves: its biggest size, and the parks that lean most)
  const terms = each.filter((t) => !t.gate);
  for (const gate of [...new Set(each.filter((t) => t.gate).map((t) => t.gate))]) {
    for (const on of ['margin', 'total']) {
      const set = each.filter((t) => t.gate === gate && t.on === on);
      if (!set.length) continue;
      const top = [...set].sort((a, b) => Math.abs(b.size) - Math.abs(a.size));
      terms.push({
        key: `${gate}:${on}`,
        label: gate === 'park' ? 'Ballparks' : on === 'margin' ? 'Ballparks by hand' : 'Ballparks by hand (total)',
        group: 'park',
        on,
        unit: `${set[0].unit.replace('this park', 'each park')} (${set.length} parks; most: ${top
          .slice(0, 3)
          .map((t) => `${t.label} ${t.size > 0 ? '+' : ''}${t.size}`)
          .join(', ')})`,
        size: top[0].size,
        kept: set[0].kept,
        games: set.reduce((s, t) => s + t.games, 0),
        gain: set[0].gain,
        parks: Object.fromEntries(set.map((t) => [t.label, t.size])),
      });
    }
  }
  return { lambda: fitted.ctx.lambda, lambdaParks: fitted.ctx.lambdaSet ?? undefined, terms, test: { games: fitted.after.n, before: test(fitted.before), after: test(fitted.after) } };
}

const DRY = process.argv.includes('--dry');
const REPLACE = process.argv.includes('--replace');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sports = args.length ? args : Object.keys(LEAGUES);
for (const sport of sports) {
  try {
    await runSport(sport);
  } catch (err) {
    console.error(`${sport}: ${err.stack ?? err}`);
    process.exitCode = 1;
  }
}
