// The model desk: code only, no AI, free. For each sport, every run:
//
//   1. the game history kept current (apps/<sport>/scripts/model/games.json, a game a line: two seasons of
//      finals from the teams' schedules the first time, then the last few days' scoreboards)
//   2. the ratings refit on it (ratings.mjs: the grid's best settings at predicting the games they hadn't
//      seen yet), each setting that moves logged with why
//   2b. the context (context.mjs: rest, travel, starters, weather, officials and more) gathered for every game, and the size of
//      each of its terms fit on the same held-out games (ratings.mjs fitContext: a term that doesn't help is
//      left out), each size that moves logged the same way
//   3. each market's trust in the model refit on the desk's own graded bets (a game bet's only when its fair
//      chance was Pinnacle's: none on DraftKings' own prices), logged the same way
//   4. the open bets graded against their finals (a prop whose count can't be read yet waits, PROP_WAIT at most;
//      a player who played but isn't in his stat's table counts 0; an MLB game cut short voids its run line and
//      total; each prop's count read again once a day and a half after the start, for stat corrections)
//   5. every market (spread, total, moneyline) of every game starting in the next two days bet once, the
//      better side at 0.5 to 3 units by its Kelly fraction (desk.mjs; priced off the margins' own chances,
//      margins.mjs, their shape fit on the history in 2b), cut to 0.5 (or skipped) when its line has moved a
//      lot against it since it opened or a key player is questionable (the guard), skipped when the model's
//      chance is too far from the book's (desk.mjs GAP); the spread and the moneyline never on one side of a
//      game; each bet keeps the context it saw. Held for a later run (fail safe): a game whose injury report
//      or context couldn't be read, one starting within five minutes, one called off, and with The Odds API to
//      hand one it didn't price (till LAST_CALL)
//   6. the props (below), then every new bet placed, each game's open stake, markets and props together, at
//      most GAME_CAP (leagues.mjs; desk.mjs capGame)
//
// What it writes (apps/<sport>/src/StaticData/model/): state.json (the settings, their test numbers, the
// changelog, the teams' ratings, the context's sizes) and ledger.json (every bet, open or graded), each only
// when something in it changed (a run that learned nothing new commits nothing); and the facts the context is
// built from, in .cache/model/context-<sport>.json (gitignored: a cache, rebuilt from the sources when lost).
// The Bets page's admin panel (dev only) reads state and ledger.
//
//   node libs/ranker/scripts/model/run.mjs [nfl nba nhl mlb] [--dry [--paid]] [--replace] [--all-sources]
//   (--dry: no bets placed, nothing committed touched (state, ledger, history, picks), a snapshot of what the model made of the coming games
//   in .cache/model/dry-<sport>.json, priced from ESPN's free board (--paid: The Odds API's too); --replace: open bets on games not started yet taken back and priced
//   again; --all-sources: every optional source asked, whether its terms are kept or not)

// (the keys: .env on this machine, the repo's secrets on GitHub; first, so every module sees them)
import '../env.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOK, GAME_CAP, LEAGUES, PROP_CAPS } from './leagues.mjs';
import { fitMargins } from './margins.mjs';
import { ROSTER_MIN, eventOf, gameOf, json, linesOf, roster, scoreboard, teamIds, teamSchedule, ymd } from './espn.mjs';
import { adjust, expect, fit, fitContext, gateOf, replay, round } from './ratings.mjs';
import { OPTIONAL, enrich, featurize, gather } from './context.mjs';
import { RECHECK, finalSummary, postmortems, propPostmortem, recheckSummary, usualRoles } from './postmortem.mjs';
import { closeOf, closingLines, clvOf, clvSummary, propCloseOf } from './clv.mjs';
import { LINE_BOOKS, SPORT_KEYS, call, canSpend, hasKey, linesFromEvent, matchNearest, usageSummary } from './oddsapi.mjs';
import { backtestBets, evaluate, repriced, snapshots, trustBets } from './backtest.mjs';
import { buildPicks } from './picks.mjs';
import { playerRows } from './playerlogs.mjs';
import { PER_GAME, PROP_WAIT, STATS, apiProps, board, fitProps, nflTookSnap, priceProps, rowsIndex, settleProp, statInFinal, withApiPrices } from './props.mjs';
import { CACHE, DAY, etDay, isoSecond, readJson, writeJson } from './sources.mjs';
import { BANKROLL, MARKETS, capGame, choose, fairPair, fitTrust, gapGuard, guardOf, oneSide, pickText, price, record, settle, voidOf } from './desk.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
// (the return a side has to show to get the 3-unit top stake; a smaller one scales down to 0.5)
const EV_SCALE = 0.08;
// (the trust a market starts at, before 40 of its bets are graded: halfway between the book and the model)
const START_TRUST = 0.5;
// (what a graded bet whose premise broke in the game counts for in the trust fit and the calibration: set by
// hand, not fit: there aren't graded bets enough yet to fit it on)
const DISRUPTED_WEIGHT = 0.3;
// (the rule for a broken premise (postmortem.mjs): 2, only an exit that isn't for how he played (an injury, an
// ejection) breaks it; 3, the same for every sport's cut minutes, time on ice, plate appearances and snaps, and
// an NHL goalie pulled read off the one who started; the graded bets the old rule weighed down are weighed again
// once when it changes)
const PM_RULE = 3;
const PROPS_ASKED = path.join(CACHE, 'odds-props.json');
// (a game market the guard skipped or the book didn't price: not asked about again for REST_FOR, so the hourly
// runs don't buy The Odds API's lines for it each hour; kept by sport in .cache/model/lines-rest.json)
const LINES_REST = path.join(CACHE, 'lines-rest.json');
const REST_FOR = 3 * 36e5;
// (with The Odds API to hand, a game it didn't price waits for it; this close to the start, it goes on ESPN's
// board after all, at the minimum stake, for the data)
const LAST_CALL = 2 * 36e5;

const read = readJson;
const write = writeJson;

