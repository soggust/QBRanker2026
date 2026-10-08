// The player card (click a name): builds it and keeps it while it's open. Its stats are the columns
// showing in the grid, as ranks in the list it's ranked in (the table's, or another season's ranked the
// same way); then the Overview (skills, archetype, flags, radar, scouting report), the seasons they're
// in and similar seasons load in behind it.
import { PER_GAME_LABELS, SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, SkillStatGroup, headlineStats, presetWeights } from '@sport/positions';
import { awardsFor } from '@sport/awards';
import { SPORT } from '@sport/sport';
import { extras, logoFile, rowTeamNames } from '@ranker/engine/row-fields';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SKILLS } from '@sport/skills';
import { CardFlag, FlagContext, ValueContext } from '@ranker/engine/sport';
import { CardSkill, standing, tierWord } from '@ranker/engine/skills';
import { CURRENT_SEASON, SEASONS, isLiveSeason } from '@ranker/engine/data';
import { DEFAULT_SPORT_SETTINGS, SKILL_UNITS, defaultRanking, statValue } from '@ranker/engine/unit-scoring';
import { StatReader } from '@ranker/engine/stat-reader';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { NUMBER, grade, innings, ordinal, rankPct, rankTone } from '@ranker/core/format';
import type { DepthPlayer, DepthView } from './depth-chart';
import type { ZoneView } from './zones';
import { CardOverview, CardSeason, CardStat, CardTab, CareerSeason, PlayerCard, SeasonContext } from './card.model';
import { archetypeFor, overviewBlurb, profileFlags, scoutingReport, skillScores } from './overview';
import { careerHistory } from './career-history';
import { radar, radarShape } from './radar';
import { GameLogView, gameLogView } from './game-log-view';
import { PlayerAnalysis, analysisIndex, loadAnalysis } from './analysis';
import { espnTeamNames, espnUpcoming } from '@ranker/core/game-logs';
import { heroColor } from '../game-view/game';

// What the card needs from the table it opens from
export interface CardHost {
  readonly position: SkillPosition;
  // The table's season, list and stats, and the Color-Coded Values setting
  readonly season: number;
  readonly playerList: SkillPlayer[];
  readonly stats: SkillStat[];
  readonly colorValues: boolean;
  // A reader for another season (the table's for null)
  readerFor(context: SeasonContext | null): StatReader;
  // Another season's list: the same filters as the table, ranked with the current sliders (another
  // tab's, for a card opened on it)
  seasonContext(season: number, rows: Record<SkillPosition, SkillPlayer[]>, position?: SkillPosition): SeasonContext;
  rankedIn(context: SeasonContext, players: SkillPlayer[]): SkillPlayer[];
  // The stat groups with columns showing, for that reader's season
  shownGroups(reader: StatReader, position?: SkillPosition): SkillStatGroup[];
  headshot(unit: { id?: number | null }, w?: number): string | null;
  // (one failed to load: the next headshot() is the next place to look)
  noHeadshot(unit: { id?: number | null }): void;
}

const TABS: { id: CardTab; title: string }[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'stats', title: 'Stats' },
  { id: 'seasons', title: 'Career' },
];

const POSITION_NAMES = SPORT.positionNames as Record<SkillPosition, string>;

export class PlayerCards {
  card: PlayerCard | null = null;
  // Another season's card being built
  loading = false;
  // The card's tab (kept while flipping through players and seasons)
  tab: CardTab = 'overview';
  // Stats tab groups folded shut (kept across cards)
  closedGroups = new Set<string>();

  constructor(
    private readonly host: CardHost,
    private readonly data: SeasonDataService,
  ) {}

  // The card's tab: the table's, or another one's (a roster's player, or the hero's team, opened on its
  // own tab with the grid left where it is)
  private cardPosition: SkillPosition | null = null;
  private get position(): SkillPosition {
    return this.cardPosition ?? this.host.position;
  }
  // (the card is on the table's tab: the table's own list and reader are its)
  private get onTable(): boolean {
    return this.position === this.host.position;
  }
  // (its tab's stats)
  private get stats(): SkillStat[] {
    return this.onTable ? this.host.stats : SKILL_STATS[this.position];
  }

