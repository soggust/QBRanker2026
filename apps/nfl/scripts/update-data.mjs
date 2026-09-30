// Rebuilds src/StaticData/games.json from ESPN box scores.
//
// For every completed regular-season game, the QB with the most pass attempts
// on each team is treated as that team's starter. Each starter gets a record,
// last-five results, team, and an injury flag from ESPN's injury report. Advanced
// stats (EPA/play, CPOE, success rate) are aggregated from nflverse play-by-play.
// Hand-set per-QB scores live in subjective.json (new QBs are added with a starter
// responsibility score) and team grades in team-grades.json.
//
// RB/WR/TE/K/P lists and season stats come from nflverse player stats; team defenses
// and head coaches come from nflverse play-by-play and schedules (coach names from
// ESPN). All are written to skill-players.json.
//
// Usage: npm run update-data              (the current season, 2026)
//        SEASON=2025 npm run update-data  (a past season, written to src/StaticData/seasons/2025/;
//                                          run once, since a finished season doesn't change)
//        OUT_DIR=some/folder              (write somewhere else, e.g. for a dry run)
//
// A past season has no injury report (its injury flags are the players who finished it on injured
// reserve, from the rosters) and no hand-set preseason grades (a full season of stats
// outweighs them completely), and it fails outright if nflverse can't be loaded, rather than keeping
// previous values.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const CURRENT_SEASON = 2026;
const SEASON = Number(process.env.SEASON ?? CURRENT_SEASON);
const PAST_SEASON = SEASON < CURRENT_SEASON;
const WEEKS = 18;
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const DATA_DIR = process.env.OUT_DIR
  ? pathToFileURL(process.env.OUT_DIR.replace(/[\/]?$/, '/'))
  : new URL(PAST_SEASON ? `../src/StaticData/seasons/${SEASON}/` : '../src/StaticData/', import.meta.url);
const TEAM_GRADES_FILE = new URL('team-grades.json', DATA_DIR);
const GAMES_FILE = new URL('games.json', DATA_DIR);
const SUBJECTIVE_FILE = new URL('subjective.json', DATA_DIR);
const SKILL_FILE = new URL('skill-players.json', DATA_DIR);
const DATA_GRADES_FILE = new URL('data-grades.json', DATA_DIR);
const DEFAULT_SCORE = 6;
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

