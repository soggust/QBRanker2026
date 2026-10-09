import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, SkillStatGroup, SkillWeights, StatGroupId, skillGroups, statGroup } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { DEFAULT_SETTINGS, PositionService } from '@ranker/engine/position.service';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { byTotals, combinedFor, combinedWeights, weightedTotals } from '@ranker/engine/unit-scoring';
import { StatReader } from '@ranker/engine/stat-reader';
import { hasMin, minCount, seasonLength } from '@ranker/engine/playing-time';

// The table's own tab: its stats, groups, switched-off groups and sliders (kept by the grid, which
// listens for their changes)
export interface TabState {
  position: SkillPosition;
  stats: SkillStat[];
  groups: SkillStatGroup[];
  hidden: Partial<Record<StatGroupId, boolean>>;
  weights: SkillWeights;
}

// How a tab's list is made, for the grid and for the player card (another season's list, another tab's):
// who's in it (the filters), their order (the sliders), and which stats have a column. No view state:
// the grid keeps its rows and DOM, this works them out.
export class TabRanker {
  constructor(
    private readonly positions: PositionService,
    private readonly seasonData: SeasonDataService,
    // the grid's tab, as it is now
    private readonly table: () => TabState,
    // (the first seasons arrived: Rookies Only can tell now, so the grid sorts again)
    private readonly firstSeasonsLoaded: () => void,
  ) {}

  private get settings() {
    return this.positions.settings;
  }

  // A tab's stats, groups, switched-off groups and sliders: the table's own, or another's (a card opened
  // on it from a roster)
  tab(position: SkillPosition): Omit<TabState, 'position'> {
    const table = this.table();
    if (position === table.position) return table;
    return {
      stats: SKILL_STATS[position],
      groups: skillGroups(position),
      hidden: this.positions.skillHiddenGroups(position),
      weights: this.positions.getWeights(position),
    };
  }

  // ---------------------------------------------------------------------------
  // Who's in the list, and their order
  // ---------------------------------------------------------------------------
  // The players a season's rows list: injured players only with Injured Players on, enough playing
  // time (Min Games), only rookies with Rookies Only on, and the sport's own filter
  listed(rows: Record<string, SkillPlayer[]>, season: number, position: SkillPosition): SkillPlayer[] {
    const min = hasMin(position) ? minCount(this.settings, seasonLength(rows, position)) : 0;
    return (rows[position] ?? []).filter(
      (player) =>
        (this.settings.showInjured || !player.injured || !!SPORT.noSwitches?.includes('showInjured')) &&
        SPORT.playingTime.of(player) >= min &&
        this.rookieOk(player, season, position) &&
        (SPORT.rowVisible?.(player, this.settings.sport) ?? true),
    );
  }

  // Best first by the sliders: switched-off groups and stats don't count, and each combined pair's
  // parts count by their parent slider (another tab's, for a card opened on it). Combined (the setting),
  // a pair counts as its column, the total its sliders mix, so the list goes by the number it shows.
  //
  // The list's filters (Min Games, Injured Players, Rookies Only) only leave players out: every row of the
  // tab is ranked, each stat measured against the same players whatever they're set to (the rows with
  // the sport's default Min Games: the list as it first opens), and then the players asked for are kept
  // in that order. (Measured against just the players left, a stat's average and spread moved with
  // the filters, and players who stayed swapped places.)
  ranked(reader: StatReader, players: SkillPlayer[], position: SkillPosition, rows: Record<string, SkillPlayer[]> = { [position]: players }): SkillPlayer[] {
    return this.rankedTotals(reader, players, position, rows).ranked;
  }

  // ranked, with every row's score (the rank tile's hover)
  rankedTotals(
    reader: StatReader,
    players: SkillPlayer[],
    position: SkillPosition,
    rows: Record<string, SkillPlayer[]> = { [position]: players },
  ): { ranked: SkillPlayer[]; totals: Map<SkillPlayer, number> } {
    const keep = new Set(players);
    const { ranked, totals } = this.scores(reader, players, position, rows);
    return { ranked: ranked.filter((player) => keep.has(player)), totals };
  }

