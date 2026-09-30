import type { SkillPlayer, SkillPosition } from 'app/positions';
import ALL_PRO from './all-pro.json';
import PRO_BOWL from './pro-bowl.json';

// The major NFL awards per season, shown as badges beside the winner's name (never part of the ranking).
// Kept by hand: no data source we use publishes them. Player awards match the player's name on his
// tab; team awards (Super Bowl, Coach of the Year, and the defensive awards on the Defenses tab)
// match the team's logo name; the Super Bowl's Lombardi goes on every row of the champion, players
// included. A season with no entry (like the one in progress) shows no badges.
// AP All-Pro teams (silver badges) and Pro Bowls (bronze) come from all-pro.json and pro-bowl.json
// (`npm run update-honors`).
export type AwardId =
  | 'mvp'
  | 'opoy'
  | 'oroy'
  | 'cpoy'
  | 'sbmvp'
  | 'sb'
  | 'conf'
  | 'coy'
  | 'dpoy'
  | 'droy'
  | 'ap1'
  | 'ap2'
  | 'pb';

export const AWARD_INFO: Record<AwardId, { name: string; short: string }> = {
  mvp: { name: 'Most Valuable Player', short: 'MVP' },
  opoy: { name: 'Offensive Player of the Year', short: 'OPOY' },
  oroy: { name: 'Offensive Rookie of the Year', short: 'OROY' },
  cpoy: { name: 'Comeback Player of the Year', short: 'CPOY' },
  sbmvp: { name: 'Super Bowl MVP', short: 'SB MVP' },
  // Shown as the Lombardi Trophy (the rank column's trophy); the rest as labeled gold plaques
  sb: { name: 'Super Bowl Champion', short: 'SB Champ' },
  // A silver cup for both conference champions (the Super Bowl's two teams); named per conference
  conf: { name: 'Conference Champion', short: 'Conf Champ' },
  coy: { name: 'Coach of the Year', short: 'COY' },
  dpoy: { name: 'Defensive Player of the Year', short: 'DPOY' },
  droy: { name: 'Defensive Rookie of the Year', short: 'DROY' },
  // Silver plaques
  ap1: { name: 'AP First-Team All-Pro', short: 'AP1' },
  ap2: { name: 'AP Second-Team All-Pro', short: 'AP2' },
  // Bronze plaque
  pb: { name: 'Pro Bowl', short: 'PB' },
};

// AP All-Pro picks per season and tab: the player's name as listed on his tab -> 1st or 2nd team
const allPro = ALL_PRO as Record<string, Partial<Record<SkillPosition, Record<string, number>>>>;
// Pro Bowl selections per season and tab (names as listed on the tab)
const proBowl = PRO_BOWL as Record<string, Partial<Record<SkillPosition, string[]>>>;

// A player award names the winner (or both co-winners); winners who play a position without a tab
// (a linebacker Super Bowl MVP, say) simply get no badge
interface SeasonAwards {
  mvp: string | string[];
  opoy: string | string[];
  oroy: string | string[];
  cpoy: string | string[];
  sbmvp: string | string[];
  // Team logo names (src/assets/NFL_Icons), plus the defensive winners' names for the hover text
  sb: string;
  coy: string;
  dpoy: [player: string, team: string];
  droy: [player: string, team: string];
}

