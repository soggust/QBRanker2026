// The Algorithm desk and the Bets page (libs/ranker/src/engine/bets), their pure parts under Node, and the
// bettor's own pieces they mirror (libs/ranker/scripts/model): a prop's count in play read off a box score
// the same way the grader reads the final; a pick's colors never a result's green or red; a bet in play settled
// by the score exactly as the run will grade it; the records, the curve and the sorting; the public picks'
// bands; the leagues' setup. No network: the box scores and ledgers here are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadEngine } from './support/engine.mjs';
import { BANKROLL, decimal, intentOf, outcomeOf, settle, stakeFor } from '../libs/ranker/scripts/model/desk.mjs';
import { settleProp, statInFinal } from '../libs/ranker/scripts/model/props.mjs';
import { buildPicks, level, levelOf, TOP } from '../libs/ranker/scripts/model/picks.mjs';
import { BOOK, LEAGUES, PROP_CAPS } from '../libs/ranker/scripts/model/leagues.mjs';
import { LINE_BOOKS, SPORT_KEYS } from '../libs/ranker/scripts/model/oddsapi.mjs';
import { ESPN_PROVIDER } from '../libs/ranker/scripts/model/espn.mjs';

const desk = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support', 'bets-entry.ts'), data: {} });

// ---------------------------------------------------------------------------
// Made-up box scores, ESPN's summary shape
// ---------------------------------------------------------------------------

