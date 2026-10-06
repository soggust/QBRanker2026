// Earlier seasons' game logs for the card's Game Log tab, written once (the NHL's API doesn't let the
// site ask): every player in a season's lists (the archives' skaters and goalies), regular season and
// playoffs, newest first, into src/StaticData/game-logs/<season>.json, the same shape as this season's
// game-logs.json ({ skater, goalie, logs, playoffs: { id: playoff games, the newest of the log } }).
//
//   node apps/nhl/scripts/backfill-game-logs.mjs [season...]
//
// Paced like the nightly update (a few requests a second, a 429's Retry-After honored); a season already
// written is skipped, so a run that stops picks up where it left off.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SEASONS = path.join(ROOT, 'src/StaticData/seasons');
const OUT = path.join(ROOT, 'src/StaticData/game-logs');
const WEB = 'https://api-web.nhle.com/v1';
const SKATER_LOG = ['G', 'A', 'P', '+/-', 'SOG', 'PIM', 'TOI'];
const GOALIE_LOG = ['SA', 'GA', 'SV%', 'TOI'];
const seasonId = (season) => `${season - 1}${season}`;

let lastRequest = 0;
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 350 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'sports-ranker data script' } });
      if (res.status === 404) return null;
      if (res.status === 429 && attempt < 6) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 30) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

// A season's players from its archived lists: skaters and goalies, each once
function playersOf(season) {
  const dir = path.join(SEASONS, String(season), 'units');
  const players = new Map();
  for (const [file, goalie] of [['C', false], ['LW', false], ['RW', false], ['D', false], ['G', true]]) {
    const f = path.join(dir, `${file}.json`);
    if (!existsSync(f)) continue;
    for (const row of JSON.parse(readFileSync(f, 'utf8'))) {
      const id = Number(row.id ?? row.gsisId);
      if (id > 0 && !players.has(id)) players.set(id, goalie);
    }
  }
  return players;
}

async function backfill(season) {
  const file = path.join(OUT, `${season}.json`);
  if (existsSync(file)) return console.log(`${season}: already written`);
  const players = playersOf(season);
  const logs = {};
  const playoffs = {};
  let done = 0;
  for (const [id, goalie] of players) {
    const games = [];
    let post = 0;
    for (const type of [3, 2]) {
      const body = await get(`${WEB}/player/${id}/game-log/${seasonId(season)}/${type}`).catch(() => null);
      const list = body?.gameLog ?? [];
      if (type === 3) post = list.length;
      games.push(...list);
    }
    if (games.length) {
      games.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
      logs[id] = games.map((g) => {
        const date = new Date(`${g.gameDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const vs = `${g.homeRoadFlag === 'H' ? 'vs' : '@'} ${g.opponentAbbrev}`;
        return goalie
          ? [date, vs, g.decision === 'W' ? 'W' : g.decision === 'L' || g.decision === 'O' ? 'L' : '', g.shotsAgainst, g.goalsAgainst, g.savePctg == null ? '-' : g.savePctg.toFixed(3).replace(/^0/, ''), g.toi]
          : [date, vs, '', g.goals, g.assists, g.points, g.plusMinus > 0 ? `+${g.plusMinus}` : g.plusMinus, g.shots, g.pim, g.toi];
      });
      if (post) playoffs[id] = post;
    }
    if (++done % 100 === 0) console.log(`${season}: ${done} of ${players.size}`);
  }
  writeFileSync(file, JSON.stringify({ skater: SKATER_LOG, goalie: GOALIE_LOG, logs, playoffs }));
  console.log(`${season}: ${Object.keys(logs).length} players written`);
}

mkdirSync(OUT, { recursive: true });
const asked = process.argv.slice(2).map(Number).filter(Boolean);
const current = Math.max(...readdirSync(SEASONS).map(Number).filter(Boolean)) + 1;
const seasons = asked.length ? asked : readdirSync(SEASONS).map(Number).filter((s) => s && s < current).sort((a, b) => b - a);
for (const season of seasons) await backfill(season);
console.log('done');