  // The scores behind ranked: every row's weighted total, the stats that counted, the tab's rows in their
  // order (before the list's filters), and with parts each stat's share of every total (the rank tile's
  // breakdown: the same math, so it sums to the total the list went by)
  scores(
    reader: StatReader,
    players: SkillPlayer[],
    position: SkillPosition,
    rows: Record<string, SkillPlayer[]> = { [position]: players },
    parts?: Map<SkillPlayer, Map<string, number>>,
    strengths?: Map<string, number>,
  ): { totals: Map<SkillPlayer, number>; counted: SkillStat[]; weights: SkillWeights; ranked: SkillPlayer[] } {
    const { stats, hidden } = this.tab(position);
    const combined = this.settings.combineStats;
    const counted = (combined ? this.combine(stats, position).stats : stats).filter(
      (stat) => !hidden[statGroup(stat)] && !this.statHidden(stat.key, position) && !reader.recentOff(stat),
    );
    const weights = combinedWeights(position, this.mixWeights(position), combined);
    const visible = (rows[position] ?? []).filter((player) => SPORT.rowVisible?.(player, this.settings.sport) ?? true);
    const seen = new Set(visible);
    const all = [...visible, ...players.filter((player) => !seen.has(player))];
    const min = hasMin(position) ? minCount(DEFAULT_SETTINGS, seasonLength(rows, position)) : 0;
    const pool = all.filter((player) => SPORT.playingTime.of(player) >= min);
    const totals = weightedTotals(all, counted, weights, (player, stat) => reader.value(player, stat), undefined, this.settings.sport, pool, parts, strengths);
    return { totals, counted, weights, ranked: byTotals(all, totals, this.settings.sport) };
  }

  // A list in a saved order (players that have since appeared go at the end)
  inOrder(players: SkillPlayer[], ids: string[]): SkillPlayer[] {
    const at = new Map(ids.map((id, i) => [id, i]));
    return [...players].sort((a, b) => (at.get(a.gsisId) ?? Infinity) - (at.get(b.gsisId) ?? Infinity));
  }

  // Rookies Only (settings menu): players in their first season (first-year head coaches on a coaches'
  // tab). A first season is the first one they're in the data (careers/first-seasons.json, loaded when the
  // setting is turned on), so the data's first season can't tell and lists everyone; so do team tabs.
  private firstSeasons: Map<string, number> | null = null;
  private firstSeasonsLoading = false;

  private rookieOk(player: SkillPlayer, season: number, position: SkillPosition): boolean {
    if (!this.settings.rookiesOnly || SPORT.noSwitches?.includes('rookiesOnly') || SPORT.teamTabs?.includes(position)) return true;
    // (a sport whose data says who's a rookie: that decides)
    const flagged = (player as { rookie?: boolean }).rookie;
    if (flagged !== undefined) return flagged;
    if (season <= SPORT.firstSeason) return true;
    if (!this.firstSeasons) {
      this.loadFirstSeasons();
      return true;
    }
    // (the careers files have the finished seasons, so this season's rookies aren't in them at all)
    return (this.firstSeasons.get(player.gsisId) ?? season) >= season;
  }

  private loadFirstSeasons(): void {
    if (this.firstSeasonsLoading) return;
    this.firstSeasonsLoading = true;
    this.seasonData
      .firstSeasons()
      .then((first) => {
        this.firstSeasons = new Map(Object.entries(first));
        if (this.settings.rookiesOnly) this.firstSeasonsLoaded();
      })
      .catch((err) => console.error(err))
      .finally(() => (this.firstSeasonsLoading = false));
  }