const athlete = (id, stats, extra = {}) => ({ athlete: { id }, stats, ...extra });
const BOXES = {
  nfl: {
    boxscore: {
      players: [
        {
          team: { color: '00338d', alternateColor: 'c60c30' },
          statistics: [
            { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], athletes: [athlete('1', ['22/31', '287', '9.3', '2', '1'])] },
            { name: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [athlete('1', ['4', '18', '4.5', '0', '9']), athlete('2', ['17', '84', '4.9', '1', '22'])] },
            { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], athletes: [athlete('2', ['3', '25', '8.3', '0', '12', '4']), athlete('3', ['7', '112', '16', '1', '41', '9'])] },
          ],
        },
        {
          team: { color: '041e42', alternateColor: 'a5acaf' },
          statistics: [{ name: 'rushing', labels: ['CAR', 'YDS'], athletes: [athlete('9', [], { didNotPlay: true })] }],
        },
      ],
    },
  },
  nba: {
    boxscore: {
      players: [
        {
          team: { color: '007a33', alternateColor: 'ba9653' },
          statistics: [{ labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST'], athletes: [athlete('11', ['34', '27', '10-18', '3-7', '4-4', '8', '6'])] }],
        },
      ],
    },
  },
  nhl: {
    boxscore: {
      players: [
        {
          team: { color: 'c8102e', alternateColor: '000000' },
          statistics: [
            { name: 'forwards', labels: ['G', 'A', '+/-', 'S'], athletes: [athlete('21', ['1', '2', '1', '5'])] },
            { name: 'goalies', labels: ['SA', 'GA', 'SV', 'SV%'], athletes: [athlete('22', ['33', '2', '31', '.939'])] },
          ],
        },
      ],
    },
  },
  mlb: {
    boxscore: {
      players: [
        {
          team: { color: '002d72', alternateColor: 'ff5910' },
          statistics: [
            { type: 'batting', labels: ['AB', 'R', 'H', 'RBI'], athletes: [athlete('31', ['4', '1', '2', '1'])] },
            { type: 'pitching', labels: ['IP', 'H', 'R', 'ER', 'BB', 'K'], athletes: [athlete('32', ['6.2', '5', '2', '2', '1', '8'])] },
          ],
        },
      ],
    },
  },
};

// (each sport's props on the made-up boxes: what the count should read)
const COUNTS = [
  ['nfl', 'passYds', '1', 287],
  ['nfl', 'passAtt', '1', 31],
  ['nfl', 'passCmp', '1', 22],
  ['nfl', 'passTd', '1', 2],
  ['nfl', 'passInt', '1', 1],
  ['nfl', 'rushYds', '2', 84],
  ['nfl', 'rushAtt', '2', 17],
  ['nfl', 'recYds', '3', 112],
  ['nfl', 'rec', '3', 7],
  ['nfl', 'rushRecYds', '2', 109],
  ['nfl', 'rushRecYds', '3', 112],
  ['nba', 'pts', '11', 27],
  ['nba', 'reb', '11', 8],
  ['nba', 'ast', '11', 6],
  ['nba', 'fg3', '11', 3],
  ['nba', 'pra', '11', 41],
  ['nhl', 'sog', '21', 5],
  ['nhl', 'points', '21', 3],
  ['nhl', 'saves', '22', 31],
  ['mlb', 'k', '32', 8],
  ['mlb', 'outs', '32', 20],
  ['mlb', 'hits', '31', 2],
];

test("live-props liveStat: each sport's prop counts off a box score in play", () => {
  for (const [sport, type, id, want] of COUNTS) assert.equal(desk.liveStat(sport, type, id, BOXES[sport]), want, `${sport} ${type} for ${id}`);
});

test("liveStat: a player who didn't play, isn't listed, or MLB's total bases (not in ESPN's box): no count", () => {
  assert.equal(desk.liveStat('nfl', 'rushYds', '9', BOXES.nfl), null);
  assert.equal(desk.liveStat('nfl', 'passYds', '404', BOXES.nfl), null);
  assert.equal(desk.liveStat('mlb', 'tb', '31', BOXES.mlb), null);
  assert.equal(desk.liveStat('nba', 'pts', '11', null), null);
});

test("the count in play is the grader's: liveStat matches props.mjs statInFinal on every prop", async () => {
  for (const [sport, type, id] of COUNTS) {
    const graded = await statInFinal(sport, { athlete: id, propType: type, player: 'X' }, BOXES[sport], null);
    assert.equal(desk.liveStat(sport, type, id, BOXES[sport]), graded, `${sport} ${type}`);
  }
});

test("athleteColors: the team whose table lists the player", () => {
  assert.deepEqual(desk.athleteColors('3', BOXES.nfl), { color: '00338d', alternateColor: 'c60c30' });
  assert.deepEqual(desk.athleteColors('9', BOXES.nfl), { color: '041e42', alternateColor: 'a5acaf' });
  assert.equal(desk.athleteColors('404', BOXES.nfl), null);
});

// ---------------------------------------------------------------------------
// Colors: a pick's never reads as a result
// ---------------------------------------------------------------------------

// (a color as [hue, saturation %, lightness %], by colors.ts's own reader)
const parseHsl = (c) => {
  assert.ok(/^#[0-9a-f]{6}$/.test(c), `not a hex color: ${c}`);
  const [h, s, l] = desk.hslOf(c);
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
};
// (the hue rounded: one just past a band's edge may round onto it)
const readsAsResult = ([h, s]) => s > 30 && (h < 11 || h > 330 || (h > 80 && h < 165));

test('meterColor: a green or red team color is passed over for its other one; neither, none', () => {
  // (the Celtics' green: its gold instead)
  const [h] = parseHsl(desk.meterColor({ color: '007a33', alternateColor: 'ba9653' }));
  assert.ok(h > 30 && h < 50, `gold's hue ${h}`);
  assert.equal(desk.meterColor({ color: '007a33', alternateColor: 'c8102e' }), null);
  assert.equal(desk.meterColor({ color: 'nonsense', alternateColor: undefined }), null);
  assert.equal(desk.meterColor(null), null);
});

test('meterColor: a navy or black is lifted to show on the dark board; a gray stays gray', () => {
  // (how light a color reads: Lab's L*, as colors.ts lifts it)
  const navy = desk.meterColor({ color: '002244' });
  assert.ok(desk.lightness(navy) >= 52, `navy ${navy} too dark`);
  // (a red with a black: the red passed over, the black a grey)
  assert.equal(parseHsl(desk.meterColor({ color: 'c8102e', alternateColor: '000000' }))[1], 0);
  // (a real color before a near-gray: Vegas's gold over its slate)
  const [h] = parseHsl(desk.meterColor({ color: '333f48', alternateColor: 'b4975a' }));
  assert.ok(h > 30 && h < 50);
});

test('meterColor never gives a green or a red, and never a dark one, whatever the team colors', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const hex = () => Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');
  for (let i = 0; i < 3000; i++) {
    const c = desk.meterColor({ color: hex(), alternateColor: hex() });
    if (c === null) continue;
    const hsl = parseHsl(c);
    assert.ok(!readsAsResult(hsl), `${c} reads as a result`);
    assert.ok(desk.lightness(c) >= 52, `${c} too dark`);
  }
});

test("meterColor is the app's one team color (colors.ts), its greens and reds passed over", () => {
  assert.equal(desk.meterColor({ color: '003594', alternateColor: '869397' }), desk.sharedTeamColor(['003594', '869397']));
  assert.equal(desk.meterColor({ color: '007a33', alternateColor: 'ba9653' }), desk.sharedTeamColor(['ba9653']));
});

test('pickTeamColor: a side by its abbreviation, a prop by its team id, a total by no one', () => {
  const pair = { color: '003594', alternateColor: '869397' };
  const colors = new Map([
    ['nfl:DAL', pair],
    ['nfl#6', pair],
  ]);
  const dal = desk.meterColor(pair);
  assert.equal(desk.pickTeamColor(colors, 'nfl', { total: false, abbr: 'DAL' }), dal);
  assert.equal(desk.pickTeamColor(colors, 'nfl', { total: false, teamId: '6' }), dal);
  assert.equal(desk.pickTeamColor(colors, 'nfl', { total: true, abbr: 'DAL' }), null);
  assert.equal(desk.pickTeamColor(colors, 'nfl', { total: false, abbr: 'NYG' }), null);
  assert.equal(desk.pickTeamColor(colors, 'nba', { total: false, abbr: 'DAL' }), null);
});

test("splitPick: the one word that says what the bet is, a total's first, a side's last", () => {
  assert.deepEqual(desk.splitPick('Over 47.5', true), ['', 'Over', ' 47.5']);
  assert.deepEqual(desk.splitPick('Under 7.5 Carries', true), ['', 'Under', ' 7.5 Carries']);
  assert.deepEqual(desk.splitPick('DAL -8.5', false), ['DAL ', '-8.5', '']);
  assert.deepEqual(desk.splitPick('TB ML', false), ['TB ', 'ML', '']);
  assert.deepEqual(desk.splitPick('Pass', false), ['', 'Pass', '']);
  assert.deepEqual(desk.splitPick('Pass', true), ['', 'Pass', '']);
});

// ---------------------------------------------------------------------------
// A bet in play, settled by the score
// ---------------------------------------------------------------------------

const bet = (over = {}) => ({ id: 'x', sport: 'nfl', start: '2026-10-04T17:00:00Z', placedAt: '', matchup: 'TB @ DAL', market: 'spread', side: 'home', line: -3, pick: 'DAL -3', odds: -110, model: 0.55, fair: 0.5, p: 0.53, ev: 0.02, units: 1.5, status: 'open', profit: 0, ...over });
const board = (hs, as, final = false) => ({ hs, as, final });

test('a total settles as soon as the scoring passes its line: the over won, the under lost', () => {
  const over = bet({ market: 'total', side: 'over', line: 45.5, odds: 120, units: 2 });
  const under = { ...over, side: 'under', odds: -110 };
  assert.equal(desk.provisional(over, board(24, 21), undefined), null);
  assert.deepEqual(desk.provisional(over, board(27, 21), undefined), { status: 'won', profit: 2.4 });
  assert.deepEqual(desk.provisional(under, board(27, 21), undefined), { status: 'lost', profit: -2 });
  // (an under only once it's final under the line)
  assert.deepEqual(desk.provisional(under, board(24, 20, true), undefined).status, 'won');
});

test('a side settles only once its game is final; on the number it pushes', () => {
  const side = bet();
  assert.equal(desk.provisional(side, board(30, 0), undefined), null);
  assert.deepEqual(desk.provisional(side, board(27, 24, true), undefined), { status: 'push', profit: 0 });
  assert.equal(desk.provisional(side, board(28, 24, true), undefined).status, 'won');
  assert.equal(desk.provisional({ ...side, side: 'away', line: 3 }, board(28, 24, true), undefined).status, 'lost');
  const ml = bet({ market: 'ml', side: 'away', line: null, odds: 150, units: 1 });
  assert.equal(desk.provisional(ml, board(20, 24), undefined), null);
  assert.deepEqual(desk.provisional(ml, board(20, 24, true), undefined), { status: 'won', profit: 1.5 });
  assert.equal(desk.provisional(ml, undefined, undefined), null);
});

test('a prop settles once past its line (an over won, an under lost) or once its game is over', () => {
  const over = bet({ market: 'prop', propType: 'rec', side: 'over', line: 4.5, odds: -110, units: 1.1 });
  const under = { ...over, side: 'under' };
  assert.equal(desk.provisional(over, board(7, 3), 4), null);
  const won = desk.provisional(over, board(7, 3), 5);
  assert.equal(won.status, 'won');
  assert.ok(Math.abs(won.profit - 1) < 1e-12);
  assert.equal(desk.provisional(under, board(7, 3), 5).status, 'lost');
  assert.equal(desk.provisional(under, board(7, 3), 4), null);
  assert.equal(desk.provisional(under, board(17, 13, true), 4).status, 'won');
  // (no count for him: nothing to say)
  assert.equal(desk.provisional(over, board(17, 13, true), null), null);
});

test('a bet already graded, or one without a line, is not settled again', () => {
  assert.equal(desk.provisional(bet({ status: 'won' }), board(28, 0, true), undefined), null);
  assert.equal(desk.provisional(bet({ line: undefined }), board(28, 0, true), undefined), null);
});

test("the desk's settling at the final is the run's: desk.mjs settle and props.mjs settleProp", () => {
  const sides = { spread: ['home', 'away'], total: ['over', 'under'], ml: ['home', 'away'] };
  for (const market of ['spread', 'total', 'ml']) {
    for (const side of sides[market]) {
      for (const line of market === 'ml' ? [null] : market === 'total' ? [40.5, 41, 44] : [-7, -3.5, 2.5, 3]) {
        for (const odds of [-150, -110, 100, 135]) {
          for (const [hs, as] of [[24, 17], [20, 20], [17, 24], [31, 13], [21, 20]]) {
            const b = bet({ market, side, line, odds, units: 2.5 });
            const run = settle(b, { hs, as, homeAbbr: 'DAL', awayAbbr: 'TB' });
            const here = desk.provisional(b, board(hs, as, true), undefined);
            assert.equal(here.status, run.status, `${market} ${side} ${line} at ${hs}-${as}`);
            assert.ok(Math.abs(here.profit - run.profit) < 1e-3, `${market} ${side} ${odds}: ${here.profit} vs ${run.profit}`);
          }
        }
      }
    }
  }
  for (const side of ['over', 'under']) {
    for (const value of [3, 4.5, 5, 9]) {
      const b = bet({ market: 'prop', side, line: 4.5, odds: 115, units: 1 });
      const run = settleProp({ ...b, player: 'X', statLabel: 'Receptions' }, value);
      const here = desk.provisional(b, board(0, 0, true), value);
      assert.equal(here.status, run.status);
      assert.ok(Math.abs(here.profit - run.profit) < 1e-3);
    }
  }
});

test('settleProp: a player who did not play is no action', () => {
  assert.deepEqual(settleProp(bet({ market: 'prop', side: 'over', line: 4.5 }), null), { status: 'push', profit: 0, void: true, actual: null, final: 'did not play' });
  const exact = settleProp({ ...bet({ market: 'prop', side: 'over', line: 5 }), player: 'X', statLabel: 'Receptions' }, 5);
  assert.deepEqual([exact.status, exact.profit, exact.final], ['push', 0, 'X 5 Receptions']);
});

test("sideEdge and propState: a side's lead at the score; a prop alive under its line, decided past it", () => {
  assert.equal(desk.sideEdge(bet(), board(20, 14)), 3);
  assert.equal(desk.sideEdge(bet({ side: 'away', line: 3 }), board(20, 14)), -3);
  assert.equal(desk.sideEdge(bet({ market: 'ml', line: null }), board(20, 14)), 6);
  assert.equal(desk.sideEdge(bet({ market: 'total', line: 40.5 }), board(20, 14)), null);
  assert.equal(desk.sideEdge(bet(), undefined), null);
  const prop = bet({ market: 'prop', line: 4.5, side: 'over' });
  assert.equal(desk.propState(prop, 4), 'alive');
  assert.equal(desk.propState(prop, 5), 'won');
  assert.equal(desk.propState({ ...prop, side: 'under' }, 5), 'lost');
  assert.equal(desk.propState(prop, null), null);
});

test("meterOf: a short count as pips up to the one past the line; yards and totals as a bar notched at the line", () => {
  const rec = desk.meterOf(bet({ market: 'prop', propType: 'rec', line: 4.5 }), 3);
  assert.equal(rec.pips.length, 6);
  assert.deepEqual(rec.pips.map((p) => p.on), [true, true, true, false, false, false]);
  assert.equal(rec.pips.at(-1).past, true);
  assert.equal(desk.meterOf(bet({ market: 'prop', propType: 'rec', line: 4.5 }), 8).extra, 2);
  const yards = desk.meterOf(bet({ market: 'prop', propType: 'recYds', line: 60.5 }), 30);
  assert.equal(yards.pips, null);
  assert.ok(Math.abs(yards.mark - 100 / 1.35) < 1e-9);
  assert.ok(yards.fill > 0 && yards.fill < yards.mark);
  assert.equal(desk.meterOf(bet({ market: 'prop', propType: 'recYds', line: 60.5 }), 200).fill, 100);
  assert.equal(desk.meterOf(bet({ market: 'total', line: 45.5 }), 30).pips, null);
});

// ---------------------------------------------------------------------------
// Records, the bankroll and its curve
// ---------------------------------------------------------------------------

test('toWin: what a bet pays on top of its stake at American odds', () => {
  assert.equal(desk.toWin({ odds: 150, units: 1 }), 1.5);
  assert.ok(Math.abs(desk.toWin({ odds: -110, units: 1.1 }) - 1) < 1e-12);
  assert.equal(desk.toWin({ odds: 100, units: 3 }), 3);
  for (const odds of [-250, -110, 100, 145]) assert.ok(Math.abs(desk.toWin({ odds, units: 2 }) - 2 * (decimal(odds) - 1)) < 1e-12);
});

test('tally: the record, the units, the return on them, the open bets and the close', () => {
  const bets = [
    bet({ status: 'won', profit: 1.36, units: 1.5, clv: { pts: 1, prob: 0.02, ev: 0.04, beat: true } }),
    bet({ status: 'lost', profit: -2, units: 2, clv: { pts: -0.5, prob: -0.01, ev: -0.02, beat: false } }),
    bet({ status: 'push', profit: 0, units: 1, clv: { pts: 0, prob: 0, ev: null, beat: null } }),
    bet({ status: 'open', units: 0.5 }),
  ];
  const t = desk.tally('All', bets);
  assert.deepEqual([t.bets, t.won, t.lost, t.push, t.open], [3, 1, 1, 1, 1]);
  assert.equal(t.staked, 4.5);
  assert.ok(Math.abs(t.profit + 0.64) < 1e-12);
  assert.ok(Math.abs(t.roi - -0.64 / 4.5) < 1e-12);
  assert.equal(t.clvN, 3);
  assert.equal(t.clvBeat, 0.5);
  assert.ok(Math.abs(t.clvEv - 0.01) < 1e-12);
  const none = desk.tally('None', []);
  assert.deepEqual([none.roi, none.clvBeat, none.clvEv], [null, null, null]);
  // (a void prop, or a spread on a game called off, no action: out of the record and its stake, as desk.mjs record)
  const voided = desk.tally('Void', [...bets, bet({ market: 'prop', status: 'push', profit: 0, units: 1, void: true }), bet({ status: 'push', profit: 0, units: 2, void: true, final: 'canceled' })]);
  assert.deepEqual([voided.bets, voided.push, voided.staked, voided.roi], [3, 1, 4.5, t.roi]);
});

test('rebuysFor: 1,000 more each time the open stakes would take the balance under 0', () => {
  assert.equal(desk.rebuysFor(1000, -200, 700), 0);
  assert.equal(desk.rebuysFor(1000, -900, 150), 1);
  assert.equal(desk.rebuysFor(1000, -2500, 10), 2);
});

test('calibrationOf: 5-point bands (the ends gathered), a broken premise counting for its weight', () => {
  const rows = desk.calibrationOf([
    bet({ status: 'won', p: 0.52 }),
    bet({ status: 'lost', p: 0.54 }),
    bet({ status: 'won', p: 0.12 }),
    bet({ status: 'lost', p: 0.97, weight: 0.3 }),
    bet({ status: 'won', p: 0.9 }),
    bet({ status: 'push', p: 0.5 }),
    bet({ status: 'open', p: 0.5 }),
  ]);
  assert.deepEqual(rows.map((r) => r.label), ['30-35%', '50-55%', '85-90%']);
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 2]);
  assert.equal(rows[1].was, 0.5);
  assert.ok(Math.abs(rows[2].was - 1 / 1.3) < 1e-12);
  assert.ok(Math.abs(rows[2].said - (0.3 * 0.97 + 0.9) / 1.3) < 1e-12);
});

