// The card's skills (player-card/overview.ts skillsOf): each a weighted average of its stats'
// percentiles (a part's weight, 1 unless its definition says), a rate stat counting only for a player
// with the volume behind it (the sport's SKILL_MINIMUMS: below it, the part is skipped for him and he's
// out of the others' pool on it), and the hover that says what a skill is made of (hover-text.ts
// skillDefinition), and a stat only skills read (SKILL_DERIVED). On made-up rows, then the NBA's real
// ones (Shooting: FT % at half weight).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';

const ENTRY = path.join(import.meta.dirname, 'support', 'skills-entry.ts');
let nba;
before(async () => {
  nba = await loadEngine('nba', { entry: ENTRY });
});

// A stand-in for the StatReader: counting stats per game, the rest as they are
const fakeReader = { empty: () => false, rate: (p, s) => (p.stats[s.key] == null ? null : s.kind === 'volume' ? p.stats[s.key] / p.games : p.stats[s.key]) };
// A guard over 10 games: threes made, 3P %, FT % and the attempts behind them (fg3a, fta)
const guard = (name, threes, fg3a, ftPct, fta) => ({ name, gsisId: name, games: 10, stats: { threes, fg3a, fg3Pct: fg3a ? (100 * threes) / fg3a : null, ftPct, fta } });
const percentileOf = (mine, values) => values.filter((v) => v < mine).length / (values.length - 1);

test('skills: a weighted average of the parts, and a low-volume shooter skipped and out of the pool', () => {
  const { skillsOf, SKILL_STATS } = nba;
  // (every one of them shoots enough; Lo is 2-for-4 from three over 10 games, under 1.5 attempts a game)
  const list = [
    guard('A', 30, 80, 80, 40),
    guard('B', 25, 70, 85, 40),
    guard('C', 20, 60, 90, 40),
    guard('D', 15, 50, 75, 40),
    guard('E', 10, 40, 70, 40),
    guard('Lo', 2, 4, 95, 40),
  ];
  const shooting = (p) => skillsOf('PG', SKILL_STATS.PG, fakeReader, p, list).find((s) => s.id === 'shooting');

  // Lo: no 3P % (his skill from 3PM / G and FT %, FT % at half weight)
  const lo = shooting(list[5]);
  assert.deepEqual(lo.evidence.map((e) => e.label).sort(), ['3PM / G', 'FT %']);
  const loThrees = percentileOf(0.2, list.map((p) => p.stats.threes / 10));
  const loFt = percentileOf(95, list.map((p) => p.stats.ftPct));
  assert.equal(lo.pct, (loThrees + 0.5 * loFt) / 1.5);

  // ...and out of everyone else's 3P % pool: E's 25% (10 of 40) is the bottom of 5, not above Lo's 50%
  const e = shooting(list[4]);
  assert.deepEqual(e.evidence.find((x) => x.label === '3P %'), { label: '3P %', rank: 5, of: 5 });

  // A: the weighted average, FT % counting half (unweighted it would be (1 + 3P% + FT%) / 3)
  const a = shooting(list[0]);
  const threes = 1;
  const fg3 = percentileOf(37.5, list.slice(0, 5).map((p) => p.stats.fg3Pct));
  const ft = percentileOf(80, list.map((p) => p.stats.ftPct));
  assert.ok(Math.abs(a.pct - (threes + fg3 + 0.5 * ft) / 2.5) < 1e-12, `${a.pct}`);
  assert.notEqual(a.pct, (threes + fg3 + ft) / 3);
});

test('skills: a minimum asks per game played, and counts a row it has no attempts for', () => {
  const { qualifies } = nba;
  const min = { perGame: 1.5, noun: 'attempts', attempts: (p) => p.stats.fg3a };
  assert.equal(qualifies(min, { games: 10, stats: { fg3a: 15 } }), true);
  assert.equal(qualifies(min, { games: 10, stats: { fg3a: 14 } }), false);
  // (early in a season: 3 games, 5 attempts)
  assert.equal(qualifies(min, { games: 3, stats: { fg3a: 5 } }), true);
  assert.equal(qualifies(min, { games: 10, stats: { fg3a: null } }), true);
  // (a count all told, whatever the games: an MMA fighter's fights with box stats)
  const fights = { atLeast: 4, noun: 'fights with stats', attempts: (p) => p.statFights ?? 0 };
  assert.equal(qualifies(fights, { games: 30, statFights: 3, stats: {} }), false);
  assert.equal(qualifies(fights, { games: 30, statFights: 4, stats: {} }), true);
  assert.equal(qualifies(undefined, { games: 10, stats: {} }), true);
});

