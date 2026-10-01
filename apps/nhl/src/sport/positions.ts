import type { StatFormat } from '@ranker/engine/sport';
import { SKILL_PRESETS } from '@sport/skill-presets';

// The NHL tabs: centers, left wings, right wings, defensemen (the position the NHL lists for each
// player's season) and goalies
export type Position = 'C' | 'LW' | 'RW' | 'D' | 'G';
// Every tab uses the same config-driven table, sidebar and scoring below
export type SkillPosition = Position;

export const POSITIONS: Position[] = ['C', 'LW', 'RW', 'D', 'G'];

// Keys of the stats object in skill-players.json (scripts/update-data.mjs)
export type SkillStatKey =
  // His team's record (a goalie: his own decisions), W-L-OTL, and its points percentage
  | 'wins'
  | 'losses'
  | 'ties'
  | 'winPct'
  // Skaters: ice time (minutes per game) and the box score (season totals)
  | 'toi'
  | 'goals'
  | 'assists'
  | 'points'
  | 'plusMinus'
  | 'ppPoints'
  | 'shPoints'
  | 'gwg'
  | 'shots'
  | 'shootingPct'
  | 'pim'
  | 'hits'
  | 'blocks'
  | 'takeaways'
  | 'giveaways'
  | 'faceoffPct'
  // Skaters: advanced (MoneyPuck; on-ice shares at 5-on-5)
  | 'gameScore'
  | 'ixg'
  | 'goalsAboveX'
  | 'hdShots'
  | 'xgfPct'
  | 'cfPct'
  | 'xgfRel'
  // Goalies
  | 'gamesStarted'
  | 'savePct'
  | 'gaa'
  | 'shutouts'
  | 'saves'
  | 'gsax'
  | 'gsaxPer60'
  | 'hdSavePct'
  | 'xgaPer60'
  // Support grades (0 = F ... 12 = A+, see scripts/update-data.mjs)
  | 'linemates'
  | 'defense';

// Columns worked out in the app rather than read from the data
export type SkillColumnKey = SkillStatKey | 'games';

// How counting stats (goals, points, hits...) are shown and ranked: season totals, per game, or at a
// full season's pace (82 games). Per Game and the pace rank the same; they only read differently.
export type StatBasis = 'season' | 'perGame' | 'pace17';

export const STAT_BASIS_LABELS: Record<StatBasis, string> = {
  season: 'Season Totals',
  perGame: 'Per Game',
  pace17: 'Full-Season Pace',
};

// A full season: 82 games at every position
export const PACE_GAMES: Record<Position, number> = { C: 82, LW: 82, RW: 82, D: 82, G: 82 };

export interface SkillPlayer {
  // The NHL's player id (headshots), and the same as text
  id: number | null;
  gsisId: string;
  name: string;
  teamLogo: string;
  // The team's name that season (a traded player's last team)
  teamName?: string | null;
  games: number;
  // null when a stat doesn't apply (too small a sample, or MoneyPuck doesn't cover him), shown as "-"
  stats: Record<SkillStatKey, number | null>;
  // A rookie by the Calder Trophy's rule (the Rookies Only setting)
  rookie?: boolean;
  injured?: boolean;
  injuryStatus?: string;
  // Badges: cup (Stanley Cup), conf (conference champion), hart, vezina, norris, calder, selke, conn,
  // lindsay, rocket, artross
  awards?: string[];
}

// A player's stat (the engine passes the sport's settings; hockey has none that change a value)
export function unitStat(unit: SkillPlayer, key: SkillStatKey, _settings?: unknown): number | null {
  return unit.stats[key] ?? null;
}

export interface SkillStat {
  key: SkillColumnKey;
  label: string;
  description: string;
  // Volume stats scale with games played (and can be shown per game); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  // 'record' shows W-L-OTL from the wins / losses / ties stats while ranking on the stat's value;
  // pct: a 0-1 share shown as a whole percent; avg3: a three-place rate shown like ".915" (save
  // percentage)
  format: StatFormat;
  // Full name for hover text, when STAT_NAMES' name for the key doesn't fit this tab
  name?: string;
  // Counts against the player (giveaways, goals against)
  negative?: boolean;
  // The situation around him graded 0-12: better support is a (dampened) penalty, credit for doing
  // more with less
  support?: boolean;
  supportHelps?: boolean;
  // Shown for context only: no slider and no weight in the ranking
  infoOnly?: boolean;
  // A missing value ("-") means too small a sample, so it scores as the league average, not the worst
  missingIsAverage?: boolean;
}

