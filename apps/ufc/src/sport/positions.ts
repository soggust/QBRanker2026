import type { StatFormat } from '@ranker/engine/sport';
import { SKILL_PRESETS } from '@sport/skill-presets';

// The UFC tabs: the eight men's divisions, heaviest first, and the three women's (shown with the
// Women's Divisions setting on). A fighter is in the division ESPN lists him in (his last fight's
// otherwise).
export type Position = 'HW' | 'LHW' | 'MW' | 'WW' | 'LW' | 'FW' | 'BW' | 'FLW' | 'WBW' | 'WFLW' | 'WSW';
// Every tab uses the same config-driven table, sidebar and scoring below
export type SkillPosition = Position;

export const POSITIONS: Position[] = ['HW', 'LHW', 'MW', 'WW', 'LW', 'FW', 'BW', 'FLW', 'WBW', 'WFLW', 'WSW'];
export const WOMENS_DIVISIONS: Position[] = ['WBW', 'WFLW', 'WSW'];

// Keys of the stats object in skill-players.json (scripts/update-data.mjs): his UFC career
export type SkillStatKey =
  // Record (wins-losses-draws, draws including no contests), and how his fights end
  | 'wins'
  | 'losses'
  | 'ties'
  | 'winPct'
  | 'streak'
  | 'finishRate'
  | 'finishes'
  | 'finished'
  | 'fightTime'
  // Striking (significant strikes; per minute of fight time) and knockdowns (per 15 minutes)
  | 'slpm'
  | 'sapm'
  | 'strAcc'
  | 'strDef'
  | 'strDiff'
  | 'kd15'
  | 'kdAgainst'
  // Grappling (per 15 minutes)
  | 'td15'
  | 'tdAcc'
  | 'tdDef'
  | 'sub15'
  | 'adv15'
  // Competition: an Elo rating over every UFC bout (now, and his best), wins over highly rated
  // opponents, and wins in five-round fights (title fights and main events)
  | 'elo'
  | 'peakElo'
  | 'qualityWins'
  | 'mainEventWins'
  // Context
  | 'schedule'
  | 'officialRank'
  | 'age'
  | 'reach';

// Columns worked out in the app rather than read from the data
export type SkillColumnKey = SkillStatKey | 'games' | 'recent';

// How counting stats are shown: career totals, per fight, or over a 10-fight stretch. (Most UFC stats
// are rates already: per minute, per 15 minutes, percentages.)
export type StatBasis = 'season' | 'perGame' | 'pace17';

export const STAT_BASIS_LABELS: Record<StatBasis, string> = {
  season: 'Career Totals',
  perGame: 'Per Fight',
  pace17: '10-Fight Pace',
};

export const PACE_GAMES: Record<Position, number> = { HW: 10, LHW: 10, MW: 10, WW: 10, LW: 10, FW: 10, BW: 10, FLW: 10, WBW: 10, WFLW: 10, WSW: 10 };

export interface SkillPlayer {
  // ESPN's fighter id (headshots), and the same as text
  id: number | null;
  gsisId: string;
  name: string;
  // His country's flag (ESPN's), and his gym
  teamLogo: string;
  teamName?: string | null;
  country?: string | null;
  // UFC fights
  games: number;
  stats: Record<SkillStatKey, number | null>;
  // His UFC debut came in the last year (the Rookies Only setting: the newcomers)
  rookie?: boolean;
  // No UFC fight in two years (listed with the Retired Fighters setting on)
  retired?: boolean;
  // His last five UFC results, newest first (1 win, 0.5 draw or no contest, 0 loss)
  lastFive?: number[];
  // His whole pro record ("27-1-0")
  pro?: string | null;
  // His UFC fights, newest first: [date, opponent, result, how it ended, event]
  fights?: [string, string, 'W' | 'L' | 'D', string, string][];
  injured?: boolean;
  injuryStatus?: string;
  // Badges: champ (his division's champion), p4p1-p4p15 (pound-for-pound rank)
  awards?: string[];
}

// A fighter's stat (the engine passes the sport's settings; none change a value)
export function unitStat(unit: SkillPlayer, key: SkillStatKey, _settings?: unknown): number | null {
  return unit.stats[key] ?? null;
}

export interface SkillStat {
  key: SkillColumnKey;
  label: string;
  description: string;
  // Volume stats scale with fights (and can be shown per fight); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  // 'record' shows W-L-D from the wins / losses / ties stats while ranking on the stat's value; pct: a
  // 0-1 share shown as a whole percent; recent: his last five results as dots; rank: UFC.com's rank
  format: StatFormat;
  // Full name for hover text, when STAT_NAMES' name for the key doesn't fit this tab
  name?: string;
  // Counts against him (strikes absorbed, being finished)
  negative?: boolean;
  support?: boolean;
  supportHelps?: boolean;
  // Shown for context only: no slider and no weight in the ranking
  infoOnly?: boolean;
  // A missing value ("-") means too small a sample, so it scores as the league average, not the worst
  missingIsAverage?: boolean;
}

