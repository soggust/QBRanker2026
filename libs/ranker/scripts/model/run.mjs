// The model desk: code only, no AI, free. For each sport, every run:
//
//   1. the game history kept current (apps/<sport>/scripts/model/games.json, a game a line: two seasons of
//      finals from the teams' schedules the first time, then the last few days' scoreboards)
//   2. the ratings refit on it (ratings.mjs: the grid's best settings at predicting the games they hadn't
//      seen yet), each setting that moves logged with why
//   2b. the context (context.mjs: rest, travel, starters, weather, officials and more) gathered for every game, and the size of
//      each of its terms fit on the same held-out games (ratings.mjs fitContext: a term that doesn't help is
//      left out), each size that moves logged the same way
//   3. each market's trust in the model refit on the desk's own graded bets, logged the same way
//   4. the open bets graded against their finals
//   5. every market (spread, total, moneyline) of every game starting in the next two days bet once, the
//      better side at 0.5 to 3 units (desk.mjs), cut to 0.5 (or skipped) when its line has moved a lot since it
//      opened or a key player is questionable (the guard); each bet keeps the context it saw
//
// What it writes (apps/<sport>/src/StaticData/model/): state.json (the settings, their test numbers, the
// changelog, the teams' ratings, the context's sizes) and ledger.json (every bet, open or graded), each only
// when something in it changed (a run that learned nothing new commits nothing); and the facts the context is
// built from, in .cache/model/context-<sport>.json (gitignored: a cache, rebuilt from the sources when lost).
// The Bets page's admin panel (dev only) reads state and ledger.
//
//   node libs/ranker/scripts/model/run.mjs [nfl nba nhl mlb] [--dry] [--replace] [--all-sources]
//   (--dry: no bets placed, state and ledger untouched, a snapshot of what the model made of the coming games
//   in .cache/model/dry-<sport>.json; --replace: open bets on games not started yet taken back and priced
//   again; --all-sources: every optional source asked, whether its terms are kept or not)

// (the keys: .env on this machine, the repo's secrets on GitHub; first, so every module sees them)
import '../env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BOOK, LEAGUES, PROP_CAPS } from './leagues.mjs';
import { gameOf, json, linesOf, scoreboard, teamIds, teamSchedule, ymd } from './espn.mjs';
import { adjust, expect, fit, fitContext, gateOf, replay, round } from './ratings.mjs';
import { OPTIONAL, enrich, featurize, gather } from './context.mjs';
import { finalSummary, postmortems, propPostmortem, usualRoles } from './postmortem.mjs';
import { closeOf, closingLines, clvOf, clvSummary, propCloseOf } from './clv.mjs';
import { LINE_BOOKS, SPORT_KEYS, call, canSpend, hasKey, linesFromEvent, usageSummary } from './oddsapi.mjs';
import { backtestBets, evaluate, snapshots, trustBets } from './backtest.mjs';
import { playerRows } from './playerlogs.mjs';
import { PER_GAME, STATS, apiProps, board, fitProps, priceProps, rowsIndex, settleProp, statInFinal, withApiPrices } from './props.mjs';
import { CACHE, readJson, writeJson } from './sources.mjs';
import { BANKROLL, MARKETS, choose, fairPair, fitTrust, pickText, price, record, settle } from './desk.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
// (the return a side has to show to get the 3-unit top stake; a smaller one scales down to 0.5)
const EV_SCALE = 0.08;
// (the trust a market starts at, before 40 of its bets are graded: halfway between the book and the model)
const START_TRUST = 0.5;
// (what a graded bet whose premise broke in the game counts for in the trust fit and the calibration: set by
// hand, not fit: there aren't graded bets enough yet to fit it on)
const DISRUPTED_WEIGHT = 0.3;
const DAY = 864e5;
const PROPS_ASKED = path.join(CACHE, 'odds-props.json');

const read = readJson;
const write = writeJson;

