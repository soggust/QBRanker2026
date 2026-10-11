// The props' fit and pricing (libs/ranker/scripts/model/props.mjs, project.mjs, matchups.mjs): who counts as
// eligible from before the game, the push on a whole-number line, the starting goalie, the work missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, markEligible, markStarters, statInFinal } from '../libs/ranker/scripts/model/props.mjs';
import { lineChances, makeModel, nbOver, rAt } from '../libs/ranker/scripts/model/project.mjs';
import { nflMatchups } from '../libs/ranker/scripts/model/matchups.mjs';
import { GAP, chanceAt } from '../libs/ranker/scripts/model/desk.mjs';

const nflRec = STATS.nfl.find((s) => s.key === 'recYds');
const row = (pid, game, date, s, extra = {}) => ({ pid, name: `P${pid}`, pos: 'WR', date, season: 2025, team: '1', opp: '2', game, home: true, s, ...extra });

test("markEligible: a receiver's eligibility is from his games before, never the game's own targets", () => {
  const rows = [];
  // (five receivers; 1-4 the usual targets, 5 a backup who never gets one... until game 3, his big game)
  for (let g = 1; g <= 3; g++) {
    for (let p = 1; p <= 5; p++) {
      const tgt = p === 5 ? (g === 3 ? 15 : 0) : 10 - p;
      rows.push(row(String(p), `g${g}`, `2025-09-0${g}T17:00Z`, { targets: tgt, recYds: tgt * 8 }));
    }
  }
  markEligible('nfl', nflRec, rows);
  const at = (p, g) => rows.find((r) => r.pid === p && r.game === g).eligible;
  // (the first game: no one has games before it)
  assert.equal(at('1', 'g1'), false);
  assert.equal(at('1', 'g2'), true);
  assert.equal(at('4', 'g3'), true);
  // (the backup's 15-target game doesn't make him eligible for it)
  assert.equal(at('5', 'g3'), false);
});

test('NFL catch rows: every game he played at the position, a 0-target one too', () => {
  assert.equal(nflRec.played({ pos: 'WR', s: { targets: 0 } }), true);
  assert.equal(nflRec.played({ pos: 'QB', s: { targets: 0 } }), false);
  const pass = STATS.nfl.find((s) => s.key === 'passYds');
  assert.equal(pass.played({ pos: 'QB', s: { passAtt: 4 } }), true);
});

test("markStarters: the goalie who started, pulled or not, by the context's order; one alone in his box", () => {
  const g = (pid, game, toi, home = true) => ({ pid, pos: 'G', game, team: home ? '1' : '2', home, s: { toi, saves: 10 } });
  const rows = [g('a', 'x', 20), g('b', 'x', 40), g('c', 'x', 60, false), g('d', 'y', 30), g('e', 'y', 30)];
  markStarters(rows, { games: { x: { gs: 1, h: [['a', 10, 4], ['b', 20, 1]], a: [['c', 30, 2]] } } });
  assert.deepEqual(rows.map((r) => r.started), [true, false, true, false, false]);
  const saves = STATS.nhl.find((s) => s.key === 'saves');
  assert.equal(saves.played(rows[0]), true);
  assert.equal(saves.played(rows[1]), false);
});

test("statInFinal: a saves prop on a goalie who didn't start is no action; the pulled starter's counts", async () => {
  const goalie = (id, sv) => ({ athlete: { id, displayName: `G${id}` }, stats: ['30', '3', sv] });
  // (ESPN lists the one in net at the end first: 7 came on in relief of 8)
  const body = { boxscore: { players: [{ statistics: [{ name: 'goalies', labels: ['SA', 'GA', 'SV'], athletes: [goalie('7', '12'), goalie('8', '9')] }] }] } };
  assert.equal(await statInFinal('nhl', { athlete: '8', propType: 'saves' }, body, null), 9);
  assert.equal(await statInFinal('nhl', { athlete: '7', propType: 'saves' }, body, null), null);
});

