import { SKILL_PRESETS } from 'app/skill-presets';

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'K' | 'P' | 'DEF' | 'HC';
// Everything except QB, which has its own page; all use the config-driven table below
// (OL rows are team offensive lines, DEF rows team defenses and HC rows head coaches)
export type SkillPosition = Exclude<Position, 'QB'>;

export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'K', 'P', 'DEF', 'HC'];

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
  | 'drops'
  | 'pressureRate'
  | 'missedTacklePct'
  | 'thirdDownPct'
  | 'redZoneTdPct'
  | 'fgOverExp'
  | 'fairCatchPct'
  | 'oneScoreWinPct'
  | 'penaltiesPerGame'
  | 'fourthDownGoPct'
  | 'turnoverDiffPerGame'
  // Offensive lines
  | 'sacksAllowed'
  | 'qbHitsAllowed'
  | 'sackRate'
  | 'stuffRate'
  | 'yardsBeforeContact'
  | 'runEpa'
  | 'runSuccess'
  | 'shortYardagePct'
  | 'linePenaltiesPerGame'
  | 'timeToThrow';

// Columns computed in the app: fantasy points in the chosen scoring, and team support grades
export type SkillColumnKey =
  | SkillStatKey
  | 'fantasy'
  | 'oline'
  | 'weapons'
  | 'qbPlay'
  | 'rbPlay'
  | 'coaching'
  | 'defense'
  | 'games'
  | 'totalYards';

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
  // The play-by-play stats without garbage time (win probability under 10% or over 90%)
  competitive?: Partial<Record<SkillStatKey, number | null>>;
  // From ESPN's injury report (Out, Doubtful or Injured Reserve); players only, not units
  injured?: boolean;
  injuryStatus?: string;
}

// A unit's stat, without garbage time when the Garbage Time Stats setting is off (stats that aren't
// built from play-by-play have no filtered copy and stay the same)
export function unitStat(unit: SkillPlayer, key: SkillStatKey, garbageTime: boolean): number | null {
  if (!garbageTime && unit.competitive && key in unit.competitive) return unit.competitive[key] ?? null;
  return unit.stats[key];
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
  // A missing value ("-") means no chances yet, so it scores as the league average, not the worst
  missingIsAverage?: boolean;
}

