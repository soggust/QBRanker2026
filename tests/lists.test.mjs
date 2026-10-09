// Saved lists' and the Community's plain helpers (libs/ranker/src/engine/account/lists/lists-helpers.ts and
// community/community-helpers.ts): the frozen snapshot of the grid, the Today comparison, presets' payload,
// and the consensus (a Borda count) with the votes. firestore.rules checks the same limits (tests/rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, loadEngine } from './support/engine.mjs';

const ACCOUNT = path.join(ROOT, 'libs/ranker/src/engine/account');
const l = await loadEngine('nfl', { entry: path.join(ACCOUNT, 'lists/lists-helpers.ts'), data: {} });
const c = await loadEngine('nfl', { entry: path.join(ACCOUNT, 'community/community-helpers.ts'), data: {} });

// (a grid's rows and columns, read the way the grid reads them)
const players = [
  { id: 'a', name: 'Allen', logo: 'assets/NFL_Icons/BUF.png', shot: 'https://x/a.png', ypa: 8.123456, ints: 5, pct: 0.655 },
  { id: 'b', name: 'Burrow', logo: 'assets/NFL_Icons/CIN.png', shot: null, ypa: 7.5, ints: null, pct: 0.7 },
  { id: 'a', name: 'Allen again', logo: null, shot: null, ypa: 1, ints: 1, pct: 0.1 },
  { id: 'c', name: 'Cousins', logo: null, shot: null, ypa: Number.NaN, ints: 12, pct: 0.6 },
];
const columns = [
  { key: 'ypa', label: 'Y/A', format: 'dec1', lower: false },
  { key: 'ints', label: 'INT', format: '', lower: true },
  { key: 'pct', label: 'Cmp%', format: 'pct', lower: false },
  { key: 'ypa', label: 'Y/A twice', format: 'dec1', lower: false },
];
const source = (rows = players) => ({
  rows,
  columns,
  id: (p) => p.id,
  name: (p) => p.name,
  teamLogo: (p) => p.logo,
  photo: (p) => p.shot,
  value: (p, key) => p[key],
  text: (p, key) => (p[key] === null || Number.isNaN(p[key]) ? '-' : key === 'pct' ? `${Math.round(p[key] * 100)}%` : String(p[key])),
});

test('a snapshot keeps the order, each player once, every column once, numbers as numbers', () => {
  const s = l.buildSnapshot(source());
  assert.deepEqual(s.ids, ['a', 'b', 'c']);
  assert.deepEqual(s.columns, ['ypa', 'ints', 'pct']);
  assert.deepEqual(s.labels, ['Y/A', 'INT', 'Cmp%']);
  assert.deepEqual(s.formats, ['dec1', '', 'pct']);
  assert.deepEqual(s.lower, ['ints']);
  assert.deepEqual(s.snapshot.a, {
    name: 'Allen',
    teamLogo: 'assets/NFL_Icons/BUF.png',
    photo: 'https://x/a.png',
    rank: 1,
    values: { ypa: 8.1235, ints: 5, pct: 0.655 },
    texts: { ypa: '8.123456', ints: '5', pct: '66%' },
  });
  // (no value: none; not a number: none; ranks follow the kept order)
  assert.equal(s.snapshot.b.values.ints, null);
  assert.equal(s.snapshot.c.values.ypa, null);
  assert.equal(s.snapshot.c.rank, 3);
  assert.equal(s.snapshot.c.teamLogo, null);
});

test('a snapshot keeps the top LIST_MAX rows and COLUMN_MAX columns, well under a document\'s 1 MB', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: `Player Number ${i}`, logo: 'assets/NFL_Icons/KC.png', shot: 'https://a.espncdn.com/i/headshots/nfl/players/full/1234567.png' }));
  const wide = Array.from({ length: 75 }, (_, i) => ({ key: `stat${i}`, label: `Stat ${i}`, format: 'dec2', lower: false }));
  const s = l.buildSnapshot({ ...source(rows), columns: wide, value: () => 1234.5678, text: () => '1,234.57' });
  assert.equal(s.ids.length, l.LIST_MAX);
  assert.equal(l.LIST_MAX, 50);
  assert.equal(s.columns.length, l.COLUMN_MAX);
  const bytes = Buffer.byteLength(JSON.stringify(s));
  assert.ok(bytes < 400_000, `${bytes} bytes`);
  // (and fewer when asked)
  assert.equal(l.buildSnapshot(source(rows), 10).ids.length, 10);
});

