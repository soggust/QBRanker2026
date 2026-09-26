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
// Usage: npm run update-data            (season defaults to 2026)
//        SEASON=2027 npm run update-data

import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const SEASON = Number(process.env.SEASON ?? 2026);
const WEEKS = 18;
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const DATA_DIR = new URL('../src/StaticData/', import.meta.url);
const GAMES_FILE = new URL('games.json', DATA_DIR);
const SUBJECTIVE_FILE = new URL('subjective.json', DATA_DIR);
const SKILL_FILE = new URL('skill-players.json', DATA_DIR);
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

// "Tampa Bay Buccaneers" -> "../assets/NFL_Icons/Bucs.png"
function teamLogo(teamName) {
  const mascot = teamName.split(' ').pop();
  return `../assets/NFL_Icons/${mascot === 'Buccaneers' ? 'Bucs' : mascot}.png`;
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

async function loadNflverse() {
  const [players, pbp, playerStats, schedule] = await Promise.all([
    getCsvGz(`${NFLVERSE}/players/players.csv.gz`),
    getCsvGz(`${NFLVERSE}/pbp/play_by_play_${SEASON}.csv.gz`),
    getCsvGz(`${NFLVERSE}/stats_player/stats_player_reg_${SEASON}.csv.gz`),
    getCsv(SCHEDULE_URL),
  ]);
  const espnIds = players.filter((p) => p.espn_id && p.espn_id !== 'NA');
  return {
    pbp: pbp.filter((play) => play.season_type === 'REG'),
    playerStats,
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
function advancedStats(espnIds, { pbp, playerStats, gsisByEspn }) {
  const plays = pbp.filter((play) => play.season_type === 'REG' && (play.pass === '1' || play.rush === '1'));
  const seasonRows = new Map(playerStats.map((row) => [row.player_id, row]));

  const stats = new Map();
  for (const espnId of espnIds) {
    const gsisId = gsisByEspn.get(espnId);
    if (!gsisId) continue;
    const own = plays.filter((play) => play.id === gsisId && num(play.qb_epa) !== null);
    const cpoe = plays.filter((play) => play.passer_player_id === gsisId).map((play) => num(play.cpoe));
    stats.set(espnId, {
      epaPerPlay: mean(own.map((play) => num(play.qb_epa))),
      cpoe: mean(cpoe.filter((v) => v !== null)),
      successRate: mean(own.map((play) => num(play.success)).filter((v) => v !== null)),
      plays: own.length,
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

const round = (value, digits) => Number(value.toFixed(digits));
const ratio = (a, b, digits = 3) => (b ? round(a / b, digits) : 0);

// RB/WR/TE season totals plus a few derived rates
function offenseStats(n) {
  const stats = {
    carries: n('carries'),
    rushYards: n('rushing_yards'),
    rushTds: n('rushing_tds'),
    targets: n('targets'),
    receptions: n('receptions'),
    recYards: n('receiving_yards'),
    recTds: n('receiving_tds'),
    yac: n('receiving_yards_after_catch'),
    firstDowns: n('rushing_first_downs') + n('receiving_first_downs'),
    fumbles: n('rushing_fumbles_lost') + n('receiving_fumbles_lost'),
    targetShare: round(n('target_share'), 3),
    fantasyStd: round(n('fantasy_points'), 2),
  };
  return {
    ...stats,
    ypc: ratio(stats.rushYards, stats.carries, 2),
    totalTds: stats.rushTds + stats.recTds,
    catchPct: ratio(stats.receptions, stats.targets),
    epaPerCarry: ratio(n('rushing_epa'), stats.carries),
    epaPerTarget: ratio(n('receiving_epa'), stats.targets),
  };
}

// nflverse fantasy points leave out kicking, so kickers use standard scoring:
// FG 0-39 = 3, 40-49 = 4, 50+ = 5, XP = 1, missed FG or XP = -1
function kickerStats(n, epa) {
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
    epaPerKick: epa,
    fantasyStd: fgUnder40 * 3 + n('fg_made_40_49') * 4 + fg50 * 5 + patMade - (fgAtt - fgMade) - (patAtt - patMade),
    receptions: 0,
  };
}

function punterStats(n, epa) {
  const punts = n('pt_att');
  return {
    punts,
    grossAvg: ratio(n('pt_yards'), punts, 1),
    netAvg: ratio(n('pt_net_yards'), punts, 1),
    inside20: n('pt_inside_20'),
    inside20Pct: ratio(n('pt_inside_20'), punts),
    touchbacks: n('pt_touchback'),
    epaPerPunt: epa,
  };
}

// Players listed per position (top N by usage) and how their stats are built
const SKILL_POSITIONS = {
  RB: { count: 40, usage: (s) => s.carries + s.targets, stats: offenseStats },
  WR: { count: 50, usage: (s) => s.targets, stats: offenseStats },
  TE: { count: 32, usage: (s) => s.targets, stats: offenseStats },
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
  return `../assets/NFL_Icons/${icon}.png`;
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
function defenseUnits({ pbp, games }) {
  return Object.keys(TEAM_ICONS).map((team) => {
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
      },
    };
  });
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
function coachUnits({ pbp, games, headCoaches }) {
  const coaches = Object.keys(TEAM_ICONS)
    .map((team) => {
      const played = teamGames(games, team);
      const name = headCoaches.get(team) ?? played.at(-1)?.coach;
      return { name, team, games: played };
    })
    .filter((coach) => coach.name && coach.games.length);

  return coaches.map(({ name, team, games: played }) => {
    const gameIds = new Set(played.map((g) => g.game.game_id));
    const plays = pbp.filter((play) => gameIds.has(play.game_id));
    const offense = plays.filter((play) => play.posteam === team && EPA_PLAY(play));
    const defense = plays.filter((play) => play.defteam === team && EPA_PLAY(play));
    const epa = (list) => mean(list.map((play) => num(play.epa))) ?? 0;

    let wins = 0, losses = 0, ties = 0, expected = 0, covers = 0, atsGames = 0;
    for (const g of played) {
      const margin = g.pointsFor - g.pointsAgainst;
      if (margin > 0) wins++;
      else if (margin < 0) losses++;
      else ties++;
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

// Season stats for non-QB positions from nflverse, plus team defenses and head coaches
function skillPlayers(nflverse) {
  const { playerStats, pbp, espnByGsis } = nflverse;
  const stEpa = specialTeamsEpa(pbp);
  const result = {
    DEF: defenseUnits(nflverse).sort((a, b) => a.name.localeCompare(b.name)),
    HC: coachUnits(nflverse).sort((a, b) => a.name.localeCompare(b.name)),
  };
  for (const [position, config] of Object.entries(SKILL_POSITIONS)) {
    result[position] = playerStats
      .filter((row) => row.position === position)
      .map((row) => {
        const n = (key) => num(row[key]) ?? 0;
        const icon = TEAM_ICONS[row.recent_team];
        if (!icon) throw new Error(`Unknown team abbreviation "${row.recent_team}" for ${row.player_display_name}`);
        const epa = config.epa ? (stEpa[config.epa].get(row.player_id) ?? 0) : undefined;
        return {
          id: espnByGsis.get(row.player_id) ?? null,
          gsisId: row.player_id,
          name: row.player_display_name,
          teamLogo: `../assets/NFL_Icons/${icon}.png`,
          games: n('games'),
          stats: config.stats(n, epa),
        };
      })
      .sort((a, b) => config.usage(b.stats) - config.usage(a.stats))
      .slice(0, config.count)
      .sort((a, b) => a.name.localeCompare(b.name));
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
    throw new Error(`Game ${game.id} (${game.date}): found ${starters.length} starting QBs, expected 2`);
  }
  return starters;
}

async function main() {
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
        // Most recent first, padded to 5 (the recency calculation needs exactly 5)
        lastFive: [...qb.results].reverse().concat([0, 0, 0, 0, 0]).slice(0, 5),
        // Starts per team (keyed by logo path), used to weight team QB play for receivers
        starts: qb.starts,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // nflverse can lag ESPN or be briefly unavailable; keep the last known values rather than failing
  const previous = JSON.parse(await readFile(GAMES_FILE, 'utf8').catch(() => '[]'));
  let advanced = new Map();
  let skill = null;
  try {
    const nflverse = await loadNflverse();
    nflverse.headCoaches = await espnHeadCoaches().catch((err) => {
      console.warn(`Could not load head coaches from ESPN, using nflverse names: ${err.message}`);
      return new Map();
    });
    advanced = advancedStats(gameData.map((qb) => qb.id), nflverse);
    skill = skillPlayers(nflverse);
  } catch (err) {
    console.warn(`Could not load nflverse data, keeping previous values: ${err.message}`);
  }
  if (skill) {
    await writeFile(SKILL_FILE, JSON.stringify(skill, null, 2) + '\n');
    console.log(
      `Wrote skill players: ${Object.entries(skill).map(([pos, list]) => `${list.length} ${pos}`).join(', ')}`
    );
  }
  for (const qb of gameData) {
    qb.advanced = advanced.get(qb.id) ?? previous.find((p) => p.id === qb.id)?.advanced ?? null;
  }
  const missing = gameData.filter((qb) => !qb.advanced).map((qb) => qb.name);
  if (missing.length) console.warn(`No advanced stats for: ${missing.join(', ')}`);

  // Injury flags from ESPN's report; keep yesterday's if the report can't be loaded
  const injuries = await espnInjuries().catch((err) => {
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

  await writeFile(GAMES_FILE, JSON.stringify(gameData, null, 2) + '\n');
  console.log(`Wrote ${gameData.length} QBs to games.json`);

  // Add any new QBs to subjective.json. Weapons/O-line/coaching come from team-grades.json and
  // defense from the Defenses rankings, so only the per-QB scores are needed.
  const subjective = JSON.parse(await readFile(SUBJECTIVE_FILE, 'utf8'));
  const added = [];
  for (const qb of gameData) {
    if (subjective[qb.id]) continue;
    subjective[qb.id] = { name: qb.name, responsibility: DEFAULT_SCORE };
    added.push(`${qb.name} (${qb.team})`);
  }
  if (added.length) {
    await writeFile(SUBJECTIVE_FILE, JSON.stringify(subjective, null, 2) + '\n');
    console.log(`Added to subjective.json (review their scores): ${added.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
