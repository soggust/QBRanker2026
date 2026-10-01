// MLB similar seasons and career links for the player card (the shared builder:
// libs/ranker/scripts/build-comps.mjs). Run after adding a finished season: `npm run mlb:build-comps`.
import { buildComps } from '../../../libs/ranker/scripts/build-comps.mjs';

// In each tab's games (a hitter's games, a starter's starts, a reliever's appearances): to get similar
// seasons, and to be one. The 60-game 2020 scales down.
const MIN_GAMES = { hitter: { subject: 60, pool: 90 }, SP: { subject: 12, pool: 18 }, RP: { subject: 25, pool: 35 } };
const scale = (season) => (season === 2020 ? 60 / 162 : 1);

await buildComps({
  app: import.meta.dirname + '/..',
  minGames: (position, season) => {
    const min = MIN_GAMES[position === 'SP' || position === 'RP' ? position : 'hitter'];
    return { subject: min.subject * scale(season), pool: min.pool * scale(season) };
  },
});
