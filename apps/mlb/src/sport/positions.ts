import type { StatFormat } from '@ranker/engine/sport';
import { SKILL_PRESETS } from '@sport/skill-presets';

// The MLB tabs: hitters by primary position (outfielders together, DH for full-time designated
// hitters and two-way players' bats), and pitchers by role
export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH' | 'SP' | 'RP';
// Every tab uses the same config-driven table, sidebar and scoring below
export type SkillPosition = Position;

export const POSITIONS: Position[] = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'];

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
  | 'park';

// Columns worked out in the app rather than read from the data
export type SkillColumnKey = SkillStatKey | 'games';

// How counting stats (home runs, strikeouts...) are shown and ranked: season totals, per game, or at
// a full season's pace (see PACE_GAMES). Per Game and the pace rank the same; they only read
// differently.
export type StatBasis = 'season' | 'perGame' | 'pace17';

export const STAT_BASIS_LABELS: Record<StatBasis, string> = {
  season: 'Season Totals',
  perGame: 'Per Game',
  pace17: 'Full-Season Pace',
};

// A full season, in each tab's games: 162 for hitters, 32 starts for a starter, 65 appearances for a
// reliever
export const PACE_GAMES: Record<Position, number> = {
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

// A player's stat (the MLB data has no garbage-time split; the flag stays for the shared code)
export function unitStat(unit: SkillPlayer, key: SkillStatKey, _garbageTime?: boolean): number | null {
  return unit.stats[key] ?? null;
}

export interface SkillStat {
  key: SkillColumnKey;
  label: string;
  description: string;
  // Volume stats scale with games played (and can be shown per game); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  // 'record' shows W-L from the wins / losses stats while ranking on the stat's value; pct: a 0-1
  // share shown as a whole percent; pctPoints: already in percentage points (1 decimal); avg3: a
  // batting-average style rate (".287"); ip: innings in baseball notation (175.1 = 175 1/3)
  format: StatFormat;
  // Full name for hover text, when STAT_NAMES' name for the key doesn't fit this tab
  name?: string;
  // Counts against the player (e.g. strikeouts for a hitter, ERA for a pitcher)
  negative?: boolean;
  // Team support graded 0-12: better support is a (dampened) penalty, credit for doing more with less
  support?: boolean;
  supportHelps?: boolean;
  // Shown for context only: no slider and no weight in the ranking
  infoOnly?: boolean;
  // A missing value ("-") means too small a sample, so it scores as the league average, not the worst
  missingIsAverage?: boolean;
}

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
  { key: 'barrelPct', label: 'Barrel %', description: 'Batted balls hit at an ideal speed and angle (Statcast, 2015 on)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true },
  { key: 'hardHitPct', label: 'Hard-Hit %', description: 'Batted balls hit 95+ mph (Statcast, 2015 on)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true },
  { key: 'sprintSpeed', label: 'Sprint Speed', description: 'Top running speed in feet per second (Statcast, 2015 on)', kind: 'efficiency', format: 'dec1', missingIsAverage: true },
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

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = {
  C: HITTER_STATS,
  '1B': HITTER_STATS,
  '2B': HITTER_STATS,
  '3B': HITTER_STATS,
  SS: HITTER_STATS,
  OF: HITTER_STATS,
  // (a DH doesn't field: no defense column)
  DH: HITTER_STATS.filter((stat) => stat.key !== 'defRuns'),
  SP: [
    PITCHER_GAMES_STAT,
    WAR_STAT,
    { key: 'winPct', label: 'Record', description: 'Win-loss record (ranked on win percentage)', kind: 'efficiency', format: 'record' },
    ERA_STAT,
    IP_STAT,
    K_STAT,
    WHIP_STAT,
    HR9_STAT,
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
export type StatGroupId = 'results' | 'box' | 'advanced' | 'support';

export const STAT_GROUP_INFO: { id: StatGroupId; title: string; icon: string }[] = [
  { id: 'results', title: 'Results', icon: 'emoji_events' },
  { id: 'box', title: 'Basic Stats', icon: 'bar_chart' },
  { id: 'advanced', title: 'Advanced Stats', icon: 'insights' },
  { id: 'support', title: 'Support', icon: 'groups' },
];

const RESULTS_STATS = new Set<SkillColumnKey>(['games', 'pa', 'war', 'winPct', 'saves', 'holds']);

const ADVANCED_STATS = new Set<SkillColumnKey>([
  'wrcPlus',
  'xwoba',
  'barrelPct',
  'hardHitPct',
  'sprintSpeed',
  'defRuns',
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
]);

// Hitters' walk and strikeout rates are basic stats; pitchers' are advanced
export function statGroup(stat: SkillStat): StatGroupId {
  if (stat.support) return 'support';
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

export interface SkillStatGroup {
  id: StatGroupId;
  title: string;
  icon: string;
  stats: SkillStat[];
}

// A position's groups, in the standard order, leaving out groups it has no stats for
export function skillGroups(position: SkillPosition): SkillStatGroup[] {
  return STAT_GROUP_INFO.map((info) => ({
    ...info,
    stats: SKILL_STATS[position].filter((stat) => statGroup(stat) === info.id),
  })).filter((group) => group.stats.length);
}
