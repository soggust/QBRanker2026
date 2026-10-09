// Builds the NBA app's data: every tab's players (and head coaches) for a season, from
// Basketball-Reference (totals, advanced stats, play-by-play on/off, positions and award voting, team
// ratings, coaches, Coach of the Year, the Finals) and ESPN (player ids for headshots, and the injury
// report for this season).
//
// Usage: npm run nba:update-data                 this season, to src/StaticData/
//        SEASON=2019 npm run nba:update-data     a finished season, to src/StaticData/seasons/2019/
//        ALL=1 npm run nba:update-data           every finished season from 2001 to last year
//        PARTS=post,all ...                      only those parts' files (default: all three)
//
// A season is named for the year it ends in, like Basketball-Reference and ESPN do: 2025 is 2024-25.
//
// Each season has three parts (the app's Stats From): the regular season (skill-players.json), the
// playoffs (skill-players.post.json) and both together (skill-players.all.json). The playoffs come from
// Basketball-Reference's /playoffs/ pages, the regular season's twins; both is the two summed, its rates
// worked out again from the summed parts (below: combine). A season without playoffs yet has neither
// file (any old one is removed).
//
// Writes skill-players.json in the shape the app reads: { PG: [...], SG: [...], SF: [...], PF: [...],
// C: [...], HC: [...] }, each player { id, gsisId, name, teamLogo, teamName, games, stats, awards,
// injured?, injuryStatus? }. gsisId is the Basketball-Reference id ("jamesle01", a coach's
// "kerrst01c"); id is ESPN's (headshots; none for coaches).
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { curve } from '../../../libs/ranker/scripts/grades.mjs';
import { blendWithLastSeason } from '../../../libs/ranker/scripts/early-season.mjs';
import { carryForward, previousRows, sameSeason } from '../../../libs/ranker/scripts/carry-forward.mjs';
import { fetchRetry } from '../../../libs/ranker/scripts/fetch.mjs';

const CURRENT_SEASON = 2026;
const FIRST_SEASON = 2001;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
// A finished season's pages never change: kept here between runs (gitignored: .cache/)
const CACHE = path.join(ROOT, 'scripts/.cache/bbref');
const BBREF = 'https://www.basketball-reference.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const TABS = ['PG', 'SG', 'SF', 'PF', 'C'];
const PARTS = ['regular', 'post', 'all'];
const FILE = { regular: 'skill-players.json', post: 'skill-players.post.json', all: 'skill-players.all.json' };
// Head coaches: every coach with at least this many games that season (interim coaches included)
const MIN_COACH_GAMES = 1;
// Everyone who got into a game (a minute or more); the app's Min Games setting narrows it from there
const MIN_MINUTES = 1;
// 3P % and FT % need this many attempts (fewer: no percentage, the app counts him average). The
// playoffs are a quarter of a season at most, so their bar is lower.
const MIN_ATTEMPTS = { regular: { fg3a: 25, fta: 20 }, post: { fg3a: 10, fta: 8 }, all: { fg3a: 25, fta: 20 } };

// Basketball-Reference's team codes -> the franchise's code today (its icon: assets/NBA_Icons/<code>.svg)
const FRANCHISE = { NJN: 'BRK', SEA: 'OKC', VAN: 'MEM', CHH: 'CHO', CHA: 'CHO', NOH: 'NOP', NOK: 'NOP' };
const franchise = (code) => FRANCHISE[code] ?? code;

// Awards that show as badges: Basketball-Reference's award codes (a winner's voting finish is "-1")
const WINNER_AWARDS = { 'MVP-1': 'mvp', 'DPOY-1': 'dpoy', 'ROY-1': 'roy', '6MOY-1': 'smoy', 'MIP-1': 'mip', 'CPOY-1': 'cpoy' };
const TEAM_AWARDS = { NBA1: 'nba1', NBA2: 'nba2', NBA3: 'nba3', DEF1: 'def1', DEF2: 'def2', AS: 'as' };