test('the profit curve: from 0 through each graded bet, its range (0 in it), its last point the profit now', () => {
  const graded = desk.gradedOrder([
    bet({ id: 'b', status: 'lost', profit: -2, gradedAt: '2026-10-02T00:00:00Z' }),
    bet({ id: 'a', status: 'won', profit: 3, gradedAt: '2026-10-01T00:00:00Z' }),
    bet({ id: 'o', status: 'open' }),
  ]);
  assert.deepEqual(graded.map((b) => b.id), ['a', 'b']);
  const c = desk.profitCurves(graded, 1000, desk.units);
  assert.deepEqual(c.totals, [0, 3, 1]);
  assert.deepEqual(c.range, { min: 0, max: 3 });
  assert.equal(c.path, 'M0.0,110.0 L300.0,10.0 L600.0,76.7');
  assert.equal(c.spots.length, 3);
  assert.equal(c.end.px, 600);
  assert.equal(c.profit, 1);
  assert.match(c.spots[2].title, /^After bet 2 of 2: \+1\.00u, bankroll 1001\.00u \(-2\.00u, NFL DAL -3, lost\)$/);
  assert.equal(c.zeroY, 110);
});

// (bets in three sports, graded in turn)
const MIXED = [
  ['nfl', 2.5],
  ['nba', -1],
  ['nfl', -1.5],
  ['nhl', 0.91],
  ['nba', -2],
  ['nhl', 1.2],
  ['nfl', 0.45],
].map(([sport, profit], i) => bet({ id: `m${i}`, sport, status: profit > 0 ? 'won' : 'lost', profit, gradedAt: `2026-10-0${i + 1}T00:00:00Z` }));

