// Player props: DraftKings' board from ESPN's core API (every coming game's props, a page of up to 1,000 at a
// time), the main line only (one line a player a stat; no milestone ladders, no first or last scorer, no
// quarter or half lines, no longest-play lines, no anytime touchdown: it has no line), each priced against
// its projection (project.mjs) and bet like the game markets: with an edge at its Kelly stake, without one at
// the 0.5-unit minimum as an action bet (for the data: its trust and CLV), unless a guard skips it.
//
// The board gives each prop's line and where it opened, and for the NBA, NHL and MLB each side's price (a
// pair of items at the same line: the over first, then the under; their prices are DraftKings', vig and
// all). The NFL's board has lines but no prices: there each side is taken at -110 (the book's fair chance
// 50%), which only holds where the line is near the player's usual, so one far from it (he's gone over it in
// under 40% or over 60% of his games this season, last season's at half weight) carries a juiced price the
// desk can't know and isn't bet. The trust in the projection is the prop type's own (start 0.5, refit on its
// graded bets once there are 40, as the markets'), against the book's fair chance where it has prices.
//
//   a bet: every main line not skipped, 0.5 to 3 units by its expected return at the trusted chance as a game
//   market's (desk.mjs stakeFor), its lean tapered past half of GAP.prop (15 points) as a game market's (desk.mjs
//   chanceAt: the further from the book, the less of it counts, so the stake shrinks as the gap grows); one a
//   player a game (leagues.mjs PROP_CAPS). A whole-number line's push is out of both sides' chances and its stake
//   comes back in the return (project.mjs lineChances). Cut to 0.5 when the line has moved a lot since it opened,
//   the player's questionable, a questionable teammate's being in or out moves his share of his group's work,
//   an outdoor game's forecast failed (or a retractable roof isn't yet said open or closed) where his
//   projection weighs the weather (wind, cold, rain), the forecast moves his projection 10% or more, the other
//   side's starter his projection weighs isn't listed yet (an NHL goalie, an MLB pitcher), an MLB starter's
//   first start in LONG_REST days or more or his first of the season from LATE_DEBUT, his team's roster
//   can't be read (the NFL, NBA, NHL) or (the NFL) the snap counts are missing for some games of the
//   history; skipped at twice the move or when he's out (or not in a posted lineup, or not the probable
//   starting pitcher or goalie), an MLB starter's first start in LAYOFF days or more (or his first of the
//   season from May on: back from injury, his pitch count held down), when the work his group is missing now
//   differs from what it was in the games his numbers come from and the projection can't size it (teammates
//   out: his role up; teammates back from an absence that fed his numbers: his role down), or when its
//   chance is more than GAP.prop from the book's (the market knowing something it doesn't); also when his
//   team's roster can't be read and his numbers were made with teammates missing (whether they're back or
//   gone can't be told), or (the NFL) the snap counts are missing for a season's quarter or more of the
//   history's games
//
//   when: inside the game's props window (leagues.mjs TIMING; run.mjs betProps), each once the news it waits
//   for is in (timing.mjs newsMissing: an MLB batter's lineup and the other side's starter, a pitcher's own
//   start, the NHL's goalies) or at the last chance, flagged at the minimum; priced again, taken back and
//   placed anew, when the game's inputs change before the start (timing.mjs inputsOf, run.mjs repriceOpen)
//
// The history it's fit on (fitProps): every game a player took the field at the stat's positions, whatever he
// did in it, as DraftKings grades him (STATS played), and of those the ones a book would have posted his prop
// for by what was known before the game (markEligible: his usage in his games before it), never by the
// game's own box score. An MLB batter's are his starts (his place in the posted lineup: the book only posts a
// starter's, and the desk bets only one in the lineup), not a pinch hitter's one trip

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chanceAt, decimal, fairPair, gapGuard, outcomeOf, stakeFor } from './desk.mjs';
import { ctxFactor, ctxKeys, fitStat, lineChances, makeModel, rAt } from './project.mjs';
import { mlbMatchups, nbaMatchups, nflMatchups, nhlMatchups } from './matchups.mjs';
import { CACHE, get, nflverseRows, pool } from './sources.mjs';
import { PROP_BOOKS, SPORT_KEYS, american, call, canSpend, hasKey } from './oddsapi.mjs';
import { round } from './ratings.mjs';
import { ESPN_PROVIDER, ROSTER_MIN, goaliesInOrder } from './espn.mjs';
import { BOOK } from './leagues.mjs';
import { OUT_STATUS, Q_STATUS } from './timing.mjs';

const CORE = 'https://sports.core.api.espn.com/v2/sports';
// (no cap a game: every main-line prop that isn't skipped gets a bet, 0.5u at no edge, like the game markets:
// the user wants every bet the data can give; null keeps the name for the state)
export const PER_GAME = null;
export const PROP_ODDS = -110;
// (a prop whose count can't be read yet (the NFL's snap counts not posted, StatsAPI down) waits this long after
// its start, then is no action: the bettor's (run.mjs) and the play-money settler's (settle-lib.mjs) alike, so
// the same pick never ends one way on the desk and another on a user's account)
export const PROP_WAIT = 4 * 864e5;
// (an MLB starter's days since he last pitched at which his start is skipped: a layoff, an injury most likely.
// A 15-day IL stint, backdated, brings him back 13 to 19 days on; a normal turn, the All-Star break or a
// skipped start, 10 or 11 at most. In 2025-26's starts, 12 to 19 days off threw 0.92 of his usual pitches, a
// third of them under 0.85, against 1.01 and 12% on normal rest. LONG_REST: from it, flagged (0.5u): 11 and
// 12 days held a little lower, 0.95 to 0.97)
export const LAYOFF = 13;
export const LONG_REST = 11;
// (his first start of the season from this day on (month-day; opening day's in late March) flagged as late:
// back from injury maybe; from May on, skipped)
export const LATE_DEBUT = '04-08';
// (whether an MLB starter's start is a layoff's or a debut from May on (skip), a long rest's or a late debut's
// (flag), or none (null): restDays his days since he last pitched this season (null: none yet), debut his first
// start of it, date the game's)
export function restGuard(restDays, debut, date) {
  const md = String(date ?? '').slice(5, 10);
  if ((restDays ?? 0) >= LAYOFF) return 'layoff';
  if (debut && md >= '05-01') return 'debut';
  if ((restDays ?? 0) >= LONG_REST) return 'long';
  if (debut && md >= LATE_DEBUT) return 'late';
  return null;
}

