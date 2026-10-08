import type { Observable } from 'rxjs';
import type { SkillPlayer, SkillStat, SkillWeights } from '@sport/positions';
import type { CardSkill } from './skills';
import type { RosterGrade } from './roster-grades';
import type { DepthLoadContext, DepthView } from './player-card/depth-chart';
import type { ZoneView } from './player-card/zones';

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
  | 'recent'
  // Minutes as minutes:seconds ("31:24": time of possession)
  | 'mmss';

// How counting stats are shown and ranked: season totals, per game, or per game over a full season (a
// season's pace). Per game and the pace rank the same; they only read differently.
export type StatBasis = 'season' | 'perGame' | 'pace17';

// A stat: a column in the grid and a slider in the filter menu (every sport's SkillStat is one, over its
// own stat keys)
export interface StatDef<Key extends string = string> {
  key: Key;
  label: string;
  description: string;
  // Volume stats scale with games (and can be shown per game); efficiency stats are rates
  kind: 'volume' | 'efficiency';
  format: StatFormat;
  // Full name for hover text, when the sport's STAT_NAMES name for the key doesn't fit this tab
  name?: string;
  // Lower is better (interceptions, ERA)
  negative?: boolean;
  // A support grade (the help around a player): counts at a fifth of a stat's strength, against the
  // player (credit for doing more with less), or for them with supportHelps
  support?: boolean;
  supportHelps?: boolean;
  // Shown for context only: no slider and no weight in the ranking
  infoOnly?: boolean;
  // A missing value means too small a sample, so it scores as the league average, not the worst
  missingIsAverage?: boolean;
  // A missing value means the stat wasn't recorded for him (MMA's strike stats outside the UFC and
  // PFL): it takes his average over the other skipMissing stats he has (judged on what's known of that
  // kind), or the list's average if he has none
  skipMissing?: boolean;
  // Counts for more behind its slider (2: double at every step; 0% still off), or by the sport's settings
  boost?: number | ((settings: SportSettings) => number);
  // Only under some of the sport's settings (MMA: today's rating in the current lists, career points in
  // the all-time ones): otherwise no column, no slider, and no part in the ranking
  shownWhen?: (settings: SportSettings) => boolean;
  // A rank that two rows can share without a tie (MMA: the UFC's #1 and the PFL's #1): no "(t)"
  noTies?: boolean;
  // Scored on a fixed scale, best to worst, rather than against the list (the UFC's rank: the champion
  // to unranked)
  scale?: [best: number, worst: number];
  // Not a rate resting on the row's own sample, so not scaled by SPORT.reliability (the UFC's rank)
  settled?: boolean;
}

// The grid's four stat groups (each sport names and colors them), and a group with its stats
export type StatGroupId = 'results' | 'box' | 'advanced' | 'support';

export interface StatGroup<Stat extends StatDef = StatDef> {
  id: StatGroupId;
  title: string;
  icon: string;
  stats: Stat[];
}

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

