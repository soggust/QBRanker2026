// The player card's and the game view's plain parts (tests/support/card-entry.ts): the hover words every tab
// shares, the game log's view (its columns' looks, the outcomes, the chart), the game's injury report (a
// player back before game day left off), how a highlight plays (the NFL's open on YouTube), and the vs
// Position breakdown built from a season's real rows (the NFL's defenses, the NHL's teams), and the NFL's Field
// Map read from its real files (each chart's total the row's own in the grid), and the Team tab's formations
// by the injury report (the ones out passed over for the next man up, or the chart's starters).
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

test("a last five game's when: the NFL by its week (playoff rounds named, the preseason blank), others by the day", () => {
  const { formWhen } = nfl;
  assert.equal(formWhen('football/nfl', 4, '2026-08-28T23:30Z'), '', 'the preseason: blank');
  assert.equal(formWhen('football/nfl', 1, '2026-09-10T00:20Z'), 'Week 1');
  assert.equal(formWhen('football/nfl', 18, '2026-01-04T21:25Z'), 'Week 18', "the regular season's last week, in January");
  assert.equal(formWhen('football/nfl', 1, '2026-01-10T21:30Z'), 'Wild Card');
  assert.equal(formWhen('football/nfl', 5, '2026-02-08T23:30Z'), 'Super Bowl');
  // (the Eastern day: a late West Coast game stays on its own night)
  assert.equal(formWhen('basketball/nba', undefined, '2025-05-22T02:30Z'), '05/21/2025');
  assert.equal(formWhen('hockey/nhl', undefined, undefined), '');
});

// ---- the Field Map (player-card/field-map.ts), read from the real field-maps.json as the card reads it

const fieldMaps = (season) => {
  const dir = season === 2026 ? staticDir('nfl') : path.join(staticDir('nfl'), 'seasons', String(season));
  return { file: nfl.expandFieldMaps(readJson(path.join(dir, 'field-maps.json'))), rows: readJson(path.join(dir, 'skill-players.json')) };
};

test("Field Map: each chart's total is the row's own in the grid (carries, targets, field goals tried, punts)", () => {
  const { file, rows } = fieldMaps(2026);
  const section = file.regular;
  const view = (role, row) => nfl.fieldMapView(section, role, [row.gsisId, row.id], { carries: row.stats.carries, targets: row.stats.targets });
  // (Kyren Williams: 54 carries, every one with its lane)
  const kyren = rows.RB.find((r) => r.gsisId === '00-0037840');
  const k = view('RB', kyren);
  assert.equal(k.runs.total, kyren.stats.carries);
  assert.equal(k.runs.total, 54);
  assert.equal(k.runs.count, '54 carries');
  assert.deepEqual(k.runs.lanes.map((l) => l.sub), ['4', '1', '8', '23', '10', '1', '7']);
  assert.equal(k.runs.lanes[3].main, (142 / 23).toFixed(1));
  assert.ok(k.runsFirst);
  // (every back's, receiver's and tight end's: the plays logged without a direction left out, never more than
  // the grid's; a chart short of it says so in its hover)
  const near = (map, grid) => map <= grid + 1 && map >= grid * 0.95;
  for (const role of ['RB', 'WR', 'TE']) {
    for (const r of rows[role]) {
      const v = view(role, r);
      assert.ok(v, `${r.name}: no Field Map`);
      if (r.stats.targets >= 20) assert.ok(near(v.pass.total, r.stats.targets), `${r.name}: ${v.pass.total} targets, ${r.stats.targets} in the grid`);
      if (v.runs && r.stats.carries >= 20) assert.ok(near(v.runs.total, r.stats.carries), `${r.name}: ${v.runs.total} carries, ${r.stats.carries} in the grid`);
      if (v.runs && v.runs.total < r.stats.carries) assert.match(v.runs.help, new RegExp(`${v.runs.total} of ${r.stats.carries} carries charted`));
      if (v.runs && v.runs.total >= r.stats.carries) assert.doesNotMatch(v.runs.help, /charted/);
    }
  }
  for (const r of rows.K) {
    const v = view('K', r);
    assert.equal(v.kicks.bands.length, 5);
    assert.equal(v.kicks.count, `${r.stats.fgAtt} ${r.stats.fgAtt === 1 ? 'try' : 'tries'}`, r.name);
  }
  for (const r of rows.P) assert.equal(view('P', r).punts.count, `${r.stats.punts} punt${r.stats.punts === 1 ? '' : 's'}`, r.name);
});

