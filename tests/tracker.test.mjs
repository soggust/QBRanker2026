// The Tracker (libs/ranker/src/engine/account/tracker): a pinned comparison's snapshot (each side's rank,
// score, skills and the compare view's columns), what's changed since (read off the texts the view writes,
// better or worse by the column's way), the days it's been looked at (a point a day, unchanged ones not
// kept), the rank chart (#1 on top, a step a side), the link's bits, and a pin read on the real data: the
// same as the compare view ranks it, with the sliders the link carries (not the grid's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, readJson, seasonData, seasonDir, staticDir } from './support/engine.mjs';

const ENTRY = path.join(import.meta.dirname, 'support', 'tracker-entry.ts');
let engine;
const load = async () => (engine ??= await loadEngine('nfl', { entry: ENTRY }));

// (a snapshot's makings, as the compare view has them: two sides, a skill each and two columns)
const side = (key, rank, pct) => ({ key, position: 'QB', season: 2026, gsisId: key.split('/')[2], name: `QB ${key}`, tabLabel: 'QB', rank, of: 40, pct });
const cell = (text, value, pct, lowerBetter = false) => ({ text, value, pct, lowerBetter });
const view = (cells) => ({
  skills: [{ id: 'QB|accuracy', name: 'Accuracy', tab: null, pcts: cells.acc }],
  groups: [
    {
      title: 'Box Score',
      rows: [
        { key: 'passYards|Pass Yds', label: 'Pass Yds', name: 'Passing yards', cells: cells.yds },
        { key: 'ints|INT', label: 'INT', name: 'Interceptions', cells: cells.ints },
      ],
    },
    { title: 'Advanced', rows: [{ key: 'cpoe|CPOE', label: 'CPOE', name: 'Completion % over expected', cells: cells.cpoe }] },
  ],
});

test('a snapshot keeps each side\'s numbers in the view\'s order, rounded, a missing column none', async () => {
  const { snapshotOf } = await load();
  const snap = snapshotOf(
    [side('QB/2026/a', 3, 0.94871), side('QB/2026/b', 12, 0.7)],
    view({
      acc: [0.91234, null],
      yds: [cell('1,204', 1204, 0.9), cell('980', 980, 0.6)],
      ints: [cell('2', 2, 0.8, true), cell('-', null, null, true)],
      cpoe: [cell('3.4', 3.4, 0.85), cell('-1.2', -1.2, 0.3)],
    }),
    [1.23456, null],
    1000,
  );
  assert.equal(snap.at, 1000);
  assert.deepEqual(snap.skills, [{ id: 'QB|accuracy', name: 'Accuracy', tab: null }]);
  assert.deepEqual(
    snap.rows.map((r) => [r.key, r.group, r.lower]),
    [
      ['passYards|Pass Yds', 'Box Score', false],
      ['ints|INT', 'Box Score', true],
      ['cpoe|CPOE', 'Advanced', false],
    ],
  );
  const [a, b] = snap.sides;
  assert.equal(a.pct, 0.949);
  assert.equal(a.score, 1.235);
  assert.equal(b.score, null);
  assert.deepEqual(a.skills, [0.912]);
  assert.deepEqual(b.skills, [null]);
  assert.deepEqual(a.stats[0], { v: 1204, p: 0.9, t: '1,204' });
  // (a column he hasn't: none, not a dash)
  assert.equal(b.stats[1], null);
  assert.equal(a.id, 'a');
});