  // Seasons only when they're in more than one (shown while loading; never for a career-only sport),
  // and the sport's history tab when it has one (SPORT.cardHistory: MMA's fights)
  // Overview, Analysis (when written up), Season, Game Log (the season being played), Career ("History"
  // for a team, a defense or a line)
  tabsFor(card: PlayerCard): { id: CardTab; title: string }[] {
    const [overview, stats, seasons] = TABS;
    const tabs: { id: CardTab; title: string }[] = [overview];
    if (this.analysisFile(card)) tabs.push({ id: 'analysis', title: 'Analysis' });
    // (a team's Team tab: its depth chart, staff and roster, before its Stats)
    if (SPORT.depthChart?.has(card.player, this.position, card.season)) tabs.push({ id: 'depth', title: 'Team' });
    tabs.push(stats);
    // (MLB's season by zone: a pitcher's, a hitter's)
    if (SPORT.zones?.has(card.player, this.position, card.season)) tabs.push({ id: 'zones', title: SPORT.zones.title(this.position) });
    if (this.hasGameLog(card)) tabs.push({ id: 'games', title: 'Game Log' });
    if (!SPORT.careerOnly && (!card.seasons || card.seasons.length > 1)) tabs.push({ ...seasons, title: this.careerTitle });
    return SPORT.cardHistory ? [...tabs, { id: 'history', title: SPORT.cardHistory.title }] : tabs;
  }

  // The Analysis tab: the season being played's write-up, for a row the sport has one for (the index
  // loads with the first card; the tab shows once it's in)
  private analyses: Record<string, string> | null = null;
  private analysisLoads = new Map<string, PlayerAnalysis | 'loading' | 'error'>();
  analysisFile(card: PlayerCard): string | null {
    if (!SPORT.analysis || card.season !== CURRENT_SEASON) return null;
    if (!this.analyses) {
      analysisIndex().then((index) => (this.analyses = index));
      return null;
    }
    return this.analyses[card.player.gsisId] ?? null;
  }
  analysis(card: PlayerCard): PlayerAnalysis | 'loading' | 'error' {
    const file = this.analysisFile(card);
    if (!file) return 'error';
    if (!this.analysisLoads.has(file)) {
      this.analysisLoads.set(file, 'loading');
      loadAnalysis(file)
        .then((a) => this.analysisLoads.set(file, a))
        .catch(() => this.analysisLoads.set(file, 'error'));
    }
    return this.analysisLoads.get(file)!;
  }

  // The Zones tab: the season by zone (loaded the first time the tab asks, then kept), and the stat showing
  private zoneLoads = new Map<string, ZoneView | 'loading' | 'error'>();
  zoneStat: string | null = null;
  zones(card: PlayerCard): ZoneView | 'loading' | 'error' {
    const key = `${this.position}/${card.player.gsisId}/${card.season}`;
    if (!this.zoneLoads.has(key) && SPORT.zones) {
      this.zoneLoads.set(key, 'loading');
      SPORT.zones
        .load(card.player, this.position, card.season)
        .then((view) => this.zoneLoads.set(key, view))
        .catch(() => this.zoneLoads.set(key, 'error'));
    }
    return this.zoneLoads.get(key) ?? 'error';
  }

  // The Analysis tab's sections open (all folded each time the tab opens, or another card does)
  aiOpen = new Set<string>();
  toggleAi(section: string): void {
    if (!this.aiOpen.delete(section)) this.aiOpen.add(section);
  }

  // The Career tab's name: a team row's is its History
  get careerTitle(): string {
    const position: string = this.position;
    return position === 'TM' || SPORT.teamTabs?.includes(position) ? 'History' : 'Career';
  }

  // The Game Log tab: the card's season's games, for a row the sport has one for (SPORT.gameLog)
  hasGameLog(card: PlayerCard): boolean {
    return !!SPORT.gameLog?.has(card.player, this.position, card.season);
  }

  // A card's game log for its season, loaded the first time its tab asks (then kept, as the tab shows it),
  // with the team's games still to play when it's the season being played and the sport names its league
  // (those failing just leave them out): the log, or still loading, or failed
  private gameLogs = new Map<string, GameLogView | 'loading' | 'error'>();
  gameLog(card: PlayerCard): GameLogView | 'loading' | 'error' {
    const key = `${this.position}/${card.player.gsisId}/${card.season}`;
    if (!this.gameLogs.has(key) && SPORT.gameLog) {
      this.gameLogs.set(key, 'loading');
      const { load, league } = SPORT.gameLog;
      const player = card.player;
      const next = league && card.season === CURRENT_SEASON
        ? espnUpcoming(league, rowTeamNames(player), SPORT.currentSeason).catch(() => [])
        : Promise.resolve([]);
      Promise.all([load(player, this.position, card.season), next])
        .then(([log, upcoming]) => this.gameLogs.set(key, gameLogView(log, upcoming)))
        .catch(() => this.gameLogs.set(key, 'error'));
    }
    return this.gameLogs.get(key) ?? 'error';
  }

