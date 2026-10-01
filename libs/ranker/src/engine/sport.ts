import type { SkillPlayer, StatBasis } from '@sport/positions';

// How a stat's value reads (every sport's SkillStat.format is one of these): int, dec1, dec2; avg3, a
// batting-average style rate (".287"); ip, innings (175.1); pct, a 0-1 share as a whole percent;
// pctPoints, already in percentage points (1 decimal); record, W-L from the wins / losses stats
// (ranked on the stat's value); grade, a 0-12 support grade (F to A+); rank, a league rank ("#3")
export type StatFormat = 'int' | 'dec1' | 'dec2' | 'avg3' | 'ip' | 'pct' | 'pctPoints' | 'record' | 'grade' | 'rank';

// What a sport hands the engine (apps/<sport>/src/sport/sport.ts exports one as SPORT). Everything else a
// sport defines lives beside it in apps/<sport>/src/sport: positions.ts (tabs, stats, groups),
// skill-presets.ts, skills.ts (the card's skills and archetypes), awards.ts, team-colors.ts,
// logo-eras.ts and about/ (the About panel's content). The engine imports them as @sport/<file>.

// A take on the player card's Overview: what the stats alone don't say
export interface CardFlag {
  icon: string;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

// What a sport's card takes get to work with
export interface FlagContext {
  player: SkillPlayer;
  season: number;
  // The tab (position) the card is on
  position: string;
  // The season is this one (still going)
  current: boolean;
  // "3rd"
  ordinal: (n: number) => string;
  // 175.333 -> "175.1" (baseball innings)
  innings: (value: number) => string;
}

export interface SportConfig {
  // The site path and the sport bar's id ('nba': served at /nba/)
  id: string;
  // The filter menu's title ("NBA Ranker") and its ball's class (styled in the sport's theme)
  appName: string;
  logoClass: string;
  // The season updated every night, and the first one kept (finished seasons in StaticData/seasons)
  currentSeason: number;
  firstSeason: number;
  // How a season reads ("2025", or "2024-25" for a sport named for the year it ends in)
  seasonText: (season: number) => string;
  // Each tab's name: one of them (the card's "Point Guard"), and the tab ("Point Guards")
  positionNames: Record<string, string>;
  tabNames: Record<string, string>;
  // The coaches' tab, if the sport has one (its card reads as a coach's)
  coachTab: string | null;
  // The card's word for a regular at a position ("starter", "reliever", "regular")
  roleWord: (position: string) => string;
  // The Min setting's measure of playing time: its label, hover text and each player's amount
  playingTime: { label: string; title: string; of: (player: SkillPlayer) => number };
  // How counting stats read to start, their decimals per game, and the Stat Totals setting's hover
  // text: example counting stats, and what a full season's pace is
  defaultStatBasis: StatBasis;
  perGameDecimals: number;
  statBasisHelp: { examples: string; pace: string };
  // A team's logo file from its key ("NYK" -> "assets/NBA_Icons/NYK.svg"), and a player's headshot
  teamLogo: (key: string) => string;
  headshot: (id: number, width: number) => string;
  // The card's sport-specific takes (the engine adds the profile-shape ones)
  cardFlags: (context: FlagContext) => CardFlag[];
  // Wording for the engine's own takes
  copy: {
    noHolesIcon: string;
    // (counting skills strong, rate skills weak / the reverse)
    volumeOverEfficiency: string;
    efficiencyOverVolume: string;
    // (results skill strong, play skill weak / the reverse; for a sport with WINS_VS_PLAY)
    winsOverPlay: string;
    playOverWins: string;
  };
}
