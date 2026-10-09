// The player card's and the game view's plain parts (tests/support/card-entry.ts): the hover words every tab
// shares, the game log's view (its columns' looks, the outcomes, the chart), the game's injury report (a
// player back before game day left off), how a highlight plays (the NFL's open on YouTube), and the vs
// Position breakdown built from a season's real rows (the NFL's defenses, the NHL's teams).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine, readJson, staticDir } from './support/engine.mjs';

// (the Americas' time, where a plain day read as UTC midnight shows the day before)
process.env.TZ = 'America/Los_Angeles';

const ENTRY = path.join(import.meta.dirname, 'support', 'card-entry.ts');
let nfl;
let nhl;
before(async () => {
  [nfl, nhl] = await Promise.all([loadEngine('nfl', { entry: ENTRY, data: {} }), loadEngine('nhl', { entry: ENTRY, data: {} })]);
});

// ---- the hover words (player-card/hover-text.ts)

test('hover words: percentiles as ordinals, 1st to 99th', () => {
  const { percentile, percentileText } = nfl;
  assert.equal(percentile(0.92), '92nd');
  assert.equal(percentile(0.111), '11th');
  assert.equal(percentile(0.215), '22nd');
  assert.equal(percentile(0.03), '3rd');
  assert.equal(percentile(0.21), '21st');
  // (nobody's 0th or 100th)
  assert.equal(percentile(0), '1st');
  assert.equal(percentile(1), '99th');
  assert.equal(percentileText(0.88), '88th percentile');
});

test("hover words: a name's possessive, a rank in its list", () => {
  const { possessive, rankText } = nfl;
  assert.equal(possessive('Brock Purdy'), "Brock Purdy's");
  assert.equal(possessive('San Francisco 49ers'), "San Francisco 49ers'");
  assert.equal(possessive('Chris Jones'), "Chris Jones'");
  assert.equal(possessive('Chiefs D/ST'), "Chiefs D/ST's");
  assert.equal(rankText(3, 32), '#3 of 32');
  assert.equal(rankText(3, 32, true), 'T-3 of 32');
});

test("hover words: a skill's, a stat tile's and a zone's", () => {
  const { skillTitle, statTitle, zoneTitle, zoneWhere } = nfl;
  assert.equal(skillTitle({ name: 'Accuracy', standing: 'Top 8%', pct: 0.92 }), 'Accuracy: Top 8% · 92nd percentile');
  assert.equal(skillTitle(undefined), '');
  const tile = { name: 'Passing Yds', display: '4,183', rank: 3, tied: false, of: 32, avg: '3,610' };
  assert.equal(statTitle(tile), 'Passing Yds: 4,183 (#3 of 32) · Avg 3,610');
  assert.equal(statTitle({ ...tile, tied: true }), 'Passing Yds: 4,183 (T-3 of 32) · Avg 3,610');
  assert.equal(statTitle({ ...tile, rank: null, avg: null, display: '' }), 'Passing Yds');
  // (the catcher's view: 1-9 across and down, 11-14 the corners outside)
  assert.deepEqual(['01', '03', '05', '07', '08', '11', '14'].map(zoneWhere), [
    'high left',
    'high right',
    'middle of the zone',
    'low left',
    'low middle',
    'outside the zone, high left',
    'outside the zone, low right',
  ]);
  const slugging = { key: 'slg', label: 'Slugging', zones: { '07': { value: '.512', color: '#f00' } } };
  assert.equal(zoneTitle(slugging, '07'), "Slugging, low left: .512 (catcher's view)");
  assert.equal(zoneTitle(slugging, '09'), "Slugging, low right: none (catcher's view)");
});