// (a committed file the run builds on (the ledger, the state, the history): missing, a fresh start; there
// but unreadable, the sport stops, rather than a fresh one being written over it)
function readKept(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

// A file the workflow commits, written only when its content changed (ignoring what changes every run: when
// it ran, the props' last-run counts); lines: an array written an item a line (small diffs)
function writeIfChanged(file, data, { lines = false } = {}) {
  // (--dry: nothing committed is touched, so a check on the code leaves the tree as the bots left it)
  if (DRY) return false;
  const text = lines ? `[\n${data.map((x) => JSON.stringify(x)).join(',\n')}\n]\n` : JSON.stringify(data);
  const strip = (x) => (x && !Array.isArray(x) ? { ...x, updated: null, at: null, props: x.props ? { ...x.props, lastRun: null } : x.props } : x);
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
    picks: path.join(ROOT, 'apps', sport, 'src/StaticData/model/picks.json'),
    teams: path.join(ROOT, 'apps', sport, 'src/StaticData/model/teams.json'),
  };
  // (--picks-only: the picks written from the ledger as it stands, nothing fetched, fit or bet)
  if (PICKS_ONLY) return writePicks(r, true);
  await writeTeams(r);
  await loadHistory(r);
  await liveLines(r);
  fitRatings(r);
  await fitTheContext(r);
  await fitTheProps(r);
  await runBacktest(r);
  logContext(r);
  r.ledger = readKept(r.files.ledger, { sport, bankroll: BANKROLL, bets: [] });
  r.ledger.bankroll = BANKROLL;
  await captureClose(r);
  refitTrust(r);
  await gradeBets(r);
  replaceOpen(r);
  betGames(r);
  await betProps(r);
  placeBets(r);
  writePicks(r);
  saveState(r);
}

// The league's teams' colors for the desk (ESPN's team list, which a browser can't ask: it sends no CORS
// header): abbreviation -> { id, color, alt }, written when they change (once a season, about). A failed ask
// leaves the file as it was
async function writeTeams(r) {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${r.cfg.league}/teams`);
    if (!res.ok) return;
    const body = await res.json();
    const teams = Object.fromEntries(
      (body?.sports?.[0]?.leagues?.[0]?.teams ?? [])
        .map(({ team }) => [team.abbreviation, { id: String(team.id), color: team.color ?? null, alt: team.alternateColor ?? null }])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    if (Object.keys(teams).length) writeIfChanged(r.files.teams, { teams });
  } catch (err) {
    console.warn(`${r.sport}: teams' colors skipped (${err.message})`);
  }
}

// 7. the public picks (picks.mjs): the best edge bets on games not started, written for the site's Bets page
// when they change; the ones shown marked published on the ledger, so their record is theirs alone
function writePicks(r, alone = false) {
  const ledger = alone ? readKept(r.files.ledger, { bets: [] }) : r.ledger;
  const trust = alone ? (readKept(r.files.state, {}).trust ?? {}) : r.trust;
  const games = alone ? new Map(readKept(r.files.games, []).map((g) => [g.id, g])) : r.games;
  const out = buildPicks(r.sport, ledger, trust, games, r.now);
  if (DRY) {
    console.log(`${r.sport} (dry): ${out.picks.length} picks: ${out.picks.map((p) => `${p.level} ${p.pick} (${p.score})`).join(' | ')}`);
    return;
  }
  const changed = writeIfChanged(r.files.picks, out);
  if (alone) writeIfChanged(r.files.ledger, ledger);
  console.log(`${r.sport}: ${out.picks.length} picks${changed ? ' written' : ' unchanged'}`);
}

