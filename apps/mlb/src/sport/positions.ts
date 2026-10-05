import type { StatBasis, StatDef, StatGroup, StatGroupId } from '@ranker/engine/sport';
import { SKILL_PRESETS } from '@sport/skill-presets';

export type { StatBasis, StatGroupId } from '@ranker/engine/sport';

// The MLB tabs: teams (first, and where the app opens), hitters by primary position (outfielders
// together, DH for full-time designated hitters and two-way players' bats), and pitchers by role
export type Position = 'TM' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH' | 'SP' | 'RP';
// Every tab uses the same config-driven table, sidebar and scoring below
export type SkillPosition = Position;

export const POSITIONS: Position[] = ['TM', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'];

export const PITCHER_TABS: Position[] = ['SP', 'RP'];
export const isPitcherTab = (position: Position) => PITCHER_TABS.includes(position);

// Keys of the stats object in skill-players.json (scripts/update-data.mjs)
export type SkillStatKey =
  // Both: FanGraphs-style WAR from the MLB Stats API
  | 'war'
  // Hitters
  | 'pa'
  | 'homeRuns'
  | 'rbi'
  | 'runs'
  | 'stolenBases'
  | 'hits'
  | 'avg'
  | 'obp'
  | 'slg'
  | 'bbPct'
  | 'kPct'
  | 'wrcPlus'
  | 'woba'
  | 'defRuns'
  | 'bsr'
  | 'xwoba'
  | 'barrelPct'
  | 'hardHitPct'
  | 'sprintSpeed'
  | 'fieldingPct'
  | 'rangeFactor'
  | 'oaa'
  // Pitchers
  | 'gamesStarted'
  | 'wins'
  | 'losses'
  | 'ties'
  | 'winPct'
  | 'saves'
  | 'holds'
  | 'ip'
  | 'era'
  | 'whip'
  | 'strikeOuts'
  | 'kbbPct'
  | 'hr9'
  | 'fip'
  | 'xfip'
  | 'xera'
  | 'xwobaAllowed'
  | 'whiffPct'
  | 'hardHitAllowed'
  | 'barrelAllowed'
  // Support grades (0 = F ... 12 = A+, see scripts/update-data.mjs)
  | 'lineup'
  | 'defense'
  | 'park'
  // Teams (scripts/update-data.mjs): postseason wins, run differential per game, the offense's and
  // defense's league ranks, team OPS, fielding runs, wins against the run differential, the park factor,
  // and roster grades from the position tabs' rankings (engine/roster-grades)
  | 'playoffWins'
  | 'runDiff'
  | 'offRank'
  | 'defRank'
  | 'ops'
  | 'fieldingRuns'
  | 'pythDiff'
  | 'parkFactor'
  | 'hitters'
  | 'rotation'
  | 'bullpen';

// Columns worked out in the app rather than read from the data
export type SkillColumnKey = SkillStatKey | 'games' | 'recent';

// How counting stats (home runs, strikeouts...) are shown and ranked: season totals, per game, or at
// a full season's pace (see PACE_GAMES). Per Game and the pace rank the same; they only read
// differently.
export const STAT_BASIS_LABELS: Record<StatBasis, string> = {
  season: 'Season Totals',
  perGame: 'Per Game',
  pace17: 'Full-Season Pace',
};

// A full season, in each tab's games: 162 for hitters, 32 starts for a starter, 65 appearances for a
// reliever
export const PACE_GAMES: Record<Position, number> = {
  TM: 162,
  C: 162,
  '1B': 162,
  '2B': 162,
  '3B': 162,
  SS: 162,
  OF: 162,
  DH: 162,
  SP: 32,
  RP: 65,
};

export interface SkillPlayer {
  id: number | null;
  gsisId: string;
  name: string;
  teamLogo: string;
  // The team's name (a traded player's last team)
  teamName?: string | null;
  games: number;
  // null when a data source doesn't cover the player (shown as "-")
  stats: Record<SkillStatKey, number | null>;
  // From the MLB injured list (this season only)
  injured?: boolean;
  injuryStatus?: string;
  // Badges: mvp, cy, roy, gg (Gold Glove), ss (Silver Slugger), as (All-Star)
  awards?: string[];
}

// A player's stat (the engine passes the sport's settings; baseball has none that change a value)
export function unitStat(unit: SkillPlayer, key: SkillStatKey, _settings?: unknown): number | null {
  return unit.stats[key] ?? null;
}

export type SkillStat = StatDef<SkillColumnKey>;

// Stat names written out in full (label hover text)
export const STAT_NAMES: Partial<Record<SkillColumnKey, string>> = {
  war: 'Wins Above Replacement',
  pa: 'Plate Appearances',
  homeRuns: 'Home Runs',
  rbi: 'Runs Batted In',
  runs: 'Runs Scored',
  stolenBases: 'Stolen Bases',
  avg: 'Batting Average',
  obp: 'On-Base Percentage',
  slg: 'Slugging Percentage',
  bbPct: 'Walk Rate',
  kPct: 'Strikeout Rate',
  wrcPlus: 'Weighted Runs Created Plus (100 = league average)',
  woba: 'Weighted On-Base Average',
  defRuns: 'Defensive Runs Above Average',
  bsr: 'Baserunning Runs Above Average',
  xwoba: 'Expected wOBA (Statcast)',
  barrelPct: 'Barrels per Batted Ball',
  hardHitPct: 'Hard-Hit Rate (95+ mph)',
  sprintSpeed: 'Sprint Speed (ft/sec)',
  fieldingPct: 'Fielding Percentage',
  rangeFactor: 'Range Factor (min 50 innings)',
  oaa: 'Outs Above Average (Statcast)',
  gamesStarted: 'Games Started',
  winPct: 'Win-Loss Record',
  saves: 'Saves',
  holds: 'Holds',
  ip: 'Innings Pitched',
  era: 'Earned Run Average',
  whip: 'Walks + Hits per Inning Pitched',
  strikeOuts: 'Strikeouts',
  kbbPct: 'Strikeout Rate minus Walk Rate',
  hr9: 'Home Runs Allowed per 9 Innings',
  fip: 'Fielding Independent Pitching',
  xfip: 'Expected FIP (league-average home run rate)',
  xera: 'Expected ERA (Statcast)',
  xwobaAllowed: 'Expected wOBA Allowed (Statcast)',
  whiffPct: 'Whiffs per Swing',
  hardHitAllowed: 'Hard-Hit Rate Allowed (95+ mph)',
  barrelAllowed: 'Barrels Allowed per Batted Ball',
  lineup: 'Lineup Around Him (the rest of his lineup)',
  defense: 'Defense Behind Him',
  park: 'Home Park',
};

// Per-game column labels, when Stat Totals is on Per Game
export const PER_GAME_LABELS: Partial<Record<SkillColumnKey, string>> = {
  war: 'WAR / Game',
  homeRuns: 'HR / Game',
  rbi: 'RBI / Game',
  runs: 'Runs / Game',
  stolenBases: 'SB / Game',
  defRuns: 'Def / Game',
  bsr: 'BsR / Game',
  saves: 'SV / Game',
  holds: 'HLD / Game',
  ip: 'IP / Game',
  strikeOuts: 'K / Game',
};

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
// 'default' (everything at 50), or a preset key from SKILL_PRESETS for the position
export type SkillPreset = string;

// Games played: the first column on every tab, for sample-size context
const GAMES_STAT: SkillStat = {
  key: 'games',
  label: 'Games',
  description: 'Games played (for context; not part of the ranking)',
  kind: 'efficiency',
  format: 'int',
  infoOnly: true,
};

const WAR_STAT: SkillStat = {
  key: 'war',
  label: 'WAR',
  description: 'Wins above a replacement-level player: the all-in-one value stat',
  kind: 'volume',
  format: 'dec1',
};

// Support grades: the situation around a player, graded F to A+ across the league. Better support
// counts slightly against him (credit for doing more with less).
const LINEUP_STAT: SkillStat = {
  key: 'lineup',
  label: 'Lineup',
  description: "The rest of his team's lineup (his teammates' batting runs per plate appearance, without him)",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};
const HITTER_PARK_STAT: SkillStat = {
  key: 'park',
  label: 'Stadium',
  name: 'Home Park (for hitters)',
  description: 'How friendly his home park is to hitters (Baseball Savant park factors, three-year average)',
  kind: 'efficiency',
  format: 'grade',
  support: true,
};
const DEFENSE_STAT: SkillStat = {
  key: 'defense',
  label: 'Defense',
  description: "His team's fielding behind him (fielding runs saved)",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};
const PITCHER_PARK_STAT: SkillStat = {
  ...HITTER_PARK_STAT,
  name: 'Home Park (for pitchers)',
  description: 'How friendly his home park is to pitchers (Baseball Savant park factors, three-year average)',
};

// Hitters (every position tab has the same columns)
const HITTER_STATS: SkillStat[] = [
  GAMES_STAT,
  { key: 'pa', label: 'PA', description: 'Plate appearances (for context; not part of the ranking)', kind: 'volume', format: 'int', infoOnly: true },
  WAR_STAT,
  { key: 'avg', label: 'AVG', description: 'Batting average', kind: 'efficiency', format: 'avg3' },
  { key: 'homeRuns', label: 'HR', description: 'Home runs', kind: 'volume', format: 'int' },
  { key: 'rbi', label: 'RBI', description: 'Runs batted in', kind: 'volume', format: 'int' },
  { key: 'runs', label: 'Runs', description: 'Runs scored', kind: 'volume', format: 'int' },
  { key: 'stolenBases', label: 'SB', description: 'Stolen bases', kind: 'volume', format: 'int' },
  { key: 'obp', label: 'OBP', description: 'On-base percentage', kind: 'efficiency', format: 'avg3' },
  { key: 'slg', label: 'SLG', description: 'Slugging percentage', kind: 'efficiency', format: 'avg3' },
  { key: 'bbPct', label: 'BB %', description: 'Walks per plate appearance', kind: 'efficiency', format: 'pct' },
  { key: 'kPct', label: 'K %', description: 'Strikeouts per plate appearance (lower is better)', kind: 'efficiency', format: 'pct', negative: true },
  { key: 'wrcPlus', label: 'wRC+', description: 'Runs created per plate appearance, park and league adjusted (100 = average)', kind: 'efficiency', format: 'int' },
  { key: 'xwoba', label: 'xwOBA', description: 'Expected wOBA from quality of contact, walks and strikeouts (Statcast, 2015 on)', kind: 'efficiency', format: 'avg3', missingIsAverage: true },
  { key: 'rangeFactor', label: 'RF/9', description: 'Range factor: plays made (putouts + assists) per 9 innings in the field, at every position he played (it sees the balls a fielder gets to, but leans on his pitchers and position; 50+ innings)', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'barrelPct', label: 'Barrel %', description: 'Batted balls hit at an ideal speed and angle (Statcast, 2015 on)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true },
  { key: 'hardHitPct', label: 'Hard-Hit %', description: 'Batted balls hit 95+ mph (Statcast, 2015 on)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true },
  { key: 'sprintSpeed', label: 'Sprint Speed', description: 'Top running speed in feet per second (Statcast, 2015 on)', kind: 'efficiency', format: 'dec1', missingIsAverage: true },
  { key: 'fieldingPct', label: 'FLD %', description: 'Plays made per chance at every position he played (errors only: it doesn\'t see the balls a slow fielder never reaches; 20+ chances)', kind: 'efficiency', format: 'avg3', missingIsAverage: true },
  { key: 'oaa', label: 'OAA', description: 'Outs Above Average: the plays he made beyond what an average fielder would, by how hard each was (Statcast range, 2016 on; not catchers)', kind: 'volume', format: 'int', missingIsAverage: true },
  { key: 'defRuns', label: 'Def Runs', description: 'Fielding runs above average', kind: 'volume', format: 'dec1' },
  { key: 'bsr', label: 'BsR', description: 'Baserunning runs above average', kind: 'volume', format: 'dec1' },
  LINEUP_STAT,
  HITTER_PARK_STAT,
];

// Pitching stats shared by starters and relievers
const IP_STAT: SkillStat = { key: 'ip', label: 'IP', description: 'Innings pitched', kind: 'volume', format: 'ip' };
const ERA_STAT: SkillStat = { key: 'era', label: 'ERA', description: 'Earned runs per 9 innings (lower is better)', kind: 'efficiency', format: 'dec2', negative: true };
const WHIP_STAT: SkillStat = { key: 'whip', label: 'WHIP', description: 'Walks + hits per inning (lower is better)', kind: 'efficiency', format: 'dec2', negative: true };
const K_STAT: SkillStat = { key: 'strikeOuts', label: 'K', description: 'Strikeouts', kind: 'volume', format: 'int' };
const HR9_STAT: SkillStat = { key: 'hr9', label: 'HR / 9', description: 'Home runs allowed per 9 innings (lower is better)', kind: 'efficiency', format: 'dec2', negative: true };
const FIP_STAT: SkillStat = { key: 'fip', label: 'FIP', description: 'ERA from strikeouts, walks and home runs alone (lower is better)', kind: 'efficiency', format: 'dec2', negative: true };
const XFIP_STAT: SkillStat = { key: 'xfip', label: 'xFIP', description: 'FIP with a league-average home run rate (lower is better)', kind: 'efficiency', format: 'dec2', negative: true };
const KPCT_STAT: SkillStat = { key: 'kPct', label: 'K %', description: 'Strikeouts per batter faced', kind: 'efficiency', format: 'pct' };
const BBPCT_STAT: SkillStat = { key: 'bbPct', label: 'BB %', description: 'Walks per batter faced (lower is better)', kind: 'efficiency', format: 'pct', negative: true };
const KBB_STAT: SkillStat = { key: 'kbbPct', label: 'K-BB %', description: 'Strikeout rate minus walk rate', kind: 'efficiency', format: 'pct' };
const WHIFF_STAT: SkillStat = { key: 'whiffPct', label: 'Whiff %', description: 'Swings that miss (Statcast, 2015 on)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true };
const HARD_HIT_ALLOWED_STAT: SkillStat = { key: 'hardHitAllowed', label: 'Hard-Hit %', name: 'Hard-Hit Rate Allowed', description: 'Batted balls allowed at 95+ mph (Statcast, 2015 on; lower is better)', kind: 'efficiency', format: 'pctPoints', negative: true, missingIsAverage: true };

const PITCHER_GAMES_STAT: SkillStat = { ...GAMES_STAT, label: 'Games', description: 'Appearances (for context; not part of the ranking)' };

// A starter's fielding percentage, on the mound only (not relievers: too few chances to say anything)
const PITCHER_FIELDING_STAT: SkillStat = {
  key: 'fieldingPct',
  label: 'FLD %',
  name: 'Fielding Percentage (min 10 chances)',
  description: "Plays made per chance on the mound (putouts and assists over chances; a pitcher sees few, so it's a small sample; 10+ chances)",
  kind: 'efficiency',
  format: 'avg3',
  missingIsAverage: true,
};

// Teams: the season (record, postseason wins, run differential, the offense's and defense's ranks), how
// it plays (team OPS and ERA, fielding runs), wins against the run differential (close games), its park,
// and the roster by your own rankings at each spot, weighted by playing time
const TEAM_STATS: SkillStat[] = [
  { key: 'winPct', label: 'Record', name: 'Record', description: 'The win-loss record (ranked on win percentage)', kind: 'efficiency', format: 'record' },
  { key: 'recent', label: 'Recent', description: 'The last 10 games, newest first (newer ones count a little more)', kind: 'efficiency', format: 'recent' },
  { key: 'playoffWins', label: 'Playoff Wins', description: 'Postseason games won (11 or more is usually a title)', kind: 'efficiency', format: 'int' },
  { key: 'runDiff', label: 'Run Diff / G', name: 'Run Differential per Game', description: 'Runs scored minus allowed per game', kind: 'efficiency', format: 'dec2' },
  { key: 'offRank', label: 'Off Rank', name: 'Offense Rank', description: "The offense's league rank by runs per game", kind: 'efficiency', format: 'rank', negative: true },
  { key: 'defRank', label: 'Def Rank', name: 'Run Prevention Rank', description: 'The league rank by runs allowed per game (pitching and defense)', kind: 'efficiency', format: 'rank', negative: true },
  { key: 'ops', label: 'OPS', name: 'Team OPS', description: "The lineup's on-base plus slugging", kind: 'efficiency', format: 'avg3' },
  { key: 'era', label: 'ERA', name: 'Team ERA', description: "The staff's earned runs per nine innings (lower is better)", kind: 'efficiency', format: 'dec2', negative: true },
  { key: 'fieldingRuns', label: 'Fielding Runs', description: 'Runs saved by its fielders (the Stats API), above average', kind: 'efficiency', format: 'dec1', missingIsAverage: true },
  { key: 'pythDiff', label: 'W vs Run Diff', name: 'Wins over Run Differential', description: 'Wins beyond what the run differential implies: close games, which mostly even out (luck as much as clutch)', kind: 'efficiency', format: 'dec1' },
  { key: 'parkFactor', label: 'Park', name: 'Park Factor', description: "How its home park plays for hitters, 100 is average (Baseball Savant, three-year; for context; not part of the ranking)", kind: 'efficiency', format: 'int', infoOnly: true },
  { key: 'hitters', label: 'Hitters', description: 'Its hitters, by your rankings on the hitter tabs, weighted by plate appearances (A+ is the best)', kind: 'efficiency', format: 'grade' },
  { key: 'rotation', label: 'Rotation', description: 'Its starters, by your rankings on that tab, weighted by innings', kind: 'efficiency', format: 'grade' },
  { key: 'bullpen', label: 'Bullpen', description: 'Its relievers, by your rankings on that tab, weighted by innings', kind: 'efficiency', format: 'grade' },
];

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = {
  TM: TEAM_STATS,
  C: HITTER_STATS,
  '1B': HITTER_STATS,
  '2B': HITTER_STATS,
  '3B': HITTER_STATS,
  SS: HITTER_STATS,
  OF: HITTER_STATS,
  // (a DH doesn't field: no defense column)
  DH: HITTER_STATS.filter((stat) => !['defRuns', 'fieldingPct', 'rangeFactor', 'oaa'].includes(stat.key)),
  SP: [
    PITCHER_GAMES_STAT,
    WAR_STAT,
    { key: 'winPct', label: 'Record', description: 'Win-loss record (ranked on win percentage)', kind: 'efficiency', format: 'record' },
    ERA_STAT,
    IP_STAT,
    K_STAT,
    WHIP_STAT,
    HR9_STAT,
    PITCHER_FIELDING_STAT,
    FIP_STAT,
    XFIP_STAT,
    { key: 'xera', label: 'xERA', description: 'Expected ERA from quality of contact allowed (Statcast, 2015 on; lower is better)', kind: 'efficiency', format: 'dec2', negative: true, missingIsAverage: true },
    KPCT_STAT,
    BBPCT_STAT,
    KBB_STAT,
    WHIFF_STAT,
    HARD_HIT_ALLOWED_STAT,
    { key: 'barrelAllowed', label: 'Barrel %', name: 'Barrels Allowed per Batted Ball', description: 'Barrels allowed per batted ball (Statcast, 2015 on; lower is better)', kind: 'efficiency', format: 'pctPoints', negative: true, missingIsAverage: true },
    DEFENSE_STAT,
    PITCHER_PARK_STAT,
  ],
  RP: [
    PITCHER_GAMES_STAT,
    WAR_STAT,
    { key: 'saves', label: 'Saves', description: 'Saves', kind: 'volume', format: 'int' },
    { key: 'holds', label: 'Holds', description: 'Holds', kind: 'volume', format: 'int' },
    ERA_STAT,
    IP_STAT,
    K_STAT,
    WHIP_STAT,
    FIP_STAT,
    XFIP_STAT,
    KPCT_STAT,
    BBPCT_STAT,
    KBB_STAT,
    WHIFF_STAT,
    { key: 'xwobaAllowed', label: 'xwOBA', name: 'Expected wOBA Allowed', description: 'Expected wOBA allowed (Statcast, 2015 on; lower is better)', kind: 'efficiency', format: 'avg3', negative: true, missingIsAverage: true },
    HARD_HIT_ALLOWED_STAT,
    DEFENSE_STAT,
    PITCHER_PARK_STAT,
  ],
};

// Default: everything at 50. A preset (skill-presets.ts) sets the stats it's named for, keeps every
// other stat at 25 as a tiebreaker, and leaves the support grades at 50.
export function presetWeights(position: SkillPosition, preset: SkillPreset): SkillWeights {
  const def = SKILL_PRESETS[position].find((p) => p.key === preset);
  const weights: SkillWeights = {};
  for (const stat of SKILL_STATS[position]) {
    if (stat.infoOnly) continue;
    weights[stat.key] = def && !stat.support ? 25 : 50;
  }
  return { ...weights, ...(def?.weights ?? {}) };
}

// ---------------------------------------------------------------------------
// Stat groups: the same groups (and colors) as the NFL app
// ---------------------------------------------------------------------------
export const STAT_GROUP_INFO: { id: StatGroupId; title: string; icon: string }[] = [
  { id: 'results', title: 'Results', icon: 'emoji_events' },
  { id: 'box', title: 'Basic Stats', icon: 'bar_chart' },
  { id: 'advanced', title: 'Advanced Stats', icon: 'insights' },
  { id: 'support', title: 'Support', icon: 'groups' },
];

const RESULTS_STATS = new Set<SkillColumnKey>(['games', 'pa', 'winPct',
  'recent', 'saves', 'holds', 'playoffWins']);

// (the Teams tab's roster grades sit where the support grades do, under "Roster")
const ROSTER_STATS = new Set<SkillColumnKey>(['hitters', 'rotation', 'bullpen']);

// (WAR leads them: the all-in-one value number, built on the rest)
const ADVANCED_STATS = new Set<SkillColumnKey>([
  'war',
  'wrcPlus',
  'xwoba',
  'barrelPct',
  'hardHitPct',
  'sprintSpeed',
  'defRuns',
  'oaa',
  'bsr',
  'fip',
  'xfip',
  'xera',
  'kPct',
  'bbPct',
  'kbbPct',
  'whiffPct',
  'xwobaAllowed',
  'hardHitAllowed',
  'barrelAllowed',
  'fieldingRuns',
  'pythDiff',
  'parkFactor',
]);

// Hitters' walk and strikeout rates are basic stats; pitchers' are advanced
export function statGroup(stat: SkillStat): StatGroupId {
  if (stat.support || ROSTER_STATS.has(stat.key)) return 'support';
  if (RESULTS_STATS.has(stat.key)) return 'results';
  if (ADVANCED_STATS.has(stat.key) && !(HITTER_STATS.includes(stat) && (stat.key === 'kPct' || stat.key === 'bbPct'))) {
    return 'advanced';
  }
  return 'box';
}

// A position's headline stats for the player card's Seasons tab: its first few basic stats
export function headlineStats(position: SkillPosition, count = 3): SkillStat[] {
  return SKILL_STATS[position]
    .filter((stat) => statGroup(stat) === 'box' && !stat.infoOnly && stat.format !== 'record' && stat.format !== 'grade')
    .slice(0, count);
}

export type SkillStatGroup = StatGroup<SkillStat>;

// A position's groups, in the standard order, leaving out groups it has no stats for
export function skillGroups(position: SkillPosition): SkillStatGroup[] {
  return STAT_GROUP_INFO.map((info) => ({
    ...info,
    title: position === 'TM' && info.id === 'support' ? 'Roster' : info.title,
    stats: SKILL_STATS[position].filter((stat) => statGroup(stat) === info.id),
  })).filter((group) => group.stats.length);
}
