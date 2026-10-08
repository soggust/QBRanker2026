// The engine and one sport's modules, bundled for the tests by engine.mjs (esbuild through the app's
// tsconfig, the way libs/ranker/scripts/build-comps.mjs bundles them). prefill fills DATA from
// globalThis.__DATA first, since unit-scoring builds the rows as soon as it loads.
import '../../libs/ranker/scripts/comps/prefill';

export { DATA, CURRENT_SEASON, withSeason } from '@ranker/engine/data';
export {
  SKILL_UNITS,
  rebuildUnits,
  unitsForSeason,
  weightedTotals,
  byTotals,
  combinedWeights,
  defaultRanking,
  emptyIn,
  statValue,
  DEFAULT_SPORT_SETTINGS,
} from '@ranker/engine/unit-scoring';
export { TabRanker } from '@ranker/engine/skill-rankings/tab-ranker';
export { StatReader } from '@ranker/engine/stat-reader';
export { DEFAULT_SETTINGS, PositionService } from '@ranker/engine/position.service';
export { hasMin, minCount, seasonLength } from '@ranker/engine/playing-time';
export { shareLink, applySharedLink } from '@ranker/engine/share';
export { SPORT } from '@sport/sport';
export { POSITIONS, SKILL_STATS, presetWeights, skillGroups, statGroup } from '@sport/positions';
