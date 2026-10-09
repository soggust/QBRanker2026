// The build scripts run the engine under Node (build-comps bundles libs/ranker/scripts/comps/units.ts
// with esbuild and imports it), where there's no page: no location, window or document. Importing the
// engine must not touch them (data.ts read location at import, which crashed `npm run build-comps`).
// This is build-comps' own bundle and its first steps for each sport, without writing any files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SPORTS, loadEngine, seasonData, staticDir } from './support/engine.mjs';

const UNITS_ENTRY = path.join(ROOT, 'libs/ranker/scripts/comps/units.ts');

test('Node has no browser globals here (so the import checks below mean something)', () => {
  for (const name of ['location', 'window', 'document', 'history', 'localStorage', 'sessionStorage']) {
    assert.equal(typeof globalThis[name], 'undefined', `${name} is defined under Node`);
  }
});

for (const sport of SPORTS) {
  test(`${sport}: build-comps' engine bundle imports and ranks under Node`, async () => {
    const seasonsDir = path.join(staticDir(sport), 'seasons');
    const years = fs.existsSync(seasonsDir) ? fs.readdirSync(seasonsDir).filter((d) => /^\d{4}$/.test(d)).sort() : [];
    // (build-comps starts DATA on the first finished season; a sport without any, on its current one)
    const dir = years.length ? path.join(seasonsDir, years[0]) : staticDir(sport);
    const { unitsFor, SKILL_STATS, defaultRanking, headlineStats, presetWeights, unitStat } = await loadEngine(sport, {
      entry: UNITS_ENTRY,
      data: seasonData(dir),
    });
    for (const fn of [unitsFor, defaultRanking, headlineStats, presetWeights, unitStat]) assert.equal(typeof fn, 'function');

    const latest = years.length ? path.join(seasonsDir, years.at(-1)) : staticDir(sport);
    const units = unitsFor(seasonData(latest));
    let rows = 0;
    for (const position of Object.keys(SKILL_STATS)) {
      const ranked = defaultRanking(position, presetWeights(position, 'default'), units);
      assert.equal(ranked.length, (units[position] ?? []).length, `${sport} ${position}: the default ranking lost rows`);
      for (const unit of ranked.slice(0, 5)) for (const stat of headlineStats(position)) unitStat(unit, stat.key);
      rows += ranked.length;
    }
    assert.ok(rows > 0, `${sport}: no rows built`);
  });
}

// The nightly data scripts fetch through the one shared helper (libs/ranker/scripts/fetch.mjs: a timeout on
// each try, retries), never fetch() bare: a source that hangs can't hold the run
test('the data scripts fetch through libs/ranker/scripts/fetch.mjs, with its timeout', () => {
  const scripts = [...SPORTS.map((sport) => `apps/${sport}/scripts/update-data.mjs`), 'apps/mma/scripts/fights.mjs'];
  for (const script of scripts) {
    const file = path.join(ROOT, script);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /import \{ fetchRetry \} from '\.\.\/\.\.\/\.\.\/libs\/ranker\/scripts\/fetch\.mjs';/, `${script}: not on the shared fetch`);
    assert.doesNotMatch(source, /(^|[^.\w])fetch\(/m, `${script}: a bare fetch()`);
  }
});