async function getJson(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i >= attempts) throw new Error(`Failed to fetch ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// Map in small batches so we don't hammer ESPN
async function mapBatched(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

// "Tampa Bay Buccaneers" -> "assets/NFL_Icons/Bucs.png". Washington's earlier names (the
// Redskins through 2019, the Football Team in 2020-21, or just "Washington") use today's Commanders logo.
const MASCOT_ICONS = { Buccaneers: 'Bucs', Redskins: 'Commanders', Team: 'Commanders', Washington: 'Commanders' };
function teamLogo(teamName) {
  const mascot = teamName.split(' ').pop();
  return `assets/NFL_Icons/${MASCOT_ICONS[mascot] ?? mascot}.png`;
}

// Minimal CSV parser (handles quoted fields), returns an array of row objects
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((key, i) => [key, r[i]])));
}

async function getCsvGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return parseCsv(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
}

const mean = (values) =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : null;

const num = (v) => (v === undefined || v === '' || v === 'NA' ? null : Number(v));

async function getCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return parseCsv(await res.text());
}

// Secondary data sets (Next Gen Stats, Pro Football Reference advanced stats, snap counts) are
// optional: if one is missing or late, its stats show as "-" instead of failing the update
async function optionalCsvGz(url) {
  try {
    return await getCsvGz(url);
  } catch (err) {
    console.warn(`Skipping ${url.split('/').pop()}: ${err.message}`);
    return [];
  }
}

// Sum numeric fields over rows, grouped by a key
function totalsBy(rows, keyOf, fields) {
  const totals = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || key === 'NA') continue;
    const total = totals.get(key) ?? { games: 0 };
    total.games++;
    for (const field of fields) total[field] = (total[field] ?? 0) + (num(row[field]) ?? 0);
    totals.set(key, total);
  }
  return totals;
}

// Pro Football Reference's weekly advanced stats only go back to 2024. Earlier seasons come from its
// season totals (one row per player, back to 2018), renamed to the weekly files' columns so the rest
// of the script reads them the same way. The season passing file has no sacks, so each QB's are
// counted from the play-by-play. Players who changed teams mid-season are listed as "2TM" and left out
// of the team totals.
const PFR_SEASON_COLUMNS = {
  pass: { pfr_player_id: 'pfr_id', team: 'team', times_pressured: 'times_pressured', passing_bad_throws: 'bad_throws', passing_drops: 'drops' },
  rush: {
    pfr_player_id: 'pfr_id', team: 'tm', carries: 'att', rushing_yards_before_contact: 'ybc',
    rushing_yards_after_contact: 'yac', rushing_broken_tackles: 'brk_tkl',
  },
  rec: { pfr_player_id: 'pfr_id', team: 'tm', receiving_drop: 'drop', receiving_broken_tackles: 'brk_tkl' },
  def: { pfr_player_id: 'pfr_id', team: 'tm', def_pressures: 'prss', def_missed_tackles: 'm_tkl', def_tackles_combined: 'comb' },
};

async function pfrSeasonRows(type, sacksByPfr) {
  const rows = await optionalCsvGz(`${NFLVERSE}/pfr_advstats/advstats_season_${type}.csv.gz`);
  return rows
    .filter((row) => row.season === String(SEASON))
    .map((row) => {
      const out = { game_type: 'REG' };
      for (const [weekly, season] of Object.entries(PFR_SEASON_COLUMNS[type])) out[weekly] = row[season];
      if (out.team === 'LAR') out.team = 'LA';
      if (type === 'pass') out.times_sacked = String(sacksByPfr.get(out.pfr_player_id) ?? 0);
      return out;
    });
}

async function loadNflverse() {
  let [players, pbp, playerStats, schedule, ngsPass, ngsRush, ngsRec, pfrPass, pfrRush, pfrRec, pfrDef, snaps] =
    await Promise.all([
      getCsvGz(`${NFLVERSE}/players/players.csv.gz`),
      getCsvGz(`${NFLVERSE}/pbp/play_by_play_${SEASON}.csv.gz`),
      getCsvGz(`${NFLVERSE}/stats_player/stats_player_reg_${SEASON}.csv.gz`),
      getCsv(SCHEDULE_URL),
      ...['passing', 'rushing', 'receiving'].map((type) =>
        optionalCsvGz(`${NFLVERSE}/nextgen_stats/ngs_${type}.csv.gz`)
      ),
      ...['pass', 'rush', 'rec', 'def'].map((type) =>
        optionalCsvGz(`${NFLVERSE}/pfr_advstats/advstats_week_${type}_${SEASON}.csv.gz`)
      ),
      optionalCsvGz(`${NFLVERSE}/snap_counts/snap_counts_${SEASON}.csv.gz`),
    ]);
  if (!pfrPass.length) {
    const pfrByGsis = new Map(players.filter((p) => p.pfr_id && p.pfr_id !== 'NA').map((p) => [p.gsis_id, p.pfr_id]));
    const sacksByPfr = new Map();
    for (const play of pbp) {
      if (play.season_type !== 'REG' || play.sack !== '1') continue;
      const pfrId = pfrByGsis.get(play.passer_player_id);
      if (pfrId) sacksByPfr.set(pfrId, (sacksByPfr.get(pfrId) ?? 0) + 1);
    }
    [pfrPass, pfrRush, pfrRec, pfrDef] = await Promise.all(
      ['pass', 'rush', 'rec', 'def'].map((type) => pfrSeasonRows(type, sacksByPfr)),
    );
    console.log(`Pro Football Reference: season totals (no weekly files for ${SEASON})`);
  }
  for (const rows of [pbp, playerStats, schedule, pfrPass, pfrRush, pfrRec, pfrDef, snaps]) sameTeamAbbrs(rows);
  const espnIds = players.filter((p) => p.espn_id && p.espn_id !== 'NA');

  // Next Gen Stats: week 0 rows are regular-season totals
  const ngsSeason = (rows) =>
    new Map(
      rows
        .filter((r) => r.season === String(SEASON) && r.season_type === 'REG' && r.week === '0')
        .map((r) => [r.player_gsis_id, r])
    );
  const regular = (rows) => rows.filter((r) => r.game_type === 'REG');

  // Average offensive snap share over the games a player was on the field
  const snapShare = new Map();
  for (const [id, t] of totalsBy(
    regular(snaps).filter((r) => (num(r.offense_snaps) ?? 0) > 0),
    (r) => r.pfr_player_id,
    ['offense_pct']
  )) {
    snapShare.set(id, round(t.offense_pct / t.games, 3));
  }

  return {
    pbp: pbp.filter((play) => play.season_type === 'REG'),
    playerStats,
    pfrByGsis: new Map(players.filter((p) => p.pfr_id && p.pfr_id !== 'NA').map((p) => [p.gsis_id, p.pfr_id])),
    ngs: { pass: ngsSeason(ngsPass), rush: ngsSeason(ngsRush), rec: ngsSeason(ngsRec) },
    pfr: {
      pass: totalsBy(regular(pfrPass), (r) => r.pfr_player_id, ['times_sacked', 'times_pressured', 'passing_bad_throws']),
      rush: totalsBy(regular(pfrRush), (r) => r.pfr_player_id, ['rushing_yards_after_contact', 'rushing_broken_tackles']),
      rec: totalsBy(regular(pfrRec), (r) => r.pfr_player_id, ['receiving_drop', 'receiving_broken_tackles']),
      def: totalsBy(regular(pfrDef), (r) => r.team, ['def_pressures', 'def_missed_tackles', 'def_tackles_combined']),
      // Offense team totals, for the O-line and weapons grades
      passTeam: totalsBy(regular(pfrPass), (r) => r.team, ['times_pressured', 'passing_drops']),
      rushTeam: totalsBy(regular(pfrRush), (r) => r.team, ['carries', 'rushing_yards_before_contact', 'rushing_broken_tackles']),
      recTeam: totalsBy(regular(pfrRec), (r) => r.team, ['receiving_broken_tackles']),
    },
    snapShare,
    // Everyone who was a head coach in an earlier season (a coach not in here is in his first year)
    pastCoaches: new Set(
      schedule.filter((game) => Number(game.season) < SEASON).flatMap((game) => [game.home_coach, game.away_coach])
    ),
    // Completed regular-season games, with coaches, scores and betting lines
    games: schedule.filter(
      (game) => game.season === String(SEASON) && game.game_type === 'REG' && num(game.result) !== null
    ),
    gsisByEspn: new Map(espnIds.map((p) => [Number(p.espn_id), p.gsis_id])),
    espnByGsis: new Map(espnIds.map((p) => [p.gsis_id, Number(p.espn_id)])),
  };
}

// EPA/play and success rate cover the QB's dropbacks and runs; CPOE covers pass attempts.
// Fantasy points are nflverse standard scoring; half/full PPR add 0.5/1 per reception in the app.
// Returns a Map of ESPN id -> { epaPerPlay, cpoe, successRate, plays, fantasyStd, receptions }
// Also pressure-to-sack rate and bad-throw rate (Pro Football Reference via nflverse), and
// time to throw, aDOT and aggressiveness (Next Gen Stats)
// A QB's games played, for per-game stats, the 17-game pace and Min Games: his starts, plus any
// relief appearance with real snaps (at least this many dropbacks and runs). ESPN counts a
// five-snap cameo as a full game, which would halve a one-start QB's per-game numbers.
const QB_GAME_PLAYS = 10;

function advancedStats(espnIds, { pbp, playerStats, gsisByEspn, pfrByGsis, ngs, pfr }) {
  const plays = pbp.filter((play) => play.season_type === 'REG' && (play.pass === '1' || play.rush === '1'));
  const seasonRows = new Map(playerStats.map((row) => [row.player_id, row]));

  const stats = new Map();
  for (const espnId of espnIds) {
    const gsisId = gsisByEspn.get(espnId);
    if (!gsisId) continue;
    const own = plays.filter((play) => play.id === gsisId && num(play.qb_epa) !== null);
    const cpoe = plays.filter((play) => play.passer_player_id === gsisId).map((play) => num(play.cpoe));
    const pressure = pfr.pass.get(pfrByGsis.get(gsisId));
    const tracking = ngs.pass.get(gsisId);
    const attempts = num(seasonRows.get(gsisId)?.attempts) ?? 0;
    stats.set(espnId, {
      pressureToSack: pressure?.times_pressured ? ratio(pressure.times_sacked, pressure.times_pressured) : null,
      badThrowPct: pressure && attempts ? ratio(pressure.passing_bad_throws, attempts) : null,
      timeToThrow: tracking ? round(num(tracking.avg_time_to_throw), 2) : null,
      adot: tracking ? round(num(tracking.avg_intended_air_yards), 1) : null,
      aggressiveness: tracking ? round(num(tracking.aggressiveness), 1) : null,
      epaPerPlay: mean(own.map((play) => num(play.qb_epa))),
      cpoe: mean(cpoe.filter((v) => v !== null)),
      successRate: mean(own.map((play) => num(play.success)).filter((v) => v !== null)),
      plays: own.length,
      // Games he really played QB in: at least QB_GAME_PLAYS dropbacks and runs (see qbGamesPlayed)
      realGames: new Set(
        [...Map.groupBy(own, (play) => play.game_id)].filter(([, list]) => list.length >= QB_GAME_PLAYS).map(([id]) => id)
      ).size,
      fantasyStd: round(num(seasonRows.get(gsisId)?.fantasy_points) ?? 0, 2),
      receptions: num(seasonRows.get(gsisId)?.receptions) ?? 0,
    });
  }
  return stats;
}

// nflverse team abbreviations -> logo file names in src/assets/NFL_Icons
const TEAM_ICONS = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears',
  CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs', LA: 'Rams', LAC: 'Chargers',
  LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Bucs',
  TEN: 'Titans', WAS: 'Commanders',
};

// Earlier seasons' abbreviations for teams that moved, as today's (see sameTeamAbbrs)
const MOVED_TEAMS = { OAK: 'LV', SD: 'LAC', STL: 'LA' };

// Rewrite moved teams' old abbreviations in every team column (posteam, defteam, recent_team...),
// so older seasons line up with today's 32 teams
function sameTeamAbbrs(rows) {
  const keys = Object.keys(rows[0] ?? {}).filter((key) => key.includes('team'));
  for (const row of rows) {
    for (const key of keys) {
      const now = MOVED_TEAMS[row[key]];
      if (now) row[key] = now;
    }
  }
  return rows;
}

// Missing values (null) pass through as null
const round = (value, digits) =>
  value === null || value === undefined || Number.isNaN(value) ? null : Number(value.toFixed(digits));
const ratio = (a, b, digits = 3) => (b ? round(a / b, digits) : 0);
const ngsValue = (row, key, digits = 2) => (row ? round(num(row[key]), digits) : null);

// RB/WR/TE season totals plus derived rates, tracking stats (Next Gen Stats), contact and drop
// stats (Pro Football Reference via nflverse) and snap share
// Some seasons' player stats leave targets out (2003-2008) and air yards / YAC out (before 2006).
// ctx.receiving (from receivingFromPbp) fills targets and target share in from the play-by-play when
// it names the receiver on incompletions too; otherwise targets can't be known, and the target stats
// (targets, share, catch %, EPA / target) are null (hidden) rather than 0, like air yards and YAC
function offenseStats(n, ctx) {
  const rec = ctx.receiving;
  const targets = rec.hasTargets ? n('targets') : rec.pbpHasTargets ? rec.targets : null;
  const stats = {
    carries: n('carries'),
    rushYards: n('rushing_yards'),
    rushTds: n('rushing_tds'),
    targets,
    receptions: n('receptions'),
    recYards: n('receiving_yards'),
    recTds: n('receiving_tds'),
    yac: rec.hasYac ? n('receiving_yards_after_catch') : null,
    firstDowns: n('rushing_first_downs') + n('receiving_first_downs'),
    fumbles: n('rushing_fumbles_lost') + n('receiving_fumbles_lost'),
    targetShare: rec.hasTargets
      ? round(n('target_share'), 3)
      : targets !== null && rec.teamTargets
        ? round(targets / rec.teamTargets, 3)
        : null,
    fantasyStd: round(n('fantasy_points'), 2),
  };
  return {
    ...stats,
    ypc: ratio(stats.rushYards, stats.carries, 2),
    totalTds: stats.rushTds + stats.recTds,
    catchPct: stats.targets === null ? null : ratio(stats.receptions, stats.targets),
    epaPerCarry: ratio(n('rushing_epa'), stats.carries),
    epaPerTarget: stats.targets === null ? null : ratio(n('receiving_epa'), stats.targets),
    ryoePerAtt: ngsValue(ctx.ngsRush, 'rush_yards_over_expected_per_att'),
    yacoPerCarry:
      ctx.pfrRush && stats.carries ? ratio(ctx.pfrRush.rushing_yards_after_contact, stats.carries, 2) : null,
    brokenTackles:
      ctx.pfrRush || ctx.pfrRec
        ? (ctx.pfrRush?.rushing_broken_tackles ?? 0) + (ctx.pfrRec?.receiving_broken_tackles ?? 0)
        : null,
    snapShare: ctx.snapShare ?? null,
    separation: ngsValue(ctx.ngsRec, 'avg_separation', 1),
    yacOverExp: ngsValue(ctx.ngsRec, 'avg_yac_above_expectation', 1),
    adot: ngsValue(ctx.ngsRec, 'avg_intended_air_yards', 1),
    airYardsShare: rec.hasAirYards ? round(n('air_yards_share'), 3) : null,
    dropPct: ctx.pfrRec && stats.targets ? ratio(ctx.pfrRec.receiving_drop, stats.targets) : null,
    // Charted drops (Pro Football Reference); null (scored as average) with no targets yet, or when
    // PFR has no receiving line for the player
    drops: ctx.pfrRec && stats.targets ? ctx.pfrRec.receiving_drop : null,
    // Run Block EPA: filled in for finished seasons by build-blocking.mjs (who was on the field each play
    // isn't published until a season is over), so it stays empty (and its column hidden) until then
    runBlockEpa: null,
    // Pass Pro (RBs): same, from build-blocking.mjs
    passProPct: null,
  };
}

// nflverse fantasy points leave out kicking, so kickers use standard scoring:
// FG 0-39 = 3, 40-49 = 4, 50+ = 5, XP = 1, missed FG or XP = -1
// FG % over expected: makes minus nflverse's make probability, per attempt, in percentage points
function kickerStats(n, ctx) {
  const fgMade = n('fg_made');
  const fgAtt = n('fg_att');
  const patMade = n('pat_made');
  const patAtt = n('pat_att');
  const fg50 = n('fg_made_50_59') + n('fg_made_60_');
  const fgUnder40 = n('fg_made_0_19') + n('fg_made_20_29') + n('fg_made_30_39');
  return {
    fgMade,
    fgAtt,
    patAtt,
    fgPct: ratio(fgMade, fgAtt),
    fg50,
    fgLong: n('fg_long'),
    patPct: ratio(patMade, patAtt),
    epaPerKick: ctx.epa,
    fgOverExp: ctx.fgOverExp ?? null,
    fantasyStd: fgUnder40 * 3 + n('fg_made_40_49') * 4 + fg50 * 5 + patMade - (fgAtt - fgMade) - (patAtt - patMade),
    receptions: 0,
  };
}

function punterStats(n, ctx) {
  const punts = n('pt_att');
  return {
    punts,
    grossAvg: ratio(n('pt_yards'), punts, 1),
    netAvg: ratio(n('pt_net_yards'), punts, 1),
    inside20: n('pt_inside_20'),
    inside20Pct: ratio(n('pt_inside_20'), punts),
    touchbacks: n('pt_touchback'),
    epaPerPunt: ctx.epa,
    fairCatchPct: ratio(n('pt_fair_caught'), punts),
  };
}

// Players listed per position and how their stats are built. Each list is the top `count` by usage,
// plus anyone in the top `count` at one of the position's leader stats, so a low-usage big-play
// player still shows up when sorting by yards. (Touchdowns aren't a leader stat: early in the
// season too many players tie at one or two.)
const SKILL_POSITIONS = {
  RB: { count: 60, usage: (s) => s.carries + s.targets, leaders: ['rushYards', 'recYards'], stats: offenseStats },
  WR: { count: 80, usage: (s) => s.targets, leaders: ['recYards'], stats: offenseStats },
  TE: { count: 48, usage: (s) => s.targets, leaders: ['recYards'], stats: offenseStats },
  K: { count: 32, usage: (s) => s.fgAtt + s.patAtt, stats: kickerStats, epa: 'kicks' },
  P: { count: 32, usage: (s) => s.punts, stats: punterStats, epa: 'punts' },
};

const TEAM_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LA: 'Los Angeles Rams', LAC: 'Los Angeles Chargers', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

function teamIcon(abbr) {
  const icon = TEAM_ICONS[abbr];
  if (!icon) throw new Error(`Unknown team abbreviation "${abbr}"`);
  return `assets/NFL_Icons/${icon}.png`;
}

// The teams that played this season (31 before the Texans joined in 2002)
function seasonTeams(games) {
  return Object.keys(TEAM_ICONS).filter((team) => games.some((g) => g.home_team === team || g.away_team === team));
}

// Each completed game from one team's side
function teamGames(games, team) {
  return games
    .filter((game) => game.home_team === team || game.away_team === team)
    .map((game) => {
      const home = game.home_team === team;
      return {
        game,
        home,
        pointsFor: num(home ? game.home_score : game.away_score),
        pointsAgainst: num(home ? game.away_score : game.home_score),
        coach: home ? game.home_coach : game.away_coach,
      };
    });
}

const EPA_PLAY = (play) => (play.pass === '1' || play.rush === '1') && num(play.epa) !== null;

// Standard D/ST points allowed tiers
function pointsAllowedFantasy(points) {
  if (points === 0) return 10;
  if (points <= 6) return 7;
  if (points <= 13) return 4;
  if (points <= 20) return 1;
  if (points <= 27) return 0;
  if (points <= 34) return -1;
  return -4;
}

// Team defenses: EPA/success allowed, sacks, takeaways, points allowed and D/ST fantasy
// (sack 1, takeaway 2, TD 6, safety 2, plus the points-allowed tier each game)
function defenseUnits({ pbp, games, pfr }) {
  return seasonTeams(games).map((team) => {
    const defPlays = pbp.filter((play) => play.defteam === team);
    const scrimmage = defPlays.filter(EPA_PLAY);
    const epa = (plays) => mean(plays.map((play) => num(play.epa))) ?? 0;
    const count = (test) => defPlays.filter(test).length;
    const sacks = count((play) => play.sack === '1');
    const takeaways = count((play) => play.interception === '1' || play.fumble_lost === '1');
    const tds = count((play) => play.td_team === team);
    const safeties = count((play) => play.safety === '1');
    const played = teamGames(games, team);
    const allowed = played.map((g) => g.pointsAgainst);
    const dropbacks = count((play) => play.qb_dropback === '1');
    const thirdDowns = defPlays.filter((play) => play.third_down_converted === '1' || play.third_down_failed === '1');
    // Drives that reached the red zone, and how each ended
    const redZone = new Map();
    for (const play of defPlays) {
      if (play.drive_inside20 === '1') redZone.set(`${play.game_id}-${play.fixed_drive}`, play.fixed_drive_result);
    }
    const pressure = pfr.def.get(team);
    return {
      id: null,
      gsisId: `DEF-${team}`,
      name: TEAM_NAMES[team],
      teamLogo: teamIcon(team),
      games: played.length,
      stats: {
        epaAllowed: epa(scrimmage),
        passEpaAllowed: epa(scrimmage.filter((play) => play.pass === '1')),
        rushEpaAllowed: epa(scrimmage.filter((play) => play.rush === '1')),
        successAllowed: mean(scrimmage.map((play) => num(play.success))) ?? 0,
        sacks,
        takeaways,
        ptsAllowedPerGame: allowed.length ? round(allowed.reduce((a, b) => a + b, 0) / allowed.length, 1) : 0,
        fantasyStd:
          sacks + takeaways * 2 + tds * 6 + safeties * 2 + allowed.reduce((sum, p) => sum + pointsAllowedFantasy(p), 0),
        receptions: 0,
        pressureRate: pressure && dropbacks ? ratio(pressure.def_pressures, dropbacks) : null,
        missedTacklePct: pressure
          ? ratio(pressure.def_missed_tackles, pressure.def_tackles_combined + pressure.def_missed_tackles)
          : null,
        thirdDownPct: ratio(thirdDowns.filter((play) => play.third_down_converted === '1').length, thirdDowns.length),
        redZoneTdPct: ratio([...redZone.values()].filter((result) => result === 'Touchdown').length, redZone.size),
      },
    };
  });
}

// Team offensive lines: pass protection (sacks, hits, pressure, sack rate), run blocking on designed
// runs (yards per carry, stuffs, yards before contact, EPA, success, short-yardage conversions) and
// the line's own penalties. QB time to throw is context (a quick passer makes a line look better).
const OLINE_PENALTIES = ['Offensive Holding', 'False Start', 'Illegal Formation', 'Illegal Use of Hands', 'Chop Block'];

function olineUnits({ pbp, games, pfr, ngs }) {
  return seasonTeams(games).map((team) => {
    const plays = pbp.filter((play) => play.posteam === team);
    const dropbacks = plays.filter((play) => play.qb_dropback === '1');
    const sacks = dropbacks.filter((play) => play.sack === '1').length;
    // Designed runs: no scrambles or kneel-downs
    const runs = plays.filter((play) => play.rush === '1' && play.qb_scramble !== '1' && play.qb_kneel !== '1');
    const epaRuns = runs.filter((play) => num(play.epa) !== null);
    const yards = runs.reduce((sum, play) => sum + (num(play.yards_gained) ?? 0), 0);
    // 3rd / 4th and 1-2 runs: converted when they gain a first down or score
    const shortYardage = runs.filter(
      (play) => ['3', '4'].includes(play.down) && (num(play.ydstogo) ?? 99) <= 2
    );
    const penalties = pbp.filter(
      (play) => play.penalty === '1' && play.penalty_team === team && OLINE_PENALTIES.includes(play.penalty_type)
    ).length;
    const played = teamGames(games, team).length;
    const pass = pfr.passTeam.get(team);
    const rush = pfr.rushTeam.get(team);
    return {
      id: null,
      gsisId: `OL-${team}`,
      name: TEAM_NAMES[team],
      teamLogo: teamIcon(team),
      games: played,
      stats: {
        sacksAllowed: sacks,
        qbHitsAllowed: dropbacks.filter((play) => play.qb_hit === '1' || play.sack === '1').length,
        pressureRate: pass && dropbacks.length ? ratio(pass.times_pressured, dropbacks.length) : null,
        sackRate: ratio(sacks, dropbacks.length),
        ypc: runs.length ? round(yards / runs.length, 2) : null,
        stuffRate: ratio(runs.filter((play) => (num(play.yards_gained) ?? 0) <= 0).length, runs.length),
        yardsBeforeContact: rush?.carries ? round(rush.rushing_yards_before_contact / rush.carries, 2) : null,
        runEpa: epaRuns.length ? round(mean(epaRuns.map((play) => num(play.epa))), 3) : null,
        runSuccess: epaRuns.length ? ratio(epaRuns.filter((play) => play.success === '1').length, epaRuns.length) : null,
        shortYardagePct: shortYardage.length
          ? ratio(shortYardage.filter((play) => play.first_down === '1' || play.touchdown === '1').length, shortYardage.length)
          : null,
        linePenaltiesPerGame: played ? round(penalties / played, 1) : null,
        timeToThrow: ngsTeamAverage([...ngs.pass.values()], team, 'avg_time_to_throw', 'attempts'),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Data grades: O-line and weapons per team, responsibility per QB, from this season's stats.
// Each is the average z-score of a few stats, ranked into 0-12 like the preseason grades
// (best 12 = A+, worst 0 = F). The app blends them with the preseason grades by games played.
// ---------------------------------------------------------------------------

// rows: [{ key, metrics: { name: value | null } }]; lowerIsBetter: metric names to flip
function gradeByComposite(rows, lowerIsBetter = []) {
  const names = Object.keys(rows[0]?.metrics ?? {});
  const score = new Map(rows.map((row) => [row, 0]));
  for (const name of names) {
    const known = rows.map((row) => row.metrics[name]).filter((v) => v !== null && !Number.isNaN(v));
    if (known.length < 2) continue;
    const avg = known.reduce((a, b) => a + b, 0) / known.length;
    const sd = Math.sqrt(known.reduce((a, b) => a + (b - avg) ** 2, 0) / known.length);
    if (!sd) continue;
    for (const row of rows) {
      const v = row.metrics[name];
      // Missing stats count as average
      if (v === null || Number.isNaN(v)) continue;
      const z = (v - avg) / sd;
      score.set(row, score.get(row) + (lowerIsBetter.includes(name) ? -z : z) / names.length);
    }
  }
  const ranked = [...rows].sort((a, b) => score.get(b) - score.get(a));
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map((row, rank) => [row.key, round(12 * (1 - rank / last), 1)]));
}

// Weighted average of an NGS column over a team's players (weights: attempts, targets...)
function ngsTeamAverage(rows, team, key, weightKey, filter = () => true) {
  let sum = 0;
  let weight = 0;
  for (const row of rows) {
    const rowTeam = row.team_abbr === 'LAR' ? 'LA' : row.team_abbr;
    const v = num(row[key]);
    const w = num(row[weightKey]) ?? 0;
    if (rowTeam !== team || v === null || !w || !filter(row)) continue;
    sum += v * w;
    weight += w;
  }
  return weight ? round(sum / weight, 3) : null;
}

// O-line: pressure and sack rate allowed, yards before contact and stuffed designed runs.
// Weapons: receiver separation, YAC over expected, drops, RB rush yards over expected and
// broken tackles; stats that depend least on how good the QB is.
function teamDataGrades({ pbp, games, pfr, ngs, pastCoaches, headCoaches }) {
  const teams = seasonTeams(games).map((team) => {
    const plays = pbp.filter((play) => play.posteam === team);
    const count = (test) => plays.filter(test).length;
    const dropbacks = count((play) => play.qb_dropback === '1');
    const designedRuns = plays.filter((play) => play.rush === '1' && play.qb_scramble !== '1');
    const passAttempts = count((play) => play.pass_attempt === '1' && play.sack !== '1');
    const receptions = count((play) => play.complete_pass === '1');
    const pass = pfr.passTeam.get(team);
    const rush = pfr.rushTeam.get(team);
    const rec = pfr.recTeam.get(team);
    const rushNgs = [...ngs.rush.values()];
    const recNgs = [...ngs.rec.values()];
    const played = teamGames(games, team);
    return {
      team,
      games: played.length,
      coach: headCoaches?.get(team) ?? mostGamesCoach(played) ?? null,
      oline: {
        key: team,
        metrics: {
          pressureRate: pass && dropbacks ? pass.times_pressured / dropbacks : null,
          sackRate: dropbacks ? count((play) => play.qb_dropback === '1' && play.sack === '1') / dropbacks : null,
          yardsBeforeContact: rush?.carries ? rush.rushing_yards_before_contact / rush.carries : null,
          stuffRate: designedRuns.length
            ? designedRuns.filter((play) => (num(play.yards_gained) ?? 0) <= 0).length / designedRuns.length
            : null,
        },
      },
      weapons: {
        key: team,
        metrics: {
          separation: ngsTeamAverage(recNgs, team, 'avg_separation', 'targets'),
          yacOverExpected: ngsTeamAverage(recNgs, team, 'avg_yac_above_expectation', 'receptions'),
          dropRate: pass && passAttempts ? pass.passing_drops / passAttempts : null,
          rushOverExpected: ngsTeamAverage(rushNgs, team, 'rush_yards_over_expected_per_att', 'rush_attempts', (row) => row.player_position === 'RB'),
          brokenTackles:
            rush || rec
              ? ((rush?.rushing_broken_tackles ?? 0) + (rec?.receiving_broken_tackles ?? 0)) /
                Math.max((rush?.carries ?? 0) + receptions, 1)
              : null,
        },
      },
    };
  });
  const oline = gradeByComposite(teams.map((t) => t.oline), ['pressureRate', 'sackRate', 'stuffRate']);
  const weapons = gradeByComposite(teams.map((t) => t.weapons), ['dropRate']);
  const rounded = (metrics) =>
    Object.fromEntries(Object.entries(metrics).map(([name, v]) => [name, round(v, 3)]));
  return Object.fromEntries(
    teams.map((t) => [
      TEAM_ICONS[t.team],
      {
        games: t.games,
        // First-year head coach (never coached an NFL game before this season): the app starts him at a
        // neutral C instead of a preseason grade, since there's no track record to grade
        newCoach: t.coach ? !pastCoaches.has(t.coach) : false,
        coach: t.coach,
        oline: oline.get(t.team),
        weapons: weapons.get(t.team),
        metrics: { ...rounded(t.oline.metrics), ...rounded(t.weapons.metrics) },
      },
    ])
  );
}

// Responsibility: how much the offense runs through the QB in the games he led (most of his
// team's dropbacks): his share of the team's plays (dropbacks and designed runs; kneels and spikes
// left out) and his share of the team's yards (passing plus his own rushing)
function qbDataGrades(espnIds, { pbp, gsisByEspn }) {
  const scrimmage = pbp.filter((play) => play.pass === '1' || play.rush === '1');
  // game-team -> the QB with the most dropbacks
  const dropbacksBy = new Map();
  for (const play of scrimmage) {
    if (play.qb_dropback !== '1') continue;
    const qb = play.passer_player_id !== 'NA' && play.passer_player_id ? play.passer_player_id : play.rusher_player_id;
    if (!qb || qb === 'NA') continue;
    const key = `${play.game_id}|${play.posteam}`;
    const counts = dropbacksBy.get(key) ?? new Map();
    counts.set(qb, (counts.get(qb) ?? 0) + 1);
    dropbacksBy.set(key, counts);
  }
  const ledBy = new Map();
  for (const [key, counts] of dropbacksBy) {
    const [leader] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    ledBy.set(key, leader);
  }

  const rows = [];
  for (const espnId of espnIds) {
    const gsisId = gsisByEspn.get(espnId);
    if (!gsisId) continue;
    const led = new Set([...ledBy].filter(([, qb]) => qb === gsisId).map(([key]) => key));
    if (!led.size) continue;
    const plays = scrimmage.filter((play) => led.has(`${play.game_id}|${play.posteam}`));
    const counted = plays.filter((play) => play.qb_kneel !== '1' && play.qb_spike !== '1');
    const qbPlays = counted.filter(
      (play) =>
        (play.qb_dropback === '1' && (play.passer_player_id === gsisId || play.rusher_player_id === gsisId)) ||
        (play.rush === '1' && play.qb_scramble !== '1' && play.rusher_player_id === gsisId)
    ).length;
    const teamYards = plays.reduce((sum, play) => sum + (num(play.yards_gained) ?? 0), 0);
    const qbYards = plays.reduce(
      (sum, play) =>
        sum +
        (play.passer_player_id === gsisId ? (num(play.passing_yards) ?? 0) : 0) +
        (play.rusher_player_id === gsisId ? (num(play.rushing_yards) ?? 0) : 0),
      0
    );
    rows.push({
      key: espnId,
      games: led.size,
      metrics: {
        playShare: counted.length ? qbPlays / counted.length : null,
        yardShare: teamYards > 0 ? qbYards / teamYards : null,
      },
    });
  }
  const grades = gradeByComposite(rows);
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      {
        games: row.games,
        responsibility: grades.get(row.key),
        metrics: Object.fromEntries(Object.entries(row.metrics).map(([name, v]) => [name, round(v, 3)])),
      },
    ])
  );
}

// Current head coach per team (nflverse abbreviation -> name) from ESPN
async function espnHeadCoaches() {
  const abbrByName = new Map(Object.entries(TEAM_NAMES).map(([abbr, name]) => [name, abbr]));
  const teams = (await getJson(`${SITE}/teams`)).sports[0].leagues[0].teams.map((t) => t.team);
  const coaches = new Map();
  await mapBatched(teams, 8, async (team) => {
    const abbr = abbrByName.get(team.displayName);
    if (!abbr) throw new Error(`Unknown ESPN team "${team.displayName}"`);
    const list = await getJson(
      `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/teams/${team.id}/coaches`
    );
    const ref = list.items?.[0]?.$ref;
    if (!ref) return;
    const coach = await getJson(ref.replace('http:', 'https:'));
    coaches.set(abbr, `${coach.firstName} ${coach.lastName}`);
  });
  return coaches;
}

// A past season has no injury report, so its injury flags come from the rosters instead: a player
// whose status in his team's last regular-season week was reserve (almost always injured reserve)
// finished the season on IR. nflverse's weekly rosters start in 2002; before that its season roster
// (one end-of-season status per player, which matches the weekly rosters' last week wherever both
// exist) stands in. ESPN id -> status.
async function seasonEndReserve(espnByGsis) {
  const url = `${NFLVERSE}/weekly_rosters/roster_weekly_${SEASON}.csv`;
  let rows = await getCsv(url).catch(() => optionalCsvGz(`${url}.gz`));
  if (!rows.length) {
    rows = (await getCsv(`${NFLVERSE}/rosters/roster_${SEASON}.csv`).catch(() => [])).map((row) => ({
      ...row,
      game_type: 'REG',
      week: '0',
    }));
  }
  const last = new Map();
  for (const row of rows) {
    if (row.game_type !== 'REG') continue;
    const seen = last.get(row.gsis_id);
    if (!seen || Number(row.week) > Number(seen.week)) last.set(row.gsis_id, row);
  }
  const statuses = new Map();
  for (const [gsisId, row] of last) {
    if (row.status !== 'RES') continue;
    const espnId = Number(row.espn_id) || espnByGsis.get(gsisId);
    if (espnId) statuses.set(espnId, 'Injured Reserve');
  }
  console.log(`Finished the season on reserve: ${statuses.size} players`);
  return statuses;
}

// Injury report statuses that mean a player won't play (Questionable players usually do)
const INJURED_STATUSES = ['Out', 'Doubtful', 'Injured Reserve'];

// ESPN injury report: ESPN athlete id -> status (Out, Doubtful, Questionable, ...)
async function espnInjuries() {
  const report = await getJson(`${SITE}/injuries`);
  const statuses = new Map();
  for (const team of report.injuries) {
    for (const injury of team.injuries ?? []) {
      const id = Number(injury.athlete?.links?.[0]?.href?.match(/id\/(\d+)/)?.[1]);
      if (id) statuses.set(id, injury.status);
    }
  }
  return statuses;
}

// Moneyline -> implied win probability, with the bookmaker margin removed
function winProbability(game, home) {
  const implied = (ml) => (ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));
  const homeMl = num(game.home_moneyline);
  const awayMl = num(game.away_moneyline);
  let pHome;
  if (homeMl !== null && awayMl !== null) {
    pHome = implied(homeMl) / (implied(homeMl) + implied(awayMl));
  } else {
    // Fall back to the spread (home favored by spread_line) with a normal approximation
    const z = (num(game.spread_line) ?? 0) / 13.45;
    pHome = 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
  }
  return home ? pHome : 1 - pHome;
}

// Head coaches: record, wins over what the betting lines expected, record against the spread,
// point differential per game, and their team's net EPA/play
// One row per team, named for the team's current head coach from ESPN (nflverse's coach
// columns can lag offseason hires); a mid-season change credits the season to the current coach
const turnover = (play) => play.interception === '1' || play.fumble_lost === '1';

// 4th-down aggressiveness: share of 4th and 1-2 at midfield or beyond where the team went for it
// (run or pass) instead of punting or kicking. Near-decided games (win probability under 5% or
// over 95%) and plays wiped out by penalties are left out. null when there were no such spots.
function fourthDownGoRate(plays, team) {
  let goes = 0;
  let spots = 0;
  for (const play of plays) {
    if (play.posteam !== team || play.down !== '4') continue;
    const toGo = num(play.ydstogo);
    const yardline = num(play.yardline_100);
    const wp = num(play.wp);
    if (toGo === null || toGo > 2 || yardline === null || yardline > 50) continue;
    if (wp !== null && (wp < 0.05 || wp > 0.95)) continue;
    if (play.play_type === 'run' || play.play_type === 'pass') goes++;
    else if (play.play_type !== 'punt' && play.play_type !== 'field_goal') continue;
    spots++;
  }
  return spots ? ratio(goes, spots) : null;
}

// Yards gained on runs and passes (sacks included) by the side of the ball named ('posteam': the
// team's offense, 'defteam': allowed by its defense)
function scrimmageYards(plays, side, team) {
  return plays
    .filter((play) => play[side] === team && (play.pass === '1' || play.rush === '1'))
    .reduce((sum, play) => sum + (num(play.yards_gained) ?? 0), 0);
}

// Special teams EPA from the team's side: kicks and punts it made, minus what opponents' kicks,
// punts and returns gained against it
const SPECIAL_TEAMS = ['punt', 'kickoff', 'field_goal', 'extra_point'];
function specialTeamsNet(plays, team) {
  let total = 0;
  for (const play of plays) {
    const epa = num(play.epa);
    if (!SPECIAL_TEAMS.includes(play.play_type) || epa === null) continue;
    if (play.posteam === team) total += epa;
    else if (play.defteam === team) total -= epa;
  }
  return total;
}

// The coach on the sideline for most of a team's games (a past season's head coach, where an
// interim coach finished the year)
function mostGamesCoach(played) {
  const counts = new Map();
  for (const { coach } of played) counts.set(coach, (counts.get(coach) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function coachUnits({ pbp, games, headCoaches }) {
  const coaches = Object.keys(TEAM_ICONS)
    .map((team) => {
      const played = teamGames(games, team);
      const name = headCoaches.get(team) ?? mostGamesCoach(played);
      return { name, team, games: played };
    })
    .filter((coach) => coach.name && coach.games.length);

  return coaches.map(({ name, team, games: played }) => {
    const gameIds = new Set(played.map((g) => g.game.game_id));
    const plays = pbp.filter((play) => gameIds.has(play.game_id));
    const offense = plays.filter((play) => play.posteam === team && EPA_PLAY(play));
    const defense = plays.filter((play) => play.defteam === team && EPA_PLAY(play));
    const epa = (list) => mean(list.map((play) => num(play.epa))) ?? 0;

    let wins = 0, losses = 0, ties = 0, expected = 0, covers = 0, atsGames = 0, oneScore = 0, oneScoreWins = 0;
    for (const g of played) {
      const margin = g.pointsFor - g.pointsAgainst;
      if (margin > 0) wins++;
      else if (margin < 0) losses++;
      else ties++;
      // One-score games: decided by 8 points or fewer
      if (Math.abs(margin) <= 8) {
        oneScore++;
        oneScoreWins += margin > 0 ? 1 : margin === 0 ? 0.5 : 0;
      }
      expected += winProbability(g.game, g.home);
      // spread_line is how many points the home team is favored by; pushes don't count
      const spread = num(g.game.spread_line);
      if (spread !== null) {
        const homeMargin = num(g.game.result);
        const coverMargin = g.home ? homeMargin - spread : spread - homeMargin;
        if (coverMargin !== 0) {
          atsGames++;
          if (coverMargin > 0) covers++;
        }
      }
    }
    const results = wins + ties * 0.5;
    return {
      id: null,
      gsisId: `HC-${name}`,
      name,
      teamLogo: teamIcon(team),
      games: played.length,
      stats: {
        wins,
        losses,
        ties,
        winPct: ratio(results, played.length),
        winsOverExpected: round(results - expected, 2),
        atsPct: ratio(covers, atsGames),
        pointDiffPerGame: round(played.reduce((sum, g) => sum + g.pointsFor - g.pointsAgainst, 0) / played.length, 1),
        netEpa: round(epa(offense) - epa(defense), 3),
        // Unit ranks in the app (offense, defense, special teams), by EPA, points or yards
        offEpa: round(epa(offense), 3),
        defEpaAllowed: round(epa(defense), 3),
        ptsPerGame: round(played.reduce((sum, g) => sum + g.pointsFor, 0) / played.length, 1),
        ptsAllowedPerGame: round(played.reduce((sum, g) => sum + g.pointsAgainst, 0) / played.length, 1),
        yardsPerGame: round(scrimmageYards(plays, 'posteam', team) / played.length, 1),
        yardsAllowedPerGame: round(scrimmageYards(plays, 'defteam', team) / played.length, 1),
        stEpaPerGame: round(specialTeamsNet(plays, team) / played.length, 2),
        oneScoreWinPct: oneScore ? ratio(oneScoreWins, oneScore) : null,
        penaltiesPerGame: round(
          plays.filter((play) => play.penalty === '1' && play.penalty_team === team).length / played.length,
          1
        ),
        // Takeaways minus giveaways (interceptions + lost fumbles) per game
        turnoverDiffPerGame: round(
          (plays.filter((play) => play.defteam === team && turnover(play)).length -
            plays.filter((play) => play.posteam === team && turnover(play)).length) /
            played.length,
          1
        ),
        fourthDownGoPct: fourthDownGoRate(plays, team),
      },
    };
  });
}

// EPA per kick (FG + XP attempts) and per punt, keyed by nflverse player id
function specialTeamsEpa(pbp) {
  const perPlayer = (plays, idKey) => {
    const byPlayer = new Map();
    for (const play of plays) {
      const id = play[idKey];
      const epa = num(play.epa);
      if (!id || id === 'NA' || epa === null) continue;
      byPlayer.set(id, [...(byPlayer.get(id) ?? []), epa]);
    }
    return new Map([...byPlayer].map(([id, values]) => [id, mean(values)]));
  };
  const reg = pbp.filter((play) => play.season_type === 'REG');
  return {
    kicks: perPlayer(
      reg.filter((play) => play.field_goal_attempt === '1' || play.extra_point_attempt === '1'),
      'kicker_player_id'
    ),
    punts: perPlayer(reg.filter((play) => play.punt_attempt === '1'), 'punter_player_id'),
  };
}

// FG makes over expected per attempt (percentage points), from nflverse's fg_prob
function fieldGoalsOverExpected(pbp) {
  const totals = new Map();
  for (const play of pbp) {
    const prob = num(play.fg_prob);
    if (play.field_goal_attempt !== '1' || prob === null || !play.kicker_player_id) continue;
    const t = totals.get(play.kicker_player_id) ?? { made: 0, expected: 0, att: 0 };
    t.made += play.field_goal_result === 'made' ? 1 : 0;
    t.expected += prob;
    t.att++;
    totals.set(play.kicker_player_id, t);
  }
  return new Map([...totals].map(([id, t]) => [id, round(((t.made - t.expected) / t.att) * 100, 1)]));
}

// Season stats for non-QB positions from nflverse, plus team defenses and head coaches
// The players who make a position's list: the top `count` by usage, and the top `count` at each
// leader stat (strict cuts, players with 0 left out)
// ---------------------------------------------------------------------------
// Garbage time: the app's "Garbage Time Stats" setting can leave out plays run when the game was
// already decided (offense's win probability under 10% or over 90%, as rbsdm.com does). Only stats
// built from play-by-play can be filtered, so each unit carries a "competitive" copy of just those.
// ---------------------------------------------------------------------------
const competitivePlay = (play) => {
  const wp = num(play.wp);
  return wp === null || (wp >= 0.1 && wp <= 0.9);
};

const COMPETITIVE_KEYS = {
  DEF: ['epaAllowed', 'passEpaAllowed', 'rushEpaAllowed', 'successAllowed', 'sacks', 'takeaways', 'thirdDownPct', 'redZoneTdPct'],
  HC: ['netEpa', 'offEpa', 'defEpaAllowed'],
  OL: ['sacksAllowed', 'qbHitsAllowed', 'sackRate', 'ypc', 'stuffRate', 'runEpa', 'runSuccess', 'shortYardagePct', 'linePenaltiesPerGame'],
  QB: ['epaPerPlay', 'cpoe', 'successRate'],
};

const pick = (stats, keys) => Object.fromEntries(keys.map((key) => [key, stats?.[key] ?? null]));

// The same units rebuilt from competitive plays, keeping only the play-by-play stats
function withCompetitive(units, rebuilt, keys) {
  const byId = new Map(rebuilt.map((unit) => [unit.gsisId, unit]));
  return units.map((unit) => ({ ...unit, competitive: pick(byId.get(unit.gsisId)?.stats, keys) }));
}

// EPA per carry / per target for RBs, WRs and TEs from competitive plays, keyed by nflverse id
function competitivePlayerEpa(pbp) {
  const add = (map, id, epa) => {
    if (!id || id === 'NA' || epa === null) return;
    const total = map.get(id) ?? { sum: 0, plays: 0 };
    map.set(id, { sum: total.sum + epa, plays: total.plays + 1 });
  };
  const carries = new Map();
  const targets = new Map();
  for (const play of pbp) {
    if (!competitivePlay(play)) continue;
    const epa = num(play.epa);
    if (play.rush === '1') add(carries, play.rusher_player_id, epa);
    else if (play.pass_attempt === '1' && play.sack !== '1') add(targets, play.receiver_player_id, epa);
  }
  const per = (map, id) => {
    const total = map.get(id);
    return total?.plays ? round(total.sum / total.plays, 3) : 0;
  };
  return (id) => ({ epaPerCarry: per(carries, id), epaPerTarget: per(targets, id) });
}

function listedPlayers(all, { count, usage, leaders = [] }) {
  const top = (value) =>
    all
      .filter((player) => value(player.stats) > 0)
      .sort((a, b) => value(b.stats) - value(a.stats))
      .slice(0, count);
  return new Set([top(usage), ...leaders.map((key) => top((s) => s[key] ?? 0))].flat());
}

// Targets per receiver and per team, counted from the play-by-play (every pass that names a receiver,
// sacks and spikes aside), and which receiving stats this season's player stats actually have
function receivingFromPbp(playerStats, pbp) {
  const targets = new Map();
  const teamTargets = new Map();
  let incompletions = 0;
  for (const play of pbp) {
    if (play.pass_attempt !== '1' || play.sack === '1' || play.qb_spike === '1') continue;
    const id = play.receiver_player_id;
    if (!id || id === 'NA') continue;
    if (play.complete_pass === '0') incompletions++;
    targets.set(id, (targets.get(id) ?? 0) + 1);
    teamTargets.set(play.posteam, (teamTargets.get(play.posteam) ?? 0) + 1);
  }
  // A stat is there if nearly every player with a catch has it (a stray value doesn't count)
  const catchers = playerStats.filter((row) => (num(row.receptions) ?? 0) > 0);
  const has = (key) => catchers.filter((row) => (num(row[key]) ?? 0) !== 0).length >= catchers.length * 0.8;
  return {
    pbpTargets: [...targets.values()].reduce((a, b) => a + b, 0),
    // Older play-by-play names the receiver only on catches, which would make every target a catch
    pbpHasTargets: incompletions > 1000,
    hasTargets: has('targets'),
    hasYac: has('receiving_yards_after_catch'),
    hasAirYards: has('air_yards_share'),
    forPlayer: (id, team) => ({ targets: targets.get(id) ?? 0, teamTargets: teamTargets.get(team) ?? 0 }),
  };
}

function skillPlayers(nflverse) {
  const { playerStats, pbp, espnByGsis, pfrByGsis, ngs, pfr, snapShare } = nflverse;
  const receiving = receivingFromPbp(playerStats, pbp);
  if (!receiving.hasTargets) {
    console.log(
      receiving.pbpHasTargets
        ? `Player stats have no targets this season: ${receiving.pbpTargets} counted from the play-by-play`
        : 'No targets this season (the play-by-play names receivers on catches only): target stats left out',
    );
  }
  const stEpa = specialTeamsEpa(pbp);
  const fgOverExp = fieldGoalsOverExpected(pbp);
  const competitive = { ...nflverse, pbp: pbp.filter(competitivePlay) };
  const units = (build, keys) =>
    withCompetitive(build(nflverse), build(competitive), keys).sort((a, b) => a.name.localeCompare(b.name));
  const result = {
    DEF: units(defenseUnits, COMPETITIVE_KEYS.DEF),
    HC: units(coachUnits, COMPETITIVE_KEYS.HC),
    OL: units(olineUnits, COMPETITIVE_KEYS.OL),
  };
  const competitiveEpa = competitivePlayerEpa(pbp);
  for (const [position, config] of Object.entries(SKILL_POSITIONS)) {
    const players = playerStats
      .filter((row) => row.position === position)
      .map((row) => {
        const n = (key) => num(row[key]) ?? 0;
        const icon = TEAM_ICONS[row.recent_team];
        if (!icon) throw new Error(`Unknown team abbreviation "${row.recent_team}" for ${row.player_display_name}`);
        const pfrId = pfrByGsis.get(row.player_id);
        const ctx = {
          epa: config.epa ? (stEpa[config.epa].get(row.player_id) ?? 0) : undefined,
          fgOverExp: fgOverExp.get(row.player_id),
          ngsRush: ngs.rush.get(row.player_id),
          ngsRec: ngs.rec.get(row.player_id),
          pfrRush: pfr.rush.get(pfrId),
          pfrRec: pfr.rec.get(pfrId),
          snapShare: snapShare.get(pfrId),
          receiving: { ...receiving, ...receiving.forPlayer(row.player_id, row.recent_team) },
        };
        return {
          id: espnByGsis.get(row.player_id) ?? null,
          gsisId: row.player_id,
          name: row.player_display_name,
          teamLogo: `assets/NFL_Icons/${icon}.png`,
          games: n('games'),
          stats: config.stats(n, ctx),
          ...(config.stats === offenseStats ? { competitive: competitiveEpa(row.player_id) } : {}),
        };
      });
    const listed = listedPlayers(players, config);
    result[position] = players.filter((player) => listed.has(player)).sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

async function completedGames() {
  const weeks = await mapBatched(
    Array.from({ length: WEEKS }, (_, i) => i + 1),
    6,
    (week) => getJson(`${SITE}/scoreboard?seasontype=2&week=${week}&dates=${SEASON}`)
  );
  return weeks
    .flatMap((scoreboard) => scoreboard.events)
    .filter((event) => event.status.type.completed)
    .map((event) => ({ id: event.id, date: event.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// A QB's season box stats from ESPN (what the app used to fetch live on every page load).
// null when ESPN has no stats for them this season (404); throws on other failures.
// NFL passer rating from the box score: four parts (completion %, yards, TDs and interceptions per
// attempt), each held to 0-2.375, averaged and scaled to 0-158.3. Worked out here rather than taken
// from ESPN, whose rating field is wrong for seasons before 2021.
function passerRating(completions, attempts, yards, tds, ints) {
  if (!attempts) return null;
  const part = (value) => Math.max(0, Math.min(2.375, value));
  const sum =
    part((completions / attempts - 0.3) * 5) +
    part((yards / attempts - 3) * 0.25) +
    part((tds / attempts) * 20) +
    part(2.375 - (ints / attempts) * 25);
  return round((sum / 6) * 100, 1);
}

async function qbBoxStats(id) {
  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${SEASON}/types/2/athletes/${id}/statistics`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const data = await res.json();
  const stat = (category, name) =>
    data.splits.categories.find((c) => c.name === category)?.stats.find((s) => s.name === name)?.value ?? 0;
  const attempts = stat('passing', 'passingAttempts');
  return {
    games: stat('general', 'gamesPlayed'),
    fumLost: stat('general', 'fumblesLost'),
    passYards: stat('passing', 'passingYards'),
    passTd: stat('passing', 'passingTouchdowns'),
    ints: stat('passing', 'interceptions'),
    compPercent: round(stat('passing', 'completionPct'), 1),
    ypa: round(stat('passing', 'yardsPerPassAttempt'), 2),
    rating: passerRating(
      stat('passing', 'completions'),
      attempts,
      stat('passing', 'passingYards'),
      stat('passing', 'passingTouchdowns'),
      stat('passing', 'interceptions')
    ),
    rushYards: stat('rushing', 'rushingYards'),
    rushTd: stat('rushing', 'rushingTouchdowns'),
  };
}