const stat = (key, label, match, extra = {}) => ({ key, label, match, ...extra });
// (which rows count as a game he played the prop in: every game he took the field at the stat's positions,
// whatever he did in it, as DraftKings grades it (a receiver never targeted has action and 0 catches, a starter
// hurt in the first quarter has action): never by the game's own numbers, which would keep only his good games.
// Which of these a book would have posted a prop for is markEligible's, from before the game)
const QB = (r) => r.pos === 'QB';
const RUSH = (r) => r.pos === 'RB' || r.pos === 'FB' || r.pos === 'QB';
const CATCH = (r) => r.pos === 'WR' || r.pos === 'TE' || r.pos === 'RB' || r.pos === 'FB';
const MIN = (r) => r.s.min > 0;
const SKATER = (r) => r.pos !== 'G' && r.s.toi > 0;

// Each sport's props: the stat (its key in the player rows), its words, the board's name for it, which rows
// count as having played it, which side's expected score is its game script (opp: the other side's), its
// context terms (ctxValue; each fit on its own and kept only if the held-out games are better with it:
// project.mjs; an NHL goalie's saves also by the other side's expected shots on goal, hockey.mjs)
const PASSING = ['wind', 'cold', 'precip'];
const CARRYING = ['backupQb', 'wind', 'precip'];
const NBA_CTX = ['usage', 'b2b', 'blowout'];
// (the NBA's and NHL's work missing in two measures (matchups.mjs: minutes or usage; time on ice or power-play
// time), three splits each)
const NBA_VAC = { vacated: true, vacSplits: 6 };
// (an MLB batter's start: his place in the game's lineup (matchups.mjs mlbMatchups: start), DraftKings' book
// only posts a starter's, and a pinch hitter's one trip would drag a starter's rate down; a game without its
// lineup, two plate appearances or more)
const BATTED = (r) => r.pos === 'B' && (r.start === true || ((r.start === null || r.start === undefined) && r.s.pa >= 2));
const BATTER_CTX = ['slot', 'platoon', 'oppSp'];
const PITCHER_CTX = ['leash', 'restSp', 'ump'];
export const STATS = {
  nfl: [
    stat('passYds', 'Pass Yds', /^Total Passing Yards \(/, { played: QB, ctx: PASSING, volume: 'pass' }),
    stat('passAtt', 'Pass Att', /^Total Passing Attempts/, { played: QB, ctx: PASSING, volume: 'pass' }),
    stat('passCmp', 'Completions', /^Total Pass Completions/, { played: QB, ctx: PASSING, volume: 'pass' }),
    stat('passTd', 'Pass TDs', /^Total Passing Touchdowns/, { played: QB, ctx: PASSING }),
    stat('passInt', 'INTs', /^Total Passing Interceptions/, { played: QB, ctx: PASSING }),
    stat('rushYds', 'Rush Yds', /^Total Rushing Yards \(/, { played: RUSH, ctx: CARRYING, roles: true, volume: 'rush', vacated: true }),
    stat('rushAtt', 'Carries', /^Total Carries/, { played: RUSH, ctx: CARRYING, roles: true, volume: 'rush', vacated: true }),
    stat('recYds', 'Rec Yds', /^Total Receiving Yards \(/, { played: CATCH, ctx: CARRYING, roles: true, volume: 'pass', targets: true, vacated: true }),
    stat('rec', 'Receptions', /^Total Receptions/, { played: CATCH, ctx: CARRYING, roles: true, volume: 'pass', targets: true, vacated: true }),
    stat('rushRecYds', 'Rush+Rec Yds', /^Total Rushing Plus Receiving Yards/, { played: (r) => (RUSH(r) && r.pos !== 'QB') || CATCH(r), ctx: CARRYING, roles: true, targets: true, vacated: true }),
  ],
  nba: [
    stat('pts', 'Points', /^Total Points( \(|$)/, { played: MIN, ctx: NBA_CTX, posGroup: () => 'all', roles: true, ...NBA_VAC }),
    stat('reb', 'Rebounds', /^Total Rebounds/, { played: MIN, ctx: NBA_CTX, posGroup: () => 'all', roles: true, ...NBA_VAC }),
    stat('ast', 'Assists', /^Total Assists/, { played: MIN, ctx: NBA_CTX, posGroup: () => 'all', roles: true, ...NBA_VAC }),
    stat('fg3', 'Threes', /^Total (3-Point|Three|Made 3)/i, { played: MIN, ctx: NBA_CTX, posGroup: () => 'all', roles: true, ...NBA_VAC }),
    stat('pra', 'Pts+Reb+Ast', /Points.*Rebounds.*Assists/i, { played: MIN, ctx: NBA_CTX, posGroup: () => 'all', roles: true, ...NBA_VAC }),
  ],
  nhl: [
    stat('sog', 'Shots', /^Total Shots on Goal/, { played: SKATER, ctx: ['pp'], ...NBA_VAC }),
    stat('pts', 'Points', /^Total Points$/, { played: SKATER, ctx: ['pp', 'oppGoalie'], ...NBA_VAC }),
    stat('saves', 'Saves', /^Total Saves/, { played: (r) => r.pos === 'G' && r.started, script: 'opp', ctx: ['oppShots'], goalie: true }),
  ],
  mlb: [
    stat('k', 'Strikeouts', /^Total Strikeouts$/, { played: (r) => r.pos === 'SP', script: 'opp', ctx: PITCHER_CTX, pitcher: true }),
    stat('outs', 'Outs', /^Total Outs Recorded/, { played: (r) => r.pos === 'SP', script: 'opp', ctx: PITCHER_CTX, pitcher: true }),
    stat('hits', 'Hits', /^Total Hits$/, { played: BATTED, ctx: BATTER_CTX }),
    stat('tb', 'Total Bases', /^Total Bases$/, { played: BATTED, ctx: BATTER_CTX }),
  ],
};

// The settings that let a stat's model see the game: its side's expected score over the average (script),
// and its context terms, from each game's expectation and terms (expPts: game id to [home, away], each made
// before the game; info: game id to the context's info, from what was known before it). The same functions
// price a coming game (priceProps: its expectation and its info), so the history and the bet see one thing
export function envFor(sport, st, expPts, info, rows) {
  const all = [...expPts.values()].flat().filter(Number.isFinite);
  const avg = all.length ? all.reduce((s, x) => s + x, 0) / all.length : 1;
  const vals = rows.filter(st.played).map((r) => r.s[st.key]);
  const mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 1;
  const env = { mean, avg };
  const keys = ctxKeys(st);
  env.script = (row) => scriptValue(st, env, info.get(row.game), expPts.get(row.game), row.home);
  env.ctx = keys.length ? (row) => ctxValues(keys, info.get(row.game), row.home, expPts.get(row.game), row) : null;
  return env;
}

// A stat's game script for a game: its side's expected score (opp: the other side's) over the league's
// average; 1 where the game model has none. pts: the game's expected [home, away] points
export function scriptValue(st, env, info, pts, home) {
  const v = pts?.[(home === (st.script !== 'opp')) ? 0 : 1];
  return Number.isFinite(v) && v > 0 && env.avg ? v / env.avg : 1;
}

// A context term's value for a game, from its info (context.mjs featurize: the weather, starters, schedule),
// its expected [home, away] points and the player's row (its matchups, matchups.mjs: each from before the game,
// a coming game's from its live facts); 0 where it's unknown (no effect)
export const CTX = {
  // (wind over 10 mph, per 10 mph, outdoors)
  wind: (info) => (Number.isFinite(info?.weather?.wind) ? Math.max(0, info.weather.wind - 10) / 10 : 0),
  // (cold under 50°F, per 10°F, outdoors)
  cold: (info) => (Number.isFinite(info?.weather?.temp) ? Math.max(0, 50 - info.weather.temp) / 10 : 0),
  // (rain and melted snow over the game's window, per 0.1 inch, to half an inch: outdoors)
  precip: (info) => (Number.isFinite(info?.weather?.precip) ? Math.min(0.5, info.weather.precip) * 10 : 0),
  // (his own side starting a backup quarterback, by how much worse he is: a receiver's and a back's numbers)
  backupQb: (info, home) => info?.starters?.backup?.[home ? 0 : 1] ?? 0,
  // (his teammates' production missing, per 10: an NBA player's usage)
  usage: (info, home) => (info?.starters?.missing?.[home ? 0 : 1] ?? 0) / 10,
  // (his side on the second night of a back-to-back)
  b2b: (info, home) => info?.b2b?.[home ? 0 : 1] ?? 0,
  // (the blowout the game model expects, either way: its margin, per 10 points; a starter sits the end of it)
  // (the shots on goal the other side is expected to take over the league's, as a log: a goalie's saves, its
  // size the power of the ratio; hockey.mjs's from the games before)
  oppShots: (info, home) => {
    const v = info?.more?.shots?.[home ? 1 : 0];
    const avg = info?.more?.shotsAvg;
    return Number.isFinite(v) && v > 0 && avg > 0 ? Math.log(v / avg) : 0;
  },
  blowout: (info, home, pts) => (pts && Number.isFinite(pts[0]) && Number.isFinite(pts[1]) ? Math.abs(pts[0] - pts[1]) / 10 : 0),
  // (an NHL skater's power play: his power-play minutes a game (recent games counting most) by the power plays
  // his team can expect over the league's per team (the other side's penalties, and half the referees' lean:
  // officials.mjs, power plays a game both sides), as a share of the league's)
  pp: (info, home, pts, row) => {
    const t = row?.ppTime;
    if (!Number.isFinite(t) || t <= 0 || !(row.ppAvg > 0)) return 0;
    const refs = Number.isFinite(info?.officials?.whistle) ? info.officials.whistle / 2 : 0;
    return (t * ((row.ppOpp ?? 0) + refs)) / row.ppAvg;
  },
  // (the other side's starting goalie (NHL) or pitcher (MLB): goals or runs a game he saves over average,
  // context.mjs's starters, from before the game)
  oppGoalie: (info, home) => (Number.isFinite(info?.starters?.saved?.[home ? 1 : 0]) ? info.starters.saved[home ? 1 : 0] : 0),
  oppSp: (info, home) => (Number.isFinite(info?.starters?.saved?.[home ? 1 : 0]) ? info.starters.saved[home ? 1 : 0] : 0),
  // (an MLB batter's place in the order against his usual, as the log of their plate appearances; his platoon
  // edge on the other side's starter against how often he's had it: matchups.mjs mlbMatchups)
  slot: (info, home, pts, row) => (Number.isFinite(row?.slotShift) ? row.slotShift : 0),
  platoon: (info, home, pts, row) => (Number.isFinite(row?.platoonShift) ? row.platoonShift : 0),
  // (an MLB starter's leash (his last two starts' pitches over his usual, a log), his rest ((days - 5) / 5), and
  // the plate umpire's zone (strikeouts a 9 innings his zone has given starters over their rates: officials.mjs;
  // 0 with no umpire posted))
  leash: (info, home, pts, row) => (Number.isFinite(row?.leash) ? row.leash : 0),
  restSp: (info, home, pts, row) => (Number.isFinite(row?.rest) ? row.rest : 0),
  ump: (info) => (Number.isFinite(info?.officials?.whistle) ? info.officials.whistle : 0),
};
export function ctxValues(keys, info, home, pts, row = null) {
  return keys.map((k) => CTX[k]?.(info, home, pts, row) ?? 0);
}
// (the terms that read the weather: a coming game whose forecast failed has them unseen)
const WEATHER_CTX = new Set(['wind', 'cold', 'precip']);

// Which of a game's players a book would have posted this prop for (eligible), from what was known before the
// game: each team's top few among the players who took the field, ranked by their usage in their games before
// it (each one's, recent games counting most: USE_RATE a game; carried across seasons and teams), never by the
// game's own box score (a receiver picked for his targets in the game itself is picked for his good games: the
// fit leaned over). NFL: its passer (most attempts); rushing, its top two backs by carries (and its passer);
// receiving, its top four by targets. NBA: its top eight by minutes. NHL: its top six forwards and top two
// defensemen by time on ice; the goalie who started (named before the game). MLB: every starting pitcher (the
// probable's); the batters who've been starting (USE_RATE's plate appearances a game 3 or more). A player
// with no games before it isn't one (the book's line on him would be a guess the history can't check)
export const USE_RATE = 0.35;
export function markEligible(sport, st, rows) {
  const use = (r) =>
    sport === 'nfl' ? { pass: r.s.passAtt ?? 0, rush: r.s.rushAtt ?? 0, tgt: r.s.targets ?? 0 }
    : sport === 'nba' ? { min: r.s.min ?? 0 }
    : sport === 'nhl' ? { toi: r.s.toi ?? 0 }
    : { pa: r.s.pa ?? 0 };
  const usage = new Map();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const top = (list, by, n, filter = () => true) => new Set(list.filter((r) => filter(r) && by(r) > 0).sort((a, b) => by(b) - by(a)).slice(0, n));
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i].date.slice(0, 10);
    let j = i;
    while (j < sorted.length && sorted[j].date.slice(0, 10) === day) j++;
    const batch = sorted.slice(i, j);
    // (the day's games, each side's eligible from the usage before the day)
    const games = new Map();
    for (const r of batch) {
      const key = `${r.game}|${r.team}`;
      games.set(key, [...(games.get(key) ?? []), r]);
    }
    for (const list of games.values()) {
      const u = (k) => (r) => usage.get(r.pid)?.[k] ?? 0;
      let ok;
      if (sport === 'nfl') {
        const passer = top(list, u('pass'), 1, (r) => r.pos === 'QB');
        const runners = top(list, u('rush'), 2, (r) => r.pos === 'RB' || r.pos === 'FB');
        const catchers = top(list, u('tgt'), 4, (r) => r.pos !== 'QB');
        ok = /^pass/.test(st.key) ? passer : /^rush(Yds|Att)$/.test(st.key) ? new Set([...runners, ...passer]) : st.key === 'rushRecYds' ? new Set([...runners, ...catchers]) : catchers;
      } else if (sport === 'nba') ok = top(list, u('min'), 8);
      else if (sport === 'nhl') ok = st.goalie ? new Set(list.filter((r) => r.started)) : new Set([...top(list, u('toi'), 6, (r) => r.pos === 'F'), ...top(list, u('toi'), 2, (r) => r.pos === 'D')]);
      else ok = new Set(list.filter((r) => r.pos === 'SP' || (usage.get(r.pid)?.pa ?? 0) >= 3));
      for (const r of list) r.eligible = ok.has(r);
    }
    // (then the day learned: each one's usage, recent games counting most)
    for (const r of batch) {
      const now = use(r);
      const was = usage.get(r.pid);
      usage.set(r.pid, was ? Object.fromEntries(Object.entries(now).map(([k, v]) => [k, (was[k] ?? v) + (v - (was[k] ?? v)) * USE_RATE])) : now);
    }
    i = j;
  }
  return rows;
}

// (an NHL goalie's row: whether he started (row.started), DraftKings' rule for a saves prop (a starter pulled
// has action, a reliever none): the context's goalies in the order they went in (context.mjs, gs: the starter
// first), else, a side with one goalie in its box score, him; a side with two and no order, neither)
export function markStarters(rows, facts) {
  const goalies = new Map();
  for (const r of rows) if (r.pos === 'G') goalies.set(`${r.game}|${r.team}`, [...(goalies.get(`${r.game}|${r.team}`) ?? []), r]);
  for (const list of goalies.values()) {
    for (const r of list) {
      const f = facts?.games?.[r.game];
      const order = f?.gs ? f[r.home ? 'h' : 'a'] : null;
      r.started = Array.isArray(order) && order.length ? String(order[0]?.[0]) === String(r.pid) : list.length === 1;
    }
  }
  return rows;
}

// Every prop type's projection model fit and checked on the history (the check on the eligible players);
// the state shows them (facts: the context's, whose play-by-play (facts.plays) gives the NFL's funnel)
export function fitProps(sport, rows, expPts, info, facts = null) {
  const out = {};
  // (each row's role and its defense's funnel, pace and target split, from the games before it: matchups.mjs)
  // (MLB's: each batter's start, slot and platoon edge, each starter's leash and rest, the batters' history's
  // start (STATS played) among them, so they're marked before the rows are picked)
  const matchups = sport === 'nfl' ? nflMatchups(rows, facts?.plays) : sport === 'nba' ? nbaMatchups(rows) : sport === 'nhl' ? nhlMatchups(rows, facts) : sport === 'mlb' ? mlbMatchups(rows, facts) : null;
  if (sport === 'nhl') markStarters(rows, facts);
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
    out[st.key] = { stat: st, env, model, values, matchups, params: fitted.params, gains: fitted.gains, base: fitted.base, check: fitted.check, checkAll: fitted.checkAll, snapGap: rows.snapGap ?? null, rows: mine.length, eligible: mine.filter((r) => r.eligible).length, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const athletesFile = path.join(CACHE, 'athletes.json');
let athletes = null;
// (a player cached: read again when his team is neither of the game's (traded, signed elsewhere: otherwise he'd
// be skipped, or priced on the wrong side's work, script and opponent), at most once a day; at: when read)
const athlete = async (ref, teams = null) => {
  athletes ??= existsSync(athletesFile) ? JSON.parse(readFileSync(athletesFile, 'utf8')) : {};
  const id = ref.match(/athletes\/(\d+)/)?.[1];
  if (!id) return null;
  const key = `${ref.match(/sports\/(\w+)\/leagues\/(\w+)/)?.slice(1).join('/')}:${id}`;
  const was = athletes[key];
  const moved = was && teams && !teams.includes(String(was.team)) && !(Date.now() - Date.parse(was.at ?? 0) < 864e5);
  if (!was || moved) {
    const body = await get(ref.replace('http://', 'https://'));
    if (!body) return was ?? null;
    athletes[key] = { id, name: body.displayName, pos: body.position?.abbreviation ?? '', team: body.team?.$ref?.match(/teams\/(\d+)/)?.[1] ?? null, at: new Date().toISOString() };
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
    const who = await athlete(key.split('|')[0], [String(game.home), String(game.away)]);
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
  // (MLB by name key and team, then the name key alone where it's one player's: an accent or a suffix ESPN
  // writes and StatsAPI doesn't, or the other way, doesn't lose him)
  const byName = new Map();
  const one = (k, pid) => byName.set(k, byName.get(k) === undefined || byName.get(k) === pid ? pid : null);
  if (sport === 'mlb') for (const r of rows) byName.set(`${nameKey(r.name)}|${r.team}`, r.pid), one(nameKey(r.name), r.pid);
  const pos = new Map(rows.map((r) => [r.pid, r.pos]));
  return {
    pid: (a) => (sport === 'mlb' ? (byName.get(`${nameKey(a.name)}|${a.team}`) ?? byName.get(nameKey(a.name)) ?? null) : a.id),
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
    // (MLB: his position by the prop, a two-way player's rows being both a batter's and a starter's)
    const pos = sport === 'mlb' ? (prop.stat.pitcher ? 'SP' : 'B') : (idx.pos(pid) ?? a.pos);
    const row = { pid, name: a.name, pos, date: game.date, season: game.season, team: home ? game.home : game.away, opp: home ? game.away : game.home, game: game.id, home, s: {} };
    // (his role and the defense's funnel, pace and target split, as of now; and the work his position group's
    // regulars missing this game leave: out, doubtful or on IR on the injury report, or no longer on the team's
    // roster (traded, released: the history counts them missing from its games, so the price does too), a
    // questionable one at half; MLB's, his place in the posted lineup and the probable starters (extra))
    const out = outOf(sport, live, row.team, row.pos);
    const roster = live?.rosters?.get?.(String(row.team)) ?? null;
    const missOf = (q) => (id) => (out.ids.has(String(id)) || (roster && !roster.has(String(id))) ? 1 : out.questionable.has(String(id)) ? q : 0);
    const extra = { live, game, home, pitcher: !!prop.stat.pitcher };
    if (f.matchups) Object.assign(row, f.matchups.live(pid, row.team, row.opp, row.pos, game.season, missOf(0.5), extra));
    const p = f.model.project(row);
    if (!p) continue;
    // (the game script and the context: this game's, from the game model's expectation and its terms)
    // (the same functions the history was fit with: envFor's)
    const pts = [exp.homePts, exp.awayPts];
    const scriptV = scriptValue(f.stat, f.env, info, pts, home);
    const ctxKeysOf = ctxKeys(f.stat);
    const ctxV = ctxValues(ctxKeysOf, info, home, pts, row);
    const ctxF = ctxFactor(f.stat, f.params, ctxV);
    const mu = Math.max(0.05, (f.params.scale ?? 1) * p.base * Math.pow(p.opp, f.params.a) * Math.pow(scriptV, f.params.b) * ctxF * p.funnelF * p.paceF * p.tgtF * (p.vacF ?? 1));
    // (a weather term the fit kept, at an outdoor game whose forecast failed: the projection can't see it)
    const weatherBlind = !!info?.weather?.missing && ctxKeysOf.some((k) => WEATHER_CTX.has(k) && f.params[`c_${k}`]);
    // (the weather moving his projection 10% or more either way: a forecast's error grows with it, rain's
    // most of all, and the fit's sizes are from what fell, not what was forecast)
    const weatherF = ctxFactor(f.stat, f.params, ctxV.map((v, i) => (WEATHER_CTX.has(ctxKeysOf[i]) ? v : 0)));
    const weatherBig = Math.abs(Math.log(weatherF)) >= 0.1;
    // (the defense against his role this season, whether or not the projection weighs it: its allowed over
    // those players' usual, and its rank in the league, 1 the stingiest)
    let roleRank = null;
    let roleFactor = null;
    if (p.role) {
      const table = f.model.roleTable(p.role, game.season);
      const at = table.findIndex((x) => String(x.opp) === String(row.opp));
      if (at >= 0) (roleRank = { rank: at + 1, of: table.length }), (roleFactor = table[at].factor);
    }
    // (the model's chances: over and under with a whole-number line's push out of both, and the push's own)
    const chances = lineChances(prop.line, mu, f.params);
    const pOver = chances.over;
    // (the fair chance: his own record at this line, this season and half of last; a game on the line, a push,
    // neither side's)
    let overs = 0;
    let n = 0;
    for (const [season, v] of f.values.get(pid) ?? []) {
      const w = season === game.season ? 1 : season === game.season - 1 ? 0.5 : 0;
      if (v === prop.line) continue;
      n += w;
      if (v > prop.line) overs += w;
    }
    const fairOver = (overs + 1) / (n + 2);
    const t = trust[`prop:${prop.stat.key}`]?.trust ?? 0.5;
    // (the book's prices where it gave them, its fair chance their vig taken out; else -110 a side, even)
    const book = prop.prices ? { over: prop.prices.over, under: prop.prices.under, fairOver: fairPair(prop.prices.over, prop.prices.under) } : { over: PROP_ODDS, under: PROP_ODDS, fairOver: 0.5 };
    // (each side at the trusted chance, the lean tapered past half of the prop's GAP as a game market's is
    // (desk.mjs chanceAt): the further the model is from the book, the less of it counts, so the stake shrinks
    // as the gap grows; its return with a push's stake back)
    const sides = [
      { side: 'over', model: pOver, fair: book.fairOver, odds: book.over },
      { side: 'under', model: 1 - pOver, fair: 1 - book.fairOver, odds: book.under },
    ].map((x) => {
      const p = chanceAt('prop', x.fair, x.model, t);
      return { ...x, p, ev: (1 - chances.push) * (p * decimal(x.odds) - 1) };
    });
    const pick = sides[0].ev >= sides[1].ev ? sides[0] : sides[1];
    const { side, model, ev, odds, fair } = pick;
    const pTrusted = pick.p;
    // (the guard: his status, his line's move)
    const status = statusOf(sport, prop, live, home, game);
    const moved = prop.open !== null ? prop.line - prop.open : 0;
    const limit = Math.max(1, 0.12 * prop.line);
    let guard = null;
    // (his group's missing work now against what it was in the games his numbers come from, where the
    // projection can't size it (the stat's fit left the term out, or has none): teammates out shift his role
    // up, and teammates back from an absence that fed his recent numbers shift it down)
    const vacNow = p.vac ?? 0;
    const vacThen = p.vacHist ?? 0;
    const sized = !!(prop.stat.vacated && f.params.vc);
    const vacUnsized = !sized && Math.abs(vacNow - vacThen) >= 0.25;
    // (a questionable teammate whose being in or out moves his share: the price takes him at half, flagged)
    const vs = f.params.vs ?? 0;
    const shareAt = (q) => f.matchups.live(pid, row.team, row.opp, row.pos, game.season, missOf(q), extra).vacs?.[vs] ?? 0;
    const qShift = f.matchups && prop.stat.vacated && out.questionable.size ? Math.abs(shareAt(1) - shareAt(0)) : 0;
    // (his team's roster (the NFL's, the NBA's, the NHL's: espn.mjs ROSTER_MIN): without it a teammate who's
    // left counts as here, the work he leaves unseen)
    // A roster unread can only hide a teammate who's gone, so the work missing now reads low: where his
    // numbers were made with work missing (the cut then over the cut now by 0.1 or more), the term (or the
    // guard below) would take him down for a teammate who may never be back; skipped, flagged where it can't
    // move him
    const noRoster = !!ROSTER_MIN[sport] && !!prop.stat.vacated && !roster;
    const rosterBlind = noRoster && vacThen - vacNow >= 0.1;
    // (the NFL's snap counts missing for games of the history (playerlogs.mjs snapGap): those games hold only
    // the players who got the ball, the fit leaning over; a season's quarter or more of them, skipped)
    const snapGap = sport === 'nfl' ? f.snapGap : null;
    const gapped = gapGuard('prop', model, fair);
    // (an MLB starter back from a layoff (his first start in LAYOFF days or more this season, or his first of
    // the season from May on): off the injured list most likely, his pitch count held down in a way his
    // numbers can't show; skipped. A long rest (LONG_REST days) or a first start of the season from LATE_DEBUT,
    // flagged)
    const rest = sport === 'mlb' && prop.stat.pitcher ? restGuard(row.restDays, row.debut, game.date) : null;
    const layoff = rest === 'layoff' || rest === 'debut';
    // (the other side's starter the projection weighs (the fit kept the term), not named yet: the NHL's goalie
    // (one expected counts: ESPN's usual word till the morning skate), MLB's pitcher; the context assumes one)
    const oppUnknown =
      (sport === 'nhl' && !!f.params.c_oppGoalie && !live?.[home ? 'away' : 'home']?.id) ||
      (sport === 'mlb' && !!f.params.c_oppSp && !live?.[home ? 'ap' : 'hp']);
    if (status.skip) guard = { skip: true, why: status.why };
    else if (layoff) guard = { skip: true, why: row.restDays >= LAYOFF ? `${a.name}'s first start in ${row.restDays} days: back from a layoff, his pitch count likely held down` : `${a.name}'s first start of the season: back from injury most likely, his pitch count likely held down` };
    else if (snapGap?.share >= 0.25) guard = { skip: true, why: `the snap counts missing for ${snapGap.games} games: the history holds only the players who got the ball` };
    else if (rosterBlind) guard = { skip: true, why: "his team's roster not read, and his numbers were made with teammates missing: whether they're back or gone can't be told" };
    else if (vacUnsized && vacNow > vacThen) guard = { skip: true, why: `teammates out (${out.names.join(', ') || 'off the roster'}): a role change the model can't size` };
    else if (vacUnsized) guard = { skip: true, why: "teammates back from an absence that fed his recent numbers: a smaller role the model can't size" };
    // (the model's chance far from the book's (desk.mjs GAP.prop): a gap that size is the market knowing
    // something the model doesn't, an injury, a role, a lineup, far more often than an edge)
    else if (gapped) guard = { ...gapped, kind: 'gap' };
    // (a long shot at the book's own price: where a projection's errors are biggest and the book is most
    // likely right)
    else if (prop.prices && fair < 0.25) guard = { skip: true, why: `a long shot (the book's fair chance ${Math.round(fair * 100)}%)` };
    else if (!prop.prices && (fairOver < 0.4 || fairOver > 0.6)) guard = { skip: true, why: `line far from his usual (over it in ${Math.round(fairOver * 100)}% of his games): a juiced price the desk can't know` };
    else if (Math.abs(moved) >= 2 * limit) guard = { skip: true, why: `line moved ${moved > 0 ? '+' : ''}${round(moved, 1)} since it opened` };
    else if (Math.abs(moved) >= limit) guard = { why: `line moved ${moved > 0 ? '+' : ''}${round(moved, 1)} since it opened` };
    else if (status.why) guard = { why: status.why };
    else if (weatherBlind) guard = { why: 'no forecast for an outdoor game: the weather its projection weighs unseen' };
    else if (weatherBig) guard = { why: `the forecast moves his projection ${weatherF > 1 ? '+' : ''}${Math.round((weatherF - 1) * 100)}%: priced off a forecast` };
    else if (qShift >= 0.15) guard = { why: `teammate questionable (${out.qNames.join(', ') || 'at his position'}): his share depends on it` };
    else if (oppUnknown) guard = { why: sport === 'nhl' ? "no probable goalie listed for the other side: his projection weighs one assumed" : "the other side's starting pitcher not named: his projection weighs him" };
    else if (snapGap?.games) guard = { why: `the snap counts missing for ${snapGap.games} games: the history holds only the players who got the ball there` };
    else if (rest === 'long') guard = { why: `${a.name}'s first start in ${row.restDays} days: his pitch count may be held down` };
    else if (rest === 'late') guard = { why: `${a.name}'s first start of the season, late: back from injury maybe, his pitch count may be held down` };
    else if (noRoster) guard = { why: "his team's roster not read: a teammate who's left can't be told from one who's here" };
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
      units: guard ? 0.5 : stakeFor(ev, evScale, odds),
      guard,
      projection: { mean: round(mu, 2), r: round(rAt(f.params, mu), 3), rate: round(p.rate, 2), recent: round(p.recent, 2), opp: round(p.opp, 3), posOpp: round(p.posOpp, 3), role: p.role, roleOpp: p.roleOpp === null ? null : round(p.roleOpp, 3), roleFactor: roleFactor === null ? null : round(roleFactor, 3), roleRank, roleUsed: Number.isFinite(f.params.roleK), funnel: p.funnel === null ? null : round(p.funnel, 3), funnelUsed: !!f.params.fun, funnelF: round(p.funnelF, 3), paceF: round(p.paceF, 3), tgtF: round(p.tgtF, 3), vac: round(vacNow, 3), vacHist: round(vacThen, 3), vacF: round(p.vacF ?? 1, 3), out: out.names.length ? out.names : undefined, questionable: out.qNames.length ? out.qNames : undefined, script: round(scriptV, 3), ctx: Object.fromEntries(ctxKeysOf.map((k, i) => [k, round(ctxV[i], 2)])), ctxF: round(ctxF, 3), games: p.games, lastSeason: p.prevGames, ...(sport === 'mlb' ? (prop.stat.pitcher ? { restDays: row.restDays ?? null, pitches: row.pitches?.length ? row.pitches : undefined } : { slot: row.slot ?? null }) : {}), ...(sport === 'nhl' && Number.isFinite(row.ppTime) ? { ppTime: round(row.ppTime, 2) } : {}), pOver: round(pOver, 4), push: chances.push ? round(chances.push, 4) : undefined, fairOver: round(fairOver, 4), record: round(n, 1) },
      move: prop.open !== null ? { open: prop.open, now: prop.line } : null,
    });
  }
  const bets = priced.filter((x) => !x.guard?.skip).sort((a, b) => b.ev - a.ev);
  return { priced, bets };
}

// (a team's players out for a coming game, by the injury report: out, doubtful, on IR or suspended; and the
// questionable ones, counted at half in the work his group is missing)
// (timing.mjs's patterns, the context's too: ESPN's NBA and NHL reports say Day-To-Day for questionable)
// (names: the ones in his group: the NFL's his position, the NHL's forwards or defensemen, the NBA's anyone)
const groupOf = (sport, pos) => (sport === 'nba' ? 'all' : sport === 'nhl' ? (/^(C|LW|RW|F|W)$/.test(pos) ? 'F' : pos) : pos);
export function outOf(sport, live, team, pos) {
  const report = (live?.injuries?.get(String(team)) ?? []).filter((p) => p.id);
  const list = report.filter((p) => OUT_STATUS.test(p.status));
  const q = report.filter((p) => !OUT_STATUS.test(p.status) && Q_STATUS.test(p.status));
  const at = (p) => !pos || !p.pos || groupOf(sport, p.pos) === groupOf(sport, pos);
  return { ids: new Set(list.map((p) => String(p.id))), names: list.filter(at).map((p) => p.name), questionable: new Set(q.map((p) => String(p.id))), qNames: q.filter(at).map((p) => p.name) };
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
    // (by name keys, ESPN's against StatsAPI's: an accent or a suffix doesn't make him someone else)
    if (prop.stat.pitcher && names[home ? 0 : 1] && nameKey(names[home ? 0 : 1]) !== nameKey(a.name)) return { skip: true, why: `${a.name} not the probable starter` };
    const lineup = live?.lineupNames?.[home ? 0 : 1];
    if (!prop.stat.pitcher && lineup?.length && !lineup.some((n) => nameKey(n) === nameKey(a.name))) return { skip: true, why: `${a.name} not in the posted lineup` };
    if (!prop.stat.pitcher && !lineup?.length) return { why: `lineup not posted (${home ? game.homeAbbr : game.awayAbbr})` };
  }
  if (hurt && Q_STATUS.test(hurt.status)) return { why: `${a.name} ${hurt.status.toLowerCase()}` };
  return {};
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

// A player's stat in a final, from its summary (and for MLB total bases, StatsAPI's box score): the number;
// null when he didn't play (no action); undefined when it can't be told yet (StatsAPI down, the NFL's snap
// counts not posted): the bet waits rather than being voided or graded on a guess. One who played but isn't in
// the stat's own table counts 0, not void (an NFL receiver with no targets, a back with no carries: listed in
// the box score's other tables, or on the field by nflverse's snap counts; only one who never took the field
// is no action, DraftKings' rule). opts.played(bet): for an NFL player in none of the box score's tables,
// whether he took a snap (true, false, or null: not known yet)
export async function statInFinal(sport, bet, body, pk, opts = {}) {
  const id = String(bet.athlete);
  // (whether the box score lists him anywhere as having played; and in a batting table, for MLB)
  let listed = false;
  let batted = false;
  for (const p of body?.boxscore?.players ?? []) {
    for (const s of p.statistics ?? []) {
      const a = (s.athletes ?? []).find((x) => String(x.athlete?.id) === id);
      if (!a || !a.stats?.length || a.didNotPlay) continue;
      listed = true;
      if (s.type === 'batting' || s.name === 'batting') batted = true;
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
      if (sport === 'nhl') {
        // (a saves prop has action only for the goalie who started, pulled or not: a reliever's is no action,
        // DraftKings' rule; the starter by the order they went in, espn.mjs goaliesInOrder)
        if (k === 'saves') return String(goaliesInOrder(s.athletes, body?.article?.story)[0]?.athlete?.id) === id ? num('SV') : null;
        return k === 'sog' ? num('S') : num('G') + num('A');
      }
      if (sport === 'mlb') {
        if ((k === 'k' || k === 'outs') && (s.type === 'pitching' || s.name === 'pitching')) {
          const [w, part] = String(a.stats[at('IP')] ?? '0').split('.').map(Number);
          return k === 'k' ? num('K') : w * 3 + (part || 0);
        }
        if (k === 'hits' && (s.type === 'batting' || s.name === 'batting')) return num('H');
      }
    }
  }
  // (NFL rushing plus receiving: both tables, either one waiting holding the bet)
  if (sport === 'nfl' && bet.propType === 'rushRecYds') {
    const one = (k) => statInFinal(sport, { ...bet, propType: k }, body, pk, opts);
    const [r, c] = [await one('rushYds'), await one('recYds')];
    if (r === undefined || c === undefined) return undefined;
    return r === null && c === null ? null : (r ?? 0) + (c ?? 0);
  }
  // (MLB total bases: StatsAPI's box score; one ESPN shows batting whom StatsAPI's can't be matched to waits)
  if (sport === 'mlb' && bet.propType === 'tb') {
    const tb = await mlbTotalBases(bet, pk);
    return tb === null && batted ? undefined : tb;
  }
  // (an NFL player in the box score's other tables played: 0 of this stat; in none, his snaps decide)
  if (sport === 'nfl') {
    if (listed) return 0;
    const played = opts.played ? await opts.played(bet) : null;
    return played === true ? 0 : played === false ? null : undefined;
  }
  return null;
}

// (a name as a key: accents, punctuation and suffixes off, "José Ramírez Jr." and "Jose Ramirez" the same)
export const nameKey = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '');

// (a batter's total bases from StatsAPI's box score: by his MLB id where the bet kept it (mlbId), else by his
// name, which must be one player's; null when he didn't bat, undefined when the box score can't be had)
async function mlbTotalBases(bet, pk) {
  if (!pk) return undefined;
  const box = await get(`https://statsapi.mlb.com/api/v1/game/${pk}/boxscore`);
  if (!box?.teams) return undefined;
  const all = ['home', 'away'].flatMap((side) => Object.values(box.teams[side]?.players ?? {}));
  let me = bet.mlbId ? all.find((pl) => String(pl.person?.id) === String(bet.mlbId)) : null;
  if (!me) {
    const named = all.filter((pl) => nameKey(pl.person?.fullName) === nameKey(bet.player));
    if (named.length > 1) return undefined;
    me = named[0] ?? null;
  }
  if (!me) return null;
  return me.stats?.batting?.plateAppearances ? (me.stats.batting.totalBases ?? 0) : null;
}

// Whether an NFL player took a snap in a game, by nflverse's snap counts (offense, defense or special teams):
// true or false once the game's counts are posted (a day or so after it), null before then or without the
// game's nflverse row (facts.nfl: ESPN game id to it). He's found by his ids (ESPN's, the bet's athlete, to
// Pro Football Reference's, the counts' own, by nflverse's player list): one the list maps and who isn't in
// the game's counts took no snap (false). One the list doesn't map is found by name, and not found that way is
// unknown (null: the bet waits, then is void), never false: a nickname (Gabe for Gabriel) isn't a player who
// sat, and a 0 he'd have been graded at only ever wins the under. Each season's counts, and the list, read once
// a run
const snapCounts = new Map();
let pfrOfEspn = null;
export async function nflTookSnap(facts, gameId, player, athleteId = null) {
  const row = facts?.nfl?.get?.(gameId);
  if (!row?.game_id || !row.season) return null;
  if (!snapCounts.has(row.season)) snapCounts.set(row.season, nflverseRows('snap_counts', `snap_counts_${row.season}.csv.gz`, ['game_id', 'player', 'pfr_player_id', 'offense_snaps', 'defense_snaps', 'st_snaps'], 6).catch(() => null));
  const rows = ((await snapCounts.get(row.season)) ?? []).filter((s) => s.game_id === row.game_id);
  if (!rows.length) return null;
  pfrOfEspn ??= nflverseRows('players', 'players.csv.gz', ['espn_id', 'pfr_id'], 24 * 7)
    .then((list) => new Map((list ?? []).filter((p) => p.espn_id && p.espn_id !== 'NA' && p.pfr_id && p.pfr_id !== 'NA').map((p) => [String(Number(p.espn_id)), p.pfr_id])))
    .catch(() => new Map());
  const pfr = athleteId === null || athleteId === undefined ? null : ((await pfrOfEspn).get(String(athleteId)) ?? null);
  const snapped = (s) => (Number(s.offense_snaps) || 0) + (Number(s.defense_snaps) || 0) + (Number(s.st_snaps) || 0) > 0;
  if (pfr) return rows.filter((s) => s.pfr_player_id === pfr).some(snapped);
  const me = rows.filter((s) => nameKey(s.player) === nameKey(player));
  return me.length ? me.some(snapped) : null;
}

// A prop bet graded: won, lost, pushed (on the line), or void (he didn't play: no action)
export function settleProp(bet, value) {
  if (value === null || value === undefined) return { status: 'push', profit: 0, void: true, actual: null, final: 'did not play' };
  const edge = (bet.side === 'over' ? 1 : -1) * (value - bet.line);
  return { ...outcomeOf(bet, edge), actual: value, final: `${bet.player} ${value} ${bet.statLabel}` };
}