test("Field Map: a QB by his ESPN id (his throws and his runs), a defense's allowed, a missing row none", () => {
  const { file, rows } = fieldMaps(2026);
  const section = file.regular;
  const games = readJson(path.join(staticDir('nfl'), 'games.json'));
  const rodgers = games.find((q) => q.name === 'Aaron Rodgers');
  const qb = nfl.fieldMapView(section, 'QB', [`QB-${rodgers.id}`, rodgers.id]);
  assert.equal(qb.pass.kind, 'pass');
  assert.equal(qb.pass.zones.length, 12);
  assert.equal(qb.pass.total, section.players[String(rodgers.id)].pass.reduce((a, z) => a + z.att, 0));
  assert.equal(nfl.fieldMapView(section, 'QB', ['QB-' + rodgers.id]).pass.total, qb.pass.total, 'the row id alone finds him');
  // (a defense: what it allowed, its run lanes a strip; a weak spot red: its tone flipped)
  const def = nfl.fieldMapView(section, 'DEF', [rows.DEF[0].gsisId]);
  assert.equal(def.pass.kind, 'allowed');
  assert.equal(def.strip.lanes.length, 7);
  assert.equal(def.runs, null);
  assert.equal(nfl.fieldMapView(section, 'RB', ['00-nobody']), null);
});

test('Field Map: 2003, before the zones were charted: no pass maps, runs, kicks and punts still there', () => {
  const { file, rows } = fieldMaps(2003);
  const section = file.regular;
  const back = rows.RB[0];
  const v = nfl.fieldMapView(section, 'RB', [back.gsisId]);
  assert.equal(v.pass, null);
  // (the old play-by-play leaves a few runs without a lane: never more than the grid's, nearly all of them)
  assert.ok(v.runs.total <= back.stats.carries && v.runs.total >= back.stats.carries * 0.97, `${v.runs.total} of ${back.stats.carries}`);
  const def = nfl.fieldMapView(section, 'DEF', [rows.DEF[0].gsisId]);
  assert.equal(def.pass, null);
  assert.ok(def.strip.total > 0);
  assert.ok(nfl.fieldMapView(section, 'K', [rows.K[0].gsisId]).kicks);
  assert.ok(nfl.fieldMapView(section, 'P', [rows.P[0].gsisId]).punts);
});

