// Similar seasons and career links for the player card, from the finished seasons in
// src/StaticData/seasons/ (run after adding one: `npm run mlb:build-comps`).
//
// - seasons/<year>/comps.json: each player's three most similar seasons by
//   anyone else in any other year. Every stat that counts in the ranking (volume stats per game) is
//   turned into a z-score within its own season, so a season is judged by how far it stood out from
//   that year's league; two seasons are compared on the stats both have (RMS difference).
// - careers.json: every season each one appears in, for the card's Seasons tab: [season, team,
//   games, rank with the default sliders, list size, headline stats (headlineStats, season totals)].
//   The current season isn't in it: the app works it out from the rows it has.
// - seasons/<year>/units/<tab>.json: each tab's rows, which the Seasons tab ranks with the current
//   sliders (and uses in place of the default ranks above once they load).
//
// The rows and stats come from the app's own code (bundled with esbuild), so they match the tables.
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const SEASONS_DIR = path.join(STATIC, 'seasons');
const FILES = {
  skillPlayers: 'skill-players.json',
};
// Seasons shorter than this don't get similar seasons, and can't be one (in each tab's games: a
// hitter's games, a starter's starts, a reliever's appearances; the 60-game 2020 is scaled down)
const MIN_GAMES_SUBJECT = { hitter: 60, SP: 12, RP: 25 };
const MIN_GAMES_POOL = { hitter: 90, SP: 18, RP: 35 };
const gamesKind = (position) => (position === 'SP' || position === 'RP' ? position : 'hitter');
const seasonScale = (season) => (season === 2020 ? 60 / 162 : 1);
const Z_CAP = 3;
const COMPS = 3;

const readSeason = (year) =>
  Object.fromEntries(
    Object.entries(FILES).map(([key, file]) => [key, JSON.parse(fs.readFileSync(path.join(SEASONS_DIR, String(year), file), 'utf8'))]),
  );

const seasons = fs
  .readdirSync(SEASONS_DIR)
  .filter((dir) => /^\d{4}$/.test(dir))
  .map(Number)
  .sort((a, b) => a - b);

// Bundle the app's row builder and stat list
const bundle = path.join(os.tmpdir(), `mlb-ranker-comps-${process.pid}.mjs`);
await build({
  entryPoints: [path.join(ROOT, 'scripts/comps/units.ts')],
  bundle: true,
  format: 'esm',
  logLevel: 'warning',
  outfile: bundle,
  platform: 'node',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
});
globalThis.__DATA = readSeason(seasons[0]);
const { unitsFor, SKILL_STATS, defaultRanking, headlineStats, presetWeights, unitStat } = await import(
  pathToFileURL(bundle).href
);
fs.rmSync(bundle);

const logoKey = (teamLogo) => teamLogo.split('/').pop().replace('.svg', '');

