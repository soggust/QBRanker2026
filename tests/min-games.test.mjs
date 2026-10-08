// Min Games only leaves players out (TabRanker.ranked, weightedTotals' pool): raising it must never
// reorder the players who stay, and the list as it first opens (the default settings) must rank the same
// as it did before the fix, when each stat was measured over the listed players alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SPORTS, loadEngine, seasonData, seasonDir, staticDir } from './support/engine.mjs';

// The current season and the latest finished one (the current one alone for a sport without seasons/)
function seasonsOf(sport, current) {
  const dir = path.join(staticDir(sport), 'seasons');
  const past = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => /^\d{4}$/.test(d)).map(Number) : [];
  const finished = past.filter((s) => s < current).sort((a, b) => b - a)[0];
  return [current, ...(finished ? [finished] : [])];
}

// Everything a list needs for one tab: a TabRanker over plain stand-ins for the services (the tab's
// default sliders, nothing switched off) and a StatReader on the season's rows
function harness(engine, rows, season, position, settings) {
  const { TabRanker, StatReader, SKILL_STATS, skillGroups, presetWeights, emptyIn } = engine;
  const weights = presetWeights(position, 'default');
  const positions = {
    settings,
    statHiddenState: {},
    skillHiddenGroups: () => ({}),
    getWeights: (p) => presetWeights(p, 'default'),
    isStatHidden: () => false,
  };
  const table = { position, stats: SKILL_STATS[position], groups: skillGroups(position), hidden: {}, weights };
  const ranker = new TabRanker(positions, { firstSeasons: async () => ({}) }, () => table, () => {});
  const listed = ranker.listed(rows, season, position);
  const reader = new StatReader({
    position,
    settings,
    rows,
    list: listed,
    tableSeason: true,
    season,
    empty: (key) => emptyIn(rows[position] ?? [], key),
    weights: ranker.mixWeights(position),
  });
  return { ranker, reader, listed };
}

const ids = (list) => list.map((p) => p.gsisId ?? p.name);

for (const sport of SPORTS) {
  test(`${sport}: Min Games only excludes, and the default list is unchanged`, async (t) => {
    const engine = await loadEngine(sport);
    const { SPORT, DEFAULT_SETTINGS, CURRENT_SEASON, SKILL_STATS, hasMin, withSeason, unitsForSeason, weightedTotals } = engine;
    const fixed = SPORT.playingTime.fixed;
    // (a share of the season, or the sport's fixed count of games or fights)
    const steps = fixed ? [1, 2, 4, 6, 10].map((minCount) => ({ minCount })) : [0, 10, 25, 50, 75].map((minShare) => ({ minShare }));

    for (const season of seasonsOf(sport, CURRENT_SEASON)) {
      const data = seasonData(seasonDir(sport, season, CURRENT_SEASON), SPORT.dataFiles);
      withSeason(season, data, () => {
        const rows = unitsForSeason(data, season);
        let filtered = 0;
        for (const position of Object.keys(SKILL_STATS)) {
          if (!hasMin(position) || !(rows[position]?.length > 2)) continue;
          const lists = steps.map((step) => {
            const settings = { ...DEFAULT_SETTINGS, ...step };
            const { ranker, reader, listed } = harness(engine, rows, season, position, settings);
            return ids(ranker.ranked(reader, listed, position, rows));
          });
          // (the loosest list holds every stricter one; each stricter one is it with players left out)
          const loosest = lists[0];
          lists.forEach((list, i) => {
            const kept = new Set(list);
            assert.deepEqual(list, loosest.filter((id) => kept.has(id)), `${sport} ${season} ${position}: Min step ${JSON.stringify(steps[i])} reordered the players who stayed`);
          });
          if (lists.at(-1).length < loosest.length) filtered++;
          if (process.env.VERBOSE) console.log(sport, season, position, lists.map((l) => l.length).join("/"));

          // The defaults: the same order as ranking the listed players on their own (the old way: each
          // stat's average and spread over just them)
          const { ranker, reader, listed } = harness(engine, rows, season, position, { ...DEFAULT_SETTINGS });
          const now = ids(ranker.ranked(reader, listed, position, rows));
          const alone = ids(ranker.ranked(reader, listed, position, { ...rows, [position]: listed }));
          assert.deepEqual(now, alone, `${sport} ${season} ${position}: the default list's order changed`);

          // weightedTotals' pool: a subset scored against the full pool scores as it does in the full list
          const stats = SKILL_STATS[position];
          const weights = Object.fromEntries(stats.map((s) => [s.key, 50]));
          const all = rows[position];
          const value = (p, s) => reader.value(p, s);
          const full = weightedTotals(all, stats, weights, value, undefined, DEFAULT_SETTINGS.sport);
          const some = all.filter((_, i) => i % 3 === 0);
          const pooled = weightedTotals(some, stats, weights, value, undefined, DEFAULT_SETTINGS.sport, all);
          for (const p of some) {
            assert.ok(Math.abs(pooled.get(p) - full.get(p)) < 1e-9, `${sport} ${season} ${position}: ${p.name} scored ${pooled.get(p)} in a subset, ${full.get(p)} in the full list`);
          }
        }
        // (the check means something only if Min left someone out)
        assert.ok(filtered > 0, `${sport} ${season}: no tab's list got shorter as Min went up`);
      });
      t.diagnostic(`${sport} ${season} checked`);
    }
  });
}