test("Field Map: a kicker's misses marked round the rings and said under them", () => {
  const { kickMisses } = nfl;
  const BANDS = ['<30', '30-39', '40-49', '50-59', '60+'];
  // (Jason Myers' 2025, one more wide right from 50-59: one wide right under 30, wide left from 30-39, one
  // each way from 40-49, two wide right and one blocked from 50-59, short from 60+)
  const v = kickMisses(BANDS, [[0, 1, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 0, 0, 0], [0, 2, 0, 1, 0], [0, 0, 1, 0, 0]], [0, 0, 0, 0, 0]);
  assert.equal(v.fg, '2 wide left · 4 wide right · 1 short · 1 blocked');
  assert.equal(v.xp, '');
  assert.equal(v.none, false);
  assert.deepEqual(v.marks.map((m) => m.key), ['<30-right', '30-39-left', '40-49-left', '40-49-right', '50-59-right', '50-59-blocked', '60+-short']);
  const at = (key) => v.marks.find((m) => m.key === key);
  // (wide left out past a ring's left end, wide right past its right, mirrored; the farther the band, the lower)
  assert.ok(at('40-49-left').x < 160 - 40 && at('40-49-right').x > 160 + 40);
  assert.equal(at('40-49-left').x + at('40-49-right').x, 320);
  assert.equal(at('40-49-left').y, at('40-49-right').y);
  assert.ok(at('50-59-right').y > at('40-49-right').y && at('40-49-right').y > at('<30-right').y);
  // (short and blocked inside the ring, after its makes over tries: 50-59's ring 123 to 156 out from the posts
  // at 40; past a wider figure, further along)
  assert.ok(at('50-59-blocked').x > 160);
  assert.ok(at('50-59-blocked').y > 40 + 123 && at('50-59-blocked').y < 40 + 156);
  const after = kickMisses(BANDS, [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 2, 0, 1, 0], [0, 0, 0, 0, 0]], undefined, ['', '', '', '9/11', '']);
  assert.ok(after.marks.find((m) => m.kind === 'blocked').x >= at('50-59-blocked').x + 4 * 2.9);
  // (a count only past one, away from the ring; the words in the hover)
  assert.equal(at('50-59-right').count, '2');
  assert.equal(at('50-59-right').anchor, 'start');
  assert.ok(at('50-59-right').nx > at('50-59-right').x);
  assert.equal(at('40-49-left').count, '');
  assert.equal(at('40-49-left').anchor, 'end');
  assert.equal(at('50-59-right').title, '2 wide right from 50–59 yds');
  assert.equal(at('<30-right').title, '1 wide right from under 30 yds');
  assert.equal(at('60+-short').title, '1 short from 60+ yds');
  assert.match(at('50-59-blocked').d, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+M/, 'a cross');

  // (short, blocked and the rest side by side, right of the ring's middle)
  const row = kickMisses(BANDS, [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 2, 1, 1], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], [1, 0, 0, 2, 0]);
  const xs = row.marks.map((m) => m.x);
  assert.deepEqual(row.marks.map((m) => m.kind), ['short', 'blocked', 'other']);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[0] > 160);
  assert.ok(xs[1] - xs[0] > 6 + 5, 'room for the first one\'s count');
  assert.equal(row.marks[2].title, '1 missed another way from 40–49 yds');
  assert.equal(row.fg, '2 short · 1 blocked · 1 other');
  assert.equal(row.xp, '1 wide left · 2 blocked');
  assert.equal(row.aria, 'Field goals missed: 2 short, 1 blocked, 1 other; extra points missed: 1 wide left, 2 blocked');

  // (none: no marks, "No misses"; a file from before the misses were read: none at all)
  const clean = kickMisses(BANDS, BANDS.map(() => [0, 0, 0, 0, 0]), [0, 0, 0, 0, 0]);
  assert.deepEqual(clean.marks, []);
  assert.ok(clean.none);
  assert.equal(clean.aria, 'No misses');
  assert.equal(kickMisses(BANDS, undefined), null);

  // (the real 2025 file: every kicker's marks count his misses, his grid's tries less makes)
  const { file, rows } = fieldMaps(2025);
  for (const r of rows.K) {
    const k = nfl.fieldMapView(file.regular, 'K', [r.gsisId]).kicks;
    assert.equal(k.misses.marks.reduce((a, m) => a + m.n, 0), r.stats.fgAtt - r.stats.fgMade, r.name);
  }
  const myers = rows.K.find((r) => r.name === 'Jason Myers');
  const kicks = nfl.fieldMapView(file.regular, 'K', [myers.gsisId]).kicks;
  assert.equal(kicks.misses.fg, '2 wide left · 3 wide right · 1 short · 1 blocked');
  assert.match(kicks.bands[3].title, /\nMissed: 1 wide right · 1 blocked$/);
  // (an older file without them: the chart as before)
  const old = nfl.expandFieldMaps({ season: 2025, updated: '', regular: { league: { fg: [[1, 1], [0, 0], [0, 0], [0, 0], [0, 0]], pass: [], runs: [] }, players: { K9: { fg: [[1, 1], [0, 0], [0, 0], [0, 0], [2, 0]] } }, defenses: {} }, post: null, all: null });
  const oldKicks = nfl.fieldMapView(old.regular, 'K', ['K9']).kicks;
  assert.equal(oldKicks.misses, null);
  assert.equal(oldKicks.bands.length, 5);
});

test("Field Map: a part's tone against the league's, faded by few plays, flipped for a defense", () => {
  const { tone, spread } = nfl;
  assert.equal(tone(0.5, 0.1, 0.2, 1000, 12), 0.988, '2 spreads out: full strength, all but');
  assert.ok(tone(0.5, 0.1, 0.2, 3, 12) < 0.25, 'a few throws: faint');
  assert.equal(tone(0.5, 0.1, 0.2, 1000, 12, true), -0.988);
  assert.equal(tone(0.5, 0.1, 0.2, 0, 12), 0, 'none: neutral');
  assert.equal(spread([{ value: 1, plays: 20 }, { value: 2, plays: 20 }], 12), null, 'too few rows');
  assert.equal(spread([1, 2, 3, 99].map((value, i) => ({ value, plays: i < 3 ? 20 : 2 })), 12), Math.sqrt(2 / 3), 'the thin ones left out');
  // (the field: a stripe every other 5 yards, the 10 and 20 lines marked)
  assert.equal(nfl.PASS_FIELD.lines.filter((l) => l.band).length, 2);
});

