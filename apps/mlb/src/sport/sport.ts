import type { CardFlag, FlagContext, SportConfig } from '@ranker/engine/sport';

// MLB: what the engine needs to know about baseball (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/)
// The card's MLB takes: what the stats alone don't say (the engine adds the profile's shape)
export function cardFlags({ player, position, current, ordinal, innings }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  const st = player.stats;
  const pitcher = position === 'SP' || position === 'RP';
  const fixed = (v: number, d: number) => v.toFixed(d).replace(/^0\./, '.').replace(/^-0\./, '-.');

  // A small sample: under 150 plate appearances, or 40 innings
  const sample = pitcher ? (st.ip ?? 0) < 40 : (st.pa ?? 0) < 150;
  if (sample) {
    const amount = pitcher ? `${innings(st.ip ?? 0)} innings` : `${st.pa ?? 0} plate appearances`;
    flags.push({
      icon: 'hourglass_bottom',
      tone: 'info',
      text: current ? `Small sample: ${amount} so far` : `Small sample: ${amount}`,
    });
  }

  // Luck: results against what should have happened
  if (!pitcher && st.woba !== null && st.xwoba !== null) {
    const gap = st.woba - st.xwoba;
    if (gap >= 0.03) {
      flags.push({ icon: 'casino', tone: 'bad', text: `Some luck: a ${fixed(st.woba, 3)} wOBA on contact worth ${fixed(st.xwoba, 3)}` });
    } else if (gap <= -0.03) {
      flags.push({ icon: 'trending_up', tone: 'good', text: `Due for better: hit well enough for a ${fixed(st.xwoba, 3)} wOBA, got ${fixed(st.woba, 3)}` });
    }
  }
  if (pitcher && st.era !== null && st.fip !== null) {
    const gap = st.era - st.fip;
    if (gap <= -0.75) {
      flags.push({ icon: 'casino', tone: 'bad', text: `ERA outrunning the peripherals: ${fixed(st.era, 2)} ERA, ${fixed(st.fip, 2)} FIP` });
    } else if (gap >= 0.75) {
      flags.push({ icon: 'trending_up', tone: 'good', text: `Pitched better than the ERA: ${fixed(st.era, 2)} ERA, ${fixed(st.fip, 2)} FIP` });
    }
  }

  // All-around value, or none: WAR against the list
  if (!pitcher && st.defRuns !== null && st.defRuns >= 8) {
    flags.push({ icon: 'sports_baseball', tone: 'good', text: `Real glove: ${fixed(st.defRuns, 1)} runs saved in the field` });
  } else if (!pitcher && st.defRuns !== null && st.defRuns <= -8) {
    flags.push({ icon: 'sports_baseball', tone: 'bad', text: `Costly glove: ${fixed(-st.defRuns, 1)} runs given away in the field` });
  }

  return flags;
}

export const SPORT: SportConfig = {
  id: 'mlb',
  appName: 'MLB Ranker',
  logoClass: 'logo-baseball',
  currentSeason: 2026,
  firstSeason: 2000,
  // (after the World Series)
  currentSeasonEnds: '2026-11-10',
  seasonText: (season) => `${season}`,
  positionNames: {
    C: 'Catcher',
    '1B': 'First Baseman',
    '2B': 'Second Baseman',
    '3B': 'Third Baseman',
    SS: 'Shortstop',
    OF: 'Outfielder',
    DH: 'Designated Hitter',
    SP: 'Starting Pitcher',
    RP: 'Relief Pitcher',
  },
  tabNames: {
    C: 'Catchers',
    '1B': 'First Base',
    '2B': 'Second Base',
    '3B': 'Third Base',
    SS: 'Shortstops',
    OF: 'Outfielders',
    DH: 'Designated Hitters',
    SP: 'Starting Pitchers',
    RP: 'Relief Pitchers',
  },
  coachTab: null,
  roleWord: (position) => (position === 'SP' ? 'starter' : position === 'RP' ? 'reliever' : 'regular'),
  // Plate appearances (a pitcher's: batters faced, stored as pa)
  playingTime: {
    label: 'PA',
    title:
      'Leave out players with less than this share of the most plate appearances on the tab (for pitchers, batters faced; 1 shows everyone); the number is the PA it takes',
    of: (player) => player.stats.pa ?? 0,
  },
  defaultStatBasis: 'season',
  perGameDecimals: 2,
  statBasisHelp: {
    examples: 'home runs, RBI, strikeouts, innings...',
    pace: '162 games for hitters, 32 starts for starters, 65 appearances for relievers',
  },
  teamLogo: (key) => `assets/MLB_Icons/${key}.svg`,
  // MLB's headshot cutouts (square)
  headshot: (id, w) => `https://img.mlbstatic.com/mlb-photos/image/upload/w_${w},q_auto:best/v1/people/${id}/headshot/silo/current`,
  cardFlags,
  copy: {
    noHolesIcon: 'shield',
    volumeOverEfficiency: 'Big counting stats, below-average rates: a compiler',
    efficiencyOverVolume: 'Productive in a limited role: earning more playing time',
    winsOverPlay: 'Winning more than the pitching says (run support)',
    playOverWins: 'Pitching better than the record shows',
  },
};
