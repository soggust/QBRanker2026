// The careers' names (the compare view's search): careers/names.json, { tab: { id: [name, headshot id,
// last season] } } for everyone in a finished season, read from the per-tab season files build-comps.mjs
// writes (seasons/<year>/units/<tab>.json); the season being played comes from the page's own rows. The
// latest season's name wins (a team renamed, a player's name as he's known now).
//
// Written with the careers by careers.mjs; by hand: node libs/ranker/scripts/career-names.mjs [sport...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function writeCareerNames(staticDir) {
  const seasonsDir = path.join(staticDir, 'seasons');
  if (!fs.existsSync(seasonsDir)) return;
  const names = {};
  const seasons = fs
    .readdirSync(seasonsDir)
    .filter((d) => /^\d{4}$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);
  for (const season of seasons) {
    const unitsDir = path.join(seasonsDir, String(season), 'units');
    if (!fs.existsSync(unitsDir)) continue;
    for (const file of fs.readdirSync(unitsDir).filter((f) => f.endsWith('.json'))) {
      const tab = file.replace(/\.json$/, '');
      const rows = JSON.parse(fs.readFileSync(path.join(unitsDir, file), 'utf8'));
      const byId = (names[tab] ??= {});
      for (const row of rows) {
        if (!row?.gsisId || !row.name) continue;
        byId[row.gsisId] = [row.name, row.id ?? null, season];
      }
    }
  }
  fs.mkdirSync(path.join(staticDir, 'careers'), { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'careers', 'names.json'), JSON.stringify(names));
  return names;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.join(import.meta.dirname, '..', '..', '..');
  const sports = process.argv.slice(2).length ? process.argv.slice(2) : ['nfl', 'mlb', 'nba', 'nhl'];
  for (const sport of sports) {
    const names = writeCareerNames(path.join(root, 'apps', sport, 'src', 'StaticData'));
    const count = Object.values(names ?? {}).reduce((a, byId) => a + Object.keys(byId).length, 0);
    console.log(`${sport}: ${count} names over ${Object.keys(names ?? {}).length} tabs`);
  }
}