test("hover words: the lean bar's pass and run shares always add up to 100", () => {
  const { leanShares, leanTitle } = nfl;
  // (58.5% pass: rounding each on its own would read 59 and 42)
  assert.deepEqual(leanShares(0.585), { pass: 59, run: 41 });
  for (let p = 0; p <= 1000; p++) {
    const s = leanShares(p / 1000);
    assert.equal(s.pass + s.run, 100, `${p / 10}% pass`);
  }
  assert.equal(leanTitle(0.585, 0.561), 'Pass 59% · Run 41% (offenses usually pass 56%)');
  assert.equal(leanTitle(0.5, null), 'Pass 50% · Run 50%');
});

// ---- the game log (player-card/game-log-view.ts)

// A team's log as espnTeamGameLog writes it, newest first: PF, PA, the record after it, its leader
const teamLog = () => ({
  columns: [{ label: 'PF' }, { label: 'PA' }, { label: 'Record' }, { label: 'Leader', wide: true }],
  chartLabel: 'Point margin',
  rows: [
    { date: 'Sep 28', vs: '@ LAR', result: 'T 20-20 OT', margin: 0, values: ['20', '20', '2-1-1', 'B. Purdy 250 YDS'], event: '3' },
    { date: 'Sep 21', vs: 'vs ARI', result: 'W 16-15', margin: 1, values: ['16', '15', '2-1', 'B. Purdy 300 YDS'], event: '2' },
    { date: 'Sep 14', vs: '@ NO', result: 'L 13-26', margin: -13, values: ['13', '26', '1-1', 'B. Purdy 190 YDS'], event: '1' },
    { date: 'Sep 7', vs: 'vs New York Giants', result: 'W 30-10', margin: 20, values: ['30', '10', '1-0', 'C. McCaffrey 120 YDS'], when: '2025-09-07' },
  ],
});

test("game log: a team's, oldest first, its scores on tiles and its Record centered", () => {
  const view = nfl.gameLogView(teamLog());
  assert.deepEqual(view.rows.map((r) => r.date), ['Sep 7', 'Sep 14', 'Sep 21', 'Sep 28']);
  assert.deepEqual(view.rows.map((r) => r.outcome), ['W', 'L', 'W', 'T']);
  assert.deepEqual(view.rows.map((r) => r.score), ['30-10', '13-26', '16-15', '20-20 OT']);
  assert.equal(view.rows[0].when, '2025-09-07');
  assert.equal(view.scoreboard, true, "a team's Result is just its W or L");
  assert.deepEqual(view.looks.map((l) => l.score), ['PF', 'PA', null, null]);
  assert.deepEqual(view.looks.map((l) => l.center), [false, false, true, false]);
  assert.deepEqual(view.looks.map((l) => l.wide), [false, false, false, true]);
  assert.ok(view.looks.every((l) => !l.groupStart && !l.key), 'no groups, no charted columns');
  assert.equal(view.groups, null);
  // (the average: PF and PA, not the record or the leader)
  assert.deepEqual(view.average, ['19.8', '17.8', '', '']);
  // (the margin chart: below the line, since there's a loss)
  assert.equal(view.chart.label, 'Point margin');
  assert.equal(view.chart.diverging, true);
  assert.deepEqual(view.chart.bars.map((b) => b.text), ['+20', '-13', '+1', '0']);
  assert.deepEqual(view.chart.bars.map((b) => b.negative), [false, true, false, false]);
  assert.equal(view.chart.bars[1].segments[0], 65);
});

