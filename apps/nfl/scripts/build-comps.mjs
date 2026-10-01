// NFL similar seasons and career links for the player card (the shared builder:
// libs/ranker/scripts/build-comps.mjs). Run after adding a finished season: `npm run build-comps`.
import { buildComps } from '../../../libs/ranker/scripts/build-comps.mjs';

await buildComps({
  app: import.meta.dirname + '/..',
  // (seasons shorter than six games don't get similar seasons, and under eight can't be one)
  minGames: () => ({ subject: 6, pool: 8 }),
  // (the QBs are built from these: SPORT.dataFiles)
  dataFiles: {
    games: 'games.json',
    subjective: 'subjective.json',
    teamGrades: 'team-grades.json',
    dataGrades: 'data-grades.json',
  },
  // Compared on every ranked stat but support grades, recent form, unit ranks and fantasy points
  scored: (stat) => !stat.infoOnly && !stat.support && stat.format !== 'recent' && stat.format !== 'rank' && stat.key !== 'fantasy',
});
