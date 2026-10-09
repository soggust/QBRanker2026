// The rank tile's breakdown (rank-why.ts): each stat's share of a row's score, from the list's own scoring
// (TabRanker.scores, weightedTotals' parts). For every tab of every sport, on real data: the shares add up
// to the score the list went by, the scores fall down the list (but where the sport's head to head moved a
// row, which the breakdown then says), and the gaps to the rows beside it are the scores' own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SPORTS, loadEngine } from './support/engine.mjs';

const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${what}: ${a} vs ${b}`);

// A tab's list as the grid makes it, with the tab's default sliders and nothing switched off
function harness(engine, rows, position, settings) {
  const { TabRanker, StatReader, SKILL_STATS, skillGroups, presetWeights, emptyIn, CURRENT_SEASON } = engine;
  const table = { position, stats: SKILL_STATS[position], groups: skillGroups(position), hidden: {}, weights: presetWeights(position, 'default') };
  const positions = { settings, statHiddenState: {}, skillHiddenGroups: () => ({}), getWeights: (p) => presetWeights(p, 'default'), isStatHidden: () => false };
  const ranker = new TabRanker(positions, { firstSeasons: async () => ({}) }, () => table, () => {});
  const listed = ranker.listed(rows, CURRENT_SEASON, position);
  const reader = new StatReader({ position, settings, rows, list: listed, tableSeason: true, season: CURRENT_SEASON, empty: (key) => emptyIn(rows[position] ?? [], key), weights: ranker.mixWeights(position) });
  return { ranker, reader, listed };
}

for (const sport of SPORTS) {
  test(`${sport}: a row's breakdown adds up to its score, and the scores make the list`, async (t) => {
    const engine = await loadEngine(sport, { entry: path.join(import.meta.dirname, 'support/why-entry.ts') });
    const { SPORT, DEFAULT_SETTINGS, SKILL_STATS, SKILL_UNITS, rankWhy } = engine;
    let tabs = 0;
    let moved = 0;
    // (the defaults, and with Combine on: a pair counted as its one total)
    for (const settings of [{ ...DEFAULT_SETTINGS }, { ...DEFAULT_SETTINGS, combineStats: true }]) {
      for (const position of Object.keys(SKILL_STATS)) {
        if (!(SKILL_UNITS[position]?.length > 2)) continue;
        const { ranker, reader, listed } = harness(engine, SKILL_UNITS, position, settings);
        const parts = new Map();
        const strengths = new Map();
        const scored = ranker.scores(reader, listed, position, SKILL_UNITS, parts, strengths);
        const list = ranker.ranked(reader, listed, position, SKILL_UNITS);
        assert.ok(list.length > 2, `${sport} ${position}: a list to check`);
        tabs++;

        // Every row's shares sum to its total (the totals are what ranked sorted by)
        for (const [row, total] of scored.totals) {
          const sum = [...(parts.get(row)?.values() ?? [])].reduce((a, b) => a + b, 0);
          close(sum, total, `${sport} ${position} ${row.name}: shares vs score`);
        }
        // Parts asked for or not, the same list
        assert.deepEqual(ranker.scores(reader, listed, position, SKILL_UNITS).ranked, scored.ranked, `${sport} ${position}: keeping parts changed the order`);

        const scoredParts = { ...scored, parts, strengths };
        list.forEach((row, i) => {
          const why = rankWhy(list, i, scoredParts, reader, { manual: false, settings: settings.sport });
          assert.equal(why.rank, i + 1);
          assert.equal(why.of, list.length);
          assert.equal(why.score, scored.totals.get(row));
          // (what it shows, every stat that counted, adds up to the score at the top)
          const shown = why.parts.reduce((a, p) => a + p.amount, 0);
          close(shown, why.score, `${sport} ${position} ${row.name}: breakdown vs score`);
          // (each stat's hover: what it's worth and the slider; a share over its strength, the stat's standard score)
          for (const part of why.parts) {
            assert.ok(part.title.includes('to the score') && part.title.includes('slider'), `${sport} ${position} ${part.key}: hover ${part.title}`);
            assert.ok(strengths.has(part.key), `${sport} ${position} ${part.key}: no strength`);
          }
          assert.ok(why.parts.every((p, k) => k === 0 || Math.abs(p.amount) <= Math.abs(why.parts[k - 1].amount)), `${sport} ${position}: parts not biggest first`);
          for (const vs of why.vs) {
            const other = list[vs.rank - 1];
            close(vs.diff, why.score - scored.totals.get(other), `${sport} ${position} ${row.name} vs ${other.name}`);
          }
          // The next row down: a score no higher, unless head to head put it there (and the breakdown says so)
          const next = list[i + 1];
          if (next && scored.totals.get(next) > scored.totals.get(row)) {
            assert.ok(SPORT.beat, `${sport} ${position}: ${next.name} (#${i + 2}) outscored ${row.name} (#${i + 1}) with no head-to-head rule`);
            assert.ok(why.vs.find((vs) => vs.rank === i + 2)?.headToHead, `${sport} ${position}: ${row.name} above a better score, not said`);
            moved++;
          }
          if (why.movedByHeadToHead) assert.ok(SPORT.beat);
        });

        // Dragged by hand: said, with its place on score
        const manual = rankWhy([...list].reverse(), 0, scoredParts, reader, { manual: true, settings: settings.sport });
        assert.ok(manual.manual && !manual.movedByHeadToHead && manual.vs.every((vs) => !vs.headToHead));
      }
    }
    assert.ok(tabs > 0, `${sport}: no tab checked`);
    t.diagnostic(`${sport}: ${tabs} lists checked, ${moved} rows above a better score by head to head`);
  });
}

// Tied scores: their order isn't head to head's doing (the second of two tied rows was said to be moved);
// a better score below is
test('mma: a tie in score is not a head-to-head move', async () => {
  const { rankWhy, DEFAULT_SETTINGS } = await loadEngine('mma', { entry: path.join(import.meta.dirname, 'support/why-entry.ts') });
  const row = (id) => ({ gsisId: id, name: id, fights: [], stats: {} });
  const [a, b, c] = ['A', 'B', 'C'].map(row);
  const reader = { label: () => '', name: () => '', listRank: () => null, format: () => '-', lastFive: () => [] };
  const why = (list, scores, i) =>
    rankWhy(list, i, { totals: new Map(list.map((r, k) => [r, scores[k]])), counted: [], parts: new Map() }, reader, { manual: false, settings: DEFAULT_SETTINGS.sport });

  const tied = why([a, b, c], [1, 1, 0], 1);
  assert.equal(tied.scoreRank, 1);
  assert.ok(!tied.movedByHeadToHead && tied.vs.every((vs) => !vs.headToHead));

  const moved = why([a, b], [0, 1], 0);
  assert.equal(moved.scoreRank, 2);
  assert.ok(moved.movedByHeadToHead && moved.vs[0].headToHead);
  assert.ok(why([a, b], [0, 1], 1).movedByHeadToHead);
});

// The numbers as the breakdown writes them: a real minus, no "−0.00", three places under a hundredth
test('rank-why: scores and shares as written', async () => {
  const { scoreText, signedScore } = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support/why-entry.ts') });
  assert.equal(scoreText(21.044), '21.04');
  assert.equal(scoreText(-0.5), '−0.50');
  assert.equal(scoreText(-0.001), '0.00');
  assert.equal(signedScore(0.12), '+0.12');
  assert.equal(signedScore(-0.084), '−0.08');
  assert.equal(signedScore(0.004), '+0.004');
  assert.equal(signedScore(-0.0001), '0.000');
  assert.equal(signedScore(0), '0.00');
});
