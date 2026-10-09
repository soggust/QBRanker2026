// The compare view's model (libs/ranker/src/engine/compare/player-compare.ts), on the real data: rows
// picked from the grid, then someone from another tab and another season added by a search. The sides
// keep their own colors (removed, switched, raced), every column's leader is the side that stood highest
// in its own season (across tabs, the bigger number, less where less is better), sides on different tabs
// share only the same skills and columns, the career arcs run by career year or by season with the
// compared season ringed, the search ranks names starting with what's typed first and the table's own tab
// next (a headshot on each player's hit), every comparison gets a summary (what each one leads, group
// by group, and where he's clearly the best), a shared link's sides come back in its order on its tab, only the careers files names.json names
// are asked for, and every sport builds a view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, readJson, seasonData, seasonDir, staticDir } from './support/engine.mjs';

const ENTRY = path.join(import.meta.dirname, 'support', 'compare-entry.ts');

// (one bundle per sport, shared by its tests)
const engines = {};
const engineFor = (sport) => (engines[sport] ??= loadEngine(sport, { entry: ENTRY }));

// A stand-in for the grid (the compare view's host: skill-rankings.component.ts) on a tab of the season
// being played, ranked with the default sliders, and for the data service, reading the static files (a
// file that isn't there reads empty, as fetchOrEmpty does)
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
  const orEmpty = (file) => (fs.existsSync(path.join(careersDir, file)) ? readJson(path.join(careersDir, file)) : {});
  // (every file asked for, by name: no asking for one that isn't there)
  const asked = [];
  const data = {
    rows: async (season) => (season === CURRENT_SEASON ? SKILL_UNITS : unitsForSeason(seasonData(seasonDir(sport, season, CURRENT_SEASON), SPORT.dataFiles), season)),
    careers: async (p) => (asked.push(`${p}.json`), orEmpty(`${p}.json`)),
    careerNames: async () => (asked.push('names.json'), orEmpty('names.json')),
  };
  return { host, data, asked, compare: new engine.PlayerCompare(host, data) };
}

// Every side's career in (they load after the side, on their own)
async function careersIn(compare) {
  for (let i = 0; i < 500 && compare.sides.some((s) => s.career === null); i++) await new Promise((r) => setImmediate(r));
  assert.ok(compare.sides.every((s) => s.career !== null), 'every career loaded');
}

// Every column's leaders stood highest in their own seasons (across tabs: the biggest number, the least
// where less is better), and the columns each side leads add up
function checkColumns(engine, view, sides) {
  const tabs = new Set();
  for (const row of view.groups.flatMap((g) => g.rows)) {
    assert.equal(row.cells.length, sides.length, `${row.key}: a cell per side`);
    for (const c of row.cells) if (c.pct !== null) assert.ok(c.pct >= 0 && c.pct <= 1 && c.rank >= 1 && c.rank <= c.of, `${row.key}: a rank out of range`);
    const valued = row.cells.flatMap((c, i) => (c.value === null ? [] : [i]));
    tabs.clear();
    for (const i of valued) tabs.add(sides[i].position);
    const score = tabs.size > 1 ? row.cells.map((c) => (c.value === null ? null : c.lowerBetter ? -c.value : c.value)) : row.cells.map((c) => c.pct);
    assert.deepEqual(row.leaders, engine.leadersOf(score), `${row.key}: the wrong leaders`);
    const known = score.filter((s) => s !== null);
    for (const i of row.leaders) assert.equal(score[i], Math.max(...known), `${row.key}: side ${i} leads without the top`);
  }
  const led = view.wins.reduce((a, w) => a + w, 0);
  assert.equal(view.wins.length, sides.length);
  assert.ok(led <= view.contested, `the sides lead ${led} columns of ${view.contested}`);
}

