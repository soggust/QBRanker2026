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
  advancedValue: number;
  epaValue: number;
  cpoeValue: number;
  successValue: number;
  fantasyValue: number;
  pressureToSackValue: number;
  badThrowValue: number;
  timeToThrowValue: number;
  adotValue: number;
  aggressivenessValue: number;
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
  defenseOverride?: number;
  coachingOverride?: number;
  outOfDate: boolean;
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
  weapons: number;
  coaching: number;
  oline: number;
  defense: number;
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
  // Starts per team, keyed by team logo path
  starts: Record<string, number>;
  // ESPN season box stats from the nightly update (null: no stats this season yet)
  box: QbBoxStats | null;
  // Hand-set defense grade from subjective.json; otherwise it comes from the Defenses rankings
  defenseOverride?: number;
  // Hand-set coaching grade from subjective.json; otherwise preseason blended with the Head Coaches rankings
  coachingOverride?: number;
}
