// Bundled by build-comps.mjs (esbuild) so the script reads each season's rows, stats and default
// ranking exactly the way the app does. prefill.ts runs first and fills DATA from globalThis.__DATA,
// since unit-scoring reads the rows as soon as it loads.
import './prefill';
import { DATA } from 'StaticData/data';
import { SKILL_UNITS, defaultRanking, rebuildUnits } from 'app/utils/unit-scoring';
import { SKILL_STATS, headlineStats, presetWeights, statGroup, unitStat } from 'app/positions';

export function unitsFor(data: object) {
  Object.assign(DATA, data);
  rebuildUnits();
  return SKILL_UNITS;
}

export { SKILL_STATS, defaultRanking, headlineStats, presetWeights, statGroup, unitStat };
