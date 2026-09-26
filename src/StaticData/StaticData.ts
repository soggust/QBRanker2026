import { StaticPlayerData } from 'app/types';
import gamesJson from './games.json';
import subjective from './subjective.json';

// games.json is generated from ESPN box scores by `npm run update-data` — don't edit it by hand.
// subjective.json holds the hand-set scores, keyed by ESPN player id.
interface GameData {
  id: number;
  name: string;
  teamLogo: string;
  wins: number;
  losses: number;
  ties: number;
  lastFive: number[];
  starts: Record<string, number>;
  advanced: {
    epaPerPlay: number | null;
    cpoe: number | null;
    successRate: number | null;
    fantasyStd: number;
    receptions: number;
  } | null;
}

type SubjectiveScores = Pick<
  StaticPlayerData,
  'injured' | 'weapons' | 'coaching' | 'oline' | 'defense' | 'responsibility'
> & { name?: string };

const games = gamesJson as unknown as GameData[];
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
    fantasyStd: game.advanced?.fantasyStd ?? null,
    receptions: game.advanced?.receptions ?? 0,
    starts: game.starts,
    ...playerScores,
  };
});
