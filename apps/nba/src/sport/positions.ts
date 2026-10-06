import type { StatBasis, StatDef, StatGroup, StatGroupId } from '@ranker/engine/sport';
import { SKILL_PRESETS } from '@sport/skill-presets';

export type { StatBasis, StatGroupId } from '@ranker/engine/sport';

// The NBA tabs: teams (first, and where the app opens), the five positions, as Basketball-Reference
// lists each player's season (a listed "SG-PG" counts as his first position), and head coaches
export type Position = 'TM' | 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'HC';
// Every tab uses the same config-driven table, sidebar and scoring below
export type SkillPosition = Position;

export const POSITIONS: Position[] = ['TM', 'PG', 'SG', 'SF', 'PF', 'C', 'HC'];

// Keys of the stats object in skill-players.json (scripts/update-data.mjs)
export type SkillStatKey =
  // Playing time
  | 'minutes'
  | 'gamesStarted'
  // His team's record
  | 'wins'
  | 'losses'
  | 'winPct'
  // Box score (season totals)
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'steals'
  | 'blocks'
  | 'turnovers'
  | 'threes'
  // Shooting (percentage points)
  | 'fgPct'
  | 'fg3Pct'
  | 'ftPct'
  | 'tsPct'
  // Advanced (Basketball-Reference)
  | 'per'
  | 'usgPct'
  | 'astPct'
  | 'tovPct'
  | 'trbPct'
  | 'stlPct'
  | 'blkPct'
  | 'ws'
  | 'ws48'
  | 'bpm'
  | 'dbpm'
  | 'vorp'
  | 'onOff'
  // Head coaches (the team's season; his own record and playoff wins)
  | 'playoffWins'
  | 'netRtg'
  | 'ortg'
  | 'drtg'
  | 'offRank'
  | 'defRank'
  | 'pace'
  | 'lift'
  | 'pythDiff'
  // Teams: roster grades from the position tabs' rankings (engine/roster-grades)
  | 'backcourt'
  | 'wings'
  | 'frontcourt'
  // Support grades (0 = F ... 12 = A+, see scripts/update-data.mjs)
  | 'teammates'
  | 'coaching';

// Columns worked out in the app rather than read from the data
export type SkillColumnKey = SkillStatKey | 'games' | 'recent';

// How counting stats (points, rebounds...) are shown and ranked: season totals, per game, or at a
// full season's pace (82 games). Per Game and the pace rank the same; they only read differently.
export const STAT_BASIS_LABELS: Record<StatBasis, string> = {
  season: 'Season Totals',
  perGame: 'Per Game',
  pace17: 'Full-Season Pace',
};

// A full season: 82 games at every position
export const PACE_GAMES: Record<Position, number> = { TM: 82, PG: 82, SG: 82, SF: 82, PF: 82, C: 82, HC: 82 };

export interface SkillPlayer {
  // ESPN's athlete id (headshots)
  id: number | null;
  // Basketball-Reference's player id ("jamesle01")
  gsisId: string;
  name: string;
  teamLogo: string;
  // The team's name (a traded player's last team)
  teamName?: string | null;
  games: number;
  // null when a stat doesn't apply (too few attempts for a shooting percentage), shown as "-"
  stats: Record<SkillStatKey, number | null>;
  // From ESPN's injury report (this season only)
  injured?: boolean;
  injuryStatus?: string;
  // Badges: champ, finals, mvp, dpoy, roy, smoy, mip, cpoy, nba1-3 (All-NBA), def1-2 (All-Defensive), as
  awards?: string[];
}

// A player's stat (the engine passes the sport's settings; basketball has none that change a value)
export function unitStat(unit: SkillPlayer, key: SkillStatKey, _settings?: unknown): number | null {
  return unit.stats[key] ?? null;
}

export type SkillStat = StatDef<SkillColumnKey>;

