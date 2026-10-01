import type { Observable } from 'rxjs';
import type { SkillPlayer, SkillStat, StatBasis } from '@sport/positions';
import type { CardSkill } from './skills';

// How a stat's value reads (every sport's SkillStat.format is one of these): int, dec1, dec2; avg3, a
// batting-average style rate (".287"); ip, innings (175.1); pct, a 0-1 share as a whole percent;
// pctPoints, already in percentage points (1 decimal); record, W-L(-T) from the wins / losses / ties
// stats (ranked on the stat's value); grade, a 0-12 support grade (F to A+); rank, a league rank
// ("#3"); recent, the last five results as dots (ranked on a recency-weighted win rate)
export type StatFormat =
  | 'int'
  | 'dec1'
  | 'dec2'
  | 'avg3'
  | 'ip'
  | 'pct'
  | 'pctPoints'
  | 'record'
  | 'grade'
  | 'rank'
  | 'recent';

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
  // Where they rank in the list, 0 (last) to 1 (first)
  overall: number;
  // The card is the table's season (not another season's: grades from the other tabs are the table's)
  tableSeason: boolean;
  // The tab's stats, a stat's value for them, and a 0-12 grade as a letter
  stats: SkillStat[];
  value: (stat: SkillStat) => number | null;
  grade: (value: number) => string;
}

// A sport's own setting in the settings menu (the NFL's Fantasy Scoring, Unit Ranks, Garbage Time)
export interface SportSetting {
  key: string;
  label: string;
  // Hover text
  title: string;
  // A choice cycled by clicking ("Fantasy Scoring: PPR"), or an on/off switch when there are no options
  options?: Record<string, string>;
  default: string | boolean;
  // Where it sits: the Format section's top, after Stat Totals, among the Display switches (before
  // Injured Players), at the bottom of the menu, or (a choice) as the footer's dropdown in the year
  // selector's place (the UFC's Current / All-Time)
  slot: 'formatTop' | 'formatMid' | 'display' | 'displayEnd' | 'footer';
  // Its menu icon (a cycled choice): a Material icon, or a class the styles draw ('lombardi')
  icon?: string;
  iconClass?: string;
}

// The sport's settings' values, by key
export type SportSettings = Record<string, string | boolean>;

// A pair of stats shown as one total column (rushing + receiving yards) while the Combine setting is
// on. In the filter menu the pair is one parent slider with the two as its breakdown: the parent's
// weight scales both parts (50 = as set), and its eye hides all three columns.
export interface CombinedStat {
  stat: SkillStat;
  parts: [string, string];
}

// A line of a card's history tab (SportConfig.cardHistory): a result, what it was, where and when, and
// a detail at the end ("W", "vs. Max Holloway", "UFC 300 · Apr 13, 2024", "R3 4:51")
export interface HistoryRow {
  result: 'W' | 'L' | 'D';
  main: string;
  sub: string;
  detail: string;
}

// What the engine gives a sport's connect hook (SportConfig.connect)
export interface EngineHost {
  // The sport's settings as they change
  settings$: Observable<SportSettings>;
  // A tab's list as last shown (dragged or sorted by its sliders), or its default ranking before it's
  // been opened, best first
  rankedUnits(position: string): Observable<SkillPlayer[]>;
  // The loaded season's rows, every tab's
  rows(): Record<string, SkillPlayer[]>;
}

// What a value worked out in the app (SportConfig.computedValue) gets to work with
export interface ValueContext {
  position: string;
  settings: SportSettings;
  // That season's rows (every tab's for the table, or just this tab's for another season's card)
  rows: Record<string, SkillPlayer[]>;
  // The table's season (another season's card has no grades from the other tabs: they're the table's)
  tableSeason: boolean;
  // A default ranking (the default sliders, other tabs' grades as average), not the table
  defaults: boolean;
}

// What a sport's card extras (SportConfig.cardExtras) get: the card being built, and ways to add to it
export interface CardHost {
  player: SkillPlayer;
  season: number;
  position: string;
  // The seasons they're in, up to the card's
  seasons: number[];
  // The card is still the one showing (checked after each wait)
  open: () => boolean;
  // One tab's rows for a finished season
  tabRows: (season: number) => Promise<SkillPlayer[]>;
  // A season's extra file (StaticData/seasons/<year>/<file>)
  seasonFile: <T>(season: number, file: string) => Promise<T>;
  // The card's skills so far, and adding one (radar and report too), takes or a new archetype
  skills: () => CardSkill[];
  addSkill: (skill: CardSkill) => void;
  addFlags: (flags: CardFlag[]) => void;
  setArchetype: (name: string) => void;
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
  // A date safely after the current season's last game ("2026-06-30"): until then it reads as the
  // current season ("CURRENT", "This Season", "so far"); after, by its name, like a finished one
  currentSeasonEnds: string;
  // How a season reads ("2025", or "2024-25" for a sport named for the year it ends in)
  seasonText: (season: number) => string;
  // Each tab's name: one of them (the card's "Point Guard"), and the tab ("Point Guards")
  positionNames: Record<string, string>;
  tabNames: Record<string, string>;
  // The coaches' tab, if the sport has one (its card reads as a coach's)
  coachTab: string | null;
  // Tabs whose rows are teams (the NFL's defenses and O-lines): no career history on the card, and
  // last season's moves instead
  teamTabs?: string[];
  // The name column's header on a tab ("Player" unless given)
  rowHeader?: (position: string) => string;
  // The card's word for a regular at a position ("starter", "reliever", "regular")
  roleWord: (position: string) => string;
  // The Min setting's measure of playing time: its label, hover text and each player's amount. The
  // share is of the most anyone on the tab has, or of seasonLength (from the season's rows) if given;
  // tabs in everyone have no minimum.
  playingTime: {
    label: string;
    title: string;
    of: (player: SkillPlayer) => number;
    seasonLength?: (rows: Record<string, SkillPlayer[]>, position: string) => number;
    everyone?: string[];
  };
  // How counting stats read to start, their decimals per game, and the Stat Totals setting's hover
  // text: example counting stats, and what a full season's pace is
  defaultStatBasis: StatBasis;
  perGameDecimals: number;
  statBasisHelp: { examples: string; pace: string };
  // A team's logo file from its key ("NYK" -> "assets/NBA_Icons/NYK.svg"), and a player's headshot
  teamLogo: (key: string) => string;
  headshot: (id: number, width: number) => string;
  // The card's team name (the player's teamName unless given; rows: that season's)
  teamName?: (player: SkillPlayer, position: string, rows: Record<string, SkillPlayer[]>) => string | null;
  // The card's sport-specific takes: first (the engine adds the profile-shape ones after), and last
  cardFlags: (context: FlagContext) => CardFlag[];
  cardFlagsLast?: (context: FlagContext) => CardFlag[];
  // More for the card once it's open (the NFL's run blocking, read from a file per season)
  cardExtras?: (card: CardHost) => Promise<void>;

