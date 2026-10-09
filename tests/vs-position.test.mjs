// Defense vs position. The NFL's (apps/nfl/scripts/defense-vs-position.mjs, each DEF row's vsPos): a finished
// season's numbers are there for every defense and look like football: ranks 1..32 per role, the
// receiving yards they allowed add up to the league's, the funnel scores cancel out across the league
// and every defense's target split adds up to 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readJson, staticDir } from './support/engine.mjs';

const ROLES = ['WR1', 'WR2', 'WR3', 'TE1', 'RB1'];
const GROUPS = ['WR', 'TE', 'RB'];
const SEASON = 2025;
const rows = () => readJson(path.join(staticDir('nfl'), 'seasons', String(SEASON), 'skill-players.json'));

// Ranks as a ranking: each one 1 + how many came out better (ties share a rank)
function assertRanks(values, ranks, what, desc = false) {
  values.forEach((v, i) => {
    const expected = 1 + values.filter((w) => (desc ? w > v : w < v)).length;
    assert.equal(ranks[i], expected, `${what}: rank ${ranks[i]} for ${v}, expected ${expected}`);
  });
  assert.ok(ranks.includes(1), `${what}: nobody ranked 1`);
  assert.ok(Math.max(...ranks) <= values.length, `${what}: a rank past ${values.length}`);
}

test(`NFL ${SEASON}: every defense has its vs-position numbers, ranked 1-32 per role`, () => {
  const defs = rows().DEF;
  assert.equal(defs.length, 32);
  for (const d of defs) assert.ok(d.vsPos, `${d.name}: no vsPos`);
  for (const role of ROLES) {
    const blocks = defs.map((d) => d.vsPos[role]);
    for (const [i, b] of blocks.entries()) {
      const at = `${defs[i].name} ${role}`;
      assert.ok(b.g >= 15 && b.g <= 17, `${at}: ${b.g} games`);
      assert.ok(b.ppr >= 0 && b.ppr < 40 && b.exp > 0 && b.exp < 30, `${at}: ${b.ppr} PPR against ${b.exp} expected`);
      assert.ok(Math.abs(b.vs - (b.ppr - b.exp)) <= 0.11, `${at}: vs ${b.vs} isn't allowed minus expected`);
      assert.ok(b.rec <= b.tgt, `${at}: more catches than targets`);
    }
    assertRanks(blocks.map((b) => b.vs), blocks.map((b) => b.rank), role);
    // (EPA a play to the role: a plausible number, ranked the stingiest first)
    for (const [i, b] of blocks.entries()) assert.ok(b.epa > -1 && b.epa < 1, `${defs[i].name} ${role}: ${b.epa} EPA a play`);
    assertRanks(blocks.map((b) => b.epa), blocks.map((b) => b.epaRank), `${role} EPA`);
  }
  // (the roles in their order: WR1s average more than WR2s)
  const avg = (role) => defs.reduce((a, d) => a + d.vsPos[role].exp, 0) / defs.length;
  assert.ok(avg('WR1') > avg('WR2') && avg('WR2') > avg('WR3'), 'WR1s should average more than WR2s, WR2s than WR3s');
  assertRanks(defs.map((d) => d.vsPos.pass.ypg), defs.map((d) => d.vsPos.pass.rank), 'pass yards');
  assertRanks(defs.map((d) => d.vsPos.run.ypg), defs.map((d) => d.vsPos.run.rank), 'rush yards');
});

test(`NFL ${SEASON}: what the defenses allowed adds up to the league's receiving yards`, () => {
  const data = rows();
  const defs = data.DEF;
  // Every completed pass's yards, counted against the defense
  const passYards = defs.reduce((a, d) => a + d.vsPos.pass.ypg * d.games, 0);
  // ...the same yards split by who caught them (WRs, TEs and backs: everything but the odd QB or lineman)
  const groupYards = defs.reduce((a, d) => a + GROUPS.reduce((s, g) => s + d.vsPos.targets[g].yds * d.games, 0), 0);
  assert.ok(Math.abs(groupYards - passYards) / passYards < 0.03, `${groupYards} by position against ${passYards} in all`);
  // ...the listed WRs, TEs and backs' own receiving yards a little under the whole league's
  const listed = GROUPS.reduce((a, t) => a + data[t].reduce((s, p) => s + (p.stats.recYards ?? 0), 0), 0);
  assert.ok(listed <= passYards * 1.02 && listed >= passYards * 0.7, `listed players' ${listed} receiving yards against ${passYards}`);
  // ...and the four receiving roles most of it
  const roleYards = defs.reduce((a, d) => a + ['WR1', 'WR2', 'WR3', 'TE1'].reduce((s, r) => s + d.vsPos[r].yds * d.vsPos[r].g, 0), 0);
  assert.ok(roleYards > passYards * 0.55 && roleYards < passYards * 0.9, `roles' ${roleYards} of ${passYards}`);
  assert.ok(passYards > 100000 && passYards < 140000, `${passYards} receiving yards in the league`);
});

