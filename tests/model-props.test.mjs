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

test("nbaMatchups: a starter out, the next man up starts (S), and his teammates' cut of the work he leaves", async () => {
  const { nbaMatchups } = await import('../libs/ranker/scripts/model/matchups.mjs');
  const rows = [];
  const mins = { a: 36, b: 34, c: 32, d: 30, e: 28, f: 20, g: 12 };
  for (let d = 1; d <= 4; d++) for (const [pid, min] of Object.entries(mins)) rows.push({ pid, name: pid, pos: 'G', date: `2025-11-0${d}T00:00Z`, season: 2026, team: '1', opp: '2', game: `g${d}`, home: true, s: { min, pts: min / 2, ast: 2, reb: 3, fga: min / 3, fta: 2 } });
  const m = nbaMatchups(rows);
  assert.equal(m.live('f', '1', '2', 'G', 2026, () => 0).role, 'B');
  const out = m.live('f', '1', '2', 'G', 2026, new Set(['a']));
  assert.equal(out.role, 'S');
  assert.equal(out.vacs.length, 6);
  assert.ok(out.vacs[0] > 0 && out.vacs[3] > 0, String(out.vacs));
  // (a questionable star at half: in between)
  const half = m.live('f', '1', '2', 'G', 2026, (id) => (id === 'a' ? 0.5 : 0)).vacs[0];
  assert.ok(half > 0 && half < out.vacs[0]);
  // (the history: a game the star missed gives the rest his work, the next man up the start)
  const missed = [...rows, ...Object.entries(mins).filter(([pid]) => pid !== 'a').map(([pid, min]) => ({ pid, name: pid, pos: 'G', date: '2025-11-06T00:00Z', season: 2026, team: '1', opp: '2', game: 'g6', home: true, s: { min, pts: 1, ast: 1, reb: 1 } }))];
  nbaMatchups(missed);
  const f6 = missed.find((r) => r.pid === 'f' && r.game === 'g6');
  assert.equal(f6.role, 'S');
  assert.ok(f6.vac > 0);
});

test('mlbMatchups: a batter starts by the lineup, his slot against his usual, his platoon edge; a starter\'s leash and rest', async () => {
  const { mlbMatchups, pitcherBefore, paAt } = await import('../libs/ranker/scripts/model/matchups.mjs');
  const facts = { games: {}, hands: { 9: 'LR', p1: 'RR', p2: 'RL' }, pitchers: {} };
  const rows = [];
  for (let d = 1; d <= 5; d++) {
    const g = `g${d}`;
    // (he leads off the first four, bats ninth in the fifth; the fifth's starter throws left)
    facts.games[g] = { lo: [[d === 5 ? '1' : '9', '2', '3', '4', '5', '6', '7', '8', d === 5 ? '9' : '1'], []], ap: d === 5 ? 'p2' : 'p1' };
    rows.push({ pid: 'mlb:9', pos: 'B', date: `2025-06-0${d}T23:00Z`, season: 2025, team: '1', opp: '2', game: g, home: true, s: { pa: 4, hits: 1 } });
  }
  // (a pinch hitter's game: not a start)
  facts.games.g6 = { lo: [['1', '2', '3', '4', '5', '6', '7', '8', '10'], []], ap: 'p1' };
  rows.push({ pid: 'mlb:9', pos: 'B', date: '2025-06-07T23:00Z', season: 2025, team: '1', opp: '2', game: 'g6', home: true, s: { pa: 1, hits: 0 } });
  mlbMatchups(rows, facts);
  assert.equal(rows[0].start, true);
  assert.equal(rows[5].start, false);
  assert.equal(rows[4].slot, 9);
  assert.ok(Math.abs(rows[4].slotShift - Math.log(paAt(9) / paAt(1))) < 1e-3);
  assert.equal(rows[3].slotShift, 0);
  // (a lefty against a righty has the edge; against the lefty in the fifth, none: below his usual)
  assert.ok(rows[0].platoonShift > 0);
  assert.ok(rows[4].platoonShift < 0);
  // (a starter: 100 then 60 pitches in his last two, rest from his last day)
  const logs = { 2025: [[20250501, 18, 0, 0, 6, 1, 0, 0, 100, 25, 1], [20250506, 18, 0, 0, 6, 1, 0, 0, 100, 25, 1], [20250511, 9, 0, 0, 3, 1, 0, 0, 60, 15, 1]] };
  const p = pitcherBefore(logs, 2025, 20250517);
  assert.equal(p.restDays, 6);
  assert.ok(p.leash < 0);
  // (one start before it: no leash yet)
  assert.equal(pitcherBefore(logs, 2025, 20250506).leash, 0);
  // (a day's own line never counts as before it)
  assert.equal(pitcherBefore(logs, 2025, 20250511).restDays, 5);
  assert.equal(pitcherBefore({ 2025: [] }, 2025, 20250511).debut, true);
});