test("the profit curve by sport: a line for each sport with bets graded, at every bet adding up to the total's", () => {
  const c = desk.profitCurves(desk.gradedOrder(MIXED), 1000, desk.units);
  assert.deepEqual(c.lines.map((l) => l.sport), ['nfl', 'nba', 'nhl']);
  assert.equal(c.solo, null);
  for (const l of c.lines) assert.equal(l.values.length, c.totals.length);
  c.totals.forEach((total, i) => assert.ok(Math.abs(c.lines.reduce((s, l) => s + l.values[i], 0) - total) < 1e-9, `bet ${i}`));
  // (each sport's line is its own bets' running profit, flat while another sport's are graded)
  assert.deepEqual(c.lines[1].values, [0, 0, -1, -1, -1, -3, -3, -3]);
  assert.ok(Math.abs(c.lines[0].profit - 1.45) < 1e-9);
  assert.ok(Math.abs(c.profit - 0.56) < 1e-9);
  // (one scale for every line: the NBA's low the chart's low, under 0, though the total never went there)
  assert.equal(c.range.min, -3);
  assert.equal(c.lines[1].path.split(' ').at(-1), 'L600.0,110.0');
  assert.match(c.spots[2].title, / · NFL \+2\.50u, NBA -1\.00u, NHL \+0\.00u$/);
});