// Stat names written out in full (label hover text)
export const STAT_NAMES: Partial<Record<SkillColumnKey, string>> = {
  games: 'Games Played',
  totalYards: 'Total Rushing + Receiving Yards',
  fantasy: 'Fantasy Points',
  oline: 'Offensive Line Grade',
  weapons: 'Weapons Grade',
  qbPlay: 'Quarterback Play Grade',
  rbPlay: 'Running Back Play Grade',
  coaching: 'Coaching Grade',
  defense: 'Defense Grade',
  targets: 'Targets',
  targetShare: 'Target Share',
  receptions: 'Receptions',
  recYards: 'Receiving Yards',
  recTds: 'Receiving Touchdowns',
  rushTds: 'Rushing Touchdowns',
  yac: 'Yards After Catch',
  catchPct: 'Catch Percentage',
  epaPerTarget: 'Expected Points Added per Target',
  separation: 'Average Separation',
  yacOverExp: 'Yards After Catch Over Expected',
  adot: 'Average Depth of Target',
  airYardsShare: 'Air Yards Share',
  dropPct: 'Drop Percentage',
  drops: 'Dropped Passes',
  snapShare: 'Snap Percentage',
  carries: 'Carries',
  rushYards: 'Rushing Yards',
  ypc: 'Yards per Carry',
  totalTds: 'Total Rushing + Receiving Touchdowns',
  firstDowns: 'First Downs',
  epaPerCarry: 'Expected Points Added per Carry',
  ryoePerAtt: 'Rush Yards Over Expected per Carry',
  yacoPerCarry: 'Yards After Contact per Carry',
  brokenTackles: 'Broken Tackles',
  fumbles: 'Fumbles Lost',
  fgAtt: 'Field Goal Attempts',
  fgMade: 'Field Goals Made',
  fgPct: 'Field Goal Percentage',
  fg50: '50+ Yard Field Goals Made',
  fgLong: 'Longest Field Goal',
  patPct: 'Extra Point Percentage',
  epaPerKick: 'Expected Points Added per Kick',
  fgOverExp: 'Field Goal Percentage Over Expected',
  punts: 'Punts',
  grossAvg: 'Gross Punting Average',
  netAvg: 'Net Punting Average',
  inside20: 'Punts Inside the 20',
  inside20Pct: 'Inside the 20 Percentage',
  epaPerPunt: 'Expected Points Added per Punt',
  touchbacks: 'Touchbacks',
  fairCatchPct: 'Fair Catch Percentage',
  epaAllowed: 'Expected Points Added per Play Allowed',
  passEpaAllowed: 'Expected Points Added per Pass Play Allowed',
  rushEpaAllowed: 'Expected Points Added per Run Play Allowed',
  successAllowed: 'Success Rate Allowed',
  sacks: 'Sacks',
  pressureRate: 'Pressure Rate',
  takeaways: 'Takeaways',
  ptsAllowedPerGame: 'Points Allowed per Game',
  thirdDownPct: 'Third Down Conversion Rate Allowed',
  redZoneTdPct: 'Red Zone Touchdown Rate Allowed',
  missedTacklePct: 'Missed Tackle Percentage',
  winPct: 'Record',
  winsOverExpected: 'Wins Over Expected',
  atsPct: 'Against the Spread Win Percentage',
  pointDiffPerGame: 'Point Differential per Game',
  netEpa: 'Net Expected Points Added per Play',
  oneScoreWinPct: 'One-Score Game Win Percentage',
  penaltiesPerGame: 'Penalties per Game',
  fourthDownGoPct: 'Fourth-Down Go-For-It Rate',
  turnoverDiffPerGame: 'Turnover Differential per Game',
  sacksAllowed: 'Sacks Allowed',
  qbHitsAllowed: 'QB Hits Allowed',
  sackRate: 'Sack Rate Allowed',
  stuffRate: 'Stuffed Run Rate',
  yardsBeforeContact: 'Yards Before Contact per Carry',
  runEpa: 'Expected Points Added per Designed Run',
  runSuccess: 'Designed Run Success Rate',
  shortYardagePct: 'Short-Yardage Run Conversion Rate',
  linePenaltiesPerGame: 'Blocking Penalties per Game',
  timeToThrow: 'QB Time to Throw (Seconds)',
};

// Short labels for volume stats when Per-Game Stats is on (yards read as YPG, points as PPG)
export const PER_GAME_LABELS: Partial<Record<SkillColumnKey, string>> = {
  totalYards: 'Total YPG',
  rushYards: 'Rush YPG',
  recYards: 'Rec YPG',
  fantasy: 'Fantasy PPG',
  targets: 'Targets / Game',
  receptions: 'Rec / Game',
  recTds: 'Rec TDs / Game',
  rushTds: 'Rush TDs / Game',
  totalTds: 'Total TDs / Game',
  yac: 'YAC / Game',
  carries: 'Carries / Game',
  firstDowns: '1st Dn / Game',
  brokenTackles: 'Brk Tkl / Game',
  fumbles: 'Fum Lost / Game',
  drops: 'Drops / Game',
  fgMade: 'FG Made / Game',
  fgAtt: 'FG Att / Game',
  fg50: '50+ Made / Game',
  punts: 'Punts / Game',
  inside20: 'Inside 20 / Game',
  touchbacks: 'TBs / Game',
  sacks: 'Sacks / Game',
  takeaways: 'TOs / Game',
  sacksAllowed: 'Sacks / Game',
  qbHitsAllowed: 'QB Hits / Game',
};

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
// 'default' (everything at 50), or a preset key from SKILL_PRESETS for the position
export type SkillPreset = string;

// Games played: the first column on every player / unit tab, for sample-size context
const GAMES_STAT: SkillStat = {
  key: 'games',
  label: 'Games',
  description: 'Games played (for context; not part of the ranking)',
  kind: 'efficiency',
  format: 'int',
  infoOnly: true,
};