test("game log: a player's, its groups ruled off, its charted columns lit, no score tiles", () => {
  const log = {
    columns: [
      { label: 'YDS', group: 'Passing' },
      { label: 'TD', group: 'Passing' },
      { label: 'INT', group: 'Passing' },
      { label: 'YDS', group: 'Rushing' },
      // (a player's PA, plate appearances say, isn't a score: only a log with PF has them)
      { label: 'PA' },
    ],
    chart: { label: 'Total yards', stack: ['Passing YDS', 'Rushing YDS'], plus: ['TD'], minus: ['INT'] },
    rows: [
      { date: 'Sep 14', vs: '@ NO', result: 'L 13-26', values: ['190', '1', '2', '12', '4'] },
      { date: 'Sep 7', vs: 'vs NYG', result: 'W 30-10', values: ['250', '2', '0', '30', '4'] },
      { date: 'Aug 31', vs: 'vs DEN', result: 'Final', values: ['300', '3', '1', '-', '4'] },
    ],
  };
  const view = nfl.gameLogView(log, [{ date: 'Sep 21', time: '1:00 PM', vs: 'vs ARI' }]);
  assert.equal(view.scoreboard, false);
  assert.deepEqual(view.looks.map((l) => l.score), [null, null, null, null, null]);
  assert.deepEqual(view.looks.map((l) => l.groupStart), [true, false, false, true, true]);
  assert.deepEqual(view.looks.map((l) => l.key), [true, false, false, true, false]);
  assert.deepEqual(view.groups, [
    { label: 'Passing', span: 3 },
    { label: 'Rushing', span: 1 },
    { label: '', span: 1 },
  ]);
  // (a result without a W, L or T: no outcome, the text kept)
  assert.deepEqual(view.rows.map((r) => r.outcome), ['', 'W', 'L']);
  assert.equal(view.rows[0].score, 'Final');
  assert.equal(view.upcoming.length, 1);
  // (the chart: passing and rushing piled up, a dot a TD and an INT; a dash counts as nothing)
  assert.deepEqual(view.chart.legend, ['Passing', 'Rushing']);
  assert.equal(view.chart.plusLabel, 'TD');
  assert.equal(view.chart.minusLabel, 'INT');
  assert.deepEqual(view.chart.bars.map((b) => b.text), ['300', '280', '202']);
  assert.deepEqual(view.chart.bars.map((b) => [b.plus, b.minus]), [[3, 1], [2, 0], [1, 2]]);
  assert.equal(view.chart.bars[0].segments[0], 100);
});

test('game log: "@ IND" as its side and its team', () => {
  assert.deepEqual(nfl.splitVs('@ IND'), ['@', 'IND']);
  assert.deepEqual(nfl.splitVs('vs New York Giants'), ['vs', 'New York Giants']);
});

// ---- the game view (game-view/game.ts, highlights.ts)

// ESPN's injury report: each team's, a player's return date a plain day
const report = (rows) => [
  { team: { id: '25' }, injuries: rows.map(([name, status, returnDate]) => ({ status, athlete: { displayName: name }, details: { type: 'Knee', ...(returnDate ? { returnDate } : {}) } })) },
];
const sideOf = (id) => (id === '25' ? 'home' : id === '22' ? 'away' : null);

test("injuries: a player back before game day is left off; back on game day he's questionable, kept", () => {
  const teams = report([
    ['Back Saturday', 'Questionable', '2026-10-10'],
    ['Back Sunday', 'Questionable', '2026-10-11'],
    ['On IR', 'Injured Reserve', '2026-11-15'],
    ['No Date', 'Out'],
  ]);
  // (Sunday's 1:00 kickoff, New York's)
  const [home] = nfl.injuryReport(teams, '2026-10-11T17:00Z', sideOf);
  assert.equal(home.side, 'home');
  assert.deepEqual(home.rows.map((r) => r.name), ['Back Sunday', 'On IR', 'No Date']);
  // (its own day, not the day before in the Americas)
  assert.deepEqual(home.rows.map((r) => r.detail), ['Knee · back Oct 11', 'Knee · back Nov 15', 'Knee']);
  // (Sunday night's kickoff is Monday in UTC: still Sunday's game)
  assert.equal(nfl.injuryReport(teams, '2026-10-12T00:20Z', sideOf)[0].rows.length, 3);
  // (everyone back in time: the team's left off; no date: nothing's dropped)
  assert.deepEqual(nfl.injuryReport(report([['Back Friday', 'Questionable', '2026-10-09']]), '2026-10-11T17:00Z', sideOf), []);
  assert.equal(nfl.injuryReport(teams, undefined, sideOf)[0].rows.length, 4);
  assert.deepEqual(nfl.injuryReport(undefined, '2026-10-11T17:00Z', sideOf), []);
});