// Every unit-season: { season, gsisId, name, id, logo, games, z: {stat: z-score} }
const entries = {};
const careers = {};
for (const season of seasons) {
  const units = unitsFor(readSeason(season));
  // Each tab's rows on their own (QBs already built), so the Seasons tab can rank a player's other
  // years with the current sliders without downloading whole seasons: seasons/<year>/units/<tab>.json
  const unitsDir = path.join(SEASONS_DIR, String(season), 'units');
  fs.mkdirSync(unitsDir, { recursive: true });
  for (const position of Object.keys(SKILL_STATS)) {
    fs.writeFileSync(path.join(unitsDir, `${position}.json`), JSON.stringify(units[position] ?? []));
  }
  for (const [position, stats] of Object.entries(SKILL_STATS)) {
    const rows = units[position] ?? [];
    const scored = stats.filter(
      (stat) => !stat.infoOnly && !stat.support && stat.format !== 'record',
    );
    const value = (unit, stat) => {
      const raw = unitStat(unit, stat.key);
      if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
      return stat.kind === 'volume' ? (unit.games ? raw / unit.games : null) : raw;
    };
    // Each stat's league mean and spread that season, over full-enough seasons
    const poolMin = MIN_GAMES_POOL[gamesKind(position)] * seasonScale(season);
    const pool = rows.filter((unit) => unit.games >= poolMin);
    const scales = new Map();
    for (const stat of scored) {
      const values = pool.map((unit) => value(unit, stat)).filter((v) => v !== null);
      if (values.length < 5) continue;
      const mean = values.reduce((a, v) => a + v, 0) / values.length;
      const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
      if (sd > 0) scales.set(stat, { mean, sd });
    }
    // The Seasons tab's line for each: games, rank with the default sliders (the list as the table
    // first shows it), and the headline stats as season totals
    const ranked = defaultRanking(position, presetWeights(position, 'default'), rows);
    const headline = headlineStats(position);
    for (const unit of rows) {
      const stats = headline.map((stat) => {
        const v = unitStat(unit, stat.key);
        return v === null || v === undefined ? null : Math.round(v * 1000) / 1000;
      });
      (careers[position] ??= {})[unit.gsisId] ??= [];
      careers[position][unit.gsisId].push([
        season,
        logoKey(unit.teamLogo),
        unit.games,
        ranked.indexOf(unit) + 1,
        ranked.length,
        stats,
      ]);
      if (unit.games < MIN_GAMES_SUBJECT[gamesKind(position)] * seasonScale(season)) continue;
      const z = {};
      for (const [stat, { mean, sd }] of scales) {
        const v = value(unit, stat);
        if (v !== null) z[stat.key] = Math.max(-Z_CAP, Math.min(Z_CAP, (v - mean) / sd));
      }
      (entries[position] ??= []).push({
        season,
        gsisId: unit.gsisId,
        name: unit.name,
        id: unit.id ?? null,
        logo: logoKey(unit.teamLogo),
        games: unit.games,
        z,
      });
    }
  }
}

// RMS difference over the stats both seasons have (none in common enough: no match)
function distance(a, b) {
  const keys = Object.keys(a.z);
  let sum = 0;
  let shared = 0;
  for (const key of keys) {
    const other = b.z[key];
    if (other === undefined) continue;
    sum += (a.z[key] - other) ** 2;
    shared++;
  }
  if (shared < Math.max(3, keys.length * 0.6)) return Infinity;
  return Math.sqrt(sum / shared);
}

// Distance to a 0-100 match score (0 apart = 100; a typical closest match lands in the 80s)
const matchScore = (d) => Math.round(100 * Math.exp(-(d * d) / 1.5));

const comps = Object.fromEntries(seasons.map((season) => [season, {}]));
const nearest = [];
for (const [position, list] of Object.entries(entries)) {
  const pool = list.filter((entry) => entry.games >= MIN_GAMES_POOL[gamesKind(position)] * seasonScale(entry.season));
  for (const entry of list) {
    const best = [];
    for (const other of pool) {
      if (other.season === entry.season || other.gsisId === entry.gsisId || other.name === entry.name) continue;
      const d = distance(entry, other);
      if (d === Infinity) continue;
      if (best.length < COMPS || d < best[best.length - 1].d) {
        best.push({ d, other });
        best.sort((a, b) => a.d - b.d);
        if (best.length > COMPS) best.pop();
      }
    }
    if (!best.length) continue;
    nearest.push(best[0].d);
    (comps[entry.season][position] ??= {})[entry.gsisId] = best.map(({ d, other }) => [
      other.season,
      other.gsisId,
      other.name,
      other.id,
      other.logo,
      matchScore(d),
    ]);
  }
}

for (const season of seasons) {
  fs.writeFileSync(path.join(SEASONS_DIR, String(season), 'comps.json'), JSON.stringify(comps[season]));
}
fs.writeFileSync(path.join(STATIC, 'careers.json'), JSON.stringify(careers));

nearest.sort((a, b) => a - b);
const at = (q) => nearest[Math.floor(q * (nearest.length - 1))].toFixed(2);
console.log(
  `Similar seasons for ${nearest.length} unit-seasons over ${seasons[0]}-${seasons.at(-1)}; closest-match distance ` +
    `p10 ${at(0.1)} / median ${at(0.5)} / p90 ${at(0.9)} (match ${matchScore(+at(0.1))}% / ${matchScore(+at(0.5))}% / ${matchScore(+at(0.9))}%)`,
);
