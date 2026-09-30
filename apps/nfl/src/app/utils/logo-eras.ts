// Team logos as they looked in a given season. Each team's earlier primary logos (from the logo history
// at sportslogos.net), for the seasons before its current one: [first season, last season, file],
// drawn from assets/NFL_Icons/eras/<Team>-<file>.png (the file is named for the year the logo came in,
// which can be before 2000). A season no era covers gets the team's current logo. Where two eras
// overlap (a mid-era redraw), the later one wins.
const LOGO_ERAS: Record<string, [number, number, number][]> = {
  '49ers': [[2000, 2001, 1996], [2002, 2004, 2002], [2005, 2008, 2005]],
  Bears: [[2000, 2001, 1997], [2002, 2022, 2002]],
  Bengals: [[2000, 2003, 1997], [2002, 2003, 2002], [2004, 2020, 2004]],
  Broncos: [[2000, 2001, 1999]],
  Browns: [[2000, 2001, 1999], [2002, 2005, 2002], [2006, 2006, 2006], [2007, 2014, 2007], [2015, 2023, 2015]],
  Bucs: [[2000, 2013, 1997], [2014, 2019, 2014]],
  Cardinals: [[2000, 2004, 1994]],
  Chargers: [[2000, 2001, 1988], [2002, 2006, 2002], [2007, 2016, 2007], [2017, 2019, 2017]],
  Colts: [[2000, 2001, 1997], [2002, 2003, 2002]],
  Commanders: [[2000, 2019, 1983], [2020, 2021, 2020]],
  Cowboys: [[2000, 2001, 1997]],
  Dolphins: [[2000, 2001, 1997], [2002, 2012, 2002], [2013, 2017, 2013]],
  Falcons: [[2000, 2002, 1989]],
  Jaguars: [[2000, 2001, 1995], [2002, 2012, 2002]],
  Jets: [[2000, 2018, 1998], [2019, 2023, 2019]],
  Lions: [[2000, 2001, 1997], [2002, 2002, 2002], [2003, 2008, 2003], [2009, 2016, 2009]],
  Panthers: [[2000, 2011, 1995]],
  Raiders: [[2000, 2019, 1995]],
  Rams: [[2000, 2015, 2000], [2016, 2016, 2016], [2017, 2019, 2017], [2020, 2025, 2020]],
  Saints: [[2000, 2001, 2000], [2002, 2011, 2002], [2012, 2016, 2012]],
  Seahawks: [[2000, 2001, 1976], [2002, 2008, 2002], [2009, 2011, 2009]],
  Steelers: [[2000, 2001, 1969]],
  Texans: [[2002, 2023, 2002]],
  Titans: [[2000, 2001, 1999], [2002, 2025, 2002]],
  Vikings: [[2000, 2001, 1997], [2002, 2009, 2002], [2010, 2012, 2010]],
};

// "assets/NFL_Icons/Rams.png", 2010 -> "assets/NFL_Icons/eras/Rams-2000.png" (the team's logo that season)
export function logoForSeason(teamLogo: string, season: number): string {
  const team = teamLogo.split('/').pop()!.replace('.png', '');
  const eras = LOGO_ERAS[team] ?? [];
  for (let i = eras.length - 1; i >= 0; i--) {
    const [from, to, file] = eras[i];
    if (season >= from && season <= to) return `assets/NFL_Icons/eras/${team}-${file}.png`;
  }
  return teamLogo;
}