// Stat names written out in full (label hover text)
export const STAT_NAMES: Partial<Record<SkillColumnKey, string>> = {
  winPct: "His Team's Record",
  toi: 'Time on Ice per Game (minutes)',
  goals: 'Goals',
  assists: 'Assists',
  points: 'Points',
  plusMinus: 'Plus/Minus',
  ppPoints: 'Power-Play Points',
  shPoints: 'Shorthanded Points',
  gwg: 'Game-Winning Goals',
  shots: 'Shots on Goal',
  shootingPct: 'Shooting Percentage',
  pim: 'Penalty Minutes',
  hits: 'Hits',
  blocks: 'Blocked Shots',
  takeaways: 'Takeaways',
  giveaways: 'Giveaways',
  faceoffPct: 'Faceoff Win Percentage',
  gameScore: 'Game Score (season total)',
  ixg: 'Individual Expected Goals',
  goalsAboveX: 'Goals Above Expected',
  hdShots: 'High-Danger Shots',
  xgfPct: 'Expected Goals Share (5-on-5, on ice)',
  cfPct: 'Shot Attempt Share, Corsi (5-on-5, on ice)',
  xgfRel: 'Relative Expected Goals Share (5-on-5, on ice minus off)',
  gamesStarted: 'Games Started',
  savePct: 'Save Percentage',
  gaa: 'Goals-Against Average',
  shutouts: 'Shutouts',
  saves: 'Saves',
  gsax: 'Goals Saved Above Expected',
  gsaxPer60: 'Goals Saved Above Expected per 60 Minutes',
  hdSavePct: 'High-Danger Save Percentage',
  xgaPer60: 'Expected Goals Against per 60 (the shots he faced)',
  linemates: 'His Linemates (the team without him)',
  defense: 'His Defense (the shots he faced)',
};

// Per-game column labels, when Stat Totals is on Per Game
export const PER_GAME_LABELS: Partial<Record<SkillColumnKey, string>> = {
  goals: 'G / GP',
  assists: 'A / GP',
  points: 'P / GP',
  shots: 'SOG / GP',
  hits: 'Hits / GP',
  blocks: 'BLK / GP',
  pim: 'PIM / GP',
  saves: 'SV / GP',
};

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
// 'default' (everything at 50), or a preset key from SKILL_PRESETS for the position
export type SkillPreset = string;