// ---- the Team tab's formations by the injury report (player-card/depth-lineup.ts)

// (a chart's player: his id, his short name, his flag; a spot: its group, the groups it borrows from)
const man = (id, status = null) => ({ id, short: id, name: id, status, statusText: status, injury: null, snaps: null, games: 0, headshot: null, espnId: null });
const spot = (key, group, near, ...depth) => ({ key, label: key, name: key, x: 0, y: 0, group, near, depth });
const ids = (lineup) => Object.fromEntries(Object.entries(lineup).map(([k, l]) => [k, l.player?.id ?? null]));

test('depth lineup: who the injury report keeps off the field (Out, Doubtful, IR, PUP, suspended; not Questionable)', () => {
  const { sidelined } = nfl;
  for (const s of ['O', 'D', 'IR', 'PUP', 'SUSP', 'IL']) assert.equal(sidelined(man('a', s)), true, s);
  assert.equal(sidelined(man('a', 'Q')), false);
  assert.equal(sidelined(man('a')), false);
  assert.equal(sidelined(null), false);
  // (a status the loader didn't shorten, by its words)
  assert.equal(sidelined({ ...man('a', 'Reserve/COVID-19'), statusText: 'Reserve/COVID-19' }), true);
  assert.equal(sidelined({ ...man('a', 'Day-To-Day'), statusText: 'Day-To-Day' }), false);
});

test('depth lineup: a starter out shows his listed backup (the next healthy one), in for him; Starters shows the starter', () => {
  const { slotLineup } = nfl;
  const qb = [man('Jackson', 'O'), man('Huntley', 'D'), man('Fagnano'), man('Thompson')];
  const now = slotLineup(qb, 'current');
  assert.deepEqual([now.player.id, now.depth, now.inFor.id, now.note], ['Fagnano', 2, 'Jackson', 'In for Jackson (O)']);
  const chart = slotLineup(qb, 'starters');
  assert.deepEqual([chart.player.id, chart.depth, chart.inFor, chart.note], ['Jackson', 0, null, null]);
  // (a questionable starter plays; a hurt one with nobody healthy behind him never shows: nobody; nobody
  // listed at all, none)
  assert.equal(slotLineup([man('Flowers', 'Q'), man('Moore')], 'current').player.id, 'Flowers');
  const alone = slotLineup([man('Stanley', 'IR'), man('Vinson', 'O')], 'current');
  assert.deepEqual([alone.player, alone.inFor.id], [null, 'Stanley']);
  assert.equal(slotLineup([man('Stanley', 'IR')], 'starters').player.id, 'Stanley');
  assert.deepEqual(slotLineup([], 'current'), { player: null, depth: 0, inFor: null, note: null });
  // (a backup already on the field elsewhere passed over)
  assert.equal(slotLineup([man('Jurgens', 'O'), man('Ioane'), man('Pocic')], 'current', new Set(['Ioane'])).player.id, 'Pocic');
});

test('depth lineup: a side fills a hole from its own chart first, nobody at two spots', () => {
  const { sideLineup } = nfl;
  // (the center out: his backup starts at right guard, so the next one in; a tight end out: the second
  // tight end starts at his own spot, the third fills in)
  const slots = [
    spot('C', 'OL', ['OL'], man('Jurgens', 'O'), man('Ioane'), man('Pocic')),
    spot('RG', 'OL', ['OL'], man('Ioane'), man('Vorhees')),
    spot('TE', 'TE', ['TE'], man('Andrews', 'IR'), man('Hibner'), man('Cuevas')),
    spot('TE2', 'TE', ['TE'], man('Hibner'), man('Cuevas')),
    spot('LG', 'OL', ['OL'], man('Simpson', 'Q'), man('Vorhees')),
  ];
  const now = sideLineup(slots, 'current');
  assert.deepEqual(ids(now), { C: 'Pocic', RG: 'Ioane', TE: 'Cuevas', TE2: 'Hibner', LG: 'Simpson' });
  assert.equal(now.C.note, 'In for Jurgens (O)');
  assert.equal(now.RG.inFor, null);
  const chart = sideLineup(slots, 'starters');
  assert.deepEqual(ids(chart), { C: 'Jurgens', RG: 'Ioane', TE: 'Andrews', TE2: 'Hibner', LG: 'Simpson' });
  assert.ok(Object.values(chart).every((l) => l.inFor === null));
});

