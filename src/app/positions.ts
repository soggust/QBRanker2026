export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'P' | 'DEF' | 'HC';
// Everything except QB, which has its own page; all use the config-driven table below
// (DEF rows are team defenses and HC rows are head coaches)
export type SkillPosition = Exclude<Position, 'QB'>;

export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'P', 'DEF', 'HC'];

// Keys of the stats object in skill-players.json
export type SkillStatKey =
  | 'carries'
  | 'rushYards'
  | 'rushTds'
  | 'targets'
  | 'receptions'
  | 'recYards'
  | 'recTds'
  | 'yac'
  | 'firstDowns'
  | 'fumbles'
  | 'targetShare'
  | 'ypc'
  | 'totalTds'
  | 'catchPct'
  | 'epaPerCarry'
  | 'epaPerTarget'
  | 'fantasyStd'
  // Kickers
  | 'fgMade'
  | 'fgAtt'
  | 'patAtt'
  | 'fgPct'
  | 'fg50'
  | 'fgLong'
  | 'patPct'
  | 'epaPerKick'
  // Punters
  | 'punts'
  | 'grossAvg'
  | 'netAvg'
  | 'inside20'
  | 'inside20Pct'
  | 'touchbacks'
  | 'epaPerPunt'
  // Defenses
  | 'epaAllowed'
  | 'passEpaAllowed'
  | 'rushEpaAllowed'
  | 'successAllowed'
  | 'sacks'
  | 'takeaways'
  | 'ptsAllowedPerGame'
  // Head coaches
  | 'wins'
  | 'losses'
  | 'ties'
  | 'winPct'
  | 'winsOverExpected'
  | 'atsPct'
  | 'pointDiffPerGame'
  | 'netEpa'
  // Added: tracking (Next Gen Stats), contact/drop/pressure (Pro Football Reference via nflverse)
  | 'ryoePerAtt'
  | 'yacoPerCarry'
  | 'brokenTackles'
  | 'snapShare'
  | 'separation'
  | 'yacOverExp'
  | 'adot'
  | 'airYardsShare'
  | 'dropPct'
  | 'pressureRate'
  | 'missedTacklePct'
  | 'thirdDownPct'
  | 'redZoneTdPct'
  | 'fgOverExp'
  | 'fairCatchPct'
  | 'oneScoreWinPct'
  | 'penaltiesPerGame';

// Columns computed in the app: fantasy points in the chosen scoring, and team support grades
export type SkillColumnKey = SkillStatKey | 'fantasy' | 'oline' | 'qbPlay' | 'games';

export type FantasyScoring = 'std' | 'half' | 'ppr';

export const FANTASY_SCORING_LABELS: Record<FantasyScoring, string> = {
  std: 'Standard',
  half: 'Half PPR',
  ppr: 'PPR',
};

// nflverse fantasy_points is standard scoring; PPR adds 1 per reception (verified against fantasy_points_ppr)
export function fantasyPoints(standard: number, receptions: number, scoring: FantasyScoring): number {
  const perReception = { std: 0, half: 0.5, ppr: 1 }[scoring];
  return standard + receptions * perReception;
}

export interface SkillPlayer {
  id: number | null;
  gsisId: string;
  name: string;
  teamLogo: string;
  games: number;
  // null when a data source doesn't cover the player (shown as "-")
  stats: Record<SkillStatKey, number | null>;
}

export interface SkillStat {
  key: SkillColumnKey;
  label: string;
  description: string;
  // Volume stats scale with games played (and can be shown per game); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  // 'record' shows W-L(-T) from the wins/losses/ties stats while ranking on the stat's value
  // pct: a 0-1 share shown as a whole percent; pctPoints: already in percentage points (1 decimal)
  format: 'int' | 'dec1' | 'dec2' | 'pct' | 'pctPoints' | 'grade' | 'record';
  // Scaled against the league range instead of the max (stats that can go negative, or bunch up)
  signed?: boolean;
  // Counts against the player (e.g. fumbles)
  negative?: boolean;
  // Team support graded 0-12; like the QB support sliders, better support is a (dampened) penalty
  support?: boolean;
  // Shown for context only: no slider and no weight in the ranking
  infoOnly?: boolean;
}

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
export type SkillPreset = 'default' | 'volume' | 'efficiency' | 'fantasy';

// Games played: the first column on every player / unit tab, for sample-size context
const GAMES_STAT: SkillStat = {
  key: 'games',
  label: 'Games',
  description: 'Games played (for context; not part of the ranking)',
  kind: 'efficiency',
  format: 'int',
  infoOnly: true,
};

