import type { CardFlag, FlagContext, SportConfig } from '@ranker/engine/sport';
import { seasonName } from './awards';

// NHL: what the engine needs to know about hockey (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/)

// The card's NHL takes: what the stats alone don't say (the engine adds the profile's shape)
export function cardFlags({ player, position, current }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  const st = player.stats;
  const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);
  const games = player.games;

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
  appName: 'NHL Ranker',
  logoClass: 'logo-puck',
  // (a season is named for the year it ends in: 2026 is 2025-26)
  currentSeason: 2027,
  // (MoneyPuck's expected-goals data starts with 2008-09)
  firstSeason: 2009,
  // (after the Final: 2026-27 is over; 2027-28 becomes current at the October rollover)
  currentSeasonEnds: '2027-06-30',
  seasonText: seasonName,
  positionNames: { C: 'Center', LW: 'Left Wing', RW: 'Right Wing', D: 'Defenseman', G: 'Goalie' },
  tabNames: { C: 'Centers', LW: 'Left Wings', RW: 'Right Wings', D: 'Defensemen', G: 'Goalies' },
  coachTab: null,
  roleWord: (position) => (position === 'G' ? 'starter' : 'regular'),
  playingTime: {
    label: 'Games',
    title: 'Leave out players who played less than this share of the season so far (1 shows everyone); the number is the games it takes',
    of: (player) => player.games ?? 0,
  },
  defaultStatBasis: 'season',
  perGameDecimals: 2,
  statBasisHelp: { examples: 'goals, points, hits, saves...', pace: '82 games' },
  teamLogo: (key) => `assets/NHL_Icons/${key}.svg`,
  // The NHL's player headshots
  headshot: (id) => `https://assets.nhle.com/mugs/nhl/latest/${id}.png`,
  cardFlags,
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
