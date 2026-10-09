// The NFL's Field Map (apps/nfl/scripts/build-field-maps.mjs, StaticData/field-maps.json and each past
// season's): the tallies on a few hand-made plays, then every committed file against the contract (12
// zones, 7 lanes, 5 bands, packed in FIELDS' order; counts whole and never negative), the league's
// throws the defenses' allowed and (nearly all) the quarterbacks', every band's misses its tries less its
// makes (each by how it missed), and every card row with plays finding its entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, staticDir } from './support/engine.mjs';
import { FIELDS, LANES, MISSES, fgBand, laneIndex, missKind, parsePlays, puntBand, section, zoneIndex } from '../apps/nfl/scripts/build-field-maps.mjs';

// ---- the pure parts
test('zones, lanes and bands land in the fixed orders', () => {
  assert.equal(FIELDS.zones.length, 12);
  assert.deepEqual(FIELDS.zones.slice(0, 4), ['behind-left', 'behind-middle', 'behind-right', 'short-left']);
  assert.equal(FIELDS.zones[11], 'deep-right');
  assert.deepEqual(LANES, ['left end', 'left tackle', 'left guard', 'middle', 'right guard', 'right tackle', 'right end']);
  assert.equal(zoneIndex('-3', 'left'), 0);
  assert.equal(zoneIndex('0', 'middle'), 4);
  assert.equal(zoneIndex('9', 'right'), 5);
  assert.equal(zoneIndex('10', 'left'), 6);
  assert.equal(zoneIndex('35', 'right'), 11);
  assert.equal(zoneIndex('NA', 'left'), -1);
  assert.equal(zoneIndex('12', 'NA'), -1);
  assert.equal(laneIndex('left', 'end'), 0);
  assert.equal(laneIndex('left', 'guard'), 2);
  assert.equal(laneIndex('middle', 'NA'), 3);
  assert.equal(laneIndex('right', 'tackle'), 5);
  assert.equal(laneIndex('right', 'end'), 6);
  assert.equal(laneIndex('right', 'NA'), -1);
  assert.deepEqual(['29', '30', '49', '50', '63', 'NA'].map(fgBand), [0, 1, 2, 3, 4, -1]);
  assert.deepEqual(['39', '40', '59', '61'].map(puntBand), [0, 1, 2, 3]);
});

