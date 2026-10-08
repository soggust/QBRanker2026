// The model desk: code only, no AI, free. For each sport, every run:
//
//   1. the game history kept current (apps/<sport>/scripts/model/games.json: two seasons of finals from the
//      teams' schedules the first time, then the last few days' scoreboards)
//   2. the ratings refit on it (ratings.mjs: the grid's best settings at predicting the games they hadn't
//      seen yet), each setting that moves logged with why
//   3. each market's trust in the model refit on the desk's own graded bets, logged the same way
//   4. the open bets graded against their finals
//   5. every market (spread, total, moneyline) of every game starting in the next two days bet once, the
//      better side at 0.5 to 3 units (desk.mjs)
//
// What it writes (apps/<sport>/src/StaticData/model/): state.json (the settings, their test numbers, the
// changelog, the teams' ratings) and ledger.json (every bet, open or graded). The Bets page's admin panel
// (dev only) reads them.
//
//   node libs/ranker/scripts/model/run.mjs [nfl nba nhl mlb]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES } from './leagues.mjs';
import { gameOf, json, linesOf, scoreboard, teamIds, teamSchedule, ymd } from './espn.mjs';
import { expect, fit, replay, round } from './ratings.mjs';
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
  for (let d = -4; d <= 2; d++) {
    for (const e of await scoreboard(cfg.league, ymd(new Date(now.getTime() + d * DAY)))) {
      const g = gameOf(e);
      if (!g || (g.type !== 2 && g.type !== 3)) continue;
      games.set(g.id, { ...(games.get(g.id) ?? {}), ...g });
      const lines = linesOf(e);
      if (!g.final && lines && Date.parse(g.date) > now.getTime() + 5 * 60e3) upcoming.push({ game: g, lines });
    }
  }
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
  const { state: teams } = replay(history, params, 0);

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

  // 5. every market of the coming games, bet once
  const placed = new Set(ledger.bets.map((b) => b.id));
  let newBets = 0;
  for (const { game, lines } of upcoming) {
    const exp = expect(teams, game, params);
    for (const market of price(game, exp, lines, params)) {
      const id = `${game.id}:${market.market}`;
      if (placed.has(id)) continue;
      const pick = choose(market, trust[market.market]?.trust ?? START_TRUST, EV_SCALE);
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
        status: 'open',
        profit: 0,
      };
      bet.pick = pickText(bet, game);
      ledger.bets.push(bet);
      placed.add(id);
      newBets++;
    }
  }

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
    test: best ? { games: best.test.n, maeMargin: round(best.test.maeMargin), maeTotal: round(best.test.maeTotal), winHit: round(best.test.winHit, 4), winLogLoss: round(best.test.winLogLoss, 4) } : null,
    trust,
    evScale: EV_SCALE,
    history: { games: history.length, finals: history.filter((g) => g.final).length, from: history[0]?.date ?? null },
    teams: [...teams.r.entries()]
      .map(([id, r]) => ({ id, abbr: abbr.get(id) ?? id, rating: round(r, 2), off: round(teams.o.get(id), 2), def: round(teams.d.get(id), 2) }))
      .sort((a, b) => b.rating - a.rating),
    record: record(ledger.bets),
  });
  state.changelog = state.changelog.slice(-200);
  write(stateFile, state);
  write(ledgerFile, ledger);
  console.log(`${sport}: ${history.length} games kept; ${graded} bets graded, ${newBets} placed; record ${state.record.won}-${state.record.lost}-${state.record.push}, ${state.record.profit >= 0 ? '+' : ''}${state.record.profit}u`);
}

const sports = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LEAGUES);
for (const sport of sports) {
  try {
    await runSport(sport);
  } catch (err) {
    console.error(`${sport}: ${err.stack ?? err}`);
    process.exitCode = 1;
  }
}
