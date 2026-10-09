import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, presetWeights } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { DEFAULT_SETTINGS } from '@ranker/engine/position.service';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { SeasonPart, dataPart, dataSeason, fetchSeason } from '@ranker/engine/data';
import { DEFAULT_SPORT_SETTINGS, SKILL_UNITS, combinedFor, defaultRanking, emptyIn, unitsForSeason } from '@ranker/engine/unit-scoring';
import { StatReader } from '@ranker/engine/stat-reader';
import { hasMin, minCount, seasonLength } from '@ranker/engine/playing-time';
import { SavedList, TodayRow } from './lists-helpers';

// The season's rows as they are now: the grid's own when it shows that season and part, else fetched
// (a finished season's regular season once per visit; its playoffs or both from their files)
async function rowsFor(seasons: SeasonDataService, season: number, part: SeasonPart): Promise<{ rows: Record<SkillPosition, SkillPlayer[]>; table: boolean }> {
  if (season === dataSeason && part === dataPart) return { rows: SKILL_UNITS, table: true };
  if (part === 'regular') return { rows: await seasons.rows(season), table: false };
  return { rows: unitsForSeason(await fetchSeason(season, part), season), table: false };
}

// "Today": each of a saved list's players read from the season's data now, the way the list was saved
// (its stat basis, the default sliders and settings otherwise): every column's value and text, and his
// place in today's default ranking (the players it lists: the default playing-time minimum and the
// sport's default view). A player gone from the data has no row.
export async function readToday(list: SavedList, seasons: SeasonDataService): Promise<Map<string, TodayRow>> {
  const tab = list.tab as SkillPosition;
  const { rows, table } = await rowsFor(seasons, list.season, list.part as SeasonPart);
  const units = rows[tab] ?? [];
  const weights = presetWeights(tab, 'default');
  const settings = { ...DEFAULT_SETTINGS, statBasis: (list.basis || DEFAULT_SETTINGS.statBasis) as typeof DEFAULT_SETTINGS.statBasis };
  const min = hasMin(tab) ? minCount(DEFAULT_SETTINGS, seasonLength(rows, tab)) : 0;
  const ranked = defaultRanking(tab, weights, rows, DEFAULT_SPORT_SETTINGS).filter(
    (p) => SPORT.playingTime.of(p) >= min && (SPORT.rowVisible?.(p, DEFAULT_SPORT_SETTINGS) ?? true),
  );
  const rank = new Map(ranked.map((p, i) => [p.gsisId, i + 1]));
  const reader = new StatReader({
    position: tab,
    settings,
    rows,
    list: ranked,
    tableSeason: table,
    season: list.season,
    empty: (key) => emptyIn(units, key),
    weights,
  });
  const stats = new Map<string, SkillStat>([...(SKILL_STATS[tab] ?? []), ...combinedFor(tab).map(({ stat }) => stat as SkillStat)].map((s) => [s.key, s]));
  const byId = new Map(units.map((p) => [p.gsisId, p]));
  const today = new Map<string, TodayRow>();
  for (const id of list.ids) {
    const player = byId.get(id);
    if (!player) continue;
    const values: Record<string, number | null> = {};
    const texts: Record<string, string> = {};
    for (const key of list.columns) {
      const stat = stats.get(key);
      const value = stat ? reader.value(player, stat) : null;
      values[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
      texts[key] = stat ? reader.format(player, stat).replace(/ \(tied\)$/, '') : '-';
    }
    today.set(id, { values, texts, rank: rank.get(id) ?? null });
  }
  return today;
}
