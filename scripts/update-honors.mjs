// Rebuilds the honors behind the badges beside a player's name, from Wikipedia:
//   src/app/all-pro.json   AP All-Pro first and second teams ("<year> All-Pro Team" pages; the AP picks
//                          are tagged "AP" / "AP-t" for first team, "AP-2" / "AP-2t" for second)
//   src/app/pro-bowl.json  Pro Bowl selections ("<year+1> Pro Bowl", "Pro Bowl Games" from the 2022
//                          season on): starters and reserves, including those who sat out injured or
//                          for the Super Bowl, plus alternates named as replacements; the way Pro
//                          Football Reference and the teams count Pro Bowl nods. The 2013-2015
//                          games (drafted teams) only list who played, replacements included, so a
//                          player voted in who then withdrew is missing for those three seasons.
// Only the positions the app has tabs for: QB, RB, WR, TE, K, P (and All-Pro's Flex, RB / WR / TE).
//
// Usage: npm run update-honors        (every season from 2000 to last season)
//        FROM=2024 npm run update-honors
//
// Each name is checked against that season's player lists (src/StaticData/seasons/<year>/), and any
// that don't match are printed, so a spelling difference can be added to NAME_FIXES.

import { readFile, writeFile } from 'node:fs/promises';

const FIRST_SEASON = Number(process.env.FROM ?? 2000);
const LAST_SEASON = 2025;
const SEASONS_DIR = new URL('../src/StaticData/seasons/', import.meta.url);
const ALL_PRO_FILE = new URL('../src/app/all-pro.json', import.meta.url);
const PRO_BOWL_FILE = new URL('../src/app/pro-bowl.json', import.meta.url);
const USER_AGENT = 'NFLRanker-data-script/1.0 (https://qbranker2026.web.app)';

// Wikipedia's name -> the name in our data, where they differ beyond spacing and punctuation
const NAME_FIXES = {
  'Chad Ochocinco': 'Chad Johnson',
  'Michael Vick': 'Mike Vick',
  'Pat McAfee': 'Patrick McAfee',
};

// Position cell -> the tab it belongs to (FLEX: whichever of RB / WR / TE the player is on)
const POSITIONS = [
  [/quarterback/i, 'QB'],
  // Fullbacks count as running backs (a fullback gets the badge if he's on the RB tab)
  [/running back|halfback|fullback/i, 'RB'],
  [/wide receiver/i, 'WR'],
  [/tight end/i, 'TE'],
  [/flex|offensive backfield/i, 'FLEX'],
  [/placekicker|kicker/i, 'K'],
  [/punter/i, 'P'],
];

// Letters only, accents and suffixes dropped: "A. J. Brown" and "A.J. Brown", "Martín" and "Martin",
// "Steve Smith Sr." and "Steve Smith" match
const key = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]?\s+(jr|sr|ii|iii|iv)\.?$/, '')
    .replace(/[^a-z]/g, '');