test('the profit curve with one sport on show (the chips): no lines of its own, the total its line', () => {
  const nba = MIXED.filter((b) => b.sport === 'nba');
  const c = desk.profitCurves(desk.gradedOrder(nba), 1000, desk.units);
  assert.deepEqual(c.lines, []);
  assert.equal(c.solo, 'nba');
  assert.deepEqual(c.totals, [0, -1, -3]);
  assert.deepEqual(c.range, { min: -3, max: 0 });
  assert.equal(c.zeroY, 10);
  assert.doesNotMatch(c.spots[1].title, / · /);
});

test('streakOf: the run of the latest results, pushes skipped', () => {
  const s = (...list) => desk.streakOf(list.map((status) => bet({ status })));
  assert.equal(s(), null);
  assert.equal(s('lost', 'won', 'won', 'push', 'won'), 'W3');
  assert.equal(s('won', 'lost', 'lost'), 'L2');
  assert.equal(s('push'), null);
});

test("gameDaysOf: the games with bets open or graded in the last 3 days, by day, each with its count", () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const days = desk.gameDaysOf(
    [
      bet({ event: '1', start: '2026-10-09T23:00:00Z' }),
      bet({ event: '1', start: '2026-10-09T23:00:00Z', market: 'total' }),
      bet({ event: '2', sport: 'nhl', matchup: 'PHI @ OTT', start: '2026-10-09T23:30:00Z' }),
      bet({ event: '3', status: 'won', start: '2026-09-20T17:00:00Z', gradedAt: '2026-09-21T00:00:00Z' }),
      bet({ event: undefined }),
    ],
    null,
    now,
  );
  const games = days.flatMap((d) => d.games);
  assert.deepEqual(games.map((g) => [g.event, g.count]), [['1', 2], ['2', 1]]);
  assert.match(games[1].label, /^NHL · PHI @ OTT · /);
  assert.equal(desk.gameDaysOf([bet({ event: '2', sport: 'nhl' })], 'nfl', now).length, 0);
});

