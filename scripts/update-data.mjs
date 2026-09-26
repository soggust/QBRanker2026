// Rebuilds src/StaticData/games.json from ESPN box scores.
//
// For every completed regular-season game, the QB with the most pass attempts
// on each team is treated as that team's starter. Each starter gets a record,
// last-five results, and team. Advanced stats (EPA/play, CPOE, success rate)
// are aggregated from nflverse play-by-play. Hand-set scores live in
// subjective.json; any new QB is added there with starter values to review.
//
// RB/WR/TE/K/P lists and season stats come from nflverse player stats and are
// written to skill-players.json (top players at each position by usage).
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

async function loadNflverse() {
  const [players, pbp, playerStats] = await Promise.all([
    getCsvGz(`${NFLVERSE}/players/players.csv.gz`),
    getCsvGz(`${NFLVERSE}/pbp/play_by_play_${SEASON}.csv.gz`),
    getCsvGz(`${NFLVERSE}/stats_player/stats_player_reg_${SEASON}.csv.gz`),
  ]);
  const espnIds = players.filter((p) => p.espn_id && p.espn_id !== 'NA');
  return {
    pbp,
    playerStats,
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

// Season stats for non-QB positions from nflverse
function skillPlayers({ playerStats, pbp, espnByGsis }) {
  const stEpa = specialTeamsEpa(pbp);
  const result = {};
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

  await writeFile(GAMES_FILE, JSON.stringify(gameData, null, 2) + '\n');
  console.log(`Wrote ${gameData.length} QBs to games.json`);

  // Add any new QBs to subjective.json, borrowing team-context scores from a teammate
  const subjective = JSON.parse(await readFile(SUBJECTIVE_FILE, 'utf8'));
  const added = [];
  for (const qb of gameData) {
    if (subjective[qb.id]) continue;
    const teammate = gameData.find((other) => other.team === qb.team && subjective[other.id]);
    const context = teammate ? subjective[teammate.id] : {};
    subjective[qb.id] = {
      name: qb.name,
      injured: false,
      weapons: context.weapons ?? DEFAULT_SCORE,
      coaching: context.coaching ?? DEFAULT_SCORE,
      oline: context.oline ?? DEFAULT_SCORE,
      defense: context.defense ?? DEFAULT_SCORE,
      responsibility: DEFAULT_SCORE,
    };
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