// A line per side: what it's best at (its edges), then the groups it leads the most columns of (columns it
// does lead, counted as the Stats tab counts them)
function checkSummary(view, sides) {
  assert.equal(view.summary.length, sides.length, 'a line per side');
  view.summary.forEach(({ best, leads }, i) => {
    assert.match(leads, /^leads /, leads);
    assert.equal(leads === 'leads no column outright', view.wins[i] === 0, `${leads} (${view.wins[i]} led)`);
    let read = 0;
    for (const [, title, won, of, named] of leads.matchAll(/(?:leads |; )([A-Z][^;(]*?) in (\d+) of (\d+)(?: categories)? \(([^)]*)\)/g)) {
      const group = view.groups.find((g) => g.title === title);
      assert.ok(group, `${title}: a group`);
      assert.ok(+won <= +of && +of <= group.rows.length, leads);
      for (const label of named.replace(/ and \d+ more$/, '').split(', ')) {
        assert.ok(group.rows.some((r) => r.label === label && r.leaders.length === 1 && r.leaders[0] === i), `${label}: led by side ${i} in ${title}`);
      }
      read++;
    }
    if (view.wins[i]) assert.ok(read > 0, `${leads}: no group read`);
    const edges = view.edges[i].slice(0, 2).map((e) => e.skill);
    assert.equal(best, edges.length ? edges.join(' and ') : null, `side ${i}: best at its edges`);
  });
}

// Someone in a tab's careers file with a season besides the given one
async function withAnotherSeason(data, position, players, season) {
  const careers = await data.careers(position);
  return players.find((p) => (careers[p.gsisId] ?? []).some(([s]) => s !== season));
}

test('nfl: two picked backs, then a quarterback from another season, compared', async () => {
  const engine = await engineFor('nfl');
  const { COMPARE_MAX, COMPARE_COLORS } = engine;
  const { host, data, compare } = harness(engine, 'nfl', 'RB');

  await compare.start(host.playerList.slice(0, 2));
  assert.equal(compare.sides.length, 2);
  assert.deepEqual(compare.sides.map((s) => s.color), COMPARE_COLORS.slice(0, 2), 'picks loaded together take the first colors in order');
  assert.deepEqual(compare.sides.map((s) => s.rank), [1, 2], "the table's top two are #1 and #2");
  checkColumns(engine, compare.view, compare.sides);
  assert.ok(compare.view.radar && compare.view.radar.shapes.length === 2, 'two backs share a radar');
  assert.equal(compare.view.pairs.length, 1);
  assert.equal(compare.view.mixed, false);
  const [a] = compare.sides;
  assert.equal(a.label, `${a.name} ’${String(a.season).slice(-2)}`);
  assert.equal(a.tag, `${a.surname} ’${String(a.season).slice(-2)}`);

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
  assert.equal(compare.view.mixed, true);
  checkColumns(engine, compare.view, compare.sides);
  // (the QB's columns merged in: a passing column he has and the backs haven't)
  const rows = compare.view.groups.flatMap((g) => g.rows);
  assert.ok(rows.some((r) => r.cells[2].text !== '-' && r.cells[0].text === '-' && r.cells[1].text === '-'), 'a column only the QB has');
  assert.ok(rows.some((r) => r.cells[2].text === '-' && r.cells[0].text !== '-'), 'a column only the backs have');
  // (three: who leads the most columns, named, the only one at the top its side)
  checkSummary(compare.view, compare.sides);

  // (the same season again is turned away; a fourth fills it, a fifth is turned away)
  await compare.add('QB', qb.season, qb.gsisId);
  assert.equal(compare.sides.length, 3);
  assert.equal(compare.note, 'That season is already in');
  await compare.add('RB', host.season, host.playerList[2].gsisId);
  assert.equal(compare.sides.length, COMPARE_MAX);
  assert.ok(compare.full);
  await compare.add('RB', host.season, host.playerList[3].gsisId);
  assert.equal(compare.sides.length, COMPARE_MAX, 'no fifth side');
  assert.match(compare.note, /^Up to/);

  // (a season switched in place keeps its color and its career; a side removed rebuilds)
  await careersIn(compare);
  const color = compare.sides[2].color;
  const career = compare.sides[2].career;
  const other = (await data.careers('QB'))[qb.gsisId].find(([season]) => season !== qb.season)[0];
  await compare.add('QB', other, qb.gsisId, 2);
  assert.equal(compare.sides[2].season, other);
  assert.equal(compare.sides[2].color, color);
  assert.equal(compare.sides[2].career, career, 'the same career, not loaded again');
  compare.remove(0);
  assert.equal(compare.sides.length, 3);
  assert.equal(compare.view.wins.length, 3);
  compare.close();
  assert.equal(compare.open, false);
  assert.equal(compare.view, null);
  assert.equal(compare.arcs, null);
});

