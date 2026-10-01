// Team badges: each row's team logo sits on a disc of the team's primary color. The logos are the
// NHL's versions drawn for a dark background (each era's own: "ATL_19992000-20102011.svg"), keyed here
// by the team code at the front of the file name.
const BADGE: Record<string, string> = {
  ANA: '#111111', // Anaheim Ducks (black: the orange and gold logo)
  ARI: '#8c2633', // Arizona Coyotes
  PHX: '#8c2633', // Phoenix Coyotes
  ATL: '#041e42', // Atlanta Thrashers
  BOS: '#111111', // Boston Bruins
  BUF: '#003087', // Buffalo Sabres
  CGY: '#c8102e', // Calgary Flames
  CAR: '#c8102e', // Carolina Hurricanes
  CHI: '#cf0a2c', // Chicago Blackhawks
  COL: '#6f263d', // Colorado Avalanche
  CBJ: '#002654', // Columbus Blue Jackets
  DAL: '#006847', // Dallas Stars
  DET: '#ce1126', // Detroit Red Wings
  EDM: '#041e42', // Edmonton Oilers
  FLA: '#041e42', // Florida Panthers
  LAK: '#111111', // Los Angeles Kings
  MIN: '#154734', // Minnesota Wild
  MTL: '#af1e2d', // Montreal Canadiens
  NSH: '#041e42', // Nashville Predators (navy: the gold logo)
  NJD: '#ce1126', // New Jersey Devils
  NYI: '#00539b', // New York Islanders
  NYR: '#0038a8', // New York Rangers
  OTT: '#111111', // Ottawa Senators
  PHI: '#f74902', // Philadelphia Flyers
  PIT: '#111111', // Pittsburgh Penguins
  SJS: '#006d75', // San Jose Sharks
  SEA: '#001628', // Seattle Kraken
  STL: '#002f87', // St. Louis Blues
  TBL: '#002868', // Tampa Bay Lightning
  TOR: '#00205b', // Toronto Maple Leafs
  UTA: '#111111', // Utah (black: the mountain logo)
  VAN: '#00205b', // Vancouver Canucks
  VGK: '#333f42', // Vegas Golden Knights
  WSH: '#041e42', // Washington Capitals
  WPG: '#041e42', // Winnipeg Jets
};

// ("assets/NHL_Icons/ATL_19992000-20102011.svg" -> ATL)
const teamKey = (teamLogo: string) => teamLogo.split('/').pop()!.replace(/\.(svg|png)$/, '').split('_')[0];

// The badge color behind a team's logo (a neutral gray for an unknown team)
export function badgeColor(teamLogo: string): string {
  return BADGE[teamKey(teamLogo)] ?? '#3a3a3a';
}

// [primary, secondary] for anything that wants a pair (both the badge color for now)
export function teamColors(teamLogo: string): [string, string] {
  const c = badgeColor(teamLogo);
  return [c, c];
}

// The NFL app draws some logos in white on their badge; the NHL's dark-background logos already read
export function whiteLogo(_teamLogo: string): boolean {
  return false;
}
