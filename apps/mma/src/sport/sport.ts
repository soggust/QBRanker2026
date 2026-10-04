import type { CardFlag, FlagContext, HistoryRow, SportConfig } from '@ranker/engine/sport';
import { WOMENS_DIVISIONS, allTime, womens, type Position } from './positions';
import { seasonName } from './awards';

// (head to head counts for meetings since this date)
const THREE_YEARS_AGO = new Date(Date.now() - 1096 * 864e5).toISOString().slice(0, 10);

// MMA: what the engine needs to know about fighting (the rest is beside this file: positions,
// skill-presets, skills, awards, team-colors, logo-eras, about/). A career table rather than seasons:
// every active fighter's career across the promotions covered, by division.

// The card's MMA takes: what the stats alone don't say (the engine adds the profile's shape)
export function cardFlags({ player }: FlagContext): CardFlag[] {
  const flags: CardFlag[] = [];
  const st = player.stats;
  const fights = player.games;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  if (fights < 4) {
    flags.push({ icon: 'fiber_new', tone: 'info', text: `Early in his career: ${fights} fight${fights === 1 ? '' : 's'} so far` });
  }
  // Streaks
  if (st.streak !== null && st.streak >= 4) {
    flags.push({ icon: 'local_fire_department', tone: 'good', text: `On a ${st.streak}-fight win streak` });
  } else if (st.streak !== null && st.streak <= -2) {
    flags.push({ icon: 'trending_down', tone: 'bad', text: `Lost ${-st.streak} straight` });
  }
  // How he wins, and whether he gets finished
  if (st.finishRate !== null && st.finishes !== null && st.finishes >= 3 && st.finishRate >= 0.75) {
    flags.push({ icon: 'bolt', tone: 'good', text: `Finisher: ${pct(st.finishRate)} of his wins came inside the distance` });
  } else if (st.finishRate !== null && fights >= 6 && st.finishRate <= 0.2) {
    flags.push({ icon: 'gavel', tone: 'info', text: `Goes to the cards: ${pct(1 - st.finishRate)} of his wins were decisions` });
  }
  if (fights >= 6 && st.finished === 0) {
    flags.push({ icon: 'shield', tone: 'good', text: `Never finished in ${fights} fights` });
  } else if (st.kdAgainst !== null && st.kdAgainst >= 0.6) {
    flags.push({ icon: 'warning', tone: 'bad', text: `Chin questions: knocked down ${st.kdAgainst.toFixed(2)} times per 15 minutes` });
  }
  // The striking battle
  if (st.strDiff !== null && fights >= 4) {
    if (st.strDiff >= 2) flags.push({ icon: 'sports_mma', tone: 'good', text: `Wins the striking: +${st.strDiff.toFixed(2)} significant strikes a minute` });
    else if (st.strDiff <= -1.5) flags.push({ icon: 'sports_mma', tone: 'bad', text: `Loses the striking: ${st.strDiff.toFixed(2)} significant strikes a minute` });
  }
  // Whom he's fought
  // (the rating's top tenth: a quality win's bar)
  if (st.qualityWins !== null && st.qualityWins >= 3) {
    flags.push({ icon: 'military_tech', tone: 'good', text: `${st.qualityWins} wins over top-tenth opponents` });
  }
  return flags;
}