test("skills: each skill's hover says what it's made of", () => {
  const { skillDefinition, skillTitle, SKILLS, SKILL_MINIMUMS, SKILL_STATS } = nba;
  const def = (id) => SKILLS.PG.find((d) => d.id === id);
  assert.equal(
    skillDefinition(def('shooting'), SKILL_STATS.PG, SKILL_MINIMUMS.PG),
    '3PM / G, 3P % and FT % (half weight); 3P % and FT % need 1.5 and 1 attempts a game',
  );
  assert.equal(skillDefinition(def('playmaking'), SKILL_STATS.PG, SKILL_MINIMUMS.PG), 'APG (double weight), AST % (double weight) and TOV % (lower is better)');
  // (a count every part asks: said once, "each needs" / "needs"; for some of the parts: named)
  const stats = [
    { key: 'catchPct', label: 'Catch %', kind: 'efficiency' },
    { key: 'epaPerTarget', label: 'EPA / Target', kind: 'efficiency' },
  ];
  const target = { perGame: 2, noun: 'targets', attempts: () => null };
  assert.equal(skillDefinition({ parts: [['catchPct', 1]] }, stats, { catchPct: target }), 'Catch %; needs 2 targets a game');
  assert.equal(
    skillDefinition({ parts: [['epaPerTarget', 1], ['catchPct', 1, 2]] }, stats, { catchPct: target, epaPerTarget: target }),
    'EPA / Target and Catch % (double weight); each needs 2 targets a game',
  );
  assert.equal(skillTitle({ name: 'Shooting', standing: 'Top 8%', pct: 0.92, about: '3PM / G' }), 'Shooting: Top 8% · 92nd percentile\n3PM / G');
});

test("nba: Shooting on the real rows, FT % at half weight and the percentages only with the attempts behind them", (t) => {
  const { TabRanker, StatReader, SKILL_STATS, skillGroups, presetWeights, emptyIn, SKILL_UNITS, CURRENT_SEASON, DEFAULT_SETTINGS, skillsOf, SKILLS, SKILL_MINIMUMS } = nba;
  const position = 'PG';
  const rows = SKILL_UNITS;
  const settings = { ...DEFAULT_SETTINGS };
  const positions = { settings, statHiddenState: {}, skillHiddenGroups: () => ({}), getWeights: (p) => presetWeights(p, 'default'), isStatHidden: () => false };
  const table = { position, stats: SKILL_STATS[position], groups: skillGroups(position), hidden: {}, weights: presetWeights(position, 'default') };
  const ranker = new TabRanker(positions, { firstSeasons: async () => ({}) }, () => table, () => {});
  const readerOf = (list) =>
    new StatReader({ position, settings, rows, list, tableSeason: true, season: CURRENT_SEASON, empty: (k) => emptyIn(rows[position] ?? [], k), weights: ranker.mixWeights(position) });
  const listed = ranker.listed(rows, CURRENT_SEASON, position);
  const list = ranker.ranked(readerOf(listed), listed, position, rows);
  const reader = readerOf(list);
  const shooting = () => new Map(list.map((p) => [p.name, skillsOf(position, SKILL_STATS[position], reader, p, list).find((s) => s.id === 'shooting')]));

  const now = shooting();
  // (the rules as they were: every part alike, no minimums)
  const def = SKILLS[position].find((d) => d.id === 'shooting');
  const [parts, minimums] = [def.parts, SKILL_MINIMUMS[position]];
  def.parts = parts.map(([key, dir]) => [key, dir]);
  SKILL_MINIMUMS[position] = {};
  let was;
  try {
    was = shooting();
  } finally {
    def.parts = parts;
    SKILL_MINIMUMS[position] = minimums;
  }

  // Every percentage in a pool has the attempts behind it, so no pool is bigger than it was
  for (const [name, skill] of now) {
    for (const e of skill?.evidence ?? []) {
      const old = was.get(name).evidence.find((x) => x.label === e.label);
      assert.ok(e.of <= old.of, `${name}: ${e.label} of ${e.of}, was ${old.of}`);
    }
  }

  // Maxey (a 89% free throw shooter) and Doncic (78%, with more threes): the free throws count half, so
  // the gap closes
  const maxey = now.get('Tyrese Maxey');
  const luka = [...now.keys()].find((n) => /^Luka Don/.test(n));
  if (!maxey || !luka) return t.skip("Maxey or Doncic isn't among this season's point guards");
  const gap = maxey.pct - now.get(luka).pct;
  const oldGap = was.get('Tyrese Maxey').pct - was.get(luka).pct;
  assert.ok(gap < oldGap, `Maxey over Doncic by ${gap}, was ${oldGap}`);
});

test('skills: a stat only skills read (SKILL_DERIVED), worked out from the row: MLB saves and holds as one', async () => {
  const mlb = await loadEngine('mlb', { entry: ENTRY });
  const { skillsOf, SKILL_STATS } = mlb;
  const reliever = (name, saves, holds) => ({ name, gsisId: name, games: 60, stats: { saves, holds, ip: 60, war: 1 } });
  // (a closer's saves and a setup man's holds are the same late innings: they tie)
  const list = [reliever('Closer', 30, 0), reliever('Setup', 0, 30), reliever('Middle', 2, 8), reliever('Mop-up', 0, 1)];
  const leverage = (p) => skillsOf('RP', SKILL_STATS.RP, fakeReader, p, list).find((s) => s.id === 'leverage');
  assert.equal(leverage(list[0]).pct, leverage(list[1]).pct);
  assert.ok(leverage(list[0]).pct > leverage(list[2]).pct && leverage(list[2]).pct > leverage(list[3]).pct);
  assert.deepEqual(leverage(list[2]).evidence, [{ label: 'SV + HLD / Game', rank: 3, of: 4 }]);
  assert.equal(leverage(list[2]).about, 'SV + HLD / Game');
});