  // A team card's depth chart for its season, loaded the first time its tab asks (then kept): the chart,
  // or still loading, or failed. depthOpen: the slot whose backups are showing (one at a time)
  private depthCharts = new Map<string, DepthView | 'loading' | 'error'>();
  depthOpen: string | null = null;
  depthChart(card: PlayerCard): DepthView | 'loading' | 'error' {
    const key = `${this.position}/${card.player.gsisId}/${card.season}`;
    if (!this.depthCharts.has(key) && SPORT.depthChart) {
      this.depthCharts.set(key, 'loading');
      // (the sport builds it from that season's rows: every tab's, the table's own for its season)
      const rows = card.season === this.host.season ? Promise.resolve(SKILL_UNITS) : this.data.rows(card.season);
      rows
        .then((rows) => SPORT.depthChart!.load(card.player, this.position, card.season, { rows, headshot: (p) => this.host.headshot(p, 96) }))
        .then(async (view) => {
          await this.linkRoster(view, card.season);
          this.depthCharts.set(key, view);
        })
        .catch(() => this.depthCharts.set(key, 'error'));
    }
    return this.depthCharts.get(key) ?? 'error';
  }

  // A roster's players the site has: each one's card (his tab and row id), found among that season's rows
  // by his id (the QBs' rows by ESPN's: "QB-<id>")
  private async linkRoster(view: DepthView, season: number): Promise<void> {
    const rows = season === this.host.season ? SKILL_UNITS : await this.data.rows(season).catch(() => null);
    if (!rows) return;
    const index = new Map<string, { position: string; gsisId: string }>();
    for (const [position, list] of Object.entries(rows)) {
      for (const p of (list ?? []) as SkillPlayer[]) if (p.gsisId) index.set(p.gsisId, { position, gsisId: p.gsisId });
    }
    const link = (p: DepthPlayer | null | undefined) => {
      if (p) p.link = index.get(p.id) ?? (p.espnId ? index.get(`QB-${p.espnId}`) : undefined) ?? null;
    };
    for (const side of view.sides) for (const slot of side.slots) slot.depth.forEach(link);
    view.special.forEach((s) => link(s.player));
    for (const g of view.usage) g.rows.forEach(link);
    for (const w of view.timeline) for (const ch of w.changes) [ch.from, ch.to].forEach(link);
    // (a head coach by his name, on the coaches' tab)
    const coachTab = Object.keys(rows).find((p) => SPORT.positionNames[p as SkillPosition] === 'Head Coach') as SkillPosition | undefined;
    const coachRows = coachTab ? ((rows[coachTab] ?? []) as SkillPlayer[]) : [];
    for (const g of view.coaches) {
      for (const co of g.rows) {
        const row = coachRows.find((r) => r.name === co.name);
        co.link = row && coachTab ? { position: coachTab, gsisId: row.gsisId } : null;
      }
    }
  }

  // A roster's player (or the hero's team) opened: their card for that season, on their own tab, ranked
  // with that tab's sliders and filters; the grid stays where it is
  async openLinked(link: { position: string; gsisId: string }, season: number): Promise<void> {
    const back = this.cardPosition;
    this.cardPosition = link.position === this.host.position ? null : (link.position as SkillPosition);
    if (!(await this.openSeason(season, link.gsisId))) this.cardPosition = back;
  }

  // The hero's team name: that season's team row (the sport's team tab), for anyone but a team
  private teamLink(player: SkillPlayer, rows: Record<SkillPosition, SkillPlayer[]>): { position: string; gsisId: string } | null {
    const position = SPORT.teamTabs?.[0] as SkillPosition | undefined;
    if (!position || this.position === position || !player.teamLogo) return null;
    const team = rows[position]?.find((t) => t.teamLogo === player.teamLogo);
    return team ? { position, gsisId: team.gsisId } : null;
  }

  // A game log's opponent ("@ IND"): its team's card for the card's season (the sport's team tab), found
  // by ESPN's name for the abbreviation, or the row's logo file ("LAK_2002..." for the NHL's own)
  async openOpponent(card: PlayerCard, vs: string): Promise<void> {
    await this.openTeam(vs.split(' ').slice(1).join(' '), card.season);
  }