test('nfl: a back and a receiver share only the same skills and columns, a shared one to the bigger number', async () => {
  const engine = await engineFor('nfl');
  const { host, compare } = harness(engine, 'nfl', 'RB');
  const wr = engine.defaultRanking('WR', engine.presetWeights('WR', 'default'))[0];
  await compare.start(host.playerList.slice(0, 1));
  await compare.add('WR', host.season, wr.gsisId);
  const [rb, receiver] = compare.sides;
  assert.equal(receiver.position, 'WR');
  const { view } = compare;
  assert.equal(view.mixed, true);

  // (a skill is a percentile among his own position: each position's skills are their own rows, tagged with
  // the position, so neither leads a skill of the other's; no radar, since they share none)
  for (const sk of view.skills) {
    const [rbHas, wrHas] = [sk.pcts[0] !== null, sk.pcts[1] !== null];
    assert.ok(rbHas !== wrHas, `${sk.id}: one position's only`);
    assert.equal(sk.tab, rbHas ? 'RB' : 'WR', `${sk.id}: tagged with its position`);
    assert.equal(sk.id, `${rbHas ? 'RB' : 'WR'}|${sk.id.split('|')[1]}`);
    assert.deepEqual(sk.leaders, [], `${sk.id}: nobody leads a skill only one has`);
  }
  assert.equal(view.radar, null, 'no shared skills, no radar');
  assert.equal(view.skills.length, rb.skills.length + receiver.skills.length, 'every skill either has, once');
  assert.deepEqual(view.edges, [[], []], 'no edges across positions');

  // (a column lines up when its key and its label are the same: each value is its own tab's column's)
  const columns = (side) => new Set(host.shownGroups(side.reader, side.position).flatMap((g) => g.stats.map((s) => `${s.key}|${s.label}`)));
  const own = [columns(rb), columns(receiver)];
  const rows = view.groups.flatMap((g) => g.rows);
  for (const row of rows) row.cells.forEach((c, i) => c.text !== '-' && assert.ok(own[i].has(row.key), `${row.key}: not side ${i}'s column`));
  const shared = rows.filter((r) => r.cells.every((c) => c.value !== null));
  assert.ok(shared.length > 0, 'they share a column');
  for (const row of shared) {
    const [x, y] = row.cells.map((c) => c.value);
    const better = row.cells[0].lowerBetter ? (x < y ? 0 : 1) : x > y ? 0 : 1;
    assert.deepEqual(row.leaders, x === y ? [] : [better], `${row.key}: ${x} vs ${y}${row.cells[0].lowerBetter ? ' (less is better)' : ''}`);
  }
  checkColumns(engine, view, compare.sides);
});