  // ---------------------------------------------------------------------------
  // The columns
  // ---------------------------------------------------------------------------
  // The groups shown, in the order of the sidebar's cards, each with its stats that have a column (in
  // their dragged order); and which stat's spot each combined column took (header dragging moves it as
  // that stat)
  shownGroups(reader: StatReader, position: SkillPosition): { groups: SkillStatGroup[]; spots: Record<string, string> } {
    const { groups, hidden } = this.tab(position);
    const spots: Record<string, string> = {};
    const shown = this.positions
      .orderedGroups(position, groups)
      .filter((group) => !hidden[group.id])
      .map((group) => {
        // (in their column order: dragging a header reorders them, and the order survives switching tabs)
        const combined = this.combine(this.positions.orderedStats(position, group), position);
        Object.assign(spots, combined.spots);
        return { ...group, stats: combined.stats.filter((stat) => this.isShown(stat, reader, position)) };
      })
      .filter((group) => group.stats.length);
    return { groups: shown, spots };
  }

  // Combine setting: a pair (rushing + receiving yards) shows as one total column where the first of the
  // two sits, when the tab has both (spots: the stat whose spot each total took)
  private combine(stats: SkillStat[], position: SkillPosition): { stats: SkillStat[]; spots: Record<string, string> } {
    const spots: Record<string, string> = {};
    if (!this.settings.combineStats) return { stats, spots };
    let out = stats;
    for (const { stat: total, parts } of combinedFor(position)) {
      const at = out.findIndex((stat) => (parts as string[]).includes(stat.key));
      if (at === -1 || !parts.every((part) => out.some((stat) => stat.key === part))) continue;
      spots[total.key] = out[at].key;
      out = out.flatMap((stat, i) => (i === at ? [total] : (parts as string[]).includes(stat.key) ? [] : [stat]));
    }
    return { stats: out, spots };
  }

  // Switched off with its sidebar eye (or its combined pair's parent eye): hidden and out of the
  // ranking, whatever Unweighted Stats says
  private statHidden(key: string, position: SkillPosition): boolean {
    const parent = combinedFor(position).find(({ parts }) => (parts as string[]).includes(key));
    return this.positions.isStatHidden(position, key) || (!!parent && this.positions.isStatHidden(position, parent.stat.key));
  }

  // The eye decides first; then a stat the season didn't record has no column; then Unweighted Stats
  // decides whether a 0% stat shows (display-only columns like Games always do)
  private isShown(stat: SkillStat, reader: StatReader, position: SkillPosition): boolean {
    if (this.statHidden(stat.key, position) || stat.shownWhen?.(this.settings.sport) === false || reader.recentOff(stat)) return false;
    const weights = combinedWeights(position, this.tab(position).weights);
    const showUnused = this.settings.showUnused;
    // A combined column shows if either of its stats would
    const combined = combinedFor(position).find((c) => c.stat.key === stat.key);
    if (combined) {
      const parts = combined.parts.filter((key) => !this.statHidden(key, position) && !reader.empty(key));
      return parts.length > 0 && (showUnused || parts.some((key) => !!weights[key as keyof SkillWeights]));
    }
    if (reader.empty(stat.key)) return false;
    // (a display-only column nobody has a value for this season: one it didn't keep yet)
    if (stat.infoOnly) return ['recent', 'record'].includes(stat.format) || reader.hasValues(stat);
    return showUnused || !!weights[stat.key];
  }

  // A tab's sliders as its combined totals mix their parts: a part switched off with its eye at 0 (the same
  // object until the sliders or the eyes change: every cell's value asks for it)
  private mixes = new Map<SkillPosition, { weights: SkillWeights; hidden: Record<string, boolean>; mix: SkillWeights }>();
  mixWeights(position: SkillPosition): SkillWeights {
    const weights = this.tab(position).weights;
    const hidden = this.positions.statHiddenState;
    const known = this.mixes.get(position);
    if (known?.weights === weights && known.hidden === hidden) return known.mix;
    const off = combinedFor(position).flatMap(({ parts }) => parts.filter((part) => this.statHidden(part, position)));
    const mix = off.length ? { ...weights, ...Object.fromEntries(off.map((part) => [part, 0])) } : weights;
    this.mixes.set(position, { weights, hidden, mix });
    return mix;
  }
}
