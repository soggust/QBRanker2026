// Team logos as they looked in a given season. Each franchise's earlier primary logos (from the logo
// history at sportslogos.net, under the names it played as: the Seattle SuperSonics, New Jersey Nets,
// Vancouver Grizzlies, Charlotte Bobcats, New Orleans Hornets...), for the seasons before its current
// one: [first season, last season, file] (a season by the year it ends in), drawn from
// assets/NBA_Icons/eras/<code>-<file>.png (the file is named for the season the logo came in). A
// season no era covers gets the team's current logo.
const LOGO_ERAS: Record<string, [number, number, number][]> = {
  ATL: [[2001, 2007, 1996], [2008, 2015, 2008], [2016, 2020, 2016]],
  // New Jersey Nets, Brooklyn Nets
  BRK: [[2001, 2012, 1998], [2013, 2024, 2013]],
  // Charlotte Hornets, Charlotte Bobcats
  CHO: [[2001, 2002, 1989], [2005, 2007, 2005], [2008, 2012, 2008], [2013, 2014, 2013]],
  CLE: [[2001, 2003, 1995], [2004, 2010, 2004], [2011, 2017, 2011], [2018, 2022, 2018]],
  DAL: [[2001, 2001, 1994], [2002, 2017, 2002]],
  DEN: [[2001, 2003, 1994], [2004, 2008, 2004], [2009, 2018, 2009]],
  DET: [[2001, 2001, 1997], [2002, 2005, 2002], [2006, 2017, 2006]],
  GSW: [[2001, 2010, 1998], [2011, 2019, 2011]],
  HOU: [[2001, 2003, 1996], [2004, 2019, 2004], [2020, 2026, 2020]],
  IND: [[2001, 2005, 1991], [2006, 2017, 2006], [2018, 2025, 2018]],
  LAC: [[2001, 2010, 1985], [2011, 2015, 2011], [2016, 2018, 2016], [2019, 2024, 2019]],
  LAL: [[2001, 2017, 2000], [2018, 2023, 2018]],
  // Vancouver Grizzlies, Memphis Grizzlies
  MEM: [[2001, 2001, 1996], [2002, 2004, 2002], [2005, 2018, 2005]],
  MIL: [[2001, 2006, 1994], [2007, 2015, 2007]],
  MIN: [[2001, 2008, 1997], [2009, 2017, 2009], [2018, 2026, 2018]],
  // New Orleans Hornets, NO/Oklahoma City Hornets, New Orleans Pelicans
  NOP: [[2003, 2005, 2003], [2006, 2007, 2006], [2008, 2008, 2008], [2009, 2013, 2009], [2014, 2023, 2014]],
  NYK: [[2001, 2011, 1996], [2012, 2022, 2012], [2023, 2023, 2023]],
  // Seattle Supersonics, Oklahoma City Thunder
  OKC: [[2001, 2001, 1996], [2002, 2008, 2002]],
  ORL: [[2001, 2010, 2001], [2011, 2025, 2011]],
  PHI: [[2001, 2009, 1998], [2010, 2015, 2010]],
  PHO: [[2001, 2013, 2001]],
  POR: [[2001, 2002, 1991], [2003, 2003, 2003], [2004, 2004, 2004], [2005, 2017, 2005]],
  SAC: [[2001, 2016, 1995]],
  SAS: [[2001, 2002, 1990], [2003, 2017, 2003]],
  TOR: [[2001, 2008, 1996], [2009, 2015, 2009], [2016, 2020, 2016]],
  UTA: [[2001, 2004, 1997], [2005, 2010, 2005], [2011, 2016, 2011], [2017, 2022, 2017], [2023, 2025, 2023]],
  WAS: [[2001, 2007, 1998], [2008, 2011, 2008], [2012, 2015, 2012]],
};

// "assets/NBA_Icons/OKC.svg", 2005 -> "assets/NBA_Icons/eras/OKC-2002.png" (the SuperSonics' logo that season)
export function logoForSeason(teamLogo: string, season: number): string {
  const team = teamLogo.split('/').pop()!.replace('.svg', '');
  const eras = LOGO_ERAS[team] ?? [];
  for (let i = eras.length - 1; i >= 0; i--) {
    const [from, to, file] = eras[i];
    if (season >= from && season <= to) return `assets/NBA_Icons/eras/${team}-${file}.png`;
  }
  return teamLogo;
}
