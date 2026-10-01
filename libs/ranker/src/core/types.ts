// A QB's play-by-play stats (the ones the Garbage Time Stats setting can filter)
export interface QbPlayByPlay {
  epaPerPlay: number | null;
  cpoe: number | null;
  successRate: number | null;
}

// A QB's ESPN season box stats (the update script fetches them each night with the results)
export interface QbBoxStats {
  games: number;
  fumLost: number;
  passYards: number;
  passTd: number;
  ints: number;
  compPercent: number;
  ypa: number;
  rating: number;
  rushYards: number;
  rushTd: number;
}

// Static Player Data
export interface StaticPlayerData {
  name: string;
  teamLogo: string;
  wins: number;
  losses: number;
  ties?: number;
  id: number;
  lastFive: number[];
  injured: boolean;
  // ESPN injury report status (Out, Doubtful, Injured Reserve)
  injuryStatus?: string;
  responsibility: number;
  epaPerPlay: number | null;
  cpoe: number | null;
  successRate: number | null;
  fantasyStd: number | null;
  receptions: number;
  pressureToSack: number | null;
  badThrowPct: number | null;
  timeToThrow: number | null;
  adot: number | null;
  aggressiveness: number | null;
  // EPA / CPOE / success without garbage time (null: not in the data yet)
  competitive: QbPlayByPlay | null;
  // Starts per team, keyed by team logo path
  starts: Record<string, number>;
  // ESPN season box stats from the nightly update (null: no stats this season yet)
  box: QbBoxStats | null;
}