// Every game of the season Basketball-Reference's monthly schedule pages list, the latest months first,
// until enough(games) says there are enough: team -> [[date key, 1 a win or 0 a loss, opponent,
// a play-in game], ...]
const MONTHS = ['october', 'november', 'december', 'january', 'february', 'march', 'april', 'may', 'june'];
async function schedule(season, keep, enough) {
  // (the season's months, from its schedule page's links: the 2020 bubble ran to October, 2021 to July)
  const index = await page(`${BBREF}/leagues/NBA_${season}_games.html`, keep);
  const links = [...new Set([...index.matchAll(new RegExp(`/leagues/NBA_${season}_games-([a-z0-9-]+)\\.html`, 'g'))].map((m) => m[1]))];
  const months = links.length ? links : MONTHS;
  const games = new Map();
  for (const month of [...months].reverse()) {
    const html = await page(`${BBREF}/leagues/NBA_${season}_games-${month}.html`, keep);
    for (const [, cells] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const key = cells.match(/data-stat="date_game" csk="(\d+)/)?.[1];
      const away = cells.match(/data-stat="visitor_team_name" csk="([A-Z]{3})/)?.[1];
      const home = cells.match(/data-stat="home_team_name" csk="([A-Z]{3})/)?.[1];
      const awayPts = num(cells.match(/data-stat="visitor_pts"[^>]*>(\d*)</)?.[1]);
      const homePts = num(cells.match(/data-stat="home_pts"[^>]*>(\d*)</)?.[1]);
      if (!key || !away || !home || awayPts === null || homePts === null) continue;
      const awayName = decode(cells.match(/data-stat="visitor_team_name"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '') || away;
      const homeName = decode(cells.match(/data-stat="home_team_name"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '') || home;
      const playIn = /Play-In/i.test(cells.match(/data-stat="game_remarks"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
      // (whom it came against, "@ Boston Celtics" away or "vs Miami Heat" at home: the Recent dot's hover)
      for (const [team, mine, theirs, opponent] of [[away, awayPts, homePts, `@ ${homeName}`], [home, homePts, awayPts, `vs ${awayName}`]]) {
        (games.get(team) ?? games.set(team, []).get(team)).push([key, mine > theirs ? 1 : 0, opponent, playIn]);
      }
    }
    if (enough(games)) break;
  }
  for (const list of games.values()) list.sort((a, b) => b[0].localeCompare(a[0]));
  return games;
}

// Each team's last seven games, newest first (the Teams tab's Recent): the regular season's and the
// playoffs' (regular, all), or the playoffs' alone (post: a team's last games as many as it played
// in the playoffs, play-in games left out). team -> { results, vs: whom each came against }
async function teamRecent(season, keep, teams, postTeams) {
  const playoffGames = (code) => postTeams.get(code).wins + postTeams.get(code).losses;
  const games = await schedule(
    season,
    keep,
    (games) =>
      games.size >= teams.size &&
      [...games.values()].every((list) => list.length >= 7) &&
      // (back past the playoffs' first game: more games than its playoffs)
      [...(postTeams?.keys() ?? [])].every((code) => (games.get(code) ?? []).filter((g) => !g[3]).length > playoffGames(code)),
  );
  const recent = (list) => {
    const last = list.slice(0, 7);
    return { results: last.map(([, r]) => r), vs: last.map(([, , o]) => o) };
  };
  const regular = new Map([...games].map(([team, list]) => [team, recent(list)]));
  const post = new Map([...(postTeams?.keys() ?? [])].map((code) => [code, recent((games.get(code) ?? []).filter((g) => !g[3]).slice(0, playoffGames(code)))]));
  return { regular, post, all: regular };
}

// Basketball-Reference asks for no more than 20 requests a minute. A finished season's page (keep) is
// read from the cache when it's there, a whole page only (one cut off or empty is asked again, not kept
// for good); every page is fetched once a run. A page it hasn't (a 404) is '' and noted in missing: its
// own answer, unlike a failure (which throws)
let lastRequest = 0;
const fetched = new Map();
const missing = new Set();
const whole = (html) => html.includes('</html>');
async function page(url, keep = false) {
  if (fetched.has(url)) return fetched.get(url);
  const file = path.join(CACHE, url.replace(`${BBREF}/`, '').replace(/[^\w.-]+/g, '_'));
  if (keep) {
    const html = await readFile(file, 'utf8').catch(() => null);
    if (html && whole(html)) return fetched.set(url, html).get(url);
  }
  const pace = async () => {
    const wait = lastRequest + 3200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
  };
  const html = await fetchRetry(url, { headers: { 'User-Agent': UA }, backoff: 20000, notFound: null, before: pace });
  if (html === null) {
    missing.add(url);
    return fetched.set(url, '').get(url);
  }
  if (keep && whole(html)) await mkdir(CACHE, { recursive: true }).then(() => writeFile(file, html));
  return fetched.set(url, html).get(url);
}

const json = (url) => fetchRetry(url, { as: 'json', backoff: 1500 });

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

// A Basketball-Reference table's rows (some tables sit inside HTML comments; the text is the same),
// each { stat: text, ..., _id: the player's or team's code, _partial: a traded player's one-team row }
function table(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const body = html.slice(start, end);
  const rows = [];
  for (const [, attrs, cells] of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    if (!/data-stat=/.test(cells) || /class="[^"]*\bthead\b/.test(attrs)) continue;
    const row = { _partial: /partial_table/.test(attrs) };
    for (const [, stat, inner] of cells.matchAll(/<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)) row[stat] = decode(inner);
    // (team links are single-quoted on some pages)
    row._id = cells.match(/data-append-csv="([^"]+)"/)?.[1] ?? cells.match(/href=['"]\/teams\/([A-Z]{3})\//)?.[1] ?? null;
    // (a coach's row: his id, from the link to his page)
    row._coach = cells.match(/\/coaches\/([a-z0-9]+)\.html/)?.[1] ?? null;
    if (row.name_display === 'League Average') continue;
    rows.push(row);
  }
  return rows;
}

// A player table's rows under the regular season pages' names (the playoff pages still use the older
// ones: player, team_id, g, gs; their advanced table is "advanced_stats")
const OLD_NAMES = { player: 'name_display', team_id: 'team_name_abbr', g: 'games', gs: 'games_started' };
function playerTable(html, ...ids) {
  const rows = ids.map((id) => table(html, id)).find((r) => r.length) ?? [];
  for (const row of rows) {
    for (const [old, name] of Object.entries(OLD_NAMES)) if (old in row && !(name in row)) row[name] = row[old];
    if (row.name_display === 'League Average') row._id = null;
  }
  return rows.filter((row) => row._id);
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
// ".473" -> 47.3 (percentage points)
const pct = (v) => (num(v) === null ? null : round(num(v) * 100, 1));
const sum = (rows, f) => rows.reduce((total, row) => total + (f(row) ?? 0), 0);

// ESPN's athletes for a season (id and name), for headshots: name -> id
const norm = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
const espnIds = new Map();
// (null when the list fails or comes back empty: players keep any id found in another season, or the
// one the last good run gave them, buildSeason)
async function espnAthletes(season) {
  const out = new Map();
  try {
    const data = await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?season=${season}&seasontype=2&limit=1000`);
    for (const a of data.athletes ?? []) {
      const key = norm(a.athlete.displayName);
      out.set(key, Number(a.athlete.id));
      espnIds.set(key, Number(a.athlete.id));
    }
  } catch {
    return null;
  }
  return out.size ? out : null;
}

// This season's injury report: ESPN athlete id -> status ("Out", "Day-To-Day"...); null when it fails
// (no report, or not one: the injuries are then the last good run's, buildSeason; an empty report is
// ESPN's word that nobody is hurt)
async function injuries() {
  const out = new Map();
  try {
    const data = await json('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries');
    if (!Array.isArray(data.injuries)) return null;
    for (const team of data.injuries) {
      for (const i of team.injuries ?? []) {
        const id = Number(i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ?? i.athlete?.id);
        if (id) out.set(id, i.status ?? 'Injured');
      }
    }
  } catch {
    return null;
  }
  return out;
}

// Teams: name, record, pace (possessions per 48 minutes), ratings (points per 100 possessions), the
// wins their point differential implies, and the totals both are worked out from (points scored and
// allowed, minutes on the floor / 5)
function teamTable(html) {
  const totals = new Map(table(html, 'totals-team').map((row) => [row._id, row]));
  const opponents = new Map(table(html, 'totals-opponent').map((row) => [row._id, row]));
  const teams = new Map();
  for (const row of table(html, 'advanced-team')) {
    if (!row._id) continue;
    teams.set(row._id, {
      name: row.team?.replace(/\*$/, '').trim(),
      wins: num(row.wins),
      losses: num(row.losses),
      pace: num(row.pace),
      ortg: num(row.off_rtg),
      drtg: num(row.def_rtg),
      net: num(String(row.net_rtg ?? '').replace('+', '')),
      pythWins: num(row.wins_pyth),
      pts: num(totals.get(row._id)?.pts),
      oppPts: num(opponents.get(row._id)?.opp_pts),
      minutes: num(totals.get(row._id)?.mp) === null ? null : num(totals.get(row._id).mp) / 5,
    });
  }
  return teams;
}

// A season part's tables: the players' totals, advanced stats and on/off, and the teams. Null when the
// part has none (the playoffs before they start: Basketball-Reference has no page for them, a 404, noted
// in missing) or its page has no totals table (turned away or changed: unknown, buildSeason).
async function partTables(season, part, keep) {
  const dir = part === 'post' ? 'playoffs' : 'leagues';
  const totals = playerTable(await page(`${BBREF}/${dir}/NBA_${season}_totals.html`, keep), 'totals_stats');
  if (!totals.length) return null;
  const tag = (rows) => rows.map((row) => Object.assign(row, { _part: part }));
  return {
    totals: tag(totals),
    advanced: tag(playerTable(await page(`${BBREF}/${dir}/NBA_${season}_advanced.html`, keep), 'advanced', 'advanced_stats')),
    pbp: tag(playerTable(await page(`${BBREF}/${dir}/NBA_${season}_play-by-play.html`, keep), 'pbp_stats')),
    teams: teamTable(await page(`${BBREF}/${dir}/NBA_${season}.html`, keep)),
  };
}

// --- Both: the regular season and the playoffs as one ---------------------------------------------
// Counting stats add up; every rate is worked out again from the summed parts, never averaged:
// - shooting percentages and true shooting from the made and attempted shots and free throws
// - Basketball-Reference's share stats (usage, assist, rebound, steal and block %) are each a count
//   over what was available while he was on the floor; that denominator is the count / the share, so
//   each part's is recovered, summed, and the count total divided by it (a part with none of the count
//   has no share to recover it from: its minutes at the other part's rate)
// - PER, Box Plus/Minus and its defensive half are per-minute production: production (rate x minutes)
//   summed, over the minutes; Win Shares (and their defensive half) and VORP add up, and WS/48 is
//   them over the minutes
// - on/off: the team's point margin with him on the floor (per 100 x his minutes) and off it (x the
//   minutes of his games he sat), each summed over its minutes

const COUNTS = ['games', 'games_started', 'mp', 'fg', 'fga', 'fg3', 'fg3a', 'fg2', 'fg2a', 'ft', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pts'];
const ratio = (a, b) => (b > 0 ? a / b : null);

function sumTotals(rows) {
  const out = { ...rows[0] };
  for (const key of COUNTS) out[key] = sum(rows, (r) => num(r[key]));
  out.fg_pct = ratio(out.fg, out.fga);
  out.fg3_pct = ratio(out.fg3, out.fg3a);
  out.ft_pct = ratio(out.ft, out.fta);
  return out;
}

const plays = (t) => (num(t.fga) ?? 0) + 0.44 * (num(t.fta) ?? 0) + (num(t.tov) ?? 0);
const SHARES = {
  usg_pct: plays,
  ast_pct: (t) => num(t.ast) ?? 0,
  trb_pct: (t) => num(t.trb) ?? 0,
  stl_pct: (t) => num(t.stl) ?? 0,
  blk_pct: (t) => num(t.blk) ?? 0,
};

function sumAdvanced(rows, totalsOf) {
  const out = { ...rows[0] };
  const mp = sum(rows, (r) => num(r.mp));
  const totals = rows.map(totalsOf);
  out.mp = mp;
  // (production: rate x minutes over the rows that have the rate)
  const perMinute = (key) => {
    const has = rows.filter((r) => num(r[key]) !== null);
    return round(ratio(sum(has, (r) => num(r[key]) * (num(r.mp) ?? 0)), sum(has, (r) => num(r.mp))), 1);
  };
  out.per = perMinute('per');
  out.bpm = perMinute('bpm');
  out.dbpm = perMinute('dbpm');
  out.ws = round(sum(rows, (r) => num(r.ws)), 1);
  out.dws = round(sum(rows, (r) => num(r.dws)), 1);
  out.vorp = round(sum(rows, (r) => num(r.vorp)), 1);
  out.ws_per_48 = round(ratio(48 * out.ws, mp), 3);
  const pts = sum(totals, (t) => num(t?.pts));
  out.ts_pct = round(ratio(pts, 2 * sum(totals, (t) => (num(t?.fga) ?? 0) + 0.44 * (num(t?.fta) ?? 0))), 3);
  out.tov_pct = round(100 * ratio(sum(totals, (t) => num(t?.tov)), sum(totals, (t) => (t ? plays(t) : 0))), 1);
  for (const [key, count] of Object.entries(SHARES)) {
    const parts = rows.map((r, i) => {
      const n = totals[i] ? count(totals[i]) : null;
      const share = num(r[key]);
      return { n, mp: num(r.mp) ?? 0, available: n > 0 && share > 0 ? (100 * n) / share : null };
    });
    const known = parts.filter((p) => p.available !== null);
    if (parts.some((p) => p.n === null)) {
      out[key] = null;
      continue;
    }
    // (a count with every share rounded to 0.0, a block or two: so is the sum)
    if (!known.length && sum(parts, (p) => p.n) > 0) {
      out[key] = 0;
      continue;
    }
    const perMin = ratio(sum(known, (p) => p.available), sum(known, (p) => p.mp));
    const available = sum(parts, (p) => p.available ?? p.mp * (perMin ?? 0));
    out[key] = available > 0 ? round((100 * sum(parts, (p) => p.n)) / available, 1) : rows.some((r) => num(r[key]) !== null) ? 0 : null;
  }
  return out;
}

function sumOnOff(rows) {
  const out = { ...rows[0], mp: sum(rows, (r) => num(r.mp)), games: sum(rows, (r) => num(r.games)) };
  const has = rows.filter((r) => num(r.plus_minus_on) !== null && num(r.plus_minus_net) !== null);
  const on = (r) => num(r.plus_minus_on);
  const off = (r) => num(r.plus_minus_on) - num(r.plus_minus_net);
  const offMinutes = (r) => Math.max(0, (num(r.games) ?? 0) * 48 - (num(r.mp) ?? 0));
  const onRate = ratio(sum(has, (r) => on(r) * (num(r.mp) ?? 0)), sum(has, (r) => num(r.mp)));
  const offRate = ratio(sum(has, (r) => off(r) * offMinutes(r)), sum(has, offMinutes));
  out.plus_minus_on = round(onRate, 1);
  out.plus_minus_net = onRate === null || offRate === null ? null : round(onRate - offRate, 1);
  return out;
}

// A player table's rows by player: his whole season's row and his rows for each team (a player with
// one team: that row)
function stints(rows) {
  const players = new Map();
  for (const row of rows) {
    const p = players.get(row._id) ?? players.set(row._id, { whole: null, teams: [] }).get(row._id);
    if (row._partial) p.teams.push(row);
    else if (!p.whole) p.whole = row;
  }
  for (const p of players.values()) if (!p.teams.length && p.whole) p.teams.push(p.whole);
  return players;
}

// Two parts' rows of a player table as one table: each player's rows for a team summed (merge), and
// his whole row (a player on more than one team: "2TM", then a row for each team, his latest last)
function combineRows(regular, post, merge) {
  const a = stints(regular);
  const b = stints(post);
  const out = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const parts = [a.get(id), b.get(id)].filter((p) => p?.whole);
    const codes = [...new Set(parts.flatMap((p) => p.teams.map((r) => r.team_name_abbr)))];
    const byTeam = codes.map((code) => {
      const rows = parts.flatMap((p) => p.teams.filter((r) => r.team_name_abbr === code));
      return { ...(rows.length > 1 ? merge(rows) : rows[0]), _partial: codes.length > 1 };
    });
    const whole = parts.length > 1 ? merge(parts.map((p) => p.whole)) : { ...parts[0].whole };
    out.push({ ...whole, team_name_abbr: codes.length > 1 ? `${codes.length}TM` : codes[0], _partial: false, _part: 'all' });
    if (codes.length > 1) out.push(...byTeam.map((row) => ({ ...row, _part: 'all' })));
  }
  return out;
}

// Two parts' teams as one: wins and points added up; the ratings and pace from the possessions (each
// part's: points x 100 / offensive rating), and the wins the summed point differential implies
// (Basketball-Reference's: games x points^14 / (points^14 + allowed^14))
function combineTeams(regular, post) {
  const out = new Map();
  for (const [code, r] of regular) {
    const p = post.get(code);
    if (!p) {
      out.set(code, r);
      continue;
    }
    const parts = [r, p];
    const wins = r.wins + p.wins;
    const losses = r.losses + p.losses;
    const known = parts.every((t) => t.pts !== null && t.oppPts !== null && t.ortg && t.minutes);
    if (!known) {
      out.set(code, { ...r, wins, losses, pace: null, ortg: null, drtg: null, net: null, pythWins: null });
      continue;
    }
    const pts = r.pts + p.pts;
    const oppPts = r.oppPts + p.oppPts;
    const poss = sum(parts, (t) => (100 * t.pts) / t.ortg);
    const ortg = (100 * pts) / poss;
    const drtg = (100 * oppPts) / poss;
    out.set(code, {
      name: r.name,
      wins,
      losses,
      pace: round((48 * poss) / sum(parts, (t) => t.minutes), 1),
      ortg: round(ortg, 1),
      drtg: round(drtg, 1),
      net: round(ortg - drtg, 1),
      pythWins: round(((wins + losses) * pts ** 14) / (pts ** 14 + oppPts ** 14), 1),
      pts,
      oppPts,
      minutes: sum(parts, (t) => t.minutes),
    });
  }
  return out;
}

function combine(regular, post) {
  // (a row's totals, for the advanced rows' rates: same part, player and team)
  const totalsIndex = new Map([...regular.totals, ...post.totals].map((t) => [`${t._part}|${t._id}|${t.team_name_abbr}`, t]));
  const totalsOf = (row) => totalsIndex.get(`${row._part}|${row._id}|${row.team_name_abbr}`);
  return {
    totals: combineRows(regular.totals, post.totals, sumTotals),
    advanced: combineRows(regular.advanced, post.advanced, (rows) => sumAdvanced(rows, totalsOf)),
    pbp: combineRows(regular.pbp, post.pbp, sumOnOff),
    teams: combineTeams(regular.teams, post.teams),
  };
}

// A coach row's games and record in a part: the regular season's, the playoffs' or both
const coachRecord = (row, part) => {
  const regular = [num(row.cur_g) ?? 0, num(row.cur_w) ?? 0, num(row.cur_l) ?? 0];
  const post = [num(row.cur_g_p) ?? 0, num(row.cur_w_p) ?? 0, num(row.cur_l_p) ?? 0];
  return part === 'regular' ? regular : part === 'post' ? post : regular.map((v, i) => v + post[i]);
};

async function buildSeason(season, write) {
  fetched.clear();
  const current = season === CURRENT_SEASON;
  // (a finished season's pages are cached; this season's are fetched fresh)
  const keep = !current;
  const regular = await partTables(season, 'regular', keep);
  if (!regular) return console.log(`${season}: no games yet`);
  const playoffs = await page(`${BBREF}/playoffs/NBA_${season}.html`, keep);
  const post = await partTables(season, 'post', keep);
  // (no playoffs, by Basketball-Reference's own word: a 404 for their totals page)
  const noPlayoffs = !post && missing.has(`${BBREF}/playoffs/NBA_${season}_totals.html`);
  const coachRows = table(await page(`${BBREF}/leagues/NBA_${season}_coaches.html`, keep), 'NBA_coaches');
  const coy = (await page(`${BBREF}/awards/awards_${season}.html`, keep))
    .split('id="coy"')[1]
    ?.match(/\/coaches\/([a-z0-9]+)\.html/)?.[1];
  // Last season's Box Plus/Minus (the roster's talent coming in, for the coaching lift below)
  const priorAdvanced = table(await page(`${BBREF}/leagues/NBA_${season - 1}_advanced.html`, true), 'advanced');
  const dir = current ? STATIC : path.join(STATIC, 'seasons', String(season));
  const espnList = await espnAthletes(season);
  const injuredList = current ? await injuries() : new Map();
  // (ESPN's list failed: the ids the last good run gave, by name: carried forward,
  // libs/ranker/scripts/carry-forward)
  const espn =
    espnList ?? new Map((await previousRows(path.join(dir, FILE.regular))).filter((u) => u.id != null && u.name).map((u) => [norm(u.name), u.id]));
  if (!espnList) console.warn(`${season}: ESPN's athlete list failed, ${espn.size} ESPN ids kept from the last run`);
  const injured = injuredList ?? new Map();
  const recent = await teamRecent(season, keep, regular.teams, post?.teams);

  // The Finals: the champion and the runner-up (their conference's champion)
  // (the series table's first row: "<a href='/teams/NYK/2026.html'>...</a> over <a href='/teams/SAS/...")
  const finals = playoffs.match(/<strong>Finals<\/strong>[\s\S]*?\/teams\/([A-Z]{3})\/\d+\.html['"]>[^<]*<\/a>\s*over\s*<a href=['"]\/teams\/([A-Z]{3})\//);
  const [champion, runnerUp] = finals ? [finals[1], finals[2]] : [null, null];

  // The season's own: each player's listed position and award voting (his tab and badges in every part)
  const shared = { champion, runnerUp, coachRows, coy, priorAdvanced, espn, injured, recent };
  shared.positions = new Map();
  shared.awards = new Map();
  for (const [id, p] of stints(regular.totals)) {
    shared.positions.set(id, p.whole?.pos);
    shared.awards.set(id, p.whole?.awards);
  }

  await mkdir(dir, { recursive: true });
  const tables = { regular, post, all: post && combine(regular, post) };
  for (const part of PARTS.filter((p) => write.includes(p))) {
    const file = path.join(dir, FILE[part]);
    if (!tables[part]) {
      // (no playoffs yet: no playoffs or both, and none left over from an earlier season; a playoffs page
      // that came back without its table says nothing either way: the file stays)
      if (noPlayoffs) await rm(file, { force: true });
      console.log(`${season} ${part}: ${noPlayoffs ? 'no playoffs yet' : 'no playoff table on the page, the file left as it was'}`);
      continue;
    }
    const out = await buildPart(season, part, tables[part], shared);
    // (the injury report failed: the injuries the last good run gave, carried forward)
    if (!injuredList) {
      const players = TABS.flatMap((tab) => out[tab]);
      const hurt = carryForward(players, await previousRows(file), {
        keep: (row, prev) => sameSeason(row, prev) && prev.injured && !row.injured,
        fields: ['injured', 'injuryStatus'],
      });
      console.warn(`${season} ${part}: ESPN's injury report failed, ${hurt} injuries kept from the last run`);
    }
    // (compact: the files are served to the browser as is)
    await writeFile(file, JSON.stringify(out));
    const everyone = TABS.flatMap((tab) => out[tab]);
    const photos = everyone.filter((u) => u.id).length;
    console.log(`${season} ${part}: ${[...TABS, 'HC'].map((tab) => `${out[tab].length} ${tab}`).join(', ')} (${photos}/${everyone.length} with ESPN ids; champion ${champion ?? '?'} over ${runnerUp ?? '?'})`);
  }
}

// One part's tabs, from its tables (src: totals, advanced, pbp, teams)
async function buildPart(season, part, src, { champion, runnerUp, coachRows, coy, priorAdvanced, espn, injured, recent, positions, awards: awardVotes }) {
  const current = season === CURRENT_SEASON;
  const { teams, totals, advanced, pbp } = src;

  // A player's whole season (a traded player's combined row) and his last team
  const byId = (rows) => {
    const whole = new Map();
    const lastTeam = new Map();
    for (const row of rows) {
      if (!row._id) continue;
      if (row._partial) {
        lastTeam.set(row._id, row.team_name_abbr);
        continue;
      }
      if (!whole.has(row._id)) whole.set(row._id, row);
    }
    return { whole, lastTeam };
  };
  const t = byId(totals);
  const adv = byId(advanced).whole;
  const onOff = byId(pbp).whole;

  // Supporting cast: each team's minutes and minutes-weighted Box Plus/Minus, from every player's
  // rows for that team (a traded player counts for each of his teams)
  const castByTeam = new Map();
  for (const row of advanced) {
    const code = row.team_name_abbr;
    if (!row._id || !code || /\dTM|TOT/.test(code)) continue;
    const mp = num(row.mp) ?? 0;
    const c = castByTeam.get(code) ?? { mp: 0, bpm: 0 };
    castByTeam.set(code, { mp: c.mp + mp, bpm: c.bpm + mp * (num(row.bpm) ?? 0) });
  }
  const ownRow = new Map();
  for (const row of advanced) if (row._id && !/\dTM|TOT/.test(row.team_name_abbr)) ownRow.set(`${row._id}/${row.team_name_abbr}`, row);

  // Coaching lift: how much better the team played than its roster's talent coming in. The talent is
  // last season's Box Plus/Minus of the players the team used, weighted by their minutes for it this
  // season (a newcomer to the league counts as a replacement-level -2); five of them on the floor,
  // regressed a quarter of the way to average (last season doesn't carry over in full), predict a
  // net rating. The lift is the team's net rating minus that.
  const priorBpm = new Map();
  for (const row of priorAdvanced) {
    if (!row._id || row._partial) continue;
    if (!priorBpm.has(row._id)) priorBpm.set(row._id, { bpm: num(row.bpm) ?? 0, mp: num(row.mp) ?? 0 });
  }
  const talent = new Map();
  for (const row of advanced) {
    const code = row.team_name_abbr;
    if (!row._id || !code || /\dTM|TOT/.test(code)) continue;
    const mp = num(row.mp) ?? 0;
    const prior = priorBpm.get(row._id);
    // (a short prior season says little: blend toward replacement level under 500 minutes)
    const known = prior ? Math.min(1, prior.mp / 500) : 0;
    const bpm = prior ? known * prior.bpm + (1 - known) * -2 : -2;
    const tt = talent.get(code) ?? { mp: 0, bpm: 0 };
    talent.set(code, { mp: tt.mp + mp, bpm: tt.bpm + mp * bpm });
  }
  const lift = new Map();
  for (const [code, team] of teams) {
    const tt = talent.get(code);
    if (!tt?.mp || team.net === null || !priorAdvanced.length) continue;
    lift.set(code, Math.round((team.net - 5 * 0.75 * (tt.bpm / tt.mp)) * 10) / 10);
  }

  // Each team's league rank in offensive rating (highest first) and defensive rating (lowest first)
  const rankBy = (key, dir) => {
    const ranked = [...teams].filter(([, t]) => t[key] !== null).sort((a, b) => dir * (a[1][key] - b[1][key]));
    return new Map(ranked.map(([code], i) => [code, i + 1]));
  };
  const offRank = rankBy('ortg', -1);
  const defRank = rankBy('drtg', 1);

  // Head coaches: one row per coach and team (an interim coach has his own games and record; the
  // team's ratings are its whole season's, or playoffs')
  const coaches = [];
  for (const row of coachRows) {
    const code = row.team;
    const coachId = row._coach;
    const [g, wins, losses] = coachRecord(row, part);
    if (!coachId || !code || g < MIN_COACH_GAMES) continue;
    const team = teams.get(code);
    const awards = [];
    if (coachId === coy) awards.push('coy');
    if (code === champion) awards.push('champ');
    if (code === runnerUp) awards.push('finals');
    const teamRecent = recent[part].get(code);
    coaches.push({
      id: null,
      gsisId: coachId,
      name: row.coach,
      teamLogo: `assets/NBA_Icons/${franchise(code)}.svg`,
      teamName: team?.name ?? null,
      games: g,
      _team: code,
      // (the team's last seven games: the Teams tab's Recent)
      ...(teamRecent?.results.length ? { teamLastFive: teamRecent.results, teamLastFiveVs: teamRecent.vs } : {}),
      stats: {
        wins,
        losses,
        winPct: wins + losses ? round(wins / (wins + losses), 3) : null,
        playoffWins: num(row.cur_w_p) ?? 0,
        netRtg: team?.net ?? null,
        ortg: team?.ortg ?? null,
        drtg: team?.drtg ?? null,
        offRank: offRank.get(code) ?? null,
        defRank: defRank.get(code) ?? null,
        pace: team?.pace ?? null,
        lift: lift.get(code) ?? null,
        // (his share of the team's wins over what its point differential implies)
        pythDiff: team && team.pythWins !== null && team.wins + team.losses ? round(((team.wins - team.pythWins) * g) / (team.wins + team.losses), 1) : null,
      },
      awards,
    });
  }
  const out = Object.fromEntries(TABS.map((tab) => [tab, []]));
  const attempts = MIN_ATTEMPTS[part];
  for (const [id, row] of t.whole) {
    const mp = num(row.mp) ?? 0;
    if (mp < MIN_MINUTES) continue;
    // Tab: the listed position ("SG-PG" -> SG), the regular season's in every part
    const tab = TABS.find((p) => p === String(positions.get(id) ?? row.pos).split('-')[0]);
    if (!tab) continue;
    const a = adv.get(id) ?? {};
    const p = onOff.get(id) ?? {};
    const code = /\dTM|TOT/.test(row.team_name_abbr) ? t.lastTeam.get(id) : row.team_name_abbr;
    const team = teams.get(code);
    const espnId = espn.get(norm(row.name_display)) ?? espnIds.get(norm(row.name_display)) ?? null;
    const awards = new Set();
    for (const token of String(awardVotes.get(id) ?? '').split(',').map((s) => s.trim())) {
      if (WINNER_AWARDS[token]) awards.add(WINNER_AWARDS[token]);
      if (TEAM_AWARDS[token]) awards.add(TEAM_AWARDS[token]);
    }
    // (on a team that reached the Finals: every row from that team gets the cup)
    if (code && code === champion) awards.add('champ');
    if (code && code === runnerUp) awards.add('finals');
    // Supporting cast: his last team's other players' minutes-weighted BPM (without him)
    const own = ownRow.get(`${id}/${code}`);
    const cast = castByTeam.get(code);
    const ownMp = num(own?.mp) ?? 0;
    const castScore = cast && cast.mp - ownMp > 0 ? (cast.bpm - ownMp * (num(own?.bpm) ?? 0)) / (cast.mp - ownMp) : null;

    const g = num(row.games) ?? 0;
    out[tab].push({
      id: espnId,
      gsisId: id,
      name: row.name_display.replace(/\*$/, ''),
      teamLogo: `assets/NBA_Icons/${franchise(code ?? 'NBA')}.svg`,
      teamName: team?.name ?? null,
      games: g,
      _team: code,
      _cast: castScore,
      stats: {
        minutes: mp,
        gamesStarted: num(row.games_started),
        points: num(row.pts),
        rebounds: num(row.trb),
        assists: num(row.ast),
        steals: num(row.stl),
        blocks: num(row.blk),
        turnovers: num(row.tov),
        threes: num(row.fg3),
        fgPct: pct(row.fg_pct),
        fg3Pct: num(row.fg3a) >= attempts.fg3a ? pct(row.fg3_pct) : null,
        ftPct: num(row.fta) >= attempts.fta ? pct(row.ft_pct) : null,
        // (the attempts behind them: the card's Shooting counts a percentage only with enough a game,
        // apps/nba/src/sport/skills.ts SKILL_MINIMUMS; not columns of their own)
        fg3a: num(row.fg3a),
        fta: num(row.fta),
        per: num(a.per),
        tsPct: pct(a.ts_pct),
        usgPct: num(a.usg_pct),
        astPct: num(a.ast_pct),
        tovPct: num(a.tov_pct),
        trbPct: num(a.trb_pct),
        stlPct: num(a.stl_pct),
        blkPct: num(a.blk_pct),
        ws: num(a.ws),
        // (Defensive Win Shares: the defensive half of Win Shares, a season total)
        dws: num(a.dws),
        ws48: num(a.ws_per_48),
        bpm: num(a.bpm),
        dbpm: num(a.dbpm),
        vorp: num(a.vorp),
        onOff: num(String(p.plus_minus_net ?? '').replace('+', '')),
        // His team's record (a traded player: his last team's)
        wins: team?.wins ?? null,
        losses: team?.losses ?? null,
        winPct: team && team.wins + team.losses ? round(team.wins / (team.wins + team.losses), 3) : null,
      },
      awards: [...awards],
      ...(espnId && injured.has(espnId) ? { injured: true, injuryStatus: injured.get(espnId) } : {}),
    });
  }

  // Support grades (the situation around a player, graded across the league):
  // - Teammates: the rest of his team's quality, their minutes-weighted Box Plus/Minus without him,
  //   curved over every player
  // - Coaching: his team's coaching lift (above), curved over the teams
  const everyone = TABS.flatMap((tab) => out[tab]);
  const cast = curve(new Map(everyone.map((u) => [u.gsisId, u._cast ?? NaN])));
  const coaching = curve(lift);
  for (const unit of everyone) {
    unit.stats.teammates = cast.get(unit.gsisId) ?? null;
    unit.stats.coaching = coaching.get(unit._team) ?? null;
    delete unit._cast;
    delete unit._team;
  }
  for (const c of coaches) delete c._team;
  // (early in the season, Teammates and Coaching start from the team's last season: libs/ranker/scripts/early-season)
  if (current && part === 'regular') console.log(await blendWithLastSeason({ staticDir: STATIC, season, rows: out, keys: ['teammates', 'coaching'], fullAt: 20 }));
  out.HC = coaches;

  for (const tab of [...TABS, 'HC']) out[tab].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Newest first, so a player's ESPN id from a later season can fill in an older one
const seasons = process.env.ALL
  ? Array.from({ length: CURRENT_SEASON - FIRST_SEASON }, (_, i) => CURRENT_SEASON - 1 - i)
  : [Number(process.env.SEASON ?? CURRENT_SEASON)];
const write = (process.env.PARTS ?? PARTS.join(',')).split(',').map((p) => p.trim());
for (const season of seasons) await buildSeason(season, write);