// Stat names written out in full (label hover text)
export const STAT_NAMES: Partial<Record<SkillColumnKey, string>> = {
  games: 'UFC Fights',
  winPct: 'UFC Record',
  recent: 'Last Five UFC Fights',
  streak: 'Current Streak (wins +, losses -)',
  finishRate: 'Finish Rate (UFC wins inside the distance)',
  finishes: 'Finishes (UFC wins inside the distance)',
  finished: 'Times Finished (UFC losses inside the distance)',
  fightTime: 'Average Fight Time (minutes)',
  slpm: 'Significant Strikes Landed per Minute',
  sapm: 'Significant Strikes Absorbed per Minute',
  strAcc: 'Significant Strike Accuracy',
  strDef: 'Significant Strike Defense',
  strDiff: 'Striking Differential (landed minus absorbed per minute)',
  kd15: 'Knockdowns per 15 Minutes',
  kdAgainst: 'Knocked Down per 15 Minutes',
  td15: 'Takedowns per 15 Minutes',
  tdAcc: 'Takedown Accuracy',
  tdDef: 'Takedown Defense',
  sub15: 'Submission Attempts per 15 Minutes',
  adv15: 'Ground Advances per 15 Minutes',
  schedule: "Strength of Schedule (his UFC opponents' win percentage)",
  elo: 'Elo Rating (now)',
  peakElo: 'Peak Elo Rating',
  qualityWins: 'Quality Wins (over opponents rated in the top fifth going in)',
  mainEventWins: 'Five-Round Wins (title fights and main events)',
  officialRank: "UFC's Official Division Rank",
  age: 'Age',
  reach: 'Reach (inches)',
};

export const PER_GAME_LABELS: Partial<Record<SkillColumnKey, string>> = {
  qualityWins: 'Quality Wins / Fight',
  mainEventWins: '5-Rd Wins / Fight',
  finishes: 'Finishes / Fight',
  finished: 'Finished / Fight',
};

export type SkillWeights = Partial<Record<SkillColumnKey, number>>;
export type SkillPreset = string;

