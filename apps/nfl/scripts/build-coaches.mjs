// The Team tab's Coaches panel: each team's coaching staff, season by season (the head coach, the
// coordinators and every position coach), from Wikipedia: a finished season's from its team-season page's
// final staff box ("2012 Baltimore Ravens season"), the season being played from the team's live staff
// template ("Template:Baltimore Ravens staff"). One file per season, every team in it by its logo's name
// (the depth files' names): StaticData/depth/coaches.json, StaticData/seasons/<year>/depth/coaches.json.
// Free: no AI; the query API takes 50 pages a request.
//
//   node apps/nfl/scripts/build-coaches.mjs              (the season being played: nightly)
//   node apps/nfl/scripts/build-coaches.mjs 2001-2025    (past seasons: once)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DATA = path.join(ROOT, 'apps/nfl/src/StaticData');
// (the season in the data: update-data.mjs's, the one scripts/rollover.mjs bumps)
const CURRENT_SEASON = Number(readFileSync(path.join(import.meta.dirname, 'update-data.mjs'), 'utf8').match(/^const CURRENT_SEASON = (\d+);/m)[1]);
const API = 'https://en.wikipedia.org/w/api.php';
const AGENT = 'QBRanker/1.0 (https://github.com/soggust; data build)';

// Each team by its logo's name: its name on Wikipedia, by era
const TEAMS = {
  Cardinals: 'Arizona Cardinals', Falcons: 'Atlanta Falcons', Ravens: 'Baltimore Ravens', Bills: 'Buffalo Bills',
  Panthers: 'Carolina Panthers', Bears: 'Chicago Bears', Bengals: 'Cincinnati Bengals', Browns: 'Cleveland Browns',
  Cowboys: 'Dallas Cowboys', Broncos: 'Denver Broncos', Lions: 'Detroit Lions', Packers: 'Green Bay Packers',
  Texans: 'Houston Texans', Colts: 'Indianapolis Colts', Jaguars: 'Jacksonville Jaguars', Chiefs: 'Kansas City Chiefs',
  Raiders: (y) => (y <= 2019 ? 'Oakland Raiders' : 'Las Vegas Raiders'),
  Chargers: (y) => (y <= 2016 ? 'San Diego Chargers' : 'Los Angeles Chargers'),
  Rams: (y) => (y <= 2015 ? 'St. Louis Rams' : 'Los Angeles Rams'),
  Dolphins: 'Miami Dolphins', Vikings: 'Minnesota Vikings', Patriots: 'New England Patriots', Saints: 'New Orleans Saints',
  Giants: 'New York Giants', Jets: 'New York Jets', Eagles: 'Philadelphia Eagles', Steelers: 'Pittsburgh Steelers',
  Seahawks: 'Seattle Seahawks', '49ers': 'San Francisco 49ers', Bucs: 'Tampa Bay Buccaneers', Titans: 'Tennessee Titans',
  Commanders: (y) => (y <= 2019 ? 'Washington Redskins' : y <= 2021 ? 'Washington Football Team' : 'Washington Commanders'),
};
const nameOf = (logo, season) => (typeof TEAMS[logo] === 'function' ? TEAMS[logo](season) : TEAMS[logo]);

// Pages' wikitext, 50 a request (redirects followed: a request's title -> its text)
async function wikitext(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`;
    const res = await fetch(url, { headers: { 'User-Agent': AGENT } });
    if (!res.ok) throw new Error(`wikipedia: ${res.status}`);
    const json = await res.json();
    const back = new Map(batch.map((t) => [t, t]));
    for (const n of json.query.normalized ?? []) back.set(n.to, n.from);
    for (const r of json.query.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
    for (const page of json.query.pages) {
      const text = page.revisions?.[0]?.slots?.main?.content;
      if (text) out.set(back.get(page.title) ?? page.title, text);
    }
  }
  return out;
}

// A wiki line as plain text: links to their words, refs, notes and templates gone
function plain(s) {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{(?:small|nowrap)\|([^{}]*)\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The staff's coaches, by unit: the final staff box's "|Offensive Coaches=" sections or the live template's
// ";Offensive coaches" headings (or a hand-made table's bold '''Offensive coaches'''), each line "* Role – Name"
const UNITS = [
  // (the older boxes' keys: head_coach, offensive, defensive, special_teams)
  ['head', /^head[ _]coach/i],
  ['offense', /^offensive( coach|$)/i],
  ['defense', /^defensive( coach|$)/i],
  ['special', /^special[ _]teams( coach|$)/i],
];
function staff(text) {
  const start = text.search(/\{\{NFL final staff|;\s*Head coach|'''Head coach/i);
  if (start < 0) return null;
  const out = { head: [], offense: [], defense: [], special: [] };
  let unit = null;
  for (const raw of text.slice(start).split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^\|\s*([^=]+?)\s*=\s*(.*)$/) ?? line.match(/^;\s*(.+)$/) ?? line.match(/^'''([^']+)'''$/);
    if (heading) {
      const name = heading[1];
      unit = UNITS.find(([, re]) => re.test(name))?.[0] ?? null;
      continue;
    }
    if (/^==|^\}\}$|^\|\}/.test(line) && out.head.length) break;
    if (!unit || !line.startsWith('*')) continue;
    const item = plain(line.replace(/^\*+\s*/, ''));
    const at = item.search(/\s[–—-]\s/);
    if (at < 0) continue;
    const role = item.slice(0, at).trim();
    const who = item.slice(at + 3).trim();
    if (role && who) out[unit].push({ role: role[0].toUpperCase() + role.slice(1), name: who });
  }
  return out.head.length ? out : null;
}

async function build(season) {
  const current = season === CURRENT_SEASON;
  const titleOf = (logo) => (current ? `Template:${nameOf(logo, season)} staff` : `${season} ${nameOf(logo, season)} season`);
  const logos = Object.keys(TEAMS);
  const pages = await wikitext(logos.map(titleOf));
  const out = {};
  const missing = [];
  for (const logo of logos) {
    const s = pages.has(titleOf(logo)) ? staff(pages.get(titleOf(logo))) : null;
    if (s) out[logo] = s;
    else missing.push(logo);
  }
  const dir = current ? path.join(DATA, 'depth') : path.join(DATA, 'seasons', String(season), 'depth');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'coaches.json'), JSON.stringify({ season, at: new Date().toISOString(), teams: out }));
  console.log(`${season}: ${Object.keys(out).length} teams${missing.length ? ` (none for ${missing.join(', ')})` : ''}`);
}

const arg = process.argv[2];
const seasons = arg
  ? (() => {
      const [a, b] = arg.split('-').map(Number);
      return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
    })()
  : [CURRENT_SEASON];
for (const season of seasons) await build(season);