test("the desk's stakes and bankroll are the bettor's (desk.mjs)", () => {
  assert.equal(desk.BANKROLL, BANKROLL);
  const stakes = new Set();
  for (let ev = -0.2; ev <= 0.3; ev += 0.001) stakes.add(stakeFor(ev, 0.08));
  assert.deepEqual([...stakes].sort((a, b) => a - b), desk.STAKES);
});

test("intentOf: an older bet without its intent goes by its EV, the front's and the bettor's alike", () => {
  for (const b of [bet({ ev: 0.03 }), bet({ ev: -0.01 }), bet({ ev: 0 }), bet({ ev: -0.2, intent: 'edge' }), bet({ ev: 0.2, intent: 'action' })]) {
    assert.equal(desk.intentOf(b), intentOf(b));
  }
  assert.deepEqual(outcomeOf({ units: 2, odds: -200 }, 0.5), { status: 'won', profit: 1 });
});

// ---------------------------------------------------------------------------
// Sorting and words
// ---------------------------------------------------------------------------

test('TableSorts: a number column biggest first, text A first, again the other way; a missing value last', () => {
  const sorts = new desk.TableSorts();
  const rows = [{ n: 2, s: 'b' }, { n: null, s: 'a' }, { n: 5, s: 'c' }];
  const value = (r, key) => (key === 'label' ? r.s : r.n);
  assert.equal(sorts.sorted('t', rows, value), rows);
  sorts.sortBy('t', 'n');
  assert.equal(sorts.ariaSort('t', 'n'), 'descending');
  assert.deepEqual(sorts.sorted('t', rows, value).map((r) => r.n), [5, 2, null]);
  sorts.sortBy('t', 'n');
  assert.deepEqual(sorts.sorted('t', rows, value).map((r) => r.n), [2, 5, null]);
  sorts.sortBy('t', 'label');
  assert.equal(sorts.ariaSort('t', 'label'), 'ascending');
  assert.equal(sorts.ariaSort('t', 'n'), null);
  assert.deepEqual(sorts.sorted('t', rows, value).map((r) => r.s), ['a', 'b', 'c']);
});

