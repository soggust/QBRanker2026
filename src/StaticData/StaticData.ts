import { StaticPlayerData } from 'app/types';
import games from './games.json';
import subjective from './subjective.json';

// games.json is generated from ESPN box scores by `npm run update-data` — don't edit it by hand.
// subjective.json holds the hand-set scores, keyed by ESPN player id.
type SubjectiveScores = Pick<
  StaticPlayerData,
  'injured' | 'weapons' | 'coaching' | 'oline' | 'defense' | 'responsibility'
> & { name?: string };

const scores = subjective as Record<string, SubjectiveScores>;

// Static Data
export const StaticData: StaticPlayerData[] = games.map((game) => {
  const { name, ...playerScores } = scores[game.id];

  return {
    id: game.id,
    name: name ?? game.name,
    teamLogo: game.teamLogo,
    wins: game.wins,
    losses: game.losses,
    ties: game.ties,
    lastFive: game.lastFive,
    epaPerPlay: game.advanced?.epaPerPlay ?? null,
    cpoe: game.advanced?.cpoe ?? null,
    successRate: game.advanced?.successRate ?? null,
    ...playerScores,
  };
});
