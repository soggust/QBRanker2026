// The NFL's results and starters (games.json: each QB's record and his starts by team): no false ties,
// every team's starts adding up to its season, and each QB's record adding up to his starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, staticDir } from './support/engine.mjs';

const SEASONS_DIR = path.join(staticDir('nfl'), 'seasons');

// The real tied games, by season (every other finished season has none)
const TIES = { 2002: 1, 2008: 1, 2012: 1, 2013: 1, 2014: 1, 2016: 2, 2018: 2, 2019: 1, 2020: 1, 2021: 1, 2022: 2, 2025: 1 };
// Games a season's schedule had: 16 through 2020, 17 since
const seasonGames = (season) => (season >= 2021 ? 17 : 16);
// Games that never happened (2022: BUF @ CIN, called off after Damar Hamlin's collapse)
const CANCELLED = { 2022: { 'Bills.png': 1, 'Bengals.png': 1 } };

const logo = (teamLogo) => teamLogo.split('/').pop();

function check(games, where) {
  const teams = {};
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const qb of games) {
    const starts = Object.values(qb.starts ?? {}).reduce((a, n) => a + n, 0);
    assert.equal(qb.wins + qb.losses + qb.ties, starts, `${where}: ${qb.name}'s record (${qb.wins}-${qb.losses}-${qb.ties}) doesn't add up to his ${starts} starts`);
    for (const [team, n] of Object.entries(qb.starts ?? {})) teams[logo(team)] = (teams[logo(team)] ?? 0) + n;
    wins += qb.wins;
    losses += qb.losses;
    ties += qb.ties;
  }
  // (a game is one team's win and the other's loss, or a tie for both)
  assert.equal(wins, losses, `${where}: ${wins} wins but ${losses} losses`);
  assert.equal(ties % 2, 0, `${where}: an odd number of QB ties (${ties})`);
  return { teams, tieGames: ties / 2 };
}

const finished = fs
  .readdirSync(SEASONS_DIR)
  .filter((d) => /^\d{4}$/.test(d) && fs.existsSync(path.join(SEASONS_DIR, d, 'games.json')))
  .map(Number)
  .sort();

test('NFL finished seasons: only the real ties, and every team starts its whole season', () => {
  assert.ok(finished.includes(2001), 'no 2001 games.json');
  for (const season of finished) {
    const where = `NFL ${season}`;
    const { teams, tieGames } = check(readJson(path.join(SEASONS_DIR, String(season), 'games.json')), where);
    assert.equal(tieGames, TIES[season] ?? 0, `${where}: ${tieGames} tied games, expected ${TIES[season] ?? 0}`);
    assert.ok(Object.keys(teams).length >= 31, `${where}: only ${Object.keys(teams).length} teams`);
    for (const [team, starts] of Object.entries(teams)) {
      const expected = seasonGames(season) - (CANCELLED[season]?.[team] ?? 0);
      assert.equal(starts, expected, `${where}: ${team} has ${starts} starts, expected ${expected}`);
    }
  }
});

test('NFL current season: records add up, and no team past a full season', () => {
  const games = readJson(path.join(staticDir('nfl'), 'games.json'));
  const { teams } = check(games, 'NFL current');
  for (const [team, starts] of Object.entries(teams)) assert.ok(starts <= 17, `NFL current: ${team} has ${starts} starts`);
});