test("the column readers: a tally's record by its share won, a bet's CLV by its EV, an unknown column none", () => {
  const t = desk.tally('x', [bet({ status: 'won', profit: 1 }), bet({ status: 'lost', profit: -1 }), bet({ status: 'lost', profit: -1 })]);
  assert.ok(Math.abs(desk.tallyValue(t, 'record') - 1 / 3) < 1e-12);
  assert.equal(desk.tallyValue(t, 'nope'), null);
  assert.equal(desk.tallyValue(t, 'toString'), null);
  const read = desk.betValue(() => ({ profit: 2 }), () => 'F');
  const b = bet({ clv: { pts: 1.5, prob: null, ev: null, beat: true } });
  assert.equal(read(b, 'clv'), 1.5);
  assert.equal(read(b, 'result'), 2);
  assert.equal(read(b, 'odds'), -110);
  // (a graded bet without its time by its start; one decided in play, not graded yet, the latest of all)
  assert.equal(read({ ...b, status: 'won' }, 'graded'), b.start);
  assert.ok(read(b, 'graded') > new Date().toISOString());
});

test('bet-format: odds, percents, units', () => {
  assert.equal(desk.americanOdds(150), '+150');
  assert.equal(desk.americanOdds(-110), '-110');
  assert.equal(desk.pct(0.5243), '52.4%');
  assert.equal(desk.pct(null), '-');
  assert.equal(desk.pct(0.5, 0), '50%');
  assert.equal(desk.units(1.5), '+1.50u');
  assert.equal(desk.units(-2), '-2.00u');
  assert.equal(desk.signed(0.4), '+0.4');
  assert.equal(desk.num(undefined), '-');
  assert.match(desk.teamLogo('nhl', 'WSH'), /\/500-dark\/wsh\.png/);
});