const play = (fields) => ({ season_type: 'REG', two_point_attempt: '0', sack: '0', qb_kneel: '0', qb_scramble: '0', posteam: 'KC', defteam: 'OAK', ...fields });
const PLAYS = [
  // two throws short left (one caught for 8, a touchdown), one deep right intercepted, a sack, a spike
  play({ play_type: 'pass', pass_attempt: '1', pass_location: 'left', air_yards: '5', complete_pass: '1', passing_yards: '8', receiving_yards: '8', pass_touchdown: '1', epa: '1.5', passer_player_id: 'QB1', receiver_player_id: 'WR1' }),
  play({ play_type: 'pass', pass_attempt: '1', pass_location: 'left', air_yards: '3', complete_pass: '0', passing_yards: 'NA', receiving_yards: 'NA', epa: '-0.5', passer_player_id: 'QB1', receiver_player_id: 'WR2' }),
  play({ play_type: 'pass', pass_attempt: '1', pass_location: 'right', air_yards: '30', complete_pass: '0', interception: '1', epa: '-3', passer_player_id: 'QB1', receiver_player_id: 'WR1' }),
  play({ play_type: 'pass', pass_attempt: '1', sack: '1', pass_location: 'NA', air_yards: 'NA', epa: '-2', passer_player_id: 'QB1' }),
  play({ play_type: 'pass', pass_attempt: '1', pass_location: 'NA', air_yards: 'NA', epa: '-0.1', passer_player_id: 'QB1' }),
  // runs: left tackle twice, the middle once, a scramble, a kneel, a two-point try
  play({ play_type: 'run', run_location: 'left', run_gap: 'tackle', rushing_yards: '6', epa: '0.4', rusher_player_id: 'RB1' }),
  play({ play_type: 'run', run_location: 'left', run_gap: 'tackle', rushing_yards: '-1', epa: '-0.6', rusher_player_id: 'RB1' }),
  play({ play_type: 'run', run_location: 'middle', run_gap: 'NA', rushing_yards: '3', rush_touchdown: '1', epa: '0.9', rusher_player_id: 'QB1' }),
  play({ play_type: 'run', run_location: 'right', run_gap: 'end', qb_scramble: '1', rushing_yards: '12', epa: '1', rusher_player_id: 'QB1' }),
  play({ play_type: 'run', run_location: 'NA', run_gap: 'NA', qb_kneel: '1', rushing_yards: '-1', epa: '-0.1', rusher_player_id: 'QB1' }),
  play({ play_type: 'run', run_location: 'right', run_gap: 'guard', two_point_attempt: '1', rusher_player_id: 'RB1' }),
  // kicks: a 45-yard field goal made, a 52 missed, an extra point good, one aborted
  play({ play_type: 'field_goal', kick_distance: '45', field_goal_result: 'made', kicker_player_id: 'K1' }),
  play({ play_type: 'field_goal', kick_distance: '52', field_goal_result: 'missed', kicker_player_id: 'K1' }),
  play({ play_type: 'extra_point', extra_point_result: 'good', kicker_player_id: 'K1' }),
  play({ play_type: 'extra_point', extra_point_result: 'aborted', kicker_player_id: 'K1' }),
  // punts: 50 returned 10 (net 40), 45 a touchback (net 25, inside the 20 not), a blocked one
  play({ play_type: 'punt', kick_distance: '50', return_yards: '10', punt_inside_twenty: '0', touchback: '0', punter_player_id: 'P1' }),
  play({ play_type: 'punt', kick_distance: '45', return_yards: '0', touchback: '1', punter_player_id: 'P1' }),
  play({ play_type: 'punt', kick_distance: 'NA', punt_blocked: '1', punter_player_id: 'P1' }),
];

test('a section tallies hand-made plays', () => {
  const s = section(PLAYS, { qbs: new Map([['QB1', '123']]) });
  // (QB1 under his ESPN id and his gsis id: no keys set, every player kept)
  const qb = s.players['123'];
  assert.deepEqual(qb.pass[3], [2, 1, 8, 1, 0, 0.5]);
  assert.deepEqual(qb.pass[11], [1, 0, 0, 0, 1, -3]);
  assert.equal(qb.pass.reduce((n, z) => n + z[0], 0), 3);
  assert.deepEqual(qb.runs[3], [1, 3, 1, 0.9, 1]);
  assert.equal(qb.runs.reduce((n, l) => n + l[0], 0), 1, 'the scramble and the kneel left out');
  assert.deepEqual(s.players.QB1, qb);
  assert.deepEqual(s.players.WR1.targets[3], [1, 1, 8, 1, 0, 1.5]);
  assert.deepEqual(s.players.WR1.targets[11], [1, 0, 0, 0, 1, -3]);
  assert.deepEqual(s.players.RB1.runs[1], [2, 5, 0, -0.1, 0.5]);
  assert.deepEqual(s.players.K1.fg, [[0, 0], [0, 0], [1, 1], [1, 0], [0, 0]]);
  assert.deepEqual(s.players.K1.xp, { att: 1, made: 1 });
  assert.deepEqual(s.players.P1.punt, { n: 3, gross: 47.5, net: 32.5, inside20: 0, touchbacks: 1, fairCatches: 0, blocked: 1, bands: [0, 1, 1, 0] });
  // (the defense under today's abbreviation: OAK is LV)
  assert.deepEqual(Object.keys(s.defenses), ['DEF-LV']);
  assert.deepEqual(s.defenses['DEF-LV'].pass, s.league.pass);
  assert.deepEqual(s.defenses['DEF-LV'].runs, s.league.runs);
});