test('nfl: the career arcs, by career year or by season, the compared season ringed', async () => {
  const engine = await engineFor('nfl');
  const { host, data, compare } = harness(engine, 'nfl', 'QB');
  const vet = await withAnotherSeason(data, 'QB', host.playerList, host.season);
  await compare.start([vet]);
  await compare.search('peyton manning');
  await compare.pick(compare.hits.find((h) => h.name === 'Peyton Manning'));
  await careersIn(compare);
  const check = (arcs, byYear) => {
    assert.equal(arcs.byYear, byYear);
    arcs.lines.forEach((line, i) => {
      const side = compare.sides[i];
      assert.equal(line.color, side.color);
      assert.equal(line.dots.length, side.career.length, 'a dot per season');
      assert.deepEqual(line.dots.flatMap((d, j) => (d.now ? [side.career[j].season] : [])), [side.season], 'one season ringed: the compared one');
      for (let j = 1; j < line.dots.length; j++) assert.ok(line.dots[j].x > line.dots[j - 1].x, 'left to right');
      for (const d of line.dots) assert.ok(d.x >= arcs.left && d.x <= arcs.width - arcs.right && d.y >= 0 && d.y <= arcs.height, 'on the board');
    });
  };
  // (players: their years in the league along the bottom, everyone's first at the left edge)
  check(compare.arcs, true);
  assert.ok(compare.arcs.lines.every((l) => l.dots[0].x === compare.arcs.left));
  assert.match(compare.arcs.xTicks[0].label, /^Yr 1$/);
  const keys = compare.arcs.lines.map((l) => l.key);

  compare.setArcBy('season');
  check(compare.arcs, false);
  assert.ok(compare.arcs.xTicks.every((t) => /^’\d\d$/.test(t.label)));
  assert.ok(compare.arcs.lines.every((l, i) => l.key !== keys[i]), 'a line switched is a new line (drawn in again)');
  // (Manning's first season sits left of the current QB's)
  assert.ok(compare.arcs.lines[1].dots[0].x < compare.arcs.lines[0].dots[0].x);

  compare.setArcBy('year');
  check(compare.arcs, true);
  assert.deepEqual(compare.arcs.lines.map((l) => l.key), keys);

  // (teams alone: the seasons themselves, until switched)
  const teams = harness(engine, 'nfl', 'TM');
  await teams.compare.start(teams.host.playerList.slice(0, 2));
  await careersIn(teams.compare);
  assert.equal(teams.compare.arcs.byYear, false);
  // (reopened: back to the default)
  compare.setArcBy('season');
  await compare.start(host.playerList.slice(0, 1));
  assert.equal(compare.arcBy, null);
});

test('nfl: the search ranks names starting with what is typed first, then the table tab', async () => {
  const engine = await engineFor('nfl');
  const { compare, host } = harness(engine, 'nfl', 'WR');
  await compare.start([]);
  await compare.search('j');
  assert.deepEqual([compare.hits, compare.searched], [[], false], 'one letter: no search yet');

  for (const query of ['john', 'will', 'son']) {
    await compare.search(query);
    assert.ok(compare.hits.length > 0 && compare.hits.length <= 8, `${query}: up to eight hits`);
    assert.equal(compare.active, 0);
    const tier = (h) => {
      const key = engine.normalize(h.name);
      assert.ok(key.includes(query), `${h.name} doesn't match ${query}`);
      assert.ok(h.best.rank >= 1 && h.best.rank <= h.best.of, `${h.name}: best #${h.best.rank} of ${h.best.of}`);
      return (key.split(' ').some((w) => w.startsWith(query)) ? 2 : 0) + (h.position === host.position ? 1 : 0);
    };
    const tiers = compare.hits.map(tier);
    assert.deepEqual(tiers, [...tiers].sort((x, y) => y - x), `${query}: a prefix first, then the table's tab (${tiers})`);
  }
  // (more words narrow it, in any order)
  await compare.search('brown antonio');
  assert.ok(compare.hits.some((h) => h.name === 'Antonio Brown'));
  assert.ok(compare.hits.every((h) => /antonio/i.test(h.name) && /brown/i.test(h.name)));

  // (typing on before the names load: only the last query's hits)
  const first = compare.search('jerry');
  const last = compare.search('jerry rice');
  await Promise.all([first, last]);
  assert.equal(compare.query, 'jerry rice');
  assert.ok(compare.hits.every((h) => /rice/i.test(h.name)));

  // (a double click on a hit: one side, not two)
  const hit = compare.hits[0];
  await Promise.all([compare.pick(hit), compare.pick(hit)]);
  assert.equal(compare.sides.length, 1, 'the same season once');
  assert.equal(new Set(compare.sides.map((s) => s.key)).size, compare.sides.length);
});

