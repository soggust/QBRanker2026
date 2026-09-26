// Rebuilds src/StaticData/games.json from ESPN box scores.
//
// For every completed regular-season game, the QB with the most pass attempts
// on each team is treated as that team's starter. Each starter gets a record,
// last-five results, and team. Hand-set scores live in subjective.json; any new
// QB is added there with starter values to review.
//
// Usage: npm run update-data            (season defaults to 2026)
//        SEASON=2027 npm run update-data

import { readFile, writeFile } from 'node:fs/promises';

const SEASON = Number(process.env.SEASON ?? 2026);
const WEEKS = 18;
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const DATA_DIR = new URL('../src/StaticData/', import.meta.url);
const GAMES_FILE = new URL('games.json', DATA_DIR);
const SUBJECTIVE_FILE = new URL('subjective.json', DATA_DIR);
const DEFAULT_SCORE = 6;

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
