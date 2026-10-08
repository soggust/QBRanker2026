// The Team tab's Coaches panel: each team's manager and coaches, season by season, from Wikipedia: the
// season in the data from the team's live roster box ("Template:New York Yankees roster": its manager and
// every coach with his role), past seasons from the team-season page's infobox ("2012 New York Yankees
// season": its manager; the coaches aren't kept there). Every team by its name that season (the season's
// rows'), so a moved or renamed team finds its page. One file per season: StaticData/coaches.json for the
// season in the data, StaticData/seasons/<year>/coaches.json for past ones. Free: no AI.
//
//   node apps/mlb/scripts/build-coaches.mjs              (the season in the data: nightly)
//   node apps/mlb/scripts/build-coaches.mjs 2000-2025    (past seasons: once)

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { currentSeason, param, plain, seasonRange, wikitext, writeStaff } from '../../../libs/ranker/scripts/wiki-staff.mjs';

const DATA = path.resolve(import.meta.dirname, '../src/StaticData');
const CURRENT_SEASON = currentSeason(path.resolve(import.meta.dirname, '..'));

const fileFor = (season) => (season === CURRENT_SEASON ? path.join(DATA, 'skill-players.json') : path.join(DATA, 'seasons', String(season), 'skill-players.json'));

// The roster box's people ("{{MLBplayer|17|[[Aaron Boone]]}} {{small|(bench)}}"): each name, and his role
// from the note after it
function people(value) {
  const out = [];
  for (const m of (value ?? '').matchAll(/\{\{MLBplayer\|[^|}]*\|([^}]*?)\}\}\s*(?:\{\{small\|\(([^)]*)\)\}\})?/gi)) {
    out.push({ name: plain(m[1]), note: m[2] ?? null });
  }
  return out;
}

// "bench" -> "Bench coach"; "bullpen catcher" stays as it is
function role(note) {
  if (!note) return 'Coach';
  const text = note[0].toUpperCase() + note.slice(1);
  return /coach|catcher|coordinator|manager|instructor/i.test(note) ? text : `${text} coach`;
}

async function build(season) {
  const file = fileFor(season);
  if (!existsSync(file)) return console.log(`${season}: no data`);
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const teams = [...new Set(Object.values(rows).flat().map((p) => p.teamName).filter(Boolean))];
  const current = season === CURRENT_SEASON;
  const seasonPage = (team) => `${season} ${team} season`;
  const rosterBox = (team) => `Template:${team} roster`;
  const pages = await wikitext(teams.flatMap((team) => (current ? [rosterBox(team), seasonPage(team)] : [seasonPage(team)])));
  const out = {};
  const missing = [];
  for (const team of teams) {
    let head = [];
    let staff = [];
    const box = current ? pages.get(rosterBox(team)) : null;
    if (box) {
      head = people(param(box, 'Manager')).map((p) => ({ role: 'Manager', name: p.name }));
      staff = people(param(box, 'Coaches')).map((p) => ({ role: role(p.note), name: p.name }));
    }
    // (the season page's infobox: its manager, or managers when it changed hands)
    const page = pages.get(seasonPage(team));
    if (!head.length && page) {
      const value = param(page, 'managers?') ?? '';
      head = value
        .split(/<br\s*\/?>|\n|,(?![^(]*\))/i)
        .map((n) => plain(n))
        .filter(Boolean)
        .map((n) => {
          const m = n.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
          return m ? { role: `Manager (${m[2]})`, name: m[1] } : { role: 'Manager', name: n };
        });
    }
    if (!head.length) {
      missing.push(team);
      continue;
    }
    out[team] = { head, staff };
  }
  const to = current ? path.join(DATA, 'coaches.json') : path.join(DATA, 'seasons', String(season), 'coaches.json');
  writeStaff(to, season, out);
  console.log(`${season}: ${Object.keys(out).length} teams${missing.length ? ` (none for ${missing.join(', ')})` : ''}`);
}

for (const season of seasonRange(process.argv[2], CURRENT_SEASON)) await build(season);