test('nfl: removing and switching sides keeps the colors, and a freed color goes to the next', async () => {
  const engine = await engineFor('nfl');
  const { COMPARE_COLORS } = engine;
  const { host, data, compare } = harness(engine, 'nfl', 'RB');
  await compare.start(host.playerList.slice(0, 3));
  assert.deepEqual(compare.sides.map((s) => s.color), COMPARE_COLORS.slice(0, 3));
  const keys = compare.sides.map((s) => s.key);

  compare.remove(1);
  assert.deepEqual(compare.sides.map((s) => s.color), [COMPARE_COLORS[0], COMPARE_COLORS[2]], 'the others keep theirs');
  assert.deepEqual(compare.sides.map((s) => s.key), [keys[0], keys[2]]);
  assert.equal(compare.view.wins.length, 2);
  await compare.add('RB', host.season, host.playerList[3].gsisId);
  assert.equal(compare.sides[2].color, COMPARE_COLORS[1], 'the freed color, to the next one in');

  // (a season switched while another side is removed: it's still that side that's switched)
  const vet = await withAnotherSeason(data, 'RB', host.playerList.slice(4), host.season);
  await compare.add('RB', host.season, vet.gsisId);
  const switching = compare.sides[3];
  const season = (await data.careers('RB'))[vet.gsisId].find(([s]) => s !== host.season)[0];
  const pending = compare.add('RB', season, vet.gsisId, 3);
  compare.remove(0);
  await pending;
  assert.equal(compare.sides.length, 3);
  assert.equal(compare.sides[2].gsisId, vet.gsisId);
  assert.equal(compare.sides[2].season, season);
  assert.equal(compare.sides[2].color, switching.color);
  assert.ok(!compare.sides.includes(switching));

  // (a side removed while its switch loads: nothing comes back)
  const back = compare.add('RB', host.season, vet.gsisId, 2);
  compare.remove(2);
  await back;
  assert.equal(compare.sides.length, 2);
  assert.ok(compare.sides.every((s) => s.gsisId !== vet.gsisId));
  checkColumns(engine, compare.view, compare.sides);
});

test('the compare helpers: leaders, surnames, names for matching, the summary', async () => {
  const { leadersOf, surname, normalize, summaryOf } = await engineFor('nfl');
  assert.deepEqual(leadersOf([0.5, 0.9, 0.9]), [1, 2], 'a tie at the top: both lead');
  assert.deepEqual(leadersOf([0.5, 0.5]), [], 'all level: nobody leads');
  assert.deepEqual(leadersOf([null, 0.4]), [], 'one alone: nobody leads');
  assert.deepEqual(leadersOf([0.2, null, 0.7]), [2]);
  assert.deepEqual(leadersOf([-3, -1]), [1], 'less is better, negated');
  assert.equal(surname('Kenneth Walker III'), 'Walker');
  assert.equal(surname('Odell Beckham Jr.'), 'Beckham');
  assert.equal(surname("Ja'Marr Chase"), "Chase");
  assert.equal(normalize('Luka Dončić'), 'luka doncic');
  assert.equal(normalize("  Ja'Marr   CHASE "), 'jamarr chase');

  // (each side: its two biggest groups, three columns named, then its two biggest edges)
  const groups = [
    { title: 'Box Score', contested: 6, led: [['Yds', 'TD', 'Att', 'Cmp'], ['Rating', 'Comp %'], []] },
    { title: 'Advanced', contested: 8, led: [['EPA/Play'], ['Success', 'CPOE', 'Y/A', 'aDOT', 'TTT'], []] },
    { title: 'Results', contested: 2, led: [['Wins'], [], []] },
  ];
  const edges = [[{ skill: 'Volume', by: 30 }], [{ skill: 'Accuracy', by: 18 }, { skill: 'Pocket', by: 12 }, { skill: 'Deep', by: 10 }], []];
  assert.deepEqual(summaryOf(groups, edges), [
    { best: 'Volume', leads: 'leads Box Score in 4 of 6 categories (Yds, TD, Att and 1 more); Advanced in 1 of 8 (EPA/Play)' },
    { best: 'Accuracy and Pocket', leads: 'leads Advanced in 5 of 8 categories (Success, CPOE, Y/A and 2 more); Box Score in 2 of 6 (Rating, Comp %)' },
    { best: null, leads: 'leads no column outright' },
  ]);
  assert.deepEqual(summaryOf([], [[], [{ skill: 'Speed', by: 11 }]]), [
    { best: null, leads: 'leads no column outright' },
    { best: 'Speed', leads: 'leads no column outright' },
  ]);
});