  // --- Optional data and features (the NFL uses most of them; the UFC the career-only ones) ---
  // One career table rather than seasons: no season dropdown, the card reads "Career" and has no
  // season-by-season tab, history takes or similar seasons
  careerOnly?: boolean;
  // How much evidence a row's rates rest on, 0-1 (the UFC: fights / (fights + 4)): each rate stat's
  // score in the ranking is scaled by it, so small samples sway the list less. The columns show the
  // real values either way.
  reliability?: (player: SkillPlayer) => number;
  // Head to head: a beat b in their latest meeting (recent enough to count). After the weighted sort, a
  // row placed right below one it beat moves above it (the UFC: Pimblett over Saint Denis).
  beat?: (a: SkillPlayer, b: SkillPlayer) => boolean;
  // Rows the sport's settings can hide (the UFC's retired fighters, until switched on)
  rowVisible?: (player: SkillPlayer, settings: SportSettings) => boolean;
  // A tab the sport's settings can hide (the UFC's women's divisions, until switched on)
  tabVisible?: (position: string, settings: SportSettings) => boolean;
  // A history tab on the card in place of the seasons one (the UFC's fights): its title and icon, and a
  // player's rows, newest first
  cardHistory?: { title: string; icon: string; rows: (player: SkillPlayer) => HistoryRow[] };
  // More files in each season's folder (key -> file), read into DATA beside skill-players.json
  dataFiles?: Record<string, string>;
  // Tabs built in the app from DATA rather than read from skill-players.json (the NFL's QBs)
  extraRows?: () => Record<string, SkillPlayer[]>;
  // The sport's own settings (settings menu)
  settings?: SportSetting[];
  // Pairs of stats a tab can show as one total column, and the setting that turns it on
  combined?: { label: string; title: string; stats: (position: string) => CombinedStat[] };
  // A stat's label and full name under the sport's settings ("Off Rank (Pts)"; undefined: the usual)
  statLabel?: (stat: SkillStat, settings: SportSettings) => string;
  statName?: (stat: SkillStat, position: string, settings: SportSettings) => string | undefined;
  // A value worked out in the app (fantasy points in the chosen scoring, a league rank, a grade from
  // another tab's ranking); undefined reads the data
  computedValue?: (player: SkillPlayer, stat: SkillStat, context: ValueContext) => number | null | undefined;
  // What a stat counts as in the ranking when that isn't the number shown (the UFC's rank: the champion
  // as 0, an unranked fighter as 16th); undefined: the shown value
  scoreValue?: (player: SkillPlayer, stat: SkillStat, shown: number | null, settings: SportSettings) => number | null | undefined;
  // Stats worked out from the table's season's other tabs: left off another season's card
  tableSeasonOnly?: (stat: SkillStat) => boolean;
  // Called once at startup with the engine's rankings (for grades from other tabs); what it returns
  // fires whenever those values change, re-sorting the table
  connect?: (host: EngineHost) => Observable<unknown>;

  // Wording for the engine's own takes and menus
  copy: {
    noHolesIcon: string;
    // (counting skills strong, rate skills weak / the reverse)
    volumeOverEfficiency: string;
    efficiencyOverVolume: string;
    // (results skill strong, play skill weak / the reverse; for a sport with WINS_VS_PLAY)
    winsOverPlay: string;
    playOverWins: string;
    // The injured bandage's hover (tableCurrent: the table shows this season), and the Injured
    // Players setting's
    injuryTitle: (player: SkillPlayer, tableCurrent: boolean) => string;
    injuredHelp: string;
    // A lower-is-better stat (the Color-Coded Values hover: "like ERA"), and the line Category
    // Dividers draws ("A chalk line")
    lowerIsBetterExample: string;
    groupLine: string;
    // The empty list's message ("No Fighters Found"; "No Players Found" unless given)
    noneFound?: string;
  };
}
