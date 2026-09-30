import { Component, Input, OnChanges, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { skip } from 'rxjs';
import {
  FANTASY_SCORING_LABELS,
  RANK_BASIS_LABELS,
  STAT_BASIS_LABELS,
  StatBasis,
  RANK_METRICS,
  RankBasis,
  statLabelFor,
  FantasyScoring,
  SKILL_STATS,
  STAT_NAMES,
  PER_GAME_LABELS,
  combinedFor,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillWeights,
  fantasyPoints,
  SkillStatGroup,
  SkillStatKey,
  StatGroupId,
  unitStat,
  hasFantasy,
  skillGroups,
  statGroup,
  headlineStats,
  presetWeights,
} from 'app/positions';
import { MAX_MIN_GAMES, PositionService } from 'app/services/position.service';
import { copyRankingsToClipboard } from 'app/utils/clipboard';
import {
  SKILL_UNITS,
  UnitRankKey,
  defaultRanking,
  recencyScore,
  statIsEmpty,
  unitRanks,
  unitsForSeason,
  weightedTotals,
} from 'app/utils/unit-scoring';
import { CURRENT_SEASON, SEASONS, dataSeason, dataVersion, fetchSeason, fetchSeasonFile } from 'StaticData/data';
import { AWARD_INFO, AwardWin, awardsFor } from 'app/awards';
import { TintScale, tintFrom, tintScale } from 'app/utils/value-tint';
import {
  ARCHETYPES,
  CAST_GRADES,
  GARBAGE_TIME_STAT,
  SKILLS,
  VOLUME_VS_EFFICIENCY,
  WINS_VS_PLAY,
  fallbackArchetype,
  standing,
  tierWord,
} from 'app/utils/player-skills';
import { badgeColor, whiteLogo } from 'app/utils/team-colors';


// The player card (click a name): a stat's value, where it ranks in the list and how that compares
export interface CardStat {
  key: string;
  // Its stat group (the tile's sideline color)
  group: string;
  label: string;
  name: string;
  display: string;
  // Recent: the last five results as dots instead of a number
  dots?: number[];
  rank: number | null;
  tied: boolean;
  of: number;
  // 0 (last) to 1 (first) in the list
  pct: number | null;
  avg: string | null;
  // Counts in the strengths / weak spots (not display-only stats or the team's support around them)
  trait: boolean;
  // The value's color when the Color-Coded Values setting is on (as in the table), else null
  tint: string | null;
}

type CardTab = 'overview' | 'stats' | 'seasons';

// Overview: a skill (several related stats rolled up) as a percentile in the list, with the stats
// behind it and where they rank
export interface CardSkill {
  id: string;
  name: string;
  short: string;
  pct: number;
  tier: string;
  standing: string;
  evidence: { label: string; rank: number; of: number }[];
}

export interface CardFlag {
  icon: string;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

// The radar: an axis per skill (line end, label spot), rings, and the shapes (this season, and last
// season's as a ghost once it loads)
export interface CardRadar {
  axes: { x: number; y: number; lx: number; ly: number; anchor: string; label: string; pct: number }[];
  rings: string[];
  shape: string;
  dots: { x: number; y: number; pct: number }[];
}

export interface CardOverview {
  archetype: string;
  blurb: string;
  skills: CardSkill[];
  // Every skill, best first: strengths, then average, then weaknesses
  report: { title: string; tone: 'good' | 'mid' | 'bad'; icon: string; list: CardSkill[] }[];
  flags: CardFlag[];
  radar: CardRadar;
  // Last season's skills (for the radar's ghost and the trend flags), once loaded
  prev: { season: number; shape: string; pcts: Map<string, number> } | null;
  // The archetype came from run blocking (a complete or blocking tight end)
  blockingArchetype?: boolean;
}

// blocking.json (scripts/build-blocking.mjs): runs on the field, team runs in his games, EPA and
// success per carry with him on, runs off, EPA and success with him off, his snaps, the team's snaps,
// dropbacks on the field, QB pressured on those, dropbacks off, pressured on those
type BlockingRow = [
  number,
  number,
  number | null,
  number | null,
  number,
  number | null,
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
];

interface CareerSeason {
  season: number;
  rank: number;
  of: number;
  pct: number;
  skills: CardSkill[];
  archetype: string;
}

// A similar season on the card
export interface CardComp {
  season: number;
  gsisId: string;
  name: string;
  // 0-100
  match: number;
  logo: string;
  color: string;
  whiteLogo: boolean;
  photo: string | null;
}

// Built by scripts/build-comps.mjs: per position, id -> [season, id, name, ESPN id, team, match]
// (comps.json), and id -> [season, team] for every finished season (careers.json)
type CompsFile = Partial<Record<SkillPosition, Record<string, [number, string, string, number | null, string, number][]>>>;
type CareersFile = Partial<
  Record<SkillPosition, Record<string, [number, string, number, number, number, (number | null)[]][]>>
>;

// A season on the card's Seasons tab: team, games, rank with the default sliders, headline stats
export interface CardSeason {
  season: number;
  logo: string;
  games: number;
  rank: number;
  of: number;
  // 0 (last) to 1 (first)
  pct: number;
  // The headline stats: shown value, label, and how it compares across their seasons (share of their
  // best, and whether this is their best)
  stats: { text: string; label: string; value: number | null; share: number; best: boolean; tint?: string | null }[];
  // Ranked with the current sliders (or that season's dragged order) yet; until then, the default rank
  yours?: boolean;
}

// A season other than the table's, for its cards (see SkillRankingsComponent.other)
interface SeasonContext {
  season: number;
  rows: Record<SkillPosition, SkillPlayer[]>;
  list: SkillPlayer[];
  hcRanks: Map<SkillPlayer, Record<UnitRankKey, number | null>> | null;
  empty: (key: string) => boolean;
  // The list is that season's hand-dragged order
  manual?: boolean;
}

export interface PlayerCard {
  player: SkillPlayer;
  season: number;
  // The list it's ranked in (the table's, or that season's), and that season when it isn't the table's
  list: SkillPlayer[];
  context: SeasonContext | null;
  // Every season they're in (null while loading), and their similar seasons (null: not for this season)
  seasons: CardSeason[] | null;
  // The Seasons tab's re-ranking has started (see rankCareer)
  careerRanked?: boolean;
  comps: CardComp[] | null;
  name: string;
  positionName: string;
  seasonLabel: string;
  teamName: string | null;
  logo: string;
  color: string;
  whiteLogo: boolean;
  photo: string | null;
  rank: number;
  of: number;
  awards: AwardWin[];
  groups: { id: string; title: string; icon: string; stats: CardStat[] }[];
  overview: CardOverview;
}

const POSITION_NAMES: Record<SkillPosition, string> = {
  QB: 'Quarterback',
  RB: 'Running Back',
  WR: 'Wide Receiver',
  TE: 'Tight End',
  OL: 'Offensive Line',
  K: 'Kicker',
  P: 'Punter',
  DEF: 'Defense',
  HC: 'Head Coach',
};

@Component({
  selector: 'skill-rankings',
  templateUrl: './skill-rankings.component.html',
  styleUrls: ['../rankings/rankings.component.scss', './player-card.scss'],
  standalone: false,
})
export class SkillRankingsComponent implements OnChanges {
  @ViewChild('rankingsList') rankingsList!: ElementRef<HTMLElement>;

  @Input({ required: true }) position!: SkillPosition;

  playerList: SkillPlayer[] = [];
  stats: SkillStat[] = [];
  weights: SkillWeights = {};
  // Settings-menu toggles are shared with every position (see PositionService)
  // Settings menu: counting stats as season totals, per game or at a 17-game pace
  get statBasis(): StatBasis {
    return this.positionService.settings.statBasis;
  }
  statBasisLabels = STAT_BASIS_LABELS;

  cycleStatBasis() {
    this.positionService.cycleStatBasis();
  }

  // Counting stats are rates (per game, or per game x 17) rather than season totals
  get perGame(): boolean {
    return this.statBasis !== 'season';
  }

  // Same settings menu as the QB page; these two only change the QB table but stay in sync
  get totalStats(): boolean {
    return this.positionService.settings.totalStats;
  }
  set totalStats(value: boolean) {
    this.positionService.updateSettings({ totalStats: value });
  }

  // Settings menu: what the head coaches' Off / Def Rank columns rank on
  get rankBasis(): RankBasis {
    return this.positionService.settings.rankBasis;
  }
  rankBasisLabels = RANK_BASIS_LABELS;

  cycleRankBasis() {
    this.positionService.cycleRankBasis();
  }

  // Each head coach's unit ranks, worked out once per setting (not once per cell)
  private rankCache?: { key: string; ranks: Map<SkillPlayer, Record<UnitRankKey, number | null>> };

  private unitRank(player: SkillPlayer, key: UnitRankKey): number | null {
    if (this.other) return this.other.hcRanks?.get(player)?.[key] ?? null;
    const cacheKey = `${dataVersion}.${this.rankBasis}.${this.garbageTime}`;
    if (this.rankCache?.key !== cacheKey) {
      this.rankCache = { key: cacheKey, ranks: unitRanks(SKILL_UNITS.HC, this.rankBasis, this.garbageTime) };
    }
    return this.rankCache.ranks.get(player)?.[key] ?? null;
  }

  // Another team shares this rank (a small "(t)" in the cell, "#7 (tied)" in hover and copy text)
  rankTied(player: SkillPlayer, stat: SkillStat): boolean {
    if (stat.format !== 'rank') return false;
    const key = stat.key as UnitRankKey;
    const rank = this.unitRank(player, key);
    if (rank === null) return false;
    return [...(this.other?.hcRanks ?? this.rankCache!.ranks)].some(([other, ranks]) => other !== player && ranks[key] === rank);
  }

  get garbageTime(): boolean {
    return this.positionService.settings.garbageTime;
  }
  set garbageTime(value: boolean) {
    this.positionService.updateSettings({ garbageTime: value });
  }

  get showInjured(): boolean {
    return this.positionService.settings.showInjured;
  }
  set showInjured(value: boolean) {
    this.positionService.updateSettings({ showInjured: value });
  }

  // Bandage hover: this season's injury report status, or for a past season, finishing it on IR
  injuryTitle(player: SkillPlayer): string {
    return dataSeason === CURRENT_SEASON
      ? `This player is currently injured${player.injuryStatus ? ` (${player.injuryStatus})` : ''}`
      : 'Finished the season on injured reserve';
  }

  // Footer year dropdown: every season we have, newest first
  readonly seasons = SEASONS;
  readonly currentSeason = CURRENT_SEASON;
  season = CURRENT_SEASON;
  seasonLoading = false;

  selectSeason(season: number) {
    this.positionService.setSeason(season);
  }

  // Footer filter button: opens / closes the filters menu
  get filtersOpen(): boolean {
    return this.positionService.filtersOpen;
  }

  toggleFilters() {
    this.positionService.setFiltersOpen(!this.filtersOpen);
  }

  // Min Games (settings menu): players with fewer games are left out. Tops out at the most games any
  // team has played that season: a finished season's length (16 through 2020, 17 since), or so far this
  // season. A higher setting counts as that (Min Games 15 in week 4 means 4).
  get seasonGames(): number {
    return Math.min(MAX_MIN_GAMES, Math.max(1, ...SKILL_UNITS.DEF.map((team) => team.games)));
  }

  get minGames(): number {
    return Math.min(this.positionService.settings.minGames, this.seasonGames);
  }

  stepMinGames(step: number) {
    const next = Math.min(this.seasonGames, Math.max(1, this.minGames + step));
    if (next === this.minGames) return;
    this.positionService.updateSettings({ minGames: next });
    this.sortPlayers();
  }

  // The players this tab lists: injured players only with Show Injured on, and enough games (not on
  // the team tabs, where everyone plays every week)
  private listedPlayers(): SkillPlayer[] {
    const teamTab = this.position === 'DEF' || this.position === 'OL' || this.position === 'HC';
    const min = teamTab ? 0 : this.minGames;
    return SKILL_UNITS[this.position].filter((player) => (this.showInjured || !player.injured) && player.games >= min);
  }

  get categoryColors(): boolean {
    return this.positionService.settings.categoryColors;
  }
  set categoryColors(value: boolean) {
    this.positionService.updateSettings({ categoryColors: value });
  }

  get colorValues(): boolean {
    return this.positionService.settings.colorValues;
  }
  set colorValues(value: boolean) {
    this.positionService.updateSettings({ colorValues: value });
  }

  // Settings: color-coded values (grades and records keep their own coloring; Games is context only)
  valueColor(player: SkillPlayer, stat: SkillStat): string | null {
    if (!this.colorValues || stat.infoOnly || ['grade', 'record', 'recent'].includes(stat.format)) return null;
    return tintFrom(this.rateValue(player, stat), this.columnScale(stat, 'rate'), !!stat.negative);
  }

  // Each column's average and spread over the list, computed once and reused by every cell and the
  // header hover (recomputing it per cell made the table slow to update, e.g. during column drags).
  // Cleared whenever the list or anything feeding the values changes.
  private scales = new Map<string, TintScale | null>();
  private scalesFor?: unknown[];

  private columnScale(stat: SkillStat, basis: 'rate' | 'shown'): TintScale | null {
    // Another season's card: over that season's list (not cached)
    if (this.other) {
      const list = this.other.list;
      return tintScale(list.map((p) => (basis === 'shown' ? this.value(p, stat) : this.rateValue(p, stat))));
    }
    const inputs = [this.playerList, this.dataVersion, this.statBasis, this.fantasyScoring, this.garbageTime, this.rankBasis];
    if (!this.scalesFor || inputs.some((v, i) => v !== this.scalesFor![i])) {
      this.scales.clear();
      this.scalesFor = inputs;
    }
    const key = `${basis}.${stat.key}`;
    if (!this.scales.has(key)) {
      const value = (p: SkillPlayer) => (basis === 'shown' ? this.value(p, stat) : this.rateValue(p, stat));
      this.scales.set(key, tintScale(this.playerList.map(value)));
    }
    return this.scales.get(key)!;
  }

  // Bumped when grades from other tabs change (QB order, defense / coaching / O-line / weapons)
  private dataVersion = 0;

  get showUnused(): boolean {
    return this.positionService.settings.showUnused;
  }
  set showUnused(value: boolean) {
    this.positionService.updateSettings({ showUnused: value });
  }
  isToastVisible: boolean = false;
  // Where the toast shows: centered just under the copy button
  toastAt = { top: 0, left: 0 };
  fantasyScoring: FantasyScoring = 'ppr';
  scoringLabels = FANTASY_SCORING_LABELS;
  teamQbPlay = new Map<string, number>();
  // Team RB grades from the RB tab's order, weighted by carries
  teamRbPlay = new Map<string, number>();
  // Team grades from the Head Coaches / Defenses tabs' orders (the same grades the QB page uses)
  teamCoaching = new Map<string, number>();
  teamDefense = new Map<string, number>();
  hasFantasy: boolean = true;
  // This position's stat groups, and which are switched off (eye / header chip)
  groups: SkillStatGroup[] = [];
  hidden: Partial<Record<StatGroupId, boolean>> = {};

  constructor(private positionService: PositionService) {
    this.positionService.defenseGrades$.subscribe((grades) => {
      this.teamDefense = grades;
      this.refresh();
    });

    this.positionService.coachingGrades$.subscribe((grades) => {
      this.teamCoaching = grades;
      this.refresh();
    });

    this.positionService.weights$.subscribe((weights) => {
      if (!this.position) return;
      this.weights = weights[this.position];
      this.sortPlayers();
    });

    // QB Play from the QB tab's order (see PositionService)
    this.positionService.qbPlayGrades$.subscribe((grades) => {
      this.teamQbPlay = grades;
      this.refresh();
    });


    this.positionService.skillHidden$.subscribe((hidden) => {
      if (!this.position) return;
      this.hidden = hidden[this.position] ?? {};
      this.sortPlayers();
    });

    // Re-rank when the settings menu changes per-game stats or injured players
    this.positionService.settings$.subscribe(() => {
      if (this.position) this.sortPlayers();
    });

    this.positionService.olineGrades$.subscribe(() => this.refresh());
    this.positionService.weaponsGrades$.subscribe(() => this.refresh());

    this.positionService.rbPlayGrades$.subscribe((grades) => {
      this.teamRbPlay = grades;
      this.refresh();
    });

    // Eyes switch stats off: re-sort without them (the columns hide on their own)
    this.positionService.statHidden$.subscribe(() => {
      if (this.position) this.sortPlayers();
    });

    this.positionService.fantasyScoring$.subscribe((scoring) => {
      this.fantasyScoring = scoring;
      if (this.position) this.sortPlayers();
    });

    // Another season from the year selector: the new rows from the top, in that season's order for
    // this tab (dragged or not) if it has one, otherwise sorted by the sliders
    this.positionService.season$.subscribe((season) => {
      const changed = season !== this.season;
      this.season = season;
      if (changed && this.position) this.ngOnChanges();
    });
    this.positionService.seasonLoading$.subscribe((loading) => (this.seasonLoading = loading));
  }

  // Empty Recent slots for games not played yet (up to five)
  unplayed(player: SkillPlayer): null[] {
    return Array(Math.max(0, 5 - (player.lastFive?.length ?? 0))).fill(null);
  }

  cycleFantasyScoring() {
    this.positionService.cycleFantasyScoring();
  }

  ngOnChanges(): void {
    // A new tab starts scrolled to the top-left of its list
    this.rankingsList?.nativeElement.scrollTo({ top: 0, left: 0 });
    this.stats = SKILL_STATS[this.position];
    this.groups = skillGroups(this.position);
    this.hidden = this.positionService.skillHiddenGroups(this.position);
    this.hasFantasy = hasFantasy(this.position);
    this.weights = this.positionService.getWeights(this.position);
    // A hand-dragged order comes back as it was; otherwise re-sort with the latest grades from the
    // other tabs (a different Defenses order can move the Head Coaches, and so on)
    const saved = this.positionService.unitOrder(this.position);
    if (saved?.manual) this.restoreOrder(saved.ids);
    else this.sortPlayers();
  }

  // Changes from other tabs (QB order, defense / coaching / O-line / weapons grades) re-sort this tab
  // unless its order was dragged by hand; the new values still show either way
  private refresh() {
    this.dataVersion++;
    if (!this.position) return;
    if (!this.positionService.unitOrder(this.position)?.manual) this.sortPlayers();
  }

  // Put the list back in a saved order (units that have since appeared go at the end)
  private restoreOrder(ids: string[]) {
    const players = this.listedPlayers();
    const rank = new Map(ids.map((id, i) => [id, i]));
    this.playerList = [...players].sort((a, b) => (rank.get(a.gsisId) ?? Infinity) - (rank.get(b.gsisId) ?? Infinity));
  }

  // Remember this tab's order for when you come back, and for the grades other tabs use
  private publishOrder(manual: boolean) {
    this.positionService.setUnitOrder(this.position, this.playerList.map((player) => player.gsisId), manual);
  }

  // Sort Players By Weighted Total
  sortPlayers() {
    // Injured players drop out unless the settings menu's Show Injured is on, and so do players under
    // the Min Games setting
    const players = this.listedPlayers();
    // Switched-off groups don't count
    const counted = this.stats.filter((stat) => !this.hidden[statGroup(stat)] && !this.statHidden(stat.key));
    const totals = weightedTotals(players, counted, this.effectiveWeights(), (player, stat) =>
      this.value(player, stat),
    );
    this.playerList = [...players].sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    );
    this.publishOrder(false);
  }

  // Drop Event
  drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.playerList, event.previousIndex, event.currentIndex);
    this.publishOrder(true);
  }

  // Per-game value for volume stats, whatever the display setting: what color-coding uses,
  // so 100 yards in 1 game tints greener than 100 yards in 10 (ranking and display unchanged)
  rateValue(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.rawValue(player, stat);
    if (raw === null) return null;
    return stat.kind === 'volume' && !stat.infoOnly && player.games ? raw / player.games : raw;
  }

  // Label hover: the stat written out, plus the list average of what the column shows (season totals,
  // per game or 17-game pace, as the Stat Totals setting says)
  labelTitle(stat: SkillStat): string {
    const name = this.statName(stat);
    const avg = this.averageText(stat);
    return avg === null ? name : `${name} (Avg: ${avg})`;
  }

  // The list average of what a column shows, formatted like its values (none for records, recent
  // results and ranks)
  averageText(stat: SkillStat): string | null {
    if (stat.format === 'record' || stat.format === 'recent' || stat.format === 'rank') return null;
    const avg = this.columnScale(stat, 'shown')?.mean ?? null;
    if (avg === null) return null;
    let shown: string;
    switch (stat.format) {
      case 'grade':
        shown = this.grade(avg);
        break;
      case 'pct':
        shown = `${Math.round(avg * 100)}%`;
        break;
      case 'pctPoints':
        shown = `${avg.toFixed(1)}%`;
        break;
      case 'dec2':
        shown = avg.toFixed(2);
        break;
      default:
        // (a 17-game pace reads in whole numbers, like its column)
        shown = this.statBasis === 'pace17' && stat.kind === 'volume' ? Math.round(avg).toLocaleString('en-US') : avg.toFixed(1);
    }
    return shown;
  }

  // Volume stats show per-game (or 17-game pace) values unless Stat Totals is on Season Totals
  private showsPerGame(stat: SkillStat): boolean {
    return this.perGame && stat.kind === 'volume';
  }

  // Column label, switched to its per-game name (or tagged "17G") when the column shows rates
  statLabel(stat: SkillStat): string {
    const label = statLabelFor(stat, this.rankBasis);
    if (!this.showsPerGame(stat)) return label;
    return this.statBasis === 'pace17' ? `${label} (17G)` : (PER_GAME_LABELS[stat.key] ?? `${label} / Game`);
  }

  // A header label split before its parenthetical ("Off Rank" + "(Pts)", "Pass Yards" + "(17G)"), which
  // shows smaller
  labelParts(stat: SkillStat): [string, string | null] {
    const label = this.statLabel(stat);
    const match = label.match(/^(.*?)\s*(\([^()]*\))$/);
    return match ? [match[1], match[2]] : [label, null];
  }

  // The stat written out in full; kickers and defenses have their own fixed fantasy scoring
  statName(stat: SkillStat): string {
    const name =
      stat.key === 'fantasy' && !['K', 'DEF'].includes(this.position)
        ? `${FANTASY_SCORING_LABELS[this.fantasyScoring]} Fantasy Points`
        : (stat.name ?? STAT_NAMES[stat.key] ?? stat.label);
    // Unit ranks say what they're ranked on
    if (stat.key in RANK_METRICS) {
      return `${name} (by ${RANK_BASIS_LABELS[this.rankBasis]})`;
    }
    if (!this.showsPerGame(stat)) return name;
    return this.statBasis === 'pace17' ? `${name} (17-game pace)` : `${name} per Game`;
  }

  // Player-row hover (the label invisibly covers its value): "[value] [stat name]"
  valueTitle(player: SkillPlayer, stat: SkillStat): string {
    const name = this.statName(stat);
    const value = this.format(player, stat);
    return value === '-' ? name : `${value} ${name}`;
  }

  // Displayed value: for volume stats, per game or per game x 17 as the Stat Totals setting says
  value(player: SkillPlayer, stat: SkillStat): number | null {
    const raw = this.rawValue(player, stat);
    if (raw === null) return null;
    if (!this.perGame || stat.kind !== 'volume' || !player.games) return raw;
    return (raw / player.games) * (this.statBasis === 'pace17' ? 17 : 1);
  }

  // A row's awards this season (badges beside the name), looked up once per season
  readonly awardInfo = AWARD_INFO;
  private awardCache?: { key: string; wins: Map<SkillPlayer, AwardWin[]> };

  awards(player: SkillPlayer): AwardWin[] {
    const key = `${dataVersion}.${this.position}`;
    if (this.awardCache?.key !== key) this.awardCache = { key, wins: new Map() };
    let wins = this.awardCache.wins.get(player);
    if (!wins) {
      wins = awardsFor(player, this.position, dataSeason);
      this.awardCache.wins.set(player, wins);
    }
    return wins;
  }

  rawValue(player: SkillPlayer, stat: SkillStat): number | null {
    // Another season's card: the grades from other tabs belong to the table's season, so they're left out
    if (this.other && stat.support && stat.key !== 'responsibility') return null;
    switch (stat.key) {
      case 'games':
        return player.games;
      case 'recent':
        return recencyScore(player.lastFive);
      case 'offRank':
      case 'defRank':
        return this.unitRank(player, stat.key);
      // Combined columns (Total Yds, Total TDs, Turnovers): the sum of their two stats
      case 'totalYards':
      case 'totalTds':
      case 'turnovers': {
        const pair = combinedFor(this.position).find(({ stat: total }) => total.key === stat.key);
        if (!pair) return player.stats[stat.key as 'totalTds'] ?? null;
        const values = pair.parts.map((part) => unitStat(player, part as SkillStatKey, this.garbageTime));
        return values.every((v) => v === null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      }
      case 'fantasy':
        return fantasyPoints(player.stats.fantasyStd ?? 0, player.stats.receptions ?? 0, this.fantasyScoring);
      // Preseason blended with the Offensive Lines / RB, WR and TE rankings (the same grades as the QB page)
      case 'oline':
        return this.positionService.olineGrade(player.teamLogo);
      case 'weapons':
        return this.positionService.weaponsGrade(player.teamLogo);
      // Teams without a graded QB yet count as average
      case 'qbPlay':
        return this.teamQbPlay.get(player.teamLogo) ?? 6;
      case 'rbPlay':
        return this.teamRbPlay.get(player.teamLogo) ?? 6;
      // Same as the QB page: preseason coaching blended with the Head Coaches ranking, curved
      case 'coaching':
        return this.positionService.coachingGrade(player.teamLogo);
      case 'defense':
        return Math.round(this.teamDefense.get(player.teamLogo) ?? 6);
      default:
        return unitStat(player, stat.key, this.garbageTime);
    }
  }

  // Groups shown in the grid, each with the stats that have a column
  get visibleGroups(): SkillStatGroup[] {
    // In the order set by dragging the sidebar cards
    const order = this.positionService.groupOrder(this.position);
    return [...this.groups]
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .filter((group) => !this.hidden[group.id])
      .map((group) => ({
        ...group,
        stats: this.combine(this.ordered(group)).filter((stat) => this.isShown(stat)),
      }))
      .filter((group) => group.stats.length);
  }

  // A group's stats in their current column order (dragging a header reorders them; kept in
  // PositionService so the order survives switching tabs)
  private ordered(group: SkillStatGroup): SkillStat[] {
    const order = this.positionService.columnOrder(
      `${this.position}.${group.id}`,
      group.stats.map((stat) => stat.key),
    );
    return [...group.stats].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  // Column id for header dragging: a combined column stands in for the stat whose spot it took
  columnId(stat: SkillStat): string {
    return this.combinedSpot[stat.key] ?? stat.key;
  }

  // Which stat's spot each combined column took (the pair's first one in the current order)
  private combinedSpot: Partial<Record<string, string>> = {};

  // Combined Rush/Pass: a rushing + receiving pair (yards, touchdowns) shows as one total column
  // where the first of the two sits, when the tab has both
  private combine(stats: SkillStat[]): SkillStat[] {
    if (!this.totalStats) return stats;
    let out = stats;
    for (const { stat: total, parts } of combinedFor(this.position)) {
      const at = out.findIndex((stat) => parts.includes(stat.key));
      if (at === -1 || !parts.every((part) => out.some((stat) => stat.key === part))) continue;
      this.combinedSpot[total.key] = out[at].key;
      out = out.flatMap((stat, i) => (i === at ? [total] : parts.includes(stat.key) ? [] : [stat]));
    }
    return out;
  }

  // Switched off with its sidebar eye (or its parent Yards / Touchdowns slider's eye): hidden and out
  // of the ranking, whatever Unweighted Stats says
  private statHidden(key: string): boolean {
    const parent = combinedFor(this.position).find(({ parts }) => parts.includes(key as never));
    return (
      this.positionService.isStatHidden(this.position, key) ||
      (!!parent && this.positionService.isStatHidden(this.position, parent.stat.key))
    );
  }

  // Slider weights with each rush / rec part scaled by its parent slider (50 = as set, 0 = off)
  private effectiveWeights(): SkillWeights {
    const weights = { ...this.weights };
    for (const { stat, parts } of combinedFor(this.position)) {
      const parent = this.weights[stat.key] ?? 50;
      for (const part of parts) weights[part] = ((weights[part] ?? 0) * parent) / 50;
    }
    return weights;
  }

  // The eye decides first; Unweighted Stats only decides whether a 0% stat shows
  isShown(stat: SkillStat): boolean {
    // A combined column shows if either of its stats would
    const weights = this.effectiveWeights();
    const combined = combinedFor(this.position).find((c) => c.stat.key === stat.key);
    const empty = (key: string) => (this.other ? this.other.empty(key) : statIsEmpty(this.position, key));
    if (combined) {
      const parts = combined.parts.filter((key) => !this.statHidden(key) && !empty(key));
      return parts.length > 0 && (this.showUnused || parts.some((key) => !!weights[key]));
    }
    if (this.statHidden(stat.key)) return false;
    // Not recorded that season
    if (empty(stat.key)) return false;
    // Display-only columns (Games, FG Att) have no weight, so they show unless their eye is off
    if (stat.infoOnly) return true;
    return this.showUnused || !!weights[stat.key];
  }

  format(player: SkillPlayer, stat: SkillStat): string {
    const value = this.value(player, stat);
    if (value === null) return '-';
    // Per game reads to a decimal; a 17-game pace rounds to a whole season's worth
    const perGameVolume = this.statBasis === 'perGame' && stat.kind === 'volume';
    const paceVolume = this.statBasis === 'pace17' && stat.kind === 'volume';
    switch (stat.format) {
      case 'grade':
        return this.grade(value);
      case 'rank':
        return this.rankTied(player, stat) ? `#${value} (tied)` : `#${value}`;
      case 'record': {
        const { wins, losses, ties } = player.stats;
        return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
      }
      case 'pctPoints':
        return `${(Number(value.toFixed(1)) + 0).toFixed(1)}%`;
      case 'pct':
        return `${Math.round(value * 100)}%`;
      // + 0 turns -0 into 0 so tiny negatives don't show as "-0.00"
      case 'dec1':
        return (Number(value.toFixed(1)) + 0).toFixed(1);
      case 'dec2':
        return (Number(value.toFixed(2)) + 0).toFixed(2);
      default:
        if (perGameVolume) return value.toFixed(1);
        return (paceVolume ? Math.round(value) : value).toLocaleString('en-US');
    }
  }

  // 0-12 -> F..A+, matching the QB support grades
  grade(value: number): string {
    const grades = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
    return grades[Math.min(12, Math.max(0, Math.round(value)))];
  }

  // Red (0) to green (12), same scale as the QB page
  gradeColor(player: SkillPlayer, stat: SkillStat): string | null {
    if (stat.format !== 'grade') return null;
    // Brighter at the red end so low grades stay readable on their dark pill
    const value = this.value(player, stat) ?? 6;
    return `hsl(${Math.round((value / 12) * 120)}, 100%, ${Math.round(50 + (1 - value / 12) * 16)}%)`;
  }

  // Color of the badge behind the team logo (the team's primary, or secondary for logos drawn in it)
  teamBadge(unit: { teamLogo: string }): string {
    return badgeColor(unit.teamLogo);
  }

  // The player's ESPN headshot (a cutout on a clear background), sized for the team card; none for
  // teams and units, or when ESPN has no photo (older seasons often don't)
  private missingHeadshots = new Set<number>();

  headshot(unit: { id?: number | null }): string | null {
    if (!unit.id || this.missingHeadshots.has(unit.id)) return null;
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${unit.id}.png&w=160&h=116`;
  }

  noHeadshot(unit: { id?: number | null }): void {
    if (unit.id) this.missingHeadshots.add(unit.id);
  }

  // Logos drawn in white on their badge (e.g. the Giants)
  teamLogoWhite(unit: { teamLogo: string }): boolean {
    return whiteLogo(unit.teamLogo);
  }

  // Get Count Classes
  // Gold for #1 (the top-5 class, with the trophy), green for 2-10 (top-10), red for the bottom 10
  // (bottom-5), white for the rest
  getCountClasses(i: number): string {
    if (i === 0) return 'count top-5';
    // The top 10 keep their green if the list is ever that short
    if (i < 10) return 'count top-10';
    if (i >= this.playerList.length - 10) return 'count bottom-5';
    return 'count';
  }

  // Footer info button: the About / FAQ panel (the button lights up while it's open)
  get aboutOpen(): boolean {
    return this.positionService.aboutOpen;
  }

  openAbout() {
    this.positionService.setAboutOpen(true);
  }

  // Copy Player Names
  copyPlayerListToClipboard(button: HTMLElement) {
    const rect = button.getBoundingClientRect();
    this.toastAt = { top: rect.bottom + 8, left: rect.left + rect.width / 2 };
    copyRankingsToClipboard(this.rankingsList.nativeElement)
      .then(() => this.showToast())
      .catch((err) => console.error('Failed to copy: ', err));
  }

  // ===========================================================================
  // Player card: click a name for their stats as ranks in the list (the columns showing in the grid)
  // ===========================================================================
  card: PlayerCard | null = null;
  cardLoading = false;
  // The card's tab (kept while flipping through players and seasons)
  cardTab: CardTab = 'overview';
  private readonly allCardTabs: { id: CardTab; title: string }[] = [
    { id: 'overview', title: 'Overview' },
    { id: 'stats', title: 'Stats' },
    { id: 'seasons', title: 'Seasons' },
  ];

  // Seasons only when they're in more than one (shown while loading)
  cardTabs(card: PlayerCard): { id: CardTab; title: string }[] {
    return this.allCardTabs.filter((tab) => tab.id !== 'seasons' || !card.seasons || card.seasons.length > 1);
  }

  // While a card for a season other than the table's is being built: that season's rows, list (ranked
  // with the current sliders), coach ranks and missing stats. The value helpers read it instead of
  // the table's season.
  private other: SeasonContext | null = null;

  // Other seasons' rows, similar seasons and everyone's seasons, fetched once each
  private seasonRows = new Map<number, Promise<Record<SkillPosition, SkillPlayer[]>>>();
  private seasonComps = new Map<number, Promise<CompsFile>>();
  private careers?: Promise<CareersFile>;

  // A name in the table: their card for the table's season, ranked as the table has them
  openCard(player: SkillPlayer): void {
    // (a name in the table always opens on the Overview; flipping through players and seasons keeps
    // the tab you're on)
    this.cardTab = 'overview';
    this.showCard(this.renderCard(player, this.season, this.playerList, null));
  }

  // A season link or a similar season: that season's card, without changing the table (the table's
  // own season shows as the table has it)
  async openSeasonCard(season: number, gsisId: string): Promise<void> {
    const listed = season === this.season ? this.playerList.find((p) => p.gsisId === gsisId) : undefined;
    if (listed) {
      this.showCard(this.renderCard(listed, this.season, this.playerList, null));
      return;
    }
    this.cardLoading = true;
    try {
      const rows = season === this.season ? SKILL_UNITS : await this.rowsFor(season);
      const player = rows[this.position]?.find((p) => p.gsisId === gsisId);
      if (!player) return;
      const context = this.seasonContext(season, rows);
      // (someone under the Min Games setting still gets their card, ranked where they'd fall)
      if (!context.list.includes(player)) {
        context.list = context.manual ? [...context.list, player] : this.rankedIn(context, [...context.list, player]);
      }
      this.showCard(this.renderCard(player, season, context.list, context));
    } catch (err) {
      console.error(err);
    } finally {
      this.cardLoading = false;
    }
  }

  private showCard(card: PlayerCard): void {
    this.card = card;
    // (a tab this card doesn't have falls back to the Overview)
    if (!this.cardTabs(card).some((tab) => tab.id === this.cardTab)) this.cardTab = 'overview';
    this.loadCardLinks(card);
    this.loadPrevSkills(card);
  }

  // ---------------------------------------------------------------------------
  // Overview: skills, archetype, the one-line take and the context flags
  // ---------------------------------------------------------------------------

  // Each skill as a percentile in the list: the average of its stats' percentiles (volume stats per
  // game), each stat turned the skill's way. Stats a season didn't record are skipped, and a skill
  // with none of its stats is left out. Reads another season while this.other is set.
  private skillsFor(player: SkillPlayer, list: SkillPlayer[]): CardSkill[] {
    const out: CardSkill[] = [];
    for (const def of SKILLS[this.position]) {
      const pcts: number[] = [];
      const evidence: CardSkill['evidence'] = [];
      for (const [key, dir] of def.parts) {
        const stat = this.stats.find((s) => s.key === key);
        if (!stat || (this.other ? this.other.empty(key) : statIsEmpty(this.position, key))) continue;
        const mine = this.rateValue(player, stat);
        if (mine === null) continue;
        const values = list.map((p) => this.rateValue(p, stat)).filter((v): v is number => v !== null);
        if (values.length < 3) continue;
        const below = values.filter((v) => v < mine).length;
        const equal = values.filter((v) => v === mine).length - 1;
        const high = (below + equal / 2) / (values.length - 1);
        pcts.push(dir > 0 ? high : 1 - high);
        const rank = 1 + values.filter((v) => (dir > 0 ? v > mine : v < mine)).length;
        const label = stat.kind === 'volume' ? (PER_GAME_LABELS[stat.key] ?? `${stat.label} / Game`) : stat.label;
        if (!evidence.some((e) => e.label === label)) evidence.push({ label, rank, of: values.length });
      }
      if (!pcts.length) continue;
      const pct = pcts.reduce((a, v) => a + v, 0) / pcts.length;
      out.push({
        id: def.id,
        name: def.name,
        short: def.short,
        pct,
        tier: tierWord(pct),
        standing: standing(pct),
        evidence: evidence.sort((a, b) => a.rank / a.of - b.rank / b.of),
      });
    }
    return out;
  }

  private buildOverview(player: SkillPlayer, season: number, list: SkillPlayer[], context: SeasonContext | null): CardOverview {
    const skills = this.skillsFor(player, list);
    const at = list.indexOf(player);
    const overall = at < 0 || list.length < 2 ? 0.5 : (list.length - 1 - at) / (list.length - 1);
    const scores = Object.fromEntries(SKILLS[this.position].map((def) => [def.id, 0.5]));
    for (const skill of skills) scores[skill.id] = skill.pct;
    const archetype = this.archetypeFor(skills, overall);
    const { strengths, weaknesses } = this.reportFor(skills);
    return {
      archetype,
      blurb: this.overviewBlurb(strengths, [...weaknesses].reverse()),
      skills,
      report: this.reportFor(skills).report,
      flags: this.overviewFlags(player, season, overall, scores, context),
      radar: this.radar(skills),
      prev: null,
    };
  }

  // The scouting report: every skill, best first, split into strengths, average and weaknesses
  private reportFor(skills: CardSkill[]) {
    const sorted = [...skills].sort((a, b) => b.pct - a.pct);
    const strengths = sorted.filter((s) => s.pct >= 0.65);
    const weaknesses = sorted.filter((s) => s.pct <= 0.35);
    const average = sorted.filter((s) => s.pct > 0.35 && s.pct < 0.65);
    const report: CardOverview['report'] = [
      { title: 'Strengths', tone: 'good', icon: 'trending_up', list: strengths },
      { title: 'Average', tone: 'mid', icon: 'trending_flat', list: average },
      { title: 'Weaknesses', tone: 'bad', icon: 'trending_down', list: weaknesses },
    ];
    return { strengths, weaknesses, report };
  }

  // "Elite accuracy and strong efficiency, held back by poor ball security."
  private overviewBlurb(strengths: CardSkill[], weaknesses: CardSkill[]): string {
    const say = (s: CardSkill) => `${s.tier.toLowerCase()} ${s.name.toLowerCase()}`;
    const [a, b] = strengths.filter((s) => s.pct >= 0.75);
    const weak = weaknesses[0];
    let text: string;
    if (a) {
      text = say(a) + (b ? ` and ${say(b)}` : '');
      if (weak) text += `, held back by ${say(weak)}`;
    } else if (weak) {
      text = `No standout skill, and ${say(weak)} drags on the rest`;
    } else {
      text = 'A balanced profile with no glaring strength or weakness';
    }
    return text.charAt(0).toUpperCase() + text.slice(1) + '.';
  }

  // Context the stats alone don't say: a small sample, garbage-time padding, volume against efficiency,
  // and the team around them (the table's season only: other seasons' support grades aren't loaded)
  private overviewFlags(
    player: SkillPlayer,
    season: number,
    overall: number,
    scores: Record<string, number>,
    context: SeasonContext | null,
  ): CardFlag[] {
    const flags: CardFlag[] = [];
    const teamTab = ['DEF', 'OL', 'HC'].includes(this.position);
    if (!teamTab && player.games < 6) {
      flags.push({
        icon: 'hourglass_bottom',
        tone: 'info',
        text: season === CURRENT_SEASON ? `Small sample: ${player.games} games so far` : `Only ${player.games} games played`,
      });
    }
    const garbage = GARBAGE_TIME_STAT[this.position];
    if (garbage && player.competitive) {
      const [key, words] = garbage;
      const all = unitStat(player, key as SkillStatKey, true);
      const competitive = unitStat(player, key as SkillStatKey, false);
      if (all && competitive !== null && all / Math.max(player.games, 1) >= 20) {
        const share = (all - competitive) / all;
        if (share >= 0.15) {
          flags.push({ icon: 'hourglass_empty', tone: 'bad', text: `Padded: ${Math.round(share * 100)}% of the ${words} came in garbage time` });
        }
      }
    }
    // The shape of the profile: no holes, or one skill carrying the rest
    const pcts = Object.values(scores);
    const elite = pcts.filter((p) => p >= 0.85).length;
    if (pcts.length >= 4 && pcts.every((p) => p >= 0.5) && pcts.filter((p) => p >= 0.7).length >= pcts.length / 2) {
      flags.push({ icon: 'shield', tone: 'good', text: 'No holes: at least average in every skill' });
    } else if (elite === 1 && pcts.filter((p) => p >= 0.6).length === 1) {
      const star = SKILLS[this.position].find((def) => scores[def.id] >= 0.85)!;
      flags.push({ icon: 'looks_one', tone: 'info', text: `One-dimensional: ${star.name} carries the profile` });
    }
    // Results against the play: winning more (or less) than the numbers say
    const results = WINS_VS_PLAY[this.position];
    if (results) {
      const [win, play] = results.map((id) => scores[id]);
      if (win >= 0.7 && play <= 0.35) {
        flags.push({ icon: 'casino', tone: 'info', text: 'Winning more than the numbers say' });
      } else if (play >= 0.7 && win <= 0.3) {
        flags.push({ icon: 'sentiment_dissatisfied', tone: 'info', text: 'Playing better than the record shows' });
      }
    }
    const split = VOLUME_VS_EFFICIENCY[this.position];
    if (split) {
      const [volume, efficiency] = split.map((id) => scores[id]);
      if (volume >= 0.7 && efficiency <= 0.35) {
        flags.push({ icon: 'stacked_bar_chart', tone: 'bad', text: 'Big volume, below-average efficiency: a compiler' });
      } else if (efficiency >= 0.75 && volume <= 0.35) {
        flags.push({ icon: 'bolt', tone: 'good', text: 'Efficient in a limited role: earning more work' });
      }
    }
    if (!context) {
      let cast = 0;
      const relevant = CAST_GRADES[this.position] ?? [];
      for (const stat of this.stats.filter((s) => relevant.includes(s.key))) {
        const grade = this.rawValue(player, stat);
        if (grade === null || cast >= 2) continue;
        const letter = this.grade(grade);
        // ("Producing despite D rated QB Play": the letter alone next to the label reads oddly)
        // (D+ or worse, A- or better: a middling grade isn't worth a flag)
        if (stat.supportHelps) {
          if (grade >= 10) flags.push({ icon: 'fitness_center', tone: 'good', text: `Carrying the offense (${letter} rated Responsibility)` });
          else if (grade <= 3) flags.push({ icon: 'group', tone: 'info', text: `Leaning on the team around them (${letter} rated Responsibility)` });
          else continue;
        } else if (grade <= 3 && overall >= 0.65) {
          flags.push({ icon: 'fitness_center', tone: 'good', text: `Producing despite ${letter} rated ${stat.label}` });
        } else if (grade <= 3 && overall <= 0.4) {
          flags.push({ icon: 'group', tone: 'info', text: `Held back by ${letter} rated ${stat.label}` });
        } else if (grade >= 10 && overall >= 0.65) {
          flags.push({ icon: 'group', tone: 'info', text: `Helped by ${letter} rated ${stat.label}` });
        } else continue;
        cast++;
      }
    }
    return flags;
  }

  // ---------------------------------------------------------------------------
  // Run blocking (TEs mostly, WRs lightly): from who was on the field each play, published after each
  // season (scripts/build-blocking.mjs). The card's analysis reads the detail; the table has Run Block
  // EPA. A season that isn't charted yet (this one) says nothing. Only notable numbers say anything.
  // ---------------------------------------------------------------------------
  private blockingFiles = new Map<number, Promise<Record<string, BlockingRow>>>();

  private blockingFor(season: number): Promise<Record<string, BlockingRow>> {
    let file = this.blockingFiles.get(season);
    if (!file) {
      file = season === CURRENT_SEASON ? Promise.resolve({}) : fetchSeasonFile<Record<string, BlockingRow>>(season, 'blocking.json').catch(() => ({}));
      this.blockingFiles.set(season, file);
    }
    return file;
  }

  private async loadBlocking(card: PlayerCard): Promise<void> {
    if (!['TE', 'WR', 'RB'].includes(this.position) || !card.seasons) return;
    const id = card.player.gsisId;
    const te = this.position === 'TE';
    try {
      const upTo = card.seasons.filter((s) => s.season <= card.season).map((s) => s.season);
      const charted: { season: number; tilt: number; impact: number | null; share: number }[] = [];
      for (const season of upTo) {
        const row = (await this.blockingFor(season))[id];
        if (!row) continue;
        const [on, teamRuns, epaOn, , off, epaOff, , snaps, teamSnaps] = row;
        if (snaps < 150 || !teamSnaps || !teamRuns) continue;
        charted.push({
          season,
          tilt: on / snaps / (teamRuns / teamSnaps),
          impact: off >= 40 && epaOn !== null && epaOff !== null ? epaOn - epaOff : null,
          share: on / teamRuns,
        });
      }
      // Only the card's own season counts: a season that isn't charted (this one, until it's over)
      // says nothing about run blocking rather than borrowing an older season's
      const latest = charted[charted.length - 1];
      if (this.card !== card || !latest || latest.season !== card.season) return;
      // (backs are read on pass protection instead)
      if (this.position === 'RB') {
        await this.addPassProSkill(card, card.season);
        return;
      }
      await this.addBlockingSkill(card, latest.season);
      if (this.card !== card) return;
      const flags: CardFlag[] = [];
      const epa = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
      if (te) {
        if (latest.tilt >= 1.2) {
          flags.push({ icon: 'sports_mma', tone: 'info', text: `Blocking-first role: out there far more on runs than passes` });
        } else if (latest.tilt <= 0.65) {
          flags.push({ icon: 'open_with', tone: 'info', text: `Move tight end: rarely on the field for runs` });
        }
        if (latest.impact !== null && latest.impact >= 0.08) {
          flags.push({ icon: 'sports_mma', tone: 'good', text: `Run-game boost: ${epa(latest.impact)} EPA per carry with him on the field` });
        } else if (latest.impact !== null && latest.impact <= -0.08) {
          flags.push({ icon: 'sports_mma', tone: 'bad', text: `Runs fared worse with him on the field (${epa(latest.impact)} EPA per carry)` });
        }
        // Across the career: a steady plus in the run game
        const measured = charted.filter((c) => c.impact !== null);
        const plus = measured.filter((c) => c.impact! >= 0.05).length;
        if (measured.length >= 3 && plus / measured.length >= 0.7) {
          flags.push({ icon: 'verified', tone: 'good', text: `Consistent run-game boost: a plus in ${plus} of ${measured.length} charted seasons` });
        }
        // The archetype: a blocker who also produces is a complete tight end; a blocker who doesn't
        // catch much is a blocking tight end
        const scores = Object.fromEntries(card.overview.skills.map((s) => [s.id, s.pct]));
        const catches = Math.max(scores['production'] ?? 0, scores['role'] ?? 0);
        const blocker =
          latest.impact !== null && latest.impact >= 0.08 && catches >= 0.7
            ? 'Complete Tight End'
            : latest.tilt >= 1.2 && catches <= 0.4
              ? 'Blocking Tight End'
              : null;
        if (blocker) {
          card.overview.archetype = blocker;
          card.overview.blockingArchetype = true;
          // (a "new profile" note compared receiving-only archetypes, so it no longer applies)
          card.overview.flags = card.overview.flags.filter((f) => !f.text.startsWith('New profile'));
        }
      } else {
        // Receivers: only the notable (a passing-down specialist, or a big run-game swing)
        if (latest.tilt <= 0.65) {
          flags.push({ icon: 'swap_vert', tone: 'info', text: `Passing-down specialist: rarely on the field for runs` });
        }
        if (latest.impact !== null && latest.impact >= 0.15) {
          flags.push({ icon: 'sports_mma', tone: 'info', text: `Runs gained ${epa(latest.impact)} EPA per carry with him on the field` });
        }
      }
      card.overview.flags = [...card.overview.flags, ...flags];
    } catch (err) {
      console.error(err);
    }
  }

  // A Run Blocking skill on the radar and in the report (TEs; backs and receivers when there's an on/off
  // sample): the share of his team's runs he was on the field for, and the run game with him on
  // against off (when he sat for enough runs to tell), each as a percentile among that season's
  // players at the position (finished seasons only).
  private async addBlockingSkill(card: PlayerCard, season: number): Promise<void> {
    const [file, tes] = await Promise.all([this.blockingFor(season), this.tabRowsFor(season)]);
    const rows = tes
      .map((u) => ({ id: u.gsisId, row: file[u.gsisId] }))
      .filter((r): r is { id: string; row: BlockingRow } => !!r.row && r.row[7] >= 150);
    const mine = rows.find((r) => r.id === card.player.gsisId);
    if (!mine || rows.length < 5 || this.card !== card) return;
    const share = (r: BlockingRow) => r[0] / r[1];
    const impact = (r: BlockingRow) => (r[4] >= 40 && r[2] !== null && r[5] !== null ? r[2] - r[5] : null);
    const pctOf = (values: number[], v: number) => values.filter((x) => x < v).length / Math.max(values.length - 1, 1);
    const shares = rows.map((r) => share(r.row));
    const impacts = rows.map((r) => impact(r.row)).filter((v): v is number => v !== null);
    const parts = [pctOf(shares, share(mine.row))];
    const myImpact = impact(mine.row);
    // (for backs and receivers, being on the field for runs mostly says they play every down: the
    // axis only shows when the run game with them on and off can be compared)
    if (this.position !== 'TE' && (myImpact === null || impacts.length < 5)) return;
    if (myImpact !== null && impacts.length >= 5) parts.push(pctOf(impacts, myImpact));
    const pct = Math.min(1, parts.reduce((a, v) => a + v, 0) / parts.length);
    const rankIn = (values: number[], v: number) => 1 + values.filter((x) => x > v).length;
    const skill: CardSkill = {
      id: 'blocking',
      name: 'Run Blocking',
      short: 'Run Block',
      pct,
      tier: tierWord(pct),
      standing: standing(pct),
      evidence: [
        { label: `Share of Runs On Field`, rank: rankIn(shares, share(mine.row)), of: shares.length },
        ...(myImpact !== null ? [{ label: `Run EPA On vs Off`, rank: rankIn(impacts, myImpact), of: impacts.length }] : []),
      ],
    };
    const o = card.overview;
    o.skills = [...o.skills.filter((s) => s.id !== 'blocking'), skill];
    o.radar = this.radar(o.skills);
    o.report = this.reportFor(o.skills).report;
    if (o.prev) o.prev.shape = this.radarShape(o.skills.map((s) => o.prev!.pcts.get(s.id) ?? s.pct));
  }

  // A back's Pass Pro skill on the radar and in the report, and a take when it's notable: the QB's
  // pressure rate on dropbacks with him on the field against off (at least 40 dropbacks each way), as a
  // percentile among that season's backs (lower pressure is better)
  private async addPassProSkill(card: PlayerCard, season: number): Promise<void> {
    const [file, backs] = await Promise.all([this.blockingFor(season), this.tabRowsFor(season)]);
    const delta = (r: BlockingRow | undefined) =>
      r && r[9] >= 40 && r[11] >= 40 ? (r[10] / r[9] - r[12] / r[11]) * 100 : null;
    const values = backs.map((u) => delta(file[u.gsisId])).filter((v): v is number => v !== null);
    const mine = delta(file[card.player.gsisId]);
    if (mine === null || values.length < 5 || this.card !== card) return;
    const pct = values.filter((v) => v > mine).length / Math.max(values.length - 1, 1);
    const skill: CardSkill = {
      id: 'passPro',
      name: 'Pass Protection',
      short: 'Pass Pro',
      pct: Math.min(1, pct),
      tier: tierWord(pct),
      standing: standing(pct),
      evidence: [{ label: 'QB Pressure On vs Off', rank: 1 + values.filter((v) => v < mine).length, of: values.length }],
    };
    const o = card.overview;
    o.skills = [...o.skills.filter((s) => s.id !== 'passPro'), skill];
    o.radar = this.radar(o.skills);
    o.report = this.reportFor(o.skills).report;
    if (o.prev) o.prev.shape = this.radarShape(o.skills.map((s) => o.prev!.pcts.get(s.id) ?? s.pct));
    const pts = (v: number) => `${Math.abs(v).toFixed(1)} points`;
    if (mine <= -5) {
      o.flags = [...o.flags, { icon: 'shield', tone: 'good', text: `Pass-pro plus: the QB was pressured ${pts(mine)} less often with him on the field` }];
    } else if (mine >= 5) {
      o.flags = [...o.flags, { icon: 'shield', tone: 'bad', text: `Pass-pro concern: the QB was pressured ${pts(mine)} more often with him on the field` }];
    }
  }

  // Good first, then neutral, then bad
  sortFlags(flags: CardFlag[]): CardFlag[] {
    const order = { good: 0, info: 1, bad: 2 };
    return [...flags].sort((a, b) => order[a.tone] - order[b.tone]);
  }

  private archetypeFor(skills: CardSkill[], overall: number): string {
    const scores = Object.fromEntries(SKILLS[this.position].map((def) => [def.id, 0.5]));
    for (const skill of skills) scores[skill.id] = skill.pct;
    return ARCHETYPES[this.position].find((a) => a.test(scores, overall))?.name ?? fallbackArchetype(this.position, overall);
  }

  // One season of a career for the history: where they ranked (current sliders) and their skills,
  // or null when they're not in that year's list (under Min Games, or hidden as injured)
  private async careerSeason(card: PlayerCard, season: number): Promise<CareerSeason | null> {
    if (season === card.season) {
      const pct = card.of > 1 ? (card.of - card.rank) / (card.of - 1) : 1;
      return { season, rank: card.rank, of: card.of, pct, skills: card.overview.skills, archetype: card.overview.archetype };
    }
    const id = card.player.gsisId;
    let list: SkillPlayer[];
    let context: SeasonContext | null = null;
    if (season === this.season) {
      list = this.playerList;
    } else {
      const rows =
        season === CURRENT_SEASON ? (await this.rowsFor(CURRENT_SEASON))[this.position] : await this.tabRowsFor(season);
      context = this.seasonContext(season, { [this.position]: rows } as Record<SkillPosition, SkillPlayer[]>);
      list = context.list;
    }
    const at = list.findIndex((p) => p.gsisId === id);
    if (at < 0) return null;
    this.other = context;
    try {
      const skills = this.skillsFor(list[at], list);
      const pct = list.length > 1 ? (list.length - 1 - at) / (list.length - 1) : 1;
      return { season, rank: at + 1, of: list.length, pct, skills, archetype: this.archetypeFor(skills, pct) };
    } finally {
      this.other = null;
    }
  }

  // Career to date: this season and the ones before it (never later ones, so a 2021 card reads like it
  // did in 2021). Players and coaches only: a defense or O-line turns over too much year to year.
  private async loadHistory(card: PlayerCard): Promise<void> {
    if (['DEF', 'OL'].includes(this.position) || !card.seasons) return;
    const upTo = card.seasons.filter((s) => s.season <= card.season);
    try {
      const entries = (await Promise.all(upTo.map((s) => this.careerSeason(card, s.season)))).filter(
        (e): e is CareerSeason => !!e,
      );
      if (this.card !== card || !entries.length) return;
      card.overview.flags = [...card.overview.flags, ...this.buildHistory(card, upTo.map((s) => s.season), entries)];
    } catch (err) {
      console.error(err);
    }
  }

  // The profile's history points: a career stage, how this season compares with their norm, streaks,
  // their calling card and a long-running issue, and a change of profile
  private buildHistory(card: PlayerCard, played: number[], entries: CareerSeason[]): CardFlag[] {
    const n = played.length;
    // (the data starts in 2000: a player already in it then wasn't necessarily a rookie)
    const known = played[0] > 2000;
    const now = entries.find((e) => e.season === card.season)!;
    const prior = entries.filter((e) => e.season < card.season);
    const avg = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length;
    const careerAvg = avg(entries.map((e) => e.pct));
    const priorAvg = prior.length ? avg(prior.map((e) => e.pct)) : null;
    const flags: CardFlag[] = [];

    // (the stage leans on recent form: the last three seasons count most)
    const recent = avg(entries.slice(-3).map((e) => e.pct));
    // (a decline is two down years running, each well under the norm before it)
    const last = prior[prior.length - 1];
    const before = prior.slice(0, -1);
    const declining =
      !!last && before.length >= 2 && priorAvg !== null && now.pct <= priorAvg - 0.2 && last.pct <= avg(before.map((e) => e.pct)) - 0.2;
    flags.push(this.careerStage(n, known, now.pct, 0.6 * recent + 0.4 * careerAvg, priorAvg, declining));

    if (priorAvg !== null) {
      const delta = now.pct - priorAvg;
      if (prior.length >= 2 && prior.every((e) => e.pct < now.pct)) {
        flags.push({ icon: 'emoji_events', tone: 'good', text: 'Best season of the career so far' });
      } else if (delta >= 0.2 && now.pct >= 0.6) {
        flags.push({ icon: 'rocket_launch', tone: 'good', text: `Breakout year: up from ${this.normWords(priorAvg)} before this` });
      } else if (delta <= -0.2) {
        flags.push({ icon: 'south', tone: 'bad', text: `Down year by their standards (${this.normWords(priorAvg)} before this)` });
      }
    }

    // A run of top-20% seasons ending with this one (back-to-back years only)
    if (now.pct >= 0.8) {
      let streak = 1;
      for (let y = card.season - 1; entries.some((e) => e.season === y && e.pct >= 0.8); y--) streak++;
      if (streak >= 2) flags.push({ icon: 'local_fire_department', tone: 'good', text: `${this.ordinal(streak)} straight top-20% season` });
    }

    // Skills across the career so far (two seasons or more): their calling card and a long-running issue
    if (entries.length >= 2) {
      const series = now.skills.map((skill) => {
        const values = entries.map((e) => e.skills.find((s) => s.id === skill.id)?.pct).filter((v): v is number => v !== undefined);
        return { name: skill.name, values, avg: avg(values) };
      });
      const card = series.filter((s) => s.values.length >= 2 && s.avg >= 0.7).sort((a, b) => b.avg - a.avg)[0];
      if (card) {
        const years = card.values.filter((v) => v >= 0.65).length;
        flags.push({ icon: 'verified', tone: 'good', text: `Calling card: ${card.name} (a strength in ${years} of ${card.values.length} ${this.seasonsWord(card.values.length, entries.length)})` });
      }
      const issue = series.filter((s) => s.values.length >= 2 && s.avg <= 0.3).sort((a, b) => a.avg - b.avg)[0];
      if (issue) {
        const years = issue.values.filter((v) => v <= 0.35).length;
        flags.push({ icon: 'report', tone: 'bad', text: `Long-running issue: ${issue.name} (a weakness in ${years} of ${issue.values.length} ${this.seasonsWord(issue.values.length, entries.length)})` });
      }
    }

    // (not when blocking set the archetype: last season's was worked out on receiving alone)
    if (last && last.archetype !== now.archetype && !card.overview.blockingArchetype) {
      flags.push({ icon: 'swap_horiz', tone: 'info', text: `New profile: a ${last.archetype} in ${last.season}` });
    }
    return flags;
  }

  // 'bottom 34%' / 'top 12%' / 'the middle of the pack'
  private normWords(pct: number): string {
    const s = standing(pct);
    return s === 'Middle of the pack' ? 'the middle of the pack' : s.toLowerCase();
  }

  // 'seasons', or 'tracked seasons' when the stats behind a skill weren't recorded every year
  private seasonsWord(counted: number, total: number): string {
    return counted < total ? 'tracked seasons' : 'seasons';
  }

  // Where they are in their career: the stage (by seasons played) and how good they've been so far
  // (the career average rank, with this season's weight in it)
  private careerStage(
    n: number,
    known: boolean,
    now: number,
    careerAvg: number,
    priorAvg: number | null,
    declining: boolean,
  ): CardFlag {
    const coach = this.position === 'HC';
    const team = ['K', 'P'].includes(this.position) ? 'specialist' : 'starter';
    const who = coach ? 'head coach' : team;
    const tone = (p: number): CardFlag['tone'] => (p >= 0.6 ? 'good' : p <= 0.35 ? 'bad' : 'info');
    const seasons = known ? `${this.ordinal(n)} season` : `${n} seasons since 2000`;
    const say = (text: string, p: number, icon = 'military_tech'): CardFlag => ({ icon, tone: tone(p), text: `${text} (${seasons})` });

    // First year: all about this season
    if (known && n === 1) {
      if (coach) return say(now >= 0.75 ? 'Instant-impact first-year coach' : now >= 0.45 ? 'Promising first-year coach' : 'First-year coach still finding their way', now, 'fiber_new');
      return say(now >= 0.75 ? 'Instant-impact rookie' : now >= 0.45 ? 'Promising rookie' : 'Rookie still finding their footing', now, 'fiber_new');
    }
    // Early career (years 2-3): what they're becoming
    if (known && n <= 3) {
      if (careerAvg >= 0.75) return say(coach ? 'Rising star coach' : 'Bright young star', careerAvg);
      if (priorAvg !== null && now - priorAvg >= 0.2) return say(coach ? 'Coach on the rise' : 'Ascending young player', now);
      if (careerAvg >= 0.45) return say(coach ? 'Promising young coach' : `Developing ${team}`, careerAvg);
      return say(coach ? 'Unproven so far' : 'Unproven so far', careerAvg);
    }
    // Late career (8+ seasons): a veteran, and whether it's holding up
    if (n >= 8) {
      if (declining) return say(`Veteran ${coach ? 'coach' : team} showing decline`, now);
      if (careerAvg >= 0.75) return say(coach ? 'Veteran elite coach' : 'Veteran star', careerAvg);
      if (careerAvg >= 0.5) return say(`Seasoned veteran ${who}`, careerAvg);
      return say(coach ? 'Long-tenured coach' : 'Veteran journeyman', careerAvg);
    }
    // Prime (years 4-7): established, or not
    if (careerAvg >= 0.75) return say(coach ? 'Established elite coach' : 'Established star', careerAvg);
    if (careerAvg >= 0.5) return say(`Established ${who}`, careerAvg);
    if (priorAvg !== null && now - priorAvg >= 0.25) return say('Late bloomer', now);
    return say(coach ? 'Middling coach so far' : 'Journeyman', careerAvg);
  }

  private ordinal(n: number): string {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
    return `${n}${suffix}`;
  }

  // Last season's skills: the radar's ghost, and the biggest rise and drop as flags
  private async loadPrevSkills(card: PlayerCard): Promise<void> {
    const prevSeason = card.season - 1;
    if (prevSeason < SEASONS[SEASONS.length - 1]) return;
    try {
      let unit: SkillPlayer | undefined;
      let list: SkillPlayer[];
      let context: SeasonContext | null = null;
      if (prevSeason === this.season) {
        list = this.playerList;
        unit = SKILL_UNITS[this.position].find((p) => p.gsisId === card.player.gsisId);
      } else {
        const rows = await this.tabRowsFor(prevSeason);
        unit = rows.find((p) => p.gsisId === card.player.gsisId);
        if (!unit) return;
        context = this.seasonContext(prevSeason, { [this.position]: rows } as Record<SkillPosition, SkillPlayer[]>);
        list = context.list;
      }
      if (!unit || this.card !== card) return;
      this.other = context;
      let prev: CardSkill[];
      try {
        prev = this.skillsFor(unit, list);
      } finally {
        this.other = null;
      }
      const byId = new Map(prev.map((s) => [s.id, s.pct]));
      const overview = card.overview;
      overview.prev = {
        season: prevSeason,
        pcts: byId,
        // (a skill last season didn't have, like run blocking, sits where it is now)
        shape: this.radarShape(overview.skills.map((s) => byId.get(s.id) ?? s.pct)),
      };
      // (players and coaches get these against their whole career instead, in the history)
      if (!['DEF', 'OL'].includes(this.position)) return;
      const moves = overview.skills
        .filter((s) => byId.has(s.id))
        .map((s) => ({ skill: s, delta: s.pct - byId.get(s.id)! }));
      const up = moves.reduce((best, m) => (m.delta > (best?.delta ?? 0.2) ? m : best), null as (typeof moves)[0] | null);
      const down = moves.reduce((worst, m) => (m.delta < (worst?.delta ?? -0.2) ? m : worst), null as (typeof moves)[0] | null);
      const pctText = (p: number) => `${Math.round(p * 100)}th`;
      if (up) {
        overview.flags.push({
          icon: 'trending_up',
          tone: 'good',
          text: `${up.skill.name} up from ${prevSeason} (${pctText(up.skill.pct - up.delta)} → ${pctText(up.skill.pct)} percentile)`,
        });
      }
      if (down) {
        overview.flags.push({
          icon: 'trending_down',
          tone: 'bad',
          text: `${down.skill.name} down from ${prevSeason} (${pctText(down.skill.pct - down.delta)} → ${pctText(down.skill.pct)} percentile)`,
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  // The radar's geometry in a 320 x 290 box centered on 0,0: an axis per skill clockwise from the
  // top, rings at 25 / 50 / 75 / 100%, and a skill's point out along its axis by its percentile
  // (from a small hub, so a 0 doesn't vanish into the center)
  private static readonly RADAR_R = 100;

  private radarPoint(i: number, n: number, pct: number): [number, number] {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = SkillRankingsComponent.RADAR_R * (0.1 + 0.9 * pct);
    return [Math.round(Math.cos(angle) * r * 10) / 10, Math.round(Math.sin(angle) * r * 10) / 10];
  }

  private radarShape(pcts: number[]): string {
    return pcts.map((p, i) => this.radarPoint(i, pcts.length, p).join(',')).join(' ');
  }

  private radar(skills: CardSkill[]): CardRadar {
    const n = skills.length;
    const axes = skills.map((skill, i) => {
      const [x, y] = this.radarPoint(i, n, 1);
      const [lx, ly] = this.radarPoint(i, n, 1.24);
      const anchor = Math.abs(lx) < 8 ? 'middle' : lx > 0 ? 'start' : 'end';
      return { x, y, lx, ly: ly + 4, anchor, label: skill.short, pct: skill.pct };
    });
    return {
      axes,
      rings: [0.25, 0.5, 0.75, 1].map((p) => this.radarShape(skills.map(() => p))),
      shape: this.radarShape(skills.map((s) => s.pct)),
      dots: skills.map((s, i) => {
        const [x, y] = this.radarPoint(i, n, s.pct);
        return { x, y, pct: s.pct };
      }),
    };
  }

  private rowsFor(season: number): Promise<Record<SkillPosition, SkillPlayer[]>> {
    let rows = this.seasonRows.get(season);
    if (!rows) {
      rows = fetchSeason(season).then(unitsForSeason);
      rows.catch(() => this.seasonRows.delete(season));
      this.seasonRows.set(season, rows);
    }
    return rows;
  }

  // Another season's list: the same filters as the table, ranked with the current sliders
  private seasonContext(season: number, rows: Record<SkillPosition, SkillPlayer[]>): SeasonContext {
    const units = rows[this.position];
    const teamTab = this.position === 'DEF' || this.position === 'OL' || this.position === 'HC';
    const seasonGames = Math.max(0, ...units.map((p) => p.games));
    const min = teamTab ? 0 : Math.min(this.positionService.settings.minGames, seasonGames);
    const context: SeasonContext = {
      season,
      rows,
      list: [],
      hcRanks: this.position === 'HC' ? unitRanks(rows.HC, this.rankBasis, this.garbageTime) : null,
      empty: (key) =>
        units.some((p) => key in p.stats) && units.every((p) => p.stats[key as SkillStatKey] == null),
    };
    const listed = units.filter((p) => (this.showInjured || !p.injured) && p.games >= min);
    // That season's list as dragged by hand this visit, if it was; otherwise ranked by the sliders
    const saved = this.positionService.seasonUnitOrder(season, this.position);
    if (saved?.manual) {
      const at = new Map(saved.ids.map((id, i) => [id, i]));
      context.list = [...listed].sort((a, b) => (at.get(a.gsisId) ?? Infinity) - (at.get(b.gsisId) ?? Infinity));
      context.manual = true;
    } else {
      context.list = this.rankedIn(context, listed);
    }
    return context;
  }

  // One tab's rows for a finished season (a small file per tab), for the Seasons tab
  private tabRows = new Map<string, Promise<SkillPlayer[]>>();

  private tabRowsFor(season: number): Promise<SkillPlayer[]> {
    const key = `${season}.${this.position}`;
    let rows = this.tabRows.get(key);
    if (!rows) {
      rows = fetchSeasonFile<SkillPlayer[]>(season, `units/${this.position}.json`);
      rows.catch(() => this.tabRows.delete(key));
      this.tabRows.set(key, rows);
    }
    return rows;
  }

  // The Seasons tab: re-rank every season with the current sliders (a season dragged by hand this
  // visit keeps its dragged order; the table's own season is the table's list). Each line swaps its
  // default rank for this one as its season loads.
  private rankCareer(card: PlayerCard): void {
    if (card.careerRanked || !card.seasons) return;
    card.careerRanked = true;
    const id = card.player.gsisId;
    for (const line of card.seasons) {
      (async () => {
        let list: SkillPlayer[];
        if (line.season === this.season) {
          list = this.playerList;
        } else {
          const units =
            line.season === CURRENT_SEASON
              ? (await this.rowsFor(CURRENT_SEASON))[this.position]
              : await this.tabRowsFor(line.season);
          list = this.seasonContext(line.season, { [this.position]: units } as Record<SkillPosition, SkillPlayer[]>).list;
        }
        const at = list.findIndex((p) => p.gsisId === id);
        // (under the Min Games setting that year, or hidden as injured: the default rank stays)
        if (at < 0 || this.card !== card) return;
        line.rank = at + 1;
        line.of = list.length;
        line.pct = list.length > 1 ? (list.length - 1 - at) / (list.length - 1) : 1;
        line.yours = true;
        // Each headline stat by where it stood in that year's list (per game, like the table): the bar's
        // length, and with Color-Coded Values on, its color on the card's red-orange-green scale
        headlineStats(this.position).forEach((stat, i) => {
          const readout = line.stats[i];
          const mine = this.rateValue(list[at], stat);
          if (!readout || mine === null) return;
          const values = list.map((p) => this.rateValue(p, stat)).filter((v): v is number => v !== null);
          if (values.length < 2) return;
          const above = values.filter((v) => (stat.negative ? v < mine : v > mine)).length;
          const pct = 1 - above / (values.length - 1);
          readout.share = pct;
          if (this.colorValues) readout.tint = this.rankTone(pct);
        });
      })().catch((err) => console.error(err));
    }
  }

  selectCardTab(tab: CardTab): void {
    this.cardTab = tab;
    if (tab === 'seasons' && this.card) this.rankCareer(this.card);
  }

  private rankedIn(context: SeasonContext, players: SkillPlayer[]): SkillPlayer[] {
    this.other = context;
    try {
      const counted = this.stats.filter((stat) => !this.hidden[statGroup(stat)] && !this.statHidden(stat.key));
      const totals = weightedTotals(players, counted, this.effectiveWeights(), (player, stat) => this.value(player, stat));
      return [...players].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    } finally {
      this.other = null;
    }
  }

  private renderCard(player: SkillPlayer, season: number, list: SkillPlayer[], context: SeasonContext | null): PlayerCard {
    this.other = context;
    try {
      const groups = this.visibleGroups
        .map((group) => ({
          id: group.id,
          title: group.title,
          icon: group.icon,
          // (another season's card leaves out the grades from other tabs, which are the table's season's)
          stats: group.stats
            .filter((stat) => !context || !stat.support || stat.key === 'responsibility')
            .map((stat) => this.cardStat(player, stat, list, group.id)),
        }))
        .filter((group) => group.stats.length);
      const photo = this.headshot(player);
      const teams = (context ? context.rows : SKILL_UNITS).DEF ?? [];
      const team = teams.find((unit) => unit.teamLogo === player.teamLogo)?.name ?? null;
      return {
        player,
        season,
        list,
        context,
        name: player.name,
        positionName: POSITION_NAMES[this.position],
        seasonLabel: season === CURRENT_SEASON ? 'This Season' : `${season}`,
        teamName: this.position === 'DEF' || team === player.name ? null : team,
        logo: player.teamLogo,
        color: this.teamBadge(player),
        whiteLogo: this.teamLogoWhite(player),
        // The same headshot, big enough for the card's hero
        photo: photo && photo.replace('&w=160&h=116', '&w=440&h=320'),
        rank: list.indexOf(player) + 1,
        of: list.length,
        awards: awardsFor(player, this.position, season),
        groups,
        overview: this.buildOverview(player, season, list, context),
        seasons: null,
        comps: null,
      };
    } finally {
      this.other = null;
    }
  }

  // The card's season links (every season they're in) and similar seasons (finished seasons only)
  private async loadCardLinks(card: PlayerCard): Promise<void> {
    const id = card.player.gsisId;
    try {
      // (checked with the server each visit: it changes once a year, at the season rollover)
      this.careers ??= fetch('data/careers.json', { cache: 'no-cache' }).then((res) => res.json());
      const current = this.season === CURRENT_SEASON ? SKILL_UNITS : await this.rowsFor(CURRENT_SEASON);
      const headline = headlineStats(this.position);
      const line = (season: number, logo: string, games: number, rank: number, of: number, stats: (number | null)[]) => ({
        season,
        logo,
        games,
        rank,
        of,
        pct: of > 1 ? (of - rank) / (of - 1) : 1,
        stats: headline.map((stat, i) => ({
          text: this.headlineText(stat, stats[i] ?? null),
          label: stat.label,
          value: stats[i] ?? null,
          share: 0,
          best: false,
        })),
      });
      const past = ((await this.careers)[this.position]?.[id] ?? []).map(([season, logo, games, rank, of, stats]) =>
        line(season, `assets/NFL_Icons/${logo}.png`, games, rank, of, stats),
      );
      // This season, ranked the same way (the default sliders) from the rows on hand
      const rows = current[this.position] ?? [];
      const now = rows.find((p) => p.gsisId === id);
      let seasons = past;
      if (now) {
        const ranked = defaultRanking(this.position, presetWeights(this.position, 'default'), true, 'points', rows);
        const stats = headline.map((stat) => unitStat(now, stat.key as SkillStatKey, true));
        seasons = [...past, line(CURRENT_SEASON, now.teamLogo, now.games, ranked.indexOf(now) + 1, ranked.length, stats)];
      }
      // Each headline stat's best finished season lit (lowest for a stat that counts against them; a few games into this
      // season, a hot start would take it)
      const finished = seasons.filter((s) => s.season !== CURRENT_SEASON);
      headline.forEach((stat, i) => {
        const values = seasons.map((s) => s.stats[i].value).filter((v): v is number => v !== null);
        const done = finished.map((s) => s.stats[i].value).filter((v): v is number => v !== null);
        if (!values.length) return;
        const best = stat.negative ? Math.min(...done) : Math.max(...done);
        for (const s of seasons) {
          const v = s.stats[i].value;
          if (v === null) continue;
          s.stats[i].best = done.length > 1 && s.season !== CURRENT_SEASON && v === best;
        }
      });
      if (this.card !== card) return;
      card.seasons = seasons;
      if (this.cardTab === 'seasons' && card.seasons.length < 2) this.cardTab = 'overview';
      // (the Overview's career history reads those seasons too)
      if (this.cardTab === 'seasons') this.rankCareer(card);
      this.loadHistory(card);
      this.loadBlocking(card);
    } catch (err) {
      console.error(err);
    }
    if (card.season === CURRENT_SEASON) return;
    try {
      let comps = this.seasonComps.get(card.season);
      if (!comps) {
        comps = fetchSeasonFile<CompsFile>(card.season, 'comps.json');
        this.seasonComps.set(card.season, comps);
      }
      const matches = (await comps)[this.position]?.[id] ?? [];
      if (this.card !== card) return;
      card.comps = matches.map(([season, gsisId, name, espnId, logo, match]) => {
        const teamLogo = `assets/NFL_Icons/${logo}.png`;
        const photo = this.headshot({ id: espnId });
        return {
          season,
          gsisId,
          name,
          match,
          logo: teamLogo,
          color: badgeColor(teamLogo),
          whiteLogo: whiteLogo(teamLogo),
          photo: photo && photo.replace('&w=160&h=116', '&w=240&h=174'),
        };
      });
    } catch (err) {
      console.error(err);
      if (this.card === card) card.comps = [];
    }
  }

  private cardStat(player: SkillPlayer, stat: SkillStat, list: SkillPlayer[], group: string): CardStat {
    // Lower is better for ranks and stats that count against a player (support grades read higher is
    // better here: a better O-line is a better O-line)
    const lowerBetter = stat.format === 'rank' || (!!stat.negative && !stat.support);
    const values = list.map((p) => this.value(p, stat)).filter((v): v is number => v !== null);
    const value = this.value(player, stat);
    // (display-only stats like Games aren't ranked)
    const rank =
      value === null || stat.infoOnly ? null : 1 + values.filter((v) => (lowerBetter ? v < value : v > value)).length;
    const of = values.length;
    return {
      key: stat.key,
      group,
      label: this.statLabel(stat),
      name: this.statName(stat),
      display: this.format(player, stat),
      dots: stat.format === 'recent' ? [...(player.lastFive ?? [])].reverse() : undefined,
      rank,
      tied: value !== null && values.filter((v) => v === value).length > 1,
      of,
      pct: rank === null ? null : of > 1 ? (of - rank) / (of - 1) : 1,
      avg: this.averageText(stat),
      trait: !stat.infoOnly && (!stat.support || !!stat.supportHelps),
      // (against that season's list: the value helpers read it while the card is built)
      tint: this.valueColor(player, stat),
    };
  }

  // A headline stat on the Seasons tab: season totals, formatted like the table ("4,183")
  private headlineText(stat: SkillStat, value: number | null): string {
    if (value === null) return '-';
    let shown: string;
    switch (stat.format) {
      case 'pct':
        shown = `${Math.round(value * 100)}%`;
        break;
      case 'pctPoints':
        shown = `${value.toFixed(1)}%`;
        break;
      case 'dec1':
        shown = value.toFixed(1);
        break;
      case 'dec2':
        shown = value.toFixed(2);
        break;
      default:
        shown = Math.round(value).toLocaleString('en-US');
    }
    return shown;
  }

  // Stats tab groups folded shut (header click, like the filter menu); kept across cards
  cardClosed = new Set<string>();

  toggleCardGroup(id: string): void {
    if (this.cardClosed.has(id)) this.cardClosed.delete(id);
    else this.cardClosed.add(id);
  }

  // Red (last) through orange (the middle) to green (first)
  rankTone(pct: number | null): string {
    if (pct === null) return '#777';
    pct = Math.max(0, Math.min(1, pct));
    const hue = pct < 0.5 ? pct * 2 * 30 : 30 + (pct - 0.5) * 2 * 95;
    return `hsl(${Math.round(hue)}, 85%, ${Math.round(56 - pct * 6)}%)`;
  }

  // The player above or below in the list (arrow keys too)
  stepCard(step: number): void {
    if (!this.card) return;
    const { list, season, context } = this.card;
    const next = list[(list.indexOf(this.card.player) + step + list.length) % list.length];
    if (next) this.showCard(this.renderCard(next, season, list, context));
  }

  closeCard(): void {
    this.card = null;
  }

  @HostListener('document:keydown', ['$event'])
  cardKeys(event: KeyboardEvent): void {
    if (!this.card) return;
    if (event.key === 'Escape') this.closeCard();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') this.stepCard(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') this.stepCard(-1);
    else return;
    event.preventDefault();
  }

  // Show toast for 2 seconds
  showToast() {
    this.isToastVisible = true;
    setTimeout(() => {
      this.isToastVisible = false;
    }, 2000);
  }
}