test('depth lineup: a starter out with no listed backup borrows from the nearest group (a back at fullback, any lineman on the line, a safety at corner)', () => {
  const { sideLineup, sidelined } = nfl;
  const slots = [
    spot('RB', 'RB', ['RB', 'FB', 'WR'], man('McCaffrey'), man('Black'), man('James')),
    spot('FB', 'FB', ['FB', 'RB', 'TE'], man('Juszczyk', 'O')),
    spot('RT', 'OL', ['OL'], man('McKivitz', 'IR')),
    spot('LT', 'OL', ['OL'], man('Williams'), man('Lowe', 'O'), man('Cruz')),
    spot('LCB', 'DB', ['DB'], man('Lenoir', 'SUSP')),
    spot('SS', 'DB', ['DB'], man('Brown'), man('Mustapha')),
  ];
  const now = sideLineup(slots, 'current');
  assert.deepEqual(ids(now), { RB: 'McCaffrey', FB: 'Black', RT: 'Cruz', LT: 'Williams', LCB: 'Mustapha', SS: 'Brown' });
  assert.deepEqual([now.FB.depth, now.FB.note], [-1, 'In for Juszczyk (O)']);
  assert.equal(now.LCB.inFor.id, 'Lenoir');
  // (nobody out on the field in Current; every one of them on it in Starters)
  assert.ok(Object.values(now).every((l) => !sidelined(l.player)));
  assert.deepEqual(Object.values(sideLineup(slots, 'starters')).map((l) => l.player.id), ['McCaffrey', 'Juszczyk', 'McKivitz', 'Williams', 'Lenoir', 'Brown']);
});

test('depth formation: nobody healthy anywhere near a spot, the next grouping that can be fielded (Starters: the main one)', () => {
  const { sideFormation } = nfl;
  const common = [spot('QB', 'QB', ['QB'], man('Purdy')), spot('RB', 'RB', ['RB', 'FB'], man('McCaffrey')), spot('TE', 'TE', ['TE'], man('Kittle'))];
  const wr = [spot('X', 'WR', ['WR'], man('Evans')), spot('Z', 'WR', ['WR'], man('Samuel'))];
  // (21 personnel: the fullback out, nobody behind him, no back or tight end to spare)
  const fullback = { ...spot('FB', 'FB', ['FB', 'RB', 'TE'], man('Juszczyk', 'O')), name: 'Fullback' };
  const i21 = [...common, ...wr, fullback];
  const p11 = [...common, ...wr, spot('SLOT', 'WR', ['WR'], man('Cooks'))];
  const p12 = [...common, ...wr, spot('TE2', 'TE', ['TE'], man('Farrell', 'IR'))];
  const side = { set: '21 Personnel', slots: i21, others: [{ set: '12 Personnel', slots: p12 }, { set: '11 Personnel', slots: p11 }] };
  const now = sideFormation(side, 'current');
  assert.equal(now.set, '11 Personnel');
  assert.equal(now.note, 'No healthy fullback: their next most-used grouping');
  assert.equal(now.lineup.SLOT.player.id, 'Cooks');
  const chart = sideFormation(side, 'starters');
  assert.deepEqual([chart.set, chart.note, chart.lineup.FB.player.id, chart.lineup.FB.player.status], ['21 Personnel', null, 'Juszczyk', 'O']);
  // (a back to borrow: the main grouping kept, the back at fullback)
  const deeper = [common[0], spot('RB', 'RB', ['RB', 'FB'], man('McCaffrey'), man('Black')), common[2], ...wr, fullback];
  const borrow = sideFormation({ ...side, slots: deeper }, 'current');
  assert.deepEqual([borrow.set, borrow.note, borrow.lineup.FB.player.id], ['21 Personnel', null, 'Black']);
  // (no other grouping fields everyone: the one with the fewest open spots, the hole open, never the hurt one)
  const stuck = sideFormation({ set: '21 Personnel', slots: i21, others: [{ set: '12 Personnel', slots: p12 }] }, 'current');
  assert.equal(stuck.set, '21 Personnel');
  assert.equal(stuck.lineup.FB.player, null);
});
