// Player dossiers for the AI analysis: one compact JSON per current QB/RB/WR/TE, every number precomputed
// (the model explains numbers, it doesn't add them up). Each rate comes with its rank among the
// position's qualifiers ([value, rank, of]), so "good" and "bad" are the league's, not the model's guess.
//
//   node apps/nfl/scripts/analysis/dossier.mjs [name filter...]
//
// Sources (cached in .cache/nflverse for 12 hours): nflverse play-by-play, weekly player stats, Next Gen
// Stats, PFR advanced stats, snap counts, injuries, depth charts, players, draft picks and the
// schedule (with Vegas lines); ESPN's injury report (with its news notes) and the coming week's DraftKings lines;
// the site's own season archives for the career and the current lists.
// Writes .cache/analysis/dossiers/<gsisId>.json.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const DATA = path.join(ROOT, 'apps/nfl/src/StaticData');
const CACHE = path.join(ROOT, '.cache/nflverse');
const OUT = path.join(ROOT, '.cache/analysis/dossiers');
const SEASON = 2026;
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const FILES = {
  pbp: `pbp/play_by_play_${SEASON}.csv.gz`,
  weekly: `stats_player/stats_player_week_${SEASON}.csv.gz`,
  ngsPass: 'nextgen_stats/ngs_passing.csv.gz',
  ngsRec: 'nextgen_stats/ngs_receiving.csv.gz',
  ngsRush: 'nextgen_stats/ngs_rushing.csv.gz',
  pfrPass: `pfr_advstats/advstats_week_pass_${SEASON}.csv.gz`,
  pfrRec: `pfr_advstats/advstats_week_rec_${SEASON}.csv.gz`,
  pfrRush: `pfr_advstats/advstats_week_rush_${SEASON}.csv.gz`,
  snaps: `snap_counts/snap_counts_${SEASON}.csv.gz`,
  injuries: `injuries/injuries_${SEASON}.csv.gz`,
  depth: `depth_charts/depth_charts_${SEASON}.csv.gz`,
  players: 'players/players.csv.gz',
  draft: 'draft_picks/draft_picks.csv.gz',
};
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
// ESPN's abbreviations that aren't nflverse's
const ESPN_ABBR = { WSH: 'WAS', LAR: 'LA' };
const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

const TEAMS = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears',
  CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs', LA: 'Rams', LAC: 'Chargers',
  LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers',
  TEN: 'Titans', WAS: 'Commanders',
};
const LOGO_TEAM = Object.fromEntries(Object.entries(TEAMS).map(([abbr, name]) => [name === 'Buccaneers' ? 'Bucs' : name, abbr]));

// ---- loading