test('a column\'s change reads off its texts; better is up, or down where less is better', async () => {
  const { statCell, skillCell, textNumber, signed } = await load();
  assert.deepEqual(textNumber('4,123'), { n: 4123, places: 0 });
  assert.deepEqual(textNumber('67.5%'), { n: 67.5, places: 1 });
  assert.deepEqual(textNumber('.312'), { n: 0.312, places: 3 });
  assert.deepEqual(textNumber('−0.05'), { n: -0.05, places: 2 });
  assert.equal(textNumber('3-1'), null);
  assert.equal(textNumber('-'), null);
  assert.equal(signed(1.2, 1), '+1.2');
  assert.equal(signed(-3), '−3');
  assert.equal(signed(0.0001, 2), '0.00');

  // (a rate written as a percent moves by its points, not the fraction behind it)
  const pct = statCell({ v: 0.663, p: 0.5, t: '66.3%' }, { v: 0.675, p: 0.6, t: '67.5%' }, false);
  assert.deepEqual([pct.text, pct.then, pct.delta, pct.dir, pct.good], ['67.5%', '66.3%', '+1.2', 'up', true]);
  // (more interceptions: up, and worse)
  const ints = statCell({ v: 2, p: 0.8, t: '2' }, { v: 5, p: 0.4, t: '5' }, true);
  assert.deepEqual([ints.delta, ints.dir, ints.good], ['+3', 'up', false]);
  // (thousands)
  assert.equal(statCell({ v: 980, p: 0, t: '980' }, { v: 1204, p: 0, t: '1,204' }, false).delta, '+224');
  // (no change: nothing lit)
  const same = statCell({ v: 3, p: 0, t: '3.0' }, { v: 3, p: 0, t: '3.0' }, false);
  assert.deepEqual([same.delta, same.dir, same.good], ['0.0', null, null]);
  // (text that isn't a number: the way from the values, no number written)
  const record = statCell({ v: 0.5, p: 0, t: '2-2' }, { v: 0.6, p: 0, t: '3-2' }, false);
  assert.deepEqual([record.delta, record.dir, record.good], [null, 'up', true]);
  // (one side of it missing: nothing to tell)
  assert.equal(statCell(null, { v: 1, p: 0, t: '1' }, false).dir, null);

  const skill = skillCell(0.71, 0.84);
  assert.deepEqual([skill.text, skill.then, skill.delta, skill.good], ['84', '71', '+13', true]);
  assert.equal(skillCell(0.8, 0.62).good, false);
  assert.equal(skillCell(null, 0.5).delta, null);
});

test('now against then: sides by their key, the moves, columns either one has', async () => {
  const { snapshotOf, trackView } = await load();
  const then = snapshotOf(
    [side('QB/2026/a', 3, 0.95), side('QB/2026/b', 12, 0.7)],
    view({ acc: [0.9, 0.6], yds: [cell('900', 900, 0.9), cell('700', 700, 0.6)], ints: [cell('1', 1, 0.9, true), cell('3', 3, 0.3, true)], cpoe: [cell('3.4', 3.4, 0.85), cell('-1.2', -1.2, 0.3)] }),
    [1.2, 0.3],
    1,
  );
  // (b's a place up, a's two down; the CPOE column gone, a new one in)
  // (now's in now's order: b first)
  const nowView = view({ acc: [0.66, 0.85], yds: [cell('1,000', 1000, 0.7), cell('1,100', 1100, 0.8)], ints: [cell('3', 3, 0.5, true), cell('4', 4, 0.4, true)], cpoe: [] });
  nowView.groups[1].rows = [{ key: 'epa|EPA', label: 'EPA', name: 'EPA per play', cells: [cell('0.02', 0.02, 0.5), cell('0.12', 0.12, 0.8)] }];
  const now = snapshotOf([side('QB/2026/b', 11, 0.73), side('QB/2026/a', 5, 0.9)], nowView, [0.4, 0.9], 2);
  const t = trackView(then, now);
  assert.deepEqual(
    t.sides.map((s) => [s.key, s.moved, s.scoreMove]),
    [
      ['QB/2026/b', 1, 0.1],
      ['QB/2026/a', -2, -0.3],
    ],
  );
  assert.deepEqual(t.skills[0].cells.map((c) => c.delta), ['+6', '−5']);
  const row = (key) => t.stats.find((r) => r.key === key);
  assert.deepEqual(row('passYards|Pass Yds').cells.map((c) => c.delta), ['+300', '+200']);
  assert.deepEqual(row('ints|INT').cells.map((c) => c.good), [null, false]);
  // (a column only now, one only then: each there, the other side of it a dash)
  assert.deepEqual(row('epa|EPA').cells.map((c) => [c.text, c.then]), [['0.02', '-'], ['0.12', '-']]);
  assert.deepEqual(row('cpoe|CPOE').cells.map((c) => [c.text, c.then]), [['-', '-1.2'], ['-', '3.4']]);

  // (not read now: then's sides, no moves)
  const alone = trackView(then, null);
  assert.deepEqual(alone.sides.map((s) => [s.key, s.moved, s.now]), [['QB/2026/a', null, null], ['QB/2026/b', null, null]]);
  assert.ok(alone.stats.every((r) => r.cells.every((c) => c.text === '-')));
  // (one gone since: still a side, with nothing now)
  const gone = trackView(then, { ...now, sides: now.sides.slice(0, 1) });
  assert.deepEqual(gone.sides.map((s) => [s.key, s.now ? 'now' : null]), [['QB/2026/b', 'now'], ['QB/2026/a', null]]);
});

