// Filters
export interface Filters {
  recordValue: number;
  compValue: number;
  yardsValue: number;
  passYdValue: number;
  rushYdValue: number;
  ypaValue: number;
  touchdownValue: number;
  passTdValue: number;
  rushTdValue: number;
  turnoverValue: number;
  intValue: number;
  fumLostValue: number;
  ratingValue: number;
  recencyValue: number;
  supportValue: number;
  weaponsValue: number;
  coachingValue: number;
  olineValue: number;
  defenseValue: number;
  responsibilityValue: number;
}

// Players
export interface Player {
  name: string;
  teamLogo: string;
  compPercent: number;
  passYards: number;
  rushYards: number;
  ypa: number;
  passTd: number;
  rushTd: number;
  ints: number;
  fumLost: number;
  rating: number;
  wins: number;
  losses: number;
  ties?: number;
  games: number;
  id: number;
  lastFive: number[];
  injured: boolean;
  weapons: number;
  coaching: number;
  oline: number;
  defense: number;
  responsibility: number;
  outOfDate: boolean;
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
  weapons: number;
  coaching: number;
  oline: number;
  defense: number;
  responsibility: number;
}