test('a reorder renumbers the saved rows and drops ids the snapshot lacks', () => {
  const s = l.buildSnapshot(source());
  const r = l.reorderSnapshot(s, ['c', 'zzz', 'a', 'b']);
  assert.deepEqual(r.ids, ['c', 'a', 'b']);
  assert.deepEqual([r.snapshot.c.rank, r.snapshot.a.rank, r.snapshot.b.rank], [1, 2, 3]);
  assert.equal(r.snapshot.a.values.ypa, s.snapshot.a.values.ypa);
  // (the original's untouched)
  assert.equal(s.snapshot.c.rank, 3);
});

test('a change reads like its column: decimals, percents, minutes, ranks', () => {
  assert.equal(l.deltaText(0.45, 'dec2', '4.35'), '+0.45');
  assert.equal(l.deltaText(-3, '', '1,234'), '-3');
  assert.equal(l.deltaText(1234.4, '', '1,234'), '+1,234');
  assert.equal(l.deltaText(0.05, 'pct', '65%'), '+5%');
  assert.equal(l.deltaText(-1.25, 'pctPoints', '12.5%'), '-1.3%');
  assert.equal(l.deltaText(0.7, 'mmss', '31:24'), '+0:42');
  assert.equal(l.deltaText(-0.012, 'avg3', '.301'), '-.012');
  assert.equal(l.deltaText(2, 'rank', '#5'), '+2');
  // (a fraction of a whole-number column still shows)
  assert.equal(l.deltaText(0.4, '', '12'), '+0.4');
  assert.equal(l.deltaText(0, '', '12'), '±0');
  assert.equal(l.deltaText(null, '', '12'), '');
});

test('Today: each saved row\'s numbers now, the change and whether it\'s better, and where today\'s ranking puts him', () => {
  const saved = l.buildSnapshot(source());
  const today = new Map([
    ['a', { values: { ypa: 8.5, ints: 7, pct: 0.655 }, texts: { ypa: '8.5', ints: '7', pct: '66%' }, rank: 3 }],
    ['b', { values: { ypa: 7.0, ints: 2, pct: 0.71 }, texts: { ypa: '7.0', ints: '2', pct: '71%' }, rank: 1 }],
    // (c is gone from the data)
  ]);
  const rows = l.compareToday(saved, today);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  const [a, b, gone] = rows;
  const cell = (row, key) => row.cells.find((x) => x.key === key);
  // (more yards a pass: better; more interceptions: worse, a lower-is-better stat)
  assert.equal(cell(a, 'ypa').trend, 'up');
  assert.ok(Math.abs(cell(a, 'ypa').delta - 0.3765) < 1e-9);
  assert.equal(cell(a, 'ints').trend, 'down');
  assert.equal(cell(a, 'ints').deltaText, '+2');
  assert.equal(cell(a, 'pct').trend, 'same');
  assert.equal(cell(a, 'ypa').text, '8.5');
  assert.equal(cell(a, 'ypa').saved, '8.123456');
  // (no number then: no change to show)
  assert.equal(cell(b, 'ints').delta, null);
  assert.equal(cell(b, 'ints').trend, null);
  assert.equal(cell(b, 'pct').deltaText, '+1%');
  // (his place in the list against today's default ranking: #1 in the list, #3 today = down 2)
  assert.equal(a.rankMove, -2);
  assert.equal(b.rankMove, 1);
  // (gone: the saved texts, no changes)
  assert.equal(gone.today, null);
  assert.equal(gone.rankMove, null);
  assert.equal(cell(gone, 'ints').text, '12');
  assert.ok(gone.cells.every((x) => x.delta === null));
});