test('a point a day it\'s looked at: today\'s again replaces it, an unchanged one isn\'t kept, the oldest go past the cap', async () => {
  const { addPoint, pointOf, dayOf, snapshotOf } = await load();
  const at = new Date(2026, 9, 1, 15).getTime();
  const base = snapshotOf([side('QB/2026/a', 3, 0.95)], null, [1], at);
  const point = (d, r, s = 1) => ({ d, sides: [{ k: 'QB/2026/a', r, o: 40, p: 0.9, s }] });
  assert.equal(dayOf(at), '2026-10-01');
  assert.deepEqual(pointOf(base).sides, [{ k: 'QB/2026/a', r: 3, o: 40, p: 0.95, s: 1 }]);
  // (the pin's own day, nothing new: nothing kept)
  assert.equal(addPoint([], base, { ...pointOf(base), d: '2026-10-01' }), null);
  // (unchanged since the pin: not kept)
  assert.equal(addPoint([], base, point('2026-10-03', 3)), null);
  // (moved: kept)
  let history = addPoint([], base, point('2026-10-03', 5));
  assert.deepEqual(history.map((p) => [p.d, p.sides[0].r]), [['2026-10-03', 5]]);
  // (looked at again that day, moved again: replaced)
  history = addPoint(history, base, point('2026-10-03', 6));
  assert.deepEqual(history.map((p) => [p.d, p.sides[0].r]), [['2026-10-03', 6]]);
  // (the same again: nothing to save)
  assert.equal(addPoint(history, base, point('2026-10-03', 6)), null);
  // (and back to the pin's: that day's dropped)
  assert.deepEqual(addPoint(history, base, point('2026-10-03', 3)), []);
  // (a new day, a new point; the cap keeps the latest)
  history = addPoint(history, base, point('2026-10-04', 4));
  assert.equal(history.length, 2);
  assert.equal(addPoint(history, base, point('2026-10-05', 4)), null);
  history = addPoint(history, base, point('2026-10-05', 2), 2);
  assert.deepEqual(history.map((p) => p.d), ['2026-10-04', '2026-10-05']);
  // (a score's move alone counts)
  assert.ok(addPoint(history, base, point('2026-10-06', 2, 1.5)));
});

test('another sport\'s pin (All): its ranks as last seen there, its numbers the pin\'s; never looked at, none', async () => {
  const { lastSeen, trackView, snapshotOf, dayMs } = await load();
  const at = new Date(2026, 9, 1, 15).getTime();
  const base = snapshotOf([side('QB/2026/a', 3, 0.95), side('QB/2026/b', 12, 0.7)], null, [1, 0.5], at);
  assert.equal(lastSeen(base, []), null);
  const history = [
    { d: '2026-10-03', sides: [{ k: 'QB/2026/a', r: 5, o: 40, p: 0.9, s: 0.8 }, { k: 'QB/2026/b', r: 12, o: 40, p: 0.7, s: 0.5 }] },
    // (the latest: b gone from it (not found that day), a up to #2)
    { d: '2026-10-07', sides: [{ k: 'QB/2026/a', r: 2, o: 41, p: 0.97, s: 1.4 }] },
  ];
  const seen = lastSeen(base, history);
  assert.equal(seen.at, dayMs('2026-10-07'));
  assert.deepEqual(
    seen.sides.map((s) => [s.key, s.rank, s.of, s.pct, s.score]),
    [['QB/2026/a', 2, 41, 0.97, 1.4]],
  );
  assert.deepEqual(seen.rows, base.rows);
  const view = trackView(base, seen);
  assert.deepEqual(
    view.sides.map((s) => [s.key, s.moved]),
    [
      ['QB/2026/a', 1],
      ['QB/2026/b', null],
    ],
  );
});