// "{{Small|18}} '''[[Rod Smith (wide receiver)|Rod Smith]]''', [[Denver Broncos]] (AP-2)" -> plain text
function plain(text) {
  return text
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function wikitext(title) {
  const url = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

// Table rows as [position, ...cells], a cell's wrapped lines joined back onto it
function tableRows(text) {
  const rows = [];
  for (const block of text.split(/\n\|-/)) {
    const cells = [];
    for (const line of block.split('\n')) {
      if (/^\|[}-]|^[{!]/.test(line)) continue;
      if (line.startsWith('|')) cells.push(line.replace(/^\|\s*((align|style)=[^|]*\|:?)?/, ''));
      else if (cells.length && line.trim()) cells[cells.length - 1] += `<br>${line}`;
    }
    const position = cells.length > 1 && POSITIONS.find(([test]) => test.test(plain(cells[0])))?.[1];
    if (position) rows.push([position, ...cells.slice(1)]);
  }
  return rows;
}

// A cell's entries: "Name, Team ..." (anything without a team after a comma isn't a player)
const entries = (cell) => cell.split(/<br\s*\/?>/i).filter((entry) => plain(entry).includes(','));
const entryName = (entry) => {
  const name = plain(entry).split(',')[0].trim();
  return NAME_FIXES[name] ?? name;
};

// [{ name, position, team: 1 | 2 }] for the AP's picks
async function allProPicks(season) {
  const picks = [];
  for (const [position, ...cells] of tableRows(await wikitext(`${season} All-Pro Team`))) {
    for (const entry of cells.flatMap(entries)) {
      // (some pages leave a comma after the tags)
      const tags = plain(entry).match(/\(([^()]*)\)[\s,;]*$/)?.[1].split(/\s*,\s*/) ?? [];
      const team = tags.some((t) => /^AP(-t)?$/.test(t)) ? 1 : tags.some((t) => /^AP-2t?$/.test(t)) ? 2 : 0;
      if (team) picks.push({ name: entryName(entry), position, team });
    }
  }
  return picks;
}

// [{ name, position }] for the season's Pro Bowl: starters and reserves, and alternates named as
// replacements (the third column)
async function proBowlPicks(season) {
  const title = season >= 2022 ? `${season + 1} Pro Bowl Games` : `${season + 1} Pro Bowl`;
  const text = await wikitext(title);
  // 2013-2015 (drafted teams): bullet lists of {{NFLplayer|number|Name|(Team)}} under position headings
  if (text.includes('{{NFLplayer')) {
    const picks = [];
    let position = null;
    for (const line of text.split('\n')) {
      if (/^'''/.test(line)) position = POSITIONS.find(([test]) => test.test(plain(line)))?.[1] ?? null;
      const name = line.match(/^\*\s*\{\{NFLplayer\|[^|]*\|\s*([^|}]+?)\s*[|}]/i)?.[1];
      if (position && name) picks.push({ name: NAME_FIXES[name] ?? name, position });
    }
    return picks;
  }
  const picks = [];
  for (const [position, ...cells] of tableRows(text)) {
    cells.slice(0, 3).forEach((cell, column) => {
      for (const entry of entries(cell)) {
        if (column === 2 && !/replacement/i.test(entry)) continue;
        picks.push({ name: entryName(entry), position });
      }
    });
  }
  return picks;
}

async function seasonLists(season) {
  const skill = JSON.parse(await readFile(new URL(`${season}/skill-players.json`, SEASONS_DIR), 'utf8'));
  const qbs = JSON.parse(await readFile(new URL(`${season}/games.json`, SEASONS_DIR), 'utf8'));
  return { QB: qbs, RB: skill.RB, WR: skill.WR, TE: skill.TE, K: skill.K, P: skill.P };
}

// A pick's tab and the player's name as listed there (null when he isn't in our lists)
function listed(lists, { name, position }) {
  const tabs = position === 'FLEX' ? ['RB', 'WR', 'TE'] : [position];
  for (const tab of tabs) {
    const player = lists[tab].find((p) => key(p.name) === key(name));
    if (player) return { tab, name: player.name };
  }
  return null;
}

async function main() {
  // { "2019": { "QB": { "Lamar Jackson": 1, "Russell Wilson": 2 }, ... } }: best team per player and tab
  const allPro = {};
  // { "2019": { "QB": ["Lamar Jackson", ...], ... } }
  const proBowl = {};
  for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
    const lists = await seasonLists(season);
    const missed = [];

    const ap = (allPro[season] = {});
    for (const pick of await allProPicks(season)) {
      const found = listed(lists, pick);
      if (!found) {
        if (pick.position !== 'FLEX') missed.push(`AP ${pick.name} (${pick.position})`);
        continue;
      }
      const tab = (ap[found.tab] ??= {});
      tab[found.name] = Math.min(tab[found.name] ?? 2, pick.team);
    }

    const pb = (proBowl[season] = {});
    for (const pick of await proBowlPicks(season)) {
      const found = listed(lists, pick);
      if (!found) {
        missed.push(`PB ${pick.name} (${pick.position})`);
        continue;
      }
      const tab = (pb[found.tab] ??= []);
      if (!tab.includes(found.name)) tab.push(found.name);
    }

    const count = (byTab) => Object.values(byTab).reduce((n, t) => n + Object.keys(t).length, 0);
    console.log(
      `${season}: ${count(ap)} All-Pros, ${count(pb)} Pro Bowlers${missed.length ? `; not in our lists: ${missed.join(', ')}` : ''}`,
    );
  }

  // Keep seasons outside this run as they were
  const merge = async (file, fresh) => {
    const old = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
    await writeFile(file, JSON.stringify({ ...old, ...fresh }, null, 2) + '\n');
  };
  await merge(ALL_PRO_FILE, allPro);
  await merge(PRO_BOWL_FILE, proBowl);
  console.log('Wrote all-pro.json and pro-bowl.json');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
