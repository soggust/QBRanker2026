// Player props: DraftKings' board from ESPN's core API (every coming game's props, a page of up to 1,000 at a
// time), the main line only (one line a player a stat; no milestone ladders, no first or last scorer, no
// quarter or half lines, no longest-play lines, no anytime touchdown: it has no line), each priced against
// its projection (project.mjs) and bet like the game markets, but only with an edge.
//
// The board gives each prop's line and where it opened, and for the NBA, NHL and MLB each side's price (a
// pair of items at the same line: the over first, then the under; their prices are DraftKings', vig and
// all). The NFL's board has lines but no prices: there each side is taken at -110 (the book's fair chance
// 50%), which only holds where the line is near the player's usual, so one far from it (he's gone over it in
// under 40% or over 60% of his games this season, last season's at half weight) carries a juiced price the
// desk can't know and isn't bet. The trust in the projection is the prop type's own (start 0.5, refit on its
// graded bets once there are 40, as the markets'), against the book's fair chance where it has prices.
//
//   a bet: only with an expected return over 0 at the trusted chance, 0.5 to 3 units by it as a game market's;
//   at most PER_GAME a game (the best first); cut to 0.5 when the line has moved a lot since it opened or the
//   player's questionable, skipped at twice the move or when he's out (or not in a posted lineup, or not the
//   probable starting pitcher or goalie)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decimal, fairPair, stakeFor } from './desk.mjs';
import { fitStat, makeModel, nbOver, recal } from './project.mjs';
import { CACHE, get, pool } from './sources.mjs';
import { PROP_BOOKS, SPORT_KEYS, american, call, canSpend, hasKey } from './oddsapi.mjs';
import { round } from './ratings.mjs';
import { ESPN_PROVIDER } from './espn.mjs';
import { BOOK } from './leagues.mjs';

const CORE = 'https://sports.core.api.espn.com/v2/sports';
export const PER_GAME = 8;
export const PROP_ODDS = -110;

const stat = (key, label, match, extra = {}) => ({ key, label, match, ...extra });
const QB = (r) => r.s.passAtt >= 10;
const RUSH = (r) => r.s.rushAtt >= 1;
const CATCH = (r) => r.s.targets >= 1;