// Columns shown in place of a rushing + receiving pair when Combined Rush/Pass is on (display only:
// ranking still uses the two sliders, like the QB page)
export const TOTAL_YARDS_STAT: SkillStat = {
  key: 'totalYards',
  label: 'Total Yds',
  description: 'Rushing + receiving yards',
  kind: 'volume',
  format: 'int',
};

export const TOTAL_TDS_STAT: SkillStat = {
  key: 'totalTds',
  label: 'Total TDs',
  description: 'Rushing + receiving touchdowns',
  kind: 'volume',
  format: 'int',
};

// Each combined column and the two stats it stands in for (it takes the first one's spot). In the
// sidebar the pair is one parent slider (labeled like the combined column) with the two as its
// breakdown, like the QB page:
// the parent's weight scales both parts (50 = as set), and its eye hides all three columns.
export const COMBINED_STATS: { stat: SkillStat; parts: [SkillColumnKey, SkillColumnKey] }[] = [
  { stat: TOTAL_YARDS_STAT, parts: ['rushYards', 'recYards'] },
  { stat: TOTAL_TDS_STAT, parts: ['rushTds', 'recTds'] },
];

// The combined pairs a position has both parts of
export function combinedFor(position: SkillPosition) {
  return COMBINED_STATS.filter(({ parts }) => parts.every((part) => SKILL_STATS[position].some((s) => s.key === part)));
}

const FANTASY_STAT: SkillStat = {
  key: 'fantasy',
  label: 'Fantasy Pts',
  description: 'Fantasy points (scoring set in the settings menu)',
  kind: 'volume',
  format: 'dec1',
};