const GAMES_STAT: SkillStat = { key: 'games', label: 'Games', description: 'Games played (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true };
const RECORD_STAT: SkillStat = {
  key: 'winPct',
  label: 'Record',
  description: "His team's record, wins-losses-overtime losses (ranked on points percentage; a traded player: his last team's)",
  kind: 'efficiency',
  format: 'record',
};

// Skaters: the same columns at every skater tab; the presets (skill-presets.ts) weigh them by position.
// Centers also take faceoffs.
const SKATER_STATS: SkillStat[] = [
  GAMES_STAT,
  { key: 'toi', label: 'TOI', description: 'Time on ice per game, in minutes (for context: his role; not part of the ranking)', kind: 'efficiency', format: 'dec1', infoOnly: true },
  RECORD_STAT,
  { key: 'goals', label: 'G', description: 'Goals', kind: 'volume', format: 'int' },
  { key: 'assists', label: 'A', description: 'Assists', kind: 'volume', format: 'int' },
  { key: 'points', label: 'PTS', description: 'Points (goals + assists)', kind: 'volume', format: 'int' },
  { key: 'plusMinus', label: '+/-', description: "Even-strength and shorthanded goals for minus against while he's on the ice", kind: 'volume', format: 'int' },
  { key: 'ppPoints', label: 'PPP', description: 'Power-play points', kind: 'volume', format: 'int' },
  { key: 'shots', label: 'SOG', description: 'Shots on goal', kind: 'volume', format: 'int' },
  { key: 'shootingPct', label: 'SH %', description: 'Goals per shot on goal (20+ shots)', kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'gwg', label: 'GWG', description: 'Game-winning goals', kind: 'volume', format: 'int' },
  { key: 'hits', label: 'Hits', description: 'Hits', kind: 'volume', format: 'int' },
  { key: 'blocks', label: 'BLK', description: 'Shots blocked', kind: 'volume', format: 'int' },
  { key: 'takeaways', label: 'TK', description: 'Takeaways', kind: 'volume', format: 'int' },
  { key: 'giveaways', label: 'GV', description: 'Giveaways (lower is better)', kind: 'volume', format: 'int', negative: true },
  { key: 'pim', label: 'PIM', description: 'Penalty minutes (lower is better)', kind: 'volume', format: 'int', negative: true },
  { key: 'faceoffPct', label: 'FO %', description: 'Faceoffs won (50+ faceoffs)', kind: 'efficiency', format: 'pct', missingIsAverage: true },
  // (Game Score stays a season total under Per Game: a season's value, like WAR)
  { key: 'gameScore', label: 'Game Score', description: "His season in one number: goals, assists, shots, blocks, penalties, faceoffs and his line's shots and goals, weighted by what they're worth (MoneyPuck)", kind: 'efficiency', format: 'dec1', missingIsAverage: true },
  { key: 'xgfPct', label: 'xGF %', description: "His team's share of the expected goals while he's on the ice at 5-on-5 (shot quality, not just shots)", kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'xgfRel', label: 'Rel xGF %', description: "xGF % with him on the ice minus with him off, in points: how much better his team is with him out there", kind: 'efficiency', format: 'dec1', missingIsAverage: true },
  { key: 'cfPct', label: 'CF %', description: "His team's share of all shot attempts while he's on the ice at 5-on-5 (Corsi: who has the puck)", kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'ixg', label: 'ixG', description: 'Expected goals from his own shots: how many his chances were worth', kind: 'volume', format: 'dec1', missingIsAverage: true },
  { key: 'goalsAboveX', label: 'G - xG', description: 'Goals beyond what his chances were worth (finishing; luck over a short season)', kind: 'volume', format: 'dec1', missingIsAverage: true },
  { key: 'hdShots', label: 'HD Shots', description: 'High-danger shots: from the slot and in close', kind: 'volume', format: 'int', missingIsAverage: true },
  { key: 'linemates', label: 'Linemates', description: "The team around him: its expected-goal share at 5-on-5 with him off the ice", kind: 'efficiency', format: 'grade', support: true },
];

// Wingers and defensemen take few faceoffs: no column
const NO_FACEOFFS = SKATER_STATS.filter((stat) => stat.key !== 'faceoffPct');

// Goalies: their own decisions, the box score, and how they did against the shots they faced
const GOALIE_STATS: SkillStat[] = [
  GAMES_STAT,
  { key: 'gamesStarted', label: 'GS', description: 'Games started (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
  {
    key: 'winPct',
    label: 'Record',
    name: 'His Record',
    description: 'His decisions, wins-losses-overtime losses (ranked on points percentage)',
    kind: 'efficiency',
    format: 'record',
  },
  { key: 'savePct', label: 'SV %', description: 'Saves per shot on goal (50+ shots)', kind: 'efficiency', format: 'avg3', missingIsAverage: true },
  { key: 'gaa', label: 'GAA', description: 'Goals against per 60 minutes (lower is better)', kind: 'efficiency', format: 'dec2', negative: true },
  { key: 'shutouts', label: 'SO', description: 'Shutouts', kind: 'volume', format: 'int' },
  { key: 'saves', label: 'Saves', description: 'Saves', kind: 'volume', format: 'int' },
  // (GSAx stays a season total under Per Game: a season's value)
  { key: 'gsax', label: 'GSAx', description: "Goals saved above expected: the goals an average goalie would have allowed on his shots (by their quality), minus the goals he allowed (MoneyPuck)", kind: 'efficiency', format: 'dec1', missingIsAverage: true },
  { key: 'gsaxPer60', label: 'GSAx / 60', description: 'Goals saved above expected per 60 minutes (300+ minutes)', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'hdSavePct', label: 'HD SV %', description: 'Saves on high-danger shots, from the slot and in close (20+ of them)', kind: 'efficiency', format: 'avg3', missingIsAverage: true },
  {
    key: 'defense',
    label: 'Defense',
    description: "The team in front of him: the quality of the shots he faced, expected goals against per 60, graded (A+ is the stingiest)",
    kind: 'efficiency',
    format: 'grade',
    support: true,
  },
];

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = {
  C: SKATER_STATS,
  LW: NO_FACEOFFS,
  RW: NO_FACEOFFS,
  D: NO_FACEOFFS,
  G: GOALIE_STATS,
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
// Stat groups: the same groups (and colors) as the other sports
// ---------------------------------------------------------------------------
export type StatGroupId = 'results' | 'box' | 'advanced' | 'support';

export const STAT_GROUP_INFO: { id: StatGroupId; title: string; icon: string }[] = [
  { id: 'results', title: 'Results', icon: 'emoji_events' },
  { id: 'box', title: 'Basic Stats', icon: 'bar_chart' },
  { id: 'advanced', title: 'Advanced Stats', icon: 'insights' },
  { id: 'support', title: 'Support', icon: 'groups' },
];

const RESULTS_STATS = new Set<SkillColumnKey>(['games', 'toi', 'gamesStarted', 'winPct']);

// (Game Score and GSAx lead them: each position's all-in-one value number)
const ADVANCED_STATS = new Set<SkillColumnKey>([
  'gameScore',
  'xgfPct',
  'xgfRel',
  'cfPct',
  'ixg',
  'goalsAboveX',
  'hdShots',
  'gsax',
  'gsaxPer60',
  'hdSavePct',
]);

export function statGroup(stat: SkillStat): StatGroupId {
  if (stat.support) return 'support';
  if (RESULTS_STATS.has(stat.key)) return 'results';
  if (ADVANCED_STATS.has(stat.key)) return 'advanced';
  return 'box';
}

// A position's headline stats for the player card's Seasons tab: its first few basic stats (goals,
// assists, points; a goalie's save percentage, goals-against average and shutouts)
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