// Stat names written out in full (label hover text)
export const STAT_NAMES: Partial<Record<SkillColumnKey, string>> = {
  minutes: 'Minutes Played',
  winPct: "His Team's Record",
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  steals: 'Steals',
  blocks: 'Blocks',
  turnovers: 'Turnovers',
  threes: '3-Pointers Made',
  fgPct: 'Field Goal Percentage',
  fg3Pct: '3-Point Percentage',
  ftPct: 'Free Throw Percentage',
  tsPct: 'True Shooting Percentage',
  per: 'Player Efficiency Rating (15 = league average)',
  usgPct: 'Usage Rate',
  astPct: 'Assist Percentage',
  tovPct: 'Turnover Percentage',
  trbPct: 'Rebound Percentage',
  stlPct: 'Steal Percentage',
  blkPct: 'Block Percentage',
  ws: 'Win Shares',
  ws48: 'Win Shares per 48 Minutes',
  bpm: 'Box Plus/Minus',
  dbpm: 'Defensive Box Plus/Minus',
  vorp: 'Value Over Replacement Player',
  onOff: 'On-Off Net Rating (per 100 possessions)',
  teammates: 'His Supporting Cast',
  coaching: 'His Coaching (the coaching lift)',
  playoffWins: 'Playoff Wins',
  netRtg: 'Net Rating (points per 100 possessions)',
  ortg: 'Offensive Rating (points scored per 100 possessions)',
  drtg: 'Defensive Rating (points allowed per 100 possessions)',
  offRank: 'Offense Rank (by offensive rating)',
  defRank: 'Defense Rank (by defensive rating)',
  pace: 'Pace (possessions per 48 minutes)',
  lift: 'Coaching Lift (net rating over the roster\'s talent)',
  pythDiff: 'Wins over Point Differential',
  backcourt: 'Backcourt (point and shooting guards, by your rankings)',
  wings: 'Wings (small forwards, by your rankings)',
  frontcourt: 'Frontcourt (power forwards and centers, by your rankings)',
};

// Per-game column labels, when Stat Defs is on Per Game
export const PER_GAME_LABELS: Partial<Record<SkillColumnKey, string>> = {
  minutes: 'MPG',
  points: 'PPG',
  rebounds: 'RPG',
  assists: 'APG',
  steals: 'SPG',
  blocks: 'BPG',
  turnovers: 'TOV / G',
  threes: '3PM / G',
};

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
// 'default' (everything at 50), or a preset key from SKILL_PRESETS for the position
export type SkillPreset = string;

// Support grades: the situation around a player, graded F to A+ across the league. Better support
// counts slightly against him (credit for doing more with less).
const TEAMMATES_STAT: SkillStat = {
  key: 'teammates',
  label: 'Teammates',
  description: "The rest of his team: his teammates' Box Plus/Minus, weighted by their minutes (without him)",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};