test("a kick's miss read from its description: wide left or right, short, blocked, the rest other", () => {
  assert.deepEqual(MISSES, ['left', 'right', 'short', 'blocked', 'other']);
  const kinds = [
    ['(4:12) 3-J.Tucker 52 yard field goal is No Good, Wide Right, Center-46-N.Moore, Holder-11-J.Stout.', 'missed'],
    ['J.Elliott 44 yard field goal is No Good, Wide Left, Center-44-R.Lovato, Holder-8-B.Pirozzi.', 'missed'],
    ['B.Aubrey 61 yard field goal is No Good, Short, Center-47-T.Ward, Holder-6-B.Anger.', 'missed'],
    ['Y.Koo 48 yard field goal is BLOCKED (96-D.Wise), Center-47-L.Stirling, Holder-13-B.Pinion.', 'blocked'],
    ['H.Butker 51 yard field goal is No Good, Hit Right Upright, Center-41-J.Winchester.', 'missed'],
    ['C.Boswell 47 yard field goal is No Good, Hit Left Upright, Center-46-C.Kuntz.', 'missed'],
    ['M.Gay 55 yard field goal is No Good, Hit Crossbar, Center-42-M.Orzech.', 'missed'],
    ['R.Gould 33 yard field goal is No Good, Holder-4-A.Lee.', 'missed'],
    ['E.McPherson extra point is No Good, Wide Left, Center-46-C.Adomitis.', 'failed'],
    ['G.Zuerlein extra point is Blocked (91-C.Wilkins), Center-42-T.Hennessy.', 'blocked'],
  ];
  assert.deepEqual(kinds.map(([desc, result]) => MISSES[missKind(desc, result)]), ['right', 'left', 'short', 'blocked', 'right', 'left', 'short', 'other', 'left', 'blocked']);
  // (a block known by the result alone; one in the description with no result to say so)
  assert.equal(missKind('NA', 'blocked'), 3);
  assert.equal(missKind('K.Fairbairn 40 yard field goal is BLOCKED (92-D.Tillery).', 'missed'), 3);
  assert.equal(missKind(undefined, 'missed'), 4);

  // (tallied by band, the league's too: each band's misses its tries less its makes)
  const s = section([
    ...PLAYS,
    play({ play_type: 'field_goal', kick_distance: '41', field_goal_result: 'missed', kicker_player_id: 'K1', desc: kinds[0][0] }),
    play({ play_type: 'field_goal', kick_distance: '44', field_goal_result: 'missed', kicker_player_id: 'K1', desc: kinds[4][0] }),
    play({ play_type: 'field_goal', kick_distance: '48', field_goal_result: 'blocked', kicker_player_id: 'K1', desc: kinds[3][0] }),
    play({ play_type: 'field_goal', kick_distance: '25', field_goal_result: 'missed', kicker_player_id: 'K1', desc: kinds[6][0] }),
    play({ play_type: 'extra_point', extra_point_result: 'failed', kicker_player_id: 'K1', desc: kinds[8][0] }),
  ]);
  const k = s.players.K1;
  // (the 52 from the plays above: no description, other)
  assert.deepEqual(k.fg, [[1, 0], [0, 0], [4, 1], [1, 0], [0, 0]]);
  assert.deepEqual(k.fgMiss, [[0, 0, 1, 0, 0], [0, 0, 0, 0, 0], [0, 2, 0, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 0]]);
  assert.deepEqual(k.xp, { att: 2, made: 1 });
  assert.deepEqual(k.xpMiss, [1, 0, 0, 0, 0]);
  assert.deepEqual(s.league.fgMiss, k.fgMiss);
  assert.deepEqual(s.league.xpMiss, k.xpMiss);
});

test('a section keeps only the keys asked for', () => {
  const s = section(PLAYS, { keys: new Set(['WR1', 'K1']), qbs: new Map([['QB1', '123']]), teams: new Set(['KC']) });
  assert.deepEqual(Object.keys(s.players).sort(), ['123', 'K1', 'WR1']);
  assert.deepEqual(s.defenses, {});
});