// 1. the history: games.json brought up to date from the last few days' scoreboards (and the next two: the
// coming games, with their lines), two seasons of the teams' schedules the first time
async function loadHistory(r) {
  const { sport, cfg, now } = r;
  const games = new Map(readKept(r.files.games, []).map((g) => [g.id, g]));
  if (!games.size) {
    const current = (await json(`https://site.api.espn.com/apis/site/v2/sports/${cfg.league}/scoreboard`))?.leagues?.[0]?.season?.year;
    const ids = await teamIds(cfg.league);
    for (const season of [current - 1, current]) {
      for (const id of ids) {
        for (const type of [2, 3]) {
          for (const e of await teamSchedule(cfg.league, id, season, type)) {
            const g = gameOf(e, { innings: sport === 'mlb' });
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
  const open = readKept(r.files.ledger, { bets: [] }).bets.filter((b) => b.status === 'open');
  for (const bet of open) {
    if (Date.parse(bet.start) < now.getTime() - 4 * DAY) days.add(ymd(new Date(bet.start)));
  }
  const seen = new Set();
  // (a game's word on it as it is now: one called off and since played loses its off)
  const keep = (g) => {
    const { off: _off, ...was } = games.get(g.id) ?? {};
    games.set(g.id, { ...was, ...g });
    seen.add(g.id);
  };
  for (const day of days) {
    for (const e of await scoreboard(cfg.league, day)) {
      const g = gameOf(e, { innings: sport === 'mlb' });
      if (!g || (g.type !== 2 && g.type !== 3)) continue;
      keep(g);
      const lines = linesOf(e);
      // (not one called off: postponed, suspended or canceled, its lines are stale and its bets would be void)
      if (!g.final && !g.off && lines && Date.parse(g.date) > now.getTime() + 5 * 60e3) upcoming.push({ game: g, lines, event: e });
    }
  }
  // (a game bet on, past its start, that none of those days showed: moved off its day, postponed; asked by its
  // id, so its bets are graded or void (desk.mjs voidOf) and never left open)
  for (const id of new Set(open.filter((b) => Date.parse(b.start) < now.getTime() && !seen.has(b.event)).map((b) => b.event))) {
    try {
      const e = await eventOf(cfg.league, id);
      const g = e && gameOf(e, { innings: sport === 'mlb' });
      if (g) keep({ ...g, season: g.season ?? games.get(id)?.season ?? null, type: g.type ?? games.get(id)?.type ?? null });
    } catch (err) {
      console.warn(`${sport}: game ${id} not read (${err.message})`);
    }
  }
  await enrich(sport, cfg, games).catch((err) => console.warn(`${sport}: history's gaps left (${err.message})`));
  r.games = games;
  r.upcoming = upcoming;
  r.history = [...games.values()].filter((g) => g.type === 2 || g.type === 3);
  writeIfChanged(r.files.games, r.history.sort((a, b) => a.date.localeCompare(b.date)), { lines: true });
}

// 1b. the coming games' lines from The Odds API (oddsapi.mjs): the desk's book's prices, Pinnacle's fair
// chance; one call for the sport (its three markets: 3 credits), only with a market still to bet (a game already
// bet only notes the line it sees, which ESPN's board, the same book's, gives free: asked hourly, these used
// up the day's allowance overnight; a market the guard skipped or the book didn't price rests REST_FOR before
// it's asked about again, so it doesn't buy the call every hour) and today's lines allowance left. Otherwise
// ESPN's board, and The Odds API's free event list for the ids its props are asked by. The range covers every
// day ESPN's board is read for (the next two, Eastern, and their late games), so no coming game falls outside
// it; with a key, a game The Odds API didn't price this run isn't bet off ESPN's board (betGames)
async function liveLines(r) {
  r.linesSource = 'espn';
  r.rest = DRY ? {} : (read(LINES_REST, {})[r.sport] ?? {});
  if (!r.upcoming.length || !hasKey()) return;
  const range = { commenceTimeFrom: isoSecond(r.now), commenceTimeTo: isoSecond(r.now.getTime() + 4 * DAY) };
  const placed = new Set(readKept(r.files.ledger, { bets: [] }).bets.map((b) => b.id));
  const unbet = DRY || REPLACE || r.upcoming.some((u) => MARKETS.some((m) => !placed.has(`${u.game.id}:${m}`) && !resting(r, `${u.game.id}:${m}`)));
  if (!unbet || !canSpend('lines', 3)) {
    const list = await call('events', `/sports/${SPORT_KEYS[r.sport]}/events`, range);
    if (Array.isArray(list)) for (const [u, ev] of matchGames(list, r.upcoming)) u.lines.oddsEvent = ev.id;
    return;
  }
  const events = await call('lines', `/sports/${SPORT_KEYS[r.sport]}/odds`, { markets: 'h2h,spreads,totals', bookmakers: LINE_BOOKS.join(','), ...range });
  if (!Array.isArray(events)) return;
  let matched = 0;
  const pairs = matchGames(events, r.upcoming);
  // (a coming game The Odds API doesn't list: its markets rest, rather than buying the call again each hour)
  for (const u of r.upcoming) if (!pairs.has(u)) for (const m of MARKETS) if (!placed.has(`${u.game.id}:${m}`)) rest(r, `${u.game.id}:${m}`, 'not on The Odds API');
  for (const [u, ev] of pairs) {
    const l = linesFromEvent(ev);
    u.lines.oddsEvent = ev.id;
    // (listed, but not by the book yet: its markets rest too, rather than buying the call again each hour; the
    // game stays off ESPN's board, betGames holding it till LAST_CALL)
    if (!l) {
      for (const m of MARKETS) if (!placed.has(`${u.game.id}:${m}`)) rest(r, `${u.game.id}:${m}`, 'not priced by the book on The Odds API');
      continue;
    }
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
  console.log(`${r.sport}: lines from The Odds API for ${matched} of ${r.upcoming.length} coming games`);
}

// (The Odds API's events matched to the coming ESPN games: the same two teams, by nickname, within six hours,
// one to one, nearest start first: a doubleheader's second game never takes the first's lines)
function matchGames(events, upcoming) {
  const candidates = [];
  for (const u of upcoming) {
    const sides = u.event?.competitions?.[0]?.competitors ?? [];
    const nick = (where) => sides.find((c) => c.homeAway === where)?.team?.name ?? null;
    const is = (full, n) => !!n && (full === n || full.endsWith(` ${n}`));
    for (const ev of events) {
      const apart = Math.abs(Date.parse(ev.commence_time) - Date.parse(u.game.date));
      if (is(ev.home_team, nick('home')) && is(ev.away_team, nick('away')) && apart < 6 * 36e5) candidates.push([u, ev, apart]);
    }
  }
  return matchNearest(candidates);
}

// (a market resting: skipped by the guard or not priced by the book a run ago, not asked about again until
// its time is up)
const resting = (r, id) => Date.parse(r.rest?.[id]?.until ?? '') > r.now.getTime();
function rest(r, id, why) {
  r.rest[id] = { until: new Date(r.now.getTime() + REST_FOR).toISOString(), why };
}
// (the rests kept, each sport's, the ones run out dropped; never on a dry run)
function saveRest(r) {
  if (DRY) return;
  const all = read(LINES_REST, {});
  all[r.sport] = Object.fromEntries(Object.entries(r.rest ?? {}).filter(([, v]) => Date.parse(v.until) > r.now.getTime()));
  write(LINES_REST, all);
}

// 2. the ratings, refit (each setting that moves logged with why)
function fitRatings(r) {
  const { cfg, at } = r;
  const state = readKept(r.files.state, { sport: r.sport, changelog: [] });
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
  fitTheMargins(r);
}

// 2b'. the margins' shape (margins.mjs fitMargins): how often each margin comes against the normal's say, fit
// on the finals' expectations from the replay just run (each made before its game), kept only if it predicts
// the held-out finals better; logged when it joins or leaves. Without it (a throw, too few games), the plain
// normal cut into whole numbers, ties or none by the sport
function fitTheMargins(r) {
  const { sport, state, at } = r;
  try {
    r.margins = fitMargins(sport, r.history, r.expAll, r.params.sigma);
  } catch (err) {
    console.warn(`${sport}: margins' shape left out (${err.message})`);
    r.margins = fitMargins(sport, [], new Map(), r.params.sigma);
  }
  r.shape = { ties: r.margins.ties, ot: r.margins.ot, w: r.margins.kept ? r.margins.w : null };
  const w = r.margins.w ?? {};
  const top = Object.entries(w)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k} x${v}`);
  console.log(`${sport}: margins' shape ${r.margins.kept ? 'kept' : 'left out'} on ${r.margins.n} finals (held-out log likelihood ${r.margins.gain === null ? 'not tested' : `${r.margins.gain > 0 ? '+' : ''}${r.margins.gain} a game`})${r.margins.kept ? `; most over the normal: ${top.join(', ')}` : ''}`);
  const was = state.margins?.kept ?? null;
  if (was !== null && was !== r.margins.kept) state.changelog.push({ at, what: `margins' shape${r.margins.kept ? '' : ' (left out)'}`, from: was, to: r.margins.kept, why: `held-out log likelihood ${r.margins.gain} a game on ${r.margins.n} finals` });
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
    r.props = fitProps(sport, r.rows, r.expPts, info, r.facts);
    console.log(`${sport}: props' projections fit on ${r.rows.length} player games in ${Math.round((Date.now() - t0) / 1000)}s`);
    // (each stat's matchup terms kept, and what each did for the held-out games' log loss)
    for (const [key, f] of Object.entries(r.props ?? {})) {
      const kept = Object.entries(f.gains ?? {}).map(([k, g]) => `${k} ${f.params[k]}${k === 'vc' ? `/${f.params.vs}` : ''} (${g === null ? 'not taken' : g > 0 ? `+${g}` : `${g}, left out`})`);
      if (kept.length) console.log(`${sport}:   ${key}: ${kept.join(', ')}`);
    }
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
    const bets = backtestBets(sport, snaps, history, r.expAll, params, r.facts.teams ?? [], START_TRUST, EV_SCALE, r.shape);
    writeIfChanged(r.files.backtest, { at: r.at, planned, snapshots: snaps.length, bets });
    console.log(`${sport}: backtest on ${snaps.length} of ${planned} snapshots (${bought} bought), ${bets.length / 2} bets a side, in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const saved = read(r.files.backtest, null);
  // (their chances priced again by the desk's pricing now: backtest.mjs repriced)
  const bets = repriced(saved?.bets ?? [], r.expAll ?? new Map(), params, r.shape);
  if (saved?.bets?.length && bets.length < saved.bets.length) console.log(`${sport}: backtest bets priced again: ${bets.length} of ${saved.bets.length} (the rest's games not in the replay)`);
  r.backtestBets = trustBets(bets);
  r.backtest = saved ? { at: saved.at, snapshots: saved.snapshots, planned: saved.planned, markets: evaluate(bets) } : null;
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
    if (trust[key] && trust[key].trust !== t.trust) state.changelog.push({ at, what: words.what, from: trust[key].trust, to: t.trust, why: `best fit to ${t.n} graded ${words.bets} and ${t.clvN} closing lines, ${t.eff} games' worth (log loss ${t.logLoss})` });
    trust[key] = t;
  };
  // (each one's bets with a result or a close, a void one's neither: clv.mjs; and a market's backtest bets, the
  // history's real lines and results, so its trust is fitted from the start, the live bets adding to them as
  // they come)
  const evidence = (b) => !b.void && (b.status !== 'open' || b.clv);
  // (a game bet's fair chance from Pinnacle only, as the backtest's are (backtest.mjs trustBets): one priced off
  // DraftKings' own odds (ESPN's board inside LAST_CALL, or no Pinnacle line) has no sharp price to weigh the
  // model against, and would teach the trust a softer market)
  const sharp = (b) => b.fairFrom === 'pinnacle';
  // (the live bets' chances priced again by the desk's pricing now, as the backtest's are (backtest.mjs
  // repriced), each from the expectation it was bet on: one placed under an older pricing (the plain normal's
  // underdog-leaning moneyline) would teach the trust that pricing's leans. One with no expectation kept, or a
  // moneyline with no spread to price it off, is left out)
  const live = repriced(
    r.ledger.bets.filter((b) => MARKETS.includes(b.market)),
    (b) => (Number.isFinite(b.expMargin) && Number.isFinite(b.expTotal) ? { margin: b.expMargin, total: b.expTotal } : null),
    r.params,
    r.shape,
  ).filter((b) => sharp(b) && evidence(b));
  for (const market of MARKETS) {
    refit(market, [...(r.backtestBets ?? []).filter((b) => b.market === market), ...live.filter((b) => b.market === market)], { what: `${market} trust in the model`, bets: `${market} bets (backtest and live)` });
    trust[market].backtest = (r.backtestBets ?? []).filter((b) => b.market === market).length;
  }
  // (start 0.5, refit once 40 of its bets are graded)
  for (const st of STATS[r.sport]) {
    refit(
      `prop:${st.key}`,
      r.ledger.bets.filter((b) => b.market === 'prop' && b.propType === st.key && evidence(b)),
      { what: `${st.label} props' trust in the projection`, bets: `${st.label} props` },
    );
  }
  r.trust = trust;
}

// 3b. each bet's close, once its game has started (the core API keeps it after kickoff), and its CLV
// (clv.mjs); a close the API never gives (it's failed for 3 days) is taken as the last line a run saw
async function captureClose(r) {
  const { sport, cfg, games, params } = r;
  // (not a void bet's, nor one on a game called off: no action, so no close)
  const started = r.ledger.bets.filter((b) => !b.clv && !b.void && !games.get(b.event)?.off && Date.parse(b.start) <= r.now.getTime());
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
        // (none read for 3 days: the last line a run saw; a close read late, the runs having stopped, is kept)
        else if (!close && bet.seen && r.now.getTime() - Date.parse(bet.start) > 3 * DAY) close = { ...bet.seen, source: 'last seen' };
        if (!close) continue;
        bet.close = close;
        bet.clv = clvOf(bet, close, bet.market === 'total' ? params.sigmaT : params.sigma, bet.market === 'prop' ? null : { sigma: params.sigma, sigmaT: params.sigmaT, shape: r.shape });
        got++;
      }
    } catch (err) {
      console.warn(`${sport}: close for ${id} not read (${err.message})`);
    }
  }
  if (started.length) console.log(`${sport}: closing lines for ${got} of ${started.length} bets on games under way or played`);
}

// 4. the open bets graded against their finals (a prop from its box score: a player who didn't play is no
// action), and each graded bet's post-mortem; first, the bets on games called off: void, or noted as put off
// till they're played or 48 hours have gone by (desk.mjs voidOf)
async function gradeBets(r) {
  const { sport, cfg, games, at } = r;
  for (const bet of r.ledger.bets) {
    if (bet.status !== 'open') continue;
    const g = games.get(bet.event);
    if (g?.off && g.off !== 'canceled' && g.off !== 'forfeit') bet.off ??= g.off;
    const voided = voidOf(bet, g, r.now.getTime());
    if (!voided) continue;
    Object.assign(bet, voided, { gradedAt: at });
    r.graded++;
  }
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
      const value = await statInFinal(sport, bet, body, r.facts.games?.[g.id]?.pk, { played: (b) => nflTookSnap(r.facts, g.id, b.player) });
      // (a count that can't be read yet waits: the NFL's snap counts a day or so after the game, StatsAPI's box
      // score; past PROP_WAIT, no action)
      if (value === undefined && r.now.getTime() - Date.parse(bet.start) < PROP_WAIT) continue;
      Object.assign(bet, value === undefined ? { status: 'push', profit: 0, void: true, actual: null, final: 'stat not read' } : settleProp(bet, value), { gradedAt: at });
      Object.assign(bet, propPostmortem(sport, bet, g, body, r.rows, DISRUPTED_WEIGHT, await usualRoles(sport, g, r.facts, r.history).catch(() => null)));
      r.graded++;
    } catch (err) {
      console.warn(`${sport}: prop ${bet.id} not graded (${err.message})`);
    }
  }
  await statCorrections(r);
  // (the ones just graded, and any graded before there were post-mortems; once, when the rule for a broken
  // premise changes (PM_RULE), the ones it weighed down, again)
  const redo = r.state.postmortemRule !== PM_RULE ? r.ledger.bets.filter((b) => b.status !== 'open' && !b.void && b.why && (b.weight ?? 1) < 1) : [];
  try {
    const todo = r.ledger.bets.filter((b) => b.status !== 'open' && b.market !== 'prop' && (!b.why || redo.includes(b)));
    if (todo.length) console.log(`${sport}: post-mortems for ${await postmortems(sport, cfg.league, todo, games, r.facts, r.history, DISRUPTED_WEIGHT)} of ${todo.length} graded bets`);
    for (const bet of redo.filter((b) => b.market === 'prop')) {
      const g = games.get(bet.event);
      const body = g?.final ? await finalSummary(sport, cfg.league, g.id) : null;
      if (body) Object.assign(bet, propPostmortem(sport, bet, g, body, r.rows, DISRUPTED_WEIGHT, await usualRoles(sport, g, r.facts, r.history).catch(() => null)));
    }
    if (redo.length) console.log(`${sport}: ${redo.length} post-mortems weighed again by the new rule (${redo.filter((b) => (b.weight ?? 1) === 1).length} now count in full)`);
    r.state.postmortemRule = PM_RULE;
  } catch (err) {
    console.warn(`${sport}: post-mortems skipped (${err.message})`);
  }
}

// 4b. stat corrections: a prop graded on a final's first box score has the summary read once more, a day and a
// half after the start (postmortem.mjs recheckSummary: the leagues' corrections are in by then), and a count
// that changed grades it again (corrected: what it was, and when). Only the last five days' props; one whose
// summary was first read that late is done
async function statCorrections(r) {
  const { sport, cfg, games, at } = r;
  const now = r.now.getTime();
  const due = r.ledger.bets.filter((b) => b.market === 'prop' && b.status !== 'open' && !b.void && !b.rechecked && now - Date.parse(b.start) >= RECHECK && now - Date.parse(b.start) < 5 * DAY);
  let changed = 0;
  for (const id of new Set(due.map((b) => b.event))) {
    const g = games.get(id);
    if (!g?.final) continue;
    try {
      const got = await recheckSummary(sport, cfg.league, id, g.date, now);
      if (!got) continue;
      for (const bet of due.filter((b) => b.event === id)) {
        if (got.body) {
          const value = await statInFinal(sport, bet, got.body, r.facts.games?.[g.id]?.pk, { played: (b) => nflTookSnap(r.facts, g.id, b.player) });
          if (value === undefined) continue;
          if (value !== bet.actual) {
            Object.assign(bet, settleProp(bet, value), { corrected: { from: bet.actual, at }, gradedAt: at });
            Object.assign(bet, propPostmortem(sport, bet, g, got.body, r.rows, DISRUPTED_WEIGHT, await usualRoles(sport, g, r.facts, r.history).catch(() => null)));
            changed++;
          }
        }
        bet.rechecked = at;
      }
    } catch (err) {
      console.warn(`${sport}: stat corrections for ${id} not read (${err.message})`);
    }
  }
  if (changed) console.log(`${sport}: ${changed} props graded again on a corrected box score`);
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
// guard, skipped when the model is too far from the book (desk.mjs gapGuard); the spread and the moneyline
// never on the same side of a game (desk.mjs oneSide, among the markets the guards didn't skip: the one giving
// way takes the other side only with an edge there); a moneyline with no spread to price it off at the
// minimum, for the data; each bet keeps the context it saw, and waits in r.pending for placeBets (the game's cap). Not
// bet this run (asked again the next): a game whose context or injury report couldn't be read (blindOf: it
// would be bet as if everyone were healthy), one starting within five minutes by the clock now, and, with The
// Odds API to hand, one it didn't price this run (no sharp fair chance: it waits for one, and only inside
// LAST_CALL of its start goes on ESPN's board, at the minimum stake as an action bet). A market the guard
// skips, or the book doesn't price, rests (liveLines)
function betGames(r) {
  const { sport, cfg, params, trust, at } = r;
  const held = new Map();
  r.pending = [];
  for (const { game, lines } of r.upcoming) {
    const { exp, f, adjM, adjT } = expectFor(r, game);
    const fairFrom = lines.fairSource ?? {};
    r.snapshot.exp[game.id] = [round(exp.margin, 4), round(exp.total, 4)];
    const seen = f ? { ...f.info, adj: { margin: round(adjM, 2), total: round(adjT, 2) }, move: lines.move ?? null } : { move: lines.move ?? null };
    const blind = blindOf(r, game);
    const until = Date.parse(game.date) - Date.now();
    const apiLines = lines.source === 'the odds api';
    const waiting = hasKey() && !apiLines && until >= LAST_CALL;
    const priced = price(game, exp, lines, params, r.shape);
    // (a market the book didn't price, by The Odds API's word: rests)
    if (apiLines) for (const m of MARKETS) if (!priced.some((x) => x.market === m) && !r.placed.has(`${game.id}:${m}`)) rest(r, `${game.id}:${m}`, 'not priced by the book');
    let picks = [];
    for (const market of priced) {
      const id = `${game.id}:${market.market}`;
      if (r.placed.has(id) && !DRY) {
        // (a bet already placed: the line this run saw for its side, the stand-in for its close)
        const bet = r.ledger.bets.find((b) => b.id === id);
        const s = market.sides.find((x) => x.side === bet?.side);
        if (bet && s) bet.seen = { at, line: s.line ?? null, odds: s.odds, fair: round(s.fair, 4) };
        continue;
      }
      const hold = blind ?? (until < 5 * 60e3 ? 'starting' : waiting ? 'no Odds API price yet' : null);
      if (hold) {
        held.set(hold, (held.get(hold) ?? 0) + 1);
        continue;
      }
      picks.push({ market: market.market, id, pick: choose(market, trust[market.market]?.trust ?? START_TRUST, EV_SCALE) });
    }
    // (the guards: the model too far from the book skips the market (desk.mjs gapGuard: the market knowing
    // something it doesn't); a line that's moved a lot against its side since it opened (less what the context
    // explains), or a key player questionable, cuts the stake to the minimum; a line that's moved twice that
    // far against it skips the market this run. A moneyline with no spread market to anchor it (margins.mjs
    // mlModel) is bet at the book's chance alone, the minimum, as an action bet)
    // (an NFL total under the weather the model can't price well: a forecast of a fifth of an inch of rain or
    // more over the game (the rain term's size is from what fell, and a big forecast's error is big), or a
    // retractable roof not yet said open or closed (its weather unknown), cut to the minimum too)
    const wx = sport === 'nfl' ? f?.info.weather : null;
    const totalWhy = wx?.roof === 'retractable' ? 'a retractable roof not yet said open or closed: its weather unseen' : wx?.precipForecast >= 0.2 ? `${wx.precipForecast} in of rain forecast: a total priced off a forecast's rain` : null;
    const guardFor = (key, pick) => {
      const flags = [...(f?.info.flags ?? []), ...(key === 'total' && totalWhy ? [totalWhy] : [])];
      const g = gapGuard(key, pick.model, pick.fair) ?? guardOf(cfg.guard, key, lines.move, flags, { m: adjM, t: adjT }, params.sigma, pick.side);
      if (g?.skip || pick.anchored !== false) return g;
      return { why: [g?.why, 'no spread market to price the moneyline off'].filter(Boolean).join('; ') };
    };
    const skipped = (key, id, guard) => {
      rest(r, id, guard.why);
      if (DRY) console.log(`${sport} (dry) skipped ${game.awayAbbr} @ ${game.homeAbbr} ${key}: ${guard.why}; ${JSON.stringify(seen)}`);
    };
    // (the skips first, so a market the guard skips never makes the other give way: oneSide)
    picks = picks.filter((x) => {
      x.guard = guardFor(x.market, x.pick);
      if (x.guard?.skip) skipped(x.market, x.id, x.guard);
      return !x.guard?.skip;
    });
    // (the spread and the moneyline never on one side, this run's or against the game's open bets: oneSide)
    const ids = new Set(picks.map((x) => x.id));
    picks = oneSide(picks, r.ledger.bets.filter((b) => b.event === game.id && standing(r, b) && !ids.has(b.id)));
    // (a market giving way to another new one this run: if the cap drops that one (placeBets), its rest is
    // lifted, so a later run can bet it)
    const gaveWay = picks.find((x) => x.drop || x.flipped);
    const tookIt = gaveWay && picks.find((x) => x !== gaveWay && ids.has(x.id) && (x.market === 'spread' || x.market === 'ml') && !x.drop);
    for (const { market: key, id, pick, drop, flipped, guard: was } of picks) {
      const market = { market: key };
      if (drop) {
        rest(r, id, drop);
        if (tookIt) (r.gaveWay ??= new Map()).set(tookIt.id, id);
        if (DRY) console.log(`${sport} (dry) not bet ${game.awayAbbr} @ ${game.homeAbbr} ${key}: ${drop}`);
        continue;
      }
      // (a flipped side's guards its own: the move counted against the new side)
      let guard = flipped ? guardFor(key, pick) : was;
      if (guard?.skip) {
        skipped(key, id, guard);
        continue;
      }
      // (on ESPN's board with a key to hand: The Odds API's price never came; for the data only)
      if (hasKey() && !apiLines) guard = { why: [guard?.why, "no Odds API price (ESPN's board)"].filter(Boolean).join('; ') };
      const units = guard ? 0.5 : pick.units;
      const bet = {
        id,
        event: game.id,
        sport,
        start: game.date,
        // (when it was placed: now, not the run's start; a run can take minutes)
        placedAt: new Date().toISOString(),
        matchup: `${game.awayAbbr} @ ${game.homeAbbr}`,
        market: market.market,
        side: pick.side,
        line: pick.line,
        odds: pick.odds,
        model: round(pick.model, 4),
        fair: round(pick.fair, 4),
        p: round(pick.p, 4),
        ev: round(pick.ev, 4),
        // (edge: it sees value; action: no edge, bet for the data; the desk keeps their records apart)
        intent: pick.ev > 0 && !guard ? 'edge' : 'action',
        units,
        // (the model's chance of a push, an integer line landing on the number: its EV counts it)
        ...(pick.push ? { push: round(pick.push, 4) } : {}),
        // (a moneyline's spread it was priced off: the trust fit prices it again the same way, backtest.mjs
        // repriced; none, the book's chance alone)
        ...(key === 'ml' ? (pick.spreadHome ? { spreadHome: pick.spreadHome } : { anchored: false }) : {}),
        expMargin: round(exp.margin, 2),
        expTotal: round(exp.total, 2),
        book: lines.book,
        fairFrom: fairFrom[market.market] ?? 'its own prices',
        context: { ...seen, ...(guard ? { guard: guard.why } : {}), ...(flipped ? { oneSide: `the other side of its ${key === 'ml' ? 'spread' : 'moneyline'}'s, which took this one` } : {}) },
        status: 'open',
        profit: 0,
      };
      bet.pick = pickText(bet, game);
      r.pending.push({ bet, game });
      r.placed.add(id);
    }
  }
  if (held.size) console.log(`${sport}: game markets held for a later run: ${[...held].map(([why, n]) => `${n} (${why})`).join(', ')}`);
}

// (an open bet that stands against a game's new ones: a dry run prices again every open bet on a game not
// started, as a --replace run does, so only the ones on games under way count there)
const standing = (r, b) => b.status === 'open' && !(DRY && Date.parse(b.start) > r.now.getTime());

// 6b. this run's new bets placed (r.pending: the game markets' and the props'), each game's under GAME_CAP: the
// units already open on it and the new ones' together; over it the new ones scaled down alike, the least worth
// having dropped (desk.mjs capGame; a game market dropped rests, as a skipped one does). The rests kept
function placeBets(r) {
  const { sport } = r;
  const pending = r.pending ?? [];
  const ids = new Set(pending.map((x) => x.bet.id));
  const byGame = new Map();
  for (const x of pending) byGame.set(x.bet.event, [...(byGame.get(x.bet.event) ?? []), x.bet]);
  let capped = 0;
  let dropped = 0;
  const run = r.propRun;
  for (const [event, bets] of byGame) {
    const open = r.ledger.bets.filter((b) => b.event === event && standing(r, b) && !ids.has(b.id)).reduce((t, b) => t + b.units, 0);
    const res = capGame(bets, open, GAME_CAP);
    for (const b of res.dropped) {
      dropped++;
      r.placed.delete(b.id);
      if (b.market !== 'prop') rest(r, b.id, `the game's ${GAME_CAP}u cap`);
      // (the market that gave way to this one (betGames, oneSide) free again for a later run)
      const freed = r.gaveWay?.get(b.id);
      if (freed) delete r.rest[freed];
      if (DRY) console.log(`${sport} (dry) not bet ${b.matchup} ${b.pick}: the game's ${GAME_CAP}u cap (${open}u open on it)`);
    }
    for (const kept of res.kept) {
      const { cappedFrom, ...b } = kept;
      if (cappedFrom) {
        capped++;
        b.context = { ...b.context, cap: `${cappedFrom}u cut to ${b.units}u: the game's ${GAME_CAP}u cap` };
      }
      if (DRY) console.log(`${sport} (dry) ${b.market === 'prop' ? 'prop ' : ''}${b.matchup} ${b.pick} ${b.units}u p ${b.p} ev ${b.ev}${b.market === 'prop' ? `: ${JSON.stringify(b.projection)}` : ''}${b.context?.guard ? ` [${b.context.guard}]` : ''}${b.context?.cap ? ` [${b.context.cap}]` : ''}${b.context?.oneSide ? ' [flipped: one side]' : ''}`);
      r.ledger.bets.push(b);
      r.newBets++;
      if (b.market === 'prop' && run) {
        run.bet++;
        run.units += b.units;
      }
    }
  }
  if (capped || dropped) console.log(`${sport}: the games' ${GAME_CAP}u cap: ${capped} bets cut, ${dropped} not bet`);
  if (run?.priced) console.log(`${sport}: props bet ${run.bet} for ${run.units}u`);
  saveRest(r);
}

// (why a coming game can't be bet this run, or null: its context wasn't gathered (context.mjs threw), or its
// injury report couldn't be read; either way it would be bet as if everyone were healthy)
function blindOf(r, game) {
  const l = r.live?.get(game.id);
  if (!l || !r.feats) return 'its context not gathered';
  if (l.injuriesFailed) return 'the injury report not read';
  return null;
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
  // (the caps: a prop type not yet tested (its trust unfit) stakes little; the day is the game's US Eastern date,
  // daylight saving and all)
  const dayOf = etDay;
  const capsOf = (key) => (trust[`prop:${key}`]?.fitted ? PROP_CAPS.tested : PROP_CAPS.untested);
  const untestedUnits = (day) => ledger.bets.filter((b) => b.market === 'prop' && !b.tested && dayOf(b.start) === day).reduce((t, b) => t + b.units, 0);
  if (JSON.stringify(state.propCaps ?? null) !== JSON.stringify(PROP_CAPS)) {
    state.changelog.push({ at, what: 'Prop caps', from: state.propCaps ? 'before' : 'none', to: `${PROP_CAPS.untested.maxUnits}u a prop untested, ${PROP_CAPS.tested.maxUnits}u tested, ${PROP_CAPS.untested.perGame ?? 'every'} a game, ${PROP_CAPS.untested.perPlayer ?? 'every'} a player, ${GAME_CAP}u a game with its markets`, why: "Every main-line prop with a real price is bet (0.5u at no edge), as the game markets are, but one a player a game (his props rise and fall together) and a game's stake, markets and props, at most the game's cap; an untested type stakes at most 1 unit" });
    state.propCaps = PROP_CAPS;
  }
  // (The Odds API's props for a game, the desk's book's: asked twice at most, once to bet (within 30 hours of
  // the start) and once near it (within 2.5 hours, if it has prop bets open: their last line and price before
  // the close, the NFL's CLV); the count kept in .cache/model/odds-props.json)
  const asked = read(PROPS_ASKED, {});
  // (the NFL's, NBA's and NHL's rosters now, each team's once a run: a teammate no longer on it (traded,
  // released) counts as missing in the work his group leaves, as the history counts him (props.mjs
  // priceProps); one not read, null)
  const rosters = new Map();
  const rosterOf = async (team) => {
    if (!rosters.has(String(team))) rosters.set(String(team), await roster(cfg.league, team, ROSTER_MIN[sport] ?? 40).catch(() => null));
    return rosters.get(String(team));
  };
  for (const u of r.upcoming) {
    const game = u.game;
    try {
      // (not this run: a game whose context or injury report couldn't be read (blindOf), or, with The Odds API to
      // hand, one it doesn't list (outside its range or not matched): its props wait for a run that can see it)
      const hold = blindOf(r, game) ?? (hasKey() && !u.lines.oddsEvent ? 'not on The Odds API' : null);
      if (hold) {
        run.held = { ...(run.held ?? {}), [hold]: (run.held?.[hold] ?? 0) + 1 };
        continue;
      }
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
      const live = ROSTER_MIN[sport] ? { ...(r.live.get(game.id) ?? {}), rosters: new Map([[String(game.home), await rosterOf(game.home)], [String(game.away), await rosterOf(game.away)]]) } : r.live.get(game.id);
      const { priced, bets } = priceProps(sport, game, board_, r.props, idx, exp, f?.info ?? null, live, trust, EV_SCALE);
      run.priced += priced.length;
      // (the skips by kind: the market-gap guard's counted on its own)
      for (const x of priced) if (x.guard?.skip) run.skipped = { ...(run.skipped ?? {}), [x.guard.kind ?? 'other']: (run.skipped?.[x.guard.kind ?? 'other'] ?? 0) + 1 };
      run.under += priced.filter((x) => x.side === 'under').length;
      // (the ones at an even line: the ones it could bet)
      const even = priced.filter((x) => !x.guard?.skip);
      run.even += even.length;
      run.evenUnder += even.filter((x) => x.side === 'under').length;
      // (with The Odds API to hand, a prop waits for its real price (asked within 30 hours of the start)
      // rather than going at the assumed -110: that's only the fallback when the API can't be had)
      // (and none on a game starting within five minutes by the clock now)
      if (Date.parse(game.date) - Date.now() >= 5 * 60e3) for (const x of bets) if (x.priced || !hasKey()) candidates.push({ game, x, exp });
      for (const x of priced) r.snapshot.projections[`${game.id}:${x.prop.stat.key}:${x.prop.athlete.id}`] = [x.projection.mean, x.prop.line, x.projection.pOver];
    } catch (err) {
      console.warn(`${sport}: props for ${game.id} skipped (${err.message})`);
    }
  }
  const pendingProps = (event) => (r.pending ?? []).map((p) => p.bet).filter((b) => b.event === event && b.market === 'prop');
  for (const { game, x, exp } of candidates.sort((a, b) => b.x.ev - a.x.ev)) {
    const id = `${game.id}:prop:${x.prop.stat.key}:${x.prop.athlete.id}`;
    // (the game's props: placed before (a dry run prices those again, so only this run's count) and this run's)
    const mine = [...(DRY ? [] : ledger.bets.filter((b) => b.event === game.id && b.market === 'prop' && !b.void && b.id !== id)), ...pendingProps(game.id)];
    if (r.placed.has(id) && !DRY) continue;
    const caps = capsOf(x.prop.stat.key);
    const tested = caps === PROP_CAPS.tested;
    const inGame = mine.filter((b) => (tested ? true : !b.tested)).length;
    if ((caps.perGame !== null && inGame >= caps.perGame) || (PER_GAME !== null && mine.length >= PER_GAME)) continue;
    // (one a player a game, his best return (the candidates come best first): his props rise and fall together)
    if (caps.perPlayer !== null && caps.perPlayer !== undefined && mine.filter((b) => String(b.athlete) === String(x.prop.athlete.id)).length >= caps.perPlayer) continue;
    x.units = Math.min(x.units, caps.maxUnits);
    if (!tested && caps.perDay !== null && untestedUnits(dayOf(game.date)) + pendingProps(game.id).filter((b) => !b.tested).reduce((t, b) => t + b.units, 0) + x.units > caps.perDay) continue;
    const bet = {
      id,
      event: game.id,
      sport,
      start: game.date,
      placedAt: new Date().toISOString(),
      matchup: `${game.awayAbbr} @ ${game.homeAbbr}`,
      market: 'prop',
      propType: x.prop.stat.key,
      statLabel: x.prop.stat.label,
      player: x.prop.athlete.name,
      athlete: x.prop.athlete.id,
      // (MLB: his StatsAPI id too, which grades his total bases by id rather than by name)
      ...(sport === 'mlb' && String(x.pid).startsWith('mlb:') ? { mlbId: String(x.pid).slice(4) } : {}),
      // (his team, ESPN's id: the desk colors the bet by it)
      team: x.prop.athlete.team ?? null,
      side: x.side,
      line: x.prop.line,
      odds: x.odds,
      oddsAssumed: !x.priced,
      model: round(x.model, 4),
      fair: round(x.fair, 4),
      p: round(x.p, 4),
      ev: round(x.ev, 4),
      intent: x.ev > 0 && !x.guard ? 'edge' : 'action',
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
    // (placed with the game markets, under the game's cap: placeBets)
    r.pending.push({ bet, game });
    r.placed.add(id);
  }
  if (run.held) console.log(`${sport}: props held for a later run: ${Object.entries(run.held).map(([why, n]) => `${n} games (${why})`).join(', ')}`);
  if (run.skipped) console.log(`${sport}: props skipped: ${Object.entries(run.skipped).map(([k, n]) => `${n} ${k === 'gap' ? 'past the market gap' : 'by the other guards'}`).join(', ')}`);
  if (run.priced) console.log(`${sport}: props priced ${run.priced} in ${run.games} games (${Math.round((100 * run.under) / run.priced)}% under; at even lines ${run.even}, ${Math.round((100 * run.evenUnder) / Math.max(1, run.even))}% under), ${(r.pending ?? []).filter((p) => p.bet.market === 'prop').length} to place`);
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
    gameCap: GAME_CAP,
    // (the margins' shape, margins.mjs: kept or not, what it did for the held-out finals, its weights)
    margins: r.margins ? { ties: r.margins.ties, ot: r.margins.ot, kept: r.margins.kept, gain: r.margins.gain, n: r.margins.n, w: r.margins.w } : (state.margins ?? null),
    context: r.context,
    // (each source's time this run and whether it was asked: needed, a re-test, or skipped)
    sources: Object.fromEntries([...new Set([...Object.keys(r.times ?? {}), ...Object.keys(r.asked ?? {})])].map((k) => [k, { ...(r.times?.[k] ?? {}), asked: r.asked?.[k] ?? 'always', feeds: OPTIONAL[sport]?.[k] ?? null }])),
    props: r.props
      ? {
          odds: "DraftKings' prices where the board has them (NBA, NHL, MLB); else -110 a side assumed, lines far from the player's usual not bet (NFL)",
          perGame: PER_GAME,
          lastRun: r.propRun,
          types: Object.entries(r.props).map(([key, f]) => ({ key, label: f.stat.label, rows: f.rows, eligible: f.eligible, params: { ...f.params, roleK: Number.isFinite(f.params.roleK) ? f.params.roleK : null }, gains: f.gains, base: f.base, check: f.check, allPlayersBias: f.checkAll?.bias ?? null, trust: trust[`prop:${key}`] ?? null })),
        }
      : (state.props ?? null),
    postmortem: (() => {
      const done = ledger.bets.filter((b) => b.status !== 'open' && !b.void && b.why);
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
      terms: (state.context?.terms ?? []).map((t) => [t.key, t.size, t.kept, t.gain, t.games]),
      propTypes: state.props?.types?.map((t) => ({ key: t.key, params: t.params, gains: t.gains, base: t.base?.logLoss, check: t.check?.logLoss, bias: t.check?.bias, allBias: t.allPlayersBias, rows: t.rows, eligible: t.eligible })) ?? null,
      props: state.props?.types?.map((t) => [t.key, t.params]) ?? null,
      trust: state.trust,
      ...r.snapshot,
    });
    console.log(`${sport} (dry): snapshot in .cache/model/dry-${sport}.json`);
  }
  console.log(`${sport}: ${history.length} games kept; ${r.graded} bets graded, ${r.newBets} placed; record ${state.record.won}-${state.record.lost}-${state.record.push}, ${state.record.profit >= 0 ? '+' : ''}${state.record.profit}u`);
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
// (--picks-only: only the picks, from the ledger as it is: no fetching, fitting or betting)
const PICKS_ONLY = process.argv.includes('--picks-only');
// (only when run as the script itself: imported (a check, a test), it bets nothing and asks nothing)
if (process.argv[1] && path.relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
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
}