const COACHING_STAT: SkillStat = {
  key: 'coaching',
  label: 'Coaching',
  description: "His team's coaching lift: how much better it played than its roster's talent coming in (the Head Coaches tab's Coaching Lift)",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Every position has the same columns; the presets (skill-presets.ts) weigh them for the position
const NBA_STATS: SkillStat[] = [
  { key: 'games', label: 'Games', description: 'Games played (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
  { key: 'minutes', label: 'Min', description: 'Minutes played (for context; not part of the ranking)', kind: 'volume', format: 'int', infoOnly: true },
  { key: 'winPct', label: 'Record', description: "His team's win-loss record (ranked on win percentage; a traded player: his last team's)", kind: 'efficiency', format: 'record' },
  // (Win Shares and VORP stay season totals under Per Game: a season's value, not a per-game rate)
  { key: 'ws', label: 'Win Shares', description: 'Wins he produced, from his offense and defense (Basketball-Reference)', kind: 'efficiency', format: 'dec1' },
  { key: 'vorp', label: 'VORP', description: 'Box Plus/Minus turned into value over a replacement-level player', kind: 'efficiency', format: 'dec1' },
  { key: 'points', label: 'PTS', description: 'Points', kind: 'volume', format: 'int' },
  { key: 'rebounds', label: 'REB', description: 'Rebounds', kind: 'volume', format: 'int' },
  { key: 'assists', label: 'AST', description: 'Assists', kind: 'volume', format: 'int' },
  { key: 'steals', label: 'STL', description: 'Steals', kind: 'volume', format: 'int' },
  { key: 'blocks', label: 'BLK', description: 'Blocks', kind: 'volume', format: 'int' },
  { key: 'threes', label: '3PM', description: '3-pointers made', kind: 'volume', format: 'int' },
  { key: 'turnovers', label: 'TOV', description: 'Turnovers (lower is better)', kind: 'volume', format: 'int', negative: true },
  { key: 'fgPct', label: 'FG %', description: 'Field goals made per attempt', kind: 'efficiency', format: 'pctPoints' },
  { key: 'fg3Pct', label: '3P %', description: '3-pointers made per attempt (25+ attempts)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true },
  { key: 'ftPct', label: 'FT %', description: 'Free throws made per attempt (20+ attempts)', kind: 'efficiency', format: 'pctPoints', missingIsAverage: true },
  { key: 'tsPct', label: 'TS %', description: 'Scoring efficiency counting 3s and free throws: points per shooting possession', kind: 'efficiency', format: 'pctPoints' },
  { key: 'per', label: 'PER', description: 'Per-minute production in one number (15 = league average)', kind: 'efficiency', format: 'dec1' },
  { key: 'usgPct', label: 'USG %', description: 'Share of his team\'s possessions he used while on the floor (shots, free throws, turnovers)', kind: 'efficiency', format: 'pctPoints' },
  { key: 'bpm', label: 'BPM', description: 'Points per 100 possessions he added over an average player, from the box score', kind: 'efficiency', format: 'dec1' },
  { key: 'dbpm', label: 'DBPM', description: 'The defensive half of Box Plus/Minus', kind: 'efficiency', format: 'dec1' },
  { key: 'ws48', label: 'WS / 48', description: 'Win Shares per 48 minutes (.100 is about average)', kind: 'efficiency', format: 'avg3' },
  { key: 'onOff', label: 'On-Off', description: "His team's net rating per 100 possessions with him on the floor, minus with him off", kind: 'efficiency', format: 'dec1' },
  { key: 'astPct', label: 'AST %', description: "Teammates' baskets he assisted while on the floor", kind: 'efficiency', format: 'pctPoints' },
  { key: 'tovPct', label: 'TOV %', description: 'Turnovers per 100 plays (lower is better)', kind: 'efficiency', format: 'pctPoints', negative: true },
  { key: 'trbPct', label: 'REB %', description: 'Available rebounds he grabbed while on the floor', kind: 'efficiency', format: 'pctPoints' },
  { key: 'stlPct', label: 'STL %', description: "Opponents' possessions he ended with a steal", kind: 'efficiency', format: 'pctPoints' },
  { key: 'blkPct', label: 'BLK %', description: "Opponents' 2-point shots he blocked", kind: 'efficiency', format: 'pctPoints' },
  TEAMMATES_STAT,
  COACHING_STAT,
];

// Teams: the season (record, playoff wins, net rating and the offense's and defense's ranks), wins
// against the point differential (luck in close games), and the roster by your own rankings of its
// players at each spot, weighted by their minutes (engine/roster-grades)
const TEAM_STATS: SkillStat[] = [
  { key: 'games', label: 'Games', description: 'Games played (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
  { key: 'winPct', label: 'Record', name: 'Record', description: 'The win-loss record (ranked on win percentage)', kind: 'efficiency', format: 'record' },
  { key: 'recent', label: 'Recent', description: 'The last 7 games, newest first (newer ones count a little more)', kind: 'efficiency', format: 'recent' },
  { key: 'playoffWins', label: 'Playoff Wins', description: 'Playoff games won (16 is a title)', kind: 'efficiency', format: 'int' },
  { key: 'netRtg', label: 'Net Rtg', description: 'Points scored minus allowed per 100 possessions', kind: 'efficiency', format: 'dec1' },
  { key: 'offRank', label: 'Off Rank', name: 'Offense Rank', description: "The offense's league rank by offensive rating, points scored per 100 possessions", kind: 'efficiency', format: 'rank', negative: true },
  { key: 'defRank', label: 'Def Rank', name: 'Defense Rank', description: "The defense's league rank by defensive rating, points allowed per 100 possessions", kind: 'efficiency', format: 'rank', negative: true },
  { key: 'pythDiff', label: 'W vs Pt Diff', name: 'Wins over Point Differential', description: 'Wins beyond what the point differential implies: close games, which mostly even out (luck as much as clutch)', kind: 'efficiency', format: 'dec1' },
  { key: 'pace', label: 'Pace', description: 'Possessions per 48 minutes (for context; not part of the ranking)', kind: 'efficiency', format: 'dec1', infoOnly: true },
  { key: 'backcourt', label: 'Backcourt', description: 'Its point and shooting guards, by your rankings on those tabs, weighted by their minutes (A+ is the best)', kind: 'efficiency', format: 'grade' },
  { key: 'wings', label: 'Wings', description: 'Its small forwards, by your rankings on that tab, weighted by their minutes', kind: 'efficiency', format: 'grade' },
  { key: 'frontcourt', label: 'Frontcourt', description: 'Its power forwards and centers, by your rankings on those tabs, weighted by their minutes', kind: 'efficiency', format: 'grade' },
];

// Head coaches: his own record and playoff wins, the team's offense and defense ranks (the basics), and
// what's his: how the team played against its talent and in close games
const COACH_STATS: SkillStat[] = [
  { key: 'games', label: 'Games', description: 'Games coached (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
  { key: 'winPct', label: 'Record', description: 'His win-loss record (ranked on win percentage)', kind: 'efficiency', format: 'record' },
  { key: 'playoffWins', label: 'Playoff Wins', description: 'Playoff games won (16 is a title)', kind: 'efficiency', format: 'int' },
  // (ranks rather than the ratings themselves: league scoring drifts over the years, and "3rd" means the
  // same in any season)
  { key: 'offRank', label: 'Off Rank', name: 'Offense Rank', description: 'The offense\'s league rank by offensive rating, points scored per 100 possessions (the team\'s season)', kind: 'efficiency', format: 'rank', negative: true },
  { key: 'defRank', label: 'Def Rank', name: 'Defense Rank', description: 'The defense\'s league rank by defensive rating, points allowed per 100 possessions (the team\'s season)', kind: 'efficiency', format: 'rank', negative: true },
  { key: 'lift', label: 'Coaching Lift', description: 'Net rating over what the roster\'s talent predicted: last season\'s Box Plus/Minus of the players he used, weighted by their minutes', kind: 'efficiency', format: 'dec1', missingIsAverage: true },
  { key: 'pythDiff', label: 'W vs Pt Diff', name: 'Wins over Point Differential', description: 'Wins beyond what the point differential implies (close games; his share of the season)', kind: 'efficiency', format: 'dec1' },
];

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = {
  TM: TEAM_STATS,
  PG: NBA_STATS,
  SG: NBA_STATS,
  SF: NBA_STATS,
  PF: NBA_STATS,
  C: NBA_STATS,
  HC: COACH_STATS,
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
// Stat groups: the same groups (and colors) as the NFL and MLB apps
// ---------------------------------------------------------------------------
export const STAT_GROUP_INFO: { id: StatGroupId; title: string; icon: string }[] = [
  { id: 'results', title: 'Results', icon: 'emoji_events' },
  { id: 'box', title: 'Basic Stats', icon: 'bar_chart' },
  { id: 'advanced', title: 'Advanced Stats', icon: 'insights' },
  { id: 'support', title: 'Support', icon: 'groups' },
];

const RESULTS_STATS = new Set<SkillColumnKey>(['games', 'minutes', 'winPct',
  'recent', 'ws', 'vorp', 'playoffWins']);

const ADVANCED_STATS = new Set<SkillColumnKey>([
  'tsPct',
  'per',
  'usgPct',
  'bpm',
  'dbpm',
  'ws48',
  'onOff',
  'astPct',
  'tovPct',
  'trbPct',
  'stlPct',
  'blkPct',
  'lift',
  'pythDiff',
]);

// (the Teams tab's roster grades sit where the support grades do, under "Roster")
const ROSTER_STATS = new Set<SkillColumnKey>(['backcourt', 'wings', 'frontcourt']);

export function statGroup(stat: SkillStat): StatGroupId {
  if (stat.support || ROSTER_STATS.has(stat.key)) return 'support';
  if (RESULTS_STATS.has(stat.key)) return 'results';
  if (ADVANCED_STATS.has(stat.key)) return 'advanced';
  return 'box';
}

// A position's headline stats for the player card's Seasons tab: its first few basic stats
// (points, rebounds, assists; a coach's net, offensive and defensive ratings)
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
