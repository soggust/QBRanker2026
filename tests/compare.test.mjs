// The compare view's model (libs/ranker/src/engine/compare/player-compare.ts), on the real data: two
// rows picked from the grid, then someone from another tab and another season added by a search. The
// sides keep their own colors, every column's leader is the side that stood highest in its own season,
// the columns each side leads add up, another tab's columns merge in (a dash where a side's tab hasn't
// one), and the search finds anyone, any tab, by name (accents and punctuation aside).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, readJson, seasonData, seasonDir, staticDir } from './support/engine.mjs';

const ENTRY = path.join(import.meta.dirname, 'support', 'compare-entry.ts');

// A stand-in for the grid (the compare view's host: skill-rankings.component.ts) on a tab of the season
// being played, ranked with the default sliders, and for the data service, reading the static files
function harness(engine, sport, position) {
  const { TabRanker, StatReader, SKILL_STATS, skillGroups, presetWeights, emptyIn, SKILL_UNITS, CURRENT_SEASON, DEFAULT_SETTINGS, unitsForSeason, SPORT } = engine;
  const settings = { ...DEFAULT_SETTINGS };
  const positions = {
    settings,
    statHiddenState: {},
    skillHiddenGroups: () => ({}),
    getWeights: (p) => presetWeights(p, 'default'),
    isStatHidden: () => false,
    orderedGroups: (_p, groups) => groups,
    orderedStats: (_p, group) => group.stats,
    seasonUnitOrder: () => null,
  };
  const tab = (p) => ({ position: p, stats: SKILL_STATS[p], groups: skillGroups(p), hidden: {}, weights: presetWeights(p, 'default') });
  const ranker = new TabRanker(positions, { firstSeasons: async () => ({}) }, () => tab(position), () => {});
  const readerOf = (context) =>
    new StatReader({
      position: context.position,
      settings,
      rows: context.rows,
      list: context.list,
      tableSeason: false,
      season: context.season,
      empty: context.empty,
      weights: ranker.mixWeights(context.position),
    });
  const host = {
    position,
    season: CURRENT_SEASON,
    stats: SKILL_STATS[position],
    colorValues: false,
    playerList: [],
    reader: null,
    readerFor: (context) => (context ? readerOf(context) : host.reader),
    seasonContext(season, rows, p = position) {
      const context = { season, rows, list: [], empty: (key) => emptyIn(rows[p] ?? [], key), position: p };
      context.list = host.rankedIn(context, ranker.listed({ [p]: rows[p] }, season, p));
      return context;
    },
    rankedIn: (context, players) => ranker.ranked(readerOf(context), players, context.position, context.rows),
    shownGroups: (reader, p = position) => ranker.shownGroups(reader, p).groups,
    headshot: () => null,
    noHeadshot: () => {},
  };
  const table = host.seasonContext(CURRENT_SEASON, SKILL_UNITS, position);
  host.playerList = table.list;
  host.reader = readerOf(table);
  const careersDir = path.join(staticDir(sport), 'careers');
  const data = {
    rows: async (season) => (season === CURRENT_SEASON ? SKILL_UNITS : unitsForSeason(seasonData(seasonDir(sport, season, CURRENT_SEASON), SPORT.dataFiles), season)),
    careers: async (p) => (fs.existsSync(path.join(careersDir, `${p}.json`)) ? readJson(path.join(careersDir, `${p}.json`)) : {}),
    careerNames: async () => readJson(path.join(careersDir, 'names.json')),
  };
  return { host, data };
}

// Every column's leaders stood highest in their own seasons, and the columns each side leads add up
function checkColumns(view, sides) {
  let led = 0;
  for (const group of view.groups) {
    for (const row of group.rows) {
      assert.equal(row.cells.length, sides.length, `${row.key}: a cell per side`);
      const pcts = row.cells.map((c) => c.pct).filter((p) => p !== null);
      for (const i of row.leaders) assert.equal(row.cells[i].pct, Math.max(...pcts), `${row.key}: side ${i} leads without the top percentile`);
      for (const c of row.cells) if (c.pct !== null) assert.ok(c.pct >= 0 && c.pct <= 1 && c.rank >= 1 && c.rank <= c.of, `${row.key}: a rank out of range`);
    }
  }
  for (const w of view.wins) led += w;
  assert.ok(led <= view.contested, `the sides lead ${led} columns of ${view.contested}`);
}

