import { SkillPlayer, SkillPosition, SkillStat, SkillStatGroup } from '@sport/positions';
import { SPORT } from '@sport/sport';
import type { StatReader } from '@ranker/engine/stat-reader';
import type { RankerSettings } from '@ranker/engine/position.service';
import type { SeasonPart } from '@ranker/engine/data';
import { ListDraft } from './lists.store';
import { SnapshotColumn, buildSnapshot } from './lists-helpers';

// What the grid hands to "Save this list…": its tab, season and settings, its rows as ordered, the
// groups it shows (and which are collapsed), its reader, and its headshots
export interface GridForDraft {
  position: SkillPosition;
  season: number;
  seasonPart: SeasonPart;
  settings: RankerSettings;
  playerList: SkillPlayer[];
  visibleGroups: SkillStatGroup[];
  reader: StatReader;
  isCollapsed: (id: SkillStatGroup['id']) => boolean;
  headshot: (unit: { id?: number | null }, w?: number) => string | null;
}

// The columns a list keeps: every stat column showing (not a collapsed group's, nor the Recent dots), as
// the grid labels them
export function gridColumns(grid: GridForDraft): { stat: SkillStat; column: SnapshotColumn }[] {
  return grid.visibleGroups
    .filter((group) => !grid.isCollapsed(group.id))
    .flatMap((group) => group.stats)
    .filter((stat) => stat.format !== 'recent')
    .map((stat) => ({ stat, column: { key: stat.key, label: grid.reader.label(stat), format: stat.format ?? '', lower: !!stat.negative } }));
}

// The grid as a list to save (its top rows as ordered now, frozen)
export function gridDraft(grid: GridForDraft): ListDraft {
  const columns = gridColumns(grid);
  const stats = new Map(columns.map(({ stat }) => [stat.key as string, stat]));
  const snapshot = buildSnapshot({
    rows: grid.playerList,
    columns: columns.map(({ column }) => column),
    id: (p) => p.gsisId,
    name: (p) => p.name,
    teamLogo: (p) => p.teamLogo,
    photo: (p) => grid.headshot(p, 120),
    value: (p, key) => grid.reader.value(p, stats.get(key)!),
    text: (p, key) => grid.reader.format(p, stats.get(key)!).replace(/ \(tied\)$/, ''),
  });
  return {
    ...snapshot,
    sport: SPORT.id,
    tab: grid.position,
    season: grid.season,
    part: grid.seasonPart,
    basis: grid.settings.statBasis,
  };
}

// (a title to start from: "2026 QB Rankings", "2024 Playoffs Teams Rankings")
export function draftTitle(grid: Pick<GridForDraft, 'position' | 'season' | 'seasonPart'>): string {
  const tab = (SPORT.tabNames as Record<string, string>)[grid.position] ?? grid.position;
  const part = grid.seasonPart === 'post' ? ' Playoffs' : grid.seasonPart === 'all' ? ' Full Season' : '';
  return `${SPORT.seasonText(grid.season)}${part} ${tab} Rankings`;
}
