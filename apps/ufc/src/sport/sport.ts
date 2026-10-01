import type { CardFlag, FlagContext, HistoryRow, SportConfig } from '@ranker/engine/sport';
import { WOMENS_DIVISIONS, type Position } from './positions';
import { seasonName } from './awards';

// UFC: what the engine needs to know about fighting (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/). A career table rather than seasons:
// every active fighter's UFC career, by division.

// The card's UFC takes: what the stats alone don't say (the engine adds the profile's shape)
export function cardFlags({ player }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  const st = player.stats;
  const fights = player.games;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  if (fights < 4) {
    flags.push({ icon: 'fiber_new', tone: 'info', text: `Early in his UFC run: ${fights} fight${fights === 1 ? '' : 's'} so far` });
  }
  // Streaks
  if (st.streak !== null && st.streak >= 4) {
    flags.push({ icon: 'local_fire_department', tone: 'good', text: `On a ${st.streak}-fight win streak` });
  } else if (st.streak !== null && st.streak <= -2) {
    flags.push({ icon: 'trending_down', tone: 'bad', text: `Lost ${-st.streak} straight` });
  }
  // How he wins, and whether he gets finished
  if (st.finishRate !== null && st.wins !== null && st.wins >= 4 && st.finishRate >= 0.75) {
    flags.push({ icon: 'bolt', tone: 'good', text: `Finisher: ${pct(st.finishRate)} of his UFC wins came inside the distance` });
  } else if (st.finishRate !== null && st.wins !== null && st.wins >= 5 && st.finishRate <= 0.2) {
    flags.push({ icon: 'gavel', tone: 'info', text: `Goes to the cards: ${pct(1 - st.finishRate)} of his UFC wins were decisions` });
  }
  if (fights >= 6 && st.finished === 0) {
    flags.push({ icon: 'shield', tone: 'good', text: `Never finished in ${fights} UFC fights` });
  } else if (st.kdAgainst !== null && st.kdAgainst >= 0.6) {
    flags.push({ icon: 'warning', tone: 'bad', text: `Chin questions: knocked down ${st.kdAgainst.toFixed(2)} times per 15 minutes` });
  }
  // The striking battle
  if (st.strDiff !== null && fights >= 4) {
    if (st.strDiff >= 2) flags.push({ icon: 'sports_mma', tone: 'good', text: `Wins the striking: +${st.strDiff.toFixed(2)} significant strikes a minute` });
    else if (st.strDiff <= -1.5) flags.push({ icon: 'sports_mma', tone: 'bad', text: `Loses the striking: ${st.strDiff.toFixed(2)} significant strikes a minute` });
  }
  // Whom he's fought
  if (st.schedule !== null && fights >= 5 && st.schedule >= 0.62) {
    flags.push({ icon: 'military_tech', tone: 'good', text: `Tough schedule: his opponents won ${pct(st.schedule)} of their UFC fights` });
  }
  if (player.pro) {
    flags.push({ icon: 'assignment', tone: 'info', text: `Pro record ${player.pro}` });
  }
  return flags;
}

// The card's Fights tab: his UFC fights, newest first
const fightRows = (player: { fights?: [string, string, 'W' | 'L' | 'D', string, string][] }): HistoryRow[] =>
  (player.fights ?? []).map(([date, opponent, result, how, event]) => ({
    result,
    main: `vs. ${opponent}`,
    sub: `${event} · ${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    detail: how,
  }));

export const SPORT: SportConfig = {
  id: 'ufc',
  appName: 'UFC Ranker',
  logoClass: 'logo-octagon',
  // (one career table: the "season" is today's)
  currentSeason: 2026,
  firstSeason: 2026,
  currentSeasonEnds: '2099-12-31',
  seasonText: seasonName,
  careerOnly: true,
  positionNames: {
    HW: 'Heavyweight',
    LHW: 'Light Heavyweight',
    MW: 'Middleweight',
    WW: 'Welterweight',
    LW: 'Lightweight',
    FW: 'Featherweight',
    BW: 'Bantamweight',
    FLW: 'Flyweight',
    WBW: "Women's Bantamweight",
    WFLW: "Women's Flyweight",
    WSW: "Women's Strawweight",
  },
  tabNames: {
    HW: 'Heavyweight',
    LHW: 'Light Heavy',
    MW: 'Middleweight',
    WW: 'Welterweight',
    LW: 'Lightweight',
    FW: 'Featherweight',
    BW: 'Bantamweight',
    FLW: 'Flyweight',
    WBW: "W Bantamweight",
    WFLW: "W Flyweight",
    WSW: "W Strawweight",
  },
  coachTab: null,
  rowHeader: () => 'Fighter',
  roleWord: () => 'fighter',
  playingTime: {
    label: 'Fights',
    title: 'Leave out fighters with fewer UFC fights than this share of the most anyone in the division has (1 shows everyone); the number is the fights it takes',
    of: (player) => player.games ?? 0,
  },
  defaultStatBasis: 'season',
  perGameDecimals: 2,
  statBasisHelp: { examples: 'finishes and times finished', pace: '10 fights' },
  teamLogo: (key) => key,
  // ESPN's fighter cutouts
  headshot: (id, w) => `https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${id}.png&w=${w}&h=${Math.round(w * 0.725)}`,
  cardFlags,
  settings: [
    {
      key: 'era',
      label: 'Fighters',
      title: "Today's roster, or every era: All-Time adds the retired fighters (6+ UFC fights), the legends ranked on the same stats",
      options: { current: 'Current Fighters', alltime: 'All-Time Fighters' },
      default: 'current',
      slot: 'footer',
    },
    {
      key: 'women',
      label: "Women's Divisions",
      title: "On: add the women's divisions (strawweight, flyweight and bantamweight) to the tabs",
      default: false,
      slot: 'displayEnd',
    },
  ],
  tabVisible: (position, settings) => !WOMENS_DIVISIONS.includes(position as Position) || !!settings['women'],
  rowVisible: (player, settings) => !player.retired || settings['era'] === 'alltime',
  // A fighter's rates rest on few fights early on: 4 UFC fights count half, 12 count three-quarters
  reliability: (player) => player.games / (player.games + 4),
  cardHistory: { title: 'Fights', icon: 'sports_mma', rows: (player) => fightRows(player) },
  copy: {
    noHolesIcon: 'verified',
    volumeOverEfficiency: 'Throws a lot, lands a low share: volume over precision',
    efficiencyOverVolume: 'Picks his shots: accurate, but low output',
    winsOverPlay: 'Wins more than his output says: finds a way',
    playOverWins: 'Outworks opponents, but the results lag',
    injuryTitle: () => 'Injured',
    injuredHelp: 'Off: hide injured fighters, and leave them out of the rankings',
    lowerIsBetterExample: 'strikes absorbed',
    groupLine: 'A painted mat line',
    noneFound: 'No Fighters Found',
  },
};
