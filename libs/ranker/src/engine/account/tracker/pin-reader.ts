// A pinned comparison read now: its link's sides opened in a compare view of its own (player-compare.ts),
// ranked with the sliders and settings the link carries (the ones it was pinned with), not whatever the
// grid has now, so the pin and every look at it since are measured the same way. Its host is a stand-in
// for the grid (the same filters and ranking: tab-ranker.ts), so the numbers are the ones the compare view
// shows. Also what pins it: the snapshot taken here is the baseline.
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStatGroup, SkillWeights, StatGroupId, POSITIONS, presetWeights } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SEASONS, dataSeason } from '@ranker/engine/data';
import { DEFAULT_SPORT_SETTINGS, SKILL_UNITS, emptyIn } from '@ranker/engine/unit-scoring';
import { DEFAULT_SETTINGS, PositionService, RankerSettings } from '@ranker/engine/position.service';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { StatReader } from '@ranker/engine/stat-reader';
import { TabRanker } from '@ranker/engine/skill-rankings/tab-ranker';
import { readCompareCode } from '@ranker/engine/share';
import { CompareHost, CompareSide, PlayerCompare } from '@ranker/engine/compare/player-compare';
import type { SeasonContext } from '@ranker/engine/player-card/card.model';
import { PinSnapshot, decodeShared, parseSpec, snapshotOf } from './tracker-helpers';

export interface PinRead {
  sides: CompareSide[];
  snapshot: PinSnapshot;
}

// The grid's settings as the link has them (share.ts's ?list=): each tab's sliders, the stats and groups
// switched off, the settings menu's and the sport's own (anything the site doesn't have left out)
function linkedState(code: string | null) {
  const shared = decodeShared(code) ?? {};
  const tabs = new Set<string>(POSITIONS);
  const record = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const weights = record(shared['w']);
  const hiddenStats: Record<string, boolean> = {};
  for (const key of Array.isArray(shared['h']) ? shared['h'] : []) if (typeof key === 'string' && tabs.has(key.split('.')[0])) hiddenStats[key] = true;
  const groups = record(shared['g']);
  const known = <T extends object>(values: Record<string, unknown>, base: T): Partial<T> =>
    Object.fromEntries(
      Object.entries(values).filter(([key, value]) => {
        if (!(key in base)) return false;
        const was = (base as Record<string, unknown>)[key];
        return was === null ? value === null || typeof value === 'number' : typeof value === typeof was;
      }),
    ) as Partial<T>;
  const settings: RankerSettings = {
    ...DEFAULT_SETTINGS,
    ...known(record(shared['s']), DEFAULT_SETTINGS),
    sport: { ...DEFAULT_SPORT_SETTINGS, ...known(record(shared['sp']), DEFAULT_SPORT_SETTINGS) } as RankerSettings['sport'],
  };
  const weightsOf = (position: SkillPosition): SkillWeights => {
    const own = record(weights[position]);
    const sliders = Object.fromEntries(Object.entries(own).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 100));
    return { ...presetWeights(position, 'default'), ...sliders } as SkillWeights;
  };
  const hiddenGroups = (position: SkillPosition): Partial<Record<StatGroupId, boolean>> => {
    const ids = groups[position];
    return Array.isArray(ids) ? Object.fromEntries(ids.filter((id) => typeof id === 'string').map((id) => [id, true])) : {};
  };
  return { settings, weightsOf, hiddenStats, hiddenGroups };
}

// (what the ranking asks of the position service, answered from the link: the same object each time, so
// its caches hold)
function pinnedPositions(code: string | null): PositionService {
  const state = linkedState(code);
  const weights = new Map<SkillPosition, SkillWeights>();
  const stub = {
    settings: state.settings,
    statHiddenState: state.hiddenStats,
    getWeights: (position: SkillPosition) => weights.get(position) ?? weights.set(position, state.weightsOf(position)).get(position)!,
    skillHiddenGroups: (position: SkillPosition) => state.hiddenGroups(position),
    isStatHidden: (position: string, key: string) => !!state.hiddenStats[`${position}.${key}`],
    orderedGroups: (_position: string, groups: SkillStatGroup[]) => groups,
    orderedStats: (_position: string, group: SkillStatGroup) => group.stats,
    seasonUnitOrder: () => undefined,
  };
  return stub as unknown as PositionService;
}

export class PinReader {
  constructor(private readonly data: SeasonDataService) {}

  // The pin's sides as they stand now, and their snapshot (null: none of them found)
  async read(spec: string): Promise<PinRead | null> {
    const { list, cmp } = parseSpec(spec);
    if (!cmp) return null;
    const shared = readCompareCode(cmp, SEASONS);
    if (!shared.sides.length) return null;
    const positions = pinnedPositions(list);
    const settings = positions.settings;
    // (no table tab of its own: every tab is answered from the link's settings)
    const ranker = new TabRanker(positions, this.data, () => ({ position: '' as SkillPosition, stats: [], groups: [], hidden: {}, weights: {} as SkillWeights }), () => {});
    const readerOf = (context: SeasonContext) => {
      const position = context.position!;
      return new StatReader({
        position,
        settings,
        rows: context.rows,
        list: context.list,
        tableSeason: false,
        season: context.season,
        empty: context.empty,
        get weights() {
          return ranker.mixWeights(position);
        },
      });
    };
    const first = shared.sides[0].position;
    const misses = new Map<number, number>();
    const host: CompareHost = {
      position: first,
      // (the season loaded: its rows are SKILL_UNITS; none of them is the table's own list)
      season: dataSeason,
      playerList: [],
      stats: SKILL_STATS[first],
      colorValues: settings.colorValues,
      get reader(): StatReader {
        return readerOf(host.seasonContext(dataSeason, SKILL_UNITS, first));
      },
      readerFor: (context) => (context ? readerOf(context) : host.reader),
      seasonContext(season: number, rows: Record<SkillPosition, SkillPlayer[]>, position: SkillPosition = first): SeasonContext {
        const units = rows[position] ?? [];
        const context: SeasonContext = { season, rows, list: [], empty: (key) => emptyIn(units, key), position };
        context.list = host.rankedIn(context, ranker.listed({ [position]: units }, season, position));
        return context;
      },
      rankedIn: (context, players) => ranker.ranked(readerOf(context), players, context.position ?? first, context.rows),
      shownGroups: (reader, position = first) => ranker.shownGroups(reader, position).groups,
      headshot(unit, w = 160) {
        if (!unit.id) return null;
        const missed = misses.get(unit.id) ?? 0;
        if (missed === 0) return SPORT.headshot(unit.id, w);
        if (missed === 1 && SPORT.headshotFallback) return SPORT.headshotFallback(unit.id, w);
        return null;
      },
      noHeadshot(unit) {
        if (unit.id) misses.set(unit.id, (misses.get(unit.id) ?? 0) + 1);
      },
    };
    const compare = new PlayerCompare(host, this.data);
    await compare.openLinked(shared);
    const sides = compare.sides;
    if (!sides.length) return null;
    // (each one's score: the list's own, as the rank tile's breakdown has it)
    const scores = sides.map((side) => {
      try {
        const rows = side.context?.rows ?? SKILL_UNITS;
        return ranker.rankedTotals(side.reader, side.list, side.position, rows).totals.get(side.player) ?? null;
      } catch {
        return null;
      }
    });
    const snapshot = snapshotOf(sides, compare.view, scores, Date.now());
    compare.close();
    return { sides, snapshot };
  }
}