test('the rank chart: #1 on top, a step a side from the pin to now, the pin\'s day marked', async () => {
  const { trendChart, snapshotOf, rankTicks, TREND } = await load();
  const at = new Date(2026, 8, 20, 10).getTime();
  const base = snapshotOf([side('QB/2026/a', 3, 0.95), side('QB/2026/b', 12, 0.7)], null, [1, 0.2], at);
  const sides = [
    { key: 'QB/2026/a', name: 'A', color: '#8ab4e0' },
    { key: 'QB/2026/b', name: 'B', color: '#e3cb8f' },
  ];
  // (only the pin so far: flat lines across, one tick)
  const single = trendChart(base, [], null, sides, 400, 150);
  assert.ok(single.single);
  assert.equal(single.xTicks.length, 1);
  assert.match(single.lines[0].path, /^M34,[\d.]+ H370$/);

  const history = [{ d: '2026-09-27', sides: [{ k: 'QB/2026/a', r: 5, o: 40, p: 0.9, s: 0.8 }, { k: 'QB/2026/b', r: 9, o: 40, p: 0.8, s: 0.5 }] }];
  const now = snapshotOf([side('QB/2026/a', 2, 0.97), side('QB/2026/b', 15, 0.62)], null, [1.4, 0.1], new Date(2026, 9, 9, 18).getTime());
  const chart = trendChart(base, history, now, sides, 400, 150);
  assert.ok(!chart.single);
  assert.equal(chart.lines.length, 2);
  const a = chart.lines[0];
  assert.equal(a.dots.length, 3);
  assert.ok(a.dots[0].pinned && a.dots[2].now);
  // (left to right in time, the pin at the left edge, now at the right)
  assert.equal(a.dots[0].x, TREND.left);
  assert.equal(a.dots[2].x, 400 - TREND.right);
  assert.ok(a.dots[0].x < a.dots[1].x && a.dots[1].x < a.dots[2].x);
  // (#2 above #3 above #5; held level, then a step)
  assert.ok(a.dots[2].y < a.dots[0].y && a.dots[0].y < a.dots[1].y);
  assert.match(a.path, /^M[\d.]+,[\d.]+ H[\d.]+ V[\d.]+ H[\d.]+ V[\d.]+$/);
  assert.equal(chart.pinX, TREND.left);
  assert.equal(chart.xTicks.at(-1).label, 'Now');
  // (every rank on the board: the deepest above the bottom)
  const deepest = Math.max(...chart.lines.flatMap((l) => l.dots.map((d) => d.y)));
  assert.ok(deepest <= 150 - TREND.bottom);
  assert.match(a.dots[0].title, /#3 of 40, when pinned/);
  // (today's saved point is now's: not drawn twice)
  const today = { d: '2026-10-09', sides: history[0].sides };
  assert.equal(trendChart(base, [...history, today], now, sides, 400).lines[0].dots.length, 3);

  assert.deepEqual(rankTicks(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(rankTicks(1, 16), [1, 5, 10, 15]);
  assert.deepEqual(rankTicks(1, 80), [1, 20, 40, 60, 80]);
});

test('the pin\'s link: the list and the comparison kept, nothing else; its title; its order', async () => {
  const { specOf, parseSpec, decodeShared, compareHref, defaultTitle, cleanTitle, moved, sinceText, PIN_TITLE_MAX } = await load();
  const code = Buffer.from(JSON.stringify({ v: 1, w: { QB: { epa: 80 } } })).toString('base64url');
  const spec = specOf(`https://seasonranker.com/nfl/?pos=QB&season=2026&list=${code}&cmp=stats_QB.2026.a_QB.2026.b&emulators#tracker`);
  assert.equal(spec, `list=${code}&cmp=stats_QB.2026.a_QB.2026.b`);
  assert.deepEqual(parseSpec(spec), { list: code, cmp: 'stats_QB.2026.a_QB.2026.b' });
  assert.deepEqual(decodeShared(code), { v: 1, w: { QB: { epa: 80 } } });
  assert.equal(decodeShared('!!junk'), null);
  assert.equal(decodeShared(Buffer.from('{"v":2}').toString('base64url')), null);
  assert.equal(specOf('https://x/nfl/?cmp=QB.2026.a'), 'cmp=QB.2026.a');
  assert.equal(compareHref('nfl', spec), `/nfl/?${spec}`);
  // (an id with "%" or "_" stays escaped in the link)
  assert.equal(parseSpec(specOf('https://x/nfl/?cmp=QB.2026.a%255Fb')).cmp, 'QB.2026.a%5Fb');

  assert.equal(defaultTitle([{ name: 'Josh Allen', tag: 'Allen ’26', season: 2026 }, { name: 'Patrick Mahomes', tag: 'Mahomes ’26', season: 2026 }]), 'Josh Allen vs Patrick Mahomes');
  assert.equal(defaultTitle([{ name: 'Jamaal Charles', tag: 'Charles ’13', season: 2013 }, { name: 'Bijan Robinson', tag: 'Robinson ’26', season: 2026 }]), 'Charles ’13 vs Robinson ’26');
  const long = Array.from({ length: 4 }, (_, i) => ({ name: 'A Very Long Name Indeed ' + i, tag: `Indeed${i} ’26`, season: 2026 }));
  assert.ok(defaultTitle(long).length <= PIN_TITLE_MAX);
  assert.equal(cleanTitle('  Rivals   of\nthe AFC  '), 'Rivals of the AFC');
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moved(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  const day = 86_400_000;
  const noon = new Date(2026, 9, 9, 12).getTime();
  assert.equal(sinceText(noon - 60_000, noon), 'today');
  assert.equal(sinceText(noon - day, noon), 'yesterday');
  assert.equal(sinceText(noon - 5 * day, noon), '5 days ago');
  assert.equal(sinceText(noon - 30 * day, noon), 'Sep 9');
});

// A stand-in for the season data service on the static files (the current season's rows are the loaded ones)
function dataFor(e) {
  const careersDir = path.join(staticDir('nfl'), 'careers');
  const orEmpty = (file) => (fs.existsSync(path.join(careersDir, file)) ? readJson(path.join(careersDir, file)) : {});
  return {
    rows: async (season) => (season === e.CURRENT_SEASON ? e.SKILL_UNITS : e.unitsForSeason(seasonData(seasonDir('nfl', season, e.CURRENT_SEASON), e.SPORT.dataFiles), season)),
    careers: async (p) => orEmpty(`${p}.json`),
    careerNames: async () => orEmpty('names.json'),
    firstSeasons: async () => ({}),
  };
}

test('nfl: a pin read now ranks as the compare view does, with the sliders its link carries', async () => {
  const e = await load();
  const reader = new e.PinReader(dataFor(e));
  const weights = e.presetWeights('QB', 'default');
  const ranked = e.defaultRanking('QB', weights);
  assert.ok(ranked.length > 10, 'QBs this season');
  const [a, b] = [ranked[0], ranked[7]];
  const cmp = e.compareCode({ sides: [{ position: 'QB', season: e.CURRENT_SEASON, gsisId: b.gsisId }, { position: 'QB', season: e.CURRENT_SEASON, gsisId: a.gsisId }], tab: 'overview' });
  const read = await reader.read(`cmp=${cmp}`);
  assert.ok(read, 'read');
  const snap = read.snapshot;
  // (the link's order; each one's rank in the season's list, as the compare view's own host ranks it)
  assert.deepEqual(snap.sides.map((s) => s.id), [b.gsisId, a.gsisId]);
  const linked = { sides: [{ position: 'QB', season: e.CURRENT_SEASON, gsisId: b.gsisId }, { position: 'QB', season: e.CURRENT_SEASON, gsisId: a.gsisId }], tab: 'overview' };
  const ranksIn = async (w) => {
    const compare = new e.PlayerCompare(hostLike(e, w), dataFor(e));
    await compare.openLinked(linked);
    return compare.sides.map((s) => s.rank);
  };
  assert.deepEqual(snap.sides.map((s) => s.rank), await ranksIn(weights));
  assert.ok(snap.sides[1].rank < snap.sides[0].rank, 'the better one ranked higher');
  assert.ok(snap.sides.every((s) => s.score !== null && Number.isFinite(s.score)));
  assert.ok(snap.sides[1].score > snap.sides[0].score);
  assert.ok(snap.skills.length >= 3 && snap.rows.length >= 5, 'skills and columns kept');
  assert.ok(snap.sides.every((s) => s.stats.length === snap.rows.length && s.skills.length === snap.skills.length));
  // (fits a Firestore document many times over)
  assert.ok(JSON.stringify(snap).length < 40_000, `${JSON.stringify(snap).length} bytes`);

  // (read again: the same numbers, nothing to keep for the day)
  const again = await reader.read(`cmp=${cmp}`);
  const t = e.trackView(snap, again.snapshot);
  assert.ok(t.sides.every((s) => s.moved === 0 && s.scoreMove === 0));
  assert.ok([...t.skills, ...t.stats].every((r) => r.cells.every((c) => c.dir === null)));
  assert.equal(e.addPoint([], snap, e.pointOf(again.snapshot)), null);

  // (the link's sliders, not the defaults: every slider but one at zero ranks by that one stat)
  const key = Object.keys(weights).find((k) => weights[k] > 0);
  const only = Object.fromEntries(Object.keys(weights).map((k) => [k, k === key ? 100 : 0]));
  const list = Buffer.from(JSON.stringify({ v: 1, w: { QB: only } })).toString('base64url');
  const slid = await reader.read(`list=${list}&cmp=${cmp}`);
  assert.deepEqual(slid.snapshot.sides.map((s) => s.rank), await ranksIn(only));
  assert.notDeepEqual(
    slid.snapshot.sides.map((s) => s.score),
    snap.sides.map((s) => s.score),
  );

  // (junk, or nobody the site has: nothing)
  assert.equal(await reader.read('cmp=QB.1800.nobody'), null);
  assert.equal(await reader.read('list=abc'), null);
});

// The compare view's host as the grid would be on the QB tab with the default sliders (tests/compare.test.mjs's)
function hostLike(e, weights) {
  const settings = { ...e.DEFAULT_SETTINGS };
  const positions = {
    settings,
    statHiddenState: {},
    skillHiddenGroups: () => ({}),
    getWeights: (p) => (p === 'QB' ? weights : e.presetWeights(p, 'default')),
    isStatHidden: () => false,
    orderedGroups: (_p, groups) => groups,
    orderedStats: (_p, group) => group.stats,
    seasonUnitOrder: () => null,
  };
  const ranker = new e.TabRanker(positions, { firstSeasons: async () => ({}) }, () => ({ position: 'QB', stats: e.SKILL_STATS.QB, groups: e.skillGroups('QB'), hidden: {}, weights }), () => {});
  const readerOf = (context) =>
    new e.StatReader({ position: context.position, settings, rows: context.rows, list: context.list, tableSeason: false, season: context.season, empty: context.empty, weights: ranker.mixWeights(context.position) });
  const host = {
    position: 'QB',
    season: e.CURRENT_SEASON,
    stats: e.SKILL_STATS.QB,
    colorValues: false,
    playerList: [],
    reader: null,
    readerFor: (context) => (context ? readerOf(context) : host.reader),
    seasonContext(season, rows, p = 'QB') {
      const context = { season, rows, list: [], empty: (key) => e.emptyIn(rows[p] ?? [], key), position: p };
      context.list = host.rankedIn(context, ranker.listed({ [p]: rows[p] }, season, p));
      return context;
    },
    rankedIn: (context, players) => ranker.ranked(readerOf(context), players, context.position, context.rows),
    shownGroups: (reader, p = 'QB') => ranker.shownGroups(reader, p).groups,
    headshot: () => null,
    noHeadshot: () => {},
  };
  const table = host.seasonContext(e.CURRENT_SEASON, e.SKILL_UNITS, 'QB');
  host.playerList = table.list;
  host.reader = readerOf(table);
  return host;
}

test('the key columns: the ones moved most in their lists since; nothing moved, the first mostly-numbers group', async () => {
  const { keyStats } = await load();
  const c = (text, then, shift) => ({ text, then, delta: null, dir: null, good: null, shift });
  const row = (key, group, cells) => ({ key, label: key, name: key, group, kind: 'stat', cells });
  const rows = [
    row('record', 'Results', [c('3-1', '2-1', 0.2), c('2-2', '2-1', -0.3)]),
    row('games', 'Results', [c('4', '3', 0), c('4', '3', 0)]),
    row('yds', 'Box Score', [c('1,100', '900', 0.02), c('1,000', '700', 0.05)]),
    row('td', 'Box Score', [c('9', '6', 0.2), c('5', '4', -0.1)]),
    row('ints', 'Box Score', [c('2', '1', 0), c('3', '3', 0)]),
    row('epa', 'Advanced', [c('0.12', '0.05', 0.15), c('0.02', '0.04', -0.004)]),
  ];
  // (a record isn't a number; the rest by how far they moved, in the view's order)
  assert.deepEqual(keyStats(rows, 2).map((r) => r.key), ['td', 'epa']);
  assert.deepEqual(keyStats(rows, 3).map((r) => r.key), ['yds', 'td', 'epa']);
  // (pinned today: the box score, not the results)
  const still = rows.map((r) => ({ ...r, cells: r.cells.map((x) => ({ ...x, shift: 0 })) }));
  assert.deepEqual(keyStats(still, 6).map((r) => r.key), ['yds', 'td', 'ints']);
});