// A sport's own setting in the settings menu (the NFL's Fantasy Scoring, Rank Base, Garbage Time)
export interface SportSetting {
  key: string;
  label: string;
  // Hover text
  title: string;
  // A choice cycled by clicking ("Fantasy Scoring: PPR"), or an on/off switch when there are no options
  options?: Record<string, string>;
  // A footer dropdown's options under headers, each with a shorter label there (MMA: Current, with
  // Men's and Women's under it); the closed dropdown still shows the full label from options
  optionGroups?: { label: string; options: Record<string, string> }[];
  default: string | boolean;
  // Where it sits: the Format section's top (above Stat Base), after Stat Base, among the Display
  // switches (before Injured Players), at the bottom of the menu, or (a choice) as the footer's dropdown in
  // the year selector's place (MMA's Current / All-Time)
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

// A player's (or team's) game log this season (the card's Game Log tab): the stat columns, and a row a
// game, newest first ("Sep 13", "@ IND", the opponent's logo, "W 41-23", the game's line). The chart
// above it: the chart's columns game by game, or with none each game's margin (a team's, chartLabel)
export interface GameLog {
  columns: GameLogColumn[];
  rows: GameLogRow[];
  chart?: GameLogChart;
  chartLabel?: string;
}
// The chart: a bar a game of the stack columns piled up (passing yards, then rushing), with a dot a game
// for each of the plus columns' (touchdowns) and the minus columns' (turnovers). Columns by "Group
// LABEL" ("Passing YDS") or LABEL; names: the pieces' names in the legend (their groups unless given)
export interface GameLogChart {
  label: string;
  stack: string[];
  names?: string[];
  // one plain bar of the stack's total (a QB's total yards), its color the result
  combine?: boolean;
  plus?: string[];
  minus?: string[];
}
// A game still to play (the Game Log's last rows): when, where, the opponent's logo, the TV, and the
// sportsbook's line once one is posted ("BAL -3", "O/U 45.5", his team's moneyline "-150")
export interface UpcomingGame {
  // ESPN's id (its preview: the game view)
  event?: string;
  date: string;
  time: string;
  vs: string;
  logo?: string;
  tv?: string;
  line?: string;
  total?: string;
  moneyline?: string;
}
// A column: its label, the category it sits under ("Passing"), text that's wide (a team's leader)
export interface GameLogColumn {
  label: string;
  group?: string;
  wide?: boolean;
}
export interface GameLogRow {
  date: string;
  vs: string;
  logo?: string;
  result: string;
  margin?: number;
  values: string[];
  // a playoff game (the log sets them apart from the regular season)
  playoff?: boolean;
  // the game, to open it (the game view): ESPN's id when the log has it, and its date (ISO, or a day)
  event?: string;
  when?: string;
}

// What the engine gives a sport's connect hook (SportConfig.connect)
export interface EngineHost {
  // The sport's settings as they change
  settings$: Observable<SportSettings>;
  // A tab's list as last shown (dragged or sorted by its sliders), or its default ranking before it's
  // been opened, best first. With an emphasis (stat key -> multiplier on its slider), its sliders'
  // ranking with those stats counting for more or less (the NFL's O-line grade for QBs leans on pass
  // protection); a hand-dragged order stays as dragged.
  rankedUnits(position: string, emphasis?: Record<string, number>): Observable<SkillPlayer[]>;
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
  // The tab's sliders (a combined total mixes its parts by them; the plain sum without)
  weights?: SkillWeights;
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
    // A fixed count instead of a share (MMA's fights: careers don't grow through a season), its
    // starting value and how far each click moves it
    fixed?: { default: number; step: number };
  };
  // How counting stats read to start, their decimals per game, and the Stat Base setting's hover
  // text: example counting stats, and what a full season's pace is
  defaultStatBasis: StatBasis;
  perGameDecimals: number;
  statBasisHelp: { examples: string; pace: string };
  // A team's logo file from its key ("NYK" -> "assets/NBA_Icons/NYK.svg"), and a player's headshot
  teamLogo: (key: string) => string;
  headshot: (id: number, width: number) => string;
  // ...and where else to look when there's none there (the NFL: a rookie ESPN only has a college photo of)
  headshotFallback?: (id: number, width: number) => string;
  // The card's team name (the player's teamName unless given; rows: that season's)
  teamName?: (player: SkillPlayer, position: string, rows: Record<string, SkillPlayer[]>) => string | null;
  // The card's sport-specific takes: first (the engine adds the profile-shape ones after), and last
  cardFlags: (context: FlagContext) => CardFlag[];
  cardFlagsLast?: (context: FlagContext) => CardFlag[];
  // More for the card once it's open (the NFL's run blocking, read from a file per season)
  cardExtras?: (card: CardHost) => Promise<void>;

