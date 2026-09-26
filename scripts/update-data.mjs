// Rebuilds src/StaticData/games.json from ESPN box scores.
//
// For every completed regular-season game, the QB with the most pass attempts
// on each team is treated as that team's starter. Each starter gets a record,
// last-five results, and team. Advanced stats (EPA/play, CPOE, success rate)
// are aggregated from nflverse play-by-play. Hand-set scores live in
// subjective.json; any new QB is added there with starter values to review.
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

// EPA/play and success rate cover the QB's dropbacks and runs; CPOE covers pass attempts.
// Returns a Map of ESPN id -> { epaPerPlay, cpoe, successRate, plays }
async function advancedStats(espnIds) {
  const [players, pbp] = await Promise.all([
    getCsvGz(`${NFLVERSE}/players/players.csv.gz`),
    getCsvGz(`${NFLVERSE}/pbp/play_by_play_${SEASON}.csv.gz`),
  ]);
  const gsisByEspn = new Map(
    players.filter((p) => p.espn_id && p.espn_id !== 'NA').map((p) => [Number(p.espn_id), p.gsis_id])
  );
  const num = (v) => (v === undefined || v === '' || v === 'NA' ? null : Number(v));
  const plays = pbp.filter((play) => play.season_type === 'REG' && (play.pass === '1' || play.rush === '1'));

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
    });
  }
  return stats;
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
    const qb = qbs.get(athlete.id) ?? { id: Number(athlete.id), name: athlete.displayName, results: [] };
    qb.team = team;
    qb.results.push(result);
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
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // nflverse can lag ESPN or be briefly unavailable; keep the last known values rather than failing
  const previous = JSON.parse(await readFile(GAMES_FILE, 'utf8').catch(() => '[]'));
  let advanced = new Map();
  try {
    advanced = await advancedStats(gameData.map((qb) => qb.id));
  } catch (err) {
    console.warn(`Could not load nflverse advanced stats, keeping previous values: ${err.message}`);
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