async function download(file, url) {
  const dest = path.join(CACHE, file);
  if (existsSync(dest) && Date.now() - statSync(dest).mtimeMs < 12 * 3600e3) return dest;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Rows as objects, only the columns asked for (all when none), kept when keep(row) says so
async function readCsv(file, columns, keep = () => true) {
  const input = createReadStream(file).pipe(file.endsWith('.gz') ? createGunzip() : new (await import('node:stream')).PassThrough());
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header = null;
  let picks = null;
  const rows = [];
  for await (const line of lines) {
    const cells = splitCsv(line);
    if (!header) {
      header = cells;
      picks = (columns ?? header).map((c) => [c, header.indexOf(c)]);
      continue;
    }
    const row = {};
    for (const [c, i] of picks) row[c] = i < 0 ? '' : cells[i];
    if (keep(row)) rows.push(row);
  }
  return rows;
}

const num = (v) => (v === '' || v === undefined || v === null || v === 'NA' ? null : Number(v));
const r = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const sum = (rows, f) => rows.reduce((t, x) => t + (num(typeof f === 'string' ? x[f] : f(x)) ?? 0), 0);
const mean = (rows, f) => {
  const v = rows.map((x) => num(typeof f === 'string' ? x[f] : f(x))).filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const per = (a, b, d = 3) => (b ? r(a / b, d) : null);
const group = (rows, key) => {
  const m = new Map();
  for (const row of rows) {
    const k = typeof key === 'function' ? key(row) : row[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }
  return m;
};

// ---- ESPN: the injury report (everyone not Active, with ESPN's note) by nflverse team, and a day's
// DraftKings lines by matchup

async function espnInjuries() {
  const res = await fetch(`${ESPN}/injuries`);
  if (!res.ok) throw new Error(`ESPN injuries: ${res.status}`);
  const data = await res.json();
  const byTeam = new Map();
  for (const team of data.injuries ?? []) {
    for (const i of team.injuries ?? []) {
      if (!i.status || i.status === 'Active') continue;
      const abbr = i.athlete?.team?.abbreviation;
      const t = ESPN_ABBR[abbr] ?? abbr;
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t).push({
        espnId: i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ?? null,
        name: i.athlete?.displayName,
        pos: i.athlete?.position?.abbreviation,
        status: i.status,
        injury: [i.details?.type, i.details?.detail].filter((x) => x && x !== 'Not Specified').join(', ') || null,
        returnDate: i.details?.returnDate ?? null,
        reported: i.date?.slice(0, 10) ?? null,
        news: i.shortComment ?? null,
      });
    }
  }
  return byTeam;
}

async function espnLines(dates) {
  const lines = new Map();
  for (const d of dates) {
    const res = await fetch(`${ESPN}/scoreboard?dates=${d.replace(/-/g, '')}`).catch(() => null);
    if (!res?.ok) continue;
    for (const e of (await res.json()).events ?? []) {
      const c = e.competitions?.[0];
      const o = c?.odds?.[0];
      if (!o?.details) continue;
      const team = (side) => {
        const a = c.competitors.find((x) => x.homeAway === side)?.team?.abbreviation;
        return ESPN_ABBR[a] ?? a;
      };
      lines.set(`${team('away')}@${team('home')}`, { line: o.details, overUnder: o.overUnder ?? null, homeMoneyline: o.moneyline?.home?.close?.odds ?? null, awayMoneyline: o.moneyline?.away?.close?.odds ?? null, book: o.provider?.name ?? null });
    }
  }
  return lines;
}

// ---- ranking: [value, rank, of] among a pool (higher first unless low)

function ranker(pool, low = false) {
  const values = pool.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => (low ? a - b : b - a));
  return (v) => (v === null || !Number.isFinite(v) ? null : [v, values.filter((x) => (low ? x < v : x > v)).length + 1, values.length]);
}

// ---- main

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const paths = {};
  for (const [k, f] of Object.entries(FILES)) paths[k] = await download(path.basename(f), `${NFLVERSE}/${f}`);
  paths.schedule = await download('games.csv', SCHEDULE_URL);

  console.log('reading...');
  const [pbp, weekly, ngsPass, ngsRec, ngsRush, pfrPass, pfrRec, pfrRush, snaps, injuries, players, draft, schedule] = await Promise.all([
    readCsv(paths.pbp, null, (x) => x.season_type === 'REG' || x.season_type === 'POST'),
    readCsv(paths.weekly, null),
    readCsv(paths.ngsPass, null, (x) => x.season === String(SEASON) && x.week !== '0'),
    readCsv(paths.ngsRec, null, (x) => x.season === String(SEASON) && x.week !== '0'),
    readCsv(paths.ngsRush, null, (x) => x.season === String(SEASON) && x.week !== '0'),
    readCsv(paths.pfrPass, null),
    readCsv(paths.pfrRec, null),
    readCsv(paths.pfrRush, null),
    readCsv(paths.snaps, null),
    readCsv(paths.injuries, null),
    readCsv(paths.players, null),
    readCsv(paths.draft, null, (x) => Number(x.season) >= 2000),
    readCsv(paths.schedule, null, (x) => x.season === String(SEASON)),
  ]);
  const depthRows = await readCsv(paths.depth, ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank']);
  const injuryReport = await espnInjuries();

  const bio = new Map(players.map((p) => [p.gsis_id, p]));
  const byEspn = new Map(players.filter((p) => p.espn_id).map((p) => [p.espn_id, p.gsis_id]));
  const byPfr = new Map(players.filter((p) => p.pfr_id).map((p) => [p.pfr_id, p.gsis_id]));

  // ---- the current lists (the site's): QBs from games.json (ESPN ids), the rest from skill-players.json
  const site = JSON.parse(readFileSync(path.join(DATA, 'skill-players.json'), 'utf8'));
  const siteQbs = JSON.parse(readFileSync(path.join(DATA, 'games.json'), 'utf8'));
  const list = [];
  for (const q of siteQbs) {
    const gsis = byEspn.get(String(q.id));
    if (gsis) list.push({ gsis, pos: 'QB', site: q, siteId: `QB-${q.id}` });
  }
  for (const pos of ['RB', 'WR', 'TE']) for (const p of site[pos] ?? []) list.push({ gsis: p.gsisId, pos, site: p, siteId: p.gsisId });

  // ---- the schedule: results, Vegas lines, each team's next game
  const games = schedule.map((g) => ({
    id: g.game_id,
    week: Number(g.week),
    type: g.game_type,
    date: g.gameday,
    home: g.home_team,
    away: g.away_team,
    homeScore: num(g.home_score),
    awayScore: num(g.away_score),
    spread: num(g.spread_line), // home favored by
    total: num(g.total_line),
    roof: g.roof,
    surface: g.surface,
    temp: num(g.temp),
    wind: num(g.wind),
    div: g.div_game === '1',
    homeRest: num(g.home_rest),
    awayRest: num(g.away_rest),
    homeCoach: g.home_coach,
    awayCoach: g.away_coach,
    homeQb: g.home_qb_name,
    awayQb: g.away_qb_name,
  }));
  const gameById = new Map(games.map((g) => [g.id, g]));
  // A game from one team's side: where, the score, the line (favored by: positive favored), covered, over
  const side = (g, team) => {
    const home = g.home === team;
    const us = home ? g.homeScore : g.awayScore;
    const them = home ? g.awayScore : g.homeScore;
    const favoredBy = g.spread === null ? null : home ? g.spread : -g.spread;
    const played = us !== null;
    return {
      week: g.week,
      date: g.date,
      opp: home ? g.away : g.home,
      at: home ? 'home' : 'away',
      score: played ? `${us}-${them}` : null,
      result: played ? (us > them ? 'W' : us < them ? 'L' : 'T') : null,
      favoredBy,
      covered: played && favoredBy !== null ? (us - them > favoredBy ? 'yes' : us - them === favoredBy ? 'push' : 'no') : null,
      total: g.total,
      overUnder: played && g.total !== null ? (us + them > g.total ? 'over' : us + them < g.total ? 'under' : 'push') : null,
      div: g.div,
      restDays: home ? g.homeRest : g.awayRest,
      weather: g.roof === 'outdoors' || g.roof === 'open' ? { temp: g.temp, wind: g.wind } : g.roof,
    };
  };
  const nextGame = (team) => {
    const g = games.filter((x) => (x.home === team || x.away === team) && x.homeScore === null).sort((a, b) => a.date.localeCompare(b.date))[0];
    return g ? { ...side(g, team), oppCoach: g.home === team ? g.awayCoach : g.homeCoach } : null;
  };

  // The coming week's lines (ESPN's DraftKings), for next games nflverse hasn't a line for yet
  const nextDates = [...new Set(games.filter((g) => g.homeScore === null).map((g) => g.date))].sort().slice(0, 4);
  const lines = await espnLines(nextDates);

  // Who started at QB each game for a team (the schedule's starters)
  const qbStarts = (team) =>
    games
      .filter((g) => (g.home === team || g.away === team) && g.homeScore !== null)
      .sort((a, b) => a.week - b.week)
      .map((g) => `W${g.week} ${g.home === team ? g.homeQb : g.awayQb}`);

  // ---- play-by-play: plays that count (no penalties-only, no kneels or spikes)
  const plays = pbp.filter((x) => (x.pass === '1' || x.rush === '1') && x.play_deleted !== '1' && x.qb_kneel !== '1' && x.qb_spike !== '1');
  const neutral = (x) => num(x.wp) !== null && num(x.wp) >= 0.2 && num(x.wp) <= 0.8 && num(x.qtr) <= 4;

  // ---- team context: offense and defense EPA/play, success, pass rate over expected, pace, ranks
  const teamOff = group(plays, 'posteam');
  const teamDef = group(plays, 'defteam');
  const teamCtx = {};
  const pools = { off: [], offPass: [], offRush: [], def: [], defPass: [], defRush: [], proe: [], pressure: [], sacksMade: [] };
  for (const t of Object.keys(TEAMS)) {
    const o = teamOff.get(t) ?? [];
    const d = teamDef.get(t) ?? [];
    const ctx = {
      offEpa: r(mean(o, 'epa')),
      offPassEpa: r(mean(o.filter((x) => x.pass === '1'), 'epa')),
      offRushEpa: r(mean(o.filter((x) => x.rush === '1'), 'epa')),
      offSuccess: r(mean(o, 'success')),
      passRateOverExp: r(mean(o.filter(neutral), 'pass_oe'), 1),
      defEpa: r(mean(d, 'epa')),
      defPassEpa: r(mean(d.filter((x) => x.pass === '1'), 'epa')),
      defRushEpa: r(mean(d.filter((x) => x.rush === '1'), 'epa')),
      defSuccess: r(mean(d, 'success')),
      // pressure made: sacks + QB hits per dropback (pbp's only pressure signal)
      defHitRate: per(d.filter((x) => x.qb_dropback === '1' && (x.sack === '1' || x.qb_hit === '1')).length, d.filter((x) => x.qb_dropback === '1').length),
      defSackRate: per(d.filter((x) => x.qb_dropback === '1' && x.sack === '1').length, d.filter((x) => x.qb_dropback === '1').length),
      // offense allowing: sacks + hits per dropback
      offHitRate: per(o.filter((x) => x.qb_dropback === '1' && (x.sack === '1' || x.qb_hit === '1')).length, o.filter((x) => x.qb_dropback === '1').length),
      defExplosivePassRate: per(d.filter((x) => x.pass === '1' && num(x.yards_gained) >= 20).length, d.filter((x) => x.pass === '1').length),
      defExplosiveRushRate: per(d.filter((x) => x.rush === '1' && num(x.yards_gained) >= 10).length, d.filter((x) => x.rush === '1').length),
      defDeepEpa: r(mean(d.filter((x) => x.pass === '1' && num(x.air_yards) >= 20), 'epa')),
      defShortEpa: r(mean(d.filter((x) => x.pass === '1' && num(x.air_yards) !== null && num(x.air_yards) < 10), 'epa')),
    };
    teamCtx[t] = ctx;
  }
  const teamRank = (key, low) => {
    const rank = ranker(Object.values(teamCtx).map((c) => c[key]), low);
    for (const t of Object.keys(teamCtx)) teamCtx[t][key] = rank(teamCtx[t][key]);
  };
  for (const k of ['offEpa', 'offPassEpa', 'offRushEpa', 'offSuccess', 'passRateOverExp', 'defHitRate', 'defSackRate']) teamRank(k, false);
  for (const k of ['defEpa', 'defPassEpa', 'defRushEpa', 'defSuccess', 'offHitRate', 'defExplosivePassRate', 'defExplosiveRushRate', 'defDeepEpa', 'defShortEpa']) teamRank(k, true);

  // What each defense allows to a position: PPR points per game and yards per game (weekly stats by
  // opponent), ranked (1: allows the fewest)
  const regWeekly = weekly.filter((x) => x.season_type === 'REG' || x.season_type === 'POST');
  const allowed = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const rows = regWeekly.filter((x) => x.position === pos);
    const byOpp = group(rows, 'opponent_team');
    const perTeam = {};
    for (const [t, rs] of byOpp) {
      const g = new Set(rs.map((x) => x.game_id)).size;
      perTeam[t] = {
        pprPerGame: per(sum(rs, 'fantasy_points_ppr'), g, 1),
        yardsPerGame: per(sum(rs, (x) => (num(x.passing_yards) ?? 0) + (num(x.rushing_yards) ?? 0) + (num(x.receiving_yards) ?? 0)), g, 1),
        tdsPerGame: per(sum(rs, (x) => (num(x.passing_tds) ?? 0) + (num(x.rushing_tds) ?? 0) + (num(x.receiving_tds) ?? 0)), g, 2),
      };
    }
    for (const key of ['pprPerGame', 'yardsPerGame', 'tdsPerGame']) {
      const rank = ranker(Object.values(perTeam).map((x) => x[key]), true);
      for (const t of Object.keys(perTeam)) perTeam[t][key] = rank(perTeam[t][key]);
    }
    allowed[pos] = perTeam;
  }

  // ---- weekly lookups
  const weeklyBy = group(regWeekly, 'player_id');
  const ngsBy = { QB: group(ngsPass, 'player_gsis_id'), WR: group(ngsRec, 'player_gsis_id'), TE: group(ngsRec, 'player_gsis_id'), RB: group(ngsRush, 'player_gsis_id') };
  const ngsRecBy = group(ngsRec, 'player_gsis_id');
  const pfrKey = (x) => byPfr.get(x.pfr_player_id);
  const pfrPassBy = group(pfrPass, pfrKey);
  const pfrRecBy = group(pfrRec, pfrKey);
  const pfrRushBy = group(pfrRush, pfrKey);
  const snapsBy = group(snaps, (x) => byPfr.get(x.pfr_player_id));
  const injuriesBy = group(injuries, 'gsis_id');
  const latestDepth = new Map();
  for (const d of depthRows) {
    const cur = latestDepth.get(d.gsis_id);
    if (!cur || d.dt > cur.dt) latestDepth.set(d.gsis_id, d);
  }
  const draftBy = new Map(draft.filter((d) => d.gsis_id).map((d) => [d.gsis_id, d]));

  // ---- season splits from play-by-play, per player
  const split = (rows, kind) => {
    if (!rows.length) return null;
    const out = { plays: rows.length, epa: r(mean(rows, 'epa')), success: r(mean(rows, 'success')) };
    if (kind === 'pass') {
      const att = rows.filter((x) => x.pass_attempt === '1' && x.sack !== '1');
      out.att = att.length;
      out.cmpPct = per(att.filter((x) => x.complete_pass === '1').length * 100, att.length, 1);
      out.cpoe = r(mean(att, 'cpoe'), 1);
      out.td = rows.filter((x) => x.pass_touchdown === '1').length;
      out.int = rows.filter((x) => x.interception === '1').length;
      out.sacks = rows.filter((x) => x.sack === '1').length;
    }
    if (kind === 'target') {
      out.targets = rows.length;
      out.catchPct = per(rows.filter((x) => x.complete_pass === '1').length * 100, rows.length, 1);
      out.yards = sum(rows, 'receiving_yards');
      out.td = rows.filter((x) => x.pass_touchdown === '1').length;
    }
    if (kind === 'rush') {
      out.ypc = per(sum(rows, 'rushing_yards'), rows.length, 2);
      out.stuffPct = per(rows.filter((x) => num(x.yards_gained) <= 0).length * 100, rows.length, 1);
      out.explosivePct = per(rows.filter((x) => num(x.yards_gained) >= 10).length * 100, rows.length, 1);
      out.td = rows.filter((x) => x.rush_touchdown === '1').length;
    }
    return out;
  };
  const depthOf = (x) => {
    const a = num(x.air_yards);
    return a === null ? null : a < 0 ? 'behindLos' : a < 10 ? 'short0to9' : a < 20 ? 'intermediate10to19' : 'deep20plus';
  };
  const scoreState = (x) => {
    const d = num(x.score_differential);
    return d === null ? null : d <= -9 ? 'trailingBy9plus' : d >= 9 ? 'leadingBy9plus' : 'withinOneScore';
  };
  const ORDER = ['behindLos', 'short0to9', 'intermediate10to19', 'deep20plus', 'left', 'middle', 'right', 'trailingBy9plus', 'withinOneScore', 'leadingBy9plus'];
  const bucketed = (rows, f, kind) => {
    const out = {};
    const entries = [...group(rows, f)].filter(([k]) => k).sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || String(a).localeCompare(String(b)));
    for (const [k, rs] of entries) out[k] = split(rs, kind);
    return out;
  };

  function qbSplits(gsis) {
    const db = plays.filter((x) => x.passer_player_id === gsis || (x.rusher_player_id === gsis && x.qb_scramble === '1'));
    const pass = plays.filter((x) => x.passer_player_id === gsis && x.qb_dropback === '1');
    const att = pass.filter((x) => x.pass_attempt === '1' && x.sack !== '1');
    const designed = plays.filter((x) => x.rusher_player_id === gsis && x.qb_scramble !== '1');
    const third = pass.filter((x) => x.down === '3');
    return {
      dropbacks: db.length,
      byDepth: bucketed(att, depthOf, 'pass'),
      byDirection: bucketed(att, (x) => x.pass_location || null, 'pass'),
      thirdDown: third.length ? { ...split(third, 'pass'), conversionPct: per(third.filter((x) => x.first_down === '1' || x.touchdown === '1').length * 100, third.length, 1), avgToGo: r(mean(third, 'ydstogo'), 1) } : null,
      redZone: split(pass.filter((x) => num(x.yardline_100) <= 20), 'pass'),
      byScore: bucketed(pass, scoreState, 'pass'),
      fourthQuarterClose: split(pass.filter((x) => x.qtr === '4' && Math.abs(num(x.score_differential) ?? 99) <= 8), 'pass'),
      shotgun: split(pass.filter((x) => x.shotgun === '1'), 'pass'),
      underCenter: split(pass.filter((x) => x.shotgun === '0'), 'pass'),
      noHuddle: split(pass.filter((x) => x.no_huddle === '1'), 'pass'),
      hitOrSackedPct: per(pass.filter((x) => x.sack === '1' || x.qb_hit === '1').length * 100, pass.length, 1),
      scrambles: (() => {
        const sc = plays.filter((x) => x.rusher_player_id === gsis && x.qb_scramble === '1');
        return { count: sc.length, yards: sum(sc, 'rushing_yards'), perDropbackPct: per(sc.length * 100, db.length, 1), epaPerScramble: r(mean(sc, 'epa')), firstDowns: sc.filter((x) => x.first_down === '1' || x.touchdown === '1').length };
      })(),
      designedRuns: split(designed, 'rush'),
      turnoverWorthy: { ints: pass.filter((x) => x.interception === '1').length, fumbles: plays.filter((x) => x.fumbled_1_player_id === gsis).length },
      // where his passes go: target share by position of the receiver (top targets)
      topTargets: [...group(att.filter((x) => x.receiver_player_id), 'receiver_player_id')]
        .map(([id, rs]) => ({ name: bio.get(id)?.display_name ?? rs[0].receiver_player_name, pos: bio.get(id)?.position, targets: rs.length, epaPerTarget: r(mean(rs, 'epa')) }))
        .sort((a, b) => b.targets - a.targets)
        .slice(0, 5),
    };
  }

  function receiverSplits(gsis, team) {
    const tg = plays.filter((x) => x.receiver_player_id === gsis && x.pass_attempt === '1');
    const teamTg = plays.filter((x) => x.posteam === team && x.receiver_player_id && x.pass_attempt === '1');
    const rz = tg.filter((x) => num(x.yardline_100) <= 20);
    const teamRz = teamTg.filter((x) => num(x.yardline_100) <= 20);
    const third = tg.filter((x) => x.down === '3');
    const teamThird = teamTg.filter((x) => x.down === '3');
    const ez = tg.filter((x) => num(x.air_yards) !== null && num(x.air_yards) >= num(x.yardline_100));
    const caught = tg.filter((x) => x.complete_pass === '1' && num(x.xyac_mean_yardage) !== null);
    return {
      targets: tg.length,
      byDepth: bucketed(tg, depthOf, 'target'),
      byDirection: bucketed(tg, (x) => x.pass_location || null, 'target'),
      redZone: { targets: rz.length, shareOfTeam: per(rz.length * 100, teamRz.length, 1), td: rz.filter((x) => x.pass_touchdown === '1').length },
      endZoneTargets: ez.length,
      thirdDown: { targets: third.length, shareOfTeam: per(third.length * 100, teamThird.length, 1), firstDowns: third.filter((x) => x.first_down === '1' || x.touchdown === '1').length },
      yacOverExpectedPerCatch: per(sum(caught, (x) => num(x.yards_after_catch) - num(x.xyac_mean_yardage)), caught.length, 2),
      contestedProxy_catchPctOn15plusAir: per(tg.filter((x) => num(x.air_yards) >= 15 && x.complete_pass === '1').length * 100, tg.filter((x) => num(x.air_yards) >= 15).length, 1),
      byQuarterback: [...group(tg, 'passer_player_id')].map(([id, rs]) => ({ qb: bio.get(id)?.display_name ?? rs[0].passer_player_name, targets: rs.length, epaPerTarget: r(mean(rs, 'epa')) })),
    };
  }

  function rusherSplits(gsis, team) {
    const ru = plays.filter((x) => x.rusher_player_id === gsis && x.rush === '1' && x.qb_scramble !== '1');
    const teamRu = plays.filter((x) => x.posteam === team && x.rush === '1' && x.qb_scramble !== '1');
    const gl = ru.filter((x) => num(x.yardline_100) <= 5);
    const teamGl = teamRu.filter((x) => num(x.yardline_100) <= 5);
    return {
      carries: ru.length,
      shareOfTeamCarries: per(ru.length * 100, teamRu.length, 1),
      byDirection: bucketed(ru, (x) => (x.run_location === 'middle' ? 'middle' : x.run_gap ? `${x.run_location}-${x.run_gap}` : x.run_location || null), 'rush'),
      goalLine: { carries: gl.length, shareOfTeam: per(gl.length * 100, teamGl.length, 1), td: gl.filter((x) => x.rush_touchdown === '1').length },
      byDown: bucketed(ru, (x) => (x.down ? `down${x.down}` : null), 'rush'),
      byScore: bucketed(ru, scoreState, 'rush'),
      shortYardage: split(ru.filter((x) => num(x.ydstogo) <= 2 && (x.down === '3' || x.down === '4')), 'rush'),
      fumbles: plays.filter((x) => x.fumbled_1_player_id === gsis).length,
    };
  }

  // ---- season totals per player (weekly stats), for ranking among the position
  const seasonOf = (gsis) => {
    const rows = weeklyBy.get(gsis) ?? [];
    const s = (k) => sum(rows, k);
    const games = rows.length;
    const att = s('attempts');
    const db = att + s('sacks_suffered');
    return {
      games,
      // passing
      attempts: att,
      passYards: s('passing_yards'),
      passTds: s('passing_tds'),
      ints: s('passing_interceptions'),
      sacks: s('sacks_suffered'),
      cmpPct: per(s('completions') * 100, att, 1),
      ypa: per(s('passing_yards'), att, 2),
      anyPerDropback: per(s('passing_yards') + 20 * s('passing_tds') - 45 * s('passing_interceptions') - s('sack_yards_lost'), db, 2),
      passEpaPerDropback: per(s('passing_epa'), db, 3),
      cpoe: r(mean(rows.filter((x) => num(x.attempts) >= 5), 'passing_cpoe'), 2),
      sackPct: per(s('sacks_suffered') * 100, db, 1),
      intPct: per(s('passing_interceptions') * 100, att, 1),
      tdPct: per(s('passing_tds') * 100, att, 1),
      // rushing
      carries: s('carries'),
      rushYards: s('rushing_yards'),
      rushTds: s('rushing_tds'),
      ypc: per(s('rushing_yards'), s('carries'), 2),
      rushEpaPerCarry: per(s('rushing_epa'), s('carries'), 3),
      // receiving
      targets: s('targets'),
      receptions: s('receptions'),
      recYards: s('receiving_yards'),
      recTds: s('receiving_tds'),
      catchPct: per(s('receptions') * 100, s('targets'), 1),
      yardsPerTarget: per(s('receiving_yards'), s('targets'), 2),
      yardsPerRec: per(s('receiving_yards'), s('receptions'), 2),
      recEpaPerTarget: per(s('receiving_epa'), s('targets'), 3),
      targetShare: r(mean(rows, 'target_share'), 3),
      airYardsShare: r(mean(rows, 'air_yards_share'), 3),
      wopr: r(mean(rows, 'wopr'), 3),
      racr: per(s('receiving_yards'), s('receiving_air_yards'), 2),
      // both
      fumblesLost: s('rushing_fumbles_lost') + s('receiving_fumbles_lost') + s('sack_fumbles_lost'),
      pprPerGame: per(s('fantasy_points_ppr'), games, 1),
      yardsFromScrimmagePerGame: per(s('rushing_yards') + s('receiving_yards'), games, 1),
    };
  };
  const RANKED = {
    QB: { high: ['passYards', 'passTds', 'cmpPct', 'ypa', 'anyPerDropback', 'passEpaPerDropback', 'cpoe', 'tdPct', 'rushYards', 'pprPerGame'], low: ['ints', 'intPct', 'sackPct', 'fumblesLost'], qualify: (s) => s.attempts >= 12 * Math.max(1, s.games) * 0.8 },
    RB: { high: ['carries', 'rushYards', 'rushTds', 'ypc', 'rushEpaPerCarry', 'targets', 'recYards', 'yardsPerTarget', 'recEpaPerTarget', 'pprPerGame', 'yardsFromScrimmagePerGame'], low: ['fumblesLost'], qualify: (s) => s.carries >= 6 * s.games },
    WR: { high: ['targets', 'receptions', 'recYards', 'recTds', 'catchPct', 'yardsPerTarget', 'yardsPerRec', 'recEpaPerTarget', 'targetShare', 'airYardsShare', 'wopr', 'racr', 'pprPerGame'], low: ['fumblesLost'], qualify: (s) => s.targets >= 4 * s.games },
    TE: { high: ['targets', 'receptions', 'recYards', 'recTds', 'catchPct', 'yardsPerTarget', 'yardsPerRec', 'recEpaPerTarget', 'targetShare', 'airYardsShare', 'wopr', 'racr', 'pprPerGame'], low: ['fumblesLost'], qualify: (s) => s.targets >= 2.5 * s.games },
  };
  const seasonRanked = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const ids = [...new Set(regWeekly.filter((x) => x.position === pos).map((x) => x.player_id))];
    const all = ids.map((id) => [id, seasonOf(id)]);
    const qualified = all.filter(([, s]) => RANKED[pos].qualify(s));
    const rankers = {};
    for (const k of RANKED[pos].high) rankers[k] = ranker(qualified.map(([, s]) => s[k]), false);
    for (const k of RANKED[pos].low) rankers[k] = ranker(qualified.map(([, s]) => s[k]), true);
    seasonRanked[pos] = { rankers, qualifiers: qualified.length, qualified: new Set(qualified.map(([id]) => id)) };
  }

  // ---- the site's archives: each past season's line, ranked within that season's list
  const CAREER_KEYS = {
    QB: { high: ['passYards', 'passTds', 'compPct', 'ypa', 'rating', 'epaPerPlay', 'successRate', 'cpoe', 'winPct', 'rushYards'], low: ['ints', 'pressureToSack', 'badThrowPct'], keep: ['wins', 'losses', 'timeToThrow', 'adot', 'aggressiveness'] },
    RB: { high: ['carries', 'rushYards', 'rushTds', 'ypc', 'epaPerCarry', 'ryoePerAtt', 'yacoPerCarry', 'targets', 'recYards', 'epaPerTarget', 'totalTds', 'snapShare'], low: ['fumbles'], keep: ['brokenTackles'] },
    WR: { high: ['targets', 'receptions', 'recYards', 'recTds', 'catchPct', 'epaPerTarget', 'targetShare', 'airYardsShare', 'separation', 'yacOverExp', 'snapShare'], low: ['dropPct'], keep: ['adot'] },
    TE: { high: ['targets', 'receptions', 'recYards', 'recTds', 'catchPct', 'epaPerTarget', 'targetShare', 'separation', 'yacOverExp', 'snapShare', 'runBlockEpa'], low: ['dropPct'], keep: ['adot'] },
  };
  const careers = new Map();
  const seasonsDir = path.join(DATA, 'seasons');
  for (const y of readdirSync(seasonsDir).map(Number).sort()) {
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const f = path.join(seasonsDir, String(y), 'units', `${pos}.json`);
      if (!existsSync(f)) continue;
      const rows = JSON.parse(readFileSync(f, 'utf8'));
      const keys = CAREER_KEYS[pos];
      const rk = {};
      for (const k of keys.high) rk[k] = ranker(rows.map((x) => x.stats?.[k] ?? null), false);
      for (const k of keys.low) rk[k] = ranker(rows.map((x) => x.stats?.[k] ?? null), true);
      for (const row of rows) {
        const id = pos === 'QB' ? byEspn.get(String(row.id)) : row.gsisId;
        if (!id) continue;
        const line = { season: y, pos, team: row.teamLogo?.match(/NFL_Icons\/(.+)\.png/)?.[1], games: row.games };
        for (const k of [...keys.high, ...keys.low]) line[k] = rk[k](row.stats?.[k] ?? null);
        for (const k of keys.keep) if (row.stats?.[k] !== undefined) line[k] = row.stats[k];
        if (row.awards?.length) line.awards = row.awards;
        if (!careers.has(id)) careers.set(id, []);
        careers.get(id).push(line);
      }
    }
  }

  // A team's injury report (ESPN's), most-used first: each player's snap share this season so the model
  // can tell a starter from a backup; offense only when it's the player's own team (that's what moves him)
  const OFFENSE = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'T', 'G', 'C', 'OL']);
  const usage = (gsis) => {
    const rows = snapsBy.get(gsis) ?? [];
    if (!rows.length) return null;
    const off = mean(rows, (x) => num(x.offense_pct) * 100);
    const def = mean(rows, (x) => num(x.defense_pct) * 100);
    return { snapPct: Math.round(Math.max(off ?? 0, def ?? 0)), games: rows.length };
  };
  const injuryList = (team, self, offenseOnly, limit) =>
    (injuryReport.get(team) ?? [])
      .map((i) => ({ ...i, gsis: byEspn.get(String(i.espnId)) }))
      .filter((i) => i.gsis !== self && (!offenseOnly || OFFENSE.has(i.pos)))
      .map(({ espnId: _e, gsis, news, ...i }) => ({ ...i, ...(usage(gsis) ?? { snapPct: null, games: 0 }), news: news && news.length > 260 ? `${news.slice(0, 257)}...` : news }))
      .sort((a, b) => (b.snapPct ?? -1) - (a.snapPct ?? -1))
      .slice(0, limit);

  // QBs under pressure this season (PFR charting): how often pressured and blitzed, how often pressure
  // became a sack, bad-throw rate; pressure-to-sack ranked among QBs with 50+ attempts (1 = fewest sacks)
  const pressureOf = (gsis) => {
    const rows = pfrPassBy.get(gsis) ?? [];
    const att = sum(weeklyBy.get(gsis) ?? [], 'attempts');
    if (!rows.length) return null;
    const pressured = sum(rows, 'times_pressured');
    const dropbacks = att + sum(rows, 'times_sacked');
    return {
      pressuredPct: per(pressured * 100, dropbacks, 1),
      pressureToSackPct: per(sum(rows, 'times_sacked') * 100, pressured, 1),
      blitzedPct: per(sum(rows, 'times_blitzed') * 100, dropbacks, 1),
      badThrowPct: per(sum(rows, 'passing_bad_throws') * 100, att, 1),
      att,
    };
  };
  const qbPressure = new Map([...pfrPassBy.keys()].filter(Boolean).map((id) => [id, pressureOf(id)]));
  const qualifiedPressure = [...qbPressure.values()].filter((x) => x && x.att >= 50);
  const pressureRank = {
    pressureToSackPct: ranker(qualifiedPressure.map((x) => x.pressureToSackPct), true),
    pressuredPct: ranker(qualifiedPressure.map((x) => x.pressuredPct), true),
    badThrowPct: ranker(qualifiedPressure.map((x) => x.badThrowPct), true),
  };

  // ---- the dossiers
  const filters = process.argv.slice(2).map((x) => x.toLowerCase());
  let written = 0;
  for (const p of list) {
    const b = bio.get(p.gsis);
    const name = b?.display_name ?? p.site.name;
    if (filters.length && !filters.some((f) => name.toLowerCase().includes(f))) continue;
    const weeks = (weeklyBy.get(p.gsis) ?? []).sort((a, b) => Number(a.week) - Number(b.week));
    const team = weeks.at(-1)?.team || LOGO_TEAM[p.site.teamLogo?.match(/NFL_Icons\/(.+)\.png/)?.[1]] || b?.latest_team;
    const season = seasonOf(p.gsis);
    const ranks = seasonRanked[p.pos];
    const ranked = {};
    for (const [k, rank] of Object.entries(ranks.rankers)) ranked[k] = rank(season[k]);

    // the game log: his line, the advanced numbers, the game's context
    const ngs = ngsBy[p.pos].get(p.gsis) ?? [];
    const pfrP = pfrPassBy.get(p.gsis) ?? [];
    const pfrR = pfrRecBy.get(p.gsis) ?? [];
    const pfrU = pfrRushBy.get(p.gsis) ?? [];
    const snp = snapsBy.get(p.gsis) ?? [];
    const gameLog = weeks.map((w) => {
      const g = gameById.get(w.game_id);
      const ctx = g ? side(g, w.team) : { week: Number(w.week), opp: w.opponent_team };
      const wk = (rows) => rows.find((x) => x.week === w.week);
      const line = {};
      const put = (k, v) => {
        if (v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) line[k] = v;
      };
      if (p.pos === 'QB') {
        put('cmpAtt', `${w.completions}/${w.attempts}`);
        put('passYds', num(w.passing_yards));
        put('passTd', num(w.passing_tds));
        put('int', num(w.passing_interceptions));
        put('sacks', num(w.sacks_suffered));
        put('passEpa', r(num(w.passing_epa), 1));
        put('cpoe', r(num(w.passing_cpoe), 1));
        const n = wk(ngs);
        put('timeToThrow', num(n?.avg_time_to_throw) && r(num(n.avg_time_to_throw), 2));
        put('aggressivenessPct', num(n?.aggressiveness) && r(num(n.aggressiveness), 1));
        put('intendedAirYds', num(n?.avg_intended_air_yards) && r(num(n.avg_intended_air_yards), 1));
        const f = wk(pfrP);
        put('pressuredPct', num(f?.times_pressured_pct) !== null && f ? r(num(f.times_pressured_pct) * 100, 1) : null);
        put('blitzed', num(f?.times_blitzed));
        put('badThrowPct', num(f?.passing_bad_throw_pct) !== null && f ? r(num(f.passing_bad_throw_pct) * 100, 1) : null);
      }
      if (p.pos === 'QB' || p.pos === 'RB' || num(w.carries) > 0) {
        if (num(w.carries) > 0) {
          put('car', num(w.carries));
          put('rushYds', num(w.rushing_yards));
          put('rushTd', num(w.rushing_tds));
          put('rushEpa', r(num(w.rushing_epa), 1));
        }
      }
      if (p.pos !== 'QB') {
        put('tgt', num(w.targets));
        put('rec', num(w.receptions));
        put('recYds', num(w.receiving_yards));
        put('recTd', num(w.receiving_tds));
        put('recEpa', r(num(w.receiving_epa), 1));
        put('targetSharePct', num(w.target_share) !== null ? r(num(w.target_share) * 100, 1) : null);
        put('airYardsSharePct', num(w.air_yards_share) !== null ? r(num(w.air_yards_share) * 100, 1) : null);
        if (p.pos === 'RB') {
          const n = wk(ngs);
          put('ryoe', num(n?.rush_yards_over_expected));
          put('eightManBoxPct', num(n?.percent_attempts_gte_eight_defenders) && r(num(n.percent_attempts_gte_eight_defenders), 1));
          const f = wk(pfrU);
          put('yardsAfterContactAvg', num(f?.rushing_yards_after_contact_avg));
          put('brokenTackles', num(f?.rushing_broken_tackles));
        } else {
          const n = wk(ngsRecBy.get(p.gsis) ?? []);
          put('separation', num(n?.avg_separation) && r(num(n.avg_separation), 2));
          put('cushion', num(n?.avg_cushion) && r(num(n.avg_cushion), 2));
          put('yacAboveExp', num(n?.avg_yac_above_expectation) !== null && n ? r(num(n.avg_yac_above_expectation), 2) : null);
          const f = wk(pfrR);
          put('drops', num(f?.receiving_drop));
        }
      }
      put('fumblesLost', (num(w.rushing_fumbles_lost) ?? 0) + (num(w.receiving_fumbles_lost) ?? 0) + (num(w.sack_fumbles_lost) ?? 0) || null);
      put('pprPts', r(num(w.fantasy_points_ppr), 1));
      const s = wk(snp);
      put('snapPct', s ? r(num(s.offense_pct) * 100, 0) : null);
      return { ...ctx, oppDefRankNow: teamCtx[ctx.opp]?.defEpa?.[1] ?? null, line };
    });

    // season-level tracking numbers (NGS season rows are week 0, so average the weeks by attempts)
    const ngsSeason = (() => {
      if (!ngs.length) return null;
      const w = (k, weight) => r(sum(ngs, (x) => num(x[k]) * num(x[weight])) / sum(ngs, weight), 2);
      if (p.pos === 'QB') return { timeToThrow: w('avg_time_to_throw', 'attempts'), aggressivenessPct: w('aggressiveness', 'attempts'), intendedAirYds: w('avg_intended_air_yards', 'attempts'), airYdsToSticks: w('avg_air_yards_to_sticks', 'attempts'), cpoe: w('completion_percentage_above_expectation', 'attempts') };
      if (p.pos === 'RB') return { ryoePerAtt: per(sum(ngs, 'rush_yards_over_expected'), sum(ngs, 'rush_attempts'), 2), eightManBoxPct: w('percent_attempts_gte_eight_defenders', 'rush_attempts'), timeToLos: w('avg_time_to_los', 'rush_attempts'), efficiency: w('efficiency', 'rush_attempts') };
      return { separation: w('avg_separation', 'targets'), cushion: w('avg_cushion', 'targets'), intendedAirYds: w('avg_intended_air_yards', 'targets'), yacAboveExp: w('avg_yac_above_expectation', 'receptions') };
    })();

    const inj = (injuriesBy.get(p.gsis) ?? []).sort((a, b) => Number(b.week) - Number(a.week))[0];
    const dc = latestDepth.get(p.gsis);
    const dr = draftBy.get(p.gsis);
    const age = b?.birth_date ? r((Date.now() - Date.parse(b.birth_date)) / (365.25 * 864e5), 1) : null;
    const next = team ? nextGame(team) : null;

    const dossier = {
      player: {
        name,
        position: p.pos,
        team: team ? `${TEAMS[team]} (${team})` : null,
        age,
        heightIn: num(b?.height),
        weightLb: num(b?.weight),
        yearsExp: num(b?.years_of_experience),
        rookieSeason: num(b?.rookie_season),
        college: b?.college_name || dr?.college || null,
        draft: dr ? `${dr.season} round ${dr.round}, pick ${dr.pick} (${dr.team})` : b?.draft_year ? `${b.draft_year} round ${b.draft_round}, pick ${b.draft_pick}` : 'undrafted',
        depthChart: dc ? `${dc.pos_abb}${dc.pos_rank} (as of ${dc.dt.slice(0, 10)})` : null,
        injury: (() => {
          const espn = (injuryReport.get(team) ?? []).find((i) => byEspn.get(String(i.espnId)) === p.gsis);
          const report = inj ? { week: Number(inj.week), gameStatus: inj.report_status || null, practice: inj.practice_status || null } : null;
          if (!espn && !report) return null;
          const { espnId: _e, ...e } = espn ?? {};
          return { ...(espn ? e : {}), ...(report ? { practiceReport: report } : {}) };
        })(),
        siteInjuryStatus: p.site.injuryStatus ?? null,
      },
      season: {
        year: SEASON,
        qualified: ranks.qualified.has(p.gsis),
        qualifiersAtPosition: ranks.qualifiers,
        totals: Object.fromEntries(Object.entries(season).filter(([, v]) => v !== null && v !== 0)),
        ranked: Object.fromEntries(Object.entries(ranked).filter(([, v]) => v)),
        tracking: ngsSeason,
        ...(p.pos === 'QB' && qbPressure.get(p.gsis)
          ? (() => {
              const q = qbPressure.get(p.gsis);
              return { pressure: { pressuredPct: pressureRank.pressuredPct(q.pressuredPct), pressureToSackPct: pressureRank.pressureToSackPct(q.pressureToSackPct), blitzedPct: q.blitzedPct, badThrowPct: pressureRank.badThrowPct(q.badThrowPct) } };
            })()
          : {}),
        ...(p.pos === 'QB' && p.site.box ? { record: `${p.site.wins}-${p.site.losses}${p.site.ties ? `-${p.site.ties}` : ''}` } : {}),
      },
      splits: p.pos === 'QB' ? qbSplits(p.gsis) : p.pos === 'RB' ? { rushing: rusherSplits(p.gsis, team), receiving: receiverSplits(p.gsis, team) } : receiverSplits(p.gsis, team),
      gameLog,
      team: team ? { injuries: injuryList(team, p.gsis, true, 10), qbStarts: qbStarts(team), ...teamCtx[team], headCoach: (() => { const g = games.filter((x) => x.home === team || x.away === team).sort((a, b) => b.date.localeCompare(a.date)).find((x) => x.homeScore !== null); return g ? (g.home === team ? g.homeCoach : g.awayCoach) : null; })() } : null,
      career: (careers.get(p.gsis) ?? []).filter((c) => c.season < SEASON),
      nextGame: next
        ? {
            ...next,
            line: (() => {
              const l = lines.get(next.at === 'home' ? `${next.opp}@${team}` : `${team}@${next.opp}`);
              return l ? { line: l.line, overUnder: l.overUnder, hisTeamMoneyline: next.at === 'home' ? l.homeMoneyline : l.awayMoneyline, book: l.book } : null;
            })(),
            oppInjuries: injuryList(next.opp, null, false, 12),
            oppDefense: teamCtx[next.opp],
            oppAllowsToPosition: allowed[p.pos][next.opp] ?? null,
          }
        : null,
    };
    writeFileSync(path.join(OUT, `${p.gsis}.json`), JSON.stringify(dossier));
    written++;
  }
  writeFileSync(path.join(ROOT, '.cache/analysis/index.json'), JSON.stringify(list.map((p) => ({ gsis: p.gsis, pos: p.pos, siteId: p.siteId, name: bio.get(p.gsis)?.display_name ?? p.site.name }))));
  console.log(`${written} dossiers (${list.length} players listed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
