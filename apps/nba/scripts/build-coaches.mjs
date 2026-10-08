// The Team tab's Coaches panel: each team's head coach and assistants, season by season, from Wikipedia's
// team-season pages ("2024–25 Boston Celtics season": its roster box's footer names the staff; the
// infobox's coach when it doesn't). Every team by its name that season (the season's rows'), so a moved
// or renamed team finds its page. One file per season: StaticData/coaches.json for the season in the
// data, StaticData/seasons/<year>/coaches.json for past ones. Free: no AI.
//
//   node apps/nba/scripts/build-coaches.mjs              (the season in the data: nightly)
//   node apps/nba/scripts/build-coaches.mjs 2001-2025    (past seasons: once)

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { currentSeason, param, plain, seasonRange, wikitext, writeStaff } from '../../../libs/ranker/scripts/wiki-staff.mjs';

const DATA = path.resolve(import.meta.dirname, '../src/StaticData');
const CURRENT_SEASON = currentSeason(path.resolve(import.meta.dirname, '..'));
// (Wikipedia's names where the data's differ)
const WIKI_NAME = { 'LA Clippers': 'Los Angeles Clippers' };

const fileFor = (season) => (season === CURRENT_SEASON ? path.join(DATA, 'skill-players.json') : path.join(DATA, 'seasons', String(season), 'skill-players.json'));

// A footer list ("* [[Name]]" lines, or one name) as names
const names = (value) =>
  (value ?? '')
    .split('\n')
    .map((l) => plain(l.replace(/^\s*\*+\s*/, '')))
    .filter((n) => n && !/^[|=]/.test(n));

// A coach: an older footer's note after his name kept with his role when it says what happened ("fired",
// "interim"), dropped when it's his college
function coach(text, role) {
  const m = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { role, name: text };
  return { role: /fired|interim|resigned|replaced/i.test(m[2]) ? `${role} (${m[2]})` : role, name: m[1] };
}

async function build(season) {
  const file = fileFor(season);
  if (!existsSync(file)) return console.log(`${season}: no data`);
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const teams = [...new Set(Object.values(rows).flat().map((p) => p.teamName).filter(Boolean))];
  const label = `${season - 1}–${String(season % 100).padStart(2, '0')}`;
  const titleOf = (team) => `${label} ${WIKI_NAME[team] ?? team} season`;
  const pages = await wikitext(teams.map(titleOf));
  const out = {};
  const missing = [];
  for (const team of teams) {
    const text = pages.get(titleOf(team));
    if (!text) {
      missing.push(team);
      continue;
    }
    const footer = text.slice(Math.max(0, text.search(/\{\{\s*NBA roster footer/i)));
    const hasFooter = /\{\{\s*NBA roster footer/i.test(text);
    let head = hasFooter ? names(param(footer, 'head_coach')) : [];
    const staff = hasFooter ? names(param(footer, 'asst_coach')) : [];
    // (no footer: the infobox's coach)
    if (!head.length) head = names(param(text, 'coach')?.split(/<br\s*\/?>/i).join('\n')).map((n) => n.replace(/\s*\(.*$/, ''));
    if (!head.length) {
      missing.push(team);
      continue;
    }
    out[team] = { head: head.map((n) => coach(n, 'Head coach')), staff: staff.map((n) => coach(n, 'Assistant coach')) };
  }
  const to = season === CURRENT_SEASON ? path.join(DATA, 'coaches.json') : path.join(DATA, 'seasons', String(season), 'coaches.json');
  writeStaff(to, season, out);
  console.log(`${season}: ${Object.keys(out).length} teams${missing.length ? ` (none for ${missing.join(', ')})` : ''}`);
}

for (const season of seasonRange(process.argv[2], CURRENT_SEASON)) await build(season);