const AWARDS: Record<number, SeasonAwards> = {
  2000: {
    mvp: 'Marshall Faulk', opoy: 'Marshall Faulk', oroy: 'Mike Anderson', cpoy: 'Joe Johnson',
    sbmvp: 'Ray Lewis', sb: 'Ravens', coy: 'Saints',
    dpoy: ['Ray Lewis', 'Ravens'], droy: ['Brian Urlacher', 'Bears'],
  },
  2001: {
    mvp: 'Kurt Warner', opoy: 'Marshall Faulk', oroy: 'Anthony Thomas', cpoy: 'Garrison Hearst',
    sbmvp: 'Tom Brady', sb: 'Patriots', coy: 'Bears',
    dpoy: ['Michael Strahan', 'Giants'], droy: ['Kendrell Bell', 'Steelers'],
  },
  2002: {
    mvp: 'Rich Gannon', opoy: 'Priest Holmes', oroy: 'Clinton Portis', cpoy: 'Tommy Maddox',
    sbmvp: 'Dexter Jackson', sb: 'Bucs', coy: 'Eagles',
    dpoy: ['Derrick Brooks', 'Bucs'], droy: ['Julius Peppers', 'Panthers'],
  },
  2003: {
    mvp: ['Peyton Manning', 'Steve McNair'], opoy: 'Jamal Lewis', oroy: 'Anquan Boldin', cpoy: 'Jon Kitna',
    sbmvp: 'Tom Brady', sb: 'Patriots', coy: 'Patriots',
    dpoy: ['Ray Lewis', 'Ravens'], droy: ['Terrell Suggs', 'Ravens'],
  },
  2004: {
    mvp: 'Peyton Manning', opoy: 'Peyton Manning', oroy: 'Ben Roethlisberger', cpoy: 'Drew Brees',
    sbmvp: 'Deion Branch', sb: 'Patriots', coy: 'Chargers',
    dpoy: ['Ed Reed', 'Ravens'], droy: ['Jonathan Vilma', 'Jets'],
  },
  2005: {
    mvp: 'Shaun Alexander', opoy: 'Shaun Alexander', oroy: 'Cadillac Williams', cpoy: ['Tedy Bruschi', 'Steve Smith'],
    sbmvp: 'Hines Ward', sb: 'Steelers', coy: 'Bears',
    dpoy: ['Brian Urlacher', 'Bears'], droy: ['Shawne Merriman', 'Chargers'],
  },
  2006: {
    mvp: 'LaDainian Tomlinson', opoy: 'LaDainian Tomlinson', oroy: 'Vince Young', cpoy: 'Chad Pennington',
    sbmvp: 'Peyton Manning', sb: 'Colts', coy: 'Saints',
    dpoy: ['Jason Taylor', 'Dolphins'], droy: ['DeMeco Ryans', 'Texans'],
  },
  2007: {
    mvp: 'Tom Brady', opoy: 'Tom Brady', oroy: 'Adrian Peterson', cpoy: 'Greg Ellis',
    sbmvp: 'Eli Manning', sb: 'Giants', coy: 'Patriots',
    dpoy: ['Bob Sanders', 'Colts'], droy: ['Patrick Willis', '49ers'],
  },
  2008: {
    mvp: 'Peyton Manning', opoy: 'Drew Brees', oroy: 'Matt Ryan', cpoy: 'Chad Pennington',
    sbmvp: 'Santonio Holmes', sb: 'Steelers', coy: 'Falcons',
    dpoy: ['James Harrison', 'Steelers'], droy: ['Jerod Mayo', 'Patriots'],
  },
  2009: {
    mvp: 'Peyton Manning', opoy: 'Chris Johnson', oroy: 'Percy Harvin', cpoy: 'Tom Brady',
    sbmvp: 'Drew Brees', sb: 'Saints', coy: 'Bengals',
    dpoy: ['Charles Woodson', 'Packers'], droy: ['Brian Cushing', 'Texans'],
  },
  2010: {
    mvp: 'Tom Brady', opoy: 'Tom Brady', oroy: 'Sam Bradford', cpoy: 'Mike Vick',
    sbmvp: 'Aaron Rodgers', sb: 'Packers', coy: 'Patriots',
    dpoy: ['Troy Polamalu', 'Steelers'], droy: ['Ndamukong Suh', 'Lions'],
  },
  2011: {
    mvp: 'Aaron Rodgers', opoy: 'Drew Brees', oroy: 'Cam Newton', cpoy: 'Matthew Stafford',
    sbmvp: 'Eli Manning', sb: 'Giants', coy: '49ers',
    dpoy: ['Terrell Suggs', 'Ravens'], droy: ['Von Miller', 'Broncos'],
  },
  2012: {
    mvp: 'Adrian Peterson', opoy: 'Adrian Peterson', oroy: 'Robert Griffin III', cpoy: 'Peyton Manning',
    sbmvp: 'Joe Flacco', sb: 'Ravens', coy: 'Colts',
    dpoy: ['J.J. Watt', 'Texans'], droy: ['Luke Kuechly', 'Panthers'],
  },
  2013: {
    mvp: 'Peyton Manning', opoy: 'Peyton Manning', oroy: 'Eddie Lacy', cpoy: 'Philip Rivers',
    sbmvp: 'Malcolm Smith', sb: 'Seahawks', coy: 'Panthers',
    dpoy: ['Luke Kuechly', 'Panthers'], droy: ['Sheldon Richardson', 'Jets'],
  },
  2014: {
    mvp: 'Aaron Rodgers', opoy: 'DeMarco Murray', oroy: 'Odell Beckham Jr.', cpoy: 'Rob Gronkowski',
    sbmvp: 'Tom Brady', sb: 'Patriots', coy: 'Cardinals',
    dpoy: ['J.J. Watt', 'Texans'], droy: ['Aaron Donald', 'Rams'],
  },
  2015: {
    mvp: 'Cam Newton', opoy: 'Cam Newton', oroy: 'Todd Gurley', cpoy: 'Eric Berry',
    sbmvp: 'Von Miller', sb: 'Broncos', coy: 'Panthers',
    dpoy: ['J.J. Watt', 'Texans'], droy: ['Marcus Peters', 'Chiefs'],
  },
  2016: {
    mvp: 'Matt Ryan', opoy: 'Matt Ryan', oroy: 'Dak Prescott', cpoy: 'Jordy Nelson',
    sbmvp: 'Tom Brady', sb: 'Patriots', coy: 'Cowboys',
    dpoy: ['Khalil Mack', 'Raiders'], droy: ['Joey Bosa', 'Chargers'],
  },
  2017: {
    mvp: 'Tom Brady', opoy: 'Todd Gurley', oroy: 'Alvin Kamara', cpoy: 'Keenan Allen',
    sbmvp: 'Nick Foles', sb: 'Eagles', coy: 'Rams',
    dpoy: ['Aaron Donald', 'Rams'], droy: ['Marshon Lattimore', 'Saints'],
  },
  2018: {
    mvp: 'Patrick Mahomes', opoy: 'Patrick Mahomes', oroy: 'Saquon Barkley', cpoy: 'Andrew Luck',
    sbmvp: 'Julian Edelman', sb: 'Patriots', coy: 'Bears',
    dpoy: ['Aaron Donald', 'Rams'], droy: ['Darius Leonard', 'Colts'],
  },
  2019: {
    mvp: 'Lamar Jackson', opoy: 'Michael Thomas', oroy: 'Kyler Murray', cpoy: 'Ryan Tannehill',
    sbmvp: 'Patrick Mahomes', sb: 'Chiefs', coy: 'Ravens',
    dpoy: ['Stephon Gilmore', 'Patriots'], droy: ['Nick Bosa', '49ers'],
  },
  2020: {
    mvp: 'Aaron Rodgers', opoy: 'Derrick Henry', oroy: 'Justin Herbert', cpoy: 'Alex Smith',
    sbmvp: 'Tom Brady', sb: 'Bucs', coy: 'Browns',
    dpoy: ['Aaron Donald', 'Rams'], droy: ['Chase Young', 'Commanders'],
  },
  2021: {
    mvp: 'Aaron Rodgers', opoy: 'Cooper Kupp', oroy: "Ja'Marr Chase", cpoy: 'Joe Burrow',
    sbmvp: 'Cooper Kupp', sb: 'Rams', coy: 'Titans',
    dpoy: ['T.J. Watt', 'Steelers'], droy: ['Micah Parsons', 'Cowboys'],
  },
  2022: {
    mvp: 'Patrick Mahomes', opoy: 'Justin Jefferson', oroy: 'Garrett Wilson', cpoy: 'Geno Smith',
    sbmvp: 'Patrick Mahomes', sb: 'Chiefs', coy: 'Giants',
    dpoy: ['Nick Bosa', '49ers'], droy: ['Sauce Gardner', 'Jets'],
  },
  2023: {
    mvp: 'Lamar Jackson', opoy: 'Christian McCaffrey', oroy: 'C.J. Stroud', cpoy: 'Joe Flacco',
    sbmvp: 'Patrick Mahomes', sb: 'Chiefs', coy: 'Browns',
    dpoy: ['Myles Garrett', 'Browns'], droy: ['Will Anderson Jr.', 'Texans'],
  },
  2024: {
    mvp: 'Josh Allen', opoy: 'Saquon Barkley', oroy: 'Jayden Daniels', cpoy: 'Joe Burrow',
    sbmvp: 'Jalen Hurts', sb: 'Eagles', coy: 'Vikings',
    dpoy: ['Patrick Surtain II', 'Broncos'], droy: ['Jared Verse', 'Rams'],
  },
  2025: {
    mvp: 'Matthew Stafford', opoy: 'Jaxon Smith-Njigba', oroy: 'Tetairoa McMillan', cpoy: 'Christian McCaffrey',
    sbmvp: 'Kenneth Walker III', sb: 'Seahawks', coy: 'Patriots',
    dpoy: ['Myles Garrett', 'Browns'], droy: ['Carson Schwesinger', 'Browns'],
  },
};

