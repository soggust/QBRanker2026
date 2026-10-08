import type { CardFlag, FlagContext, SportConfig } from '@ranker/engine/sport';
import { espnTeamGameLog } from '@ranker/core/game-logs';
import { loadTeamRoster } from './team-roster';

// A season's game logs (the NHL's API doesn't let the site ask), in game-logs/<season>/<bucket>.json: a
// player's in bucket id % 32 (apps/nhl/scripts/game-log-files.mjs), so a card loads its player's share,
// not the season's. This season's kept nightly, earlier ones written once. Each bucket loaded the first
// time a card in it opens its Game Log tab (again after a failure)
interface NhlGameLogs {
  skater: string[];
  goalie: string[];
  logs: Record<string, (string | number)[][]>;
  // each player's playoff games, the newest of his log
  playoffs?: Record<string, number>;
}
// (whether the earlier seasons' files are there: player logs for past seasons)
const PAST_SEASON_LOGS = true;
const LOG_BUCKETS = 32;
const nhlGameLogFiles = new Map<string, Promise<NhlGameLogs>>();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nhlDay(date: string, season: number): string | undefined {
  const [mon, d] = date.split(' ');
  const m = MONTHS.indexOf(mon);
  if (m < 0 || !d) return undefined;
  const year = m >= 8 ? season - 1 : season;
  return `${year}-${String(m + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
}
function nhlGameLogs(season: number, id: number): Promise<NhlGameLogs> {
  const file = `data/game-logs/${season}/${id % LOG_BUCKETS}.json`;
  if (!nhlGameLogFiles.has(file)) {
    nhlGameLogFiles.set(
      file,
      // (this season's change nightly; an earlier one's never)
      fetch(file, { cache: season === SPORT.currentSeason ? 'no-cache' : 'default' }).then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<NhlGameLogs>;
      }),
    );
  }
  return nhlGameLogFiles.get(file)!.catch((err) => {
    nhlGameLogFiles.delete(file);
    throw err;
  });
}
import { teamRowsFromCoaches } from '@ranker/engine/team-rows';
import type { SkillPlayer } from './positions';
import { seasonName } from './awards';

// The Teams tab's rows, from the head coach rows: the coaches' records and goals added up (goal
// differential per game, weighted by their games), the team's season stats (every coach row carries
// them), its playoff wins and Cup and conference badges (the coach who finished the season)
export function teamRows(): SkillPlayer[] {
  return teamRowsFromCoaches((coaches, sum) => {
    const games = coaches.reduce((total, c) => total + c.games, 0);
    const wins = sum('wins');
    const ties = sum('ties');
    return {
      wins,
      losses: sum('losses'),
      ties,
      winPct: games ? Math.round(((2 * wins + ties) / (2 * games)) * 1000) / 1000 : null,
      playoffWins: sum('playoffWins'),
      goalDiff: games ? Math.round((coaches.reduce((total, c) => total + (c.stats.goalDiff ?? 0) * c.games, 0) / games) * 100) / 100 : null,
      ptsOver: Math.round(sum('ptsOver') * 10) / 10,
    };
  });
}

// NHL: what the engine needs to know about hockey (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/)

// The card's NHL takes: what the stats alone don't say (the engine adds the profile's shape)
export function cardFlags({ player, position, current }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  const st = player.stats;
  const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);
  const games = player.games;

  // Teams: luck (PDO, points against the goal differential) and goaltending
  if (position === 'TM') {
    if (st.pdo !== null && st.pdo >= 102) flags.push({ icon: 'casino', tone: 'info', text: `Running hot: a ${st.pdo.toFixed(1)} PDO (shooting plus save %) tends to come back toward 100` });
    else if (st.pdo !== null && st.pdo <= 98) flags.push({ icon: 'ac_unit', tone: 'info', text: `Running cold: a ${st.pdo.toFixed(1)} PDO (shooting plus save %) tends to come back toward 100` });
    if (st.gsaxTeam !== null && st.gsaxTeam >= 15) flags.push({ icon: 'shield', tone: 'good', text: `Carried by its goalies: ${signed(st.gsaxTeam)} goals saved above expected` });
    else if (st.gsaxTeam !== null && st.gsaxTeam <= -15) flags.push({ icon: 'sports_hockey', tone: 'bad', text: `Let down by its goalies: ${signed(st.gsaxTeam)} goals saved above expected` });
    if (st.ptsOver !== null && Math.abs(st.ptsOver) >= 8) {
      flags.push(st.ptsOver > 0
        ? { icon: 'casino', tone: 'info', text: `${st.ptsOver.toFixed(1)} more points than the goal differential says (close games: may not last)` }
        : { icon: 'sentiment_dissatisfied', tone: 'info', text: `${(-st.ptsOver).toFixed(1)} fewer points than the goal differential says (better than the record)` });
    }
    return flags;
  }

  // Coaches: an interim stint, and how the team played against its roster and its goal differential
  if (position === 'HC') {
    if (games < 60 && !current) flags.push({ icon: 'swap_horiz', tone: 'info', text: `Part of the season: ${games} games coached` });
    if (st.lift !== null && st.lift >= 3) {
      flags.push({ icon: 'trending_up', tone: 'good', text: `Got more from the roster: ${signed(st.lift)} points of 5-on-5 expected-goal share over its talent` });
    } else if (st.lift !== null && st.lift <= -3) {
      flags.push({ icon: 'trending_down', tone: 'bad', text: `Got less from the roster: ${signed(st.lift)} points of 5-on-5 expected-goal share under its talent` });
    }
    const units: [string, number | null][] = [['offense', st.offRank], ['defense', st.defRank]];
    for (const [unit, rank] of units) {
      if (rank !== null && rank <= 3) flags.push({ icon: 'military_tech', tone: 'good', text: `The league's #${rank} ${unit} by goals per game` });
      else if (rank !== null && rank >= 30) flags.push({ icon: 'trending_down', tone: 'bad', text: `A bottom-three ${unit} (#${rank})` });
    }
    if (st.ptsOver !== null && Math.abs(st.ptsOver) >= 6) {
      flags.push(
        st.ptsOver > 0
          ? { icon: 'casino', tone: 'info', text: `${st.ptsOver.toFixed(1)} more points than the goal differential says (close games, overtime, shootouts)` }
          : { icon: 'sentiment_dissatisfied', tone: 'info', text: `${(-st.ptsOver).toFixed(1)} fewer points than the goal differential says (close games, overtime, shootouts)` },
      );
    }
    return flags;
  }

  // A small sample: under 20 games
  if (games < 20) {
    flags.push({ icon: 'hourglass_bottom', tone: 'info', text: current ? `Small sample: ${games} games so far` : `Small sample: ${games} games` });
  }

  if (position === 'G') {
    // Stealing games, or leaking them, against the shots he faced
    if (st.gsax !== null && st.gsax >= 15) {
      flags.push({ icon: 'shield', tone: 'good', text: `Stole goals: ${signed(st.gsax)} saved above what his shots were worth` });
    } else if (st.gsax !== null && st.gsax <= -10) {
      flags.push({ icon: 'sports_hockey', tone: 'bad', text: `Leaked goals: ${signed(st.gsax)} saved against what his shots were worth` });
    }
    // The defense in front of him (his Defense grade: A+ is the stingiest)
    if (st.defense !== null && st.defense >= 10) {
      flags.push({ icon: 'group', tone: 'info', text: 'A stingy defense in front of him: few dangerous shots' });
    } else if (st.defense !== null && st.defense <= 2) {
      flags.push({ icon: 'warning', tone: 'info', text: 'Under siege: the most dangerous shots in the league came at him' });
    }
    return flags;
  }

  // Finishing well beyond (or short of) his chances: often luck over one season
  if (st.goalsAboveX !== null && games >= 20) {
    if (st.goalsAboveX >= 8) {
      flags.push({ icon: 'local_fire_department', tone: 'info', text: `Hot finishing: ${signed(st.goalsAboveX)} goals over what his chances were worth (may not last)` });
    } else if (st.goalsAboveX <= -6) {
      flags.push({ icon: 'ac_unit', tone: 'info', text: `Snakebitten: ${signed(st.goalsAboveX)} goals under what his chances were worth (due for more)` });
    }
  }
  // His team with him on the ice against off
  if (st.xgfRel !== null && games >= 20) {
    if (st.xgfRel >= 5) {
      flags.push({ icon: 'trending_up', tone: 'good', text: `Tilts the ice: his team's expected-goal share is ${signed(st.xgfRel)} points better with him on` });
    } else if (st.xgfRel <= -5) {
      flags.push({ icon: 'trending_down', tone: 'bad', text: `Gets caved in: his team's expected-goal share is ${signed(st.xgfRel)} points worse with him on` });
    }
  }
  // A power-play merchant: most of his points on the man advantage
  if (st.points !== null && st.ppPoints !== null && st.points >= 30 && st.ppPoints / st.points >= 0.45) {
    flags.push({ icon: 'bolt', tone: 'info', text: `Power-play heavy: ${Math.round((st.ppPoints / st.points) * 100)}% of his points with the man advantage` });
  }
  // A big minutes load
  if (st.toi !== null && ((position === 'D' && st.toi >= 24) || (position !== 'D' && st.toi >= 21))) {
    flags.push({ icon: 'timer', tone: 'good', text: `Huge minutes: ${st.toi.toFixed(1)} a night` });
  }
  return flags;
}

