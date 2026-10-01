// Team badges: each row's team logo sits on a disc of the team's primary color (ESPN's team colors).
// The logos are the NBA's versions drawn for a dark background, which read on every primary but
// Toronto's. Keyed by the franchise's code in the logo's file name ("assets/NBA_Icons/BOS.svg" -> BOS).
const BADGE: Record<string, string> = {
  ATL: '#c8102e', // Atlanta Hawks
  BOS: '#008348', // Boston Celtics
  BRK: '#000000', // Brooklyn Nets
  CHI: '#ce1141', // Chicago Bulls
  CHO: '#008ca8', // Charlotte Hornets
  CLE: '#860038', // Cleveland Cavaliers
  DAL: '#0064b1', // Dallas Mavericks
  DEN: '#0e2240', // Denver Nuggets
  DET: '#1d428a', // Detroit Pistons
  GSW: '#fdb927', // Golden State Warriors
  HOU: '#ce0e2d', // Houston Rockets
  IND: '#0c2340', // Indiana Pacers
  LAC: '#12173f', // LA Clippers
  LAL: '#552583', // Los Angeles Lakers
  MEM: '#5d76a9', // Memphis Grizzlies
  MIA: '#98002e', // Miami Heat
  MIL: '#00471b', // Milwaukee Bucks
  MIN: '#266092', // Minnesota Timberwolves
  NOP: '#0a2240', // New Orleans Pelicans
  NYK: '#1d428a', // New York Knicks
  OKC: '#007ac1', // Oklahoma City Thunder
  ORL: '#0150b5', // Orlando Magic
  PHI: '#1d428a', // Philadelphia 76ers
  PHO: '#29127a', // Phoenix Suns
  POR: '#e03a3e', // Portland Trail Blazers
  SAC: '#5a2d81', // Sacramento Kings
  SAS: '#000000', // San Antonio Spurs
  TOR: '#000000', // Toronto Raptors (black: the red logo on their red would disappear)
  UTA: '#4e008e', // Utah Jazz
  WAS: '#e31837', // Washington Wizards
};

// ("assets/NBA_Icons/eras/OKC-2001.png", an old logo, -> OKC)
const teamKey = (teamLogo: string) => teamLogo.split('/').pop()!.replace(/\.(svg|png)$/, '').replace(/-\d{4}$/, '');

// The badge color behind a team's logo (a neutral gray for an unknown team)
export function badgeColor(teamLogo: string): string {
  return BADGE[teamKey(teamLogo)] ?? '#3a3a3a';
}

// [primary, secondary] for anything that wants a pair (both the badge color for now)
export function teamColors(teamLogo: string): [string, string] {
  const c = badgeColor(teamLogo);
  return [c, c];
}

// The NFL app draws some logos in white on their badge; the NBA's dark-background logos already read
export function whiteLogo(_teamLogo: string): boolean {
  return false;
}
