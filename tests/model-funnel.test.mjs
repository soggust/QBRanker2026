// The model desk's NFL pass funnel (libs/ranker/scripts/model/matchups.mjs passFunnel: the props' funnel and
// football.mjs's funnelT for game totals): each defense's opponents' pass rate over expected against it, less
// their own, learned only from games before (no leakage), pulled toward 0, and falling back to the plain pass
// share where a game has no expected pass rate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nflMatchups, passFunnel, sideOfPlays } from '../libs/ranker/scripts/model/matchups.mjs';

// (a side of a game: 60 plays, 34 neutral ones with an xpass, passing proe over expected on those)
const side = (proe, pass = 36) => ({ pass, plays: 60, over: proe * 34, xn: 34 });

test('a pass-happy offense makes no funnel of the defenses it plays: its own lean comes off', () => {
  const f = passFunnel();
  // (team A throws 8 points over expected against everyone: defenses D1-D6)
  for (let i = 1; i <= 6; i++) f.learn('A', `D${i}`, 2025, side(0.08));
  // (its later opponents: about 0, not a pass funnel)
  f.learn('A', 'D7', 2025, side(0.08));
  assert.ok(Math.abs(f.of('D7', 2025)) < 0.01, `D7's funnel ${f.of('D7', 2025)}`);
  // (D1, met first with nothing known of A yet, got A's whole lean, pulled toward 0 by 4 games)
  assert.ok(f.of('D1', 2025) > 0 && f.of('D1', 2025) <= 0.08 / 5 + 1e-9);
});

test('a defense that offenses throw on more than they usually do is a pass funnel; one they run on, a run funnel', () => {
  const f = passFunnel();
  const offenses = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I'];
  // (each offense's usual: even with expected, against the others)
  for (const o of offenses) for (let i = 0; i < 4; i++) f.learn(o, `X${i}`, 2025, side(0));
  for (const o of offenses) f.learn(o, 'PASS', 2025, side(0.06));
  for (const o of offenses) f.learn(o, 'RUN', 2025, side(-0.05));
  const pass = f.of('PASS', 2025);
  const run = f.of('RUN', 2025);
  // (8 games of +6 points pulled toward 0 by 4 games: about +4)
  assert.ok(Math.abs(pass - 0.06 * (8 / 12)) < 0.005, `pass funnel ${pass}`);
  // (by then the offenses' own leans carry the pass funnel's games a little: a bit past -5 x 8/12)
  assert.ok(run < -0.03 && run > -0.05, `run funnel ${run}`);
  // (last season's at half weight; two seasons back, none)
  assert.ok(Math.abs(f.of('PASS', 2026) - (0.06 * 4) / 8) < 0.005, `next season ${f.of('PASS', 2026)}`);
  assert.equal(f.of('PASS', 2027), 0);
});

test('a game without an expected pass rate falls back to the plain pass share against the offense\'s own', () => {
  const f = passFunnel();
  for (let i = 0; i < 6; i++) f.learn('A', `X${i}`, 2005, { pass: 33, plays: 60 });
  f.learn('A', 'D', 2005, { pass: 45, plays: 60 });
  assert.ok(f.of('D', 2005) > 0.03, `D's funnel ${f.of('D', 2005)}`);
  // (a game of under 20 plays teaches nothing)
  f.learn('A', 'Q', 2005, { pass: 15, plays: 15 });
  assert.equal(f.of('Q', 2005), 0);
});

test("the context's plays give each side's numbers", () => {
  const p = [1.2, 40, -0.5, 38, 12, 35, 25, 30, 28, 2.5, 33, -1.1, 31];
  assert.deepEqual(sideOfPlays(p, true), { pass: 35, plays: 60, over: 2.5, xn: 33 });
  assert.deepEqual(sideOfPlays(p, false), { pass: 30, plays: 58, over: -1.1, xn: 31 });
  // (kept before the funnel's numbers were: the plain counts only)
  assert.deepEqual(sideOfPlays(p.slice(0, 9), true), { pass: 35, plays: 60, over: 0, xn: 0 });
  assert.equal(sideOfPlays(null, true), null);
});

test("the props' rows see a defense's funnel from the games before theirs only", () => {
  // (offense 1 against defense 9, week after week; the play-by-play says it threw 10 points over expected
  // in game g3 alone)
  const rows = [];
  const plays = {};
  for (let w = 1; w <= 4; w++) {
    const game = `g${w}`;
    const date = `2025-09-0${w}T17:00Z`;
    rows.push({ pid: 'qb', pos: 'QB', team: '1', opp: '9', game, home: true, date, season: 2025, s: { passAtt: 35, rushAtt: 2, targets: 0 } });
    rows.push({ pid: 'rb', pos: 'RB', team: '1', opp: '9', game, home: true, date, season: 2025, s: { passAtt: 0, rushAtt: 25, targets: 3 } });
    plays[game] = [0, 30, 0, 30, 10, 35, 27, 33, 29, w === 3 ? 3.4 : 0, 34, 0, 30];
  }
  nflMatchups(rows, plays);
  const at = (game) => rows.find((r) => r.game === game && r.pid === 'qb').funnel;
  assert.equal(at('g1'), 0);
  assert.equal(at('g3'), at('g2'), "g3's own passing isn't in its own funnel");
  assert.ok(at('g4') > at('g3'), `g4 ${at('g4')} after g3's passing, against ${at('g3')}`);
});
