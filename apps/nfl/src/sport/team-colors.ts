// Team colors (primary, secondary) from ESPN's teams API, keyed by team logo name
const TEAM_COLORS: Record<string, [string, string]> = {
  '49ers': ['#aa0000', '#b3995d'],
  Bears: ['#0b1c3a', '#e64100'],
  Bengals: ['#fb4f14', '#000000'],
  Bills: ['#00338d', '#d50a0a'],
  Broncos: ['#0a2343', '#fc4c02'],
  Browns: ['#472a08', '#ff3c00'],
  Bucs: ['#bd1c36', '#3e3a35'],
  Cardinals: ['#a40227', '#ffffff'],
  Chargers: ['#0080c6', '#ffc20e'],
  Chiefs: ['#e31837', '#ffb612'],
  Colts: ['#003b75', '#ffffff'],
  Commanders: ['#5a1414', '#ffb612'],
  Cowboys: ['#002a5c', '#b0b7bc'],
  Dolphins: ['#008e97', '#fc4c02'],
  Eagles: ['#06424d', '#000000'],
  Falcons: ['#a71930', '#000000'],
  Giants: ['#003c7f', '#c9243f'],
  Jaguars: ['#007487', '#d7a22a'],
  Jets: ['#115740', '#ffffff'],
  Lions: ['#0076b6', '#bbbbbb'],
  Packers: ['#204e32', '#ffb612'],
  Panthers: ['#0085ca', '#000000'],
  Patriots: ['#002a5c', '#c60c30'],
  Raiders: ['#000000', '#a5acaf'],
  Rams: ['#003594', '#ffd100'],
  Ravens: ['#29126f', '#000000'],
  Saints: ['#d3bc8d', '#000000'],
  Seahawks: ['#002a5c', '#69be28'],
  Steelers: ['#000000', '#ffb612'],
  Texans: ['#021018', '#eb0028'],
  Titans: ['#4495d2', '#001532'],
  Vikings: ['#4f2683', '#ffc62f'],
};

// Logos mostly drawn in their own primary color (half or more of the logo within a close match,
// plus a few picked by eye), which would disappear on a primary-color badge, so their badge uses
// the secondary color
const BADGE_ON_SECONDARY = new Set([
  'Cowboys',
  'Colts',
  'Jets',
  'Commanders',
  'Lions',
  'Raiders',
  'Bills',
  'Bucs',
  '49ers',
  'Titans',
  'Cardinals',
  'Saints',
  'Bengals',
  'Ravens',
]);

// Logos shown in white on their primary-color badge (the way the team itself uses them)
const WHITE_LOGOS = new Set(['Giants']);

const teamKey = (teamLogo: string) => teamLogo.split('/').pop()!.replace('.png', '');

// "assets/NFL_Icons/Bills.png" -> ["#00338d", "#d50a0a"] (neutral grays for an unknown team)
export function teamColors(teamLogo: string): [string, string] {
  return TEAM_COLORS[teamKey(teamLogo)] ?? ['#444444', '#222222'];
}

// The color of the badge behind a team's logo: primary, unless the logo would blend into it
export function badgeColor(teamLogo: string): string {
  const [primary, secondary] = teamColors(teamLogo);
  return BADGE_ON_SECONDARY.has(teamKey(teamLogo)) ? secondary : primary;
}

// Whether the team's logo is drawn in white on its badge
export function whiteLogo(teamLogo: string): boolean {
  return WHITE_LOGOS.has(teamKey(teamLogo));
}