test('the play-by-play reader keeps the asked columns, quoted commas and newlines too', () => {
  const csv = 'a,desc,b\r\n1,"x, ""y""\nz",2\n3,plain,4\n';
  assert.deepEqual(parsePlays(csv, ['a', 'b', 'desc']), [
    { a: '1', b: '2', desc: 'x, "y"\nz' },
    { a: '3', b: '4', desc: 'plain' },
  ]);
});

// ---- the committed files
const ROOT = staticDir('nfl');
const seasonDirs = [
  ROOT,
  ...fs
    .readdirSync(path.join(ROOT, 'seasons'))
    .filter((d) => /^\d{4}$/.test(d))
    .map((d) => path.join(ROOT, 'seasons', d)),
].filter((dir) => fs.existsSync(path.join(dir, 'skill-players.json')));

const maybe = (file) => (fs.existsSync(file) ? readJson(file) : null);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const sum = (rows, i = 0) => rows.reduce((n, r) => n + r[i], 0);
function checkZones(zones, what) {
  assert.equal(zones.length, 12, `${what}: ${zones.length} zones`);
  for (const z of zones) {
    assert.equal(z.length, 6, what);
    for (const i of [0, 1, 3, 4]) assert.ok(isCount(z[i]), `${what}: ${z}`);
    assert.ok(z[1] <= z[0], `${what}: more catches than throws`);
  }
}
function checkLanes(lanes, what) {
  assert.equal(lanes.length, 7, `${what}: ${lanes.length} lanes`);
  for (const l of lanes) {
    assert.equal(l.length, 5, what);
    assert.ok(isCount(l[0]) && isCount(l[2]), `${what}: ${l}`);
    assert.ok(l[4] >= 0 && l[4] <= 1, `${what}: success ${l[4]}`);
  }
}
function checkBands(bands, what) {
  assert.equal(bands.length, 5, `${what}: ${bands.length} bands`);
  for (const b of bands) assert.ok(isCount(b[0]) && isCount(b[1]) && b[1] <= b[0], `${what}: ${b}`);
}
// (each band's misses, by how: every one of its tries less its makes, no more, no fewer)
function checkMisses(e, what) {
  assert.ok(e.fgMiss, `${what}: no fgMiss`);
  assert.equal(e.fgMiss.length, 5, what);
  e.fgMiss.forEach((m, i) => {
    assert.equal(m.length, MISSES.length, what);
    assert.ok(m.every(isCount), `${what}: ${m}`);
    assert.equal(m.reduce((a, n) => a + n, 0), e.fg[i][0] - e.fg[i][1], `${what}: band ${i}'s misses ${m}, ${e.fg[i]}`);
  });
  if (e.xp) {
    assert.equal(e.xpMiss?.length, MISSES.length, `${what}: xpMiss`);
    assert.equal(e.xpMiss.reduce((a, n) => a + n, 0), e.xp.att - e.xp.made, `${what}: extra points' misses`);
  }
}
function checkPunt(p, what) {
  for (const k of ['n', 'inside20', 'touchbacks', 'fairCatches', 'blocked']) assert.ok(isCount(p[k]), `${what}: ${k}`);
  assert.equal(p.bands.length, 4, what);
  assert.ok(sum(p.bands.map((n) => [n])) <= p.n, what);
}
function checkEntry(e, what) {
  assert.ok(Object.keys(e).length, `${what}: empty`);
  if (e.pass) checkZones(e.pass, `${what} pass`);
  if (e.targets) checkZones(e.targets, `${what} targets`);
  if (e.runs) checkLanes(e.runs, `${what} runs`);
  if (e.fg) checkBands(e.fg, `${what} fg`);
  if (e.fg) checkMisses(e, `${what} fg`);
  if (e.xp) assert.ok(isCount(e.xp.att) && isCount(e.xp.made) && e.xp.made <= e.xp.att, `${what} xp`);
  if (e.punt) checkPunt(e.punt, `${what} punt`);
}

