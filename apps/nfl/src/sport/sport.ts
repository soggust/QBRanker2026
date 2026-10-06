import type { CardFlag, FlagContext, GameLogChart, SportConfig } from '@ranker/engine/sport';
import { espnGameLog, espnTeamGameLog } from '@ranker/core/game-logs';
import {
  FANTASY_SCORING_LABELS,
  FantasyScoring,
  RANK_BASIS_LABELS,
  RANK_METRICS,
  RankBasis,
  STAT_NAMES,
  SkillPlayer,
  SkillPosition,
  SkillStatKey,
  combinedFor,
  statLabelFor,
  unitStat,
} from './positions';
import { DATA } from '@ranker/engine/data';
import { CAST_GRADES, GARBAGE_TIME_STAT } from './skills';
import { buildQbUnits } from './qb-rows';
import { OLINE_LEAN, computedValue, connectTeamGrades, fromOtherTabs } from './team-grades';
import { blockingExtras } from './blocking';

// NFL: what the engine needs to know about football (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/, and the NFL's own features:
// qb-rows (the QBs, built from games.json), team-grades (fantasy points, unit ranks and the team
// grades each tab gets from the others) and blocking (the card's run blocking))

// The defenses, offensive lines and head coaches: rows that are a whole team's
const TEAM_TABS = ['TM', 'DEF', 'OL', 'HC'];

// The Teams tab's rows: the season's head coach rows (one per team, its whole season), named for the
// team (its defense's row has the team's name)
function teamRows(): SkillPlayer[] {
  const rows = DATA.skillPlayers as Record<string, SkillPlayer[]>;
  const names = new Map((rows['DEF'] ?? []).map((unit) => [unit.teamLogo, unit.name]));
  return (rows['HC'] ?? []).map((coach) => ({
    ...coach,
    id: null,
    gsisId: `TM-${coach.teamLogo.split('/').pop()!.replace('.png', '')}`,
    name: names.get(coach.teamLogo) ?? coach.teamLogo.split('/').pop()!.replace('.png', ''),
    // (the team's last five games: the Recent column)
    lastFive: (coach as { teamLastFive?: number[] }).teamLastFive,
    lastFiveVs: (coach as { teamLastFiveVs?: (string | null)[] }).teamLastFiveVs,
  }));
}

// The card's first NFL takes: a small sample, and garbage-time padding
function cardFlags({ player, position, current }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  if (!TEAM_TABS.includes(position) && player.games < 6) {
    flags.push({
      icon: 'hourglass_bottom',
      tone: 'info',
      text: current ? `Small sample: ${player.games} games so far` : `Only ${player.games} games played`,
    });
  }
  const garbage = GARBAGE_TIME_STAT[position as SkillPosition];
  if (garbage && player.competitive) {
    const [key, words] = garbage;
    const all = unitStat(player, key as SkillStatKey, { garbageTime: true });
    const competitive = unitStat(player, key as SkillStatKey, { garbageTime: false });
    if (all && competitive !== null && all / Math.max(player.games, 1) >= 20) {
      const share = (all - competitive) / all;
      if (share >= 0.15) {
        flags.push({ icon: 'hourglass_empty', tone: 'bad', text: `Padded: ${Math.round(share * 100)}% of the ${words} came in garbage time` });
      }
    }
  }
  return flags;
}

// The card's last NFL takes: the team around them, from the support grades (the table's season only:
// other seasons' grades from other tabs aren't worked out)
function castFlags({ position, overall, tableSeason, stats, value, grade }: FlagContext): CardFlag[] {
  if (!tableSeason) return [];
  const flags: CardFlag[] = [];
  let cast = 0;
  const relevant = CAST_GRADES[position as SkillPosition] ?? [];
  for (const stat of stats.filter((s) => relevant.includes(s.key))) {
    const score = value(stat);
    if (score === null || cast >= 2) continue;
    const letter = grade(score);
    // ("Producing despite D rated QB Play": the letter alone next to the label reads oddly)
    // (D+ or worse, A- or better: a middling grade isn't worth a flag)
    if (stat.supportHelps) {
      if (score >= 10) flags.push({ icon: 'fitness_center', tone: 'good', text: `Carrying the offense (${letter} rated Responsibility)` });
      else if (score <= 3) flags.push({ icon: 'group', tone: 'info', text: `Leaning on the team around them (${letter} rated Responsibility)` });
      else continue;
    } else if (score <= 3 && overall >= 0.65) {
      flags.push({ icon: 'fitness_center', tone: 'good', text: `Producing despite ${letter} rated ${stat.label}` });
    } else if (score <= 3 && overall <= 0.4) {
      flags.push({ icon: 'group', tone: 'info', text: `Held back by ${letter} rated ${stat.label}` });
    } else if (score >= 10 && overall >= 0.65) {
      flags.push({ icon: 'group', tone: 'info', text: `Helped by ${letter} rated ${stat.label}` });
    } else continue;
    cast++;
  }
  return flags;
}