test('the lists\' checks, addresses and presets\' payload', () => {
  assert.match(l.titleProblem('  '), /title/);
  assert.match(l.titleProblem('x'.repeat(81)), /80/);
  assert.equal(l.titleProblem('My QBs'), null);
  assert.match(l.noteProblem('x'.repeat(501)), /500/);
  assert.equal(l.logoUrl('nfl', 'assets/NFL_Icons/KC.png'), '/nfl/assets/NFL_Icons/KC.png');
  assert.equal(l.logoUrl('nba', 'https://cdn/x.svg'), 'https://cdn/x.svg');
  assert.equal(l.logoUrl('nba', null), null);
  assert.equal(l.listPath('nfl', 'u 1', 'abc'), '/nfl/#lists/u%201/abc');
  assert.deepEqual(l.readListHash('#lists/u%201/abc'), { owner: 'u 1', id: 'abc' });
  assert.equal(l.readListHash('#lists'), null);
  assert.equal(l.readListHash('#lists/onlyone'), null);
  assert.match(l.presetNameProblem(''), /name/);
  assert.match(l.presetNameProblem('x'.repeat(41)), /40/);
  const p = l.presetSettings('QB', { passYards: 55.4, ints: 120, epa: -3, none: undefined }, { 'QB.ints': true, 'QB.rating': false, 'RB.rushYards': true }, { support: true, box: false });
  assert.deepEqual(p, { weights: { epa: 0, ints: 100, passYards: 55 }, hidden: ['ints'], groups: ['support'] });
  assert.ok(l.samePreset(p, l.presetSettings('QB', { ints: 100, passYards: 55, epa: 0 }, { 'QB.ints': true }, { support: true })));
  assert.ok(!l.samePreset(p, l.presetSettings('QB', { ints: 99, passYards: 55, epa: 0 }, { 'QB.ints': true }, { support: true })));
});

test('board keys: sport, tab and season, checked like the rules check them', () => {
  assert.equal(c.boardKey('nfl', 'QB', 2026), 'nfl_QB_2026');
  assert.deepEqual(c.readBoardKey('mma_WP4P_2025'), { sport: 'mma', tab: 'WP4P', season: 2025 });
  assert.equal(c.readBoardKey('nfl_Q-B_2026'), null);
  assert.equal(c.readBoardKey('NFL_QB_2026'), null);
});

test('the consensus: a Borda count, ties to the player more lists have, then the better average', () => {
  const rows = c.consensus(
    [
      { ids: ['a', 'b', 'c'] },
      { ids: ['b', 'a', 'd'] },
      // (a short list's #1 scores like a long one's; a repeat in one list counts once)
      { ids: ['c', 'c'] },
    ],
    3,
  );
  // a: 3+2 = 5, b: 2+3 = 5, c: 1+3 = 4, d: 1
  assert.deepEqual(rows.map((r) => [r.id, r.points, r.lists]), [
    ['a', 5, 2],
    ['b', 5, 2],
    ['c', 4, 2],
    ['d', 1, 1],
  ]);
  assert.equal(rows[0].avgRank, 1.5);
  assert.equal(rows[2].best, 1);
  assert.equal(rows[2].worst, 3);
  // (a tie on points: the one more lists have, then the better average place)
  const tie = c.consensus([{ ids: ['x', 'y'] }, { ids: ['z'] }, { ids: ['q', 'y'] }], 2);
  // x 2, y 1+1 = 2 (two lists), z 2, q 2
  assert.equal(tie[0].id, 'y');
  assert.deepEqual(tie.slice(1).map((r) => r.id), ['x', 'z', 'q']);
  // (players missing from every list: nowhere; no entries: nothing)
  assert.deepEqual(c.consensus([]), []);
  assert.deepEqual(c.consensus([{ ids: [] }]), []);
  // (deeper than the depth: not counted)
  assert.deepEqual(c.consensus([{ ids: ['a', 'b', 'c'] }], 2).map((r) => r.id), ['a', 'b']);
});

test('votes: the score, each kind, the reader\'s own; cards by score; the makers\' leaderboard', () => {
  const t = c.tally([{ voter: 'u1', value: 1 }, { voter: 'u2', value: 1 }, { voter: 'me', value: -1 }, { voter: 'odd', value: 5 }], 'me');
  assert.deepEqual(t, { up: 2, down: 1, score: 1, mine: -1 });
  assert.equal(c.tally([], null).mine, 0);
  const card = (owner, ownerName, up, down) => ({ entry: { owner, ownerName }, tally: { up, down, score: up - down, mine: 0 } });
  const cards = [card('a', 'Ann', 1, 0), card('b', 'Bea', 3, 1), card('c', 'Cal', 2, 0), card('d', 'Dee', 0, 0)];
  // (2 and 2: the one with more votes first)
  assert.deepEqual(c.byScore(cards).map((x) => x.entry.owner), ['b', 'c', 'a', 'd']);
  const board = c.leaderboard([...cards, card('a', 'Ann', 4, 0), card('e', 'Eve', 0, 3)], 3);
  assert.deepEqual(board.map((m) => [m.owner, m.score, m.lists]), [
    ['a', 5, 2],
    ['b', 2, 1],
    ['c', 2, 1],
  ]);
});