  // --- Optional data and features (the NFL uses most of them; MMA the career-only ones) ---
  // One career table rather than seasons: no season dropdown, the card reads "Career" and has no
  // season-by-season tab, history takes or similar seasons
  careerOnly?: boolean;
  // How much evidence a row's rate stat rests on, 0-1 (MMA: fights / (fights + 4), counting only the
  // fights a stat was kept for): each rate stat's score in the ranking is scaled by it, so small samples
  // sway the list less. The columns show the real values either way.
  reliability?: (player: SkillPlayer, stat: SkillStat) => number;
  // Head to head: a beat b (MMA: their latest meeting, recent enough to count; all-time, the most of
  // their meetings). After the weighted sort, a row placed below one it beat, within beatReach rows (1
  // if not given: right below), moves above it (MMA: Pimblett over Saint Denis).
  beat?: (a: SkillPlayer, b: SkillPlayer, settings: SportSettings) => boolean;
  beatReach?: (settings: SportSettings) => number;
  // How close the two rows' scores must be for head to head to swap them, in standard deviations of the
  // list's scores (none: any gap; MMA's all-time lists: a close call, not a career's whole resume)
  beatGap?: (settings: SportSettings) => number | undefined;
  // How many of the latest games the Recent column shows and scores, by tab (none: 5; MLB's teams 10,
  // the NBA's and NHL's 7: a few games mean less in a long season)
  recentGames?: (position: string) => number;
  // How many rows a tab lists at most, its top ones (MMA's pound-for-pound tabs: 30); none: all
  listLimit?: (position: string) => number | undefined;
  // Rows the sport's settings can hide (MMA's retired fighters, until switched on)
  rowVisible?: (player: SkillPlayer, settings: SportSettings) => boolean;
  // Rows the sport's settings hide from view only, after the ranking (MMA's UFC Fighters Only): the
  // stats are still measured against everyone rowVisible lists, so hiding some doesn't reorder the rest
  rowShown?: (player: SkillPlayer, settings: SportSettings) => boolean;
  // A tab the sport's settings can hide (MMA's women's divisions, until switched on)
  tabVisible?: (position: string, settings: SportSettings) => boolean;
  // The card's Game Log tab: whether a row has one for a season (that season's games only),
  // and loading it when the tab opens
  gameLog?: {
    has: (player: SkillPlayer, position: string, season: number) => boolean;
    load: (player: SkillPlayer, position: string, season: number) => Promise<GameLog>;
    // ESPN's name for the league ("football/nfl"): the row's team's next games show above the log
    league?: string;
  };
  // The card's Depth Chart tab (a team's rows: the NFL's Team, O-Line, Defense and Head Coach): whether a
  // row has one for a season, and its chart laid out (player-card/depth-chart.ts)
  depthChart?: {
    has: (player: SkillPlayer, position: string, season: number) => boolean;
    load: (player: SkillPlayer, position: string, season: number, context: DepthLoadContext) => Promise<DepthView>;
  };
  // The card's Zones tab (MLB's: a pitcher's or hitter's season by zone, a pitcher's arsenal): whether a
  // row has it for a season, its tab's name, and its zones (player-card/zones.ts)
  zones?: {
    has: (player: SkillPlayer, position: string, season: number) => boolean;
    title: (position: string) => string;
    load: (player: SkillPlayer, position: string, season: number) => Promise<ZoneView>;
  };
  // The card's big hero logo when the sport has a sharper one than the grid's icon (the NFL's, 256px)
  cardLogo?: (logo: string) => string;
  // The card's Analysis tab: the sport publishes AI write-ups (data/analysis: player-card/analysis.ts)
  analysis?: boolean;
  // A history tab on the card in place of the seasons one (MMA's fights): its title and icon, and a
  // player's rows, newest first
  cardHistory?: { title: string; icon: string; rows: (player: SkillPlayer) => HistoryRow[] };
  // More files in each season's folder (key -> file), read into DATA beside skill-players.json
  dataFiles?: Record<string, string>;
  // The stats can count the playoffs, or the regular season and the playoffs together (the settings
  // menu's Stats From; data.ts SeasonPart): skill-players.json's playoff and combined files, and the
  // dataFiles keys named here (whichever of them have their own)
  seasonParts?: boolean;
  seasonPartFiles?: string[];
  // Tabs built in the app from DATA rather than read from skill-players.json (the NFL's QBs)
  extraRows?: () => Record<string, SkillPlayer[]>;
  // The sport's own settings (settings menu)
  settings?: SportSetting[];
  // Settings-menu switches a sport has no use for (MMA: no injury report, no rookie seasons), left out
  // of the menu and of the filtering
  noSwitches?: ('showInjured' | 'rookiesOnly')[];
  // Pairs of stats a tab can show as one total column, and the setting that turns it on
  combined?: { label: string; title: string; stats: (position: string) => CombinedStat[] };
  // A stat's label and full name under the sport's settings ("Off Rank (Pts)"; undefined: the usual)
  statLabel?: (stat: SkillStat, settings: SportSettings, position: string) => string;
  statName?: (stat: SkillStat, position: string, settings: SportSettings) => string | undefined;
  // The Teams tab's roster grades: each a position group graded from your rankings of its players,
  // weighted by playing time (engine/roster-grades)
  rosterGrades?: RosterGrade[];
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