  // A team by its abbreviation ("IND"): its card for a season (the game view's teams too)
  async openTeam(abbreviation: string, season: number): Promise<void> {
    const position = SPORT.teamTabs?.[0];
    if (!position) return;
    const abbr = abbreviation.toLowerCase();
    const rows = season === this.host.season ? SKILL_UNITS : await this.data.rows(season).catch(() => null);
    const teams = (rows?.[position as SkillPosition] ?? []) as SkillPlayer[];
    const names = espnTeamNames(SPORT.gameLog?.league ?? '', abbr).map((n) => n.toLowerCase());
    const file = (p: SkillPlayer) => logoFile(p.teamLogo)?.toLowerCase() ?? '';
    const team =
      teams.find((t) => names.includes(t.name.toLowerCase()) || names.includes((extras(t).teamName ?? '').toLowerCase())) ??
      teams.find((t) => file(t).split('_')[0] === abbr || names.includes(file(t)));
    if (team) await this.openLinked({ position, gsisId: team.gsisId }, season);
  }

  toggleDepthSlot(key: string): void {
    this.depthOpen = this.depthOpen === key ? null : key;
  }

  // A name in the table: their card for the table's season, ranked as the table has them (always on
  // the Overview; flipping through players and seasons keeps the tab you're on)
  open(player: SkillPlayer): void {
    this.cardPosition = null;
    this.tab = 'overview';
    this.show(this.render(player, this.host.season, this.host.playerList, null));
  }

  // A season link or a similar season: that season's card, without changing the table (the table's own
  // season shows as the table has it)
  async openSeason(season: number, gsisId: string): Promise<boolean> {
    const { host } = this;
    const listed = season === host.season && this.onTable ? host.playerList.find((p) => p.gsisId === gsisId) : undefined;
    if (listed) {
      this.show(this.render(listed, host.season, host.playerList, null));
      return true;
    }
    this.loading = true;
    try {
      const rows = season === host.season ? SKILL_UNITS : await this.data.rows(season);
      const player = rows[this.position]?.find((p) => p.gsisId === gsisId);
      if (!player) return false;
      const context = host.seasonContext(season, rows, this.position);
      // (someone under the Min Games setting still gets their card, ranked where they'd fall)
      if (!context.list.includes(player)) {
        context.list = context.manual ? [...context.list, player] : host.rankedIn(context, [...context.list, player]);
      }
      this.show(this.render(player, season, context.list, context));
      return true;
    } catch (err) {
      console.error(err);
      return false;
    } finally {
      this.loading = false;
    }
  }

  // The player above or below in the list (arrow keys too)
  step(step: number): void {
    if (!this.card) return;
    const { list, season, context, player } = this.card;
    const next = list[(list.indexOf(player) + step + list.length) % list.length];
    if (next) this.show(this.render(next, season, list, context));
  }

  close(): void {
    this.card = null;
    this.cardPosition = null;
  }

  selectTab(tab: CardTab): void {
    this.tab = tab;
    // (each tab's panels back to their defaults when it's opened: the Season groups open, the Analysis
    // sections shut)
    if (tab === 'stats') this.closedGroups.clear();
    if (tab === 'analysis') this.aiOpen.clear();
    if (tab === 'seasons' && this.card) this.rankCareer(this.card);
  }

  // A headshot that failed to load: the next place to look, or none
  nextPhoto(unit: { id?: number | null }, w: number): string | null {
    this.host.noHeadshot(unit);
    return this.host.headshot(unit, w);
  }

  toggleGroup(id: string): void {
    if (this.closedGroups.has(id)) this.closedGroups.delete(id);
    else this.closedGroups.add(id);
  }

  private show(card: PlayerCard): void {
    this.card = card;
    this.aiOpen.clear();
    // (a tab this card doesn't have falls back to the Overview)
    if (!this.tabsFor(card).some((tab) => tab.id === this.tab)) this.tab = 'overview';
    this.loadSeasons(card);
    this.loadPrevSkills(card);
    // (the hero in the team's own color, as the game view draws it, once ESPN's list is in)
    const league = SPORT.gameLog?.league;
    if (league && card.heroColor === undefined) {
      heroColor(league, rowTeamNames(card.player))
        .then((color) => (card.heroColor = color))
        .catch(() => (card.heroColor = null));
    }
  }

