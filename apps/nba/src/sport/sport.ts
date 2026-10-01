import type { CardFlag, FlagContext, SportConfig } from '@ranker/engine/sport';
import { seasonName } from './awards';

// NBA: what the engine needs to know about basketball (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/)
// The card's NBA takes: what the stats alone don't say (the engine adds the profile's shape)
export function cardFlags({ player, position, current, ordinal, innings }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  const st = player.stats;
  const fixed = (v: number, d: number) => v.toFixed(d).replace(/^0\./, '.').replace(/^-0\./, '-.');
  const signed = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1);

  // Coaches: an interim stint, and how the team played against its talent
  if (position === 'HC') {
    if (player.games < 60) {
      flags.push({ icon: 'swap_horiz', tone: 'info', text: `Part of the season: ${player.games} games coached` });
    }
    if (st.lift !== null && st.lift >= 4) {
      flags.push({ icon: 'trending_up', tone: 'good', text: `Got more from the roster: ${signed(st.lift)} net rating over its talent` });
    } else if (st.lift !== null && st.lift <= -4) {
      flags.push({ icon: 'trending_down', tone: 'bad', text: `Got less from the roster: ${signed(st.lift)} net rating under its talent` });
    }
    // A top-three (or bottom-three) unit
    const units: [string, number | null][] = [['offense', st.offRank], ['defense', st.defRank]];
    for (const [unit, rank] of units) {
      if (rank !== null && rank <= 3) flags.push({ icon: 'military_tech', tone: 'good', text: `The league's ${ordinal(rank)}-ranked ${unit}` });
      else if (rank !== null && rank >= 28) flags.push({ icon: 'trending_down', tone: 'bad', text: `A bottom-three ${unit} (${ordinal(rank)})` });
    }
    if (st.pythDiff !== null && Math.abs(st.pythDiff) >= 3) {
      flags.push(
        st.pythDiff > 0
          ? { icon: 'casino', tone: 'info', text: `Won ${fixed(st.pythDiff, 1)} more games than the point differential says (close games)` }
          : { icon: 'sentiment_dissatisfied', tone: 'info', text: `Won ${fixed(-st.pythDiff, 1)} fewer games than the point differential says (close games)` },
      );
    }
  }

  // A small sample: under 500 minutes
  const minutes = st.minutes ?? 0;
  if (position !== 'HC' && minutes < 500) {
    flags.push({
      icon: 'hourglass_bottom',
      tone: 'info',
      text: current ? `Small sample: ${minutes} minutes so far` : `Small sample: ${minutes} minutes`,
    });
  }
  // Missed time: a finished season with 25+ games missed
  if (position !== 'HC' && !current && player.games <= 57 && minutes >= 500) {
    flags.push({ icon: 'healing', tone: 'info', text: `Missed time: played ${player.games} of 82 games` });
  }

  // The team with him on the floor against off it
  if (st.onOff !== null && minutes >= 500) {
    if (st.onOff >= 8) {
      flags.push({ icon: 'trending_up', tone: 'good', text: `The team is ${signed(st.onOff)} per 100 possessions better with him on the floor` });
    } else if (st.onOff <= -8) {
      flags.push({ icon: 'trending_down', tone: 'bad', text: `The team is ${signed(-st.onOff).replace('+', '')} per 100 possessions worse with him on the floor` });
    }
  }
  // A heavy load, and whether it came efficiently
  if (st.usgPct !== null && st.tsPct !== null && st.usgPct >= 28) {
    if (st.tsPct >= 60) {
      flags.push({ icon: 'bolt', tone: 'good', text: `Heavy load, efficient: ${fixed(st.usgPct, 1)}% usage at ${fixed(st.tsPct, 1)}% true shooting` });
    } else if (st.tsPct <= 54) {
      flags.push({ icon: 'casino', tone: 'bad', text: `Heavy load, inefficient: ${fixed(st.usgPct, 1)}% usage at ${fixed(st.tsPct, 1)}% true shooting` });
    }
  }
  // Defense the box score shows
  if (st.dbpm !== null && minutes >= 500) {
    if (st.dbpm >= 2.5) {
      flags.push({ icon: 'shield', tone: 'good', text: `Stout defender: ${signed(st.dbpm)} Defensive Box Plus/Minus` });
    } else if (st.dbpm <= -2) {
      flags.push({ icon: 'sports_basketball', tone: 'bad', text: `Defense costs his team: ${signed(st.dbpm)} Defensive Box Plus/Minus` });
    }
  }

  return flags;
}

export const SPORT: SportConfig = {
  id: 'nba',
  appName: 'NBA Ranker',
  logoClass: 'logo-basketball',
  // (a season is named for the year it ends in: 2026 is 2025-26)
  currentSeason: 2026,
  firstSeason: 2001,
  // (after the Finals: 2025-26 is over; 2026-27 becomes current at the October rollover)
  currentSeasonEnds: '2026-06-30',
  seasonText: seasonName,
  positionNames: {
    PG: 'Point Guard',
    SG: 'Shooting Guard',
    SF: 'Small Forward',
    PF: 'Power Forward',
    C: 'Center',
    HC: 'Head Coach',
  },
  tabNames: {
    PG: 'Point Guards',
    SG: 'Shooting Guards',
    SF: 'Small Forwards',
    PF: 'Power Forwards',
    C: 'Centers',
    HC: 'Head Coaches',
  },
  coachTab: 'HC',
  rowHeader: (position) => (position === 'HC' ? 'Coach' : 'Player'),
  roleWord: () => 'regular',
  playingTime: {
    label: 'Games',
    title: 'Leave out players who played less than this share of the season so far (1 shows everyone); the number is the games it takes',
    of: (player) => player.games ?? 0,
  },
  // (NBA stats read per game)
  defaultStatBasis: 'perGame',
  perGameDecimals: 1,
  statBasisHelp: { examples: 'points, rebounds, assists, 3s...', pace: '82 games' },
  teamLogo: (key) => `assets/NBA_Icons/${key}.svg`,
  // ESPN's headshot cutouts (the NFL app's shape)
  headshot: (id, w) => `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=${w}&h=${Math.round(w * 0.725)}`,
  cardFlags,
  copy: {
    noHolesIcon: 'verified',
    volumeOverEfficiency: 'Big numbers, below-average efficiency: empty stats',
    efficiencyOverVolume: 'Productive in a limited role: earning more minutes',
    winsOverPlay: 'Winning more than the play says',
    injuryTitle: (player) => `On the injured list${player.injuryStatus ? ` (${player.injuryStatus})` : ''}`,
    injuredHelp: 'Off: hide players on the injured list (this season), and leave them out of the rankings',
    lowerIsBetterExample: 'turnovers',
    groupLine: 'A chalk line',
    playOverWins: 'Playing better than the record shows',
  },
};