// ESPN's headshot cutouts at the card's sizes (160 x 116, 240 x 174, 440 x 320); a rookie ESPN has no NFL
// photo of yet has his college one (its player pages show that too)
const espnHeadshot = (league: string) => (id: number, w: number) =>
  `https://a.espncdn.com/combiner/i?img=/i/headshots/${league}/players/full/${id}.png&w=${w}&h=${Math.floor(w * 0.7273)}`;
const headshot = espnHeadshot('nfl');

// A row's logo file name (the team's nickname: "Ravens"); the rows with their team's games as their log
const logoName = (p: { teamLogo?: string | null }) => p.teamLogo?.match(/([^/]+)\.\w+$/)?.[1];
const TEAM_LOGS = ['TM', 'DEF', 'OL', 'HC'];
// The Game Log's chart: a QB's total yards by game; the others' yards from scrimmage, their main kind first,
// with their touchdowns and turnovers
const SCORING = { plus: ['Passing TD', 'Rushing TD', 'Receiving TD'], minus: ['Passing INT', 'Rushing FL'] };
const YARDS_CHART: Record<string, GameLogChart | undefined> = {
  QB: { label: 'Total yards', stack: ['Passing YDS', 'Rushing YDS'], combine: true },
  RB: { label: 'Scrimmage yards', stack: ['Rushing YDS', 'Receiving YDS'], ...SCORING },
  WR: { label: 'Scrimmage yards', stack: ['Receiving YDS', 'Rushing YDS'], ...SCORING },
  TE: { label: 'Scrimmage yards', stack: ['Receiving YDS', 'Rushing YDS'], ...SCORING },
};