for (const dir of seasonDirs) {
  const name = dir === ROOT ? 'current' : path.basename(dir);
  test(`NFL field maps ${name}: the contract, the league's sums and every card row`, () => {
    const file = path.join(dir, 'field-maps.json');
    assert.ok(fs.existsSync(file), `${name}: no field-maps.json`);
    assert.ok(fs.statSync(file).size < 500_000, `${name}: field-maps.json over 500 KB`);
    const maps = readJson(file);
    assert.deepEqual(maps.fields, FIELDS);
    assert.ok(maps.regular && maps.all, `${name}: a part missing`);
    const zonesKnown = maps.season >= 2006;
    for (const [part, suffix] of [['regular', ''], ['post', '.post'], ['all', '.all']]) {
      const s = maps[part];
      const skill = maybe(path.join(dir, `skill-players${suffix}.json`));
      const games = maybe(path.join(dir, `games${suffix}.json`));
      if (!s) {
        assert.equal(part, 'post', `${name}: no ${part}`);
        continue;
      }
      checkZones(s.league.pass, `${name} ${part} league`);
      checkLanes(s.league.runs, `${name} ${part} league`);
      checkBands(s.league.fg, `${name} ${part} league`);
      checkMisses(s.league, `${name} ${part} league`);
      checkPunt(s.league.punt, `${name} ${part} league`);
      for (const [key, e] of Object.entries(s.players)) checkEntry(e, `${name} ${part} ${key}`);
      for (const [key, d] of Object.entries(s.defenses)) checkEntry(d, `${name} ${part} ${key}`);

      // (every zone's throws: the league's are the defenses' allowed, zone by zone; runs too)
      const defs = Object.values(s.defenses);
      s.league.pass.forEach((z, i) => assert.equal(z[0], defs.reduce((n, d) => n + d.pass[i][0], 0), `${name} ${part}: zone ${i}`));
      s.league.runs.forEach((l, i) => assert.equal(l[0], defs.reduce((n, d) => n + d.runs[i][0], 0), `${name} ${part}: lane ${i}`));
      const leaguePass = sum(s.league.pass);
      if (zonesKnown) assert.ok(leaguePass > (part === 'post' ? 300 : 10_000) || name === 'current', `${name} ${part}: ${leaguePass} throws`);
      else assert.equal(leaguePass, 0, `${name}: zones before 2006`);

      // (the quarterbacks' throws, nearly all the league's: the card's QBs are the ones who start)
      const qbThrows = (games ?? []).reduce((n, q) => n + (s.players[String(q.id)]?.pass ? sum(s.players[String(q.id)].pass) : 0), 0);
      assert.ok(qbThrows <= leaguePass, `${name} ${part}: the QBs' throws past the league's`);
      if (games && zonesKnown && leaguePass) assert.ok(qbThrows >= 0.85 * leaguePass, `${name} ${part}: the QBs' ${qbThrows} of ${leaguePass} throws`);

      // every card row with plays finds its entry
      const missing = [];
      const has = (id, field) => s.players[id]?.[field];
      for (const q of games ?? []) if (zonesKnown && q.box?.attempts >= 20 && !has(String(q.id), 'pass')) missing.push(`QB ${q.name}`);
      for (const r of skill?.K ?? []) if (r.stats.fgAtt > 0 && !has(r.gsisId, 'fg')) missing.push(`K ${r.name}`);
      for (const r of skill?.P ?? []) if (r.stats.punts > 0 && !has(r.gsisId, 'punt')) missing.push(`P ${r.name}`);
      for (const pos of ['RB', 'WR', 'TE']) {
        for (const r of skill?.[pos] ?? []) {
          if (zonesKnown && r.stats.targets >= 5 && !has(r.gsisId, 'targets')) missing.push(`${pos} ${r.name} targets`);
          if (r.stats.carries >= 20 && !has(r.gsisId, 'runs')) missing.push(`${pos} ${r.name} runs`);
        }
      }
      for (const r of skill?.DEF ?? []) if (!s.defenses[r.gsisId]) missing.push(r.gsisId);
      assert.deepEqual(missing, [], `${name} ${part}: rows without a field map`);
    }
  });
}