test('injuries: the away team first, a team not in the game left off', () => {
  const teams = [
    { team: { id: '25' }, injuries: [{ status: 'Out', athlete: { displayName: 'Home Guy' } }] },
    { team: { id: '99' }, injuries: [{ status: 'Out', athlete: { displayName: 'Nobody' } }] },
    { team: { id: '22' }, injuries: [{ status: 'Doubtful', athlete: { displayName: 'Away Guy' } }] },
  ];
  assert.deepEqual(
    nfl.injuryReport(teams, '2026-10-11T17:00Z', sideOf).map((t) => [t.side, t.rows[0].name]),
    [
      ['away', 'Away Guy'],
      ['home', 'Home Guy'],
    ],
  );
  assert.equal(nfl.returnDay('2026-01-01'), 'Jan 1');
});

test("highlights: the NFL's YouTube videos open on YouTube, others' embed, files play here", () => {
  const { videoPlay, youtubeWatch, youtubeThumb } = nfl;
  const yt = { title: 'Highlights', src: null, youtube: 'abc_123', thumb: null, duration: null };
  const file = { title: 'Recap', src: 'https://x/clip.mp4', youtube: null, thumb: null, duration: 90 };
  assert.equal(videoPlay(yt, 'football/nfl'), 'link');
  assert.equal(videoPlay(yt, 'basketball/nba'), 'embed');
  assert.equal(videoPlay(yt, 'hockey/nhl'), 'embed');
  assert.equal(videoPlay(file, 'football/nfl'), 'file');
  assert.equal(videoPlay(file, 'baseball/mlb'), 'file');
  assert.equal(youtubeWatch('abc_123'), 'https://www.youtube.com/watch?v=abc_123');
  assert.equal(youtubeThumb('abc_123'), 'https://i.ytimg.com/vi/abc_123/hqdefault.jpg');
});

// ---- vs Position (apps/<sport>/src/sport/vs-position.ts), on a finished season's rows

