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
  | 'epaPerTarget';

export interface SkillPlayer {
  id: number | null;
  gsisId: string;
  name: string;
  teamLogo: string;
  games: number;
  stats: Record<SkillStatKey, number>;
}

export interface SkillStat {
  key: SkillStatKey;
  label: string;
  description: string;
  // Volume stats scale with games played (and can be shown per game); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  format: 'int' | 'dec1' | 'dec2' | 'pct';
  // Can go negative, so it's scaled against the league range instead of the max
  signed?: boolean;
  // Counts against the player (e.g. fumbles)
  negative?: boolean;
}

export type SkillWeights = Partial<Record<SkillStatKey, number>>;
export type SkillPreset = 'default' | 'volume' | 'efficiency';

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
  ],
  WR: RECEIVING_STATS,
  TE: RECEIVING_STATS,
};

// Default: everything at 50. Volume/Efficiency lean one way; penalties stay at 50.
export function presetWeights(position: SkillPosition, preset: SkillPreset): SkillWeights {
  const weights: SkillWeights = {};
  for (const stat of SKILL_STATS[position]) {
    weights[stat.key] =
      preset === 'default' || stat.negative ? 50 : stat.kind === preset ? 75 : 25;
  }
  return weights;
}