test('nfl: two picked backs, then a quarterback from another season, compared', async () => {
  const engine = await loadEngine('nfl', { entry: ENTRY });
  const { PlayerCompare, COMPARE_MAX } = engine;
  const { host, data } = harness(engine, 'nfl', 'RB');
  const compare = new PlayerCompare(host, data);

  await compare.start(host.playerList.slice(0, 2));
  assert.equal(compare.sides.length, 2);
  assert.equal(new Set(compare.sides.map((s) => s.color)).size, 2, 'picks loaded together share a color');
  assert.deepEqual(compare.sides.map((s) => s.rank), [1, 2], 'the table\'s top two are #1 and #2');
  checkColumns(compare.view, compare.sides);
  assert.ok(compare.view.radar && compare.view.radar.shapes.length === 2, 'two backs share a radar');
  assert.equal(compare.view.pairs.length, 1);

  // (a search: anyone, any tab, accents and case aside)
  await compare.search('TOM brady');
  const brady = compare.hits.find((h) => h.name === 'Tom Brady');
  assert.ok(brady, 'Tom Brady found from the RB tab');
  assert.equal(brady.position, 'QB');
  assert.ok(brady.best.season < engine.CURRENT_SEASON && brady.best.rank >= 1);
  await compare.pick(brady);
  assert.equal(compare.sides.length, 3);
  const qb = compare.sides[2];
  assert.equal(qb.position, 'QB');
  assert.equal(qb.season, brady.best.season);
  assert.equal(compare.query, '', 'a pick clears the search');
  checkColumns(compare.view, compare.sides);
  // (the QB's columns merged in: a passing column he has and the backs haven't)
  const rows = compare.view.groups.flatMap((g) => g.rows);
  assert.ok(rows.some((r) => r.cells[2].text !== '-' && r.cells[0].text === '-' && r.cells[1].text === '-'), 'a column only the QB has');
  assert.ok(rows.some((r) => r.cells[2].text === '-' && r.cells[0].text !== '-'), 'a column only the backs have');

  // (the same season again is turned away; a fourth fills it, a fifth is turned away)
  await compare.add('QB', qb.season, qb.gsisId);
  assert.equal(compare.sides.length, 3);
  await compare.add('RB', host.season, host.playerList[2].gsisId);
  assert.equal(compare.sides.length, COMPARE_MAX);
  assert.ok(compare.full);
  await compare.add('RB', host.season, host.playerList[3].gsisId);
  assert.equal(compare.sides.length, COMPARE_MAX, 'no fifth side');

  // (a season switched in place keeps its color; a side removed rebuilds)
  const color = compare.sides[2].color;
  const other = (await data.careers('QB'))[qb.gsisId].find(([season]) => season !== qb.season)[0];
  await compare.add('QB', other, qb.gsisId, 2);
  assert.equal(compare.sides[2].season, other);
  assert.equal(compare.sides[2].color, color);
  compare.remove(0);
  assert.equal(compare.sides.length, 3);
  assert.equal(compare.view.wins.length, 3);
  compare.close();
  assert.equal(compare.open, false);
});

test('the compare helpers: leaders, surnames, names for matching', async () => {
  const { leadersOf, surname, normalize } = await loadEngine('nfl', { entry: ENTRY });
  assert.deepEqual(leadersOf([0.5, 0.9, 0.9]), [1, 2], 'a tie at the top: both lead');
  assert.deepEqual(leadersOf([0.5, 0.5]), [], 'all level: nobody leads');
  assert.deepEqual(leadersOf([null, 0.4]), [], 'one alone: nobody leads');
  assert.deepEqual(leadersOf([0.2, null, 0.7]), [2]);
  assert.equal(surname('Kenneth Walker III'), 'Walker');
  assert.equal(surname('Odell Beckham Jr.'), 'Beckham');
  assert.equal(surname('Ja\'Marr Chase'), 'Chase');
  assert.equal(normalize('Luka Dončić'), 'luka doncic');
  assert.equal(normalize("  Ja'Marr   CHASE "), 'jamarr chase');
});

test('nfl: the same player picked again adds his next season down, until none are left', async () => {
  const engine = await loadEngine('nfl', { entry: ENTRY });
  const { PlayerCompare } = engine;
  const { host, data } = harness(engine, 'nfl', 'QB');
  const compare = new PlayerCompare(host, data);
  await compare.start([]);
  await compare.search('peyton manning');
  const hit = compare.hits.find((h) => h.name === 'Peyton Manning');
  await compare.pick(hit);
  await compare.search('peyton manning');
  await compare.pick(compare.hits.find((h) => h.name === 'Peyton Manning'));
  assert.equal(compare.sides.length, 2);
  const [first, second] = compare.sides.map((s) => s.season);
  assert.equal(first, hit.best.season);
  const below = hit.seasons.filter((s) => s < hit.best.season).at(-1);
  assert.equal(second, below ?? hit.seasons.find((s) => s > hit.best.season), 'the next season down');
  assert.equal(compare.note, '', 'no "already in" while he has others');
});