export const SPORT: SportConfig = {
  id: 'nfl',
  // (the shared styles' own ball)
  currentSeason: 2026,
  // (stats not recorded yet in a season, like drops before 2018, are hidden for it)
  firstSeason: 2000,
  // (after the Super Bowl)
  currentSeasonEnds: '2027-02-20',
  seasonText: String,
  positionNames: {
    TM: 'Team',
    QB: 'Quarterback',
    RB: 'Running Back',
    WR: 'Wide Receiver',
    TE: 'Tight End',
    OL: 'Offensive Line',
    K: 'Kicker',
    P: 'Punter',
    DEF: 'Defense',
    HC: 'Head Coach',
  },
  tabNames: {
    TM: 'Teams',
    QB: 'Quarterbacks',
    RB: 'Running Backs',
    WR: 'Wide Receivers',
    TE: 'Tight Ends',
    OL: 'Offensive Lines',
    K: 'Kickers',
    P: 'Punters',
    DEF: 'Defenses',
    HC: 'Head Coaches',
  },
  coachTab: 'HC',
  teamTabs: ['TM', 'DEF', 'OL'],
  rowHeader: (position) => (position === 'TM' || position === 'DEF' || position === 'OL' ? 'Team' : position === 'HC' ? 'Coach' : 'Player'),
  roleWord: (position) => (['K', 'P'].includes(position) ? 'specialist' : 'starter'),
  playingTime: {
    label: 'Games',
    title: 'Leave out players who played less than this share of the season so far (player tabs only; 1 shows everyone); the number is the games it takes',
    of: (player) => player.games,
    // The team games so far (the most any defense has played), a full 17-game season at most; another
    // season's card reads its own tab
    seasonLength: (rows, position) => Math.min(17, Math.max(1, ...(rows['DEF'] ?? rows[position] ?? []).map((team) => team.games))),
    everyone: TEAM_TABS,
  },
  defaultStatBasis: 'season',
  perGameDecimals: 1,
  statBasisHelp: { examples: 'yards, touchdowns, sacks...', pace: '17 games' },
  teamLogo: (key) => `assets/NFL_Icons/${key}.png`,
  headshot,
  headshotFallback: espnHeadshot('college-football'),
  // The team's name, from its defense's row (none on the Defenses tab, or for a team-named row)
  teamName: (player, position, rows) => {
    const team = (rows['DEF'] ?? []).find((unit) => unit.teamLogo === player.teamLogo)?.name ?? null;
    return position === 'DEF' || position === 'TM' || team === player.name ? null : team;
  },
  cardFlags,
  // The card's Analysis tab: the AI write-ups (apps/nfl/scripts/analysis)
  analysis: true,
  // The card's Game Log tab: teams, defenses, lines and coaches get their team's games; a player ESPN's
  // columns, without the longest gains, sacks, or fumbles but the ones lost (FL, at the end of Rushing),
  // charting his yards from scrimmage with his touchdowns and turnovers (a QB's total yards)
  gameLog: {
    league: 'football/nfl',
    has: (player, position) => TEAM_LOGS.includes(position) || (['QB', 'RB', 'WR', 'TE', 'K', 'P'].includes(position) && Number(player.id) > 0),
    load: (player, position) =>
      TEAM_LOGS.includes(position)
        ? espnTeamGameLog('football/nfl', [player.name, logoName(player)], SPORT.currentSeason, 4)
        : espnGameLog('football/nfl', player.id!, SPORT.currentSeason, {
            label: (group, label) => (['LNG', 'SACK', 'FUM', 'FF', 'KB'].includes(label) ? null : label),
            chart: YARDS_CHART[position],
            fumblesLost: YARDS_CHART[position] ? 'Rushing' : undefined,
          }),
  },
  cardFlagsLast: castFlags,
  cardExtras: blockingExtras,

  dataFiles: {
    games: 'games.json',
    subjective: 'subjective.json',
    teamGrades: 'team-grades.json',
    dataGrades: 'data-grades.json',
  },
  extraRows: () => ({ QB: buildQbUnits(), TM: teamRows() }),
  settings: [
    {
      key: 'fantasyScoring',
      label: 'Fantasy Scoring',
      title: 'Click to switch the scoring behind Fantasy Pts: PPR, Half PPR or Standard (kickers and defenses keep their own fixed scoring)',
      options: { ppr: FANTASY_SCORING_LABELS.ppr, half: FANTASY_SCORING_LABELS.half, std: FANTASY_SCORING_LABELS.std },
      default: 'ppr',
      slot: 'formatTop',
      iconClass: 'lombardi',
    },
    {
      key: 'rankBasis',
      label: 'Unit Ranks',
      title: "Click to switch what the head coaches' Off Rank and Def Rank columns rank on: points per game or yards per game (their EPA per play has its own columns in Advanced Stats)",
      options: RANK_BASIS_LABELS,
      default: 'points',
      slot: 'formatMid',
      icon: 'leaderboard',
    },
    {
      key: 'garbageTime',
      label: 'Garbage Time Stats',
      title: "Off: EPA, success rate, CPOE and other play-by-play stats leave out plays run with the game already decided (win probability under 10% or over 90%). Season totals aren't affected",
      default: true,
      slot: 'display',
    },
  ],
  combined: {
    label: 'Combine Rush/Pass Stats',
    title: "Show rushing + passing / receiving yards and touchdowns (and a QB's turnovers) as one total column each (display only: the ranking still uses both sliders)",
    stats: (position) => combinedFor(position as SkillPosition),
  },
  // The unit ranks say what they're ranked on ("Off Rank (Pts)", "Offensive Rank (by Points)"), and
  // fantasy points in which scoring (kickers and defenses have their own fixed scoring)
  // (and the O-Line grade's lean on the QB and RB tabs: team-grades)
  statLabel: (stat, settings, position) =>
    stat.key === 'oline' && OLINE_LEAN[position] ? `O-Line (${OLINE_LEAN[position]})` : statLabelFor(stat, settings['rankBasis'] as RankBasis),
  statName: (stat, position, settings) => {
    if (stat.key === 'oline' && OLINE_LEAN[position]) {
      return `Offensive Line Grade (${OLINE_LEAN[position] === 'Pass' ? 'Pass Pro' : 'Run Block'} Weighted)`;
    }
    if (stat.key === 'fantasy' && !['K', 'DEF'].includes(position)) {
      return `${FANTASY_SCORING_LABELS[settings['fantasyScoring'] as FantasyScoring]} Fantasy Points`;
    }
    if (stat.key in RANK_METRICS) {
      const name = stat.name ?? STAT_NAMES[stat.key] ?? stat.label;
      return `${name} (by ${RANK_BASIS_LABELS[settings['rankBasis'] as RankBasis]})`;
    }
    return undefined;
  },
  computedValue,
  tableSeasonOnly: fromOtherTabs,
  connect: connectTeamGrades,

  copy: {
    noHolesIcon: 'shield',
    volumeOverEfficiency: 'Big volume, below-average efficiency: a compiler',
    efficiencyOverVolume: 'Efficient in a limited role: earning more work',
    winsOverPlay: 'Winning more than the numbers say',
    playOverWins: 'Playing better than the record shows',
    injuryTitle: (player, tableCurrent) =>
      tableCurrent
        ? `This player is currently injured${player.injuryStatus ? ` (${player.injuryStatus})` : ''}`
        : 'Finished the season on injured reserve',
    injuredHelp:
      "Off: hide players listed Out, Doubtful or on Injured Reserve in ESPN's injury report (in a past season, those who finished it on injured reserve), and leave them out of the rankings",
    lowerIsBetterExample: 'sacks allowed',
    groupLine: 'A colored bar',
  },
};