// Each sport's props: the stat (its key in the player rows), its words, the board's name for it, which rows
// count as having played it, which side's expected score is its game script, its context term
export const STATS = {
  nfl: [
    stat('passYds', 'Pass Yds', /^Total Passing Yards \(/, { played: QB, ctx: 'wind' }),
    stat('passAtt', 'Pass Att', /^Total Passing Attempts/, { played: QB, ctx: 'wind' }),
    stat('passCmp', 'Completions', /^Total Pass Completions/, { played: QB, ctx: 'wind' }),
    stat('passTd', 'Pass TDs', /^Total Passing Touchdowns/, { played: QB, ctx: 'wind' }),
    stat('passInt', 'INTs', /^Total Passing Interceptions/, { played: QB, ctx: 'wind' }),
    stat('rushYds', 'Rush Yds', /^Total Rushing Yards \(/, { played: RUSH }),
    stat('rushAtt', 'Carries', /^Total Carries/, { played: RUSH }),
    stat('recYds', 'Rec Yds', /^Total Receiving Yards \(/, { played: CATCH, ctx: 'backupQb' }),
    stat('rec', 'Receptions', /^Total Receptions/, { played: CATCH, ctx: 'backupQb' }),
    stat('rushRecYds', 'Rush+Rec Yds', /^Total Rushing Plus Receiving Yards/, { played: (r) => RUSH(r) || CATCH(r), ctx: 'backupQb' }),
  ],
  nba: [
    stat('pts', 'Points', /^Total Points( \(|$)/, { played: (r) => r.s.min >= 10, ctx: 'usage', posGroup: () => 'all' }),
    stat('reb', 'Rebounds', /^Total Rebounds/, { played: (r) => r.s.min >= 10, ctx: 'usage', posGroup: () => 'all' }),
    stat('ast', 'Assists', /^Total Assists/, { played: (r) => r.s.min >= 10, ctx: 'usage', posGroup: () => 'all' }),
    stat('fg3', 'Threes', /^Total (3-Point|Three|Made 3)/i, { played: (r) => r.s.min >= 10, ctx: 'usage', posGroup: () => 'all' }),
    stat('pra', 'Pts+Reb+Ast', /Points.*Rebounds.*Assists/i, { played: (r) => r.s.min >= 10, ctx: 'usage', posGroup: () => 'all' }),
  ],
  nhl: [
    stat('sog', 'Shots', /^Total Shots on Goal/, { played: (r) => r.pos !== 'G' && r.s.toi >= 5 }),
    stat('pts', 'Points', /^Total Points$/, { played: (r) => r.pos !== 'G' && r.s.toi >= 5 }),
    stat('saves', 'Saves', /^Total Saves/, { played: (r) => r.pos === 'G' && r.s.toi >= 40, script: 'opp', goalie: true }),
  ],
  mlb: [
    stat('k', 'Strikeouts', /^Total Strikeouts$/, { played: (r) => r.pos === 'SP', script: 'opp', pitcher: true }),
    stat('outs', 'Outs', /^Total Outs Recorded/, { played: (r) => r.pos === 'SP', script: 'opp', pitcher: true }),
    stat('hits', 'Hits', /^Total Hits$/, { played: (r) => r.pos === 'B' && r.s.pa >= 1 }),
    stat('tb', 'Total Bases', /^Total Bases$/, { played: (r) => r.pos === 'B' && r.s.pa >= 1 }),
  ],
};

// The settings that let a stat's model see the game: its side's expected score over the average (script),
// and its context term, from each game's expectation and terms (expPts: game id to [home, away]; info: game
// id to the context's info)
export function envFor(sport, st, expPts, info, rows) {
  const all = [...expPts.values()].flat().filter(Number.isFinite);
  const avg = all.length ? all.reduce((s, x) => s + x, 0) / all.length : 1;
  const vals = rows.filter(st.played).map((r) => r.s[st.key]);
  const mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 1;
  const side = (row, own) => (row.home === own ? 0 : 1);
  const script = (row) => {
    const e = expPts.get(row.game);
    if (!e) return 1;
    const v = e[side(row, st.script !== 'opp')];
    return Number.isFinite(v) && v > 0 ? v / avg : 1;
  };
  const ctx = {
    // (wind over 10 mph, per 10 mph: a passer's numbers)
    wind: (row) => {
      const w = info.get(row.game)?.weather?.wind;
      return Number.isFinite(w) ? Math.max(0, w - 10) / 10 : 0;
    },
    // (his own side starting a backup quarterback: a receiver's numbers)
    backupQb: (row) => info.get(row.game)?.starters?.backup?.[row.home ? 0 : 1] ?? 0,
    // (his teammates' production missing, per 10: an NBA player's usage)
    usage: (row) => (info.get(row.game)?.starters?.missing?.[row.home ? 0 : 1] ?? 0) / 10,
  }[st.ctx];
  return { script, ctx, mean, avg };
}

// Which of a game's players a book posts this prop for (eligible): each team's top few by usage in the game,
// by the stat's own measure. NFL: its passer (most attempts); rushing, its top two runners (and its passer);
// receiving, its top four by targets. NBA: its top eight by minutes. NHL: its top six forwards and top two
// defensemen by time on ice; the goalie who played most of it. MLB: every starting batter (three or more
// trips to the plate); every starting pitcher.
function markEligible(sport, st, rows) {
  const games = new Map();
  for (const r of rows) {
    const key = `${r.game}|${r.team}`;
    games.set(key, [...(games.get(key) ?? []), r]);
  }
  const top = (list, by, n, filter = () => true) => new Set(list.filter(filter).sort((a, b) => by(b) - by(a)).slice(0, n));
  for (const list of games.values()) {
    let ok;
    if (sport === 'nfl') {
      const passer = top(list, (r) => r.s.passAtt, 1, (r) => r.s.passAtt >= 10);
      const runners = top(list, (r) => r.s.rushAtt, 2, (r) => !passer.has(r));
      const catchers = top(list, (r) => r.s.targets, 4);
      ok = /^pass/.test(st.key) ? passer : /^rush(Yds|Att)$/.test(st.key) ? new Set([...runners, ...passer]) : st.key === 'rushRecYds' ? new Set([...runners, ...catchers]) : catchers;
    } else if (sport === 'nba') ok = top(list, (r) => r.s.min, 8);
    else if (sport === 'nhl') ok = st.key === 'saves' ? top(list, (r) => r.s.toi, 1, (r) => r.pos === 'G') : new Set([...top(list, (r) => r.s.toi, 6, (r) => r.pos === 'F'), ...top(list, (r) => r.s.toi, 2, (r) => r.pos === 'D')]);
    else ok = new Set(list.filter((r) => r.pos === 'SP' || r.s.pa >= 3));
    for (const r of list) r.eligible = ok.has(r);
  }
  return rows;
}

// Every prop type's projection model fit and checked on the history (the check on the eligible players);
// the state shows them
export function fitProps(sport, rows, expPts, info) {
  const out = {};
  for (const st of STATS[sport]) {
    const mine = markEligible(
      sport,
      st,
      rows.filter((r) => r.team && r.opp && st.played(r)).map((r) => ({ ...r })),
    );
    const env = envFor(sport, st, expPts, info, mine);
    const t0 = Date.now();
    const fitted = fitStat(st, mine, env);
    if (!fitted) continue;
    // (the model through every final, for the coming games)
    const sorted = [...mine].sort((a, b) => a.date.localeCompare(b.date));
    const model = makeModel(st, fitted.params, env);
    let i = 0;
    while (i < sorted.length) {
      const day = sorted[i].date.slice(0, 10);
      let j = i;
      while (j < sorted.length && sorted[j].date.slice(0, 10) === day) j++;
      model.learn(sorted.slice(i, j));
      i = j;
    }
    // (each player's values, by season: his record at a line)
    const values = new Map();
    for (const r of sorted) values.set(r.pid, [...(values.get(r.pid) ?? []), [r.season, Math.max(0, Math.round(r.s[st.key]))]]);
    out[st.key] = { stat: st, env, model, values, params: fitted.params, check: fitted.check, checkAll: fitted.checkAll, rows: mine.length, eligible: mine.filter((r) => r.eligible).length, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const athletesFile = path.join(CACHE, 'athletes.json');
let athletes = null;
const athlete = async (ref) => {
  athletes ??= existsSync(athletesFile) ? JSON.parse(readFileSync(athletesFile, 'utf8')) : {};
  const id = ref.match(/athletes\/(\d+)/)?.[1];
  if (!id) return null;
  const key = `${ref.match(/sports\/(\w+)\/leagues\/(\w+)/)?.slice(1).join('/')}:${id}`;
  if (!athletes[key]) {
    const body = await get(ref.replace('http://', 'https://'));
    if (!body) return null;
    athletes[key] = { id, name: body.displayName, pos: body.position?.abbreviation ?? '', team: body.team?.$ref?.match(/teams\/(\d+)/)?.[1] ?? null };
  }
  return athletes[key];
};
const saveAthletes = () => {
  if (!athletes) return;
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(athletesFile, JSON.stringify(athletes));
};

// (a main line's prices: its pair's American odds, the over first, then the under; null without both)
function pricesOf(pair) {
  const odds = (it) => Number(String(it?.odds?.american?.value ?? '').replace('+', ''));
  const [over, under] = pair.map(odds);
  return pair.length === 2 && Number.isFinite(over) && Number.isFinite(under) && over && under ? { over, under } : null;
}

// The Odds API's market for each prop the desk models
export const API_MARKETS = {
  nfl: { player_pass_yds: 'passYds', player_pass_attempts: 'passAtt', player_pass_completions: 'passCmp', player_pass_tds: 'passTd', player_pass_interceptions: 'passInt', player_rush_yds: 'rushYds', player_rush_attempts: 'rushAtt', player_reception_yds: 'recYds', player_receptions: 'rec', player_rush_reception_yds: 'rushRecYds' },
  nba: { player_points: 'pts', player_rebounds: 'reb', player_assists: 'ast', player_threes: 'fg3', player_points_rebounds_assists: 'pra' },
  nhl: { player_shots_on_goal: 'sog', player_points: 'pts', player_total_saves: 'saves' },
  mlb: { pitcher_strikeouts: 'k', pitcher_outs: 'outs', batter_hits: 'hits', batter_total_bases: 'tb' },
};

// A game's props from The Odds API, the desk's book only (cost: the markets it returns): by player and stat,
// the line and each side's price; null when it can't be had
export async function apiProps(sport, oddsEvent) {
  const markets = Object.keys(API_MARKETS[sport]);
  if (!oddsEvent || !hasKey() || !canSpend('props', markets.length)) return null;
  const body = await call('props', `/sports/${SPORT_KEYS[sport]}/events/${oddsEvent}/odds`, { markets: markets.join(','), bookmakers: PROP_BOOKS.join(',') });
  const book = body?.bookmakers?.find((b) => b.key === BOOK);
  if (!book) return body ? new Map() : null;
  const out = new Map();
  for (const m of book.markets ?? []) {
    const stat = API_MARKETS[sport][m.key];
    if (!stat) continue;
    for (const o of m.outcomes ?? []) {
      const key = `${o.description}|${stat}|${o.point}`;
      const x = out.get(key) ?? { name: o.description, stat, line: o.point };
      x[String(o.name).toLowerCase()] = american(o.price);
      out.set(key, x);
    }
  }
  // (a player's main line: the one with both sides; the first such)
  const main = new Map();
  for (const x of out.values()) if (x.over && x.under && !main.has(`${x.name}|${x.stat}`)) main.set(`${x.name}|${x.stat}`, x);
  return main;
}

// ESPN's board with The Odds API's lines and prices on it, where the API has the player: its line and both
// prices replace the board's (the same book's, fresher, and the NFL's with prices at all)
export function withApiPrices(board_, api) {
  if (!api) return board_;
  return board_.map((p) => {
    const x = api.get(`${p.athlete.name}|${p.stat.key}`);
    return x ? { ...p, line: x.line, prices: { over: x.over, under: x.under }, source: 'the odds api' } : p;
  });
}

// A game's main-line player props: [{ athlete, stat, line, open, prices }] (every page of the board)
export async function board(sport, league, game) {
  if (!ESPN_PROVIDER[BOOK]) return [];
  const [kind, lg] = league.split('/');
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const body = await get(`${CORE}/${kind}/leagues/${lg}/events/${game.id}/competitions/${game.id}/odds/${ESPN_PROVIDER[BOOK]}/propBets?lang=en&region=us&limit=1000&page=${page}`);
    if (!body?.items) break;
    items.push(...body.items);
    if (page >= (body.pageCount ?? 1)) break;
  }
  const groups = new Map();
  for (const it of items) {
    const st = STATS[sport].find((s) => s.match.test(it.type?.name ?? ''));
    const ref = it.athlete?.$ref;
    const line = it.current?.target?.value;
    if (!st || !ref || !Number.isFinite(line)) continue;
    const key = `${ref}|${st.key}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const out = [];
  await pool([...groups.entries()], 4, async ([key, list]) => {
    // (the main line: the one the board lists most for him, the middle one at a tie)
    const counts = new Map();
    for (const it of list) counts.set(it.current.target.value, (counts.get(it.current.target.value) ?? 0) + 1);
    const lines = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = lines.filter((l) => l[1] === lines[0][1]).map((l) => l[0]);
    const line = top[Math.floor((top.length - 1) / 2)];
    const at = list.filter((x) => x.current.target.value === line);
    const it = at[0];
    const who = await athlete(key.split('|')[0]);
    if (!who) return;
    out.push({ athlete: who, stat: STATS[sport].find((s) => s.key === key.split('|')[1]), line, open: it.open?.target?.value ?? null, prices: pricesOf(at) });
  });
  saveAthletes();
  return out;
}

// ---------------------------------------------------------------------------
// Pricing and betting a game's props
// ---------------------------------------------------------------------------

// A player's id in the rows (ESPN's for the NFL, NBA and NHL; StatsAPI's for MLB, by his name and team)
export function rowsIndex(sport, rows) {
  const byName = new Map();
  for (const r of rows) byName.set(`${r.name}|${r.team}`, r.pid), byName.set(r.name, byName.get(r.name) === undefined || byName.get(r.name) === r.pid ? r.pid : null);
  const pos = new Map(rows.map((r) => [r.pid, r.pos]));
  return {
    pid: (a) => (sport === 'mlb' ? (byName.get(`${a.name}|${a.team}`) ?? byName.get(a.name) ?? null) : a.id),
    pos: (pid) => pos.get(pid) ?? null,
  };
}

// The prop bets for a coming game: each main line projected and priced, the ones with an edge, best first, at
// most PER_GAME. exp: the game model's expectation (its homePts and awayPts); info: the context's info for the
// game; live: the game's live facts (injury report, probables, lineups); trust: prop type to trust
export function priceProps(sport, game, props, fitted, idx, exp, info, live, trust, evScale) {
  const priced = [];
  for (const prop of props) {
    const f = fitted[prop.stat.key];
    if (!f) continue;
    const a = prop.athlete;
    const pid = idx.pid(a);
    if (!pid) continue;
    const home = String(a.team) === String(game.home) ? true : String(a.team) === String(game.away) ? false : null;
    if (home === null) continue;
    const row = { pid, name: a.name, pos: idx.pos(pid) ?? a.pos, date: game.date, season: game.season, team: home ? game.home : game.away, opp: home ? game.away : game.home, game: game.id, home, s: {} };
    const p = f.model.project(row);
    if (!p) continue;
    // (the game script and the context: this game's, from the game model's expectation and its terms)
    const own = home ? exp.homePts : exp.awayPts;
    const opp = home ? exp.awayPts : exp.homePts;
    const scriptV = (f.stat.script === 'opp' ? opp : own) / (f.env.avg || own || 1);
    const ctxV = ctxNow(f.stat.ctx, info, home);
    const mu = Math.max(0.05, p.base * Math.pow(p.opp, f.params.a) * Math.pow(scriptV, f.params.b) * Math.exp(f.params.c * ctxV));
    const pOver = recal(nbOver(prop.line, mu, f.params.r), f.params.cal);
    // (the fair chance: his own record at this line, this season and half of last)
    let overs = 0;
    let n = 0;
    for (const [season, v] of f.values.get(pid) ?? []) {
      const w = season === game.season ? 1 : season === game.season - 1 ? 0.5 : 0;
      n += w;
      if (v > prop.line) overs += w;
    }
    const fairOver = (overs + 1) / (n + 2);
    const t = trust[`prop:${prop.stat.key}`]?.trust ?? 0.5;
    // (the book's prices where it gave them, its fair chance their vig taken out; else -110 a side, even)
    const book = prop.prices ? { over: prop.prices.over, under: prop.prices.under, fairOver: fairPair(prop.prices.over, prop.prices.under) } : { over: PROP_ODDS, under: PROP_ODDS, fairOver: 0.5 };
    const sides = [
      { side: 'over', model: pOver, fair: book.fairOver, odds: book.over },
      { side: 'under', model: 1 - pOver, fair: 1 - book.fairOver, odds: book.under },
    ].map((x) => {
      const p = x.fair + t * (x.model - x.fair);
      return { ...x, p, ev: p * decimal(x.odds) - 1 };
    });
    const pick = sides[0].ev >= sides[1].ev ? sides[0] : sides[1];
    const { side, model, ev, odds, fair } = pick;
    const pTrusted = pick.p;
    // (the guard: his status, his line's move)
    const status = statusOf(sport, prop, live, home, game);
    const moved = prop.open !== null ? prop.line - prop.open : 0;
    const limit = Math.max(1, 0.12 * prop.line);
    let guard = null;
    if (status.skip) guard = { skip: true, why: status.why };
    // (a long shot at the book's own price: where a projection's errors are biggest and the book is most
    // likely right)
    else if (prop.prices && fair < 0.25) guard = { skip: true, why: `a long shot (the book's fair chance ${Math.round(fair * 100)}%)` };
    else if (!prop.prices && (fairOver < 0.4 || fairOver > 0.6)) guard = { skip: true, why: `line far from his usual (over it in ${Math.round(fairOver * 100)}% of his games): a juiced price the desk can't know` };
    else if (Math.abs(moved) >= 2 * limit) guard = { skip: true, why: `line moved ${moved > 0 ? '+' : ''}${round(moved, 1)} since it opened` };
    else if (Math.abs(moved) >= limit) guard = { why: `line moved ${moved > 0 ? '+' : ''}${round(moved, 1)} since it opened` };
    else if (status.why) guard = { why: status.why };
    priced.push({
      prop,
      pid,
      side,
      model,
      fair,
      odds,
      priced: !!prop.prices,
      p: pTrusted,
      ev,
      units: guard ? 0.5 : stakeFor(ev, evScale),
      guard,
      projection: { mean: round(mu, 2), r: f.params.r, rate: round(p.rate, 2), recent: round(p.recent, 2), opp: round(p.opp, 3), script: round(scriptV, 3), ctx: round(ctxV, 2), games: p.games, lastSeason: p.prevGames, pOver: round(pOver, 4), fairOver: round(fairOver, 4), record: round(n, 1) },
      move: prop.open !== null ? { open: prop.open, now: prop.line } : null,
    });
  }
  const bets = priced
    .filter((x) => x.ev > 0 && !x.guard?.skip)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, PER_GAME);
  return { priced, bets };
}

// (a context term's value for a coming game, from its info)
function ctxNow(kind, info, home) {
  if (!kind || !info) return 0;
  if (kind === 'wind') return Number.isFinite(info.weather?.wind) ? Math.max(0, info.weather.wind - 10) / 10 : 0;
  if (kind === 'backupQb') return info.starters?.backup?.[home ? 0 : 1] ?? 0;
  if (kind === 'usage') return (info.starters?.missing?.[home ? 0 : 1] ?? 0) / 10;
  return 0;
}

// (a player's status for a coming game: out, questionable, not in a posted lineup, not the probable starter)
function statusOf(sport, prop, live, home, game) {
  const a = prop.athlete;
  const report = live?.injuries?.get(String(a.team)) ?? [];
  const hurt = report.find((p) => p.id === a.id || p.name === a.name);
  if (hurt && /^out|doubtful|injured reserve|il$|-il|suspension/i.test(hurt.status)) return { skip: true, why: `${a.name} ${hurt.status.toLowerCase()}` };
  if (sport === 'nhl' && prop.stat.goalie) {
    const g = live?.[home ? 'home' : 'away'];
    if (!g) return { skip: true, why: 'no probable goalie' };
    if (g.id !== a.id) return { skip: true, why: `${a.name} not the probable goalie` };
    if (!/confirmed/i.test(g.status ?? '')) return { why: `${a.name} expected, not confirmed` };
  }
  if (sport === 'mlb') {
    const names = live?.names ?? [];
    if (prop.stat.pitcher && names[home ? 0 : 1] && names[home ? 0 : 1] !== a.name) return { skip: true, why: `${a.name} not the probable starter` };
    const lineup = live?.lineupNames?.[home ? 0 : 1];
    if (!prop.stat.pitcher && lineup?.length && !lineup.includes(a.name)) return { skip: true, why: `${a.name} not in the posted lineup` };
    if (!prop.stat.pitcher && !lineup?.length) return { why: `lineup not posted (${home ? game.homeAbbr : game.awayAbbr})` };
  }
  if (hurt && /questionable|day-to-day|game-time/i.test(hurt.status)) return { why: `${a.name} ${hurt.status.toLowerCase()}` };
  return {};
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

// A player's stat in a final, from its summary (and for MLB total bases, StatsAPI's box score); null when he
// didn't play
export async function statInFinal(sport, bet, body, pk) {
  const id = String(bet.athlete);
  for (const p of body?.boxscore?.players ?? []) {
    for (const s of p.statistics ?? []) {
      const a = (s.athletes ?? []).find((x) => String(x.athlete?.id) === id);
      if (!a || !a.stats?.length || a.didNotPlay) continue;
      const at = (k) => (s.labels ?? []).indexOf(k);
      const num = (k, part = 0) => Number(String(a.stats[at(k)] ?? '').split(/[-/]/)[part]) || 0;
      const k = bet.propType;
      if (sport === 'nfl') {
        if (s.name === 'passing' && ['passYds', 'passAtt', 'passCmp', 'passTd', 'passInt'].includes(k)) return { passYds: num('YDS'), passAtt: num('C/ATT', 1), passCmp: num('C/ATT', 0), passTd: num('TD'), passInt: num('INT') }[k];
        if (s.name === 'rushing' && (k === 'rushYds' || k === 'rushAtt')) return k === 'rushYds' ? num('YDS') : num('CAR');
        if (s.name === 'receiving' && (k === 'recYds' || k === 'rec')) return k === 'recYds' ? num('YDS') : num('REC');
        continue;
      }
      if (sport === 'nba') return { pts: num('PTS'), reb: num('REB'), ast: num('AST'), fg3: num('3PT'), pra: num('PTS') + num('REB') + num('AST') }[k];
      if (sport === 'nhl') return k === 'saves' ? num('SV') : k === 'sog' ? num('S') : num('G') + num('A');
      if (sport === 'mlb') {
        if ((k === 'k' || k === 'outs') && (s.type === 'pitching' || s.name === 'pitching')) {
          const [w, part] = String(a.stats[at('IP')] ?? '0').split('.').map(Number);
          return k === 'k' ? num('K') : w * 3 + (part || 0);
        }
        if (k === 'hits' && (s.type === 'batting' || s.name === 'batting')) return num('H');
      }
    }
  }
  // (NFL rushing plus receiving: both tables; MLB total bases: StatsAPI's box score)
  if (sport === 'nfl' && bet.propType === 'rushRecYds') {
    const one = (k) => statInFinal(sport, { ...bet, propType: k }, body, pk);
    const [r, c] = [await one('rushYds'), await one('recYds')];
    return r === null && c === null ? null : (r ?? 0) + (c ?? 0);
  }
  if (sport === 'mlb' && bet.propType === 'tb' && pk) {
    const box = await get(`https://statsapi.mlb.com/api/v1/game/${pk}/boxscore`);
    for (const side of ['home', 'away']) {
      for (const pl of Object.values(box?.teams?.[side]?.players ?? {})) {
        if (pl.person?.fullName === bet.player && pl.stats?.batting?.plateAppearances) return pl.stats.batting.totalBases ?? 0;
      }
    }
  }
  return null;
}

// A prop bet graded: won, lost, pushed (on the line), or void (he didn't play: no action)
export function settleProp(bet, value) {
  if (value === null || value === undefined) return { status: 'push', profit: 0, void: true, actual: null, final: 'did not play' };
  const edge = (bet.side === 'over' ? 1 : -1) * (value - bet.line);
  const status = edge > 0 ? 'won' : edge < 0 ? 'lost' : 'push';
  const profit = status === 'won' ? bet.units * (decimal(bet.odds) - 1) : status === 'lost' ? -bet.units : 0;
  return { status, profit: round(profit, 3), actual: value, final: `${bet.player} ${value} ${bet.statLabel}` };
}