// The card's Fights tab: his fights, newest first
const fightRows = (player: { fights?: [string, string, 'W' | 'L' | 'D', string, string][] }): HistoryRow[] =>
  (player.fights ?? []).map(([date, opponent, result, how, event]) => ({
    result,
    main: `vs. ${opponent}`,
    sub: `${event} · ${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    detail: how,
  }));

export const SPORT: SportConfig = {
  id: 'mma',
  // (one career table: the "season" is today's)
  currentSeason: 2026,
  firstSeason: 2026,
  currentSeasonEnds: '2099-12-31',
  seasonText: seasonName,
  careerOnly: true,
  positionNames: {
    P4P: 'Pound-for-Pound',
    WP4P: "Women's Pound-for-Pound",
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
    P4P: 'P4P',
    WP4P: 'W P4P',
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
    title: 'Leave out fighters with fewer pro fights (in the promotions covered) than this (1 shows everyone)',
    // (his whole career: a champion new to a division is still listed there)
    of: (player) => player.games ?? 0,
    // (a count, not a share of the most anyone has: 6 to start, 2 a click. The rating weighs a short
    // record itself, so the cutoff only clears out the barely seen)
    fixed: { default: 6, step: 2 },
  },
  defaultStatBasis: 'season',
  perGameDecimals: 2,
  statBasisHelp: { examples: 'title wins and quality wins', pace: '10 fights' },
  teamLogo: (key) => key,
  // ESPN's fighter cutouts
  headshot: (id, w) => `https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${id}.png&w=${w}&h=${Math.round(w * 0.725)}`,
  cardFlags,
  settings: [
    {
      key: 'era',
      label: 'Fighters',
      title: "Today's roster or every era (All-Time adds the retired fighters, 6+ fights in the big promotions, ranked on their careers), the men's tabs or the women's",
      options: { current: 'Current MMA', currentW: 'Current WMMA', alltime: 'All-Time MMA', alltimeW: 'All-Time WMMA' },
      optionGroups: [
        { label: 'Current', options: { current: "Men's", currentW: "Women's" } },
        { label: 'All-Time', options: { alltime: "Men's", alltimeW: "Women's" } },
      ],
      default: 'current',
      slot: 'footer',
    },
    {
      key: 'ufcOnly',
      label: 'UFC Fighters Only',
      title: "On: only fighters in the UFC now (all-time: anyone who's fought there). The ratings still count every promotion",
      default: false,
      slot: 'display',
    },
    {
      key: 'metaRanks',
      label: 'Meta Rankings',
      title: "On: the rank column reads UFC.com's Meta Rankings instead of the media panel's (the divisions; pound-for-pound stays the media panel's)",
      default: false,
      slot: 'display',
    },
  ],
  // The rank column: his promotion's (the UFC's or the PFL's), or with UFC Fighters Only on, the UFC's
  // (with Meta Rankings on, "(Meta)" after it, on the division tabs: pound-for-pound has no meta list)
  statLabel: (stat, settings, position) =>
    stat.key === 'officialRank'
      ? `${settings['ufcOnly'] ? 'UFC Rank' : stat.label}${settings['metaRanks'] && !position.includes('P4P') ? ' (Meta)' : ''}`
      : stat.label,
  statName: (stat, position, settings) =>
    stat.key === 'officialRank'
      ? `${settings['ufcOnly'] ? "UFC's Official Division Rank" : "His Promotion's Official Rank (UFC or PFL)"}${settings['metaRanks'] && !position.includes('P4P') ? ": UFC.com's Meta Rankings" : ''}`
      : undefined,
  // (no injury report, and a rookie season means nothing in a fighting career)
  noSwitches: ['showInjured', 'rookiesOnly'],
  // (the women's tabs or the men's, one set at a time)
  tabVisible: (position, settings) => WOMENS_DIVISIONS.includes(position as Position) === womens(settings),
  // Current fighters: today's roster, each in his division now; all-time: the retired fighters too, each
  // in the division he fought in most
  rowVisible: (player, settings) => (allTime(settings) ? player.only !== 'current' : !player.retired && player.only !== 'allTime'),
  // UFC Fighters Only: the others hidden, after the ranking (everyone's still measured against the whole
  // division, so the UFC fighters keep their order)
  rowShown: (player, settings) => !settings['ufcOnly'] || (allTime(settings) ? !!player.ufcCareer : player.promotion === 'UFC'),
  // His promotion's rank in the ranking (the PFL's stretched to the UFC's scale in the data: rankScore): a
  // division's champion as #0 (above #1), an unranked fighter as #16
  // (just past the top 15). Unknown (average) for a retired fighter, and for one unranked without a UFC
  // fight in a year (fighting elsewhere, or dropped from the UFC's rankings for the layoff): that says
  // nothing about how good he is.
  scoreValue: (player, stat, shown) => {
    if (stat.key !== 'officialRank') return undefined;
    if (player.titleHolder) return 0;
    // (pound-for-pound: the P4P top 15, then the division ranks behind them)
    const rank = player.rankScore !== undefined ? player.rankScore : shown;
    if (rank == null && (player.retired || player.inactive)) return null;
    return rank ?? 16;
  },
  // The pound-for-pound tabs: the top 30
  listLimit: (position) => (position === 'P4P' || position === 'WP4P' ? 30 : undefined),
  // Head to head: he won their latest meeting, in the last three years (fights are newest first)
  beat: (a, b) => {
    const meeting = a.fights?.find((f) => f[1] === b.name);
    return !!meeting && meeting[2] === 'W' && meeting[0] >= THREE_YEARS_AGO;
  },
  // A fighter's rates rest on few fights early on: 4 fights count half, 12 count three-quarters. The
  // striking and grappling stats count only the fights they were kept for (the UFC's and PFL's): a
  // Bellator veteran's few PFL fights are a small sample, however long his career
  reliability: (player, stat) => {
    const n = stat.skipMissing ? (player.statFights ?? player.games) : player.games;
    return n / (n + 4);
  },
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
