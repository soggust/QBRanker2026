import type { SportSettings, StatFormat } from '@ranker/engine/sport';
import { SKILL_PRESETS } from '@sport/skill-presets';

// The UFC tabs: pound-for-pound (every man, his whole UFC career), the eight men's divisions, heaviest
// first, and the women's pound-for-pound and three divisions (shown with the Women's Divisions setting
// on). A fighter is in the division ESPN lists him in (his last fight's otherwise) and any other he's
// had 3+ fights in, on his fights there.
export type Position = 'P4P' | 'HW' | 'LHW' | 'MW' | 'WW' | 'LW' | 'FW' | 'BW' | 'FLW' | 'WP4P' | 'WBW' | 'WFLW' | 'WSW';
// Every tab uses the same config-driven table, sidebar and scoring below
export type SkillPosition = Position;

export const POSITIONS: Position[] = ['P4P', 'HW', 'LHW', 'MW', 'WW', 'LW', 'FW', 'BW', 'FLW', 'WP4P', 'WBW', 'WFLW', 'WSW'];
export const WOMENS_DIVISIONS: Position[] = ['WP4P', 'WBW', 'WFLW', 'WSW'];

// The footer dropdown's choice (the 'era' setting): today's roster or every era, men's or women's
// ("current", "currentW", "alltime", "alltimeW")
export const allTime = (settings: SportSettings) => String(settings['era']).startsWith('alltime');
export const womens = (settings: SportSettings) => String(settings['era']).endsWith('W');

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
  // Title fights: wins (taking a belt, interim ones too, and each defense) and successful defenses
  | 'titleWins'
  | 'titleDefenses'
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

export const PACE_GAMES: Record<Position, number> = { P4P: 10, WP4P: 10, HW: 10, LHW: 10, MW: 10, WW: 10, LW: 10, FW: 10, BW: 10, FLW: 10, WBW: 10, WFLW: 10, WSW: 10 };

export interface SkillPlayer {
  // ESPN's fighter id (headshots), and the same as text
  id: number | null;
  gsisId: string;
  name: string;
  // His country's flag (ESPN's), and his gym
  teamLogo: string;
  teamName?: string | null;
  country?: string | null;
  // UFC fights (in the tab's division; all of them on pound-for-pound)
  games: number;
  // Every UFC fight he's had (the Fights filter counts these)
  careerGames?: number;
  // The division the row's belt and stats are for (his own, or the one he holds, on pound-for-pound)
  division?: string;
  // A division he's fought in (3+ fights) but isn't in now (shown among all-time fighters only)
  pastDivision?: boolean;
  // No UFC fight in the last year (out of the UFC's rankings for that: no rank counts as average)
  inactive?: boolean;
  // Pound-for-pound rows: what his rank counts as in the ranking, 0-16 (the P4P top 15, then his
  // division rank behind them; null: neither)
  rankScore?: number | null;
  // The champion of this tab's division (his UFC rank counts as #0)
  titleHolder?: boolean;
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
  // Counts for more behind its slider (2: double at every step, 50% included; 0% still off): the
  // title stats, Elo and Recent, the clearest marks of an elite career; the UFC's rank far more (15:
  // the UFC's own order leads among current fighters), less (3) in the all-time lists, where the legends
  // have none
  boost?: number | ((settings: SportSettings) => number);
  // Scored on a fixed scale, best to worst, rather than against the list (the UFC's rank: #0, the
  // champion, to #16, unranked; title wins and defenses: 10 to 0, since with most fighters at none, one
  // would score like ten against the list)
  scale?: [best: number, worst: number];
  // Not a rate resting on his fights, so not scaled by how many he's had (the UFC's rank)
  settled?: boolean;
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
  titleWins: 'Title Fight Wins (winning a belt, interim ones too, and each defense)',
  titleDefenses: 'Successful Title Defenses',
  officialRank: "UFC's Official Division Rank",
  age: 'Age',
  reach: 'Reach (inches)',
};

export const PER_GAME_LABELS: Partial<Record<SkillColumnKey, string>> = {
  qualityWins: 'Quality Wins / Fight',
  titleWins: 'Title Wins / Fight',
  titleDefenses: 'Defenses / Fight',
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
  { key: 'recent', label: 'Recent', description: 'His last five UFC fights, newest first (ranked on a recency-weighted win rate); counts double behind its slider', kind: 'efficiency', format: 'recent', boost: 2 },
  { key: 'officialRank', label: 'UFC Rank', description: "UFC.com's official rank in his division, or pound-for-pound on those tabs (a division's champion is #0, above #1; unranked fighters as #16; retired ones as average); counts 15x behind its slider among current fighters, 3x in the all-time lists", kind: 'efficiency', format: 'rank', negative: true, missingIsAverage: true, scale: [0, 16], settled: true, boost: (settings) => (allTime(settings) ? 3 : 15) },
  // (the title ones and Elo count double behind their sliders: the clearest marks of an elite career)
  { key: 'titleDefenses', label: 'Title Defenses', description: 'Successful UFC title defenses, across every reign (from Wikipedia\'s list of UFC champions); counts double behind its slider; scored in proportion, 0 to 10 (most fighters have none, so against the list one defense would score like ten)', kind: 'volume', format: 'int', boost: 2, scale: [10, 0] },
  { key: 'titleWins', label: 'Title Wins', description: 'UFC title fight wins: winning a belt (interim ones too) and each defense; counts double behind its slider; scored in proportion, 0 to 10', kind: 'volume', format: 'int', boost: 2, scale: [10, 0] },
  // (the competition ones: results weighed by whom they came against)
  { key: 'elo', label: 'Elo', description: "A rating built from every UFC fight since 2001: each result moves it by how surprising it was, so beating a highly rated opponent is worth far more than beating a low one (1500 to start); counts double behind its slider", kind: 'efficiency', format: 'int', boost: 2 },
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
  'titleWins',
  'titleDefenses',
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