test(`NFL ${SEASON}: funnel scores (over expected) cancel out, and every target split adds up to 100%`, () => {
  const defs = rows().DEF;
  const scores = defs.map((d) => d.vsPos.funnel.score);
  const mean = scores.reduce((a, v) => a + v, 0) / scores.length;
  assert.ok(Math.abs(mean) < 1, `funnel scores average ${mean} points`);
  assert.ok(scores.some((v) => v > 2) && scores.some((v) => v < -2), 'no pass or run funnel at all');
  assertRanks(scores, defs.map((d) => d.vsPos.funnel.rank), 'funnel', true);
  // (over nflverse's expected pass rate from 2006 on: rate less exp is the score, both plain fractions)
  for (const d of defs) {
    const f = d.vsPos.funnel;
    assert.equal(f.method, 'proe', `${d.name}: funnel method ${f.method}`);
    assert.ok(f.rate > 0.4 && f.rate < 0.8 && f.exp > 0.4 && f.exp < 0.8, `${d.name}: pass rate ${f.rate} against ${f.exp}`);
    assert.ok(Math.abs((f.rate - f.exp) * 100 - f.score) <= 0.2, `${d.name}: score ${f.score} isn't rate less exp`);
  }
  for (const d of defs) {
    const t = d.vsPos.targets;
    const share = GROUPS.reduce((a, g) => a + t[g].share, 0);
    const league = GROUPS.reduce((a, g) => a + t[g].lg, 0);
    assert.ok(Math.abs(share - 1) < 0.003, `${d.name}: target shares add up to ${share}`);
    assert.ok(Math.abs(league - 1) < 0.003, `${d.name}: league shares add up to ${league}`);
    assert.ok(t.WR.share > t.TE.share && t.WR.share > t.RB.share, `${d.name}: WRs not the most targeted`);
    assert.ok(Math.abs(d.vsPos.pace.diff) < 10, `${d.name}: pace ${d.vsPos.pace.diff}`);
  }
});

// Before 2006 nflverse has no expected pass rate: the funnel falls back to the plain rate, and says so
test('NFL 2005: the funnel falls back to the plain pass rate, scores cancelling out', () => {
  const defs = readJson(path.join(staticDir('nfl'), 'seasons', '2005', 'skill-players.json')).DEF;
  for (const d of defs) assert.equal(d.vsPos.funnel.method, 'rate', `${d.name}: funnel method ${d.vsPos.funnel.method}`);
  const mean = defs.reduce((a, d) => a + d.vsPos.funnel.score, 0) / defs.length;
  assert.ok(Math.abs(mean) < 1, `funnel scores average ${mean} points`);
});

// The NHL's (apps/nhl/scripts/vs-position.mjs, on each head coach row): every team against forwards and
// defensemen, ranked, its numbers adding up to about the league's scoring
test('NHL 2025: every team has its vs-position numbers, ranked, adding up to the league', () => {
  const coaches = readJson(path.join(staticDir('nhl'), 'seasons', '2025', 'skill-players.json')).HC;
  const teams = new Map(coaches.map((c) => [c.teamLogo, c.vsPos]));
  assert.equal(teams.size, 32);
  const blocks = [...teams.values()];
  for (const b of blocks) assert.ok(b && b.games >= 80 && b.games <= 82, `a team's vsPos: ${JSON.stringify(b)?.slice(0, 80)}`);
  for (const role of ['F', 'D']) assertRanks(blocks.map((b) => b[role].vs), blocks.map((b) => b[role].rank), `NHL ${role}`);
  // (goals by the listed skaters against each team: close to the league's 3 a game, a little under)
  const goals = blocks.reduce((a, b) => a + b.F.goals + b.D.goals, 0) / blocks.length;
  assert.ok(goals > 2.6 && goals < 3.4, `${goals} goals a game against`);
  for (const b of blocks) assert.ok(b.share.D > 0.1 && b.share.D < 0.4 && Math.abs(b.share.lg - blocks[0].share.lg) < 1e-9, 'defensemen share');
  const mean = blocks.reduce((a, b) => a + b.F.vs, 0) / blocks.length;
  assert.ok(Math.abs(mean) < 0.3, `forwards over their averages by ${mean} on average`);
});