test('NFL 2025 vs Position: every defense a table, a lean and a split, the funnel named the same way throughout', () => {
  const defs = readJson(path.join(staticDir('nfl'), 'seasons', '2025', 'skill-players.json')).DEF;
  const build = nfl.vsPosition.vsPositionBreakdown;
  assert.equal(build(defs[0], 'QB', defs), null, 'only a defense has one');
  const all = defs.map((d) => build(d, 'DEF', defs));
  for (const [i, b] of all.entries()) {
    const at = defs[i].name;
    assert.equal(b.title, 'vs Position');
    assert.deepEqual(b.columns.map((c) => c.label), ['EPA / Play', 'PPR / G', 'Yds / G', 'vs Avg']);
    assert.deepEqual(b.rows.map((r) => r.label), ['WR1', 'WR2', 'WR3', 'TE1', 'RB1']);
    // (each role in its group's pie color: WR, TE, RB)
    assert.deepEqual(b.rows.map((r) => r.group), [0, 0, 0, 1, 2]);
    for (const r of b.rows) {
      assert.equal(r.cells.length, 4, `${at} ${r.label}: a cell per column`);
      assert.equal(r.of, 32);
      assert.ok(r.rank >= 1 && r.rank <= 32, `${at} ${r.label}: rank ${r.rank}`);
      for (const c of r.cells) assert.ok(c.text === '-' || /^[+−]?\d+\.\d+$/.test(c.text), `${at} ${r.label}: "${c.text}"`);
    }
    // (the lean: its label, tone and words agree; the flag says the same)
    const { lean } = b;
    const way = lean.tone;
    assert.equal(lean.label, way === 'pass' ? 'Pass funnel' : way === 'run' ? 'Run funnel' : 'Neutral funnel', at);
    assert.ok(lean.text.startsWith(way ? `Teams lean ${way} here (#` : 'Teams play it straight here: '), `${at}: ${lean.text}`);
    assert.ok(lean.pass > 0.4 && lean.pass < 0.8 && lean.usual > 0.4 && lean.usual < 0.8, `${at}: pass ${lean.pass}, usually ${lean.usual}`);
    const funnel = b.flags.find((f) => f.icon === 'call_split');
    assert.ok(funnel.text.startsWith(`${lean.label}: opponents pass `), `${at}: ${funnel.text}`);
    assert.ok(funnel.text.includes('usual for the situation'), `${at}: over expected, so the situation's`);
    // (the split: WRs, TEs and backs, their shares a whole)
    assert.deepEqual(b.split.parts.map((p) => p.label), ['WR', 'TE', 'RB']);
    assert.ok(Math.abs(b.split.parts.reduce((a, p) => a + p.share, 0) - 1) < 0.003, `${at}: the split's shares`);
  }
  // (the most pass-heavy and run-heavy funnels: #1 each way)
  const scores = defs.map((d) => d.vsPos.funnel.score);
  const pass = all[scores.indexOf(Math.max(...scores))];
  const run = all[scores.indexOf(Math.min(...scores))];
  assert.match(pass.lean.text, /^Teams lean pass here \(#1 of 32\): opponents pass on \d+% of plays, against \d+% usually, \d+\.\d points more than they usually do$/);
  assert.match(run.lean.text, /^Teams lean run here \(#1 of 32\): /);
  assert.match(run.flags.find((f) => f.icon === 'call_split').text, /^Run funnel: opponents pass \d+\.\d% less often than usual for the situation \(#1 of 32\)$/);
});

test('NFL vs Position: a neutral funnel, and a plain pass rate before expected rates were kept', () => {
  const defs = readJson(path.join(staticDir('nfl'), 'seasons', '2025', 'skill-players.json')).DEF;
  const build = nfl.vsPosition.vsPositionBreakdown;
  const neutral = structuredClone(defs[0]);
  Object.assign(neutral.vsPos.funnel, { score: 1.2, rate: 0.58, exp: 0.568, method: 'proe' });
  const b = build(neutral, 'DEF', defs);
  assert.equal(b.lean.label, 'Neutral funnel');
  assert.equal(b.lean.tone, null);
  assert.equal(b.lean.text, 'Teams play it straight here: opponents pass on 58% of plays, against 57% usually');
  assert.equal(b.flags.find((f) => f.icon === 'call_split').text, 'Neutral funnel: opponents pass about as often as usual for the situation (+1.2%)');
  const plain = structuredClone(defs[0]);
  Object.assign(plain.vsPos.funnel, { score: -3.4, rank: 30, method: 'rate' });
  const r = build(plain, 'DEF', defs);
  assert.equal(r.flags.find((f) => f.icon === 'call_split').text, 'Run funnel: opponents pass 3.4% less often than usual (#3 of 32)');
  assert.match(r.lean.help, /^Plain pass rate/);
});

test('NHL 2025 vs Position: forwards and defensemen, ranked, their columns filled', () => {
  const coaches = readJson(path.join(staticDir('nhl'), 'seasons', '2025', 'skill-players.json')).HC;
  const build = nhl.vsPosition.nhlVsPositionBreakdown;
  const teams = [...new Map(coaches.map((c) => [c.teamLogo, c])).values()];
  assert.equal(build(teams[0], 'C', teams), null, 'only a team has one');
  for (const t of teams) {
    const b = build(t, 'TM', teams);
    assert.deepEqual(b.rows.map((r) => r.label), ['Forwards', 'Defense']);
    assert.deepEqual(b.columns.map((c) => c.label), ['Pts / G', 'Shots / G', 'vs Avg']);
    for (const r of b.rows) {
      assert.equal(r.of, 32);
      assert.ok(r.rank >= 1 && r.rank <= 32);
      assert.ok(r.cells.every((c) => c.text !== '-'), `${t.name} ${r.label}: a blank`);
    }
    assert.match(b.note, /^Defensemen's share of the points against it: \d+% \(league \d+%\)$/);
    assert.equal(b.split, null);
  }
});