// The Super Bowl's losing team each season (the other conference champion), from the nflverse schedule
const SB_RUNNER_UP: Record<number, string> = {
  2000: 'Giants', 2001: 'Rams', 2002: 'Raiders', 2003: 'Panthers', 2004: 'Eagles', 2005: 'Seahawks',
  2006: 'Bears', 2007: 'Patriots', 2008: 'Cardinals', 2009: 'Colts', 2010: 'Steelers', 2011: 'Patriots',
  2012: '49ers', 2013: 'Broncos', 2014: 'Seahawks', 2015: 'Panthers', 2016: 'Falcons', 2017: 'Patriots',
  2018: 'Rams', 2019: '49ers', 2020: 'Chiefs', 2021: 'Bengals', 2022: 'Eagles', 2023: '49ers', 2024: 'Chiefs',
  2025: 'Patriots',
};

// AFC teams (logo names); everyone else is NFC. (Seattle was AFC before 2002, but never in a Super Bowl then.)
const AFC = new Set([
  'Bills', 'Dolphins', 'Patriots', 'Jets', 'Ravens', 'Bengals', 'Browns', 'Steelers',
  'Texans', 'Colts', 'Jaguars', 'Titans', 'Broncos', 'Chiefs', 'Raiders', 'Chargers',
]);