test("nhlMatchups: a skater's power-play time and his opponent's penalties, from the games before", async () => {
  const { nhlMatchups } = await import('../libs/ranker/scripts/model/matchups.mjs');
  const { CTX } = await import('../libs/ranker/scripts/model/props.mjs');
  const facts = { games: {} };
  const rows = [];
  for (let d = 1; d <= 3; d++) {
    facts.games[`g${d}`] = { w: [6, 2, 12, 4] };
    rows.push({ pid: 'x', pos: 'F', date: `2025-11-0${d}T00:00Z`, season: 2026, team: '1', opp: '2', game: `g${d}`, home: true, s: { toi: 20, sog: 3, pts: 1, pptoi: 3 } });
  }
  const m = nhlMatchups(rows, facts);
  assert.equal(rows[0].ppTime, null);
  assert.equal(rows[1].ppTime, 3);
  const live = m.live('x', '1', '2', 'F', 2026);
  assert.ok(live.ppOpp > 0, String(live.ppOpp));
  assert.ok(CTX.pp({}, true, null, live) > 0);
  assert.equal(CTX.pp({}, true, null, { ...live, ppTime: 0 }), 0);
});

test("an MLB starter's rest: skipped from LAYOFF days or a debut from May, flagged on a long rest or a late debut", async () => {
  const { restGuard, LAYOFF, LONG_REST } = await import('../libs/ranker/scripts/model/props.mjs');
  assert.equal(LAYOFF, 13);
  assert.equal(LONG_REST, 11);
  assert.equal(restGuard(5, false, '2026-06-10T23:05Z'), null);
  assert.equal(restGuard(10, false, '2026-07-18T23:05Z'), null); // (the All-Star break)
  assert.equal(restGuard(11, false, '2026-06-10T23:05Z'), 'long');
  assert.equal(restGuard(12, false, '2026-06-10T23:05Z'), 'long');
  assert.equal(restGuard(13, false, '2026-06-10T23:05Z'), 'layoff'); // (a backdated 15-day IL stint)
  assert.equal(restGuard(16, false, '2026-06-10T23:05Z'), 'layoff');
  assert.equal(restGuard(null, true, '2026-03-28T20:05Z'), null);
  assert.equal(restGuard(null, true, '2026-04-20T20:05Z'), 'late');
  assert.equal(restGuard(null, true, '2026-05-02T20:05Z'), 'debut');
});

test("the work missing: a core player's one game out counts, a fringe regular's from his second in a row, history and live alike", async () => {
  const { nhlMatchups } = await import('../libs/ranker/scripts/model/matchups.mjs');
  const sk = (pid, toi, game, d) => ({ pid, name: pid, pos: 'D', date: `2025-11-${String(d).padStart(2, '0')}T00:00Z`, season: 2026, team: '1', opp: '2', game, home: true, s: { toi, pptoi: 0, sog: 2, pts: 0 } });
  // (defensemen: a and b core (18 minutes or more), c a third-pair regular (16: under core, over regular))
  const pairs = { a: 24, b: 21, c: 16, d: 15 };
  const rows = [];
  for (let d = 1; d <= 5; d++) for (const [pid, toi] of Object.entries(pairs)) rows.push(sk(pid, toi, `g${d}`, d));
  const base = rows.slice();
  const m0 = nhlMatchups(base);
  // (live, a fringe regular's first game out on the report: not counted; a core player's: counted)
  assert.equal(m0.live('d', '1', '2', 'D', 2026, new Set(['c'])).vac, 0);
  assert.ok(m0.live('d', '1', '2', 'D', 2026, new Set(['a'])).vac > 0);
  // (game 6: c scratched; game 7: c out again; game 8: a out)
  for (const g of ['g6', 'g7']) for (const [pid, toi] of Object.entries(pairs)) if (pid !== 'c') rows.push(sk(pid, toi, g, Number(g.slice(1))));
  for (const [pid, toi] of Object.entries(pairs)) if (pid !== 'a') rows.push(sk(pid, toi, 'g8', 8));
  nhlMatchups(rows);
  const at = (pid, game) => rows.find((r) => r.pid === pid && r.game === game);
  assert.equal(at('d', 'g6').vac, 0);
  assert.ok(at('d', 'g7').vac > 0);
  assert.ok(at('d', 'g8').vac > 0);
});
