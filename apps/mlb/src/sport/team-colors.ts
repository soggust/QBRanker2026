// Team badges: each row's team logo sits on a disc of a team color. The logos are MLB's "cap on dark"
// marks (drawn for a dark background), so each team's badge is a dark team color the mark reads on.
// Keyed by the MLB team id in the logo's file name ("assets/MLB_Icons/112.svg" -> 112).
const BADGE: Record<string, string> = {
  108: '#862633', // Angels (red, deepened so the white-edged A reads)
  109: '#30ced8', // D-backs (teal, their Sonoran accent, for the red A)
  110: '#27251f', // Orioles
  111: '#0c2340', // Red Sox
  112: '#0e3386', // Cubs
  113: '#c6011f', // Reds (white C on their red)
  114: '#00385d', // Guardians
  115: '#33006f', // Rockies
  116: '#0c2340', // Tigers
  117: '#002d62', // Astros
  118: '#004687', // Royals
  119: '#005a9c', // Dodgers
  120: '#14225a', // Nationals
  121: '#002d72', // Mets
  133: '#003831', // Athletics
  134: '#27251f', // Pirates
  135: '#2f241d', // Padres
  136: '#0c2c56', // Mariners
  137: '#27251f', // Giants
  138: '#0c2340', // Cardinals
  139: '#092c5c', // Rays
  140: '#003278', // Rangers
  141: '#134a8e', // Blue Jays
  142: '#002b5c', // Twins
  143: '#e81828', // Phillies (their red, the hero's: the blue badge read as another team's)
  144: '#13274f', // Braves
  145: '#27251f', // White Sox
  146: '#000000', // Marlins
  147: '#0c2340', // Yankees
  158: '#12284b', // Brewers
};

const teamKey = (teamLogo: string) => teamLogo.split('/').pop()!.replace(/\.(svg|png)$/, '');

// The badge color behind a team's logo (a neutral gray for an unknown team)
export function badgeColor(teamLogo: string): string {
  return BADGE[teamKey(teamLogo)] ?? '#3a3a3a';
}

// [primary, secondary] for anything that wants a pair (both the badge color for now)
export function teamColors(teamLogo: string): [string, string] {
  const c = badgeColor(teamLogo);
  return [c, c];
}

// The NFL app draws some logos in white on their badge; MLB's cap marks are already made for a dark
// background, so none are
export function whiteLogo(_teamLogo: string): boolean {
  return false;
}
