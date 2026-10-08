// The model desk: code only, no AI, free. For each sport, every run:
//
//   1. the game history kept current (apps/<sport>/scripts/model/games.json: two seasons of finals from the
//      teams' schedules the first time, then the last few days' scoreboards)
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
// changelog, the teams' ratings, the context's sizes) and ledger.json (every bet, open or graded); and
// apps/<sport>/scripts/model/context.json, the facts the context is built from. The Bets page's admin panel
// (dev only) reads them.
//
//   node libs/ranker/scripts/model/run.mjs [nfl nba nhl mlb] [--dry] [--replace]   (--dry: no bets placed, state and ledger
//   untouched; --replace: open bets on games not started yet are taken back and priced again)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LEAGUES, PROP_CAPS } from './leagues.mjs';
import { gameOf, json, linesOf, scoreboard, teamIds, teamSchedule, ymd } from './espn.mjs';
import { adjust, expect, fit, fitContext, gateOf, replay, round } from './ratings.mjs';
import { enrich, featurize, gather } from './context.mjs';
import { finalSummary, postmortems, propPostmortem, usualRoles } from './postmortem.mjs';
import { playerRows } from './playerlogs.mjs';
import { PER_GAME, STATS, board, fitProps, priceProps, rowsIndex, settleProp, statInFinal } from './props.mjs';
import { BANKROLL, MARKETS, choose, fitTrust, pickText, price, record, settle } from './desk.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
// (the return a side has to show to get the 3-unit top stake; a smaller one scales down to 0.5)
const EV_SCALE = 0.08;
// (the trust a market starts at, before 40 of its bets are graded: halfway between the book and the model)
const START_TRUST = 0.5;
// (what a graded bet whose premise broke in the game counts for in the trust fit and the calibration: set by
// hand, not fit: there aren't graded bets enough yet to fit it on)
const DISRUPTED_WEIGHT = 0.3;
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
  let live = new Map();
  try {
    const t0 = Date.now();
    live = await gather(sport, cfg, history, upcoming, facts);
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
  // (each final's expected score, for the props' game script)
  const expPts = new Map();
  const { state: teams } = replay(history, params, 0, ctxFit?.ctx ?? null, (g, e) => expPts.set(g.id, [e.homePts, e.awayPts]));

  // 2c. the props: every player's game lines, and each prop type's projection fit and checked on them
  let props = null;
  let rows = [];
  try {
    const t0 = Date.now();
    rows = await playerRows(sport, cfg, history, facts);
    const info = new Map([...(feats?.feats ?? new Map())].map(([id, f]) => [id, f.info]));
    props = fitProps(sport, rows, expPts, info);
    console.log(`${sport}: props' projections fit on ${rows.length} player games in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (err) {
    console.warn(`${sport}: props left out (${err.stack ?? err})`);
  }
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
  // (each prop type's trust in its projection, the same way: start 0.5, refit once 40 of its bets are graded)
  for (const st of STATS[sport]) {
    const key = `prop:${st.key}`;
    const t = fitTrust(
      ledger.bets.filter((b) => b.market === 'prop' && b.propType === st.key && b.status !== 'open' && !b.void),
      START_TRUST,
    );
    if (trust[key] && trust[key].trust !== t.trust) state.changelog.push({ at, what: `${st.label} props' trust in the projection`, from: trust[key].trust, to: t.trust, why: `best fit to ${t.n} graded ${st.label} props (log loss ${t.logLoss})` });
    trust[key] = t;
  }

  // 4. the open bets, graded
  let graded = 0;
  for (const bet of ledger.bets) {
    if (bet.status !== 'open' || bet.market === 'prop') continue;
    const g = games.get(bet.event);
    if (!g?.final || g.hs === null) continue;
    Object.assign(bet, settle(bet, g), { gradedAt: at });
    graded++;
  }
  // (the props: each player's stat in the final, from its box score; a player who didn't play: no action)
  for (const bet of ledger.bets) {
    if (bet.status !== 'open' || bet.market !== 'prop') continue;
    const g = games.get(bet.event);
    if (!g?.final || g.hs === null) continue;
    try {
      const body = await finalSummary(sport, cfg.league, g.id);
      if (!body) continue;
      Object.assign(bet, settleProp(bet, await statInFinal(sport, bet, body, facts.games?.[g.id]?.pk)), { gradedAt: at });
      Object.assign(bet, propPostmortem(sport, bet, g, body, rows, DISRUPTED_WEIGHT, await usualRoles(sport, g, facts, history).catch(() => null)));
      graded++;
    } catch (err) {
      console.warn(`${sport}: prop ${bet.id} not graded (${err.message})`);
    }
  }
  // (each graded bet's post-mortem: the ones just graded, and any graded before there were post-mortems)
  try {
    const todo = ledger.bets.filter((b) => b.status !== 'open' && !b.why && b.market !== 'prop');
    if (todo.length) console.log(`${sport}: post-mortems for ${await postmortems(sport, cfg.league, todo, games, facts, history, DISRUPTED_WEIGHT)} of ${todo.length} graded bets`);
  } catch (err) {
    console.warn(`${sport}: post-mortems skipped (${err.message})`);
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

  // 6. the props of the coming games: each main line projected and priced; the ones with an edge bet, best
  // first, at most PER_GAME a game (props.mjs)
  const propRun = { games: 0, priced: 0, under: 0, even: 0, evenUnder: 0, bet: 0, units: 0 };
  if (props && Object.keys(props).length) {
    const idx = rowsIndex(sport, rows);
    const candidates = [];
    const dumped = [];
    // (the caps: a prop type not yet tested (its trust unfit) stakes little; the day is the game's US date)
    const dayOf = (iso) => new Date(Date.parse(iso) - 5 * 36e5).toISOString().slice(0, 10);
    const capsOf = (key) => (trust[`prop:${key}`]?.fitted ? PROP_CAPS.tested : PROP_CAPS.untested);
    const untestedUnits = (day) => ledger.bets.filter((b) => b.market === 'prop' && !b.tested && dayOf(b.start) === day).reduce((t, b) => t + b.units, 0);
    if (JSON.stringify(state.propCaps ?? null) !== JSON.stringify(PROP_CAPS)) {
      state.changelog.push({ at, what: 'Prop caps', from: state.propCaps ? 'before' : 'none', to: `${PROP_CAPS.untested.maxUnits}u, ${PROP_CAPS.untested.perGame} a game, ${PROP_CAPS.untested.perDay}u a day`, why: 'Props are untested and priced at an assumed -110: until a type has 40 graded (its trust fit), at most 1 unit a prop, 3 props a game, 10 units a day in the sport; then 3 units and 8 a game' });
      state.propCaps = PROP_CAPS;
    }
    for (const { game } of upcoming) {
      try {
        const board_ = await board(sport, cfg.league, game);
        if (!board_.length) continue;
        propRun.games++;
        const base = expect(teams, game, params);
        const f = feats?.feats.get(game.id);
        const adjM = f && weights ? f.m.reduce((s, v, i) => s + v * weights.m[i], 0) : 0;
        const adjT = f && weights ? f.t.reduce((s, v, i) => s + v * weights.t[i], 0) : 0;
        const exp = adjust(base, adjM, adjT);
        const { priced, bets } = priceProps(sport, game, board_, props, idx, exp, f?.info ?? null, live.get(game.id), trust, EV_SCALE);
        propRun.priced += priced.length;
        propRun.under += priced.filter((x) => x.side === 'under').length;
        // (the ones at an even line: the ones it could bet)
        const even = priced.filter((x) => !x.guard?.skip);
        propRun.even += even.length;
        propRun.evenUnder += even.filter((x) => x.side === 'under').length;
        for (const x of bets) candidates.push({ game, x, exp });
        if (DRY) dumped.push(...priced.map((x) => ({ game: game.id, player: x.prop.athlete.name, stat: x.prop.stat.key, line: x.prop.line, side: x.side, skip: !!x.guard?.skip, ...x.projection })));
      } catch (err) {
        console.warn(`${sport}: props for ${game.id} skipped (${err.message})`);
      }
    }
    // (the day's best first: every game's candidates by expected return, placed under the caps)
    for (const { game, x, exp } of candidates.sort((a, b) => b.x.ev - a.x.ev)) {
      const mine = ledger.bets.filter((b) => b.event === game.id && b.market === 'prop');
      const id = `${game.id}:prop:${x.prop.stat.key}:${x.prop.athlete.id}`;
      if (placed.has(id) && !DRY) continue;
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
        oddsAssumed: true,
        model: round(x.model, 4),
        fair: round(x.fair, 4),
        p: round(x.p, 4),
        ev: round(x.ev, 4),
        units: x.units,
        expMargin: round(exp.margin, 2),
        expTotal: round(exp.total, 2),
        book: 'DraftKings',
        projection: x.projection,
        tested,
        context: { move: x.move, ...(x.guard ? { guard: x.guard.why } : {}) },
        status: 'open',
        profit: 0,
      };
      bet.pick = `${bet.player} ${bet.side === 'over' ? 'Over' : 'Under'} ${bet.line} ${bet.statLabel}`;
      if (DRY) console.log(`${sport} (dry) prop ${bet.matchup} ${bet.pick} ${bet.units}u p ${bet.p} ev ${bet.ev}: ${JSON.stringify(bet.projection)}${x.guard ? ` [${x.guard.why}]` : ''}`);
      ledger.bets.push(bet);
      mine.push(bet);
      placed.add(id);
      propRun.bet++;
      propRun.units += bet.units;
      newBets++;
    }
    if (DRY && dumped.length) write(path.join(ROOT, '.cache/model', `priced-${sport}.json`), dumped);
    if (propRun.priced) console.log(`${sport}: props priced ${propRun.priced} in ${propRun.games} games (${Math.round((100 * propRun.under) / propRun.priced)}% under; at even lines ${propRun.even}, ${Math.round((100 * propRun.evenUnder) / Math.max(1, propRun.even))}% under), bet ${propRun.bet} for ${propRun.units}u`);
  }

  if (replaced) state.changelog.push({ at, what: 'Open bets replaced', from: replaced, to: newBets, why: 'Priced again with the context the model has now (its terms as fit this run: see Context)' });

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
    props: props
      ? {
          odds: 'assumed -110 a side (the board has no prices); lines far from the player usual not bet',
          perGame: PER_GAME,
          lastRun: propRun,
          types: Object.entries(props).map(([key, f]) => ({ key, label: f.stat.label, rows: f.rows, eligible: f.eligible, params: f.params, check: f.check, allPlayersBias: f.checkAll?.bias ?? null, trust: trust[`prop:${key}`] ?? null })),
        }
      : (state.props ?? null),
    postmortem: (() => {
      const done = ledger.bets.filter((b) => b.status !== 'open' && b.why);
      return { graded: done.length, disrupted: done.filter((b) => (b.weight ?? 1) < 1).length, weight: DISRUPTED_WEIGHT, fitted: false };
    })(),
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