  // ---------------------------------------------------------------------------
  // The card itself: the hero and the Stats tab's tiles, then the Overview
  // ---------------------------------------------------------------------------
  private render(player: SkillPlayer, season: number, list: SkillPlayer[], context: SeasonContext | null): PlayerCard {
    const reader = this.host.readerFor(context);
    const groups = this.host
      .shownGroups(reader, this.position)
      .map((group) => ({
        id: group.id,
        title: group.title,
        icon: group.icon,
        // (another season's card leaves out the values from other tabs, which are the table's season's, and
        // a display-only stat that season doesn't have: Time of Possession before it was kept)
        stats: group.stats
          .filter((stat) => !context || !SPORT.tableSeasonOnly?.(stat))
          .filter((stat) => !stat.infoOnly || Number.isFinite(reader.value(player, stat)))
          .map((stat) => this.cardStat(reader, player, stat, list, group.id)),
      }))
      .filter((group) => group.stats.length);
    const rows = context ? context.rows : SKILL_UNITS;
    return {
      player,
      season,
      list,
      context,
      name: player.name,
      positionName: POSITION_NAMES[this.position],
      positionLabel: SPORT.teamTabs?.includes(this.position) || this.position === SPORT.coachTab ? POSITION_NAMES[this.position] : this.position,
      seasonLabel: SPORT.careerOnly ? 'Career' : isLiveSeason(season) ? 'This Season' : SPORT.seasonText(season),
      teamName: SPORT.teamName ? SPORT.teamName(player, this.position, rows) : (extras(player).teamName ?? null),
      teamLink: this.teamLink(player, rows),
      logo: SPORT.cardLogo ? SPORT.cardLogo(logoForSeason(player.teamLogo, season)) : logoForSeason(player.teamLogo, season),
      color: badgeColor(player.teamLogo),
      whiteLogo: whiteLogo(player.teamLogo),
      // The table's headshot, big enough for the card's hero
      photo: this.host.headshot(player, 440),
      rank: list.indexOf(player) + 1,
      of: list.length,
      awards: awardsFor(player, this.position, season),
      groups,
      overview: this.overview(reader, player, season, list, context),
      seasons: null,
      comps: null,
    };
  }

  private cardStat(reader: StatReader, player: SkillPlayer, stat: SkillStat, list: SkillPlayer[], group: string): CardStat {
    // Lower is better for ranks and stats that count against a player (support grades read higher is
    // better: a better lineup is a better lineup)
    const lowerBetter = stat.format === 'rank' || (!!stat.negative && !stat.support);
    const values = list.map((p) => reader.value(p, stat)).filter((v): v is number => v !== null);
    const value = reader.value(player, stat);
    // (display-only stats like Games aren't ranked)
    const rank = value === null || stat.infoOnly ? null : 1 + values.filter((v) => (lowerBetter ? v < value : v > value)).length;
    const of = values.length;
    return {
      key: stat.key,
      group,
      label: reader.label(stat),
      name: reader.name(stat),
      display: reader.format(player, stat),
      rank,
      tied: value !== null && values.filter((v) => v === value).length > 1,
      dots: stat.format === 'recent' ? [...reader.lastFive(player)].reverse() : undefined,
      of,
      pct: rank === null ? null : rankPct(rank, of),
      avg: reader.averageText(stat),
      trait: !stat.infoOnly && (!stat.support || !!stat.supportHelps),
      tint: reader.valueColor(player, stat),
    };
  }

  // ---------------------------------------------------------------------------
  // Overview: skills, archetype, the one-line take and the context flags
  // ---------------------------------------------------------------------------
  private overview(reader: StatReader, player: SkillPlayer, season: number, list: SkillPlayer[], context: SeasonContext | null): CardOverview {
    const skills = this.skillsFor(reader, player, list);
    const at = list.indexOf(player);
    const overall = at < 0 || list.length < 2 ? 0.5 : (list.length - 1 - at) / (list.length - 1);
    const { strengths, weaknesses, report } = scoutingReport(skills);
    return {
      archetype: archetypeFor(this.position, skills, overall, player),
      blurb: overviewBlurb(strengths, [...weaknesses].reverse()),
      skills,
      report,
      flags: this.flags(reader, player, season, overall, skillScores(this.position, skills), !context),
      radar: radar(skills),
      prev: null,
    };
  }