// "2019 NFC Champion (George Halas Trophy)"
function conferenceTitle(season: number, team: string): string {
  return AFC.has(team) ? `${season} AFC Champion (Lamar Hunt Trophy)` : `${season} NFC Champion (George Halas Trophy)`;
}

// Coach of the Year won by someone other than the coach on the team's row: in 2012 the Colts' interim
// coach, while the row is the head coach of record
const COY_NOTES: Record<number, string> = { 2012: 'Bruce Arians (interim coach)' };

export interface AwardWin {
  id: AwardId;
  // Hover text, e.g. "2019 Most Valuable Player" or "2020 Defensive Player of the Year: Aaron Donald"
  title: string;
}

// Letters only, suffixes dropped: "Patrick Mahomes II", "C.J. Stroud" / "C. J. Stroud" and
// "Ja'Marr Chase" compare equal to how they're written elsewhere (same as update-all-pro.mjs)
function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]?\s+(jr|sr|ii|iii|iv)\.?$/, '')
    .replace(/[^a-z]/g, '');
}

// "assets/NFL_Icons/Bills.png" -> "Bills"
function logoName(teamLogo: string): string {
  return teamLogo.split('/').pop()!.replace('.png', '');
}

// A row's awards for the season: player awards on the player tabs, team awards on the team tabs
export function awardsFor(unit: SkillPlayer, position: SkillPosition, season: number): AwardWin[] {
  const win = (id: AwardId, who?: string): AwardWin => ({
    id,
    title: `${season} ${AWARD_INFO[id].name}${who ? `: ${who}` : ''}`,
  });
  const wins: AwardWin[] = [];
  // All-Pro and Pro Bowl after the season's awards
  const allProTeam = allPro[season]?.[position]?.[unit.name];
  const madeProBowl = proBowl[season]?.[position]?.includes(unit.name);
  const withAllPro = () => [
    ...wins,
    ...(allProTeam ? [win(allProTeam === 1 ? 'ap1' : 'ap2')] : []),
    ...(madeProBowl ? [win('pb')] : []),
  ];
  const awards = AWARDS[season];
  if (!awards) return withAllPro();
  const team = logoName(unit.teamLogo);
  // The Lombardi for everyone on the champion (a player by the team he finished the season with),
  // always the first badge; then the conference champions' silver cup (the champion won its
  // conference too)
  if (awards.sb === team) wins.push(win('sb'));
  if (awards.sb === team || SB_RUNNER_UP[season] === team) wins.push({ id: 'conf', title: conferenceTitle(season, team) });
  if (position === 'HC' || position === 'DEF' || position === 'OL') {
    if (position === 'HC' && awards.coy === team) wins.push(win('coy', COY_NOTES[season]));
    if (position === 'DEF' && awards.dpoy[1] === team) wins.push(win('dpoy', awards.dpoy[0]));
    if (position === 'DEF' && awards.droy[1] === team) wins.push(win('droy', awards.droy[0]));
    return wins;
  }
  const name = nameKey(unit.name);
  for (const id of ['mvp', 'opoy', 'oroy', 'cpoy', 'sbmvp'] as const) {
    const winners = ([] as string[]).concat(awards[id]);
    if (winners.some((winner) => nameKey(winner) === name)) wins.push(win(id));
  }
  return withAllPro();
}