// Team QB grade from the QB rankings: a support grade for receivers, runners (a good QB keeps
// defenses honest) and defenses (field position, time of possession)
const QB_PLAY_STAT: SkillStat = {
  key: 'qbPlay',
  label: 'QB Play',
  description: "Team QB grade from the current QB rankings, weighted by each QB's starts",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Team O-line grade (preseason blended with the Offensive Lines rankings)
const OLINE_STAT: SkillStat = {
  key: 'oline',
  label: 'O-Line',
  description: 'Team O-line grade (preseason blended with the Offensive Lines rankings)',
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Team weapons grade (preseason blended with the RB, WR and TE rankings)
const WEAPONS_STAT: SkillStat = {
  key: 'weapons',
  label: 'Weapons',
  description: 'Team weapons grade (preseason blended with the RB, WR and TE rankings)',
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Team RB grade from the RB rankings: a support grade for offensive lines (a good back makes the
// run blocking look better)
const RB_PLAY_STAT: SkillStat = {
  key: 'rbPlay',
  label: 'RB Play',
  description: "Team RB grade from the current RB rankings, weighted by each back's carries",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Team coaching grade (preseason blended with the Head Coaches rankings, like the QB page)
const COACHING_STAT: SkillStat = {
  key: 'coaching',
  label: 'Coaching',
  description: "Team coaching grade (preseason blended with the Head Coaches rankings)",
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Team defense grade from the Defenses rankings (like the QB page)
const DEFENSE_STAT: SkillStat = {
  key: 'defense',
  label: 'Defense',
  description: 'Team defense grade from the current Defenses rankings',
  kind: 'efficiency',
  format: 'grade',
  support: true,
};

// Fumbles lost (rushing + receiving): counts against RBs, WRs and TEs
const FUMBLES_STAT: SkillStat = {
  key: 'fumbles',
  label: 'Fumbles Lost',
  description: 'Fumbles lost',
  kind: 'volume',
  format: 'int',
  negative: true,
};

// Charted drops (Pro Football Reference): counts against RBs, WRs and TEs. Players with no targets
// yet, or that PFR doesn't chart, score as average rather than best or worst.
const DROPS_STAT: SkillStat = {
  key: 'drops',
  label: 'Drops',
  description: 'Catchable passes dropped, as charted by Pro Football Reference (lower is better)',
  kind: 'volume',
  format: 'int',
  negative: true,
  missingIsAverage: true,
};

// Passing-game role and efficiency: WR/TE, and RBs' receiving side
const TARGETS_STAT: SkillStat = { key: 'targets', label: 'Targets', description: 'Times targeted', kind: 'volume', format: 'int' };

const TARGET_SHARE_STAT: SkillStat = {
  key: 'targetShare',
  label: 'Target Share',
  description: "Share of the team's targets",
  kind: 'efficiency',
  format: 'pct',
};

const EPA_PER_TARGET_STAT: SkillStat = {
  key: 'epaPerTarget',
  label: 'EPA / Target',
  description: 'Expected Points Added per target',
  kind: 'efficiency',
  format: 'dec2',
  signed: true,
};

const RECEIVING_STATS: SkillStat[] = [
  GAMES_STAT,
  { key: 'receptions', label: 'Receptions', description: 'Catches', kind: 'volume', format: 'int' },
  TARGETS_STAT,
  TARGET_SHARE_STAT,
  { key: 'recYards', label: 'Rec Yards', description: 'Receiving yards', kind: 'volume', format: 'int' },
  { key: 'rushYards', label: 'Rush Yards', description: 'Rushing yards', kind: 'volume', format: 'int' },
  { key: 'yac', label: 'YAC', description: 'Yards after the catch', kind: 'volume', format: 'int' },
  { key: 'recTds', label: 'Rec TDs', description: 'Receiving touchdowns', kind: 'volume', format: 'int' },
  { key: 'rushTds', label: 'Rush TDs', description: 'Rushing touchdowns', kind: 'volume', format: 'int' },
  FUMBLES_STAT,
  DROPS_STAT,
  EPA_PER_TARGET_STAT,
  { key: 'catchPct', label: 'Catch %', description: 'Receptions per target', kind: 'efficiency', format: 'pct' },
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
    key: 'dropPct',
    label: 'Drop %',
    description: 'Drops per target (lower is better)',
    kind: 'efficiency',
    format: 'pct',
    negative: true,
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
    key: 'snapShare',
    label: 'Snap %',
    description: 'Average share of offensive snaps played',
    kind: 'efficiency',
    format: 'pct',
  },
  FANTASY_STAT,
  QB_PLAY_STAT,
];

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = {
  RB: [
    GAMES_STAT,
    { key: 'carries', label: 'Carries', description: 'Rushing attempts', kind: 'volume', format: 'int' },
    { key: 'rushYards', label: 'Rush Yards', description: 'Rushing yards', kind: 'volume', format: 'int' },
    { key: 'ypc', label: 'Yds / Carry', description: 'Yards per carry', kind: 'efficiency', format: 'dec1' },
    { key: 'receptions', label: 'Receptions', description: 'Catches', kind: 'volume', format: 'int' },
    // Receiving role, so pass-catching backs get their due (EPA / Target sits in Advanced)
    TARGETS_STAT,
    TARGET_SHARE_STAT,
    { key: 'recYards', label: 'Rec Yards', description: 'Receiving yards', kind: 'volume', format: 'int' },
    { key: 'rushTds', label: 'Rush TDs', description: 'Rushing touchdowns', kind: 'volume', format: 'int' },
    { key: 'recTds', label: 'Rec TDs', description: 'Receiving touchdowns', kind: 'volume', format: 'int' },
    FUMBLES_STAT,
    DROPS_STAT,
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
    EPA_PER_TARGET_STAT,
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
    FANTASY_STAT,
    QB_PLAY_STAT,
    OLINE_STAT,
  ],
  WR: RECEIVING_STATS,
  TE: RECEIVING_STATS,
  K: [
    GAMES_STAT,
    { key: 'fgMade', label: 'FG Made', description: 'Field goals made', kind: 'volume', format: 'int' },
    // Context for FG Made and FG %: shown, but no slider and no weight in the ranking
    { key: 'fgAtt', label: 'FG Att', description: 'Field goal attempts (for context; not part of the ranking)', kind: 'volume', format: 'int', infoOnly: true },
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
    QB_PLAY_STAT,
    COACHING_STAT,
  ],
  // Lower is better for everything "allowed", and for stuffs and penalties
  OL: [
    GAMES_STAT,
    {
      key: 'sacksAllowed',
      label: 'Sacks',
      description: 'Sacks allowed (lower is better)',
      kind: 'volume',
      format: 'int',
      negative: true,
    },
    {
      key: 'qbHitsAllowed',
      label: 'QB Hits',
      description: 'QB hits allowed, sacks included (lower is better)',
      kind: 'volume',
      format: 'int',
      negative: true,
    },
    { key: 'ypc', label: 'Yds / Carry', description: 'Yards per designed run', kind: 'efficiency', format: 'dec1', signed: true },
    {
      key: 'stuffRate',
      label: 'Stuff %',
      description: 'Share of designed runs stopped at or behind the line (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    {
      key: 'shortYardagePct',
      label: 'Short Yd %',
      description: 'Conversion rate on 3rd and 4th and 1-2 runs',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      missingIsAverage: true,
    },
    {
      key: 'linePenaltiesPerGame',
      label: 'Penalties / Game',
      description: 'Holding, false starts and other blocking penalties per game (lower is better)',
      kind: 'efficiency',
      format: 'dec1',
      signed: true,
      negative: true,
    },
    {
      key: 'runEpa',
      label: 'Run EPA',
      description: 'Expected Points Added per designed run',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'runSuccess',
      label: 'Run Success %',
      description: 'Share of designed runs with positive EPA',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
    },
    {
      key: 'pressureRate',
      label: 'Pressure %',
      description: 'Pressures allowed per dropback (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    {
      key: 'sackRate',
      label: 'Sack %',
      description: 'Sacks allowed per dropback (lower is better)',
      kind: 'efficiency',
      format: 'pct',
      signed: true,
      negative: true,
    },
    {
      key: 'yardsBeforeContact',
      label: 'YBC / Carry',
      description: 'Yards before first contact per carry',
      kind: 'efficiency',
      format: 'dec2',
      signed: true,
    },
    {
      key: 'timeToThrow',
      label: 'Time to Throw',
      description: 'QB seconds from snap to throw: quick passers make a line look better (for context; not part of the ranking)',
      kind: 'efficiency',
      format: 'dec2',
      infoOnly: true,
    },
    QB_PLAY_STAT,
    RB_PLAY_STAT,
    COACHING_STAT,
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
      key: 'turnoverDiffPerGame',
      label: 'TO Diff / Game',
      description: 'Takeaways minus giveaways per game',
      kind: 'efficiency',
      format: 'dec1',
      signed: true,
    },
    {
      key: 'fourthDownGoPct',
      label: '4th Down Go %',
      description: 'How often the team goes for it on 4th and 1-2 at midfield or beyond (outside blowouts)',
      kind: 'efficiency',
      format: 'pct',
      missingIsAverage: true,
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
    QB_PLAY_STAT,
    WEAPONS_STAT,
    OLINE_STAT,
    DEFENSE_STAT,
  ],
};

export function hasFantasy(position: SkillPosition): boolean {
  return SKILL_STATS[position].some((stat) => stat.key === 'fantasy');
}

// Default: everything at 50. A preset (skill-presets.ts) sets the stats it's named for, keeps every
// other stat at 25, and leaves support grades and the parent Total Yds / Total TDs sliders at 50.
// Fantasy ranks purely on fantasy points.
export function presetWeights(position: SkillPosition, preset: SkillPreset): SkillWeights {
  const def = SKILL_PRESETS[position].find((p) => p.key === preset);
  const fantasyOnly = preset === 'fantasy';
  const weights: SkillWeights = {};
  for (const stat of SKILL_STATS[position]) {
    if (stat.infoOnly) continue;
    if (fantasyOnly) weights[stat.key] = 0;
    else if (!def || stat.support) weights[stat.key] = 50;
    else weights[stat.key] = 25;
  }
  for (const { stat } of combinedFor(position)) weights[stat.key] = fantasyOnly ? 0 : 50;
  return { ...weights, ...(def?.weights ?? {}) };
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
  'fourthDownGoPct',
  'epaPerCarry',
  'ryoePerAtt',
  'yacoPerCarry',
  'brokenTackles',
  'snapShare',
  'epaPerTarget',
  'catchPct',
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
  'sackRate',
  'yardsBeforeContact',
  'runEpa',
  'runSuccess',
  'timeToThrow',
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
