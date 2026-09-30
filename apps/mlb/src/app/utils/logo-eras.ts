// Team logos as they looked in a given season: each team's earlier cap logos (cut from the cap
// drawings in the logo history at sportslogos.net), for the seasons before its current cap: [first
// season, last season, file], drawn from assets/MLB_Icons/eras/<team id>-<file>.png (the file is
// named for the year the cap came in). Where a team wore more than one cap, the longest-running one
// (its home cap). A season no era covers gets the team's current logo.
const LOGO_ERAS: Record<string, [number, number, number][]> = {
  // Angels
  108: [[2000, 2001, 1997]],
  // Diamondbacks (2020-24: the black cap with the red A, not the sand alternate that ran as long)
  109: [[2000, 2006, 1998], [2007, 2015, 2007], [2016, 2019, 2016], [2020, 2024, 2020]],
  // Orioles
  110: [[2000, 2004, 1999]],
  // Reds
  113: [[2000, 2012, 1999]],
  // Guardians / Indians
  114: [[2000, 2002, 1986], [2003, 2007, 2002], [2008, 2021, 2008]],
  // Rockies
  115: [[2000, 2016, 1993]],
  // Astros
  117: [[2000, 2012, 2000]],
  // Royals
  118: [[2000, 2001, 1969], [2002, 2025, 2002]],
  // Dodgers
  119: [[2000, 2011, 1972]],
  // Nationals / Expos
  120: [[2000, 2004, 1992]],
  // Athletics
  133: [[2000, 2024, 1993]],
  // Padres
  135: [[2000, 2003, 1991], [2004, 2019, 2004]],
  // Cardinals
  138: [[2000, 2019, 1964]],
  // Rays / Devil Rays
  139: [[2000, 2000, 1998], [2001, 2005, 2001], [2006, 2007, 2004]],
  // Blue Jays
  141: [[2000, 2002, 1997], [2003, 2003, 2001], [2004, 2011, 2004], [2012, 2019, 2012]],
  // Twins
  142: [[2000, 2022, 2000]],
  // Braves
  144: [[2000, 2017, 1987]],
  // Marlins
  146: [[2000, 2011, 1993], [2012, 2018, 2012]],
  // Brewers
  158: [[2000, 2019, 2000]],
};

// "assets/MLB_Icons/120.svg", 2003 -> "assets/MLB_Icons/eras/120-1992.png" (the Expos' cap that season)
export function logoForSeason(teamLogo: string, season: number): string {
  const team = teamLogo.split('/').pop()!.replace('.svg', '');
  const eras = LOGO_ERAS[team] ?? [];
  for (let i = eras.length - 1; i >= 0; i--) {
    const [from, to, file] = eras[i];
    if (season >= from && season <= to) return `assets/MLB_Icons/eras/${team}-${file}.png`;
  }
  return teamLogo;
}
