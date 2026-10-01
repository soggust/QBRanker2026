// NHL similar seasons and career links for the player card (the shared builder:
// libs/ranker/scripts/build-comps.mjs). Run after adding a finished season: `npm run nhl:build-comps`.
import { buildComps } from '../../../libs/ranker/scripts/build-comps.mjs';

// A skater needs 40 games to get similar seasons and 55 to be one, a goalie 20 and 30; the shortened
// seasons scale down (the 48-game 2012-13 lockout, the 2019-20 pause, the 56-game 2020-21)
const SHORT_SEASONS = { 2013: 48, 2020: 70, 2021: 56 };
const scale = (season) => (SHORT_SEASONS[season] ?? 82) / 82;

await buildComps({
  app: import.meta.dirname + '/..',
  minGames: (position, season) =>
    position === 'G'
      ? { subject: 20 * scale(season), pool: 30 * scale(season) }
      : { subject: 40 * scale(season), pool: 55 * scale(season) },
});