export const SPORT: SportConfig = {
  id: 'nhl',
  // (a season is named for the year it ends in: 2026 is 2025-26)
  currentSeason: 2027,
  // (MoneyPuck's expected-goals data starts with 2008-09)
  firstSeason: 2009,
  // (after the Final: 2026-27 is over; 2027-28 becomes current at the October rollover)
  currentSeasonEnds: '2027-06-30',
  seasonText: seasonName,
  positionNames: { TM: 'Team', C: 'Center', LW: 'Left Wing', RW: 'Right Wing', D: 'Defenseman', G: 'Goalie', HC: 'Head Coach' },
  tabNames: { TM: 'Teams', C: 'Centers', LW: 'Left Wings', RW: 'Right Wings', D: 'Defensemen', G: 'Goalies', HC: 'Head Coaches' },
  coachTab: 'HC',
  teamTabs: ['TM'],
  rowHeader: (position) => (position === 'HC' ? 'Coach' : position === 'TM' ? 'Team' : 'Player'),
  extraRows: () => ({ TM: teamRows() }),
  // The Teams tab's roster grades: each spot by your rankings, weighted by ice time (a goalie by games)
  rosterGrades: [
    { key: 'forwards', positions: ['C', 'LW', 'RW'], usage: (p) => (p.stats.toi ?? 0) * p.games },
    { key: 'blueline', positions: ['D'], usage: (p) => (p.stats.toi ?? 0) * p.games },
    { key: 'goaltending', positions: ['G'], usage: (p) => p.stats.gamesStarted ?? p.games },
  ],
  roleWord: (position) => (position === 'G' ? 'starter' : 'regular'),
  playingTime: {
    label: 'Games',
    title: 'Leave out players who played less than this share of the season so far (1 shows everyone); the number is the games it takes',
    of: (player) => player.games ?? 0,
    // (every team plays every game)
    everyone: ['TM'],
  },
  defaultStatBasis: 'season',
  perGameDecimals: 2,
  statBasisHelp: { examples: 'goals, points, hits, saves...', pace: '82 games' },
  teamLogo: (key) => `assets/NHL_Icons/${key}.svg`,
  // The NHL's player headshots
  headshot: (id) => `https://assets.nhle.com/mugs/nhl/latest/${id}.png`,
  cardFlags,
  // The card's Team tab (teams and head coaches): the top unit on a rink, every line, the head coaches,
  // everyone who played (team-roster.ts)
  depthChart: {
    has: (player, position) => ['TM', 'HC'].includes(position) && !!player.teamLogo,
    load: async (player, position, season, context) => loadTeamRoster(player as SkillPlayer, context),
  },
  // The card's Game Log tab: a team's (or coach's) games from ESPN, any season; a player's from the game-log
  // files (this season's, and earlier ones once they're written)
  gameLog: {
    league: 'hockey/nhl',
    has: (player, position, season) => ['TM', 'HC'].includes(position) || season === SPORT.currentSeason || PAST_SEASON_LOGS,
    load: async (player, position, season) => {
      if (['TM', 'HC'].includes(position)) {
        return espnTeamGameLog('hockey/nhl', [player.teamName ?? undefined, player.name, player.teamLogo?.match(/([^/]+)\.\w+$/)?.[1]], season, 3);
      }
      const file = await nhlGameLogs(season, Number(player.id));
      const rows = file.logs[String(player.id)] ?? [];
      const goalie = position === 'G';
      const columns = (goalie ? file.goalie : file.skater).map((label) => ({ label }));
      return {
        columns,
        rows: rows.map(([date, vs, result, ...values], i) => ({
          playoff: i < (file.playoffs?.[String(player.id)] ?? 0),
          date: String(date),
          // (its day: "Apr 9" in the season's second year, "Oct 12" in its first)
          when: nhlDay(String(date), season),
          vs: String(vs),
          // (the opponent's logo, from the abbreviation in "@ TOR")
          logo: `https://assets.nhle.com/logos/nhl/svg/${String(vs).split(' ').pop()}_dark.svg`,
          result: String(result),
          values: values.map(String),
        })),
        // (a skater's points, goals then assists; a goalie's shots faced, a dot a goal)
        chart: goalie ? { label: 'Shots against', stack: ['SA'], minus: ['GA'] } : { label: 'Points', stack: ['G', 'A'], names: ['Goals', 'Assists'] },
      };
    },
  },
  // (the Teams tab's Recent: the last 7 games)
  recentGames: (position) => (position === 'TM' ? 7 : 5),
  copy: {
    noHolesIcon: 'verified',
    volumeOverEfficiency: 'Lots of shots, below-average finishing: a volume shooter',
    efficiencyOverVolume: 'Finishing at a high rate on limited looks: earning more ice time',
    winsOverPlay: 'Winning more than his saves say (the team in front of him)',
    playOverWins: 'Stopping pucks better than his record shows',
    injuryTitle: (player) => `Injured${player.injuryStatus ? ` (${player.injuryStatus})` : ''}`,
    injuredHelp: 'Off: hide injured players (this season), and leave them out of the rankings',
    lowerIsBetterExample: 'goals-against average',
    groupLine: 'A painted rink line',
  },
};