test("every hover the desk's template asks for is written (desk-help.ts)", () => {
  const html = fs.readFileSync(path.join(ROOT, 'libs/ranker/src/engine/bets/model-desk.component.html'), 'utf8');
  const asked = new Set([...html.matchAll(/help\['(\w+)'\]/g)].map((m) => m[1]));
  // (a header with no help of its own falls back to its column's)
  for (const m of html.matchAll(/key: '(\w+)', label: '[^']*'(?:, help: [^}]+)? \}/g)) if (!m[0].includes('help:')) asked.add(m[1]);
  const missing = [...asked].filter((k) => !desk.DESK_HELP[k] && !['label', 'units', 'graded'].includes(k));
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------
// The public picks (picks.mjs) and the leagues' setup
// ---------------------------------------------------------------------------

test("picks.mjs bands, by the Kelly score: 5% and up high, 2% medium, under low; a bet without an edge low whatever its score", () => {
  assert.deepEqual([0.05, 0.0499, 0.02, 0.0199, 0.12, -0.03].map((k) => level(k)), ['high', 'medium', 'medium', 'low', 'high', 'low']);
  assert.equal(level(0.12, 0.6), 'lock', 'a big edge on a likely result: a lock');
  assert.equal(levelOf({ intent: 'action', ev: -0.01 }, 0.07), 'low');
  assert.equal(levelOf({ ev: 0.02 }, 0.07), 'high');
});

test('buildPicks: the open bets not started, likeliest first, at most TOP, each marked published with its band then', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const future = '2026-10-10T17:00:00Z';
  const bets = [
    bet({ id: 'hi', start: future, p: 0.64, ev: 0.05, intent: 'edge' }),
    bet({ id: 'mid', start: future, p: 0.54, ev: 0.02, intent: 'edge' }),
    bet({ id: 'fav', start: future, p: 0.7, odds: -300, ev: -0.0667, intent: 'action' }),
    bet({ id: 'started', start: '2026-10-09T11:00:00Z', p: 0.9, ev: 0.1 }),
    bet({ id: 'guarded', start: future, p: 0.8, ev: 0.1, context: { guard: 'line moved' } }),
    bet({ id: 'old', start: '2026-10-01T17:00:00Z', status: 'won', profit: 1.36, published: true, publishedLevel: 'high' }),
    bet({ id: 'void', start: '2026-10-01T17:00:00Z', status: 'push', void: true, published: true, publishedLevel: 'low' }),
  ];
  const ledger = { bets };
  const out = buildPicks('nfl', ledger, { spread: { fitted: true } }, new Map(), now);
  // (by Kelly: the 70% favorite at -300 has no edge on its price and sorts last, its chance notwithstanding)
  assert.deepEqual(out.picks.map((p) => [p.id, p.level, p.chance]), [['hi', 'lock', 64], ['mid', 'medium', 54], ['fav', 'low', 70]]);
  assert.equal(out.picks[2].edge, false);
  assert.ok(out.picks[2].score < 0);
  assert.deepEqual(out.picks[0].teams.map((t) => t.abbr), ['TB', 'DAL']);
  assert.ok(bets.find((b) => b.id === 'hi').published);
  assert.equal(bets.find((b) => b.id === 'mid').publishedLevel, 'medium');
  assert.equal(bets.find((b) => b.id === 'started').published, undefined);
  // (the record: the published ones graded, a void prop not counted)
  assert.equal(out.record.graded, 2);
  assert.deepEqual([out.record.overall.wins, out.record.overall.losses, out.record.overall.pushes], [1, 0, 0]);
  assert.equal(out.record.byLevel.high.wins, 1);
  // (and no more than TOP)
  const many = { bets: Array.from({ length: TOP + 9 }, (_, i) => bet({ id: `m${i}`, start: future, p: 0.5 + i / 1000 })) };
  assert.equal(buildPicks('nfl', many, {}, new Map(), now).picks.length, TOP);
});

test("leagues: DraftKings is the book everywhere, each league's setup whole, the front's sports and ESPN paths the bettor's", () => {
  assert.equal(BOOK, 'draftkings');
  assert.ok(LINE_BOOKS.includes(BOOK));
  assert.ok(ESPN_PROVIDER[BOOK]);
  assert.deepEqual(Object.keys(LEAGUES).sort(), [...desk.SPORTS].sort());
  for (const [sport, cfg] of Object.entries(LEAGUES)) {
    assert.equal(cfg.league, desk.ESPN_LEAGUES[sport], `${sport}'s ESPN path`);
    assert.ok(SPORT_KEYS[sport], `${sport}'s Odds API key`);
    assert.ok(desk.UNIT_WORDS[sport]);
    for (const key of ['k', 'hfa', 'revert', 'kO', 'sigma', 'sigmaT', 'avg']) assert.ok(Number.isFinite(cfg.priors[key]), `${sport} priors.${key}`);
    for (const [key, values] of Object.entries(cfg.grid)) {
      assert.ok(key in cfg.priors, `${sport} grid.${key} has no prior`);
      assert.ok(values.length && values.every((v, i) => i === 0 || v > values[i - 1]), `${sport} grid.${key} not rising`);
    }
    for (const market of ['spread', 'total', 'ml']) assert.ok(market in cfg.guard, `${sport} guard.${market}`);
    assert.ok(cfg.context.restCap > 0);
  }
  assert.ok(PROP_CAPS.untested.maxUnits <= PROP_CAPS.tested.maxUnits && PROP_CAPS.tested.maxUnits <= 3);
});

test('byGame: each game once, its bets under it, in the order the sort put its first; one sport\'s game never another\'s', () => {
  const bet = (id, sport, event, matchup = 'A @ B') => ({ id, sport, event, matchup, start: '2026-10-11T17:00:00Z' });
  const groups = desk.byGame([bet('1', 'nfl', 'e1'), bet('2', 'nfl', 'e2'), bet('3', 'nfl', 'e1'), bet('4', 'nhl', 'e1'), bet('5', 'nfl', undefined, 'C @ D'), bet('6', 'nfl', undefined, 'C @ D')]);
  assert.deepEqual(
    groups.map((g) => g.bets.map((b) => b.id)),
    [['1', '3'], ['2'], ['4'], ['5', '6']],
  );
  assert.deepEqual(desk.byGame([]), []);
});