test('nfl: a pair from the grid gets a summary that matches the columns', async () => {
  const engine = await engineFor('nfl');
  const { host, compare } = harness(engine, 'nfl', 'QB');
  await compare.start(host.playerList.slice(0, 1));
  assert.equal(compare.view.summary, null, 'one alone: no summary');
  await compare.add('QB', host.season, host.playerList[1].gsisId);
  checkSummary(compare.view, compare.sides);
});

test('nfl: the same player picked again adds his next season down, until none are left', async () => {
  const engine = await engineFor('nfl');
  const { compare } = harness(engine, 'nfl', 'QB');
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

// Every other sport: its first tab's top two compared, someone found by name and added, the arcs drawn
// (a career-only sport: no seasons, no arcs)
for (const sport of ['mlb', 'nba', 'nhl', 'mma']) {
  test(`${sport}: a view, a search and the arcs`, async () => {
    const engine = await engineFor(sport);
    const position = Object.keys(engine.SKILL_STATS)[0];
    const { host, compare } = harness(engine, sport, position);
    await compare.start(host.playerList.slice(0, 2));
    assert.equal(compare.sides.length, 2, `${position}: two sides`);
    checkColumns(engine, compare.view, compare.sides);
    assert.ok(compare.view.skills.length > 0 && compare.view.groups.length > 0, 'skills and columns');
    assert.ok(compare.view.skills.every((s) => s.pcts.every((p) => p === null || (p >= 0 && p <= 1))));
    checkSummary(compare.view, compare.sides);

    const name = host.playerList[2].name;
    await compare.search(engine.surname(name));
    const hit = compare.hits.find((h) => h.name === name);
    assert.ok(hit, `${name} found`);
    await compare.pick(hit);
    assert.equal(compare.sides.length, 3);
    checkColumns(engine, compare.view, compare.sides);
    await careersIn(compare);
    if (engine.SPORT.careerOnly) {
      assert.equal(compare.arcs, null, 'no arcs for a career-only sport');
      assert.ok(compare.sides.every((s) => s.short === '' && s.label === s.name));
    } else {
      assert.ok(compare.arcs && compare.arcs.lines.length >= 1, 'the arcs');
      for (const line of compare.arcs.lines) assert.equal(line.dots.filter((d) => d.now).length, 1, `${line.name}: one season ringed`);
    }
  });
}

test("nfl: a shared link's sides open in its order, on its tab, anyone not found left out", async () => {
  const engine = await engineFor('nfl');
  const { host, data, compare } = harness(engine, 'nfl', 'QB');
  const vet = await withAnotherSeason(data, 'QB', host.playerList, host.season);
  const past = (await data.careers('QB'))[vet.gsisId].find(([s]) => s !== host.season)[0];
  const wr = engine.defaultRanking('WR', engine.presetWeights('WR', 'default'))[0];
  const sides = [
    { position: 'QB', season: past, gsisId: vet.gsisId },
    { position: 'QB', season: host.season, gsisId: 'nobody-here' },
    { position: 'WR', season: host.season, gsisId: wr.gsisId },
    { position: 'QB', season: host.season, gsisId: host.playerList[0].gsisId },
  ];
  await compare.openLinked({ sides, tab: 'stats' });
  assert.equal(compare.open, true);
  assert.equal(compare.tab, 'stats');
  assert.deepEqual(
    compare.sides.map((s) => [s.position, s.season, s.gsisId]),
    [sides[0], sides[2], sides[3]].map((s) => [s.position, s.season, s.gsisId]),
    "the link's order (a season from another year loads last, still first), the unknown id skipped",
  );
  assert.equal(compare.note, '', 'nothing said about the one left out');
  // (an unknown tab: Overview; more than four: the first four)
  const five = host.playerList.slice(0, 5).map((p) => ({ position: 'QB', season: host.season, gsisId: p.gsisId }));
  await compare.openLinked({ sides: five, tab: 'nope' });
  assert.equal(compare.tab, 'overview');
  assert.deepEqual(compare.sides.map((s) => s.gsisId), five.slice(0, engine.COMPARE_MAX).map((s) => s.gsisId));
});

test('nfl: a player hit carries his headshot, a team hit none', async () => {
  const engine = await engineFor('nfl');
  const { host, compare } = harness(engine, 'nfl', 'QB');
  host.headshot = (unit, w) => (unit.id ? `shot/${unit.id}/${w}` : null);
  await compare.start([]);
  await compare.search('peyton manning');
  const manning = compare.hits.find((h) => h.name === 'Peyton Manning');
  assert.match(manning.photo, /^shot\/\d+\/96$/);
  await compare.search('new york jets');
  const jets = compare.hits.find((h) => h.position === 'TM');
  assert.ok(jets, 'the Jets found');
  assert.equal(jets.photo, null);
  assert.ok(!('headshotId' in jets), 'only the hit, not the index entry');
});

test('the search asks only for the careers files names.json names (a career-only sport: none)', async () => {
  for (const sport of ['nfl', 'mma']) {
    const engine = await engineFor(sport);
    const position = Object.keys(engine.SKILL_STATS)[0];
    const { compare, asked, data, host } = harness(engine, sport, position);
    await compare.start([]);
    await compare.search(engine.surname(host.playerList[0].name));
    assert.ok(compare.hits.length, `${sport}: found`);
    const names = engine.SPORT.careerOnly ? {} : await data.careerNames();
    const files = asked.filter((f) => f !== 'names.json');
    assert.deepEqual(files.sort(), Object.keys(names).map((p) => `${p}.json`).sort(), `${sport}: ${files}`);
    if (engine.SPORT.careerOnly) assert.deepEqual(asked, [], 'mma: no careers files at all');
  }
});

test('nfl: two backs and a receiver: the backs share their skills, the receiver keeps his own', async () => {
  const engine = await engineFor('nfl');
  const { host, compare } = harness(engine, 'nfl', 'RB');
  const wr = engine.defaultRanking('WR', engine.presetWeights('WR', 'default'))[0];
  await compare.start(host.playerList.slice(0, 2));
  await compare.add('WR', host.season, wr.gsisId);
  const { skills } = compare.view;
  const rbReceiving = skills.find((s) => s.tab === 'RB' && /receiv/i.test(s.name));
  assert.ok(rbReceiving, 'the backs have a receiving skill');
  assert.equal(rbReceiving.pcts[2], null, "the receiver isn't on the backs' receiving row");
  for (const i of rbReceiving.leaders) assert.ok(i < 2, 'only a back can lead the backs at it');
  for (const s of skills.filter((k) => k.tab === 'WR')) {
    assert.deepEqual([s.pcts[0], s.pcts[1]], [null, null], `${s.name}: the receiver's alone`);
  }
});