  // Each skill as a percentile in the list: the average of its stats' percentiles (volume stats per
  // game), each stat turned the skill's way. Stats a season didn't record are skipped, and a skill with
  // none of its stats is left out.
  private skillsFor(reader: StatReader, player: SkillPlayer, list: SkillPlayer[]): CardSkill[] {
    const out: CardSkill[] = [];
    for (const def of SKILLS[this.position]) {
      const pcts: number[] = [];
      const evidence: CardSkill['evidence'] = [];
      for (const [key, dir] of def.parts) {
        const stat = this.stats.find((s) => s.key === key);
        if (!stat || reader.empty(key)) continue;
        const mine = reader.rate(player, stat);
        if (mine === null) continue;
        const values = list.map((p) => reader.rate(p, stat)).filter((v): v is number => v !== null);
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

  // Context the stats alone don't say: the sport's own takes (a small sample, luck: results against
  // what the contact or the peripherals say should have happened), then the profile's shape and results
  // against play, then the sport's last ones
  private flags(
    reader: StatReader,
    player: SkillPlayer,
    season: number,
    overall: number,
    scores: Record<string, number>,
    tableSeason: boolean,
  ): CardFlag[] {
    const context: FlagContext = {
      player,
      season,
      position: this.position,
      current: isLiveSeason(season),
      ordinal,
      innings,
      overall,
      tableSeason,
      stats: this.stats,
      value: (stat) => reader.raw(player, stat),
      grade,
    };
    return [...SPORT.cardFlags(context), ...profileFlags(this.position, scores), ...(SPORT.cardFlagsLast?.(context) ?? [])];
  }

  // ---------------------------------------------------------------------------
  // Last season's skills: for team tabs, the biggest rise and drop as flags
  // ---------------------------------------------------------------------------
  private async loadPrevSkills(card: PlayerCard): Promise<void> {
    const prevSeason = card.season - 1;
    if (prevSeason < SEASONS[SEASONS.length - 1]) return;
    const { host } = this;
    try {
      let unit: SkillPlayer | undefined;
      let list: SkillPlayer[];
      let context: SeasonContext | null = null;
      if (prevSeason === host.season && this.onTable) {
        list = host.playerList;
        unit = SKILL_UNITS[this.position].find((p) => p.gsisId === card.player.gsisId);
      } else {
        const rows = await this.data.tabRows(prevSeason, this.position);
        unit = rows.find((p) => p.gsisId === card.player.gsisId);
        if (!unit) return;
        context = host.seasonContext(prevSeason, { [this.position]: rows } as Record<SkillPosition, SkillPlayer[]>, this.position);
        list = context.list;
      }
      if (!unit || this.card !== card) return;
      const prev = this.skillsFor(host.readerFor(context), unit, list);
      const byId = new Map(prev.map((s) => [s.id, s.pct]));
      const overview = card.overview;
      overview.prev = {
        season: prevSeason,
        pcts: byId,
        // (a skill last season didn't have, like run blocking, sits where it is now)
        shape: radarShape(overview.skills.map((s) => byId.get(s.id) ?? s.pct)),
      };
      // (players and coaches get these against their whole career instead, in the history)
      if (!SPORT.teamTabs?.includes(this.position)) return;
      const moves = overview.skills.filter((s) => byId.has(s.id)).map((s) => ({ skill: s, delta: s.pct - byId.get(s.id)! }));
      const up = moves.reduce((best, m) => (m.delta > (best?.delta ?? 0.2) ? m : best), null as (typeof moves)[0] | null);
      const down = moves.reduce((worst, m) => (m.delta < (worst?.delta ?? -0.2) ? m : worst), null as (typeof moves)[0] | null);
      const pctText = (p: number) => `${Math.round(p * 100)}th`;
      const move = (m: (typeof moves)[0], way: string) =>
        `${m.skill.name} ${way} from ${prevSeason} (${pctText(m.skill.pct - m.delta)} → ${pctText(m.skill.pct)} percentile)`;
      if (up) overview.flags.push({ icon: 'trending_up', tone: 'good', text: move(up, 'up') });
      if (down) overview.flags.push({ icon: 'trending_down', tone: 'bad', text: move(down, 'down') });
    } catch (err) {
      console.error(err);
    }
  }

  // ---------------------------------------------------------------------------
  // The seasons they're in (the Seasons tab, and the Overview's career history) and similar seasons
  // ---------------------------------------------------------------------------
  private async loadSeasons(card: PlayerCard): Promise<void> {
    // (a career-only sport has no seasons to link, and no similar seasons)
    if (SPORT.careerOnly) return;
    try {
      const seasons = await this.seasonLines(card.player.gsisId);
      if (this.card !== card) return;
      card.seasons = seasons;
      if (this.tab === 'seasons' && seasons.length < 2) this.tab = 'overview';
      if (this.tab === 'seasons') this.rankCareer(card);
      this.loadHistory(card);
      this.loadExtras(card);
    } catch (err) {
      console.error(err);
    }
    if (card.season !== CURRENT_SEASON) this.loadComps(card);
  }

  // A line per season they're in, ranked with the default sliders (careers.json for the finished
  // seasons, this season from its rows), each headline stat's best finished season lit (lowest for a
  // stat that counts against them; a few games into this season, a hot start would take it)
  private async seasonLines(id: string): Promise<CardSeason[]> {
    const position = this.position;
    const current = this.host.season === CURRENT_SEASON ? SKILL_UNITS : await this.data.rows(CURRENT_SEASON);
    const headline = headlineStats(position);
    const line = (season: number, teamLogo: string, games: number, rank: number, of: number, stats: (number | null)[]): CardSeason => ({
      season,
      // (the team's logo that season, and the team's own file: whiteLogo reads it)
      logo: logoForSeason(teamLogo, season),
      teamLogo,
      games,
      rank,
      of,
      pct: rankPct(rank, of),
      stats: headline.map((stat, i) => ({ text: totalText(stat, stats[i] ?? null), label: stat.label, value: stats[i] ?? null, share: 0, best: false })),
    });
    const seasons = ((await this.data.careers())[position]?.[id] ?? []).map(([season, logo, games, rank, of, stats]) =>
      line(season, SPORT.teamLogo(logo), games, rank, of, stats),
    );
    const now = (current[position] ?? []).find((p) => p.gsisId === id);
    if (now) {
      const ranked = defaultRanking(position, presetWeights(position, 'default'), current);
      const context: ValueContext = { position, settings: DEFAULT_SPORT_SETTINGS, rows: current, tableSeason: false, defaults: true };
      const stats = headline.map((stat) => statValue(now, stat, context));
      seasons.push(line(CURRENT_SEASON, now.teamLogo, now.games, ranked.indexOf(now) + 1, ranked.length, stats));
    }
    const finished = seasons.filter((s) => !isLiveSeason(s.season));
    headline.forEach((stat, i) => {
      const done = finished.map((s) => s.stats[i].value).filter((v): v is number => v !== null);
      if (!seasons.some((s) => s.stats[i].value !== null)) return;
      const best = stat.negative ? Math.min(...done) : Math.max(...done);
      for (const s of seasons) {
        const v = s.stats[i].value;
        if (v !== null) s.stats[i].best = done.length > 1 && !isLiveSeason(s.season) && v === best;
      }
    });
    return seasons;
  }

  // The Seasons tab: re-rank every season with the current sliders (a season dragged by hand this visit
  // keeps its dragged order; the table's own season is the table's list). Each line swaps its default
  // rank for this one as its season loads.
  private rankCareer(card: PlayerCard): void {
    if (card.careerRanked || !card.seasons) return;
    card.careerRanked = true;
    for (const line of card.seasons) {
      this.rankSeasonLine(card, line).catch((err) => console.error(err));
    }
  }

  private async rankSeasonLine(card: PlayerCard, line: CardSeason): Promise<void> {
    const { list, context } = await this.rankedSeason(line.season);
    const at = list.findIndex((p) => p.gsisId === card.player.gsisId);
    // (under the Min Games setting that year, or hidden as injured: the default rank stays)
    if (at < 0 || this.card !== card) return;
    line.rank = at + 1;
    line.of = list.length;
    line.pct = rankPct(line.rank, line.of);
    line.yours = true;
    // Each headline stat by where it stood in that year's list (per game, like the table): the bar's
    // length, and with Color-Coded Values on, its color on the card's red-orange-green scale
    const reader = this.host.readerFor(context);
    headlineStats(this.position).forEach((stat, i) => {
      const readout = line.stats[i];
      const mine = reader.rate(list[at], stat);
      if (!readout || mine === null) return;
      const values = list.map((p) => reader.rate(p, stat)).filter((v): v is number => v !== null);
      if (values.length < 2) return;
      const above = values.filter((v) => (stat.negative ? v < mine : v > mine)).length;
      const pct = 1 - above / (values.length - 1);
      readout.share = pct;
      if (this.host.colorValues) readout.tint = rankTone(pct);
    });
  }

  // A season's list ranked with the current sliders: the table's own, or another's (null context: the table's)
  private async rankedSeason(season: number): Promise<{ list: SkillPlayer[]; context: SeasonContext | null }> {
    if (season === this.host.season && this.onTable) return { list: this.host.playerList, context: null };
    const rows = season === CURRENT_SEASON ? (await this.data.rows(CURRENT_SEASON))[this.position] : await this.data.tabRows(season, this.position);
    const context = this.host.seasonContext(season, { [this.position]: rows } as Record<SkillPosition, SkillPlayer[]>, this.position);
    return { list: context.list, context };
  }

  // The Overview's career history: this season and the ones before it. Players and coaches only: a
  // defense or O-line turns over too much year to year.
  private async loadHistory(card: PlayerCard): Promise<void> {
    if (SPORT.teamTabs?.includes(this.position) || !card.seasons) return;
    const upTo = card.seasons.filter((s) => s.season <= card.season);
    try {
      const entries = (await Promise.all(upTo.map((s) => this.careerSeason(card, s.season)))).filter((e): e is CareerSeason => !!e);
      if (this.card !== card || !entries.length) return;
      const played = upTo.map((s) => s.season);
      card.overview.flags = [
        ...card.overview.flags,
        ...careerHistory(this.position, card.season, played, entries, card.overview.blockingArchetype),
      ];
    } catch (err) {
      console.error(err);
    }
  }

  // One season of a career: where they ranked (current sliders) and their skills, or null when they're
  // not in that year's list (under Min Games, or hidden as injured)
  private async careerSeason(card: PlayerCard, season: number): Promise<CareerSeason | null> {
    if (season === card.season) {
      return { season, rank: card.rank, of: card.of, pct: rankPct(card.rank, card.of), skills: card.overview.skills, archetype: card.overview.archetype };
    }
    const { list, context } = await this.rankedSeason(season);
    const at = list.findIndex((p) => p.gsisId === card.player.gsisId);
    if (at < 0) return null;
    const skills = this.skillsFor(this.host.readerFor(context), list[at], list);
    const pct = rankPct(at + 1, list.length);
    return { season, rank: at + 1, of: list.length, pct, skills, archetype: archetypeFor(this.position, skills, pct, list[at]) };
  }

  // The three closest seasons by anyone else (finished seasons only)
  private async loadComps(card: PlayerCard): Promise<void> {
    try {
      const matches = (await this.data.comps(card.season))[this.position]?.[card.player.gsisId] ?? [];
      if (this.card !== card) return;
      card.comps = matches.map(([season, gsisId, name, espnId, logo, match]) => {
        const teamLogo = SPORT.teamLogo(logo);
        return {
          season,
          gsisId,
          name,
          match,
          logo: logoForSeason(teamLogo, season),
          color: badgeColor(teamLogo),
          whiteLogo: whiteLogo(teamLogo),
          espnId,
          photo: this.host.headshot({ id: espnId }, 240),
        };
      });
    } catch (err) {
      console.error(err);
      if (this.card === card) card.comps = [];
    }
  }

  // The sport's card extras (SPORT.cardExtras: the NFL's run blocking), once the seasons are in
  private async loadExtras(card: PlayerCard): Promise<void> {
    if (!SPORT.cardExtras || !card.seasons) return;
    const overview = card.overview;
    const redraw = () => {
      overview.radar = radar(overview.skills);
      overview.report = scoutingReport(overview.skills).report;
      if (overview.prev) overview.prev.shape = radarShape(overview.skills.map((s) => overview.prev!.pcts.get(s.id) ?? s.pct));
    };
    try {
      await SPORT.cardExtras({
        player: card.player,
        season: card.season,
        position: this.position,
        seasons: card.seasons.filter((s) => s.season <= card.season).map((s) => s.season),
        open: () => this.card === card,
        tabRows: (season) => this.data.tabRows(season, this.position),
        seasonFile: (season, file) => this.data.extraFile(season, file),
        skills: () => overview.skills,
        addSkill: (skill: CardSkill) => {
          overview.skills = [...overview.skills.filter((s) => s.id !== skill.id), skill];
          redraw();
        },
        addFlags: (flags) => (overview.flags = [...overview.flags, ...flags]),
        setArchetype: (name) => {
          overview.archetype = name;
          overview.blockingArchetype = true;
          // (a "new profile" note compared archetypes worked out without it, so it no longer applies)
          overview.flags = overview.flags.filter((f) => !f.text.startsWith('New profile'));
        },
      });
    } catch (err) {
      console.error(err);
    }
  }
}

// A headline stat on the Seasons tab: a season's total, formatted like the table ("4,183")
function totalText(stat: SkillStat, value: number | null): string {
  if (value === null) return '-';
  switch (stat.format) {
    case 'pct':
      return `${Math.round(value * 100)}%`;
    case 'pctPoints':
      return `${value.toFixed(1)}%`;
    case 'dec1':
      return value.toFixed(1);
    case 'dec2':
      return value.toFixed(2);
    case 'rank':
      return `#${value}`;
    default:
      return NUMBER.format(Math.round(value));
  }
}

