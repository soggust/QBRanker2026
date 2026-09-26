export type Position = 'QB' | 'RB' | 'WR' | 'TE';
export type SkillPosition = Exclude<Position, 'QB'>;

export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

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
  | 'fantasyStd';

// Columns computed in the app: fantasy points in the chosen scoring, and team support grades
export type SkillColumnKey = SkillStatKey | 'fantasy' | 'oline' | 'qbPlay';

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
  stats: Record<SkillStatKey, number>;
}

export interface SkillStat {
  key: SkillColumnKey;
  label: string;
  description: string;
  // Volume stats scale with games played (and can be shown per game); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  format: 'int' | 'dec1' | 'dec2' | 'pct' | 'grade';
  // Can go negative, so it's scaled against the league range instead of the max
  signed?: boolean;
  // Counts against the player (e.g. fumbles)
  negative?: boolean;
  // Team support graded 0-12; like the QB support sliders, better support is a (dampened) penalty
  support?: boolean;
}

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
export type SkillPreset = 'default' | 'volume' | 'efficiency' | 'fantasy';

const FANTASY_STAT: SkillStat = {
  key: 'fantasy',
  label: 'Fantasy Pts',
  description: 'Fantasy points (scoring set in the settings menu)',
  kind: 'volume',
  format: 'dec1',
};

const RECEIVING_STATS: SkillStat[] = [
  { key: 'targets', label: 'Targets', description: 'Times targeted', kind: 'volume', format: 'int' },
  { key: 'receptions', label: 'Receptions', description: 'Catches', kind: 'volume', format: 'int' },
  { key: 'recYards', label: 'Rec Yards', description: 'Receiving yards', kind: 'volume', format: 'int' },
  { key: 'recTds', label: 'Touchdowns', description: 'Receiving touchdowns', kind: 'volume', format: 'int' },
  { key: 'yac', label: 'YAC', description: 'Yards after the catch', kind: 'volume', format: 'int' },
  { key: 'catchPct', label: 'Catch %', description: 'Receptions per target', kind: 'efficiency', format: 'pct' },
  {
    key: 'targetShare',
    label: 'Target Share',
    description: "Share of the team's targets",
    kind: 'efficiency',
    format: 'pct',
  },
  {
    key: 'epaPerTarget',
    label: 'EPA / Target',
    description: 'Expected Points Added per target',
    kind: 'efficiency',
    format: 'dec2',
    signed: true,
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
      description: "Team O-line grade (from the QB support scores), weighted by each QB's starts",
      kind: 'efficiency',
      format: 'grade',
      support: true,
    },
  ],
  WR: RECEIVING_STATS,
  TE: RECEIVING_STATS,
};

// Default: everything at 50. Volume/Efficiency lean one way; penalties and support stay at 50.
// Fantasy points already combine yards and TDs, so they're off unless the Fantasy preset is picked.
export function presetWeights(position: SkillPosition, preset: SkillPreset): SkillWeights {
  const weights: SkillWeights = {};
  for (const stat of SKILL_STATS[position]) {
    if (preset === 'fantasy') weights[stat.key] = stat.key === 'fantasy' ? 100 : 0;
    else if (stat.key === 'fantasy') weights[stat.key] = 0;
    else if (preset === 'default' || stat.negative || stat.support) weights[stat.key] = 50;
    else weights[stat.key] = stat.kind === preset ? 75 : 25;
  }
  return weights;
}
