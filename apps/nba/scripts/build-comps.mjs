// NBA similar seasons and career links for the player card (the shared builder:
// libs/ranker/scripts/build-comps.mjs). Run after adding a finished season: `npm run nba:build-comps`.
import { buildComps } from '../../../libs/ranker/scripts/build-comps.mjs';

// A season needs 40 games to get similar seasons and 55 to be one; the shortened seasons scale down
// (the 66-game 2011-12 lockout, the 2019-20 pause, the 72-game 2020-21)
const SHORT_SEASONS = { 2012: 66, 2020: 67, 2021: 72 };
const scale = (season) => (SHORT_SEASONS[season] ?? 82) / 82;

await buildComps({
  app: import.meta.dirname + '/..',
  minGames: (_position, season) => ({ subject: 40 * scale(season), pool: 55 * scale(season) }),
});