test('lineChances: a whole-number line takes its push out of both sides; a half-point line has none', () => {
  const params = { r: 10 };
  const half = lineChances(4.5, 4, params);
  assert.equal(half.push, 0);
  assert.ok(Math.abs(half.over - nbOver(4.5, 4, 10)) < 1e-9);
  const whole = lineChances(4, 4, params);
  assert.ok(whole.push > 0.1);
  assert.ok(Math.abs(whole.over + whole.under - 1) < 1e-9);
  // (the over given no push: more than the plain chance of over 4, which counts the push against it)
  assert.ok(whole.over > nbOver(4, 4, 10));
  assert.ok(Math.abs(whole.over - nbOver(4, 4, 10) / (1 - whole.push)) < 1e-9);
});

test('rAt: the plain dispersion, or one growing with the projection', () => {
  assert.equal(rAt({ r: 2 }, 50), 2);
  assert.equal(rAt({ r: 2, rk: 1, rm: 25 }, 50), 4);
  assert.equal(rAt({ r: 2, rk: 1, rm: 25 }, 12.5), 1);
});

test("the vacated term is signed: a fill-in whose recent games were the starter's comes down when he's back", () => {
  const stat = { key: 'rushAtt', vacated: true };
  const model = makeModel(stat, { K: 4, w: 0.4, a: 0, b: 0, c: 0, vc: 1, vs: 0, roleK: Infinity }, {});
  // (four games with the starter out: a big cut of his work each)
  model.learn([1, 2, 3, 4].map((d) => ({ pid: 'x', pos: 'RB', season: 2025, date: `2025-09-0${d}`, opp: 'o', s: { rushAtt: 18 }, vacs: [0.8, 0.8, 0.8] })));
  const back = model.project({ pid: 'x', pos: 'RB', season: 2025, date: '2025-09-10', opp: 'o', vacs: [0, 0, 0] });
  const stillOut = model.project({ pid: 'x', pos: 'RB', season: 2025, date: '2025-09-10', opp: 'o', vacs: [0.8, 0.8, 0.8] });
  assert.ok(back.vacF < 1, `starter back: ${back.vacF}`);
  assert.ok(Math.abs(stillOut.vacF - 1) < 0.25, `still out: ${stillOut.vacF}`);
  assert.ok(back.mu < stillOut.mu);
});

test('nflMatchups live: a questionable teammate counts at half in the work missing; one off the roster in full', () => {
  const g = (game, date, rows) => rows.map(([pid, rushAtt]) => ({ pid, name: pid, pos: 'RB', date, season: 2025, team: '1', opp: '2', game, home: true, s: { rushAtt, targets: 0 } }));
  const rows = [...g('a', '2025-09-01T17:00Z', [['s', 20], ['b', 5]]), ...g('b', '2025-09-08T17:00Z', [['s', 20], ['b', 5]])];
  const m = nflMatchups(rows);
  const none = m.live('b', '1', '2', 'RB', 2025, () => 0).vacs[0];
  const half = m.live('b', '1', '2', 'RB', 2025, (id) => (id === 's' ? 0.5 : 0)).vacs[0];
  const full = m.live('b', '1', '2', 'RB', 2025, new Set(['s'])).vacs[0];
  assert.equal(none, 0);
  assert.ok(half > 0 && half < full, `${half} ${full}`);
  assert.deepEqual(m.regulars('1', 2025, 'RB').map((x) => x.id).sort(), ['b', 's']);
});

test("a prop's lean tapers past half its GAP, nothing at it", () => {
  assert.equal(GAP.prop, 0.15);
  assert.ok(Math.abs(chanceAt('prop', 0.5, 0.55, 1) - 0.55) < 1e-9);
  assert.ok(chanceAt('prop', 0.5, 0.62, 1) < chanceAt('prop', 0.5, 0.57, 1));
  assert.ok(Math.abs(chanceAt('prop', 0.5, 0.65, 1) - 0.5) < 1e-9);
});