// Returns [{ athlete, team, result }] for both teams in a game
async function gameStarters(game) {
  const summary = await getJson(`${SITE}/summary?event=${game.id}`);
  const competitors = summary.header.competitions[0].competitors;
  const tie = competitors.every((c) => !c.winner);

  const starters = summary.boxscore.players.flatMap((teamStats) => {
    const passing = teamStats.statistics.find((s) => s.name === 'passing');
    if (!passing) return [];
    const attIndex = passing.labels.indexOf('C/ATT');
    const starter = passing.athletes.reduce((best, a) => {
      const attempts = Number(a.stats[attIndex].split('/')[1]);
      return !best || attempts > best.attempts ? { athlete: a.athlete, attempts } : best;
    }, null);
    // (a few old box scores list no passers)
    if (!starter) return [];
    const competitor = competitors.find((c) => c.team.id === teamStats.team.id);
    return [
      {
        athlete: starter.athlete,
        team: teamStats.team.displayName,
        result: tie ? 0.5 : competitor.winner ? 1 : 0,
      },
    ];
  });

  if (starters.length !== 2) {
    const problem = `Game ${game.id} (${game.date}): found ${starters.length} starting QBs, expected 2`;
    // An old season's gap only costs a start or two in the records; this season's means something broke
    if (!PAST_SEASON) throw new Error(problem);
    console.warn(`${problem}; left out of the QB records`);
  }
  return starters;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const games = await completedGames();
  console.log(`Season ${SEASON}: ${games.length} completed games`);

  const perGame = await mapBatched(games, 8, gameStarters);

  // Games are in date order, so results accumulate chronologically
  const qbs = new Map();
  for (const { athlete, team, result } of perGame.flat()) {
    const qb = qbs.get(athlete.id) ?? { id: Number(athlete.id), name: athlete.displayName, results: [], starts: {} };
    qb.team = team;
    qb.results.push(result);
    qb.starts[teamLogo(team)] = (qb.starts[teamLogo(team)] ?? 0) + 1;
    qbs.set(athlete.id, qb);
  }

  const gameData = [...qbs.values()]
    .map((qb) => {
      const count = (value) => qb.results.filter((r) => r === value).length;
      return {
        id: qb.id,
        name: qb.name,
        team: qb.team,
        teamLogo: teamLogo(qb.team),
        wins: count(1),
        losses: count(0),
        ties: count(0.5),
        // Up to 5 most recent results, newest first (1 win, 0.5 tie, 0 loss); unplayed slots are left out
        lastFive: [...qb.results].reverse().slice(0, 5),
        // Starts per team (keyed by logo path), used to weight team QB play for receivers
        starts: qb.starts,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // nflverse can lag ESPN or be briefly unavailable; keep the last known values rather than failing
  const previous = JSON.parse(await readFile(GAMES_FILE, 'utf8').catch(() => '[]'));
  let advanced = new Map();
  let skill = null;
  let dataGrades = null;
  // (a past season's injury flags: who finished it on injured reserve)
  let seasonEndInjuries = new Map();
  try {
    const nflverse = await loadNflverse();
    if (PAST_SEASON) seasonEndInjuries = await seasonEndReserve(nflverse.espnByGsis);
    // ESPN's staff pages show today's coach, so a past season names its coaches from the schedule
    nflverse.headCoaches = PAST_SEASON ? new Map() : await espnHeadCoaches().catch((err) => {
      console.warn(`Could not load head coaches from ESPN, using nflverse names: ${err.message}`);
      return new Map();
    });
    advanced = advancedStats(gameData.map((qb) => qb.id), nflverse);
    // The play-by-play stats again without garbage time, for the Garbage Time Stats setting
    const competitive = advancedStats(gameData.map((qb) => qb.id), { ...nflverse, pbp: nflverse.pbp.filter(competitivePlay) });
    for (const [id, stats] of advanced) stats.competitive = pick(competitive.get(id), COMPETITIVE_KEYS.QB);
    skill = skillPlayers(nflverse);
    dataGrades = { teams: teamDataGrades(nflverse), qbs: qbDataGrades(gameData.map((qb) => qb.id), nflverse) };
  } catch (err) {
    if (PAST_SEASON) throw err;
    console.warn(`Could not load nflverse data, keeping previous values: ${err.message}`);
  }
  if (dataGrades) {
    await writeFile(DATA_GRADES_FILE, JSON.stringify(dataGrades, null, 2) + '\n');
    console.log(`Wrote data grades: ${Object.keys(dataGrades.teams).length} teams, ${Object.keys(dataGrades.qbs).length} QBs`);
  }
  for (const qb of gameData) {
    qb.advanced = advanced.get(qb.id) ?? previous.find((p) => p.id === qb.id)?.advanced ?? null;
  }
  const missing = gameData.filter((qb) => !qb.advanced).map((qb) => qb.name);
  if (missing.length) console.warn(`No advanced stats for: ${missing.join(', ')}`);

  // Box stats (games, passing, rushing, rating) from ESPN in the same run as the results, so a
  // QB's stats and record always change together; keep yesterday's if ESPN can't be reached
  const boxes = await mapBatched(gameData, 8, (qb) => qbBoxStats(qb.id).catch(() => undefined));
  gameData.forEach((qb, i) => {
    qb.box = boxes[i] === undefined ? (previous.find((p) => p.id === qb.id)?.box ?? null) : boxes[i];
    // Games played: starts plus real relief appearances, not ESPN's every-snap count (see QB_GAME_PLAYS)
    const realGames = qb.advanced?.realGames;
    if (qb.box && realGames !== undefined) {
      qb.box.games = Math.max(qb.wins + qb.losses + qb.ties, realGames);
    }
  });
  const noBox = gameData.filter((qb) => !qb.box).map((qb) => qb.name);
  if (noBox.length) console.warn(`No ESPN box stats for: ${noBox.join(', ')}`);

  // Injury flags from ESPN's report; keep yesterday's if the report can't be loaded
  // (a past season has no report: its flags are the players who finished on injured reserve)
  const injuries = PAST_SEASON ? seasonEndInjuries : await espnInjuries().catch((err) => {
    console.warn(`Could not load the ESPN injury report, keeping previous injury flags: ${err.message}`);
    return null;
  });
  for (const qb of gameData) {
    const status = injuries ? (injuries.get(qb.id) ?? 'Active') : previous.find((p) => p.id === qb.id)?.injuryStatus;
    qb.injuryStatus = status ?? 'Active';
    qb.injured = INJURED_STATUSES.includes(qb.injuryStatus);
  }
  const hurt = gameData.filter((qb) => qb.injured).map((qb) => `${qb.name} (${qb.injuryStatus})`);
  if (hurt.length) console.log(`Injured QBs: ${hurt.join(', ')}`);

  // Same injury flags for RB/WR/TE/K/P (defenses and coaches have none). If nflverse couldn't be
  // loaded, yesterday's player list still gets today's injury report
  const previousSkill = JSON.parse(await readFile(SKILL_FILE, 'utf8').catch(() => 'null'));
  const skillOut = skill ?? previousSkill;
  if (skillOut) {
    const previousStatus = new Map(
      Object.values(previousSkill ?? {})
        .flat()
        .filter((player) => player.id)
        .map((player) => [Number(player.id), player.injuryStatus])
    );
    const hurtSkill = [];
    for (const pos of ['RB', 'WR', 'TE', 'K', 'P']) {
      for (const player of skillOut[pos] ?? []) {
        if (!player.id) continue;
        const id = Number(player.id);
        player.injuryStatus = (injuries ? (injuries.get(id) ?? 'Active') : previousStatus.get(id)) ?? 'Active';
        player.injured = INJURED_STATUSES.includes(player.injuryStatus);
        if (player.injured) hurtSkill.push(`${player.name} (${pos}, ${player.injuryStatus})`);
      }
    }
    await writeFile(SKILL_FILE, JSON.stringify(skillOut, null, 2) + '\n');
    console.log(
      `Wrote skill players: ${Object.entries(skillOut).map(([pos, list]) => `${list.length} ${pos}`).join(', ')}`
    );
    if (hurtSkill.length) console.log(`Injured players: ${hurtSkill.join(', ')}`);
  }

  await writeFile(GAMES_FILE, JSON.stringify(gameData, null, 2) + '\n');
  console.log(`Wrote ${gameData.length} QBs to games.json`);

  // Add any new QBs to subjective.json. Weapons/O-line/coaching come from team-grades.json and
  // defense from the Defenses rankings, so only the per-QB scores are needed.
  const subjective = JSON.parse(await readFile(SUBJECTIVE_FILE, 'utf8').catch(() => '{}'));
  const added = [];
  for (const qb of gameData) {
    if (subjective[qb.id]) continue;
    subjective[qb.id] = { name: qb.name, responsibility: DEFAULT_SCORE };
    added.push(`${qb.name} (${qb.team})`);
  }
  if (added.length) {
    await writeFile(SUBJECTIVE_FILE, JSON.stringify(subjective, null, 2) + '\n');
    if (!PAST_SEASON) console.log(`Added to subjective.json (review their scores): ${added.join(', ')}`);
  }
  // The app loads team-grades.json with every season; a past season has no preseason grades (every
  // team falls back to a C, which a full season of stats outweighs)
  if (PAST_SEASON) await writeFile(TEAM_GRADES_FILE, '{}' + String.fromCharCode(10));
}

main().catch((err) => {
  console.error(process.env.DEBUG ? err.stack : err.message);
  process.exit(1);
});