// A file the workflow commits, written only when its content changed (ignoring what changes every run: when
// it ran, the props' last-run counts); lines: an array written an item a line (small diffs)
function writeIfChanged(file, data, { lines = false } = {}) {
  const text = lines ? `[\n${data.map((x) => JSON.stringify(x)).join(',\n')}\n]\n` : JSON.stringify(data);
  const strip = (x) => (x && !Array.isArray(x) ? { ...x, updated: null, props: x.props ? { ...x.props, lastRun: null } : x.props } : x);
  const before = readJson(file, null);
  if (before && JSON.stringify(strip(before)) === JSON.stringify(strip(data))) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

// One sport's run, step by step (each step a function of the run so far: r)
async function runSport(sport) {
  const r = { sport, cfg: LEAGUES[sport], now: new Date(), newBets: 0, graded: 0 };
  r.at = r.now.toISOString();
  r.files = {
    games: path.join(ROOT, 'apps', sport, 'scripts/model/games.json'),
    state: path.join(ROOT, 'apps', sport, 'src/StaticData/model/state.json'),
    ledger: path.join(ROOT, 'apps', sport, 'src/StaticData/model/ledger.json'),
    context: path.join(CACHE, `context-${sport}.json`),
    backtest: path.join(ROOT, 'apps', sport, 'scripts/model/backtest.json'),
  };
  await loadHistory(r);
  await liveLines(r);
  fitRatings(r);
  await fitTheContext(r);
  await fitTheProps(r);
  await runBacktest(r);
  logContext(r);
  r.ledger = read(r.files.ledger, { sport, bankroll: BANKROLL, bets: [] });
  await captureClose(r);
  refitTrust(r);
  await gradeBets(r);
  replaceOpen(r);
  betGames(r);
  await betProps(r);
  saveState(r);
}

// 1. the history: games.json brought up to date from the last few days' scoreboards (and the next two: the
// coming games, with their lines), two seasons of the teams' schedules the first time
async function loadHistory(r) {
  const { sport, cfg, now } = r;
  const games = new Map(read(r.files.games, []).map((g) => [g.id, g]));
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
  for (const bet of read(r.files.ledger, { bets: [] }).bets) {
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
  r.games = games;
  r.upcoming = upcoming;
  r.history = [...games.values()].filter((g) => g.type === 2 || g.type === 3);
  writeIfChanged(r.files.games, r.history.sort((a, b) => a.date.localeCompare(b.date)), { lines: true });
}

// 1b. the coming games' lines from The Odds API (oddsapi.mjs): the desk's book's prices, Pinnacle's fair
// chance; one call for the sport (its three markets: 3 credits), only with games to bet and today's lines
// allowance left. Without it (no key, no credits, the API down), ESPN's board, which is the same book's
async function liveLines(r) {
  r.linesSource = 'espn';
  if (!r.upcoming.length || !hasKey() || !canSpend('lines', 3)) return;
  const from = r.now.toISOString().slice(0, 19) + 'Z';
  const to = new Date(r.now.getTime() + 3 * DAY).toISOString().slice(0, 19) + "Z";
  const events = await call('lines', `/sports/${SPORT_KEYS[r.sport]}/odds`, { markets: 'h2h,spreads,totals', bookmakers: LINE_BOOKS.join(','), commenceTimeFrom: from, commenceTimeTo: to });
  if (!Array.isArray(events)) return;
  let matched = 0;
  for (const u of r.upcoming) {
    const ev = events.find((x) => sameGame(x, u));
    const l = ev && linesFromEvent(ev);
    if (!l) continue;
    const odds = { spread: l.spreads, total: l.totals, ml: l.h2h };
    u.lines = {
      book: 'DraftKings',
      source: 'the odds api',
      oddsEvent: ev.id,
      move: u.lines.move,
      ml: { home: l.h2h?.prices.home ?? null, away: l.h2h?.prices.away ?? null },
      spread: { home: { line: l.spreads?.line ?? null, odds: l.spreads?.prices.home ?? null }, away: { line: l.spreads ? -l.spreads.line : null, odds: l.spreads?.prices.away ?? null } },
      total: { line: l.totals?.line ?? null, over: l.totals?.prices.over ?? null, under: l.totals?.prices.under ?? null },
      fair: Object.fromEntries(Object.entries(odds).filter(([, v]) => v).map(([k, v]) => [k, v.fair])),
      fairSource: Object.fromEntries(Object.entries(odds).filter(([, v]) => v).map(([k, v]) => [k, v.sharp !== null ? 'pinnacle' : BOOK])),
    };
    matched++;
  }
  r.linesSource = `the odds api (${matched} of ${r.upcoming.length} games)`;
  r.oddsEvents = events;
  console.log(`${r.sport}: lines from The Odds API for ${matched} of ${r.upcoming.length} coming games`);
}

// (an Odds API event is a coming ESPN game: the same two teams, by nickname, within six hours)
function sameGame(ev, u) {
  const sides = u.event?.competitions?.[0]?.competitors ?? [];
  const nick = (where) => sides.find((c) => c.homeAway === where)?.team?.name ?? null;
  const is = (full, n) => !!n && (full === n || full.endsWith(` ${n}`));
  return is(ev.home_team, nick('home')) && is(ev.away_team, nick('away')) && Math.abs(Date.parse(ev.commence_time) - Date.parse(u.game.date)) < 6 * 36e5;
}

// 2. the ratings, refit (each setting that moves logged with why)
function fitRatings(r) {
  const { cfg, at } = r;
  const state = read(r.files.state, { sport: r.sport, changelog: [] });
  const before = state.params ?? cfg.priors;
  const best = fit(r.history, { ...cfg.priors, sigma: before.sigma ?? cfg.priors.sigma, sigmaT: before.sigmaT ?? cfg.priors.sigmaT }, cfg.grid);
  const params = best?.params ?? before;
  const why = best ? `on ${best.test.n} games it hadn't seen: margins off by ${round(best.test.maeMargin)}, totals by ${round(best.test.maeTotal)}, winners ${round(best.test.winHit * 100, 1)}% right` : 'not enough history';
  for (const key of ['k', 'hfa', 'revert', 'kO']) {
    if (state.params && state.params[key] !== params[key]) state.changelog.push({ at, what: `ratings ${key}`, from: state.params[key], to: params[key], why });
  }
  Object.assign(r, { state, best, params });
}

// 2b. the context: its facts brought up to date, each game's terms, their sizes fit (nothing here may stop
// the run: without it, every term is 0 and the ratings bet alone); then the ratings replayed with it, each
// final's expected score kept (the props' game script)
async function fitTheContext(r) {
  const { sport, cfg, history, params } = r;
  r.facts = read(r.files.context, {});
  r.ctxFit = null;
  r.feats = null;
  r.live = new Map();
  try {
    const t0 = Date.now();
    r.live = await gather(sport, cfg, history, r.upcoming, r.facts, wantSource(r), (r.times = {}));
    const { nfl: _rows, ...kept } = r.facts;
    write(r.files.context, kept);
    r.feats = featurize(sport, cfg, history, r.facts, r.live);
    r.ctxFit = fitContext(history, params, r.feats.feats, r.feats.terms);
    console.log(`${sport}: context gathered and fit in ${Math.round((Date.now() - t0) / 1000)}s (${Object.entries(r.times)
      .map(([k, v]) => `${k} ${(v.ms / 1000).toFixed(1)}s${v.ok ? '' : ' failed'}`)
      .join(', ')}${Object.entries(r.asked).filter(([, v]) => v === 'skipped').length ? `; skipped ${Object.entries(r.asked).filter(([, v]) => v === 'skipped').map(([k]) => k).join(', ')}` : ''})`);
  } catch (err) {
    console.warn(`${sport}: context left out (${err.stack ?? err})`);
  }
  // (with the context, the spreads around its expectations are the ones it priced with)
  if (r.ctxFit) Object.assign(params, { sigma: round(r.ctxFit.after.sigma, 3), sigmaT: round(r.ctxFit.after.sigmaT, 3) });
  r.expPts = new Map();
  r.expAll = new Map();
  r.teams = replay(history, params, 0, r.ctxFit?.ctx ?? null, (g, e) => {
    r.expPts.set(g.id, [e.homePts, e.awayPts]);
    r.expAll.set(g.id, e);
  }).state;
  r.weights = r.teams.weights ?? null;
}

// Whether to ask an optional source this run (context.mjs OPTIONAL): while any term it feeds has earned its
// place or hasn't been tried; otherwise once a week, or once the history has 30% more games, since it was last
// asked. Each ask is noted (state.retest)
function wantSource(r) {
  const terms = r.state.context?.terms ?? [];
  const kept = new Set(terms.filter((t) => t.kept).map((t) => t.key));
  const known = new Set(terms.map((t) => t.key));
  const finals = r.history.filter((g) => g.final).length;
  r.state.retest ??= {};
  r.asked = {};
  return (source) => {
    const feeds = OPTIONAL[r.sport]?.[source] ?? [];
    const last = r.state.retest[source];
    const needed = ALL_SOURCES || !terms.length || feeds.some((k) => kept.has(k) || !known.has(k));
    const due = !last || r.now.getTime() - Date.parse(last.at) >= 7 * DAY || finals >= 1.3 * last.games;
    const ask = needed || due;
    r.asked[source] = ask ? (needed ? 'needed' : 're-test') : 'skipped';
    if (ask && !needed && !DRY) r.state.retest[source] = { at: r.at, games: finals };
    if (ask && needed) r.state.retest[source] = { at: r.at, games: finals };
    return ask;
  };
}

// A coming game's expectation: the ratings', with its context terms at their fitted sizes
function expectFor(r, game) {
  const base = expect(r.teams, game, r.params);
  const f = r.feats?.feats.get(game.id);
  const adjM = f && r.weights ? f.m.reduce((s, v, i) => s + v * r.weights.m[i], 0) : 0;
  const adjT = f && r.weights ? f.t.reduce((s, v, i) => s + v * r.weights.t[i], 0) : 0;
  return { exp: adjust(base, adjM, adjT), f, adjM, adjT };
}

// 2c. the props: every player's game lines, and each prop type's projection fit and checked on them
async function fitTheProps(r) {
  const { sport, cfg, history } = r;
  r.props = null;
  r.rows = [];
  try {
    const t0 = Date.now();
    r.rows = await playerRows(sport, cfg, history, r.facts);
    const info = new Map([...(r.feats?.feats ?? new Map())].map(([id, f]) => [id, f.info]));
    r.props = fitProps(sport, r.rows, r.expPts, info);
    console.log(`${sport}: props' projections fit on ${r.rows.length} player games in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (err) {
    console.warn(`${sport}: props left out (${err.stack ?? err})`);
  }
}

// 2d. the backtest (backtest.mjs): with --backtest, the plan's historical snapshots bought (within history's
// budget) and the bets drawn from them saved (backtest.json, committed); every run, the saved bets read back,
// each market's numbers worked out for the state, and the bets kept for the trust fit
async function runBacktest(r) {
  const { sport, history, params } = r;
  if (BACKTEST && hasKey()) {
    const t0 = Date.now();
    const { snaps, bought, planned } = await snapshots(sport);
    const bets = backtestBets(sport, snaps, history, r.expAll, params, r.facts.teams ?? []);
    writeIfChanged(r.files.backtest, { at: r.at, planned, snapshots: snaps.length, bets });
    console.log(`${sport}: backtest on ${snaps.length} of ${planned} snapshots (${bought} bought), ${bets.length / 2} bets a side, in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const saved = read(r.files.backtest, null);
  r.backtestBets = trustBets(saved?.bets ?? []);
  r.backtest = saved ? { at: saved.at, snapshots: saved.snapshots, planned: saved.planned, markets: evaluate(saved.bets) } : null;
}

// The context as the state shows it; logged: a term joining or leaving, or its size moving a tenth or more
// (the first fit logs each it keeps)
function logContext(r) {
  const { ctxFit, state, at } = r;
  r.context = ctxFit ? contextState(ctxFit, r.weights) : (state.context ?? null);
  if (!ctxFit) return;
  const was = new Map((state.context?.terms ?? []).map((t) => [t.key, t]));
  const why = `on ${ctxFit.after.n} games it hadn't seen: margins off by ${round(ctxFit.after.maeMargin)} (${round(ctxFit.before.maeMargin)} without the context), totals by ${round(ctxFit.after.maeTotal)} (${round(ctxFit.before.maeTotal)}), winners ${round(ctxFit.after.winHit * 100, 1)}% right (${round(ctxFit.before.winHit * 100, 1)}%)`;
  for (const t of r.context.terms) {
    const from = was.get(t.key) ?? { size: 0, kept: false };
    const moved = Math.abs(t.size - from.size) >= 0.1 * Math.max(Math.abs(t.size), Math.abs(from.size));
    if (from.kept !== t.kept || (t.kept && moved)) state.changelog.push({ at, what: `context: ${t.label}${t.kept ? '' : ' (left out)'}`, from: from.size, to: t.size, why });
  }
}

// 3. each market's trust in the model, and each prop type's in its projection, refit on its graded bets
function refitTrust(r) {
  const { state, at } = r;
  const trust = { ...(state.trust ?? {}) };
  const refit = (key, bets, words) => {
    const t = fitTrust(bets, START_TRUST);
    if (trust[key] && trust[key].trust !== t.trust) state.changelog.push({ at, what: words.what, from: trust[key].trust, to: t.trust, why: `best fit to ${t.n} graded ${words.bets} and ${t.clvN} closing lines (log loss ${t.logLoss})` });
    trust[key] = t;
  };
  // (each one's bets with a result or a close: clv.mjs; and a market's backtest bets, the history's real lines
  // and results, so its trust is fitted from the start, the live bets adding to them as they come)
  const evidence = (b) => b.status !== 'open' || b.clv;
  for (const market of MARKETS) {
    refit(market, [...(r.backtestBets ?? []).filter((b) => b.market === market), ...r.ledger.bets.filter((b) => b.market === market && evidence(b))], { what: `${market} trust in the model`, bets: `${market} bets (backtest and live)` });
    trust[market].backtest = (r.backtestBets ?? []).filter((b) => b.market === market).length;
  }
  // (start 0.5, refit once 40 of its bets are graded)
  for (const st of STATS[r.sport]) {
    refit(
      `prop:${st.key}`,
      r.ledger.bets.filter((b) => b.market === 'prop' && b.propType === st.key && evidence(b) && !b.void),
      { what: `${st.label} props' trust in the projection`, bets: `${st.label} props` },
    );
  }
  r.trust = trust;
}

// 3b. each bet's close, once its game has started (the core API keeps it after kickoff), and its CLV
// (clv.mjs); a close the API never gives (it's failed for 3 days) is taken as the last line a run saw
async function captureClose(r) {
  const { sport, cfg, games, params } = r;
  const started = r.ledger.bets.filter((b) => !b.clv && Date.parse(b.start) <= r.now.getTime());
  const events = [...new Set(started.map((b) => b.event))];
  let got = 0;
  for (const id of events) {
    const mine = started.filter((b) => b.event === id);
    const game = games.get(id);
    try {
      const lines = mine.some((b) => b.market !== 'prop') ? await closingLines(cfg.league, id) : null;
      const props = mine.some((b) => b.market === 'prop') && game ? await board(sport, cfg.league, game) : [];
      for (const bet of mine) {
        let close = bet.market === 'prop' ? propCloseOf(bet, props) : closeOf(bet, lines);
        if (close) close.source = 'close';
        // (a prop whose board kept no price (the NFL's): the line and price The Odds API gave near the start)
        if (bet.market === 'prop' && close && close.odds === null && bet.seen && Date.parse(bet.start) - Date.parse(bet.seen.at) < 3 * 36e5) close = { ...bet.seen, source: 'odds api near the start' };
        else if (bet.seen && r.now.getTime() - Date.parse(bet.start) > 3 * DAY) close = { ...bet.seen, source: 'last seen' };
        if (!close) continue;
        bet.close = close;
        bet.clv = clvOf(bet, close, bet.market === 'total' ? params.sigmaT : params.sigma);
        got++;
      }
    } catch (err) {
      console.warn(`${sport}: close for ${id} not read (${err.message})`);
    }
  }
  if (started.length) console.log(`${sport}: closing lines for ${got} of ${started.length} bets on games under way or played`);
}

// 4. the open bets graded against their finals (a prop from its box score: a player who didn't play is no
// action), and each graded bet's post-mortem
async function gradeBets(r) {
  const { sport, cfg, games, at } = r;
  for (const bet of r.ledger.bets) {
    if (bet.status !== 'open' || bet.market === 'prop') continue;
    const g = games.get(bet.event);
    if (!g?.final || g.hs === null) continue;
    Object.assign(bet, settle(bet, g), { gradedAt: at });
    r.graded++;
  }
  for (const bet of r.ledger.bets) {
    if (bet.status !== 'open' || bet.market !== 'prop') continue;
    const g = games.get(bet.event);
    if (!g?.final || g.hs === null) continue;
    try {
      const body = await finalSummary(sport, cfg.league, g.id);
      if (!body) continue;
      Object.assign(bet, settleProp(bet, await statInFinal(sport, bet, body, r.facts.games?.[g.id]?.pk)), { gradedAt: at });
      Object.assign(bet, propPostmortem(sport, bet, g, body, r.rows, DISRUPTED_WEIGHT, await usualRoles(sport, g, r.facts, r.history).catch(() => null)));
      r.graded++;
    } catch (err) {
      console.warn(`${sport}: prop ${bet.id} not graded (${err.message})`);
    }
  }
  // (the ones just graded, and any graded before there were post-mortems)
  try {
    const todo = r.ledger.bets.filter((b) => b.status !== 'open' && !b.why && b.market !== 'prop');
    if (todo.length) console.log(`${sport}: post-mortems for ${await postmortems(sport, cfg.league, todo, games, r.facts, r.history, DISRUPTED_WEIGHT)} of ${todo.length} graded bets`);
  } catch (err) {
    console.warn(`${sport}: post-mortems skipped (${err.message})`);
  }
}

// (--replace: the open bets on games not started yet taken back, to be priced again with what the model
// knows now; logged once the new ones are placed)
function replaceOpen(r) {
  r.replaced = 0;
  if (REPLACE && !DRY) {
    const before = r.ledger.bets.length;
    r.ledger.bets = r.ledger.bets.filter((b) => !(b.status === 'open' && Date.parse(b.start) > Date.now()));
    r.replaced = before - r.ledger.bets.length;
  }
  r.placed = new Set(r.ledger.bets.map((b) => b.id));
  // (--dry: what the model made of each coming game, to compare one version of the code with another)
  r.snapshot = { exp: {}, projections: {} };
}

// 5. every market of the coming games, bet once: the better side at 0.5 to 3 units, cut or skipped by the
// guard; each bet keeps the context it saw
function betGames(r) {
  const { sport, cfg, params, trust, at } = r;
  for (const { game, lines } of r.upcoming) {
    const { exp, f, adjM, adjT } = expectFor(r, game);
    const fairFrom = lines.fairSource ?? {};
    r.snapshot.exp[game.id] = [round(exp.margin, 4), round(exp.total, 4)];
    const seen = f ? { ...f.info, adj: { margin: round(adjM, 2), total: round(adjT, 2) }, move: lines.move ?? null } : { move: lines.move ?? null };
    for (const market of price(game, exp, lines, params)) {
      const id = `${game.id}:${market.market}`;
      if (r.placed.has(id) && !DRY) {
        // (a bet already placed: the line this run saw for its side, the stand-in for its close)
        const bet = r.ledger.bets.find((b) => b.id === id);
        const s = market.sides.find((x) => x.side === bet?.side);
        if (bet && s) bet.seen = { at, line: s.line ?? null, odds: s.odds, fair: round(s.fair, 4) };
        continue;
      }
      const pick = choose(market, trust[market.market]?.trust ?? START_TRUST, EV_SCALE);
      // (the guard: a line that's moved a lot since it opened (less what the context explains), or a key player
      // questionable, cuts the stake to the minimum; a line that's moved twice that far skips the market this run)
      const guard = guardOf(cfg.guard, market.market, lines.move, f?.info.flags ?? [], { m: adjM, t: adjT }, params.sigma);
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
        fairFrom: fairFrom[market.market] ?? 'its own prices',
        context: { ...seen, ...(guard ? { guard: guard.why } : {}) },
        status: 'open',
        profit: 0,
      };
      bet.pick = pickText(bet, game);
      if (DRY && market.market === 'spread') console.log(`${sport} (dry) ${bet.matchup} ${bet.pick} ${bet.units}u: ${JSON.stringify(bet.context)}`);
      r.ledger.bets.push(bet);
      r.placed.add(id);
      r.newBets++;
    }
  }
}

// 6. the props of the coming games: each main line projected and priced; the ones with an edge bet, the
// day's best first, under the caps (props.mjs; leagues.mjs PROP_CAPS)
async function betProps(r) {
  const { sport, cfg, state, trust, ledger, at } = r;
  const run = { games: 0, priced: 0, under: 0, even: 0, evenUnder: 0, bet: 0, units: 0 };
  r.propRun = run;
  if (!r.props || !Object.keys(r.props).length) return;
  const idx = rowsIndex(sport, r.rows);
  const candidates = [];
  // (the caps: a prop type not yet tested (its trust unfit) stakes little; the day is the game's US date)
  const dayOf = (iso) => new Date(Date.parse(iso) - 5 * 36e5).toISOString().slice(0, 10);
  const capsOf = (key) => (trust[`prop:${key}`]?.fitted ? PROP_CAPS.tested : PROP_CAPS.untested);
  const untestedUnits = (day) => ledger.bets.filter((b) => b.market === 'prop' && !b.tested && dayOf(b.start) === day).reduce((t, b) => t + b.units, 0);
  if (JSON.stringify(state.propCaps ?? null) !== JSON.stringify(PROP_CAPS)) {
    state.changelog.push({ at, what: 'Prop caps', from: state.propCaps ? 'before' : 'none', to: `${PROP_CAPS.untested.maxUnits}u, ${PROP_CAPS.untested.perGame} a game, ${PROP_CAPS.untested.perDay}u a day`, why: 'Props are untested and priced at an assumed -110: until a type has 40 graded (its trust fit), at most 1 unit a prop, 3 props a game, 10 units a day in the sport; then 3 units and 8 a game' });
    state.propCaps = PROP_CAPS;
  }
  // (The Odds API's props for a game, the desk's book's: asked twice at most, once to bet (within 30 hours of
  // the start) and once near it (within 2.5 hours, if it has prop bets open: their last line and price before
  // the close, the NFL's CLV); the count kept in .cache/model/odds-props.json)
  const asked = read(PROPS_ASKED, {});
  for (const u of r.upcoming) {
    const game = u.game;
    try {
      let board_ = await board(sport, cfg.league, game);
      if (!board_.length) continue;
      const until = Date.parse(game.date) - r.now.getTime();
      const times = asked[game.id] ?? 0;
      const open = ledger.bets.filter((b) => b.event === game.id && b.market === 'prop' && b.status === 'open');
      const wanted = u.lines.oddsEvent && !DRY && until < 30 * 36e5 && (times === 0 || (times === 1 && until < 2.5 * 36e5 && open.length));
      if (wanted) {
        const api = await apiProps(sport, u.lines.oddsEvent);
        if (api) {
          asked[game.id] = times + 1;
          write(PROPS_ASKED, asked);
          board_ = withApiPrices(board_, api);
          run.api = (run.api ?? 0) + 1;
          // (near the start: each open prop's line and price as the stand-in for its close)
          if (times === 1) {
            for (const b of open) {
              const p = board_.find((x) => String(x.athlete.id) === String(b.athlete) && x.stat.key === b.propType && x.prices);
              if (p) b.seen = { at: r.at, line: p.line, odds: b.side === 'over' ? p.prices.over : p.prices.under, fair: b.side === 'over' ? fairPair(p.prices.over, p.prices.under) : fairPair(p.prices.under, p.prices.over) };
            }
          }
        }
      }
      run.games++;
      const { exp, f } = expectFor(r, game);
      const { priced, bets } = priceProps(sport, game, board_, r.props, idx, exp, f?.info ?? null, r.live.get(game.id), trust, EV_SCALE);
      run.priced += priced.length;
      run.under += priced.filter((x) => x.side === 'under').length;
      // (the ones at an even line: the ones it could bet)
      const even = priced.filter((x) => !x.guard?.skip);
      run.even += even.length;
      run.evenUnder += even.filter((x) => x.side === 'under').length;
      // (with The Odds API to hand, a prop waits for its real price (asked within 30 hours of the start)
      // rather than going at the assumed -110: that's only the fallback when the API can't be had)
      for (const x of bets) if (x.priced || !hasKey()) candidates.push({ game, x, exp });
      for (const x of priced) r.snapshot.projections[`${game.id}:${x.prop.stat.key}:${x.prop.athlete.id}`] = [x.projection.mean, x.prop.line, x.projection.pOver];
    } catch (err) {
      console.warn(`${sport}: props for ${game.id} skipped (${err.message})`);
    }
  }
  for (const { game, x, exp } of candidates.sort((a, b) => b.x.ev - a.x.ev)) {
    const mine = ledger.bets.filter((b) => b.event === game.id && b.market === 'prop');
    const id = `${game.id}:prop:${x.prop.stat.key}:${x.prop.athlete.id}`;
    if (r.placed.has(id) && !DRY) continue;
    const caps = capsOf(x.prop.stat.key);
    const tested = caps === PROP_CAPS.tested;
    const inGame = mine.filter((b) => (tested ? true : !b.tested)).length;
    if (inGame >= caps.perGame || mine.length >= PER_GAME) continue;
    x.units = Math.min(x.units, caps.maxUnits);
    if (!tested && untestedUnits(dayOf(game.date)) + x.units > caps.perDay) continue;
    const bet = {
      id,
      event: game.id,
      sport,
      start: game.date,
      placedAt: at,
      matchup: `${game.awayAbbr} @ ${game.homeAbbr}`,
      market: 'prop',
      propType: x.prop.stat.key,
      statLabel: x.prop.stat.label,
      player: x.prop.athlete.name,
      athlete: x.prop.athlete.id,
      side: x.side,
      line: x.prop.line,
      odds: x.odds,
      oddsAssumed: !x.priced,
      model: round(x.model, 4),
      fair: round(x.fair, 4),
      p: round(x.p, 4),
      ev: round(x.ev, 4),
      units: x.units,
      expMargin: round(exp.margin, 2),
      expTotal: round(exp.total, 2),
      book: 'DraftKings',
      pricesFrom: x.prop.source ?? (x.priced ? 'espn' : 'assumed -110'),
      projection: x.projection,
      tested,
      context: { move: x.move, ...(x.guard ? { guard: x.guard.why } : {}) },
      status: 'open',
      profit: 0,
    };
    bet.pick = `${bet.player} ${bet.side === 'over' ? 'Over' : 'Under'} ${bet.line} ${bet.statLabel}`;
    if (DRY) console.log(`${sport} (dry) prop ${bet.matchup} ${bet.pick} ${bet.units}u p ${bet.p} ev ${bet.ev}: ${JSON.stringify(bet.projection)}${x.guard ? ` [${x.guard.why}]` : ''}`);
    ledger.bets.push(bet);
    r.placed.add(id);
    run.bet++;
    run.units += bet.units;
    r.newBets++;
  }
  if (run.priced) console.log(`${sport}: props priced ${run.priced} in ${run.games} games (${Math.round((100 * run.under) / run.priced)}% under; at even lines ${run.even}, ${Math.round((100 * run.evenUnder) / Math.max(1, run.even))}% under), bet ${run.bet} for ${run.units}u`);
}

// The state: the settings and how they test, the trust, the context, the props, the changelog, the teams by
// rating; written with the ledger (--dry: the snapshot instead)
function saveState(r) {
  const { sport, cfg, state, history, ctxFit, best, ledger, trust, at } = r;
  if (r.replaced) state.changelog.push({ at, what: 'Open bets replaced', from: r.replaced, to: r.newBets, why: 'Priced again with the context the model has now (its terms as fit this run: see Context)' });
  const abbr = new Map();
  for (const g of history) {
    abbr.set(g.home, g.homeAbbr);
    abbr.set(g.away, g.awayAbbr);
  }
  const testOf = (t) => ({ games: t.n, maeMargin: round(t.maeMargin), maeTotal: round(t.maeTotal), winHit: round(t.winHit, 4), winLogLoss: round(t.winLogLoss, 4) });
  Object.assign(state, {
    sport,
    label: cfg.label,
    updated: at,
    params: r.params,
    // (the whole model's: the ratings with the context; context.test has them without it too)
    test: ctxFit ? testOf(ctxFit.after) : best ? testOf(best.test) : null,
    trust,
    evScale: EV_SCALE,
    context: r.context,
    // (each source's time this run and whether it was asked: needed, a re-test, or skipped)
    sources: Object.fromEntries([...new Set([...Object.keys(r.times ?? {}), ...Object.keys(r.asked ?? {})])].map((k) => [k, { ...(r.times?.[k] ?? {}), asked: r.asked?.[k] ?? 'always', feeds: OPTIONAL[sport]?.[k] ?? null }])),
    props: r.props
      ? {
          odds: "DraftKings' prices where the board has them (NBA, NHL, MLB); else -110 a side assumed, lines far from the player's usual not bet (NFL)",
          perGame: PER_GAME,
          lastRun: r.propRun,
          types: Object.entries(r.props).map(([key, f]) => ({ key, label: f.stat.label, rows: f.rows, eligible: f.eligible, params: f.params, check: f.check, allPlayersBias: f.checkAll?.bias ?? null, trust: trust[`prop:${key}`] ?? null })),
        }
      : (state.props ?? null),
    postmortem: (() => {
      const done = ledger.bets.filter((b) => b.status !== 'open' && b.why);
      return { graded: done.length, disrupted: done.filter((b) => (b.weight ?? 1) < 1).length, weight: DISRUPTED_WEIGHT, fitted: false };
    })(),
    history: { games: history.length, finals: history.filter((g) => g.final).length, from: history[0]?.date ?? null },
    teams: [...r.teams.r.entries()]
      .map(([id, rating]) => ({ id, abbr: abbr.get(id) ?? id, rating: round(rating, 2), off: round(r.teams.o.get(id), 2), def: round(r.teams.d.get(id), 2) }))
      .sort((a, b) => b.rating - a.rating),
    record: record(ledger.bets),
    // (the lines' source this run, and The Odds API's credits)
    lines: r.linesSource,
    backtest: r.backtest,
    book: BOOK,
    odds: hasKey() ? usageSummary() : null,
    clv: { all: clvSummary(ledger.bets), ...Object.fromEntries([...MARKETS, 'prop'].map((m) => [m, clvSummary(ledger.bets.filter((b) => b.market === m))])) },
  });
  state.changelog = state.changelog.slice(-200);
  if (!DRY) {
    writeIfChanged(r.files.state, state);
    writeIfChanged(r.files.ledger, ledger);
  } else {
    write(path.join(ROOT, '.cache/model', `dry-${sport}.json`), {
      params: state.params,
      terms: (state.context?.terms ?? []).map((t) => [t.key, t.size, t.kept]),
      props: state.props?.types?.map((t) => [t.key, t.params]) ?? null,
      trust: state.trust,
      ...r.snapshot,
    });
    console.log(`${sport} (dry): snapshot in .cache/model/dry-${sport}.json`);
  }
  console.log(`${sport}: ${history.length} games kept; ${r.graded} bets graded, ${r.newBets} placed; record ${state.record.won}-${state.record.lost}-${state.record.push}, ${state.record.profit >= 0 ? '+' : ''}${state.record.profit}u`);
}

// The guard for a market: why to cut its stake (or skip it), or null
// A move the model's own context explains (it saw the backup QB the line moved for, and moved its number
// the same way) doesn't count against the bet: only what's left of the move once the context's shift is
// taken off it does. A context shift the other way explains nothing. Each in the line's own units: the
// home side's points (a home spread moving down is the market moving toward home), the total's points,
// the moneyline's home chance (its points through the margin spread: a chance near even moves about
// 0.4 / sigma a point).
function guardOf(limits, market, move, flags, adj = { m: 0, t: 0 }, sigma = null) {
  const limit = limits?.[market];
  const moved = move?.[market];
  if (limit && moved !== null && moved !== undefined) {
    const toPoints = market === 'ml' ? (sigma ? sigma / 0.4 : null) : 1;
    // (the market's move and the context's shift, both as points toward home / onto the total)
    const market_ = market === 'spread' ? -moved : market === 'total' ? moved : toPoints ? moved * toPoints : null;
    const shift = market === 'total' ? adj.t : adj.m;
    const explained = market_ !== null && Math.sign(shift) === Math.sign(market_) ? Math.min(Math.abs(shift), Math.abs(market_)) : 0;
    const left = market_ === null ? Math.abs(moved) : (Math.abs(market_) - explained) / (toPoints ?? 1);
    if (left >= limit) {
      const why = `line moved ${moved > 0 ? '+' : ''}${moved} since it opened${explained ? ` (${round(explained, 1)} of it explained by the context)` : ''}`;
      return left >= 2 * limit ? { skip: true, why } : { why };
    }
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
// (--all-sources: every optional source asked this run, kept terms or not: a re-test by hand)
const ALL_SOURCES = process.argv.includes('--all-sources');
// (--backtest: the backtest's historical snapshots bought, within history's budget: backtest.mjs)
const BACKTEST = process.argv.includes('--backtest');
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
