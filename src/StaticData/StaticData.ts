import { StaticPlayerData } from 'app/types';
import gamesJson from './games.json';
import subjective from './subjective.json';
import teamGradesJson from './team-grades.json';

// games.json is generated from ESPN box scores by `npm run update-data` — don't edit it by hand.
// team-grades.json holds hand-set team grades (0 = F ... 12 = A+), keyed by team logo name.
// subjective.json holds hand-set per-QB scores, keyed by ESPN player id.
interface GameData {
  id: number;
  name: string;
  teamLogo: string;
  wins: number;
  losses: number;
  ties: number;
  lastFive: number[];
  starts: Record<string, number>;
  // From ESPN's injury report: Out, Doubtful or Injured Reserve
  injured: boolean;
  advanced: {
    epaPerPlay: number | null;
    cpoe: number | null;
    successRate: number | null;
    fantasyStd: number;
    receptions: number;
    pressureToSack: number | null;
    badThrowPct: number | null;
    timeToThrow: number | null;
    adot: number | null;
    aggressiveness: number | null;
  } | null;
}

export interface TeamGrades {
  weapons: number;
  oline: number;
  coaching: number;
}

// Per-QB scores. Team grades, defense (normally from the Defenses rankings) and injured
// (normally from ESPN's injury report) can be overridden here for a single QB.
type SubjectiveScores = Pick<StaticPlayerData, 'responsibility'> &
  Partial<TeamGrades> & { name?: string; defense?: number; injured?: boolean };

const games = gamesJson as unknown as GameData[];
const scores = subjective as Record<string, SubjectiveScores>;
const teamGrades = teamGradesJson as Record<string, TeamGrades>;

// "../assets/NFL_Icons/Bills.png" -> "Bills"
export function teamKey(teamLogo: string): string {
  return teamLogo.split('/').pop()!.replace('.png', '');
}

// Team grades for a logo; average (C, 6) if the team is missing
export function gradesForTeam(teamLogo: string): TeamGrades {
  return teamGrades[teamKey(teamLogo)] ?? { weapons: 6, oline: 6, coaching: 6 };
}

// Static Data
export const StaticData: StaticPlayerData[] = games.map((game) => {
  const { name, defense, injured, ...playerScores } = scores[game.id];

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
    pressureToSack: game.advanced?.pressureToSack ?? null,
    badThrowPct: game.advanced?.badThrowPct ?? null,
    timeToThrow: game.advanced?.timeToThrow ?? null,
    adot: game.advanced?.adot ?? null,
    aggressiveness: game.advanced?.aggressiveness ?? null,
    starts: game.starts,
    injured: injured ?? game.injured ?? false,
    // Placeholder until the Defenses rankings grade the team
    defense: defense ?? 6,
    defenseOverride: defense,
    ...gradesForTeam(game.teamLogo),
    ...playerScores,
  };
});