const FANTASY_STAT: SkillStat = {
  key: 'fantasy',
  label: 'Fantasy Pts',
  description: 'Fantasy points (scoring set in the settings menu)',
  kind: 'volume',
  format: 'dec1',
};

const RECEIVING_STATS: SkillStat[] = [
  GAMES_STAT,
  { key: 'targets', label: 'Targets', description: 'Times targeted', kind: 'volume', format: 'int' },
  {
    key: 'targetShare',
    label: 'Target Share',
    description: "Share of the team's targets",
    kind: 'efficiency',
    format: 'pct',
  },
  { key: 'receptions', label: 'Receptions', description: 'Catches', kind: 'volume', format: 'int' },
  { key: 'recYards', label: 'Rec Yards', description: 'Receiving yards', kind: 'volume', format: 'int' },
  { key: 'recTds', label: 'Touchdowns', description: 'Receiving touchdowns', kind: 'volume', format: 'int' },
  { key: 'yac', label: 'YAC', description: 'Yards after the catch', kind: 'volume', format: 'int' },
  { key: 'catchPct', label: 'Catch %', description: 'Receptions per target', kind: 'efficiency', format: 'pct' },
  {
    key: 'epaPerTarget',
    label: 'EPA / Target',
    description: 'Expected Points Added per target',
    kind: 'efficiency',
    format: 'dec2',
    signed: true,
  },
  {
    key: 'separation',
    label: 'Separation',
    description: 'Average yards from the nearest defender at the catch point (Next Gen Stats)',
    kind: 'efficiency',
    format: 'dec1',
  },
  {
    key: 'yacOverExp',
    label: 'YAC Over Exp',
    description: 'Yards after catch above expected, per reception (Next Gen Stats)',
    kind: 'efficiency',
    format: 'dec1',
    signed: true,
  },
  {
    key: 'adot',
    label: 'aDOT',
    description: 'Average depth of target in yards (Next Gen Stats)',
    kind: 'efficiency',
    format: 'dec1',
  },
  {
    key: 'airYardsShare',
    label: 'Air Yds Share',
    description: "Share of the team's air yards",
    kind: 'efficiency',
    format: 'pct',
  },
  {
    key: 'dropPct',
    label: 'Drop %',
    description: 'Drops per target (lower is better)',
    kind: 'efficiency',
    format: 'pct',
    negative: true,
  },
  {
    key: 'snapShare',
    label: 'Snap %',
    description: 'Average share of offensive snaps played',
    kind: 'efficiency',
    format: 'pct',
  },
  FANTASY_STAT,
  {
    key: 'qbPlay',
    label: 'QB Play',
    description: "Team QB grade from the current QB rankings, weighted by each QB's starts",
    kind: 'efficiency',
    format: 'grade',
    support: true,
  },
];

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = {
  RB: [
    GAMES_STAT,
    { key: 'carries', label: 'Carries', description: 'Rushing attempts', kind: 'volume', format: 'int' },
    { key: 'rushYards', label: 'Rush Yards', description: 'Rushing yards', kind: 'volume', format: 'int' },
    { key: 'ypc', label: 'Yds / Carry', description: 'Yards per carry', kind: 'efficiency', format: 'dec1' },
    { key: 'recYards', label: 'Rec Yards', description: 'Receiving yards', kind: 'volume', format: 'int' },
    { key: 'receptions', label: 'Receptions', description: 'Catches', kind: 'volume', format: 'int' },
    {
      key: 'totalTds',
      label: 'Touchdowns',
      description: 'Rushing + receiving touchdowns',
      kind: 'volume',
      format: 'int',
    },
    {
      key: 'firstDowns',
      label: '1st Downs',
      description: 'Rushing + receiving first downs',
      kind: 'volume',
      format: 'int',
    },
    {
      key: 'epaPerCarry',
      label: 'EPA / Carry',
      description: 'Expected Points Added per carry',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'ryoePerAtt',
      label: 'RYOE / Carry',
      description: 'Rush yards over expected per carry, given the blocking and defenders (Next Gen Stats)',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'yacoPerCarry',
      label: 'YAC / Carry',
      description: 'Rushing yards after first contact per carry',
      kind: 'efficiency',
      format: 'dec1',
    },
    {
      key: 'brokenTackles',
      label: 'Broken Tkl',
      description: 'Broken tackles on runs and catches',
      kind: 'volume',
      format: 'int',
    },
    {
      key: 'snapShare',
      label: 'Snap %',
      description: 'Average share of offensive snaps played',
      kind: 'efficiency',
      format: 'pct',
    },
    {
      key: 'fumbles',
      label: 'Fumbles',
      description: 'Fumbles lost',
      kind: 'volume',
      format: 'int',
      negative: true,
    },
    FANTASY_STAT,
    {
      key: 'oline',
      label: 'O-Line',
      description: "Team O-line grade from team-grades.json",
      kind: 'efficiency',
      format: 'grade',
      support: true,
    },
  ],
  WR: RECEIVING_STATS,
  TE: RECEIVING_STATS,
  K: [
    GAMES_STAT,
    { key: 'fgMade', label: 'FG Made', description: 'Field goals made', kind: 'volume', format: 'int' },
    { key: 'fgPct', label: 'FG %', description: 'Field goal percentage', kind: 'efficiency', format: 'pct' },
    { key: 'fg50', label: '50+ Made', description: 'Field goals made from 50+ yards', kind: 'volume', format: 'int' },
    { key: 'fgLong', label: 'Long', description: 'Longest field goal', kind: 'efficiency', format: 'int' },
    { key: 'patPct', label: 'XP %', description: 'Extra point percentage', kind: 'efficiency', format: 'pct' },
    {
      key: 'epaPerKick',
      label: 'EPA / Kick',
      description: 'Expected Points Added per field goal and extra point attempt',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'fgOverExp',
      label: 'FG % Over Exp',
      description: 'Field goal % above what the kick distances predict, in percentage points',
      kind: 'efficiency',
      format: 'pctPoints',
      signed: true,
    },
    {
      ...FANTASY_STAT,
      description: 'Standard kicker scoring: FG 3/4/5 by distance, XP 1, misses -1',
    },
  ],
  P: [
    GAMES_STAT,
    { key: 'punts', label: 'Punts', description: 'Punts', kind: 'volume', format: 'int' },
    { key: 'grossAvg', label: 'Gross Avg', description: 'Yards per punt', kind: 'efficiency', format: 'dec1' },
    {
      key: 'netAvg',
      label: 'Net Avg',
      description: 'Net yards per punt (after returns and touchbacks)',
      kind: 'efficiency',
      format: 'dec1',
    },
    { key: 'inside20', label: 'Inside 20', description: 'Punts downed inside the 20', kind: 'volume', format: 'int' },
    {
      key: 'inside20Pct',
      label: 'In-20 %',
      description: 'Share of punts downed inside the 20',
      kind: 'efficiency',
      format: 'pct',
    },
    {
      key: 'epaPerPunt',
      label: 'EPA / Punt',
      description: 'Expected Points Added per punt (for the punting team)',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'touchbacks',
      label: 'Touchbacks',
      description: 'Punts into the end zone',
      kind: 'volume',
      format: 'int',
      negative: true,
    },
    {
      key: 'fairCatchPct',
      label: 'Fair Catch %',
      description: 'Share of punts fair caught',
      kind: 'efficiency',
      format: 'pct',
    },
  ],
  // Lower is better for everything "allowed", so those count against the defense
  DEF: [
    GAMES_STAT,
    {
      key: 'epaAllowed',
      label: 'EPA / Play',
      description: 'Expected Points Added per play allowed (lower is better)',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
      negative: true,
    },
    {
      key: 'passEpaAllowed',
      label: 'Pass EPA',
      description: 'EPA per pass play allowed (lower is better)',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
      negative: true,
    },
    {
      key: 'rushEpaAllowed',
      label: 'Rush EPA',
      description: 'EPA per run play allowed (lower is better)',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
      negative: true,
    },
    {
      key: 'successAllowed',
      label: 'Success %',
      description: 'Share of plays where the offense gained positive EPA (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    { key: 'sacks', label: 'Sacks', description: 'Sacks', kind: 'volume', format: 'int' },
    {
      key: 'pressureRate',
      label: 'Pressure %',
      description: 'Pressures per opponent dropback',
      kind: 'efficiency',
      format: 'pct',
    },
    {
      key: 'takeaways',
      label: 'Takeaways',
      description: 'Interceptions + fumbles recovered',
      kind: 'volume',
      format: 'int',
    },
    {
      key: 'ptsAllowedPerGame',
      label: 'Pts / Game',
      description: 'Points allowed per game (lower is better)',
      kind: 'efficiency',
      format: 'dec1',
      signed: true,
      negative: true,
    },
    {
      key: 'thirdDownPct',
      label: '3rd Down %',
      description: 'Opponent third-down conversion rate (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    {
      key: 'redZoneTdPct',
      label: 'Red Zone TD %',
      description: 'Share of opponent red-zone drives ending in a touchdown (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    {
      key: 'missedTacklePct',
      label: 'Missed Tkl %',
      description: 'Missed tackles per tackle attempt (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    {
      ...FANTASY_STAT,
      description:
        'Standard D/ST scoring: sack 1, takeaway 2, TD 6, safety 2, plus points-allowed tier each game',
    },
  ],
  HC: [
    { key: 'winPct', label: 'Record', description: 'Win-loss record', kind: 'efficiency', format: 'record' },
    {
      key: 'winsOverExpected',
      label: 'Wins Over Exp',
      description: 'Wins minus the wins implied by the betting lines before each game',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'atsPct',
      label: 'ATS %',
      description: 'Share of games covering the point spread (pushes excluded)',
      kind: 'efficiency',
      format: 'pct',
    },
    {
      key: 'pointDiffPerGame',
      label: 'Pt Diff / Game',
      description: 'Average points scored minus points allowed per game',
      kind: 'efficiency',
      format: 'dec1',
      signed: true,
    },
    {
      key: 'netEpa',
      label: 'Net EPA / Play',
      description: "Team offense EPA/play minus defense EPA/play allowed in the coach's games",
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'oneScoreWinPct',
      label: '1-Score Win %',
      description: 'Win % in games decided by 8 points or fewer',
      kind: 'efficiency',
      format: 'pct',
    },
    {
      key: 'penaltiesPerGame',
      label: 'Penalties / Game',
      description: 'Penalties called on the team per game (lower is better)',
      kind: 'efficiency',
      format: 'dec1',
      signed: true,
      negative: true,
    },
  ],
};

export function hasFantasy(position: SkillPosition): boolean {
  return SKILL_STATS[position].some((stat) => stat.key === 'fantasy');
}

// Default: everything at 50. Volume/Efficiency lean one way; penalties and support stay at 50.
// Fantasy ranks purely on fantasy points.
export function presetWeights(position: SkillPosition, preset: SkillPreset): SkillWeights {
  const weights: SkillWeights = {};
  for (const stat of SKILL_STATS[position]) {
    if (stat.infoOnly) continue;
    if (preset === 'fantasy') weights[stat.key] = stat.key === 'fantasy' ? 100 : 0;
    else if (preset === 'default' || stat.negative || stat.support) weights[stat.key] = 50;
    else weights[stat.key] = stat.kind === preset ? 75 : 25;
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Stat groups: the same four groups (and colors) the QB page uses
// ---------------------------------------------------------------------------
export type StatGroupId = 'results' | 'box' | 'advanced' | 'support';

export const STAT_GROUP_INFO: { id: StatGroupId; title: string; icon: string }[] = [
  { id: 'results', title: 'Results', icon: 'emoji_events' },
  { id: 'box', title: 'Basic Stats', icon: 'bar_chart' },
  { id: 'advanced', title: 'Advanced Stats', icon: 'insights' },
  { id: 'support', title: 'Support', icon: 'groups' },
];

const RESULTS_STATS = new Set<SkillColumnKey>(['games', 'winPct', 'winsOverExpected', 'atsPct', 'oneScoreWinPct']);

const ADVANCED_STATS = new Set<SkillColumnKey>([
  'epaPerCarry',
  'ryoePerAtt',
  'yacoPerCarry',
  'brokenTackles',
  'snapShare',
  'epaPerTarget',
  'separation',
  'yacOverExp',
  'adot',
  'airYardsShare',
  'dropPct',
  'epaPerKick',
  'fgOverExp',
  'epaPerPunt',
  'epaAllowed',
  'passEpaAllowed',
  'rushEpaAllowed',
  'successAllowed',
  'pressureRate',
  'missedTacklePct',
  'netEpa',
  // Fantasy points close out each Advanced Stats group
  'fantasy',
]);

// Support grades go in Support; everything not listed as results or advanced is a basic stat
export function statGroup(stat: SkillStat): StatGroupId {
  if (stat.support) return 'support';
  if (RESULTS_STATS.has(stat.key)) return 'results';
  if (ADVANCED_STATS.has(stat.key)) return 'advanced';
  return 'box';
}

export interface SkillStatGroup {
  id: StatGroupId;
  title: string;
  icon: string;
  stats: SkillStat[];
}

// A position's groups, in the standard order, leaving out groups it has no stats for
export function skillGroups(position: SkillPosition): SkillStatGroup[] {
  return STAT_GROUP_INFO.map((info) => {
    const stats = SKILL_STATS[position].filter((stat) => statGroup(stat) === info.id);
    // Fantasy points always come last in their group
    const fantasy = stats.filter((stat) => stat.key === 'fantasy');
    return { ...info, stats: [...stats.filter((stat) => stat.key !== 'fantasy'), ...fantasy] };
  }).filter((group) => group.stats.length);
}
