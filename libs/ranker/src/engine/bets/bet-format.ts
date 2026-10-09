// How the Bets page and the Algorithm desk write their numbers, and ESPN's pictures they show (pure: tested
// under Node, tests/model-desk.test.mjs)

// (American odds with their sign: "+150", "-110")
export const americanOdds = (american: number): string => (american > 0 ? `+${american}` : String(american));

// (a share as a percent, a dash for none: "52.4%")
export const pct = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`);

// (units won or lost, signed: "+1.82u")
export const units = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}u`;

// (a size with its sign: "+0.4")
export const signed = (v: number): string => `${v > 0 ? '+' : ''}${v}`;

// (a number to a few places, a dash for none)
export const num = (v: number | null | undefined, digits = 3): string => (v === null || v === undefined ? '-' : v.toFixed(digits));

const ESPN_IMG = 'https://a.espncdn.com/combiner/i?img=/i';

// (a team's logo, small, by its abbreviation: the version for a dark background, where a navy wordmark like
// the Capitals' would vanish on the board; hideImage falls back to the plain one)
export const teamLogo = (sport: string, abbr: string): string => `${ESPN_IMG}/teamlogos/${sport}/500-dark/${abbr.toLowerCase()}.png&w=40&h=40`;

// (a player's ESPN headshot, by his ESPN id)
export const headshot = (sport: string, athlete: string | number | null | undefined): string => `${ESPN_IMG}/headshots/${sport}/players/full/${athlete}.png&w=96&h=70`;

// (a league's logo)
export const leagueLogo = (sport: string): string => `https://a.espncdn.com/i/teamlogos/leagues/500/${sport}.png`;

// (an image ESPN doesn't have: a dark-background logo falls back to the plain one, anything else steps out of
// the way, keeping its space)
export function hideImage(event: Event): void {
  const img = event.target as HTMLImageElement;
  if (img.src.includes('/500-dark/')) img.src = img.src.replace('/500-dark/', '/500/');
  else img.style.visibility = 'hidden';
}