// Every division has the same columns; the presets (skill-presets.ts) weigh them
const UFC_STATS: SkillStat[] = [
  { key: 'games', label: 'Fights', description: 'UFC fights (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
  { key: 'winPct', label: 'Record', description: 'His UFC record, wins-losses-draws (draws include no contests; ranked on win percentage)', kind: 'efficiency', format: 'record' },
  { key: 'recent', label: 'Recent', description: 'His last five UFC fights, newest first (ranked on a recency-weighted win rate)', kind: 'efficiency', format: 'recent' },
  { key: 'officialRank', label: 'UFC Rank', description: "UFC.com's official rank in his division (for context; not part of the ranking; the champion wears the belt)", kind: 'efficiency', format: 'rank', infoOnly: true },
  // (the competition ones: results weighed by whom they came against)
  { key: 'elo', label: 'Elo', description: "A rating built from every UFC fight since 2001: each result moves it by how surprising it was, so beating a highly rated opponent is worth far more than beating a low one (1500 to start)", kind: 'efficiency', format: 'int' },
  { key: 'peakElo', label: 'Peak Elo', description: 'His best Elo rating at any point in his UFC career', kind: 'efficiency', format: 'int' },
  { key: 'qualityWins', label: 'Quality Wins', description: 'Wins over opponents rated in the top fifth of UFC fighters (by Elo) going into the fight', kind: 'volume', format: 'int' },
  { key: 'mainEventWins', label: '5-Rd Wins', description: 'Wins in five-round fights: title fights and main events', kind: 'volume', format: 'int' },
  { key: 'streak', label: 'Streak', description: 'His current run: +3 is three straight wins, -2 two straight losses', kind: 'efficiency', format: 'int' },
  { key: 'finishRate', label: 'Finish %', description: 'Share of his UFC wins that ended inside the distance (knockout or submission)', kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'finishes', label: 'Finishes', description: 'UFC wins inside the distance', kind: 'volume', format: 'int' },
  { key: 'finished', label: 'Finished', description: 'UFC losses inside the distance (lower is better)', kind: 'volume', format: 'int', negative: true },
  { key: 'slpm', label: 'Strikes / Min', description: 'Significant strikes landed per minute', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'strAcc', label: 'Strike Acc', description: 'Significant strikes landed per attempt (50+ attempts)', kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'sapm', label: 'Absorbed / Min', description: 'Significant strikes absorbed per minute (lower is better)', kind: 'efficiency', format: 'dec2', negative: true, missingIsAverage: true },
  { key: 'strDef', label: 'Strike Def', description: "Opponents' significant strikes he avoided (50+ thrown at him)", kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'kd15', label: 'KD / 15', description: 'Knockdowns per 15 minutes: power', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'td15', label: 'TD / 15', description: 'Takedowns landed per 15 minutes', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'tdAcc', label: 'TD Acc', description: 'Takedowns landed per attempt (5+ attempts)', kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'tdDef', label: 'TD Def', description: "Opponents' takedowns he stopped (5+ attempted on him)", kind: 'efficiency', format: 'pct', missingIsAverage: true },
  { key: 'sub15', label: 'Sub Att / 15', description: 'Submission attempts per 15 minutes', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  // (the differential leads the advanced ones: the striking battle in one number)
  { key: 'strDiff', label: 'Strike Diff', description: 'Significant strikes landed minus absorbed, per minute: who wins the striking', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'kdAgainst', label: 'KD Against', description: 'Times knocked down per 15 minutes: his chin (lower is better)', kind: 'efficiency', format: 'dec2', negative: true, missingIsAverage: true },
  { key: 'adv15', label: 'Adv / 15', description: 'Ground position advances (to the back, mount, side or half guard) per 15 minutes: control on the mat', kind: 'efficiency', format: 'dec2', missingIsAverage: true },
  { key: 'schedule', label: 'Schedule', description: "His UFC opponents' UFC win percentage: who he's beaten and lost to (3+ fights each; others count as .500)", kind: 'efficiency', format: 'pct' },
  { key: 'fightTime', label: 'Avg Time', description: 'Average fight time, in minutes (for context; not part of the ranking)', kind: 'efficiency', format: 'dec1', infoOnly: true },
  { key: 'age', label: 'Age', description: 'Age (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
  { key: 'reach', label: 'Reach', description: 'Reach, in inches (for context; not part of the ranking)', kind: 'efficiency', format: 'int', infoOnly: true },
];

export const SKILL_STATS: Record<SkillPosition, SkillStat[]> = Object.fromEntries(POSITIONS.map((p) => [p, UFC_STATS])) as Record<
  SkillPosition,
  SkillStat[]
>;

// Default: everything at 50. A preset (skill-presets.ts) sets the stats it's named for, keeps every
// other stat at 25 as a tiebreaker.
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
// Stat groups: Results, Striking (the basic group) and Grappling (the advanced group's place)
// ---------------------------------------------------------------------------
export type StatGroupId = 'results' | 'box' | 'advanced' | 'support';

export const STAT_GROUP_INFO: { id: StatGroupId; title: string; icon: string }[] = [
  { id: 'results', title: 'Results', icon: 'emoji_events' },
  { id: 'box', title: 'Striking', icon: 'sports_mma' },
  { id: 'advanced', title: 'Grappling', icon: 'sports_kabaddi' },
  { id: 'support', title: 'Context', icon: 'insights' },
];

const RESULTS_STATS = new Set<SkillColumnKey>([
  'games',
  'winPct',
  'recent',
  'officialRank',
  'elo',
  'peakElo',
  'qualityWins',
  'mainEventWins',
  'streak',
  'finishRate',
  'finishes',
  'finished',
]);
const STRIKING_STATS = new Set<SkillColumnKey>(['slpm', 'strAcc', 'sapm', 'strDef', 'kd15', 'strDiff', 'kdAgainst']);
const GRAPPLING_STATS = new Set<SkillColumnKey>(['td15', 'tdAcc', 'tdDef', 'sub15', 'adv15']);

export function statGroup(stat: SkillStat): StatGroupId {
  if (RESULTS_STATS.has(stat.key)) return 'results';
  if (STRIKING_STATS.has(stat.key)) return 'box';
  if (GRAPPLING_STATS.has(stat.key)) return 'advanced';
  return 'support';
}

// The card's headline stats (no Seasons tab for the UFC: kept for the engine)
export function headlineStats(position: SkillPosition, count = 3): SkillStat[] {
  return SKILL_STATS[position].filter((stat) => statGroup(stat) === 'box').slice(0, count);
}

export interface SkillStatGroup {
  id: StatGroupId;
  title: string;
  icon: string;
  stats: SkillStat[];
}

// A division's groups, in the standard order
export function skillGroups(position: SkillPosition): SkillStatGroup[] {
  return STAT_GROUP_INFO.map((info) => ({
    ...info,
    stats: SKILL_STATS[position].filter((stat) => statGroup(stat) === info.id),
  })).filter((group) => group.stats.length);
}
